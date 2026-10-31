// supabase/functions/purge-expired-travel-cards/index.ts
//
// Deletes travel cards 7 days after the trip ended: the uploaded ID document
// is removed from the `travel-documents` bucket FIRST, then the card row is
// deleted (locations / safety assessments cascade, alerts / incidents are
// kept with travel_card_id set to null — see 20261030_travel_card_lifecycle.sql).
//
// Storage objects can only be removed through the Storage API (deleting rows
// in storage.objects from SQL leaves the file itself behind), which is why
// this is an edge function and not a plain pg_cron SQL statement.
//
// A card is "complete" once its end_date has passed. It is purged when
// end_date is more than RETENTION_DAYS old, measured in the project's local
// timezone (TZ_OFFSET_MINUTES; 330 = India). Cards whose document can't be
// removed are skipped and retried on the next run, so an ID image is never
// orphaned by a half-finished purge.
//
// Secrets: CRON_SECRET (any long random string). SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are provided automatically.
// Auth: caller must send `x-cron-secret: <CRON_SECRET>` or the service-role
// key as a Bearer token.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RETENTION_DAYS = 7;
const TZ_OFFSET_MINUTES = 330;
const BATCH_LIMIT = 200;
const BUCKET = "travel-documents";

function storagePath(documentUrl: string): string {
  const marker = `/${BUCKET}/`;
  const i = documentUrl.indexOf(marker);
  return i >= 0 ? decodeURIComponent(documentUrl.slice(i + marker.length).split("?")[0]) : documentUrl;
}

Deno.serve(async (req) => {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const cronSecret = Deno.env.get("CRON_SECRET");
  const bearer = req.headers.get("authorization") ?? "";
  const authorised =
    bearer === `Bearer ${serviceKey}` ||
    (!!cronSecret && req.headers.get("x-cron-secret") === cronSecret);
  if (!authorised) return new Response("Unauthorized", { status: 401 });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey, {
    auth: { persistSession: false },
  });

  // Local "today" minus the retention window, as YYYY-MM-DD.
  const localNow = new Date(Date.now() + TZ_OFFSET_MINUTES * 60_000);
  const cutoff = new Date(localNow.getTime() - RETENTION_DAYS * 86_400_000).toISOString().slice(0, 10);

  const { data: cards, error } = await supabase
    .from("travel_cards")
    .select("id, document_url")
    .lt("end_date", cutoff)
    .limit(BATCH_LIMIT);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  let deleted = 0;
  const failures: { id: string; reason: string }[] = [];

  for (const card of cards ?? []) {
    if (card.document_url) {
      const { error: rmErr } = await supabase.storage.from(BUCKET).remove([storagePath(card.document_url)]);
      if (rmErr) {
        failures.push({ id: card.id, reason: `storage: ${rmErr.message}` });
        continue; // keep the row so the next run retries the document too
      }
    }
    const { error: delErr } = await supabase.from("travel_cards").delete().eq("id", card.id);
    if (delErr) failures.push({ id: card.id, reason: `db: ${delErr.message}` });
    else deleted++;
  }

  const body = { cutoff, found: cards?.length ?? 0, deleted, failures };
  console.log(JSON.stringify(body));
  return Response.json(body, { status: failures.length ? 207 : 200 });
});
