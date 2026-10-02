create table if not exists public.reading_notes (
  signal_id text primary key references public.signal_events(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','working','ready','failed')),
  input_hash text,
  revision integer not null default 0,
  claim_token text,
  version integer not null default 1,
  note jsonb,
  attempts integer not null default 0,
  retry_at timestamptz not null default now(),
  lease_until timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists reading_notes_queue_idx on public.reading_notes(status,retry_at);
create table if not exists public.background_context (
  key text primary key,
  body jsonb not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);
alter table public.reading_notes enable row level security;
alter table public.background_context enable row level security;
create or replace function public.symtri_queue_reading_note() returns trigger language plpgsql as $$
begin
  if TG_TABLE_NAME = 'signal_events' then
    if TG_OP = 'UPDATE' and old.title is not distinct from new.title and old.summary is not distinct from new.summary then return new; end if;
    insert into public.reading_notes(signal_id) values(new.id)
      on conflict(signal_id) do update set revision=reading_notes.revision+1,status='pending',note=null,attempts=0,retry_at=now(),lease_until=null,updated_at=now();
  else
    if TG_OP = 'UPDATE' and old.content_hash is not distinct from new.content_hash then return new; end if;
    insert into public.reading_notes(signal_id) values(new.signal_id)
      on conflict(signal_id) do update set revision=reading_notes.revision+1,status='pending',note=null,attempts=0,retry_at=now(),lease_until=null,updated_at=now();
    update public.signal_events set embedding=null,embedding_model=null,embedding_input_hash=null where id=new.signal_id;
  end if;
  if TG_TABLE_NAME = 'signal_events' and TG_OP = 'UPDATE' then
    update public.signal_events set embedding=null,embedding_model=null,embedding_input_hash=null where id=new.id;
  end if;
  return new;
end $$;
create trigger signal_reading_note after insert or update of title,summary on public.signal_events
  for each row execute function public.symtri_queue_reading_note();
create trigger evidence_reading_note after insert or update on public.signal_evidence
  for each row execute function public.symtri_queue_reading_note();

do $$ begin
  if exists(select 1 from pg_roles where rolname='anon') then revoke all on public.reading_notes,public.background_context from anon; end if;
  if exists(select 1 from pg_roles where rolname='authenticated') then revoke all on public.reading_notes,public.background_context from authenticated; end if;
end $$;
