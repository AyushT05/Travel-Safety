-- 20261101_safety_assessment_v2.sql
-- WHY: the server has been writing weather / network / infrastructure_evidence into safety_assessments,
-- but the table never had those columns. PostgREST rejected every upsert (PGRST204), the server swallowed
-- the error, and the dashboard kept showing the OLD row (the stale "isolated area" reading).
-- This adds the columns the new scoring engine writes. Safe to re-run.

alter table public.safety_assessments
  add column if not exists weather               jsonb,
  add column if not exists network               jsonb,
  add column if not exists infrastructure_evidence jsonb,
  add column if not exists time_context          jsonb,
  add column if not exists score_breakdown       jsonb,
  add column if not exists confidence            double precision,
  add column if not exists data_quality          text check (data_quality in ('good', 'partial', 'poor'));

-- isolation_score is now NULL when map data could not be checked (unknown), instead of a fake 0.0 / 0.5.
alter table public.safety_assessments alter column isolation_score drop not null;
alter table public.safety_assessments alter column isolation_score drop default;

-- The view used by tracked (non-admin) users must expose the new columns too.
create or replace view public.tracked_safety_info as
select
  sa.id, sa.user_id, sa.travel_card_id, sa.lat, sa.lon, sa.safety_status, sa.risk_score, sa.risk_factors,
  sa.nearest_police_km, sa.nearest_hospital_km, sa.nearest_fire_km, sa.isolation_score,
  sa.hazard_zones, sa.matched_unsafe_zones, sa.heading_warning, sa.assessed_at,
  sa.weather, sa.network, sa.infrastructure_evidence, sa.time_context, sa.score_breakdown, sa.confidence, sa.data_quality
from public.safety_assessments sa
where exists (
  select 1 from public.profiles p
  where p.id = auth.uid()
    and (p.role = 'admin' or sa.user_id = auth.uid()
         or (p.tracked_ids is not null and sa.user_id::text = any(p.tracked_ids)))
);
grant select on public.tracked_safety_info to authenticated, service_role;

-- One-off: drop the stale rows that were written by the old scorer so every traveller is re-assessed
-- with the new engine on the next 30-second app tick.
-- (Uncomment to run once.)
-- delete from public.safety_assessments where confidence is null;

notify pgrst, 'reload schema';
