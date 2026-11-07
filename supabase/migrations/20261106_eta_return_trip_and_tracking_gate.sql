-- 20261106_eta_return_trip_and_tracking_gate.sql   (safe to re-run)
--
-- 1. Transport mode, departure time and the stored time estimate on the travel card.
-- 2. Optional return trip: return_date, plus the timestamps the phone writes when a leg ends.
--    A card waiting for its return day has status = 'paused'. The dropout check and the incident
--    engine only look at status = 'active', so a paused card raises no "signal lost" alerts.
-- 3. Server-side "stop": fixes recorded AFTER the traveller pressed Stop, after tracking paused at
--    the destination, or after the trip completed are refused. This is what makes a stray watcher or
--    an old install unable to keep feeding the dashboard. Older fixes still upload (offline backlog).
-- 4. check_location_dropouts(): do not alert in the first 3 minutes after a return leg resumes.

alter table public.travel_cards
  add column if not exists transport_mode       text,
  add column if not exists departure_time       text,
  add column if not exists eta_plan             jsonb,
  add column if not exists return_date          date,
  add column if not exists outbound_arrived_at  timestamptz,
  add column if not exists completed_at         timestamptz,
  add column if not exists tracking_stopped_at  timestamptz,
  add column if not exists tracking_resumed_at  timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'travel_cards_transport_mode_check') then
    alter table public.travel_cards add constraint travel_cards_transport_mode_check
      check (transport_mode is null or transport_mode in ('car','bike','bus','train','flight','cycle','walk'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'travel_cards_departure_time_check') then
    alter table public.travel_cards add constraint travel_cards_departure_time_check
      check (departure_time is null or departure_time ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'travel_cards_return_date_check') then
    alter table public.travel_cards add constraint travel_cards_return_date_check
      check (return_date is null or (return_date > start_date and return_date <= end_date)) not valid;
  end if;
end $$;

-- ------------------------------------------------------------------ tracking gate
create or replace function public.locations_tracking_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  tc record;
  t  timestamptz;
begin
  if new.travel_card_id is null then return new; end if;
  select status, outbound_arrived_at, completed_at, tracking_stopped_at
    into tc from public.travel_cards where id = new.travel_card_id;
  if not found then return new; end if;            -- the foreign key reports a missing card

  t := least(coalesce(new.recorded_at, new.observed_at, now()), now());

  if tc.tracking_stopped_at is not null and t > tc.tracking_stopped_at + interval '30 seconds' then
    raise exception 'tracking_stopped' using errcode = '23514';
  end if;
  if tc.status = 'paused' and tc.outbound_arrived_at is not null
     and t > tc.outbound_arrived_at + interval '5 minutes' then
    raise exception 'tracking_paused' using errcode = '23514';
  end if;
  if tc.status = 'completed' and tc.completed_at is not null
     and t > tc.completed_at + interval '5 minutes' then
    raise exception 'tracking_completed' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists locations_tracking_gate on public.locations;
create trigger locations_tracking_gate           -- sorts after locations_apply_event_time, so recorded_at is set
  before insert on public.locations
  for each row execute function public.locations_tracking_gate();

-- ------------------------------------------------------------------ dropout check
create or replace function public.check_location_dropouts()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_resolved integer := 0;
  v_created integer := 0;
begin
  -- Close dropout incidents when fresh data resumes.
  with latest as (
    select distinct on (l.travel_card_id)
      l.travel_card_id, l.user_id, l.recorded_at
    from public.locations l
    where l.travel_card_id is not null
    order by l.travel_card_id, l.recorded_at desc, l.id desc
  ), resolved as (
    update public.alerts a
       set status = 'resolved'
      from latest l
      join public.travel_cards tc on tc.id = l.travel_card_id
     where a.type = 'dropout'
       and a.travel_card_id = l.travel_card_id
       and a.user_id = l.user_id
       and a.status in ('open', 'acknowledged')
       and (tc.status <> 'active' or tc.end_date < current_date
            or l.recorded_at >= now() - interval '3 minutes')
    returning a.id
  )
  select count(*) into v_resolved from resolved;

  -- Create an alert for active cards with an existing but stale last location.
  with latest as (
    select distinct on (l.travel_card_id)
      l.travel_card_id, l.user_id, l.lat, l.lon, l.recorded_at
    from public.locations l
    where l.travel_card_id is not null
    order by l.travel_card_id, l.recorded_at desc, l.id desc
  ), inserted as (
    insert into public.alerts (
      user_id, travel_card_id, type, severity, lat, lon, message, status
    )
    select
      tc.user_id,
      tc.id,
      'dropout',
      case when now() - latest.recorded_at > interval '10 minutes' then 'critical' else 'warning' end,
      latest.lat,
      latest.lon,
      format(
        'No location update for %s seconds. Last known location recorded at %s.',
        floor(extract(epoch from (now() - latest.recorded_at)))::bigint,
        latest.recorded_at
      ),
      'open'
    from public.travel_cards tc
    join latest on latest.travel_card_id = tc.id and latest.user_id = tc.user_id
    where tc.status = 'active'
      and tc.start_date <= current_date
      and tc.end_date >= current_date
      and latest.recorded_at < now() - interval '3 minutes'
      -- A return leg that was just resumed has no fresh fix for a few seconds; wait before alerting.
      and (tc.tracking_resumed_at is null or tc.tracking_resumed_at < now() - interval '3 minutes')
      and not exists (
        select 1 from public.alerts existing
        where existing.type = 'dropout'
          and existing.travel_card_id = tc.id
          and existing.user_id = tc.user_id
          and existing.status in ('open', 'acknowledged')
      )
    on conflict do nothing
    returning id
  )
  select count(*) into v_created from inserted;

  return jsonb_build_object('resolved', v_resolved, 'created', v_created, 'checked_at', now());
end;
$$;

revoke all on function public.check_location_dropouts() from public, anon, authenticated;
grant execute on function public.check_location_dropouts() to service_role;

-- ------------------------------------------------------------------ tracker view
-- People who track a traveller (non-admins) read this column-limited view. New columns are
-- appended at the END, which CREATE OR REPLACE VIEW allows.
create or replace view public.tracked_traveler_info as
select
  tc.user_id,
  tc.full_name,
  tc.start_date,
  tc.end_date,
  tc.places,
  tc.status,
  tc.transport_mode,
  tc.return_date,
  tc.eta_plan
from public.travel_cards tc
where
  tc.user_id = (select auth.uid())
  or public.is_admin((select auth.uid()))
  or exists (
    select 1 from public.tracking_requests r
    where r.requester_id = (select auth.uid())
      and r.traveler_id = tc.user_id
      and r.status = 'approved'
  );

grant select on public.tracked_traveler_info to authenticated;

notify pgrst, 'reload schema';
