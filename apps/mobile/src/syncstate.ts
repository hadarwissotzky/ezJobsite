/**
 * WHAT THE PHONE ACTUALLY HOLDS, in one line a person can read out loud.
 *
 * hadar, 2026-08-30: "Just created a job and saved it — it still displays no jobs
 * created." The row was on the server within seconds; his phone showed nothing. It
 * took a database session, the replication publication and the company_member table
 * to establish that the write had worked and the read-back had not — none of which he
 * could see, and none of which the app could tell him.
 *
 * THAT IS THE THIRD TIME IN ONE DAY the answer has been "the server is fine, the
 * device's view of it is not": once for an OTA that had not applied, once for jobs
 * belonging to the other identity, and now this. Each cost several rounds of guessing
 * because the app reports nothing about its own sync.
 *
 * So this exists to end that class of question, not this instance of it. It reads
 * PowerSync's own status plus a local row count and says both plainly. It is a
 * DIAGNOSTIC, not a feature: no retry button, no spinner, no reassurance. It answers
 * "is my phone connected, when did it last hear from the server, and how many rows
 * does it actually have" — the three facts that separate a sync problem from a query
 * problem from a stale-app problem.
 */
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';

export type SyncState = {
  connected: boolean;
  /** Has this install EVER completed a sync? Distinct from `connected`. */
  everSynced: boolean;
  lastSyncedAtMs: number | null;
  /** Rows the DEVICE holds, not the server. The number the job list reads. */
  projects: number;
  /** Local writes still waiting to go up, across every owned outbox. */
  queued: number;
  /**
   * Rows that have FAILED AT LEAST TWICE and are sitting on a backoff.
   *
   * This is the closest thing to "weak signal" that an app can honestly report. iOS
   * does not expose signal strength — RSSI is a private API and using it gets an app
   * rejected — so the only truthful measure of a bad connection is whether our own
   * uploads are getting through. A row on its third attempt IS a bad connection,
   * described by its consequence instead of by a number of bars.
   */
  struggling: number;
  /**
   * PENDING POWERSYNC UPLOADS (ps_crud), counted separately from the owned outboxes
   * (2026-09-04). This is the number that explains a phone that stops receiving:
   * PowerSync applies no downloaded checkpoint while this queue is non-empty, so a
   * wedged entry here silently freezes every download — which is exactly how
   * `company.plan = 'core'` sat undelivered on hadar's phone while PowerSync itself
   * was verified serving it. The connector now parks a transaction after five failed
   * attempts; this count is how anyone SEES the state before and after.
   */
  psPending: number;
};

/**
 * NEVER THROWS. A diagnostic that can fail is a diagnostic you cannot trust when
 * things are already wrong — which is the only time anybody opens it.
 */
export async function syncState(db: AbstractPowerSyncDatabase): Promise<SyncState> {
  const s: any = (db as any).currentStatus ?? {};
  let projects = 0;
  try {
    const r = await db.getAll<{ n: number }>(`SELECT COUNT(*) AS n FROM project`);
    projects = r[0]?.n ?? 0;
  } catch { /* table not there yet — zero is the honest answer */ }

  // The same eleven outboxes `ota.ts` gates a restart on. Imported rather than
  // re-listed: two copies of this list is how one of them gets forgotten.
  let psPending = 0;
  try {
    const r = await db.getAll<{ n: number }>(`SELECT COUNT(*) AS n FROM ps_crud`);
    psPending = r[0]?.n ?? 0;
  } catch { /* no ps_crud in this build — zero is honest */ }

  let queued = 0;
  let struggling = 0;
  try {
    const { OUTBOX_TABLES } = await import('./ota.ts');
    for (const t of OUTBOX_TABLES) {
      try {
        const r = await db.getAll<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`);
        queued += r[0]?.n ?? 0;
      } catch { /* table absent in this version */ }
      try {
        // >= 2 attempts, not >= 1: one failure is a dropped packet and every queue
        // has them. Two is a pattern, and a pattern is what a person should be told
        // about. Guarded because not every outbox carries the column.
        const r = await db.getAll<{ n: number }>(
          `SELECT COUNT(*) AS n FROM ${t} WHERE attempt_count >= 2`);
        struggling += r[0]?.n ?? 0;
      } catch { /* no attempt_count in this outbox */ }
    }
  } catch { /* leave them at zero rather than guess */ }

  const last = s.lastSyncedAt instanceof Date ? s.lastSyncedAt.getTime() : null;
  return {
    connected: s.connected === true,
    everSynced: s.hasSynced === true,
    lastSyncedAtMs: last,
    projects,
    queued,
    struggling, psPending,
  };
}

/** "Synced 2 min ago · 8 jobs on this phone" — or the honest bad news. */
export function syncLine(s: SyncState, nowMs: number): string {
  if (!s.everSynced) {
    return s.connected ? 'Connected — first sync has not finished'
                       : 'Never synced on this phone';
  }
  const ago = s.lastSyncedAtMs == null ? null : Math.max(0, nowMs - s.lastSyncedAtMs);
  const when = ago == null ? 'at an unknown time'
    : ago < 60_000 ? 'just now'
    : ago < 3_600_000 ? `${Math.floor(ago / 60_000)} min ago`
    : ago < 86_400_000 ? `${Math.floor(ago / 3_600_000)} h ago`
    : `${Math.floor(ago / 86_400_000)} d ago`;
  const head = s.connected ? `Synced ${when}` : `Offline — last synced ${when}`;
  const tail = `${s.projects} ${s.projects === 1 ? 'job' : 'jobs'} on this phone`;
  // The stuck-sync tell, printed only when true: a non-empty ps_crud beside a stale
  // sync time is the signature of the frozen-downloads failure. Naming the number is
  // what turns "it says free" into a diagnosable report.
  const stuck = s.psPending > 0 ? ` · ${s.psPending} sync write${s.psPending === 1 ? '' : 's'} stuck` : '';
  return s.queued > 0 ? `${head} · ${tail} · ${s.queued} waiting to upload${stuck}`
                      : `${head} · ${tail}${stuck}`;
}
