-- Curated free sources complement automatic RSS discovery.
alter table public.source_catalog drop constraint if exists source_catalog_kind_check;
alter table public.source_catalog add constraint source_catalog_kind_check
  check (kind in ('hacker-news', 'github', 'arxiv', 'openalex', 'rss', 'api'));
insert into public.source_catalog (id, name, kind, status, promoted_at) values
  ('nasa', 'NASA', 'api', 'active', now()),
  ('nasa-jpl', 'NASA JPL', 'api', 'active', now()),
  ('cisa', 'CISA', 'api', 'active', now()),
  ('europe-pmc', 'Europe PMC', 'api', 'active', now()),
  ('hugging-face', 'Hugging Face', 'api', 'active', now())
on conflict (id) do nothing;

create table if not exists public.signal_evidence (
  source text not null references public.source_catalog(id),
  external_id text not null,
  signal_id text not null references public.signal_events(id) on delete cascade,
  body jsonb not null check (jsonb_typeof(body) = 'object'),
  content_hash text not null,
  retrieved_at timestamptz not null,
  primary key (source, external_id),
  foreign key (source, external_id) references public.signal_observations(source, external_id) on delete cascade
);
create index if not exists signal_evidence_signal_idx on public.signal_evidence(signal_id);
create index if not exists signal_evidence_search_idx on public.signal_evidence using gin(to_tsvector('english',body->>'text'));
alter table public.signal_evidence enable row level security;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.signal_evidence from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.signal_evidence from authenticated;
  end if;
end $$;
