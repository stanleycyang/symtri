create table if not exists public.concept_catalog (
  id text primary key,
  name text not null,
  short text not null,
  parent_id text references public.concept_catalog(id),
  aliases text[] not null default '{}',
  position jsonb not null,
  color text not null,
  status text not null check (status in ('public', 'inactive', 'merged')),
  seeded boolean not null default false,
  promoted_at timestamptz not null default now(),
  inactive_at timestamptz,
  merged_into text references public.concept_catalog(id)
);
create index if not exists concept_catalog_parent_idx on public.concept_catalog(parent_id);

create table if not exists public.concept_candidates (
  id text primary key,
  name text not null,
  parent_id text references public.concept_catalog(id),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  evidence_count integer not null default 0,
  publisher_count integer not null default 0,
  active_days integer not null default 0,
  status text not null default 'candidate' check (status in ('candidate', 'promoted', 'rejected')),
  promoted_id text references public.concept_catalog(id)
);
create table if not exists public.concept_candidate_evidence (
  candidate_id text not null references public.concept_candidates(id) on delete cascade,
  signal_id text not null references public.signal_events(id) on delete cascade,
  publisher text not null,
  observed_day date not null,
  primary key (candidate_id, signal_id)
);
create index if not exists concept_candidate_evidence_signal_idx on public.concept_candidate_evidence(signal_id);

create table if not exists public.signal_concepts (
  signal_id text not null references public.signal_events(id) on delete cascade,
  concept_id text not null references public.concept_catalog(id),
  relevance double precision not null check (relevance >= 0 and relevance <= 1),
  assigned_at timestamptz not null default now(),
  primary key (signal_id, concept_id)
);
create index if not exists signal_concepts_concept_idx on public.signal_concepts(concept_id, assigned_at desc);

create table if not exists public.catalog_revisions (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  catalog jsonb not null
);
alter table public.signal_events add column if not exists catalog_revision bigint not null default 0;

create table if not exists public.source_catalog (
  id text primary key,
  name text not null,
  kind text not null check (kind in ('hacker-news', 'github', 'arxiv', 'openalex', 'rss')),
  feed_url text,
  status text not null check (status in ('active', 'trial', 'paused')),
  first_seen_at timestamptz not null default now(),
  promoted_at timestamptz,
  last_checked_at timestamptz,
  consecutive_failures integer not null default 0,
  successful_days integer not null default 0,
  unique_items integer not null default 0,
  last_success_day date
);
create table if not exists public.source_probes (
  domain text primary key,
  checked_at timestamptz not null default now(),
  result text not null
);
create table if not exists public.source_trial_items (
  source_id text not null references public.source_catalog(id) on delete cascade,
  external_id text not null,
  event jsonb not null,
  first_seen_at timestamptz not null default now(),
  primary key (source_id, external_id)
);
insert into public.source_catalog (id, name, kind, status, promoted_at) values
  ('hacker-news', 'Hacker News', 'hacker-news', 'active', now()),
  ('github', 'GitHub', 'github', 'active', now()),
  ('arxiv', 'arXiv', 'arxiv', 'active', now()),
  ('openalex', 'OpenAlex', 'openalex', 'active', now())
on conflict (id) do nothing;

alter table public.signal_events drop constraint if exists signal_events_source_check;
alter table public.signal_observations drop constraint if exists signal_observations_source_check;
alter table public.signal_events add constraint signal_events_source_catalog_fk foreign key (source) references public.source_catalog(id);
alter table public.signal_observations add constraint signal_observations_source_catalog_fk foreign key (source) references public.source_catalog(id);

alter table public.concept_catalog enable row level security;
alter table public.concept_candidates enable row level security;
alter table public.concept_candidate_evidence enable row level security;
alter table public.signal_concepts enable row level security;
alter table public.catalog_revisions enable row level security;
alter table public.source_catalog enable row level security;
alter table public.source_trial_items enable row level security;
alter table public.source_probes enable row level security;
