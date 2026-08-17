/**
 * LIVE DICTATION — speak, and watch the words land in the field.
 *
 * hadar 2026-08-13: "the record button in the chat invokes the built-in record and
 * transcribe in real time and add to the edit field."
 *
 * DIFFERENT FROM `ondevicestt.ts`, which recognises a recorded FILE after the fact and
 * writes a transcript row as evidence. This one streams: it exists only to fill a text
 * box a human is about to read and press send on. Nothing here is evidence, nothing is
 * stored, and nothing is sent — which is exactly why it may stream interim results that
 * change under the reader's eyes. The moment a figure or a commitment rides on a
 * transcript, `ondevicestt` and the read-back are the path, not this (mandate #2, #6).
 *
 * ON-DEVICE IS REQUIRED, NOT PREFERRED. With `requiresOnDeviceRecognition` false, iOS
 * may route the microphone to Apple's servers — turning a feature that works in a
 * crawlspace with no bars into a network round trip that also ships a contractor's
 * voice somewhere nobody told him about. If the handset cannot do it locally this
 * refuses and says so, rather than silently going online.
 */
import { logDiag } from './diaglog.ts';
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';

export type DictationHandle = { stop: () => void };

export type DictationRefusal =
  | 'unsupported'   // the handset has no on-device recogniser for this language
  | 'denied'        // speech or microphone permission refused
  | 'unavailable';  // the module would not load or would not start

/**
 * Join what was already typed to what is being said.
 *
 * A SEPARATE PURE FUNCTION because it is the one part with a decision in it, and the
 * decision is "never destroy what he typed". Dictation APPENDS: somebody who has
 * written half a sentence and then reaches for the mic is adding to it, and a
 * recogniser that replaced the field would delete work no undo covers.
 */
export function mergeDictation(base: string, heard: string): string {
  const b = base.trimEnd();
  const h = heard.trim();
  if (!h) return base;
  if (!b) return h;
  return `${b} ${h}`;
}

/**
 * Start listening. Resolves with a handle, or with the reason it refused.
 *
 * The caller supplies `onText` and gets EVERY update — interim and final. It should
 * render them straight into the field: watching the words appear is the whole point,
 * and buffering until the end would give back exactly the delay this replaces.
 */
export async function startDictation(o: {
  db?: AbstractPowerSyncDatabase;
  /** BCP-47, following the reader's language (mandate #5). */
  lang: string;
  onText: (heard: string, isFinal: boolean) => void;
  onEnd: (refusal?: DictationRefusal) => void;
}): Promise<DictationHandle | { refused: DictationRefusal }> {
  let M: any;
  try { M = await import('expo-speech-recognition'); }
  catch (e: any) {
    if (o.db) void logDiag(o.db, 'dict.import', String(e?.message ?? e));
    return { refused: 'unavailable' };
  }
  const mod = M.ExpoSpeechRecognitionModule;
  if (!mod?.supportsOnDeviceRecognition?.()) return { refused: 'unsupported' };

  // REQUEST, don't just read — the opposite of `ondevicestt.recognizeFile`, and for a
  // reason: this runs because a person just tapped a microphone and is watching the
  // screen, which is the only moment a permission dialog is not an ambush.
  try {
    const perm = await mod.requestPermissionsAsync?.();
    if (perm && perm.status !== 'granted') return { refused: 'denied' };
  } catch { return { refused: 'denied' }; }

  let subs: Array<{ remove: () => void }> = [];
  let stopped = false;
  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    try { subs.forEach((s) => s.remove()); } catch { /* already gone */ }
  };

  try {
    subs = [
      mod.addListener('result', (e: any) => {
        const r = e?.results?.[0];
        if (!r) return;
        o.onText(String(r.transcript ?? ''), !!e.isFinal);
      }),
      // A refusal that says nothing is the failure this repo names most often. The
      // reason reaches the diag log AND the caller, which puts it on the screen.
      mod.addListener('error', (e: any) => {
        if (o.db) {
          void logDiag(o.db, 'dict.err',
            JSON.stringify(e?.error ?? e?.message ?? e ?? 'unknown').slice(0, 200));
        }
        cleanup();
        o.onEnd('unavailable');
      }),
      mod.addListener('end', () => { cleanup(); o.onEnd(); }),
    ];
    mod.start({
      lang: o.lang,
      interimResults: true,
      continuous: true,
      requiresOnDeviceRecognition: true,
    });
  } catch (e: any) {
    if (o.db) void logDiag(o.db, 'dict.start', String(e?.message ?? e).slice(0, 120));
    cleanup();
    return { refused: 'unavailable' };
  }

  return {
    stop: () => {
      try { mod.stop(); } catch { /* already stopped; `end` still cleans up */ }
      cleanup();
    },
  };
}
