-- Admin deletion is deliberately limited to completed travel sessions.
-- Apply this migration in Supabase before deploying the dashboard UI.

alter table public.travel_cards enable row level security;

-- Replaces the earlier broad admin DELETE policy.
drop policy if exists "delete own or admin travel_cards" on public.travel_cards;
drop policy if exists travel_cards_delete_admin_completed on public.travel_cards;
create policy travel_cards_delete_admin_completed
  on public.travel_cards for delete
  to authenticated
  using (
    public.is_admin(auth.uid())
    and end_date < ((now() at time zone 'Asia/Kolkata')::date)
  );

-- The dashboard removes a completed card's private ID image before removing
-- the row. Storage objects do not participate in Postgres FK cascades.
drop policy if exists travel_documents_delete_admin on storage.objects;
create policy travel_documents_delete_admin
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'travel-documents'
    and public.is_admin(auth.uid())
  );

-- Historical risk-zone dates need access to records that have expired since
-- then. The client only renders a record when its selected timestamp falls in
-- its validity window; this policy merely makes the retained history readable.
drop policy if exists risk_zones_read_active on public.risk_zones;
drop policy if exists risk_zones_read_active_and_history on public.risk_zones;
create policy risk_zones_read_active_and_history
  on public.risk_zones for select
  to authenticated
  using (status = 'active' or expires_at is not null);
