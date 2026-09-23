create extension if not exists vector;

alter table signal_events
  add column if not exists embedding vector(256),
  add column if not exists embedding_input_hash text;

create table if not exists topic_embeddings (
  topic_id text primary key,
  embedding vector(256) not null,
  embedding_input_hash text not null,
  updated_at timestamptz not null default now()
);
