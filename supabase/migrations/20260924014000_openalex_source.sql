alter table public.signal_events drop constraint if exists signal_events_source_check;
alter table public.signal_events add constraint signal_events_source_check
  check (source in ('hacker-news', 'github', 'arxiv', 'openalex'));

alter table public.signal_observations drop constraint if exists signal_observations_source_check;
alter table public.signal_observations add constraint signal_observations_source_check
  check (source in ('hacker-news', 'github', 'arxiv', 'openalex'));
