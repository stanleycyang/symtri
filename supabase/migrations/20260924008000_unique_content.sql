-- Keep one document for identical normalized title and summary, even when
-- sources point to different URLs. Preserve each source observation.
alter table public.signal_events add column content_key text generated always as (
  md5(lower(regexp_replace(btrim(title) || E'\n' || btrim(summary), '[[:space:]]+', ' ', 'g')))
) stored;

with ranked as (
  select id, first_value(id) over (
    partition by content_key order by first_seen_at, importance desc, id
  ) as keeper
  from public.signal_events
)
update public.signal_observations as observation set signal_id = ranked.keeper
from ranked where observation.signal_id = ranked.id and ranked.id <> ranked.keeper;

with duplicates as (
  select id, row_number() over (
    partition by content_key order by first_seen_at, importance desc, id
  ) as position
  from public.signal_events
)
delete from public.signal_events as event using duplicates
where event.id = duplicates.id and duplicates.position > 1;

create unique index signal_events_content_key_key on public.signal_events (content_key);
