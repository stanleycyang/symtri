with snapshot_links as (
  select snapshot.day,
    coalesce(jsonb_object_agg(link.key, link.signals) filter (where link.key is not null), '{}'::jsonb) as relationships
  from public.signal_snapshots as snapshot
  left join lateral (
    with matches as (
      select distinct event.id, match.value->>'topicId' as topic_id
      from public.signal_events as event
      cross join lateral jsonb_array_elements(event.topics) as match(value)
      where event.published_at between snapshot.captured_at - interval '14 days'
        and snapshot.captured_at + interval '1 hour'
        and event.first_seen_at <= snapshot.captured_at + interval '10 minutes'
        and match.value ? 'topicId'
    )
    select first.topic_id || ':' || second.topic_id as key, count(*)::int as signals
    from matches as first join matches as second
      on first.id = second.id and first.topic_id < second.topic_id
    group by first.topic_id, second.topic_id
  ) as link on true
  where snapshot.feed->'relationships' is null
  group by snapshot.day
)
update public.signal_snapshots as snapshot
set feed = jsonb_set(snapshot.feed, '{relationships}', snapshot_links.relationships)
from snapshot_links
where snapshot.day = snapshot_links.day and snapshot.feed->'relationships' is null;
