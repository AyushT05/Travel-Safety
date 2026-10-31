-- The mobile outbox retries location writes after a network interruption and
-- uses `upsert(..., { onConflict: 'event_id' })`. PostgREST requires a real
-- UNIQUE constraint for that conflict target; a plain index is insufficient.
-- PostgreSQL UNIQUE allows multiple NULL values, so legacy location rows are
-- unaffected.

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_attribute a
      on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.conrelid = 'public.locations'::regclass
      and c.contype = 'u'
      and array_length(c.conkey, 1) = 1
      and a.attname = 'event_id'
  ) then
    -- An earlier migration may already have created an index called
    -- locations_event_id_key. Reuse it only if it is a full (non-partial)
    -- unique index; otherwise create a distinct constraint/index name.
    if exists (
      select 1
      from pg_class cls
      join pg_index idx on idx.indexrelid = cls.oid
      where cls.relname = 'locations_event_id_key'
        and idx.indrelid = 'public.locations'::regclass
        and idx.indisunique
        and idx.indpred is null
    ) then
      alter table public.locations
        add constraint locations_event_id_unique_constraint
        unique using index locations_event_id_key;
    else
      alter table public.locations
        add constraint locations_event_id_unique_constraint unique (event_id);
    end if;
  end if;
end $$;
