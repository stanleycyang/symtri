-- CLI migration creation was attempted first, but the installed binary is
-- SIGKILLed by this execution environment. Apply only after isolated DB review.
alter table public.reading_notes
  add column blocked boolean not null default false,
  add column cached_note jsonb,
  add column cached_hash text,
  add column published_revision integer,
  add column published_at timestamptz,
  add column queued_at timestamptz not null default now(),
  add column publication_version bigint,
  add column generation_count integer not null default 0,
  add column reuse_count integer not null default 0;
alter table public.reading_note_workers add column started boolean not null default true;
create sequence public.reading_note_publication_version;
revoke all on sequence public.reading_note_publication_version from public;

create or replace function public.symtri_publish_reading_note() returns trigger
language plpgsql set search_path=public as $$
begin
  if new.status='ready' and new.note is not null then
    new.published_revision:=new.revision;
    new.published_at:=case when old.status='ready' and old.published_revision=new.revision then coalesce(old.published_at,now()) else now() end;
    new.cached_note:=new.note;
    new.cached_hash:=new.input_hash;
  else
    new.published_revision:=null;
  end if;
  if (old.status='ready' or new.status='ready') and
    (old.status,old.version,old.revision,old.note) is distinct from
    (new.status,new.version,new.revision,new.note) then
    new.publication_version:=nextval('public.reading_note_publication_version');
  end if;
  return new;
end $$;
create trigger reading_note_publication before update on public.reading_notes
for each row execute function public.symtri_publish_reading_note();
update public.reading_notes set cached_note=note,cached_hash=input_hash,
  published_revision=revision,published_at=updated_at,queued_at=updated_at,
  publication_version=nextval('public.reading_note_publication_version')
where status='ready' and note is not null;
create index reading_notes_ready_idx on public.reading_notes(signal_id,version)
where status='ready' and note is not null;

create or replace function public.symtri_queue_reading_note() returns trigger
language plpgsql set search_path=public as $$
declare owner_source text; owner_length integer;
begin
  if TG_TABLE_NAME='signal_events' then
    if TG_OP='UPDATE' and
      regexp_replace(btrim(old.title),'[[:space:]]+',' ','g')=regexp_replace(btrim(new.title),'[[:space:]]+',' ','g') and
      regexp_replace(btrim(old.summary),'[[:space:]]+',' ','g')=regexp_replace(btrim(new.summary),'[[:space:]]+',' ','g') and old.published_at is not distinct from new.published_at then return new; end if;
    insert into public.reading_notes(signal_id) values(new.id)
      on conflict(signal_id) do update set revision=reading_notes.revision+1,status='pending',note=null,
        input_hash=null,blocked=false,failure_code=null,attempts=0,queued_at=now(),retry_at=now(),lease_until=null,updated_at=now();
  else
    if TG_OP='UPDATE' and old.content_hash is not distinct from new.content_hash then return new; end if;
    -- A shorter mirror cannot change the selected evidence of a published note.
    select note.note->>'evidenceSource',length(evidence.body->>'text') into owner_source,owner_length
      from public.reading_notes note join public.signal_evidence evidence
        on evidence.signal_id=note.signal_id and evidence.source=note.note->>'evidenceSource'
      join public.source_catalog source on source.id=evidence.source and source.status='active'
      where note.signal_id=new.signal_id and note.status='ready';
    if owner_source is not null and owner_source<>new.source and
       (owner_length>length(new.body->>'text') or (owner_length=length(new.body->>'text') and owner_source<new.source)) then return new; end if;
    insert into public.reading_notes(signal_id) values(new.signal_id)
      on conflict(signal_id) do update set revision=reading_notes.revision+1,status='pending',note=null,
        input_hash=null,blocked=false,failure_code=null,attempts=0,queued_at=now(),retry_at=now(),lease_until=null,updated_at=now();
    update public.signal_events set embedding=null,embedding_model=null,embedding_input_hash=null where id=new.signal_id;
  end if;
  if TG_TABLE_NAME='signal_events' and TG_OP='UPDATE' then
    update public.signal_events set embedding=null,embedding_model=null,embedding_input_hash=null where id=new.id;
  end if;
  return new;
end $$;

-- Publication dates participate in the model prompt, especially model-card
-- updates. Invalidate a note when that meaningful input changes too.
drop trigger signal_reading_note on public.signal_events;
create trigger signal_reading_note after insert or update of title,summary,published_at
on public.signal_events for each row execute function public.symtri_queue_reading_note();
