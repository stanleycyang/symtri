alter table public.signal_events
  add column if not exists classification_input jsonb,
  add column if not exists classifier_version integer not null default 0;

create index if not exists signal_events_classifier_backlog_idx
  on public.signal_events (classifier_version, published_at desc)
  where classification_input is not null;

-- Hacker News classification uses exactly the stored title and summary.
-- Older GitHub tags and arXiv categories were not stored, so those rows wait
-- for a fresh source observation rather than being reclassified with lost context.
update public.signal_events
set classification_input = jsonb_build_object('title', title, 'summary', summary, 'categories', '[]'::jsonb)
where source = 'hacker-news' and classification_input is null;
