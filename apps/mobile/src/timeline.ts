/**
 * Timelines — REQ-TL1/2/3.
 *
 * REQ-TL1: "A continuous voice/video recording is a time-indexed track to which
 * markers and media anchor."
 *
 * WHY THIS EXISTS AND WHY IT IS SEPARATE FROM CAPTURE:
 * a capture is a thing that happened. A timeline is the SHAPE of a walkthrough --
 * the spine that lets a report say "here is the kitchen, and here is the photo he
 * took while he was talking about it". Without it, a 20-minute walkthrough and 14
 * photos are 15 unrelated rows and a human has to remember which photo went with
 * which sentence. That remembering is exactly the work this product exists to
 * remove.
 *
 * THE MODEL, which is deliberately small:
 *   timeline        -- identity + the recording it belongs to
 *   timeline_marker -- APPEND-ONLY: (offset_ms, kind, media_ref)
 * Sections are DERIVED from section_break markers, never stored. A stored section
 * list can disagree with the markers it claims to summarise; the markers cannot
 * disagree with themselves. Same law as decisions and the ledger.
 *
 * REQ-TL3: "pausing then resuming forces a section break". Not a suggestion -- the
 * pause IS the structuring gesture. It is the only one that survives gloves, a
 * ladder and a loud room (mandate #3), because the contractor is already going to
 * pause when he walks between rooms. We are not teaching a gesture; we are reading
 * one he already makes.
 */
import { AbstractPowerSyncDatabase } from '@powersync/react-native';

export type MarkerKind =
  | 'user_mark'      // "this matters" -- one deliberate touch, REQ-TL3
  | 'section_break'  // pause/resume, REQ-TL3. Structure, not a gap.
  | 'photo_anchor'   // a photo taken while recording, REQ-TL2
  | 'auto_keyframe'; // extracted still, REQ-TL4

export const TIMELINE_DDL = [
  `CREATE TABLE IF NOT EXISTS timeline (
      id             TEXT NOT NULL PRIMARY KEY,
      project_id     TEXT NOT NULL,
      owner_id       TEXT NOT NULL,
      -- The capture holding the recording itself. Nullable while recording: the
      -- capture does not exist until the bytes are committed, and a marker dropped
      -- at 00:03 must not be lost waiting for a capture id that appears at 20:00.
      root_capture_id TEXT,
      started_at_ms  INTEGER NOT NULL,
      -- Filled at stop. Null means "still recording, or the app died mid-recording"
      -- -- and those are different, which is what ended_at_ms distinguishes.
      duration_ms    INTEGER,
      ended_at_ms    INTEGER
   ) STRICT`,

  // Append-only, like every other history in this codebase. A marker is a claim
  // about a moment that has already passed; there is nothing to correct later.
  `CREATE TABLE IF NOT EXISTS timeline_marker (
      id            TEXT NOT NULL PRIMARY KEY,
      timeline_id   TEXT NOT NULL REFERENCES timeline(id),
      -- Offset from the START OF THE RECORDING, not wall-clock. Wall-clock breaks
      -- the instant a recording is paused: the audio has no idea 6 minutes passed
      -- while he walked to the truck.
      offset_ms     INTEGER NOT NULL CHECK (offset_ms >= 0),
      kind          TEXT NOT NULL
                      CHECK (kind IN ('user_mark','section_break','photo_anchor','auto_keyframe')),
      media_ref     TEXT,
      created_at_ms INTEGER NOT NULL
   ) STRICT`,

  `CREATE TRIGGER IF NOT EXISTS timeline_marker_no_update
     BEFORE UPDATE ON timeline_marker
     BEGIN SELECT RAISE(ABORT, 'timeline markers are append-only'); END`,
  `CREATE TRIGGER IF NOT EXISTS timeline_marker_no_delete
     BEFORE DELETE ON timeline_marker
     BEGIN SELECT RAISE(ABORT, 'timeline markers are never destroyed'); END`,

  `CREATE INDEX IF NOT EXISTS timeline_marker_track
     ON timeline_marker (timeline_id, offset_ms)`,
];

export async function ensureTimelineSchema(db: AbstractPowerSyncDatabase) {
  for (const s of TIMELINE_DDL) await db.execute(s);
}

const id = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export async function startTimeline(
  db: AbstractPowerSyncDatabase, o: { projectId: string; ownerId: string }
): Promise<string> {
  const tlId = id('tl');
  await db.execute(
    `INSERT INTO timeline (id, project_id, owner_id, started_at_ms) VALUES (?,?,?,?)`,
    [tlId, o.projectId, o.ownerId, Date.now()]
  );
  return tlId;
}

/**
 * Drop a marker. `offsetMs` is RECORDED TIME, supplied by the caller from the
 * recorder's own clock -- never computed from Date.now() minus start, which would
 * silently include paused time and put every later marker in the wrong place.
 */
export async function mark(
  db: AbstractPowerSyncDatabase,
  o: { timelineId: string; offsetMs: number; kind: MarkerKind; mediaRef?: string }
): Promise<string> {
  const mId = id('mk');
  await db.execute(
    `INSERT INTO timeline_marker (id, timeline_id, offset_ms, kind, media_ref, created_at_ms)
     VALUES (?,?,?,?,?,?)`,
    [mId, o.timelineId, Math.max(0, Math.round(o.offsetMs)), o.kind, o.mediaRef ?? null, Date.now()]
  );
  return mId;
}

/**
 * REQ-TL3: pause/resume IS a section break. Called on RESUME, at the offset where
 * recording picks up, because that is where the new section starts -- not where
 * the old one stopped. A break recorded at the pause point would put the boundary
 * at the end of the previous room.
 */
export async function resumeWithSectionBreak(
  db: AbstractPowerSyncDatabase, timelineId: string, offsetMs: number
) {
  return mark(db, { timelineId, offsetMs, kind: 'section_break' });
}

/** REQ-TL2: a photo taken while recording is bound to its moment in the track. */
export async function anchorPhoto(
  db: AbstractPowerSyncDatabase, timelineId: string, offsetMs: number, captureId: string
) {
  return mark(db, { timelineId, offsetMs, kind: 'photo_anchor', mediaRef: captureId });
}

export async function stopTimeline(
  db: AbstractPowerSyncDatabase, timelineId: string,
  o: { durationMs: number; rootCaptureId?: string }
) {
  await db.execute(
    `UPDATE timeline SET duration_ms = ?, ended_at_ms = ?, root_capture_id = COALESCE(?, root_capture_id)
      WHERE id = ?`,
    [Math.max(0, Math.round(o.durationMs)), Date.now(), o.rootCaptureId ?? null, timelineId]
  );
}

export type Section = {
  index: number;
  startMs: number;
  endMs: number | null;
  markers: Array<{ kind: MarkerKind; offsetMs: number; mediaRef: string | null }>;
};

/**
 * Sections, DERIVED from section_break markers. Never stored.
 *
 * This is what §7.3's report compiles along: each section is a stretch of the
 * recording with the photos that were taken during it, so "images land at the
 * right moment" is arithmetic rather than a guess.
 */
export async function sections(
  db: AbstractPowerSyncDatabase, timelineId: string
): Promise<Section[]> {
  const tl = (await db.getAll<{ duration_ms: number | null }>(
    `SELECT duration_ms FROM timeline WHERE id = ?`, [timelineId]))[0];
  const markers = await db.getAll<{ kind: MarkerKind; offset_ms: number; media_ref: string | null }>(
    `SELECT kind, offset_ms, media_ref FROM timeline_marker
      WHERE timeline_id = ? ORDER BY offset_ms, created_at_ms`, [timelineId]);

  // Every recording has a first section starting at 0, whether or not anyone ever
  // paused. A walkthrough with no breaks is one section, not zero.
  const starts = [0, ...markers.filter((m) => m.kind === 'section_break').map((m) => m.offset_ms)];
  const uniq = [...new Set(starts)].sort((a, b) => a - b);

  return uniq.map((startMs, i) => {
    const endMs = i + 1 < uniq.length ? uniq[i + 1] : (tl?.duration_ms ?? null);
    return {
      index: i,
      startMs,
      endMs,
      // A marker belongs to the section it fell inside. section_break markers are
      // boundaries, not content -- listing them would put a "break" inside the
      // section it started.
      markers: markers
        .filter((m) => m.kind !== 'section_break')
        .filter((m) => m.offset_ms >= startMs && (endMs === null || m.offset_ms < endMs))
        .map((m) => ({ kind: m.kind, offsetMs: m.offset_ms, mediaRef: m.media_ref })),
    };
  });
}

/** mm:ss, for a human reading a report. */
export function timecode(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
