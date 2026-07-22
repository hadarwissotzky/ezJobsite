/**
 * R2 transcription, on the phone, with no key and no signal.
 *
 * WHY THIS EXISTS ALONGSIDE THE WORKER. I reported R2 as blocked on a Deepgram
 * key four times. It was a choice, not a fact: iOS recognises a recorded FILE on
 * device, and `expo-speech-recognition` exposes the timing `segments` that
 * `sql/190` and `photonarration.ts` need — which is what makes this a real
 * option rather than a partial one. The cloud path stays; the worker
 * re-transcribes when it gets there and supersedes this reading under `150`'s
 * existing "newest wins" law. Nothing here replaces it.
 *
 * MANDATE #7 IS THE ARGUMENT FOR IT. The contractor is standing in a crawlspace
 * with no bars. Cloud STT gives him nothing until he walks out; this gives him a
 * filled-in preview card before he has stood up.
 *
 * TWO WRITES, IN THIS ORDER, AND THE ORDER MATTERS:
 *   1. the LOCAL cache, so the preview works offline and immediately;
 *   2. the SERVER, via `transcript_append_own` (368), because a transcript is
 *      evidence and evidence that lives on one handset is lost with that
 *      handset — mandate #1.
 * The upload is allowed to fail. The local row is not, and the queue below is
 * what makes the failure temporary rather than permanent.
 */
import { AbstractPowerSyncDatabase } from '@powersync/react-native';
import type { SupabaseClient } from '@supabase/supabase-js';

/** What the recogniser produced. Mirrors `capture_transcript`'s columns. */
export type OnDeviceTranscript = {
  text: string;
  segments: Array<{ start: number; end: number; text: string }> | null;
  language: string | null;
  durationSec: number | null;
};

/** Named so a human reading `capture_transcript.engine` knows what produced a
 *  row. "Your app said X" — which app, which model — is the question a
 *  transcript exists to answer, and a hybrid pipeline sharpens it. */
export const ENGINE = 'ios-ondevice';

export const STT_DDL = [
  // Unuploaded on-device transcripts. An outbox, for the same reason every
  // other outbox here exists: the recognition happened offline and the fact
  // must survive until there is signal.
  `CREATE TABLE IF NOT EXISTS stt_outbox (
      capture_id   TEXT NOT NULL PRIMARY KEY,
      text         TEXT NOT NULL,
      segments     TEXT,
      language     TEXT,
      duration_sec REAL,
      queued_at_ms INTEGER NOT NULL,
      attempts     INTEGER NOT NULL DEFAULT 0,
      last_error   TEXT
   ) STRICT`,
];

export async function ensureSttSchema(db: AbstractPowerSyncDatabase) {
  for (const s of STT_DDL) await db.execute(s);
}

/**
 * Recognise one recorded file. Returns null when the device cannot do it on
 * device — an older handset, or a language the recogniser does not hold
 * locally. Null is not an error: the cloud path picks those up.
 *
 * `requiresOnDeviceRecognition` is TRUE, deliberately. With it false iOS may
 * route audio to Apple's servers, which would quietly turn an offline,
 * no-third-party feature into a network round trip that also ships a
 * contractor's jobsite audio somewhere he was never told about.
 */
export async function recognizeFile(uri: string): Promise<OnDeviceTranscript | null> {
  let M: any;
  try { M = await import('expo-speech-recognition'); } catch { return null; }
  const mod = M.ExpoSpeechRecognitionModule;
  if (!mod?.supportsOnDeviceRecognition?.()) return null;

  const perm = await mod.getPermissionsAsync?.();
  // Read, never request. A request raises a dialog that blocks until a human
  // answers, and one such probe hung an entire automated run in this repo
  // already. The caller asks at a moment when a person is looking at the screen.
  if (perm && perm.status !== 'granted') return null;

  return new Promise((resolve) => {
    let settled = false;
    const done = (v: OnDeviceTranscript | null) => {
      if (settled) return;
      settled = true;
      try { subs.forEach((s) => s.remove()); } catch { /* already gone */ }
      clearTimeout(timer);
      resolve(v);
    };
    // A recogniser that never fires `end` would leave this pending forever and
    // take the caller with it. Every await in this file must be able to return.
    const timer = setTimeout(() => done(null), 60_000);

    const subs = [
      M.addSpeechRecognitionListener('result', (e: any) => {
        if (!e?.isFinal) return;
        const r = e.results?.[0];
        if (!r) return done(null);
        done({
          text: String(r.transcript ?? ''),
          segments: Array.isArray(r.segments) && r.segments.length
            ? r.segments.map((s: any) => ({
                start: Number(s.startTimeMillis ?? 0) / 1000,
                end: Number(s.endTimeMillis ?? 0) / 1000,
                text: String(s.segment ?? ''),
              }))
            : null,
          language: null,
          durationSec: null,
        });
      }),
      M.addSpeechRecognitionListener('error', () => done(null)),
      M.addSpeechRecognitionListener('end', () => done(null)),
    ];

    try {
      mod.start({
        lang: 'en-US',
        interimResults: false,
        requiresOnDeviceRecognition: true,
        addsPunctuation: true,
        audioSource: { uri },
      });
    } catch { done(null); }
  });
}

/**
 * Recognise, cache locally, and queue the upload. The local write happens even
 * if the queue insert fails, because the preview card is what the contractor is
 * waiting on and it must not depend on the network in any way.
 */
export async function transcribeOnDevice(
  db: AbstractPowerSyncDatabase, captureId: string, uri: string
): Promise<{ ok: boolean; reason?: string }> {
  const t = await recognizeFile(uri);
  if (!t) return { ok: false, reason: 'unsupported' };
  // Silence is a real result and must not become a stored transcript: an empty
  // row would win `capture_transcript_current`'s newest-wins and blank out a
  // good cloud reading. 368 refuses it server-side too; this is the near guard.
  if (!t.text.trim()) return { ok: false, reason: 'empty' };

  const segs = t.segments ? JSON.stringify(t.segments) : null;
  await db.execute(
    `INSERT OR REPLACE INTO voice_transcript_cache (capture_id, text, segments, cached_at_ms)
     VALUES (?, ?, ?, ?)`,
    [captureId, t.text, segs, Date.now()]
  );
  await db.execute(
    `INSERT OR REPLACE INTO stt_outbox
       (capture_id, text, segments, language, duration_sec, queued_at_ms)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [captureId, t.text, segs, t.language, t.durationSec, Date.now()]
  );
  return { ok: true };
}

/**
 * Push queued transcripts to the server. Called from the sync tick.
 *
 * A row is deleted ONLY after the server has accepted it. 368 is the only way
 * an app can write `capture_transcript` — `150` revoked the direct INSERT —
 * and it refuses an empty transcript, a missing engine, and anybody else's
 * capture, so a rejection here is a real answer and worth keeping the row for.
 */
export async function drainSttOutbox(
  db: AbstractPowerSyncDatabase, client: SupabaseClient
): Promise<{ attempted: number; uploaded: number }> {
  const rows = await db.getAll<{
    capture_id: string; text: string; segments: string | null;
    language: string | null; duration_sec: number | null;
  }>(`SELECT capture_id, text, segments, language, duration_sec
        FROM stt_outbox WHERE attempts < 5 ORDER BY queued_at_ms LIMIT 20`);
  let uploaded = 0;
  for (const r of rows) {
    const { error } = await client.rpc('transcript_append_own', {
      p_capture_id: r.capture_id,
      p_text: r.text,
      p_engine: ENGINE,
      p_segments: r.segments ? JSON.parse(r.segments) : null,
      p_language: r.language,
      p_engine_model: 'SFSpeechRecognizer',
      p_duration_sec: r.duration_sec,
    });
    if (error) {
      await db.execute(
        `UPDATE stt_outbox SET attempts = attempts + 1, last_error = ? WHERE capture_id = ?`,
        [String(error.message).slice(0, 300), r.capture_id]
      );
      continue;
    }
    await db.execute(`DELETE FROM stt_outbox WHERE capture_id = ?`, [r.capture_id]);
    uploaded++;
  }
  return { attempted: rows.length, uploaded };
}
