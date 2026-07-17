/**
 * Projects and resolution — REQ-SET1, REQ-P1/P2, REQ-PROC7, REQ-EVID2.
 * This is MANDATE #8, which was entirely unbuilt:
 *
 *   "Project resolution is a layer, not a chore. Captures auto-assign to the right
 *    project (GPS/context) with zero manual filing; a secondary workflow handles
 *    ambiguity/no-match, and an unresolved capture is held durably, never lost."
 *
 * Until now PROJECT_ID was a hardcoded constant. Every capture, decision and
 * change order in this app was filed to `proj-bakeoff-1` because that string was
 * typed into App.tsx. The whole product rests on "the tool does the filing" -- and
 * the filing did not exist.
 *
 * THE RULES:
 *
 * 1. RESOLUTION NEVER BLOCKS A CAPTURE. Mandate #1. GPS may be absent, every job
 *    may be 40 miles away, the phone may be in a basement. A capture that cannot
 *    be filed is still SAVED -- it goes to the Inbox and waits for a human. What we
 *    must never do is stop a man mid-sentence to ask which job he is on.
 *
 * 2. AN UNRESOLVED CAPTURE IS HELD, NEVER GUESSED. REQ-P2: "never lost, never
 *    silently mis-filed". A wrong auto-file is WORSE than an unresolved one,
 *    because nobody goes looking for a capture they were told was handled. So a
 *    weak signal parks it; it does not lower the bar.
 *
 * 3. THE INBOX IS A REAL PROJECT ROW, not null. capture_commit.project_id is NOT
 *    NULL by design (a capture always has a home). The Inbox gives an unresolved
 *    capture a durable home that shows up in a queue, rather than needing a
 *    nullable column that every later query would have to remember to handle.
 */
import { AbstractPowerSyncDatabase } from '@powersync/react-native';
import { sha256 } from 'js-sha256';

/**
 * NO app-owned project table and NO project outbox.
 *
 * The first cut built both, by pattern-matching the capture path. That was wrong,
 * and it failed loudly: `CREATE TABLE IF NOT EXISTS project` SILENTLY DID NOTHING
 * because PowerSync already defines a `project` table, so every insert went at
 * PowerSync's columns and died on "table project has no column named geofence_m".
 *
 * The lesson is not "rename the table". Captures need an owned queue because they
 * are append-only EVIDENCE whose commitment only SQLite can know (ADR / the
 * durability architecture). A project is a mutable relational row -- a name and an
 * address. That is precisely what PowerSync is for, and it already syncs it both
 * ways. Writing an outbox for it would be a second sync engine running beside the
 * one we adopted, with its own bugs.
 *
 * So: projects are declared in AppSchema.ts and sync themselves.
 */

/**
 * The Inbox is a SENTINEL, not a row.
 *
 * capture_commit.project_id is NOT NULL (a capture always has a home) but carries
 * no foreign key, so an unresolved capture can be filed to this id without a
 * project existing. That keeps a device-local holding pen OUT of the synced
 * project list -- an "Inbox" job appearing on the office iPad would be noise, and
 * it is not a job anyone works on.
 */
export const INBOX_ID = 'inbox';

export async function ensureProjectSchema(_db: AbstractPowerSyncDatabase, _ownerId: string) {
  // Nothing to create: AppSchema owns the project table. Kept as a named no-op so
  // the call site reads the same as every other schema and nobody re-adds a
  // CREATE TABLE that would silently do nothing again.
}

export type Project = {
  id: string; name: string; address: string | null;
  lat: number | null; lng: number | null; geofence_m: number;
  client_ref: string | null; status: string; last_used_ms: number | null;
};

/**
 * REQ-EVID2: "findable by job and recency ... in ≤2 actions."
 * Most-recently-used first, because the job you touched last is the one you want.
 */
export async function listProjects(db: AbstractPowerSyncDatabase): Promise<Project[]> {
  return db.getAll<Project>(
    `SELECT id, name, address, lat, lng,
            COALESCE(geofence_m, 150) AS geofence_m,
            client_ref, COALESCE(status,'active') AS status, last_used_ms
       FROM project
      WHERE COALESCE(status,'active') = 'active'
      ORDER BY COALESCE(last_used_ms, created_at_ms, 0) DESC`
  );
}

/**
 * REQ-SET1 + REQ-PROC7: "a project can be created ... with no signal".
 * Local write + queued copy, the same shape as every other write here.
 */
export async function createProject(
  db: AbstractPowerSyncDatabase,
  o: { ownerId: string; name: string; address?: string | null;
       lat?: number | null; lng?: number | null; clientRef?: string | null }
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const name = o.name.trim();
  if (!name) return { ok: false, reason: 'A job needs a name' };

  const now = Date.now();
  const id = `prj-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  try {
    // REQ-PROC7: works with no signal. The row lands locally now; PowerSync's
    // ps_crud carries it up whenever there is a connection. No outbox of ours.
    await db.execute(
      `INSERT INTO project (id, owner_id, name, address, lat, lng, geofence_m,
         client_ref, status, created_at_ms, last_used_ms)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [id, o.ownerId, name, o.address ?? null, o.lat ?? null, o.lng ?? null, 150,
       o.clientRef ?? null, 'active', now, now]
    );
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? String(e) };
  }
  return { ok: true, id };
}

export async function touchProject(db: AbstractPowerSyncDatabase, projectId: string) {
  await db.execute(`UPDATE project SET last_used_ms = ? WHERE id = ?`, [Date.now(), projectId]);
}

/** Metres between two fixes. Haversine — good to a few metres at jobsite range. */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export type Resolution = {
  projectId: string;
  method: 'gps_auto' | 'last_used' | 'only_project' | 'unresolved';
  confidence: 'high' | 'low' | 'none';
  /** Why, in words. REQ-PROC6: a state the user can act on, not a code. */
  why: string;
  candidates?: Array<{ id: string; name: string; distanceM: number }>;
};

/**
 * REQ-P1/P2 + mandate #8. Decide where a capture belongs, WITHOUT asking.
 *
 * The order matters and encodes what is actually trustworthy:
 *   1. INSIDE exactly one geofence -> that is the job. High confidence.
 *   2. Inside SEVERAL -> ambiguous. Adjacent units, a duplex, two jobs on one
 *      street. We do NOT pick the nearest: a 3-metre difference between two
 *      jobsites is noise, not a signal, and a confident wrong answer is the one
 *      failure nobody goes looking for.
 *   3. No GPS but only ONE job -> it is that one. Not clever, just true.
 *   4. No GPS, several jobs, one used in the last 12 hours -> that one, LOW
 *      confidence. He is probably still where he was this morning.
 *   5. Otherwise -> Inbox. Held, never guessed.
 */
export async function resolveProject(
  db: AbstractPowerSyncDatabase, fix: { lat: number; lng: number } | null
): Promise<Resolution> {
  const all = (await listProjects(db)).filter((p) => p.id !== INBOX_ID);

  if (!all.length) {
    return { projectId: INBOX_ID, method: 'unresolved', confidence: 'none',
             why: 'No jobs yet — saved to your Inbox' };
  }

  if (fix) {
    const inside = all
      .filter((p) => p.lat != null && p.lng != null)
      .map((p) => ({ p, d: distanceM(fix, { lat: p.lat!, lng: p.lng! }) }))
      .filter(({ p, d }) => d <= p.geofence_m)
      .sort((a, b) => a.d - b.d);

    if (inside.length === 1) {
      return { projectId: inside[0].p.id, method: 'gps_auto', confidence: 'high',
               why: `You're at ${inside[0].p.name}` };
    }
    if (inside.length > 1) {
      // Ambiguity is REPORTED, never resolved by picking the nearest.
      return {
        projectId: INBOX_ID, method: 'unresolved', confidence: 'none',
        why: `You're near ${inside.length} jobs — tap to say which`,
        candidates: inside.map(({ p, d }) => ({ id: p.id, name: p.name, distanceM: Math.round(d) })),
      };
    }
    // A fix, but nothing near it. Do NOT fall back to last-used: the GPS actively
    // says he is somewhere else, and that is evidence against the guess, not
    // an absence of evidence.
    const nearest = all
      .filter((p) => p.lat != null && p.lng != null)
      .map((p) => ({ p, d: distanceM(fix, { lat: p.lat!, lng: p.lng! }) }))
      .sort((a, b) => a.d - b.d)[0];
    return {
      projectId: INBOX_ID, method: 'unresolved', confidence: 'none',
      why: nearest
        ? `Not at any job — nearest is ${nearest.p.name}, ${Math.round(nearest.d / 100) / 10} km away`
        : 'No job has a location yet — saved to your Inbox',
      candidates: nearest ? [{ id: nearest.p.id, name: nearest.p.name, distanceM: Math.round(nearest.d) }] : [],
    };
  }

  // No fix from here down.
  if (all.length === 1) {
    return { projectId: all[0].id, method: 'only_project', confidence: 'high',
             why: `Saved to ${all[0].name} — your only job` };
  }
  const recent = all.find((p) => p.last_used_ms && Date.now() - p.last_used_ms < 12 * 3600_000);
  if (recent) {
    return { projectId: recent.id, method: 'last_used', confidence: 'low',
             why: `No location — saved to ${recent.name} (the job you were just on)` };
  }
  return { projectId: INBOX_ID, method: 'unresolved', confidence: 'none',
           why: 'No location — saved to your Inbox, tap to file it' };
}

/** REQ-P2: the queue. Never lost, resolvable in one action. */
export async function inboxCount(db: AbstractPowerSyncDatabase): Promise<number> {
  const r = (await db.getAll<{ n: number }>(
    `SELECT count(*) AS n FROM capture_commit WHERE project_id = ?`, [INBOX_ID]))[0];
  return r?.n ?? 0;
}

/**
 * File an unresolved capture. REQ-P2: "resolves in ≤1 action".
 *
 * capture_commit is APPEND-ONLY, so this cannot UPDATE the capture's project.
 * That is not an obstacle to work around -- it is the point. The original filing
 * is a fact about what the device believed at capture time, and it stays. The
 * correction is recorded ALONGSIDE it, and readers resolve through the override.
 */
export const RESOLUTION_DDL = [
  `CREATE TABLE IF NOT EXISTS capture_resolution (
      capture_id    TEXT NOT NULL PRIMARY KEY,
      project_id    TEXT NOT NULL,
      method        TEXT NOT NULL CHECK (method IN ('override','secondary')),
      resolved_at_ms INTEGER NOT NULL,
      resolved_by   TEXT
   ) STRICT`,
];

export async function ensureResolutionSchema(db: AbstractPowerSyncDatabase) {
  for (const s of RESOLUTION_DDL) await db.execute(s);
}

export async function fileCapture(
  db: AbstractPowerSyncDatabase,
  o: { captureId: string; projectId: string; by: string }
) {
  await db.execute(
    `INSERT INTO capture_resolution (capture_id, project_id, method, resolved_at_ms, resolved_by)
     VALUES (?,?, 'override', ?, ?)
     ON CONFLICT(capture_id) DO UPDATE SET
       project_id = excluded.project_id, resolved_at_ms = excluded.resolved_at_ms`,
    [o.captureId, o.projectId, Date.now(), o.by]
  );
  await touchProject(db, o.projectId);
}

/** Where a capture actually belongs: the override if a human filed it, else the original. */
export async function effectiveProject(
  db: AbstractPowerSyncDatabase, captureId: string
): Promise<string | null> {
  const r = (await db.getAll<{ project_id: string }>(
    `SELECT COALESCE(r.project_id, c.project_id) AS project_id
       FROM capture_commit c
       LEFT JOIN capture_resolution r ON r.capture_id = c.capture_id
      WHERE c.capture_id = ?`, [captureId]))[0];
  return r?.project_id ?? null;
}

