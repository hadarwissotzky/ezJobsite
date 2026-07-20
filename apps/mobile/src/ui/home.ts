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

  const byId = new Map(counts.map((x) => [x.pid, x]));
  const coverById = new Map(covers.map((x) => [x.pid, x.rel]));

  return projects.map((p) => ({
    ...p,
    captureCount: byId.get(p.id)?.n ?? 0,
    lastMs: byId.get(p.id)?.last_ms ?? p.last_used_ms ?? null,
    coverRelpath: coverById.get(p.id) ?? null,
  }));
}

/**
 * REQ-MAP1 — a STATIC map image URL for a job's location (no interactive map, no
 * native SDK; hadar 2026-07-17). Config-driven like CONFIRM_BASE: the provider +
 * key live in `EXPO_PUBLIC_STATIC_MAP_URL` as a template with `{lat}`/`{lng}`
 * placeholders, e.g. a Google Static Maps or Mapbox static URL ending in the key.
 * Returns null when unpinned or unconfigured, so the caller shows a placeholder and
 * the card never blocks (mandate #7 — online-fetch is opportunistic).
 */
export function staticMapUrl(lat: number | null, lng: number | null): string | null {
  const tmpl = process.env.EXPO_PUBLIC_STATIC_MAP_URL ?? '';
  if (!tmpl || lat == null || lng == null) return null;
  return tmpl.replace(/\{lat\}/g, String(lat)).replace(/\{lng\}/g, String(lng));
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
