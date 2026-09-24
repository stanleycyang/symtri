alter table public.ingestion_runs
  add column if not exists activity jsonb not null default '{}'::jsonb;
