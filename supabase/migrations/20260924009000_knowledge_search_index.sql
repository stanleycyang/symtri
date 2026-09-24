create index signal_events_search_idx on public.signal_events using gin (
  to_tsvector('english', title || ' ' || summary)
);
