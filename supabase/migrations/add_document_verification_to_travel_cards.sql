-- add_document_verification_to_travel_cards.sql
--
-- Stores the result of the verify-document check (see
-- supabase/functions/verify-document/index.ts) so it's queryable later —
-- e.g. an admin dashboard could eventually flag cards where verification
-- came back "likely_invalid" for manual review, rather than the result
-- being checked once client-side and then thrown away.

alter table public.travel_cards
  add column if not exists document_verdict text,
  add column if not exists document_confidence numeric,
  add column if not exists document_reasoning text;
