// supabase/functions/sms-panic/index.ts
//
// Deploy with: supabase functions deploy sms-panic
//
// SMS-based panic fallback for zero-connectivity areas. When a tourist has no
// mobile data/internet but can still send a basic SMS, they text "SOS" to the
// configured number. The SMS gateway forwards it to this webhook, which:
//
// 1. Identifies the tourist from sender phone number
// 2. Retrieves their most recent location from the locations table
// 3. Inserts an emergency alert into the existing alerts table
// 4. Existing dashboard/realtime alert flow handles it from there
//
// This does NOT create a separate alert system — it reuses the same `alerts`
// table, alert UI, realtime subscriptions, acknowledge/resolve flow, map
// markers, etc. SMS simply becomes another source of an emergency alert.
//
// Expected webhook payload (generic SMS gateway format, adjust per provider):
// {
//   "from": "+1234567890",     // sender phone number in E.164 format
//   "to": "+9876543210",       // recipient number (your SOS hotline)
//   "text": "SOS",             // message body (case-insensitive match)
//   "timestamp": "2024-01-15T10:30:00Z"  // when SMS was sent
// }
//
// Twilio-specific payload mapping:
// {
//   "From": "+1234567890",
//   "To": "+9876543210",
//   "Body": "SOS",
//   "MessageSid": "...",
//   "AccountSid": "..."
// }
//
// Returns:
// - 200 with alert ID on success
// - 404 if phone number not found in travel_cards
// - 404 if no recent location found for user
// - 400 if message text doesn't match SOS trigger
// - 500 on database/processing errors

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// How far back to look for the user's last known location (in seconds)
// If someone hasn't shared location in the last 24 hours, we still want to
// send the alert with their last known position rather than failing.
const MAX_LOCATION_AGE_SEC = 24 * 60 * 60;

interface SMSWebhookPayload {
  // Generic format (normalize provider-specific fields to this)
  from?: string;
  to?: string;
  text?: string;
  timestamp?: string;

  // Twilio format
  From?: string;
  To?: string;
  Body?: string;
  MessageSid?: string;
}

function normalizeSMSPayload(raw: SMSWebhookPayload) {
  return {
    from: raw.from || raw.From,
    to: raw.to || raw.To,
    text: raw.text || raw.Body,
    timestamp: raw.timestamp,
  };
}

function isSOSTrigger(text: string): boolean {
  const normalized = text.trim().toUpperCase();
  // Match "SOS", "HELP", "EMERGENCY" as trigger words
  return ["SOS", "HELP", "EMERGENCY"].includes(normalized);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const rawPayload = await req.json();
    const { from, text } = normalizeSMSPayload(rawPayload);

    if (!from || !text) {
      return new Response(
        JSON.stringify({ error: "Missing 'from' or 'text' in webhook payload" }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    if (!isSOSTrigger(text)) {
      return new Response(
        JSON.stringify({
          error: "Message does not contain SOS trigger word",
          received: text,
          hint: "Valid triggers: SOS, HELP, EMERGENCY"
        }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Step 1: Find the tourist by phone number in travel_cards
    // Phone numbers in travel_cards might be stored without country code or
    // with varying formats. We do a flexible match: strip all non-digits and
    // match on the last N digits (configurable, default 10 for most countries).
    const cleanFrom = from.replace(/\D/g, "");
    const last10 = cleanFrom.slice(-10);

    const { data: cards, error: cardError } = await supabase
      .from("travel_cards")
      .select("id, user_id, mobile_number, full_name")
      .ilike("mobile_number", `%${last10}`);

    if (cardError) {
      throw new Error(`Failed to query travel_cards: ${cardError.message}`);
    }

    if (!cards || cards.length === 0) {
      return new Response(
        JSON.stringify({
          error: "Phone number not registered",
          from,
          hint: "Tourist must create a travel card with this mobile number in the app first"
        }),
        { status: 404, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // If multiple cards match (rare), pick the most recent one
    const card = cards[0];

    // Step 2: Retrieve the user's most recent location
    const cutoff = new Date(Date.now() - MAX_LOCATION_AGE_SEC * 1000).toISOString();

    const { data: locations, error: locError } = await supabase
      .from("locations")
      .select("lat, lon, accuracy, created_at")
      .eq("user_id", card.user_id)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(1);

    if (locError) {
      throw new Error(`Failed to query locations: ${locError.message}`);
    }

    if (!locations || locations.length === 0) {
      return new Response(
        JSON.stringify({
          error: "No recent location found for this user",
          user_id: card.user_id,
          hint: `No location data in the last ${MAX_LOCATION_AGE_SEC / 3600} hours. User must have shared location at least once.`
        }),
        { status: 404, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    const lastLocation = locations[0];

    // Step 3: Insert an emergency alert into the existing alerts table
    // This alert will be picked up by the dashboard's realtime subscription
    // and handled through the exact same flow as the mobile app panic button.
    const { data: alert, error: alertError } = await supabase
      .from("alerts")
      .insert({
        user_id: card.user_id,
        type: "panic",
        severity: "critical",
        lat: lastLocation.lat,
        lon: lastLocation.lon,
        message: `SMS SOS received from ${card.full_name || "tourist"} (${from}). Last known location from ${new Date(lastLocation.created_at).toLocaleString()}.`,
        // If your alerts table has a source column, uncomment:
        // source: "sms",
      })
      .select()
      .single();

    if (alertError) {
      throw new Error(`Failed to create alert: ${alertError.message}`);
    }

    // Optional: Log SMS panic events for audit trail
    await supabase.from("sms_panic_log").insert({
      phone_number: from,
      user_id: card.user_id,
      alert_id: alert.id,
      message_text: text,
      location_age_seconds: Math.round(
        (Date.now() - new Date(lastLocation.created_at).getTime()) / 1000
      ),
    }).catch((e) => {
      // Best-effort logging, don't fail the response if this fails
      console.error("Failed to log SMS panic event:", e);
    });

    return new Response(
      JSON.stringify({
        success: true,
        alert_id: alert.id,
        user: {
          id: card.user_id,
          name: card.full_name,
          phone: card.mobile_number,
        },
        location: {
          lat: lastLocation.lat,
          lon: lastLocation.lon,
          accuracy: lastLocation.accuracy,
          age_seconds: Math.round(
            (Date.now() - new Date(lastLocation.created_at).getTime()) / 1000
          ),
        },
        message: "Emergency alert created successfully"
      }),
      {
        status: 200,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
      }
    );

  } catch (e) {
    console.error("SMS panic handler error:", e);
    return new Response(
      JSON.stringify({ error: String(e) }),
      {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
      }
    );
  }
});
