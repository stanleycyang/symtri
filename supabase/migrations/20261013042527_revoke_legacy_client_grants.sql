-- SYMTRI's public schema is accessed through server routes, never directly by
-- anonymous or authenticated Data API clients. RLS does not protect TRUNCATE.
revoke all privileges on all tables in schema public from anon, authenticated;
revoke all privileges on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all privileges on tables from anon, authenticated;
alter default privileges in schema public revoke all privileges on sequences from anon, authenticated;

-- Trigger helpers resolve only the application's schema and built-ins.
alter function public.symtri_canonical_url(text) set search_path = pg_catalog, public;
alter function public.symtri_record_origin_observation() set search_path = pg_catalog, public;
alter function public.symtri_dirty_signal_day() set search_path = pg_catalog, public;
alter function public.symtri_dirty_observation_day() set search_path = pg_catalog, public;
alter function public.symtri_dirty_source_days() set search_path = pg_catalog, public;
