create table signal_observations (
  source text not null check (source in ('hacker-news', 'github', 'arxiv')),
  external_id text not null,
  signal_id text not null references signal_events(id) on delete cascade,
  observed_url text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (source, external_id)
);

create index signal_observations_signal_id_idx on signal_observations (signal_id);

insert into signal_observations (source, external_id, signal_id, observed_url, first_seen_at, last_seen_at)
select source, external_id, id, url, first_seen_at, first_seen_at from signal_events;

alter table public.signal_observations enable row level security;
