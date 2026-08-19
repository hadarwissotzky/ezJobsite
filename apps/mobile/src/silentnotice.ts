/**
 * "WE HEARD NOTHING" — said out loud, once, instead of whispered on a card.
 *
 * hadar, 2026-08-19: "if a CO is processed and no audio was found it currently and
 * correctly states that. But I think it is too subtle — in the case no audio was
 * processed and there is no scope of work already in the CO (someone just added pictures)
 * a bottom popup needs to be displayed notifying the user what just occurred."
 *
 * ─── WHY THIS DESERVES AN INTERRUPTION ──────────────────────────────────────────
 * The extra exists, the photos are safe, the pipeline finished — and the change order has
 * NOTHING TO SEND. Every other unfinished state on that screen resolves itself: bytes
 * upload, transcripts land, the write-up appears. This one never will. Nothing more is
 * coming, and until a person types or speaks, the extra sits looking almost-done.
 *
 * `StuckBlock` states it correctly and quietly, at the bottom of a card, on a screen he
 * has to open first. The one state that cannot fix itself is the one that has to reach
 * him where he is.
 *
 * ─── NOT A FAULT, AND THE COPY MUST NOT IMPLY ONE ───────────────────────────────
 * A recording with no speech in it is a legitimate thing to have made — he may have been
 * shooting photos and never meant to talk. `extradraft.tsx` already says this about the
 * inline version and it holds here: the sheet reports what happened and offers the two
 * things that help. It never says "failed".
 *
 * ─── ONCE PER EXTRA, DURABLY ────────────────────────────────────────────────────
 * Same reasoning as `approval_celebrated`: a stamp in memory forgets on every launch, so
 * a contractor who dismissed this yesterday would meet it again this morning, forever, on
 * an extra he has already decided to leave alone. And the stamp is SEPARATE from anything
 * else — "has he been told" is its own question.
 */
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';

export const SILENT_NOTICE_DDL = [
  `CREATE TABLE IF NOT EXISTS silent_notice (
      change_order_id TEXT NOT NULL PRIMARY KEY,
      at_ms           INTEGER NOT NULL
   ) STRICT`,
];

export async function ensureSilentNoticeSchema(db: AbstractPowerSyncDatabase) {
  const existed = await db.getAll<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='silent_notice'`
  );
  for (const s of SILENT_NOTICE_DDL) await db.execute(s);
  // SEED THE WATERMARK on first creation, exactly like the celebration's. Without it the
  // first launch after this ships opens a sheet for every silent extra ever made — a
  // stack of notices about recordings from weeks ago, which teaches him to dismiss the
  // thing without reading it. Only silence found from now on is news.
  if (!existed.length) {
    await db.execute(
      `INSERT OR IGNORE INTO silent_notice (change_order_id, at_ms)
         SELECT id, ? FROM change_order`,
      [Date.now()]
    );
  }
}

export type SilentNotice = {
  changeOrderId: string;
  projectId: string;
  /** The extra's title, so the sheet says WHICH one. */
  scope: string;
  /** How many photos it does have — the sheet leads with what survived. */
  photos: number;
};

/**
 * Extras that are finished, silent, and empty — and that he has not been told about.
 *
 * EVERY CLAUSE IS A GUARD AGAINST CRYING WOLF, so each is written out rather than folded
 * into a cleverer query:
 *
 *   status = 'draft'      — a sent extra is past the point where this helps.
 *   no scope_of_work      — hadar's condition. If he has already written the scope the
 *                           silence cost him nothing and there is nothing to report.
 *   has a voice capture   — with no recording at all there was never any audio to find,
 *                           so "we heard nothing" would be a non-sequitur.
 *   no transcript         — the actual silence.
 *   nothing still queued  — the pipeline must be FINISHED. Reporting silence while a
 *                           recording is still in the outbox would be a lie: the words
 *                           may be minutes away, and mandate #7 says no signal is normal.
 */
export async function pendingSilentNotices(
  db: AbstractPowerSyncDatabase
): Promise<SilentNotice[]> {
  try {
    return await db.getAll<SilentNotice>(
      `SELECT co.id AS changeOrderId, co.project_id AS projectId, co.scope AS scope,
              (SELECT COUNT(*) FROM decision_version dv2
                 JOIN capture_commit cc2 ON cc2.capture_id = dv2.capture_id
                WHERE dv2.decision_id = co.decision_id
                  AND cc2.modality = 'photo') AS photos
         FROM change_order co
        WHERE co.status = 'draft'
          AND COALESCE(TRIM(co.scope_of_work), '') = ''
          AND co.id NOT IN (SELECT change_order_id FROM silent_notice)
          AND EXISTS (
            SELECT 1 FROM decision_version dv
              JOIN capture_commit cc ON cc.capture_id = dv.capture_id
             WHERE dv.decision_id = co.decision_id AND cc.modality = 'voice')
          AND NOT EXISTS (
            SELECT 1 FROM decision_version dv
              JOIN capture_commit cc ON cc.capture_id = dv.capture_id
              JOIN voice_transcript_cache vt ON vt.capture_id = cc.capture_id
             WHERE dv.decision_id = co.decision_id AND cc.modality = 'voice'
               AND COALESCE(TRIM(vt.text), '') <> '')
          AND NOT EXISTS (
            SELECT 1 FROM decision_version dv
              JOIN capture_outbox o ON o.capture_id = dv.capture_id
             WHERE dv.decision_id = co.decision_id)
        ORDER BY co.created_at_ms DESC`
    );
  } catch {
    // A table this build has never seen (an older install mid-migration) means nothing to
    // report. A popup is the most droppable thing in this app.
    return [];
  }
}

/** He has been told. Called when the sheet is DISMISSED or acted on — never when it is
 *  merely queued, or a notice that lost a race would be consumed unseen. */
export async function markSilentNoticeShown(
  db: AbstractPowerSyncDatabase, changeOrderId: string, atMs = Date.now()
): Promise<void> {
  await db.execute(
    `INSERT OR REPLACE INTO silent_notice (change_order_id, at_ms) VALUES (?, ?)`,
    [changeOrderId, atMs]
  );
}
