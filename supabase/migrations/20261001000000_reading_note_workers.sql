create table if not exists public.reading_note_workers (
  lane integer primary key check (lane >= 0 and lane < 16),
  run_id text not null,
  lease_until timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.reading_note_workers enable row level security;

do $$ begin
  if exists(select 1 from pg_roles where rolname='anon') then revoke all on public.reading_note_workers from anon; end if;
  if exists(select 1 from pg_roles where rolname='authenticated') then revoke all on public.reading_note_workers from authenticated; end if;
end $$;
