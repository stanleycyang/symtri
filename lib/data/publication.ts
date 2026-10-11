import type postgres from "postgres";
import { ENRICHMENT_VERSION } from "./reading-note-version";

// The identifier is chosen by server code, never by a request parameter.
export function readySignal(sql: ReturnType<typeof postgres>, id: "event.id" | "signal_events.id") {
  return sql`exists (select 1 from reading_notes as published_note
    join source_catalog as note_source on note_source.id = published_note.note->>'evidenceSource'
      and note_source.status = 'active'
    where published_note.signal_id = ${sql(id)}
      and published_note.status = 'ready' and published_note.version = ${ENRICHMENT_VERSION}
      and published_note.published_revision = published_note.revision
      and published_note.note is not null)`;
}
