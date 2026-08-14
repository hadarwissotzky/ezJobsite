/**
 * Project-card enrichment for the CompanyCam-style Projects home.
 *
 * The project list itself comes from listProjects(); this adds the three things a
 * visual project card needs and the base table does not carry: how many captures
 * are filed to it, when it last saw activity, and a COVER image (the newest photo).
 *
 * Every aggregate keys off the RESOLVED project — COALESCE(resolution override,
 * where it was captured) — the same identity the detail grid and the Inbox use, so
 * a capture filed out of the Inbox moves its count to the right card. Read-only:
 * no writes, no schema, safe to call on every refresh.
 */
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';
import type { Project } from '../projects';

export type ProjectCard = Project & {
  captureCount: number;
  lastMs: number | null;
  /** relpath of the newest photo, or null — the caller joins FS.documentDirectory. */
  coverRelpath: string | null;
};

export async function projectCards(
  db: AbstractPowerSyncDatabase,
  projects: Project[],
): Promise<ProjectCard[]> {
  const counts = await db.getAll<{ pid: string; n: number; last_ms: number | null }>(
    `SELECT COALESCE(r.project_id, c.project_id) AS pid,
            COUNT(*) AS n, MAX(c.committed_at_ms) AS last_ms
       FROM capture_commit c
       LEFT JOIN capture_resolution r ON r.capture_id = c.capture_id
      GROUP BY pid`);

  // Cover = the newest photo in the project. Pairing a bare column with
  // MAX(committed_at_ms) is SQLite's documented "pick the row that owns the
  // extreme" behaviour, so media_relpath comes from that newest row.
  const covers = await db.getAll<{ pid: string; rel: string }>(
    `SELECT COALESCE(r.project_id, c.project_id) AS pid,
            c.media_relpath AS rel, MAX(c.committed_at_ms)
       FROM capture_commit c
       LEFT JOIN capture_resolution r ON r.capture_id = c.capture_id
      WHERE c.media_mime_type LIKE 'image/%'
      GROUP BY pid`);

  // ── WHAT "LAST ACTIVITY" MEANS ────────────────────────────────────────────────
  //
  // hadar, 2026-08-12: "order jobs by last updated (or updated change orders inside
  // the job)". It used to mean captures only, falling back to `last_used_ms` — which
  // is a BROWSING stamp, written by touchProject when you merely OPEN a job. Two
  // things were wrong with that. A job whose change order the client approved an hour
  // ago showed "3d" and sat below jobs nothing had happened on, because approving is
  // not a capture. And scrolling through jobs quietly reordered the list, so the top
  // of the list drifted toward whatever you last looked at rather than what moved.
  //
  // Activity is now every event that changes what the job OWES someone:
  //   * a capture filed to it            (already counted above)
  //   * a change order created, sent, approved, declined or superseded
  //   * a message on one of its change orders, from either side
  //
  // Two queries, not one UNION, so a device mid-migration that has `change_order` but
  // not yet `thread_message` still gets the lifecycle half instead of losing both.
  const [coActs, msgActs] = await Promise.all([
    db.getAll<{ pid: string; ms: number }>(
      `SELECT project_id AS pid,
              MAX(MAX(created_at_ms,
                      COALESCE(sent_at_ms, 0),       COALESCE(approved_at_ms, 0),
                      COALESCE(declined_at_ms, 0),   COALESCE(superseded_at_ms, 0))) AS ms
         FROM change_order
        GROUP BY project_id`).catch(() => []),
    db.getAll<{ pid: string; ms: number }>(
      `SELECT c.project_id AS pid, MAX(m.at_ms) AS ms
         FROM thread_message m
         JOIN change_order c ON c.id = m.change_order_id
        GROUP BY c.project_id`).catch(() => []),
  ]);

  const byId = new Map(counts.map((x) => [x.pid, x]));
  const coverById = new Map(covers.map((x) => [x.pid, x.rel]));
  const actById = new Map<string, number>();
  for (const r of [...coActs, ...msgActs]) {
    actById.set(r.pid, Math.max(actById.get(r.pid) ?? 0, r.ms ?? 0));
  }

  const cards = projects.map((p) => ({
    ...p,
    captureCount: byId.get(p.id)?.n ?? 0,
    lastMs: Math.max(byId.get(p.id)?.last_ms ?? 0, actById.get(p.id) ?? 0) || null,
    coverRelpath: coverById.get(p.id) ?? null,
  }));

  // Newest activity first. A job nothing has happened to sorts as 0 and keeps the
  // order listProjects gave it — created/last-opened descending — so an empty job
  // created this morning still lands above an empty one from last year, and the
  // relative order of the quiet tail never jitters between refreshes. Array#sort is
  // stable (ES2019, and in Hermes), which is what makes that tie-break hold.
  return cards.sort((a, b) => (b.lastMs ?? 0) - (a.lastMs ?? 0));
}

/**
 * REQ-MAP1 — a STATIC map image URL for a job's location (no interactive map, no
 * native SDK; hadar 2026-07-17). Config-driven like CONFIRM_BASE: the provider +
 * key live in `EXPO_PUBLIC_STATIC_MAP_URL` as a template with `{lat}`/`{lng}`
 * placeholders, e.g. a Google Static Maps or Mapbox static URL ending in the key.
 * Returns null when unpinned or unconfigured, so the caller shows a placeholder and
 * the card never blocks (mandate #7 — online-fetch is opportunistic).
 */
// `staticMapUrl` lived here and is gone (2026-08-12). It built the URL and nothing
// more, so every caller pulled a fresh Static Maps image on every render — billed per
// request, and blank with no signal. src/mapcache.ts owns the URL and the disk cache
// together, because the two cannot be allowed to disagree about the key.

/**
 * Change-order counts per job, for the Jobs list (design, 2026-08-11).
 *
 * ONE QUERY FOR EVERY JOB. The list draws three numbers on every card; asking per
 * card would be N queries fired while a finger is already dragging the list, and the
 * counts would land at different moments so the cards would flicker into agreement.
 *
 * THE BUCKETS ARE THE LEDGER'S, NOT NEW ONES. `draft` is work the contractor still
 * owes, `sent` is out with the client, `approved` is settled — the same three the job
 * screen's stat cards and its filter pills use. A fourth state invented here would be
 * a fourth definition of "where does this job stand", and they would drift.
 *
 * DELIBERATELY NOT FOLDING "in discussion" INTO NEEDS-YOU, which the job screen does:
 * that needs the open-question count per extra, a second read this list does not make.
 * A discussing extra therefore counts as waiting here and as needs-you one screen in.
 * Stated rather than hidden — it is the one place the two disagree.
 */
export type JobCoCounts = { needs: number; waiting: number; approved: number };

export async function projectCoCounts(
  db: AbstractPowerSyncDatabase,
): Promise<Record<string, JobCoCounts>> {
  const rows = await db.getAll<{ pid: string; status: string; n: number }>(
    `SELECT project_id AS pid, status, COUNT(*) AS n
       FROM change_order
      GROUP BY project_id, status`).catch(() => []);
  const out: Record<string, JobCoCounts> = {};
  for (const r of rows) {
    const c = out[r.pid] ?? (out[r.pid] = { needs: 0, waiting: 0, approved: 0 });
    if (r.status === 'approved') c.approved += r.n;
    else if (r.status === 'draft') c.needs += r.n;
    else if (r.status === 'sent') c.waiting += r.n;
  }
  return out;
}

/** "just now" / "3h" / "2d" — terse, for a card corner. Pure; caller passes now. */
export function ago(ms: number | null, nowMs: number): string {
  if (!ms) return '';
  const d = Math.max(0, nowMs - ms);
  const min = Math.floor(d / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}
