alter table signal_events add column if not exists embedding_model text;

create index if not exists signal_events_embedding_hnsw_idx
  on signal_events using hnsw (embedding vector_cosine_ops)
  where embedding is not null;

create index if not exists signal_events_text_search_idx
  on signal_events using gin (to_tsvector('english', title || ' ' || summary));

create table if not exists ingestion_lease (
  name text primary key,
  run_id text not null,
  expires_at timestamptz not null
);

create table if not exists ingestion_runs (
  id text primary key,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null check (status in ('running', 'complete', 'partial', 'failed')),
  source_status jsonb not null default '{}'::jsonb,
  fetched_count integer not null default 0,
  mapped_count integer not null default 0,
  new_count integer not null default 0,
  embedded_count integer not null default 0,
  embedding_status text not null default 'pending',
  error text
);

create index if not exists ingestion_runs_started_at_idx on ingestion_runs (started_at desc);

alter table public.ingestion_lease enable row level security;
alter table public.ingestion_runs enable row level security;
