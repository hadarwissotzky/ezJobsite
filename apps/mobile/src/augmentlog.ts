/**
 * Augmentation log — the history note behind "add photos / add voice to an
 * existing extra" (hadar, 2026-07-25).
 *
 * WHY A SEPARATE ROW AND NOT DERIVED FROM TIMESTAMPS. The captures themselves are
 * the evidence and flow into the extra through the pair walk; their times could be
 * read to GUESS which were added later. But "a note in the history should be made
 * regarding the addition" is an explicit fact — who added what, when — and guessing
 * it from a timestamp margin is exactly the kind of silent inference this codebase
 * refuses. So the addition is RECORDED, once, beside the immutable captures.
 *
 * APPEND-ONLY, and it never rewrites the extra. The chosen behaviour (append as
 * evidence) means the frozen scope and the signed instrument are untouched. A voice
 * row also carries `desc_text` — the AI's read of what that voice edit added (hadar,
 * 2026-07-27) — which record.ts renders BENEATH the frozen scope so the Description
 * grows without the binding text ever changing. It augments, never edits.
 *
 * LOCAL-ONLY for now, same status as capture_pair (pair.ts): the captures sync
 * through their own outbox and carry the evidence; this is a grouping/history hint.
 * Promoting it to the owned evidence outbox is the follow-up when the office needs
 * to see the note too.
 */
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';

export type AugmentKind = 'photo' | 'voice';

export const AUGMENT_DDL =
  `CREATE TABLE IF NOT EXISTS extra_augment_log (
     id                TEXT PRIMARY KEY,
     change_order_id   TEXT NOT NULL,
     kind              TEXT NOT NULL CHECK (kind IN ('photo','voice')),
     n                 INTEGER NOT NULL,
     at_ms             INTEGER NOT NULL,
     by_name           TEXT,
     -- The AI's read of what a VOICE edit added, appended to the record's
     -- Description (hadar, 2026-07-27). NULL until processing lands, and always
     -- NULL for photo rows. This is the ONLY way a SENT extra's description can
     -- grow: co.scope is the frozen instrument (mandate #5) and cannot be edited,
     -- so record.ts COMPOSES the shown description as scope + these addenda. It is
     -- append-only and never rewrites scope — it augments, never edits.
     desc_text         TEXT
   ) STRICT`;

export async function ensureAugmentSchema(db: AbstractPowerSyncDatabase) {
  await db.execute(AUGMENT_DDL);
  // desc_text added after the table shipped, so it runs against phones that already
  // have the old shape. SQLite has no ADD COLUMN IF NOT EXISTS — a duplicate column
  // is the expected no-op, anything else is a real failure and must surface (same
  // pattern as approvers.ts / discussionstore.ts).
  try {
    await db.execute(`ALTER TABLE extra_augment_log ADD COLUMN desc_text TEXT`);
  } catch (e: any) {
    if (!/duplicate column/i.test(String(e?.message ?? e))) throw e;
  }
}

/** Record that `n` captures of one kind were added to an extra. Best-effort — the
 *  captures are already committed, so a failed note never un-saves anything. */
export async function noteAugment(
  db: AbstractPowerSyncDatabase,
  o: { changeOrderId: string; kind: AugmentKind; n: number; atMs: number; byName?: string | null }
): Promise<void> {
  if (o.n <= 0) return;
  const id = `aug-${o.atMs.toString(36)}-${o.kind}-${Math.round(o.n)}`;
  await db.execute(
    `INSERT OR IGNORE INTO extra_augment_log (id, change_order_id, kind, n, at_ms, by_name)
     VALUES (?,?,?,?,?,?)`,
    [id, o.changeOrderId, o.kind, Math.round(o.n), o.atMs, o.byName ?? null]);
}

export type AugmentEvent = {
  kind: AugmentKind; n: number; atMs: number; byName: string | null;
  /** The AI/transcript description of a voice edit, once processing has landed. */
  descText: string | null;
};

/** The additions on an extra, oldest first, for the record's history. */
export async function augmentEventsFor(
  db: AbstractPowerSyncDatabase, changeOrderId: string
): Promise<AugmentEvent[]> {
  const rows = await db.getAll<{
    kind: string; n: number; at_ms: number; by_name: string | null; desc_text: string | null;
  }>(
    `SELECT kind, n, at_ms, by_name, desc_text FROM extra_augment_log
      WHERE change_order_id = ? ORDER BY at_ms`, [changeOrderId]);
  return rows.map((r) => ({
    kind: r.kind as AugmentKind, n: r.n, atMs: r.at_ms, byName: r.by_name,
    descText: r.desc_text?.trim() || null,
  }));
}

/**
 * Fill in the description for the most recent voice edit that is still awaiting one.
 *
 * Called ONCE per edit, after the added voice has been transcribed and analysed, so
 * the record's Description grows to cover what the edit said — "the same rules as the
 * new extra" (hadar, 2026-07-27). It targets the newest un-described voice row for
 * this extra, which is the row `noteAugment` wrote for this edit a moment earlier.
 *
 * Best-effort and idempotent-ish: it only ever writes over a NULL desc_text, so a
 * re-run (a retried transition) cannot clobber a description already set, and a
 * failure leaves the evidence untouched — the captures are already committed.
 */
export async function appendAugmentDesc(
  db: AbstractPowerSyncDatabase, changeOrderId: string, text: string
): Promise<boolean> {
  const t = text.trim();
  if (!t) return false;
  const r = await db.execute(
    `UPDATE extra_augment_log SET desc_text = ?
      WHERE id = (
        SELECT id FROM extra_augment_log
         WHERE change_order_id = ? AND kind = 'voice' AND desc_text IS NULL
         ORDER BY at_ms DESC LIMIT 1)`,
    [t.slice(0, 2000), changeOrderId]);
  return !!r.rowsAffected;
}
