-- Query values can identify distinct documents (for example HN item?id=...).
-- Strip only known tracking parameters, keeping the remaining parameters stable.
create function public.symtri_canonical_url(input_url text) returns text
language sql immutable parallel safe as $$
  with parts as (
    select split_part(input_url, '#', 1) as without_fragment
  ), query_parts as (
    select parameter
    from parts, regexp_split_to_table(
      case when strpos(without_fragment, '?') > 0
        then substr(without_fragment, strpos(without_fragment, '?') + 1) else '' end,
      '&'
    ) as parameter
    where parameter <> ''
      and split_part(parameter, '=', 1) <> ''
      and lower(split_part(parameter, '=', 1)) !~ '^(utm_|ref$|ref_src$|fbclid$|gclid$)'
  )
  select lower(regexp_replace(regexp_replace(split_part(without_fragment, '?', 1), '^https?://', '', 'i'), '/+$', ''))
    || coalesce((select '?' || string_agg(parameter, '&' order by parameter) from query_parts), '')
  from parts
$$;

drop index public.signal_events_canonical_url_key;
alter table public.signal_events drop column canonical_url;
alter table public.signal_events add column canonical_url text generated always as (public.symtri_canonical_url(url)) stored;
create unique index signal_events_canonical_url_key on public.signal_events (canonical_url);

-- Old URL-only matching could attach distinct HN self-post IDs to one event.
-- These observations have no trustworthy original content to disambiguate.
delete from public.signal_observations as observation
using public.signal_events as event
where observation.signal_id = event.id
  and observation.source = 'hacker-news'
  and observation.observed_url ~* '^https?://news\.ycombinator\.com/item\?id=[0-9]+'
  and event.source = 'hacker-news'
  and event.url ~* '^https?://news\.ycombinator\.com/item\?id=[0-9]+'
  and observation.external_id <> event.external_id;
