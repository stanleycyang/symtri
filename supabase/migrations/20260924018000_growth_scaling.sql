create table if not exists public.current_feed (
  id text primary key check (id = 'current'),
  feed jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.current_feed enable row level security;

create index if not exists signal_events_catalog_refresh_idx
  on public.signal_events (catalog_revision, first_seen_at, id);
create index if not exists signal_events_source_first_seen_idx
  on public.signal_events (source, first_seen_at desc);
create index if not exists signal_events_source_published_idx
  on public.signal_events (source, published_at desc, id desc);
create index if not exists signal_events_embedding_backlog_idx
  on public.signal_events (first_seen_at, id)
  where embedding is null or embedding_input_hash is null;
create index if not exists signal_events_topic_page_idx
  on public.signal_events (published_at desc, id desc)
  where jsonb_array_length(topics) > 0;
create index if not exists signal_observations_source_signal_idx
  on public.signal_observations (source, signal_id);

insert into public.signal_observations (source, external_id, signal_id, observed_url, first_seen_at, last_seen_at)
  select source, external_id, id, url, first_seen_at, first_seen_at
  from public.signal_events on conflict (source, external_id) do nothing;

create or replace function public.symtri_record_origin_observation() returns trigger language plpgsql as $$
begin
  insert into public.signal_observations (source, external_id, signal_id, observed_url)
    values (new.source, new.external_id, new.id, new.url)
    on conflict (source, external_id) do update set signal_id = excluded.signal_id,
      observed_url = excluded.observed_url, last_seen_at = now();
  return null;
end $$;
create trigger signal_origin_observation after insert on public.signal_events
  for each row execute function public.symtri_record_origin_observation();

alter table public.ingestion_runs add column if not exists archive_count integer;
alter table public.ingestion_runs add column if not exists child_counts jsonb not null default '{}'::jsonb;

create table if not exists public.knowledge_graph_days (
  day date primary key,
  region_counts jsonb not null default '{}'::jsonb,
  relationships jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists public.knowledge_graph_dirty_days (day date primary key);
alter table public.knowledge_graph_days enable row level security;
alter table public.knowledge_graph_dirty_days enable row level security;

create or replace function public.symtri_dirty_signal_day() returns trigger language plpgsql as $$
begin
  if tg_op <> 'INSERT' then
    insert into public.knowledge_graph_dirty_days(day) values ((old.published_at at time zone 'UTC')::date) on conflict do nothing;
  end if;
  if tg_op <> 'DELETE' then
    insert into public.knowledge_graph_dirty_days(day) values ((new.published_at at time zone 'UTC')::date) on conflict do nothing;
  end if;
  return null;
end $$;
create trigger signal_graph_dirty after insert or update of topics, published_at, source or delete
  on public.signal_events for each row execute function public.symtri_dirty_signal_day();

create or replace function public.symtri_dirty_observation_day() returns trigger language plpgsql as $$
begin
  if tg_op <> 'INSERT' then
    insert into public.knowledge_graph_dirty_days(day)
      select (published_at at time zone 'UTC')::date from public.signal_events where id = old.signal_id on conflict do nothing;
  end if;
  if tg_op <> 'DELETE' then
    insert into public.knowledge_graph_dirty_days(day)
      select (published_at at time zone 'UTC')::date from public.signal_events where id = new.signal_id on conflict do nothing;
  end if;
  return null;
end $$;
create trigger observation_graph_dirty after insert or update of source, signal_id or delete
  on public.signal_observations for each row execute function public.symtri_dirty_observation_day();

create or replace function public.symtri_dirty_source_days() returns trigger language plpgsql as $$
begin
  if old.status is distinct from new.status then
    insert into public.knowledge_graph_dirty_days(day)
      select distinct (event.published_at at time zone 'UTC')::date
      from public.signal_observations as observation
      join public.signal_events as event on event.id = observation.signal_id
      where observation.source = new.id on conflict do nothing;
  end if;
  return null;
end $$;
create trigger source_graph_dirty after update of status on public.source_catalog
  for each row execute function public.symtri_dirty_source_days();

insert into public.knowledge_graph_dirty_days(day)
  select distinct (published_at at time zone 'UTC')::date from public.signal_events on conflict do nothing;
