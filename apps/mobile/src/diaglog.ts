/**
 * A diagnostic trail that survives a Release build.
 *
 * WHY IT EXISTS. hadar recorded for 20 seconds on a Release build and no live
 * words appeared. Every failure path in the speech code was deliberately silent
 * so a broken indicator could never disturb a recording — correct for the
 * contractor, and it left ME with nothing: console.log does not surface from a
 * Release binary, so the one observability channel I had was gone exactly where
 * the bug lives. The database is the channel that cannot go dark: it travels
 * with the phone, and `devicectl copy` reads it from here.
 *
 * Failures in here are swallowed too — a diagnostic that can break the thing it
 * observes is worse than no diagnostic. Rows are capped by deleting the oldest
 * past 500, so this can never grow into a problem on a real phone.
 */
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';

let ready = false;

export async function logDiag(
  db: AbstractPowerSyncDatabase, tag: string, detail: string
): Promise<void> {
  try {
    if (!ready) {
      await db.execute(
        `CREATE TABLE IF NOT EXISTS diag_log (
           at_ms  INTEGER NOT NULL,
           tag    TEXT NOT NULL,
           detail TEXT NOT NULL
         ) STRICT`);
      ready = true;
    }
    await db.execute(
      `INSERT INTO diag_log (at_ms, tag, detail) VALUES (?, ?, ?)`,
      [Date.now(), tag, detail.slice(0, 300)]);
    await db.execute(
      `DELETE FROM diag_log WHERE rowid NOT IN
         (SELECT rowid FROM diag_log ORDER BY at_ms DESC LIMIT 500)`);
  } catch { /* never let the trail break the trip */ }
}
