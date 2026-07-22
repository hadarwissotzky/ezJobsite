/**
 * R2 — the READ side of the voice pipeline: getting the words (and the shutter times)
 * to the pure modules that turn them into a price, a mode, a flag and a layout.
 *
 * Split from `voiceprice.ts` / `multiextra.ts` / `photonarration.ts` for the reason
 * `approvers.ts` is split from `approverrouting.ts`: everything below touches
 * PowerSync or Supabase and therefore cannot be unit-tested by `node --test`, so it is
 * kept as thin as it can be made. The decisions live in the pure files. This file
 * fetches and joins, and nothing here decides anything about a price.
 *
 * OFFLINE (mandate #7 — "the network is never a precondition"). A transcript is a
 * server-side fact: it only exists after the worker ran. That is unavoidable. What is
 * NOT allowed is the price field depending on a connection, so:
 *
 *   1. Every transcript this file successfully fetches is CACHED on the device, and
 *      the cache is consulted first. Open a capture's card once with signal and the
 *      price read-back keeps working in the basement.
 *   2. A miss — no cache, no signal — is not an error and does not block anything.
 *      It returns null, and the card shows an empty price field with the ordinary
 *      "no price heard, type it" flag. Which is the same thing R2's second AC
 *      demands anyway: empty and flagged, never guessed.
 *
 * NOTHING HERE WRITES A PRICE OR SENDS ANYTHING. It returns readings for a human to
 * look at (mandate #2).
 */
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';
import type { SupabaseClient } from '@supabase/supabase-js';

import { alignPhotosToNarration, type Alignment, type Segment } from './photonarration';
import { detectMultipleExtras, type MultiExtraFlag } from './multiextra';
import { extractPrice, type MoneyParser, type VoicePriceReading } from './voiceprice';

/**
 * The device's copy of a transcript.
 *
 * A separate table rather than a `device_settings` key: transcripts are content, they
 * are read by `WHERE capture_id = ?`, and burying them in a key/value bag would make
 * the one query this feature needs a full scan. Append-once, never edited — the
 * transcript is corroboration evidence (mandate #5) and a cache that can be rewritten
 * is a cache that can disagree with the record it is a copy of.
 */
export const VOICE_CACHE_DDL = `
  CREATE TABLE IF NOT EXISTS voice_transcript_cache (
     capture_id  TEXT NOT NULL PRIMARY KEY,
     text        TEXT NOT NULL,
     segments    TEXT,
     cached_at_ms INTEGER NOT NULL
  ) STRICT`;

export async function ensureVoiceCacheSchema(db: AbstractPowerSyncDatabase) {
  await db.execute(VOICE_CACHE_DDL);
}

/**
 * Every capture behind a decision, including the photo siblings of a fused session.
 *
 * The walk is the same one `record.ts` does and for the same reason: a walkthrough
 * writes each photo as its own capture and ties them to the narration through
 * `capture_pair`, so `decision_version.capture_id` alone reaches the voice note and
 * none of the pictures. LOCAL — the linkage is on the device.
 */
export async function captureIdsForDecision(
  db: AbstractPowerSyncDatabase, decisionId: string
): Promise<string[]> {
  const rows = await db.getAll<{ capture_id: string | null }>(
    `SELECT capture_id FROM decision_version
      WHERE decision_id = ? AND capture_id IS NOT NULL
      ORDER BY created_at_ms`, [decisionId]);
  return Array.from(new Set(rows.map((r) => r.capture_id).filter((x): x is string => !!x)));
}

type Cached = { text: string; segments: Segment[] | null };

async function fromCache(
  db: AbstractPowerSyncDatabase, captureIds: string[]
): Promise<Map<string, Cached>> {
  if (!captureIds.length) return new Map();
  const marks = captureIds.map(() => '?').join(',');
  const rows = await db.getAll<{ capture_id: string; text: string; segments: string | null }>(
    `SELECT capture_id, text, segments FROM voice_transcript_cache
      WHERE capture_id IN (${marks})`, captureIds);
  const out = new Map<string, Cached>();
  for (const r of rows) {
    let segs: Segment[] | null = null;
    // A corrupt cached blob must not take the screen down with it: the transcript
    // text is still usable, and the alignment simply falls back to the photo strip.
    try { segs = r.segments ? JSON.parse(r.segments) : null; } catch { segs = null; }
    out.set(r.capture_id, { text: r.text, segments: segs });
  }
  return out;
}

/**
 * Fetch the transcripts this device is missing and keep them.
 *
 * Failure is SILENT AND FINE. No signal is the expected state on a jobsite, not an
 * exception, and every caller degrades to "type the price yourself".
 */
async function fetchAndCache(
  db: AbstractPowerSyncDatabase, client: SupabaseClient, captureIds: string[]
): Promise<Map<string, Cached>> {
  const out = new Map<string, Cached>();
  if (!captureIds.length) return out;
  let data: any[] | null = null;
  try {
    const r = await client
      .from('capture_transcript')
      .select('capture_id, text, segments, created_at')
      .in('capture_id', captureIds)
      .order('created_at', { ascending: false });
    if (r.error) return out;
    data = r.data as any[];
  } catch { return out; }

  for (const row of data ?? []) {
    if (out.has(row.capture_id)) continue;        // newest wins; the list is DESC
    const text = String(row.text ?? '');
    if (!text.trim()) continue;
    const segments: Segment[] | null = Array.isArray(row.segments) ? row.segments : null;
    out.set(row.capture_id, { text, segments });
    // INSERT OR IGNORE: append-once. See the DDL comment.
    await db.execute(
      `INSERT OR IGNORE INTO voice_transcript_cache (capture_id, text, segments, cached_at_ms)
       VALUES (?,?,?,?)`,
      [row.capture_id, text, segments ? JSON.stringify(segments) : null, Date.now()]);
  }
  return out;
}

/**
 * Cache first, network for the rest.
 *
 * A capture with no cached transcript is retried on EVERY open, deliberately: a
 * transcript appears minutes after the capture, so "we looked once and it wasn't
 * there" must not become "we will never look again". The cost is one request when
 * the card opens and nothing at all once the row is cached.
 */
async function transcriptsFor(
  db: AbstractPowerSyncDatabase, client: SupabaseClient, captureIds: string[]
): Promise<Map<string, Cached>> {
  const cached = await fromCache(db, captureIds);
  const missing = captureIds.filter((id) => !cached.has(id));
  if (!missing.length) return cached;
  for (const [k, v] of await fetchAndCache(db, client, missing)) cached.set(k, v);
  return cached;
}

export type VoiceReading = {
  /** The words behind this decision, joined in capture order. Empty when unavailable. */
  transcript: string;
  /** null when there is no transcript on this device and none could be fetched. */
  price: VoicePriceReading | null;
  /** null for the same reason. */
  multi: MultiExtraFlag | null;
};

/**
 * Everything R2 wants to prefill on the priced card, for one decision.
 *
 * `parse` is the app's `parseMoney`, passed in so there is exactly one money parser
 * in the product (see voiceprice.ts's header for why that matters more than the
 * inconvenience of an extra argument).
 */
export async function voiceReadingForDecision(
  db: AbstractPowerSyncDatabase, client: SupabaseClient, decisionId: string, parse: MoneyParser
): Promise<VoiceReading> {
  const ids = await captureIdsForDecision(db, decisionId);
  const map = await transcriptsFor(db, client, ids);
  // Capture order, not map order: a session's narration is a sequence, and a price
  // said in the second clip must not be read before the scope said in the first.
  const transcript = ids.map((id) => map.get(id)?.text).filter(Boolean).join(' ').trim();
  if (!transcript) return { transcript: '', price: null, multi: null };
  return {
    transcript,
    price: extractPrice(transcript, parse),
    multi: detectMultipleExtras(transcript),
  };
}

/** The minimum the narration layout needs about a photo; callers pass richer objects. */
export type NarrationPhoto = { captureId: string; offsetSec: number };

/**
 * R2's photo placement, assembled: narration blocks with the photos taken during them.
 *
 * `photoMeta` lets the caller carry uri/present/timestamp through untouched — the
 * extra record already has those and re-deriving them here would be a second source
 * of truth for whether a file is on disk.
 */
export async function narrationForDecision<P extends { captureId: string }>(
  db: AbstractPowerSyncDatabase, client: SupabaseClient, decisionId: string, photoMeta: P[]
): Promise<Alignment<P & NarrationPhoto>> {
  const ids = await captureIdsForDecision(db, decisionId);

  // Shutter times and the clip each one belongs to. `capture_pair` is the only place
  // the two are related; without it a photo's offset into the narration is unknowable.
  const marks = ids.length ? ids.map(() => '?').join(',') : null;
  const members = marks ? await db.getAll<{
    pair_id: string; capture_id: string; role: 'photo' | 'voice'; at_ms: number;
  }>(
    `SELECT pair_id, capture_id, role, at_ms FROM capture_pair
      WHERE pair_id IN (SELECT pair_id FROM capture_pair WHERE capture_id IN (${marks}))
      ORDER BY at_ms`, ids) : [];

  const voices = members.filter((m) => m.role === 'voice');
  const map = await transcriptsFor(db, client, voices.map((v) => v.capture_id));

  // ONE narration timeline per decision. A session with several clips is stitched by
  // shifting each clip's segments by its start relative to the first clip — otherwise
  // every clip restarts at 0:00 and the second clip's photos align to the first clip's
  // opening sentence.
  const base = voices.length ? voices[0].at_ms : 0;
  const segments: Segment[] = [];
  for (const v of voices) {
    const tr = map.get(v.capture_id);
    if (!tr?.segments?.length) continue;
    const shift = (v.at_ms - base) / 1000;
    for (const g of tr.segments) segments.push({ s: g.s + shift, e: g.e + shift, t: g.t });
  }

  const atMs = new Map(members.map((m) => [m.capture_id, m.at_ms]));
  const photos = photoMeta.map((p) => ({
    ...p,
    // A photo with no pair row has no honest offset. -1 puts it beyond every segment,
    // so it lands in the fallback strip rather than being captioned by accident.
    offsetSec: atMs.has(p.captureId) ? (atMs.get(p.captureId)! - base) / 1000 : -1e9,
  }));

  return alignPhotosToNarration(segments, photos);
}

/**
 * The same thing, addressed by CHANGE ORDER id — which is what the extra record
 * screen has (`ExtraRecord.id`).
 *
 * It exists so the record screen does not need `decisionId` threaded onto
 * `ExtraRecord` just to render its own photos. Resolving the decision here is one
 * local lookup; widening a type that four screens read is a change to all of them.
 */
export async function narrationForExtra<P extends { captureId: string }>(
  db: AbstractPowerSyncDatabase, client: SupabaseClient, changeOrderId: string, photoMeta: P[]
): Promise<Alignment<P & NarrationPhoto>> {
  const rows = await db.getAll<{ decision_id: string }>(
    `SELECT decision_id FROM change_order WHERE id = ?`, [changeOrderId]);
  if (!rows.length) {
    // No decision behind it (hydrated oddly, or a race). The photos still render —
    // as the fallback strip, which is exactly what "alignment unavailable" means.
    return alignPhotosToNarration([], photoMeta.map((p) => ({ ...p, offsetSec: -1e9 })));
  }
  return narrationForDecision(db, client, rows[0].decision_id, photoMeta);
}
