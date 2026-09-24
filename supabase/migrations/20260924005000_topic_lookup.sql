create index if not exists signal_events_topics_gin_idx
  on signal_events using gin (topics jsonb_path_ops);
