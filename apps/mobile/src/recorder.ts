/**
 * Real microphone capture -> the capture-commit path.
 *
 * The only job here is to turn a recording into BYTES and hand them to
 * performCapture(). Everything about durability lives in capture.ts; this file
 * must not make any promise about saving.
 *
 * Note on ordering (this matters): the recorder writes its own file, and we do
 * NOT treat that file as the capture. We read it, hand the bytes to
 * performCapture(), and let that hash + install them under a content-addressed
 * path it controls. The recorder's temp file is an input, not the record.
 */
import { AudioModule, RecordingPresets, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import * as FS from 'expo-file-system/legacy';
import { Buffer } from 'buffer';

export async function requestMic(): Promise<boolean> {
  const p = await AudioModule.requestRecordingPermissionsAsync();
  if (!p.granted) return false;
  // REQUIRED on iOS before prepareToRecordAsync(), or it throws
  // "Calling the 'prepareToRecordAsync' function has failed". The audio session
  // must be put into a recording-capable mode first; permission alone is not
  // enough.
  await AudioModule.setAudioModeAsync({
    allowsRecording: true,
    playsInSilentMode: true,
    /**
     * KEEP THE SESSION WHEN THE APP IS NOT IN FRONT.
     *
     * Without this, iOS tears the audio session down as soon as the app is backgrounded
     * or the handset locks — and the recorder stops mid-sentence with nothing on screen
     * to say so. A contractor takes a call, or the auto-lock fires at thirty seconds
     * while he is still describing a wall, and the second half of what he said never
     * existed. That is silent capture loss, which mandate #1 calls the one unforgivable
     * failure.
     *
     * It pairs with `UIBackgroundModes: audio` in app.json — the entitlement is what
     * makes this flag mean anything, and neither works without a NEW BUILD. The screen
     * lock is held separately while the mic is open (capturescreen), so the ordinary
     * case never reaches this; this is the backstop for when it does.
     */
    shouldPlayInBackground: true,
  });
  return true;
}

/** Read the recorder's output into memory. Fine for short jobsite captures. */
export async function readRecordingBytes(uri: string): Promise<Uint8Array> {
  const b64 = await FS.readAsStringAsync(uri, { encoding: FS.EncodingType.Base64 });
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

export { RecordingPresets, useAudioRecorder, useAudioRecorderState };


/**
 * A recorder that runs OUTSIDE React — for the device check only.
 *
 * `useAudioRecorder` is a hook and cannot run in loopcheck's plain async world,
 * so the live mic-sharing test builds the same native recorder imperatively:
 * expo-audio's AudioRecorder class, the object the hook wraps. It records to a
 * scratch file, and `stopAndDiscard` deletes it — a mic-sharing probe must not
 * mint evidence.
 */
export class LoopcheckRecorder {
  private rec: any = null;

  async start(): Promise<void> {
    await AudioModule.setAudioModeAsync({
      allowsRecording: true, playsInSilentMode: true,
    } as any);
    this.rec = new (AudioModule as any).AudioRecorder(RecordingPresets.HIGH_QUALITY);
    await this.rec.prepareToRecordAsync();
    this.rec.record();
  }

  async stopAndDiscard(): Promise<void> {
    try {
      const uri = this.rec?.uri;
      await this.rec?.stop();
      if (uri) {
        const FS = await import('expo-file-system/legacy');
        await FS.deleteAsync(uri, { idempotent: true }).catch(() => {});
      }
    } catch { /* the probe recording owes nothing to anyone */ }
  }
}
