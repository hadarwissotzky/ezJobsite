/**
 * Capture pairing — REQ-CAP-FUSED. A fused "decision moment" (a photo taken WHILE
 * narrating) is two captures — a photo and a voice clip — that must read as ONE
 * thing. Per the codebase rule, the link is a fact recorded BESIDE the immutable
 * captures, never a column mutated onto capture_commit: an append-only local table
 * keyed by (pair_id, capture_id). Both members share the pair_id minted at capture.
 *
 * Local-only for now (a grouping hint for the grid/viewer); the captures themselves
 * are the evidence and sync through their own outbox. Deleting a pair row never
 * touches a capture.
 */
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';

export const PAIR_DDL =
  `CREATE TABLE IF NOT EXISTS capture_pair (
     pair_id     TEXT NOT NULL,
     capture_id  TEXT NOT NULL,
     role        TEXT NOT NULL CHECK (role IN ('photo','voice')),
     at_ms       INTEGER NOT NULL,
     PRIMARY KEY (pair_id, capture_id)
   ) STRICT`;

export async function ensurePairSchema(db: AbstractPowerSyncDatabase) {
  await db.execute(PAIR_DDL);
}

export async function linkPair(
  db: AbstractPowerSyncDatabase, pairId: string, captureId: string,
  role: 'photo' | 'voice', atMs: number
) {
  await db.execute(
    `INSERT OR IGNORE INTO capture_pair (pair_id, capture_id, role, at_ms) VALUES (?,?,?,?)`,
    [pairId, captureId, role, atMs]);
}
