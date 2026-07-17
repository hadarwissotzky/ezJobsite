/**
 * "Saved ✓" you can hear and feel — REQ-CAP5, and the half of mandate #1 I missed.
 *
 * Mandate #1: a capture is "Confirmed AUDIBLY and visually."
 * Mandate #3: gloves, a ladder, noise, a hard maximum on deliberate touches.
 *
 * I shipped the visual half and called it done. A contractor holding a phone at
 * arm's length on a ladder, or dropping it in a pocket the moment he stops
 * talking, NEVER SEES THE SCREEN. For him the app had no confirmation at all --
 * and "did that save?" is the exact anxiety that makes someone stop trusting a
 * capture tool and go back to texting himself photos.
 *
 * THE RULES:
 *
 * 1. FIRES ONLY AT COMMITTED. REQ-CAP5 is explicit: not on the raw local write,
 *    not on a journal boolean, not on a manifest state, not on upload. This module
 *    is therefore called ONLY from the ok:true branch of performCapture, which
 *    already returns only after the SQLite transaction commits under
 *    synchronous=FULL. A confirmation on the local write IS the phantom-"saved"
 *    bug (Codex #6 C1), and a "saved ✓" for a capture that failed any oracle check
 *    is the worst-severity fault in this system.
 *
 * 2. FAILURE IS LOUD AND DIFFERENT. Falling tones, longer, plus an error haptic.
 *    A failure that sounds like a success is worse than silence, because the
 *    contractor walks away believing he has it.
 *
 * 3. HAPTIC IS THE PRIMARY CHANNEL, not the sound. A jobsite is loud, the phone
 *    may be in a pocket, and the ringer may be off -- but a hand always feels it.
 *    The sound is the backup, which is the opposite of how these are usually
 *    ranked and the right way round for this user.
 *
 * 4. NEVER THROWS. Feedback is the last thing that happens after a capture is
 *    already durable. If the speaker is busy or the taptic engine is unavailable,
 *    that must not turn a saved capture into an error path.
 */
import * as Haptics from 'expo-haptics';
import { AudioPlayer, createAudioPlayer, setAudioModeAsync } from 'expo-audio';

let savedPlayer: AudioPlayer | null = null;
let failedPlayer: AudioPlayer | null = null;

/**
 * Load once, at startup. A capture confirmation cannot wait on a file read: the
 * sound has to land WITH the moment, not a beat after it, or it stops reading as
 * a response to what the user just did.
 */
export async function initFeedback() {
  try {
    // Play even when the ringer switch is off. This is not a notification chime --
    // it is the app answering "did it save?", and a silent switch must not turn
    // that answer off.
    await setAudioModeAsync({ playsInSilentMode: true });
    savedPlayer = createAudioPlayer(require('../assets/sounds/saved.wav'));
    failedPlayer = createAudioPlayer(require('../assets/sounds/failed.wav'));
  } catch {
    // No sound. The haptic still fires and the screen still shows it. Degraded,
    // not broken -- and never a reason to fail a capture.
  }
}

/**
 * Call ONLY when the capture is COMMITTED. Not before. See rule 1.
 */
export async function signalSaved() {
  try {
    // Haptic first: it is the channel that survives a loud room and a pocket.
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (savedPlayer) { savedPlayer.seekTo(0); savedPlayer.play(); }
  } catch { /* rule 4 */ }
}

/** Loud, and unmistakably not the success sound. */
export async function signalFailed() {
  try {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    if (failedPlayer) { failedPlayer.seekTo(0); failedPlayer.play(); }
  } catch { /* rule 4 */ }
}

/**
 * The recorder armed. A light tick, not a confirmation -- it must never be
 * mistakable for "saved", so it is deliberately a different, slighter sensation.
 */
export async function signalArmed() {
  try { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch { /* rule 4 */ }
}
