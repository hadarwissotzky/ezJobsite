/**
 * R6 — the approval event log and the frozen snapshot, on the device.
 *
 * The decision logic is NOT here. It is in `eventtimeline.ts`, which has no
 * imports so it can be tested (`eventtimeline.test.ts`). This file is the boring
 * half: the local cache, the one RPC, and the translation into the shape the
 * record screen already draws. Same split as approverrouting.ts / approvers.ts.
 *
 * WHY THERE IS A LOCAL CACHE AT ALL (mandate #7): the events live server-side —
 * confirmation_request, confirmation_open, confirmation_question,
 * confirmation_response — and the record screen is opened in a basement, in a
 * truck, on a job with no bars. Reading them live only would mean the timeline
 * emptied out the moment the signal did, which is the same failure as a record
 * that lies: yesterday it said "opened twice, questioned once", today it says
 * nothing happened. So every fetch is written down, and the screen always renders
 * from what is written down. The network only ever ADDS.
 *
 * WHY IT IS APP-OWNED SQLITE AND NOT A POWERSYNC TABLE: same argument as
 * approvers.ts. A PowerSync table needs the server table AND deployed sync rules
 * before it does anything, and these rows are append-only evidence rather than a
 * mutable relational row. The precedent in this repo for evidence is an owned
 * table, not the sync engine.
 *
 * THE CACHE IS NOT THE RECORD. The server is. Deleting these rows loses nothing —
 * the next fetch rebuilds them from tables that are append-only by trigger. That is
 * why there is no delete guard here, unlike change_order: making a cache
 * undeletable on a phone with 400MB free would be ceremony, not integrity.
 */
import { AbstractPowerSyncDatabase } from '@powersync/react-native';
import { SupabaseClient } from '@supabase/supabase-js';
import { sha256 } from 'js-sha256';
import { createdLabel } from './changeorder';
import { t } from './i18n';
import type { ExtraRecord, RecordEvent } from './record';
import {
  mergeTimeline, openSignal, parseSnapshot, parseTimeline, snapshotVerifies,
  type FrozenSnapshot, type ServerEvent, type ServerEventKind,
} from './eventtimeline';

export const EVENT_LOG_DDL = [
  // One row per event, keyed by a hash of the event itself: re-fetching the same
  // timeline a hundred times inserts nothing new, and no event can be counted
  // twice. "Opened 3 times" is a number the contractor acts on, so a duplicate
  // here is not a cosmetic bug.
  `CREATE TABLE IF NOT EXISTS change_order_event (
      id              TEXT NOT NULL PRIMARY KEY,
      change_order_id TEXT NOT NULL,
      kind            TEXT NOT NULL,
      at_ms           INTEGER NOT NULL,
      channel         TEXT,
      who             TEXT,
      note            TEXT,
      name            TEXT,
      fetched_at_ms   INTEGER NOT NULL
   ) STRICT`,

  `CREATE INDEX IF NOT EXISTS change_order_event_co
     ON change_order_event (change_order_id, at_ms)`,

  // The frozen instrument, cached per token. Keyed by token and not by change
  // order because a resend issues a new request: keeping both means the record can
  // still show the exact wording of the version that was actually signed after a
  // newer one exists.
  `CREATE TABLE IF NOT EXISTS change_order_snapshot (
      token           TEXT NOT NULL PRIMARY KEY,
      change_order_id TEXT NOT NULL,
      shown_content   TEXT NOT NULL,
      shown_sha256    TEXT NOT NULL,
      action          TEXT,
      signed_name     TEXT,
      answered_at_ms  INTEGER,
      superseded      INTEGER NOT NULL DEFAULT 0 CHECK (superseded IN (0,1)),
      fetched_at_ms   INTEGER NOT NULL
   ) STRICT`,

  // Mirrors the server's freeze guard (200_priced_approval.sql). The status fields
  // legitimately change — an unanswered request becomes answered — but the
  // INSTRUMENT never does. Without this, the row is an ordinary local table and a
  // future "just refresh the cache" could rewrite the words the client signed,
  // on the one copy the contractor is looking at.
  `CREATE TRIGGER IF NOT EXISTS change_order_snapshot_frozen
     BEFORE UPDATE ON change_order_snapshot
     WHEN new.shown_content IS NOT old.shown_content
       OR new.shown_sha256  IS NOT old.shown_sha256
     BEGIN SELECT RAISE(ABORT, 'the frozen snapshot cannot change'); END`,
];

export async function ensureEventLogSchema(db: AbstractPowerSyncDatabase) {
  for (const s of EVENT_LOG_DDL) await db.execute(s);
}

/** What the record screen needs beyond what record.ts already assembles. */
export type ApprovalPanel = {
  /** "Opened 3 times · no answer yet" — R6's actionable signal. Null when silent. */
  signal: { k: string; p?: Record<string, string | number> } | null;
  /** The newest open's timestamp (ms), or null if never opened — "when was the
   *  last time" (hadar, 2026-07-24). Rendered as a relative time on the record. */
  lastOpenedMs: number | null;
  snapshot: {
    /** The binding instrument, verbatim. Never re-rendered. */
    content: string;
    /** False when this device's copy does not hash to the frozen value. */
    verified: boolean;
    signedName: string | null;
    /** Formatted, or null when no answer has been recorded. */
    signedAt: string | null;
    action: 'confirmed' | 'declined' | null;
    superseded: boolean;
  } | null;
  /** True when nothing has ever been fetched for this extra on this device. */
  neverFetched: boolean;
};

export type RecordWithEvents = ExtraRecord & { approval: ApprovalPanel };

/**
 * GENERIC ON PURPOSE. Several requirements are each adding a wrapper around
 * extraRecord() at the same two call sites in App.tsx. If this took and returned a
 * bare ExtraRecord it would TYPE-ERASE whatever another wrapper had just added, and
 * the fix would be a cast — which is how a field silently stops being rendered
 * while everything still compiles. `R extends ExtraRecord` means the wrappers
 * compose in any order.
 */

function eventId(coId: string, e: ServerEvent): string {
  // The note is part of the identity: two questions a second apart are two
  // questions. Hashing rather than concatenating keeps a note containing the
  // separator from colliding with a different event.
  return sha256([coId, e.kind, String(e.atMs), e.channel ?? '', e.who ?? '',
                 e.note ?? '', e.name ?? ''].join('\0'));
}

/**
 * Pull the server's timeline for one extra and write it down. Best-effort by
 * design: NO network failure is propagated, because opening the record must never
 * depend on having signal (mandate #7). Returns how many new events landed, which
 * is only useful for tests and logs.
 */
export async function hydrateEventLog(
  db: AbstractPowerSyncDatabase, supabase: SupabaseClient, changeOrderId: string
): Promise<{ added: number; reached: boolean }> {
  let payload: unknown;
  try {
    const { data, error } = await supabase.rpc('change_order_timeline', {
      p_change_order_id: changeOrderId,
    });
    if (error) return { added: 0, reached: false };
    payload = data;
  } catch {
    return { added: 0, reached: false };
  }

  const events = parseTimeline(payload);
  const snap = parseSnapshot(payload);
  const now = Date.now();
  let added = 0;

  await db.writeTransaction(async (tx) => {
    for (const e of events) {
      const res = await tx.execute(
        `INSERT OR IGNORE INTO change_order_event
           (id, change_order_id, kind, at_ms, channel, who, note, name, fetched_at_ms)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [eventId(changeOrderId, e), changeOrderId, e.kind, e.atMs,
         e.channel ?? null, e.who ?? null, e.note ?? null, e.name ?? null, now]);
      if (res.rowsAffected) added++;
    }
    if (snap) {
      // Insert once; afterwards update only the fields that are allowed to move.
      // shown_content/shown_sha256 are deliberately absent from the UPDATE — the
      // trigger would abort anyway, and a statement that cannot succeed is worse
      // documentation than one that never tries.
      await tx.execute(
        `INSERT INTO change_order_snapshot
           (token, change_order_id, shown_content, shown_sha256, action, signed_name,
            answered_at_ms, superseded, fetched_at_ms)
         VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT(token) DO UPDATE SET
           action = excluded.action,
           signed_name = excluded.signed_name,
           answered_at_ms = excluded.answered_at_ms,
           superseded = excluded.superseded,
           fetched_at_ms = excluded.fetched_at_ms`,
        [snap.token, changeOrderId, snap.content, snap.sha256, snap.action,
         snap.signedName, snap.answeredAtMs, snap.superseded ? 1 : 0, now]);
    }
  });

  return { added, reached: true };
}

/** Read what this device holds. Never touches the network. */
export async function readEventLog(
  db: AbstractPowerSyncDatabase, changeOrderId: string
): Promise<{ events: ServerEvent[]; snapshot: FrozenSnapshot | null }> {
  try {
    const rows = await db.getAll<{
      kind: string; at_ms: number; channel: string | null; who: string | null;
      note: string | null; name: string | null;
    }>(
      `SELECT kind, at_ms, channel, who, note, name
         FROM change_order_event WHERE change_order_id = ? ORDER BY at_ms`,
      [changeOrderId]);

    const snaps = await db.getAll<{
      token: string; shown_content: string; shown_sha256: string; action: string | null;
      signed_name: string | null; answered_at_ms: number | null; superseded: number;
    }>(
      // Same choice the server RPC makes: the ANSWERED request is the instrument;
      // only when none was answered does the newest one stand in.
      `SELECT token, shown_content, shown_sha256, action, signed_name,
              answered_at_ms, superseded
         FROM change_order_snapshot WHERE change_order_id = ?
        ORDER BY (action IS NOT NULL) DESC, fetched_at_ms DESC LIMIT 1`,
      [changeOrderId]);

    const s = snaps[0];
    return {
      events: rows.map((r) => ({
        kind: r.kind as ServerEventKind, atMs: r.at_ms,
        channel: r.channel, who: r.who, note: r.note, name: r.name,
      })),
      snapshot: s ? {
        token: s.token, content: s.shown_content, sha256: s.shown_sha256,
        action: s.action === 'confirmed' || s.action === 'declined' ? s.action : null,
        signedName: s.signed_name, answeredAtMs: s.answered_at_ms,
        superseded: s.superseded === 1,
      } : null,
    };
  } catch {
    // The table may not exist yet on a device that has not run
    // ensureEventLogSchema. Degrade to "no server events" — the record still
    // renders everything record.ts derived locally. A record screen that throws is
    // strictly worse than one that is missing the delivery history.
    return { events: [], snapshot: null };
  }
}

/**
 * The whole R6 addition in one call: fetch if we can, read what we have, and hand
 * back a record whose history carries real timestamps for sent / opened / asked /
 * answered.
 *
 * Deliberately NOT auto-sending, auto-reminding or auto-anything (mandate #2): this
 * only ever reads. The one write it causes is on the client's own device, into a
 * cache.
 */
export async function withEventLog<R extends ExtraRecord>(
  db: AbstractPowerSyncDatabase, supabase: SupabaseClient, rec: R
): Promise<R & { approval: ApprovalPanel }> {
  await hydrateEventLog(db, supabase, rec.id);
  const { events, snapshot } = await readEventLog(db, rec.id);

  const merged = mergeTimeline(rec.history, events);
  const noTime = t('erec.noTime');
  const history: RecordEvent[] = merged.map((m) => ({
    atMs: m.atMs,
    at: m.atMs === null ? noTime : createdLabel(m.atMs),
    // `text` (already translated by record.ts) or `k` (an i18n key) — exactly one
    // is set by mergeTimeline. The `?? ''` is not a fallback anyone should ever
    // see; it exists so a future kind added without a dictionary entry renders a
    // blank line rather than crashing the record screen.
    what: m.text ?? (m.k ? t({ k: m.k, p: m.p } as any) : ''),
    hot: m.hot,
  }));

  return {
    ...rec,
    history,
    approval: {
      signal: openSignal(events, rec.status),
      // WHEN it was last opened — R6's "when was the last time" (hadar, 2026-07-24).
      // The newest 'opened' event, or null if the client has not opened it yet.
      lastOpenedMs: events.reduce(
        (m, e) => (e.kind === 'opened' && e.atMs > m ? e.atMs : m), 0) || null,
      snapshot: snapshot ? {
        content: snapshot.content,
        // Hashing the copy we are about to display. This catches a truncated
        // write or a corrupted row on THIS device; it is not proof against a
        // hostile server, which handed us both the text and the hash. Stated
        // plainly rather than sold as more than it is.
        verified: snapshotVerifies(sha256(snapshot.content), snapshot.sha256),
        signedName: snapshot.signedName,
        signedAt: snapshot.answeredAtMs === null ? null : createdLabel(snapshot.answeredAtMs),
        action: snapshot.action,
        superseded: snapshot.superseded,
      } : null,
      neverFetched: events.length === 0 && snapshot === null,
    },
  };
}
