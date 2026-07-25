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
 * evidence) means the priced description and the signed instrument are untouched;
 * this log only says "N photos / a voice note were added". It augments, never edits.
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
     by_name           TEXT
   ) STRICT`;

export async function ensureAugmentSchema(db: AbstractPowerSyncDatabase) {
  await db.execute(AUGMENT_DDL);
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

export type AugmentEvent = { kind: AugmentKind; n: number; atMs: number; byName: string | null };

/** The additions on an extra, oldest first, for the record's history. */
export async function augmentEventsFor(
  db: AbstractPowerSyncDatabase, changeOrderId: string
): Promise<AugmentEvent[]> {
  const rows = await db.getAll<{ kind: string; n: number; at_ms: number; by_name: string | null }>(
    `SELECT kind, n, at_ms, by_name FROM extra_augment_log
      WHERE change_order_id = ? ORDER BY at_ms`, [changeOrderId]);
  return rows.map((r) => ({
    kind: r.kind as AugmentKind, n: r.n, atMs: r.at_ms, byName: r.by_name,
  }));
}
