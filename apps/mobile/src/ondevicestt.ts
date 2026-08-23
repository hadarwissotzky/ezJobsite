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
import { currentLang } from './i18n.ts';
import { logDiag } from './diaglog.ts';

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
export async function recognizeFile(
  db: AbstractPowerSyncDatabase, uri: string
): Promise<OnDeviceTranscript | null> {
  let M: any;
  try { M = await import('expo-speech-recognition'); }
  catch (e: any) { void logDiag(db, 'file.import', String(e?.message ?? e)); return null; }
  const mod = M.ExpoSpeechRecognitionModule;
  if (!mod?.supportsOnDeviceRecognition?.()) {
    void logDiag(db, 'file.state', 'onDevice unsupported'); return null;
  }

  const perm = await mod.getPermissionsAsync?.();
  void logDiag(db, 'file.state', `permission=${perm?.status ?? 'unknown'}`);
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

    let subs: Array<{ remove: () => void }> = [];
    try {
      subs = [
      mod.addListener('result', (e: any) => {
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
      // Each silent exit WRITES WHY. The real capture's recognition failed for a
      // day with permission granted and support present, and this listener was
      // the one place that knew the reason and said nothing (2026-07-23).
      mod.addListener('error', (e: any) => {
        void logDiag(db, 'file.err',
          JSON.stringify(e?.error ?? e?.message ?? e ?? 'unknown').slice(0, 200));
        /**
         * `no-speech` IS AN ANSWER (hadar, 2026-08-23 — build 13 still sat on
         * "Writing down what you said…" on a recording he never spoke into).
         *
         * Every other exit here means the recogniser COULD NOT READ the file:
         * unsupported device, permission refused, import failure, timeout. This one
         * means it read the file fine and there was no speech in it — the Web Speech
         * code for exactly that, which expo-speech-recognition follows. Collapsing it
         * into `null` with the can't-run cases is what made silence indistinguishable
         * from "not finished yet", and the caller's empty-transcript branch — the one
         * that records the verdict — was never reached.
         *
         * An empty transcript, NOT a stored one: `transcribeOnDevice` still refuses to
         * write `text: ''` into the cache. This only lets it see what happened.
         */
        if (e?.error === 'no-speech') {
          return done({ text: '', segments: null, language: null, durationSec: null });
        }
        done(null);
      }),
      /**
       * `end` STAYS `null` — it is not evidence of silence (Codex, 2026-08-23, P1).
       *
       * I briefly made this branch report an empty transcript as belt-and-braces to the
       * `no-speech` error above. It is not safe and the "we can tell afterwards from the
       * diag" defence was wrong: `done()` settles AND removes every listener, so an
       * early `end` does not merely guess — it actively locks the guess in and prevents
       * a final result or a real error arriving later from correcting it. A decode
       * failure that emits no `error` would be recorded as "nothing was said" about
       * audio that has speech in it, which on this product is a false statement about
       * evidence. Only the explicit `no-speech` verdict says the recogniser listened.
       */
      mod.addListener('end', () => {
        if (!settled) void logDiag(db, 'file.end', 'ended with no final result');
        done(null);
      }),
      ];
    } catch (e: any) {
      void logDiag(db, 'file.threw', 'attach: ' + String(e?.message ?? e).slice(0, 100));
      return done(null);
    }

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

// ── live view while recording ───────────────────────────────────────────────
//
// WHAT THIS IS FOR, in hadar's words: "so the user will see that information is
// coming through". It is a PROGRESS INDICATOR, not evidence. Accuracy is
// explicitly not the bar — interim results are rough by construction and the
// authoritative transcript still comes from the file pass after the recording
// stops, or from the cloud after that.
//
// THEREFORE IT CAN NEVER TOUCH THE RECORDING. `expo-audio` keeps the microphone
// and keeps producing the m4a that `performCapture` hashes into evidence; this
// only asks to listen alongside. Every failure path here is silent and leaves
// the recorder untouched, because mandate #1 outranks a nice indicator by a
// distance that is not close. If iOS refuses two consumers of the input, the
// contractor loses a moving line of text and loses nothing else.
//
// The language is the CONTRACTOR'S, not en-US. SFSpeechRecognizer needs a locale
// up front and cannot detect one, so a Spanish-speaking crew transcribed as
// English produces nonsense on screen — worse than no indicator, because it
// looks like the app misheard rather than like it was never listening.
const LOCALE: Record<string, string> = { en: 'en-US', es: 'es-ES' };

export type LiveHandle = { stop: () => void };

/**
 * Start showing words as they are spoken. Returns null if it could not start,
 * which the caller treats as "no live view" and nothing more.
 *
 * @param onText called with the running text, rough and frequently revised.
 */
export async function startLive(
  db: AbstractPowerSyncDatabase,
  onText: (text: string) => void
): Promise<LiveHandle | null> {
  let M: any;
  try { M = await import('expo-speech-recognition'); }
  catch (e: any) { void logDiag(db, 'live.import', String(e?.message ?? e)); return null; }
  const mod = M.ExpoSpeechRecognitionModule;
  const supports = !!mod?.supportsOnDeviceRecognition?.();
  // Read only. Requesting here would raise a dialog in the middle of the
  // contractor pressing record, which is the worst possible moment.
  const perm = await mod?.getPermissionsAsync?.();
  // Every early return is WRITTEN DOWN. This function failed invisibly on a
  // real phone and console.log turned out not to exist in Release builds — the
  // one place the bug lives is the one place the log went dark. The database
  // is the channel that survives.
  void logDiag(db, 'live.state', JSON.stringify({ supports, permission: perm?.status ?? 'unknown' }));
  if (!supports) return null;
  if (perm && perm.status !== 'granted') return null;

  let heard = 0;
  // THE BUG THAT ATE EVERY WORD lived on the next lines: a listener helper that
  // does not exist in this package version, called outside any try. Permission
  // granted, support present, and not one word — with nothing anywhere saying
  // why. The attach is now guarded and the guard WRITES ITS TRAIL.
  let subs: Array<{ remove: () => void }> = [];
  try {
    subs = [
    mod.addListener('result', (e: any) => {
      const t = e?.results?.[0]?.transcript;
      if (typeof t === 'string' && t.length) {
        heard++;
        // First words only. Logging every interim result would bury the console
        // under a partial transcript revised ten times a second.
        if (heard === 1) void logDiag(db, 'live.words', t.slice(0, 60));
        onText(t);
      }
    }),
    // Errors are swallowed on purpose: the recording is still running and the
    // contractor must not be told that anything failed, because nothing that
    // matters did.
    mod.addListener('error', (e: any) => {
      // Swallowed for the contractor, surfaced for the log. The recording is
      // still running and nothing that matters has failed.
      console.log('[live] error:', JSON.stringify(e?.error ?? e?.message ?? 'unknown'));
    }),
    ];
  } catch (e: any) {
    void logDiag(db, 'live.threw', 'attach: ' + String(e?.message ?? e).slice(0, 100));
    return null;
  }
  const stop = () => {
    void logDiag(db, 'live.stop', `results=${heard}`);
    try { mod.stop?.(); } catch { /* already stopped */ }
    try { subs.forEach((x) => x.remove()); } catch { /* already gone */ }
  };

  try {
    mod.start({
      lang: LOCALE[currentLang()] ?? 'en-US',
      interimResults: true,   // the whole point: partial text, as it arrives
      continuous: true,       // do not stop at the first pause in a walkthrough
      requiresOnDeviceRecognition: true,
      addsPunctuation: true,
    });
    void logDiag(db, 'live.started', LOCALE[currentLang()] ?? 'en-US');
  } catch (e: any) {
    void logDiag(db, 'live.threw', String(e?.message ?? e).slice(0, 120));
    stop(); return null;
  }
  return { stop };
}

/** Has the user never been asked? Only then is a dialog appropriate — iOS will
 *  not ask twice, and re-requesting a denial is noise the contractor cannot act
 *  on from inside the app. */
export async function needsPermissionAsk(): Promise<boolean> {
  try {
    const M: any = await import('expo-speech-recognition');
    const p = await M.ExpoSpeechRecognitionModule?.getPermissionsAsync?.();
    return p?.status === 'undetermined' || p?.canAskAgain === true && p?.status !== 'granted';
  } catch { return false; }
}

/** Raises the OS dialog. Call ONLY where a person is looking at the screen. */
export async function requestSpeechPermission(): Promise<string> {
  try {
    const M: any = await import('expo-speech-recognition');
    const p = await M.ExpoSpeechRecognitionModule?.requestPermissionsAsync?.();
    return p?.status ?? 'unknown';
  } catch { return 'unavailable'; }
}

/**
 * Recognise, cache locally, and queue the upload. The local write happens even
 * if the queue insert fails, because the preview card is what the contractor is
 * waiting on and it must not depend on the network in any way.
 */
export async function transcribeOnDevice(
  db: AbstractPowerSyncDatabase, captureId: string, uri: string
): Promise<{ ok: boolean; reason?: string }> {
  // ASK, ONCE, HERE — and deliberately not inside recognizeFile.
  //
  // recognizeFile only READS the permission so an automated check can call it
  // without raising a dialog that blocks until a human answers; a probe that did
  // that hung an entire run in this repo already. But read-only everywhere means
  // the answer stays `undetermined` forever and the feature never runs on a real
  // phone even once. The device check caught exactly that: onDevice=true,
  // permission=undetermined, recognition never attempted.
  //
  // This is the right moment to ask. The contractor has just finished recording,
  // he is holding the phone and looking at it, and the sentence he sees explains
  // the thing he just did. The capture is already durable by now and the caller
  // does not await this, so the dialog cannot delay or endanger it.
  if (await needsPermissionAsk()) {
    const got = await requestSpeechPermission();
    void logDiag(db, 'file.asked', `-> ${got}`);
  }

  const t = await recognizeFile(db, uri);
  // The outcome is written down either way — 'file.state' alone told us
  // recognition STARTED and nothing ever said how it finished.
  void logDiag(db, 'file.out',
    t ? `ok len=${t.text.length} segs=${t.segments?.length ?? 0}` : `null for ${uri.slice(-40)}`);
  if (!t) return { ok: false, reason: 'unsupported' };
  // Silence is a real result and must not become a stored transcript: an empty
  // row would win `capture_transcript_current`'s newest-wins and blank out a
  // good cloud reading. 368 refuses it server-side too; this is the near guard.
  if (!t.text.trim()) {
    // Record the VERDICT even though there is no transcript to store. Without this the
    // only trace of "we listened and heard nothing" is the absence of a row, which is
    // indistinguishable from "not done yet" — and the processing screen, which waits on
    // that row, waited forever. See VOICE_SILENT_DDL for why it is its own table.
    await db.execute(
      `INSERT OR IGNORE INTO voice_silent (capture_id, noted_at_ms) VALUES (?, ?)`,
      [captureId, Date.now()]
    ).catch(() => { /* pre-migration device: the screen falls back to its timeout */ });
    return { ok: false, reason: 'empty' };
  }

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
