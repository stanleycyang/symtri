create index if not exists signal_events_source_preview_idx
  on public.signal_events (source, published_at desc, first_seen_at desc)
  where jsonb_array_length(topics) > 0;
