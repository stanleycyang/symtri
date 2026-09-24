-- A source can rediscover the same page under a different item ID. Keep one
-- canonical document while retaining its stable source ID for updates.
alter table signal_events add column canonical_url text generated always as (
  lower(regexp_replace(regexp_replace(split_part(split_part(url, '?', 1), '#', 1), '^https?://', ''), '/+$', ''))
) stored;

with duplicates as (
  select id, row_number() over (partition by canonical_url order by first_seen_at, importance desc, id) as position
  from signal_events
)
delete from signal_events as event using duplicates
where event.id = duplicates.id and duplicates.position > 1;

create unique index signal_events_canonical_url_key on signal_events (canonical_url);

alter table ingestion_runs drop constraint ingestion_runs_status_check;
alter table ingestion_runs add constraint ingestion_runs_status_check
  check (status in ('queued', 'running', 'complete', 'partial', 'failed'));
