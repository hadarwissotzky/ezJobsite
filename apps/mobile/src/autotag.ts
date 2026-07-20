/**
 * Auto-tagging — the narration timeline meets the photo strip.
 *
 * A walkthrough commits N photos + audio segments, pair-linked with per-item
 * timestamps (`capture_pair.at_ms`). The worker transcribes the audio WITH segment
 * times (sql/190). This module joins the two: for each photo, find the sentence being
 * spoken when the shutter fired, and record it as a TAG on that photo — so the walk's
 * photos are organised by what was said, not just when.
 *
 * Shape rules:
 *  - Tags ride the existing REQ-GAL3 machinery (append-only, outbox-synced, human can
 *    retract). Auto is a convenience layer on top of evidence, never a mutation of it.
 *  - Runs opportunistically (from the drain tick): transcripts only exist after the
 *    online pipeline ran, so offline there is simply nothing to do yet.
 *  - Idempotent per pair via a device_settings flag — a walk is tagged once, not on
 *    every tick. The flag is only set once a transcript EXISTED; "not transcribed yet"
 *    retries on a later tick.
 */
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';
import type { SupabaseClient } from '@supabase/supabase-js';

import { addTag, tagsFor } from './tags';

type Seg = { s: number; e: number; t: string };
type Member = { pair_id: string; capture_id: string; role: 'photo' | 'voice'; at_ms: number };

/** A short human tag from a sentence: whole words, hard cap, no dangling comma. */
function tagline(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= 48) return clean;
  const cut = clean.slice(0, 48);
  return cut.slice(0, cut.lastIndexOf(' ') > 20 ? cut.lastIndexOf(' ') : 48).replace(/[,;:]$/, '') + '…';
}

/** The segment being spoken at `offsetSec` into the audio, else the nearest one. */
function segmentAt(segs: Seg[], offsetSec: number): Seg | null {
  if (!segs.length) return null;
  const inside = segs.find((g) => offsetSec >= g.s - 1 && offsetSec <= g.e + 2);
  if (inside) return inside;
  let best = segs[0], bestD = Infinity;
  for (const g of segs) {
    const d = Math.min(Math.abs(offsetSec - g.s), Math.abs(offsetSec - g.e));
    if (d < bestD) { bestD = d; best = g; }
  }
  return bestD <= 20 ? best : null;   // a photo 20s+ from any speech has no honest tagline
}

/**
 * One pass. Returns how many pairs were tagged. Cheap when there is nothing to do
 * (one local query + flag lookups); network only when an untagged pair exists.
 */
export async function runAutoTags(
  db: AbstractPowerSyncDatabase, client: SupabaseClient
): Promise<number> {
  const members = await db.getAll<Member>(
    `SELECT pair_id, capture_id, role, at_ms FROM capture_pair ORDER BY pair_id, at_ms`);
  if (!members.length) return 0;

  const byPair = new Map<string, Member[]>();
  for (const m of members) {
    if (!byPair.has(m.pair_id)) byPair.set(m.pair_id, []);
    byPair.get(m.pair_id)!.push(m);
  }

  let tagged = 0;
  for (const [pairId, mems] of byPair) {
    const done = await db.getAll<{ v: string }>(
      `SELECT v FROM device_settings WHERE k = ?`, [`autotag:${pairId}`]);
    if (done[0]?.v === 'yes') continue;

    const photos = mems.filter((m) => m.role === 'photo');
    const voices = mems.filter((m) => m.role === 'voice');
    if (!photos.length || !voices.length) {
      // Nothing joinable (photo-only or voice-only walk) — mark done, skip forever.
      await db.execute(`INSERT INTO device_settings (k, v) VALUES (?, 'yes')
        ON CONFLICT(k) DO UPDATE SET v = 'yes'`, [`autotag:${pairId}`]);
      continue;
    }

    // Transcripts are server-side facts; fetch for this pair's voice captures.
    const { data, error } = await client
      .from('capture_transcript')
      .select('capture_id, text, segments, created_at')
      .in('capture_id', voices.map((v) => v.capture_id))
      .order('created_at', { ascending: false });
    if (error || !data?.length) continue;   // offline or not transcribed yet — retry later

    // Newest transcript per voice capture.
    const trByCapture = new Map<string, { text: string; segments: Seg[] | null }>();
    for (const r of data as any[]) {
      if (!trByCapture.has(r.capture_id)) {
        trByCapture.set(r.capture_id, { text: r.text ?? '', segments: r.segments ?? null });
      }
    }

    for (const ph of photos) {
      const existing = await tagsFor(db, ph.capture_id);
      if (existing.length) continue;        // a human already tagged it; do not pile on

      // Which voice segment file covers this photo? The one that started most recently
      // before the shutter. Then the offset into it selects the sentence.
      const covering = [...voices].reverse().find((v) => v.at_ms <= ph.at_ms) ?? voices[0];
      const tr = trByCapture.get(covering.capture_id);
      if (!tr) continue;
      const seg = tr.segments?.length
        ? segmentAt(tr.segments, (ph.at_ms - covering.at_ms) / 1000)
        : null;
      const text = seg?.t ?? tr.text;       // old transcripts have no segments: whole text
      if (!text?.trim()) continue;
      await addTag(db, { captureId: ph.capture_id, tag: tagline(text), author: 'auto' });
    }

    await db.execute(`INSERT INTO device_settings (k, v) VALUES (?, 'yes')
      ON CONFLICT(k) DO UPDATE SET v = 'yes'`, [`autotag:${pairId}`]);
    tagged++;
  }
  return tagged;
}
