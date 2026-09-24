-- Cover signals written by an older deployment during the schema rollout.
insert into signal_observations (source, external_id, signal_id, observed_url, first_seen_at, last_seen_at)
select source, external_id, id, url, first_seen_at, first_seen_at
from signal_events
on conflict (source, external_id) do nothing;
