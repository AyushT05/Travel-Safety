-- 20261030_schedule_purge_expired_travel_cards.sql
--
-- Runs the purge-expired-travel-cards edge function once a day (02:00 IST =
-- 20:30 UTC). Deploy the function first and set its CRON_SECRET secret.
--
-- Replace <PROJECT_REF> and <CRON_SECRET> below before running. (Alternative
-- with no SQL: Dashboard > Integrations > Cron > Create job > "Supabase Edge
-- Function", pick purge-expired-travel-cards, add the header
-- x-cron-secret: <CRON_SECRET>, schedule "30 20 * * *".)

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('purge-expired-travel-cards')
where exists (select 1 from cron.job where jobname = 'purge-expired-travel-cards');

select cron.schedule(
  'purge-expired-travel-cards',
  '30 20 * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/purge-expired-travel-cards',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body    := '{}'::jsonb
  );
  $$
);
