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
  });
  return true;
}

/** Read the recorder's output into memory. Fine for short jobsite captures. */
export async function readRecordingBytes(uri: string): Promise<Uint8Array> {
  const b64 = await FS.readAsStringAsync(uri, { encoding: FS.EncodingType.Base64 });
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

export { RecordingPresets, useAudioRecorder, useAudioRecorderState };
