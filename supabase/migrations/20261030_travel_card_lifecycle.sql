-- 20261030_travel_card_lifecycle.sql
--
-- 1. One dashboard entry per TRIP: latest_locations_by_card
--    (the existing latest_locations view is one row per USER, so a new travel
--    card overwrote the finished one on the dashboard).
-- 2. Deleting a travel card actually works: every FK that points at
--    travel_cards is re-created with ON DELETE CASCADE / SET NULL, and the
--    owner gets a DELETE policy.
-- 3. Admins can read uploaded ID documents from the private storage bucket.
--
-- Safe to re-run.

-- ───────────────────────────────────────────────────────────────────────
-- 1. Latest ping per (user, trip)
-- ───────────────────────────────────────────────────────────────────────
create index if not exists idx_locations_user_card_recorded
  on public.locations (user_id, travel_card_id, recorded_at desc);

-- security_invoker: the caller's RLS on `locations` applies, so admins see
-- everyone, trackers see only who they track, owners see themselves.
-- (DISTINCT ON treats NULL travel_card_id as one group: legacy pings.)
create or replace view public.latest_locations_by_card
with (security_invoker = true) as
select distinct on (user_id, travel_card_id)
  user_id, travel_card_id, lat, lon, accuracy, speed, recorded_at
from public.locations
order by user_id, travel_card_id, recorded_at desc;

grant select on public.latest_locations_by_card to authenticated;

-- ───────────────────────────────────────────────────────────────────────
-- 2. Make deletes work
-- ───────────────────────────────────────────────────────────────────────
-- Why the mobile Delete button did nothing: locations.travel_card_id and
-- safety_assessments.travel_card_id reference travel_cards(id) with the default
-- NO ACTION, so Postgres rejects the DELETE once the card has any location
-- rows, and the app never looked at the error.
--
-- Rewrites EVERY single-column FK that references travel_cards (including any
-- on alerts / incidents / trip tables that aren't in this repo's migrations):
--   locations, safety_assessments -> ON DELETE CASCADE (trip data goes with the trip)
--   anything else nullable         -> ON DELETE SET NULL (alerts / incidents survive as records)
--   anything else NOT NULL         -> ON DELETE CASCADE
do $$
declare
  fk record;
  col text;
  nullable boolean;
  action text;
begin
  for fk in
    select c.conname, c.conrelid, c.conrelid::regclass as tbl, c.conkey
    from pg_constraint c
    where c.contype = 'f' and c.confrelid = 'public.travel_cards'::regclass
  loop
    if array_length(fk.conkey, 1) <> 1 then
      raise notice 'Skipping multi-column FK % on %', fk.conname, fk.tbl;
      continue;
    end if;

    select a.attname, not a.attnotnull into col, nullable
    from pg_attribute a
    where a.attrelid = fk.conrelid and a.attnum = fk.conkey[1];

    if fk.tbl::text in ('public.locations', 'public.safety_assessments') or not nullable then
      action := 'cascade';
    else
      action := 'set null';
    end if;

    execute format('alter table %s drop constraint %I', fk.tbl, fk.conname);
    execute format(
      'alter table %s add constraint %I foreign key (%I) references public.travel_cards(id) on delete %s',
      fk.tbl, fk.conname, col, action);
    raise notice 'Recreated % on % (%) with ON DELETE %', fk.conname, fk.tbl, col, upper(action);
  end loop;
end $$;

-- Owners may delete their own cards. Permissive policies are OR-ed, so this is
-- harmless if an equivalent policy already exists.
alter table public.travel_cards enable row level security;

drop policy if exists travel_cards_delete_own on public.travel_cards;
create policy travel_cards_delete_own
  on public.travel_cards for delete
  to authenticated
  using (user_id = auth.uid());

-- Owners may remove their own uploaded document (path starts with "<user_id>/").
-- Lets the app delete the ID image together with the card.
drop policy if exists travel_documents_delete_own on storage.objects;
create policy travel_documents_delete_own
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'travel-documents' and (storage.foldername(name))[1] = auth.uid()::text);

-- ───────────────────────────────────────────────────────────────────────
-- 3. Admins can read uploaded government IDs (dashboard "View document")
-- ───────────────────────────────────────────────────────────────────────
drop policy if exists travel_documents_select_admin on storage.objects;
create policy travel_documents_select_admin
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'travel-documents'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );
