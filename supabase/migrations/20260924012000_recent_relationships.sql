alter table public.knowledge_graph
  add column if not exists recent_relationships jsonb;

with matches as (
  select distinct event.id, match.value->>'topicId' as topic_id
  from public.signal_events as event
  cross join lateral jsonb_array_elements(event.topics) as match(value)
  where event.published_at between now() - interval '14 days' and now() + interval '1 hour'
    and match.value ? 'topicId'
), links as (
  select first.topic_id || ':' || second.topic_id as link, count(*)::int as signals
  from matches as first join matches as second
    on first.id = second.id and first.topic_id < second.topic_id
  group by first.topic_id, second.topic_id
)
update public.knowledge_graph
set recent_relationships = coalesce((select jsonb_object_agg(link, signals) from links), '{}'::jsonb)
where id = 'current' and recent_relationships is null;
