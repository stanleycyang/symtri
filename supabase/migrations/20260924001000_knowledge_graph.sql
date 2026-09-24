create table if not exists knowledge_graph (
  id text primary key check (id = 'current'),
  updated_at timestamptz not null,
  region_counts jsonb not null default '{}'::jsonb,
  relationships jsonb not null default '{}'::jsonb
);

alter table public.knowledge_graph enable row level security;
