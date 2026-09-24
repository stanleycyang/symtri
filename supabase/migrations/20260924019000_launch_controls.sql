alter table public.source_catalog add column if not exists pause_reason text
  check (pause_reason in ('failures', 'trial-failures', 'capacity', 'manual'));
update public.source_catalog set pause_reason = 'manual'
  where status = 'paused' and pause_reason is null;
create index if not exists source_catalog_recovery_idx
  on public.source_catalog (last_checked_at, id)
  where kind = 'rss' and status = 'paused' and pause_reason = 'failures';

create table if not exists public.ask_request_buckets (
  scope text not null check (scope in ('visitor-hour', 'site-day')),
  identity_hash text not null,
  bucket_start timestamptz not null,
  requests integer not null check (requests > 0),
  primary key (scope, identity_hash, bucket_start)
);
create index if not exists ask_request_buckets_time_idx on public.ask_request_buckets (bucket_start);
alter table public.ask_request_buckets enable row level security;

create table if not exists public.production_health_checks (
  id bigint generated always as identity primary key,
  checked_at timestamptz not null default now(),
  status text not null check (status in ('healthy', 'degraded')),
  issues jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  run_started_at timestamptz
);
create index if not exists production_health_checks_time_idx on public.production_health_checks (checked_at desc);
alter table public.production_health_checks enable row level security;
