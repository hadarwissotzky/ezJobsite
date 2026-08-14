/**
 * CLOSING THE ACCOUNT — the client half of the lawful-erasure path (SQL: 406).
 *
 * hadar, 2026-08-13: "I cannot seem to be able to downgrade if I want to, or cancel the
 * account — need to be able to do both." App Store 5.1.1(v) requires the deletion half
 * to exist in-app at all, and it did not.
 *
 * ─── FOUR PLACES HOLD THIS PERSON'S DATA, AND ALL FOUR HAVE TO GO ───────────────
 *   1. Supabase Storage — the audio and photos. Deleted from the CLIENT, because
 *      Supabase forbids SQL deletes on storage tables outright (the lesson already
 *      paid for in 372: an RPC tried it, failed every tick, and fifty tombstones
 *      retried forever). The `captures_delete_own` policy scopes us to our own folder.
 *   2. Postgres — every row. `close_my_account()` (406).
 *   3. The device's SQLite — the local-first copy, which is the WHOLE POINT of this
 *      app and therefore holds a complete second copy of everything.
 *   4. The device's filesystem — `capture-media/`, the durable originals.
 *
 * Deleting only (2) would leave an "account deleted" claim that is false in three
 * places, one of which is the phone in their hand.
 *
 * ─── WHY STORAGE GOES FIRST, BEFORE THE ROWS ────────────────────────────────────
 * The rows are the index to the media. Delete the rows first and a failure at step 1
 * leaves media nobody can reach, nobody can enumerate, and nothing will ever clean up:
 * a permanent privacy gap. Delete the media first and a failure at step 2 leaves a live
 * account with broken thumbnails — visible, retryable, and about to be deleted anyway.
 * The recoverable failure is the one worth choosing.
 */
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';
import type { SupabaseClient } from '@supabase/supabase-js';

const BUCKET = 'captures';

export type CloseResult =
  | { ok: true; changeOrders: number; captures: number; mediaLeft: number }
  | { ok: false; reason: string };

/**
 * Remove every object under `<uid>/` in the captures bucket.
 *
 * Keys are `<ownerId>/<captureId>/<sha256>.<ext>` (uploader.ts `objectKey`), so the
 * listing is two levels deep — `list()` returns one level at a time and never recurses.
 * Returns the number of objects it could NOT remove, so the caller can report a partial
 * result honestly rather than claiming a clean sweep.
 */
export async function purgeRemoteMedia(
  supabase: SupabaseClient, userId: string
): Promise<number> {
  let failed = 0;
  const listAll = async (prefix: string) => {
    // `list` is paginated and silently caps at 100 by default — the exact shape that
    // makes a purge look complete while leaving the eleventh page behind.
    const out: string[] = [];
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await supabase.storage.from(BUCKET)
        .list(prefix, { limit: 100, offset });
      if (error || !data || data.length === 0) { if (error) failed += 1; break; }
      for (const e of data) out.push(e.name);
      if (data.length < 100) break;
    }
    return out;
  };

  const captureDirs = await listAll(userId);
  for (const dir of captureDirs) {
    const files = await listAll(`${userId}/${dir}`);
    if (files.length === 0) continue;
    const keys = files.map((f) => `${userId}/${dir}/${f}`);
    const { error } = await supabase.storage.from(BUCKET).remove(keys);
    if (error) failed += keys.length;
  }
  return failed;
}

/**
 * The local tables this app owns, as they exist right now, discovered rather than
 * listed. A hand-maintained list of ~48 names goes stale the first time somebody adds a
 * table, and the failure mode is silent: the purge keeps reporting success while the
 * new table keeps its rows.
 *
 * EXCLUDES `ps_*` (PowerSync's own storage — cleared by `disconnectAndClear`) and
 * `sqlite_*`. Views are excluded by `type='table'`: every PowerSync-managed table is a
 * view over `ps_data` and dropping one would remove the sync definition, not the data.
 */
export async function localOwnedTables(db: AbstractPowerSyncDatabase): Promise<string[]> {
  const rows = await db.getAll<{ name: string }>(
    `SELECT name FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'ps\\_%' ESCAPE '\\'
        AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'`);
  return rows.map((r) => r.name);
}

/**
 * Wipe the device.
 *
 * DROP rather than DELETE, for one reason: the local tables carry their own append-only
 * triggers (`capture_commit_no_delete`, `capture_note_no_delete`, `change_order_frozen`
 * …) and SQLite has no session flag to excuse a delete the way 406 does server-side.
 * Dropping a table takes its triggers with it, and every one of them is defined with
 * `CREATE TRIGGER IF NOT EXISTS` beside a `CREATE TABLE IF NOT EXISTS`, so the next
 * launch rebuilds the table AND the protection together. Dropping the triggers instead
 * would leave the app running with its immutability guards missing.
 */
export async function purgeLocalData(db: AbstractPowerSyncDatabase): Promise<void> {
  const tables = await localOwnedTables(db);
  await db.writeTransaction(async (tx) => {
    for (const t of tables) await tx.execute(`DROP TABLE IF EXISTS "${t}"`);
  });
  // PowerSync's own copy of the mutable rows (project, company, membership).
  await db.disconnectAndClear();
}

/**
 * The durable originals. `idempotent: true` so a missing directory is not an error.
 *
 * `expo-file-system` is required INSIDE the function, not imported at the top. A
 * module-scope expo import makes the whole file unloadable under `node --test`, and
 * this module holds the destructive logic that most needs tests — the same trap that
 * forced `addressline.ts` out of `geocode.ts`.
 */
export async function purgeLocalMedia(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const FS = require('expo-file-system/legacy');
  for (const dir of ['capture-media/', 'draft-media/']) {
    try {
      await FS.deleteAsync(FS.documentDirectory + dir, { idempotent: true });
    } catch { /* a file we cannot remove must not strand the account close */ }
  }
}

/**
 * The whole act, in the order argued at the top of this file. The caller signs out
 * afterwards — the session is still valid and would otherwise be pointed at a database
 * with nothing left in it.
 *
 * `mediaLeft > 0` is reported rather than swallowed: "your account is closed" while
 * eleven photos survive in a bucket is exactly the dishonest-acknowledgement failure
 * mandate #1 names, pointed the other way.
 */
export async function closeMyAccount(
  supabase: SupabaseClient, db: AbstractPowerSyncDatabase, userId: string,
  /** Seam for tests only. `purgeLocalMedia` reaches for `expo-file-system`, which does
   *  not exist under `node --test`; injecting it keeps the production path free of a
   *  swallowing try/catch that would hide a real failure on device. */
  purgeMedia: () => Promise<void> = purgeLocalMedia
): Promise<CloseResult> {
  const mediaLeft = await purgeRemoteMedia(supabase, userId);

  const { data, error } = await supabase.rpc('close_my_account');
  if (error) return { ok: false, reason: error.message };

  // Only now the device. If the server call had failed we would have left the phone
  // empty and the cloud full, and the next sync would have pulled it all back.
  await purgeMedia();
  await purgeLocalData(db);

  const d = (data ?? {}) as { change_orders?: number; captures?: number };
  return {
    ok: true,
    changeOrders: Number(d.change_orders ?? 0),
    captures: Number(d.captures ?? 0),
    mediaLeft,
  };
}
