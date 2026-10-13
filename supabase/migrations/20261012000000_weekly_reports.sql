create table if not exists public.weekly_reports (
  week text primary key check (week ~ '^[0-9]{4}-[0-9]{2}$'),
  published_at timestamptz not null default now(),
  digest jsonb not null check (jsonb_typeof(digest) = 'object')
);
alter table public.weekly_reports enable row level security;
revoke all on public.weekly_reports from anon, authenticated;
