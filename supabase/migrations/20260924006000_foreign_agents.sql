update signal_events
set topics = (
  select jsonb_agg(
    case when match->>'topicId' = 'ai' and match->>'subtopicId' = 'ai-agents'
      then jsonb_set(match, '{subtopicId}', 'null'::jsonb)
      else match end
    order by position
  )
  from jsonb_array_elements(signal_events.topics) with ordinality as item(match, position)
)
where lower(title) ~ 'foreign agents?([^a-z]|$)'
  and topics @> '[{"topicId":"ai","subtopicId":"ai-agents"}]'::jsonb;
