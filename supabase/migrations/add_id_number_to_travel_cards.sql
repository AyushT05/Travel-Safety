-- Stores the typed ID number and whether the AI extraction from the uploaded
-- document matched it (null = not compared, e.g. nothing legible or no check
-- ran). Additive and safe on a live table.
alter table public.travel_cards
  add column if not exists id_number text,
  add column if not exists document_id_number_match boolean;
