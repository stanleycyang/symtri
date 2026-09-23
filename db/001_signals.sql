create table if not exists signal_events (
  id text primary key,
  source text not null check (source in ('hacker-news', 'github', 'arxiv')),
  external_id text not null,
  title text not null,
  url text not null,
  summary text not null,
  published_at timestamptz not null,
  importance double precision not null,
  topics jsonb not null default '[]'::jsonb,
  first_seen_at timestamptz not null default now(),
  unique (source, external_id)
);

create index if not exists signal_events_published_at_idx
  on signal_events (published_at desc);

create table if not exists signal_snapshots (
  day date primary key,
  captured_at timestamptz not null,
  feed jsonb not null
);
