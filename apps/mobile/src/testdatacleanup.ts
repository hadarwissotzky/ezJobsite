/**
 * Remove the test data MY checks left on a real phone.
 *
 * WHY THIS IS NEEDED AND WHOSE FAULT IT IS. The durability harness writes 100
 * captures per run and I ran it three times against hadar's handset; the loop
 * check creates an extra per run and step 15 deliberately marks one 'sent' so it
 * can prove a sent extra REFUSES deletion — which means it can never be cleaned
 * up by the delete path and accumulates on every launch. His extras list filled
 * with "Untitled extra — still being written up" and "Loop check lc-…", and 303
 * captures sat permanently unbackable because their bytes were synthetic.
 *
 * THE RULE THIS FILE OBEYS: it deletes ONLY rows that carry a marker my own code
 * wrote. Never a heuristic, never "looks like a test", never a date range. If a
 * row cannot be proven to be mine it stays, because the cost of leaving junk
 * behind is an untidy list and the cost of guessing wrong is a contractor's
 * evidence. Mandate #1 does not have an exception for tidying up.
 *
 * THE MARKERS, each traceable to the line that wrote it:
 *   loopcheck.ts  `lc-${Date.now().toString(36)}`     -> capture ids 'lc-%'
 *                 scope `Loop check ${tag}`           -> change_order scope
 *   startextra.ts `co-${captureId}`                   -> extras from those
 *   harness.ts    textCapture(`cycle ${i} ...`)       -> modality text, 'cycle %'
 */
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';

/** Lazy, so this module stays loadable under `node --test`. */
async function fs(): Promise<any | null> {
  try { return await import('expo-file-system/legacy'); } catch { return null; }
}

/**
 * The harness writes `textCapture(\`cycle \${i} \${Date.now()}\`)`, and for a text
 * capture the TEXT IS THE FILE — modality.ts: "the text IS the evidence". So the
 * only honest way to identify one is to read it and match the exact shape the
 * harness produced.
 *
 * My first attempt matched `media_relpath LIKE '%cycle%'` and found 2 rows out of
 * 303, because the path is a generated name and the word only ever lived inside
 * the file. Matching on modality alone would have been worse: the app has a real
 * text-capture path, so that would delete a contractor's typed notes.
 */
const HARNESS_TEXT = /^cycle \d+ \d+$/;

export type CleanupResult = {
  captures: number; extras: number; decisions: number; outbox: number;
};

/**
 * Deletes the test rows and reports what went. Safe to run twice — everything
 * is keyed on markers, so a second pass simply finds nothing.
 *
 * NOT wrapped in one transaction on purpose: this is cleanup, not evidence, and
 * a partial sweep that removed 200 of 303 rows is strictly better than one that
 * rolled back because the 201st had a foreign key nobody expected.
 */
export async function cleanupTestData(
  db: AbstractPowerSyncDatabase
): Promise<CleanupResult> {
  const count = async (sql: string, p: any[] = []) =>
    Number((await db.getAll<{ n: number }>(sql, p))[0]?.n ?? 0);

  // Loop-check captures are identified by id. Harness ones must be READ.
  const capBefore = await count(
    `SELECT count(*) AS n FROM capture_commit
      WHERE capture_id LIKE 'lc-%' OR capture_id LIKE 'hz-%'`);

  const F = await fs();
  const harness: string[] = [];
  if (F) {
    const texts = await db.getAll<{ capture_id: string; media_relpath: string }>(
      `SELECT capture_id, media_relpath FROM capture_commit
        WHERE modality = 'text'
          AND capture_id NOT IN (SELECT capture_id FROM capture_discarded)`);
    for (const t of texts) {
      try {
        const body = await F.readAsStringAsync(`${F.documentDirectory}${t.media_relpath}`);
        if (HARNESS_TEXT.test(body.trim())) harness.push(t.capture_id);
      } catch { /* unreadable: leave it alone, it is not provably mine */ }
    }
  }

  const extraBefore = await count(
    `SELECT count(*) AS n FROM change_order
      WHERE id LIKE 'co-lc-%' OR id LIKE 'co-hz-%'
         OR scope LIKE 'Loop check lc-%'`);

  const decBefore = await count(
    `SELECT count(*) AS n FROM decision WHERE id LIKE 'd-lc-%' OR id LIKE 'd-hz-%'`);

  // Outbox entries FIRST: one that outlives its change order retries forever
  // against a row the server will never accept.
  const outBefore = await count(
    `SELECT count(*) AS n FROM change_order_outbox
      WHERE change_order_id LIKE 'co-lc-%' OR change_order_id LIKE 'co-hz-%'`);
  await db.execute(
    `DELETE FROM change_order_outbox
      WHERE change_order_id LIKE 'co-lc-%' OR change_order_id LIKE 'co-hz-%'`);
  await db.execute(
    `DELETE FROM capture_outbox WHERE capture_id LIKE 'lc-%' OR capture_id LIKE 'hz-%'`);

  await db.execute(
    `DELETE FROM change_order
      WHERE id LIKE 'co-lc-%' OR id LIKE 'co-hz-%' OR scope LIKE 'Loop check lc-%'`);

  // decision_version is append-only on the device (decision_version_no_delete),
  // so the version rows stay. They are three columns of orphaned text pointing at
  // captures that are gone; harmless, invisible, and not worth relaxing a
  // never-delete trigger to remove.
  await db.execute(`DELETE FROM decision WHERE id LIKE 'd-lc-%' OR id LIKE 'd-hz-%'`);

  // capture_commit is append-only too. Tombstone them instead, which is exactly
  // what discard does and what the gallery already filters on — the rows stay,
  // the list is clean, and nothing had to be forced.
  await db.execute(
    `INSERT OR IGNORE INTO capture_discarded (capture_id, change_order_id, at_ms, bytes_freed)
     SELECT capture_id, 'test-cleanup', ?, media_bytes FROM capture_commit
      WHERE capture_id LIKE 'lc-%' OR capture_id LIKE 'hz-%'`,
    [Date.now()]);

  // The harness rows, proven one by one. Their outbox entries go too — they are
  // the "303 won't back up": synthetic bytes the server will never accept,
  // retrying forever and reported to the contractor as pending work.
  for (const id of harness) {
    await db.execute(
      `INSERT OR IGNORE INTO capture_discarded (capture_id, change_order_id, at_ms, bytes_freed)
       SELECT capture_id, 'test-cleanup', ?, media_bytes FROM capture_commit WHERE capture_id = ?`,
      [Date.now(), id]);
    await db.execute(`DELETE FROM capture_outbox WHERE capture_id = ?`, [id]);
  }

  // WHAT IS ACTUALLY THERE. Two sweeps removed almost nothing while the phone
  // reported hundreds of unbackable items, which means my markers were wrong
  // rather than the junk absent. Report the landscape so the next decision is
  // made on counts instead of another guess.
  const landscape = {
    totalCaptures: await count(`SELECT count(*) AS n FROM capture_commit`),
    text: await count(`SELECT count(*) AS n FROM capture_commit WHERE modality='text'`),
    voice: await count(`SELECT count(*) AS n FROM capture_commit WHERE modality='voice'`),
    photo: await count(`SELECT count(*) AS n FROM capture_commit WHERE modality='photo'`),
    pendingUpload: await count(`SELECT count(*) AS n FROM capture_outbox`),
    parked: await count(`SELECT count(*) AS n FROM capture_outbox WHERE last_error_code IS NOT NULL`),
    extras: await count(`SELECT count(*) AS n FROM change_order`),
    untitled: await count(
      `SELECT count(*) AS n FROM change_order WHERE scope LIKE 'Untitled extra%'`),
    tombstoned: await count(`SELECT count(*) AS n FROM capture_discarded`),
    textSampled: harness.length,
  };
  console.log('[landscape]', JSON.stringify(landscape));

  return {
    captures: capBefore + harness.length, extras: extraBefore,
    decisions: decBefore, outbox: outBefore,
  };
}
