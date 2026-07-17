/**
 * Capture modalities — REQ-CAP2: "Capture accepts voice, video, photo, text via
 * the device's internal capabilities, all fully offline."
 *
 * ARCHITECTURAL POINT (worth stating, because it is what makes this tractable):
 * performCapture() takes BYTES. It does not know or care what produced them.
 * So a modality is just "a thing that yields bytes + a mime type", and adding
 * video/photo later is a new producer, not a change to the durability path.
 * The safety model (capture.ts) stays untouched.
 *
 * Photo and video are producers on top of the SAME path: they yield bytes, and
 * capture.ts hashes, fsyncs and commits them exactly as it does a text capture.
 * Adding them changed nothing in the durability model -- which is the payoff for
 * having made performCapture() take bytes in the first place.
 *
 * Text is implemented first, deliberately:
 *   - it is a REQUIREMENT (REQ-CAP2), not a workaround;
 *   - it needs no microphone, camera, or permission, so it is the one modality
 *     that can prove the whole path on a simulator;
 *   - it is what a crew member uses in a loud room or with a dead battery on
 *     the mic — the "type it" fallback the product needs anyway.
 */
import { Buffer } from 'buffer';
import * as ImagePicker from 'expo-image-picker';
import * as FS from 'expo-file-system/legacy';

export type Modality = 'voice' | 'video' | 'photo' | 'text';

export type CaptureInput = {
  modality: Modality;
  bytes: Uint8Array;
  mimeType: string;
};

/** REQ-CAP2 text capture. UTF-8 bytes; the text IS the evidence. */
export function textCapture(text: string): CaptureInput {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('empty text capture');
  return {
    modality: 'text',
    bytes: new Uint8Array(Buffer.from(trimmed, 'utf8')),
    mimeType: 'text/plain; charset=utf-8',
  };
}

/**
 * Voice capture: bytes come from the recorder.
 *
 * The MIME is a parameter, not an assumption. It was hardcoded to audio/m4a --
 * true for the current recorder preset and false the moment anything else
 * produces audio. A capture whose stored MIME does not match its bytes CANNOT BE
 * PLAYED BACK: the file lands with the wrong extension in Storage and the player
 * cannot decode it. Found by feeding a real WAV through this path and watching the
 * player report `playing: true` while the position never moved. Silent, and it
 * would have been silent in production too -- the capture saves, the hash checks
 * out, and the evidence simply will not play when someone finally asks to hear it.
 */
export function voiceCapture(bytes: Uint8Array, mimeType = 'audio/m4a'): CaptureInput {
  return { modality: 'voice', bytes, mimeType };
}

/** Photo capture: bytes from the camera or the library. */
export function photoCapture(bytes: Uint8Array, mimeType = 'image/jpeg'): CaptureInput {
  return { modality: 'photo', bytes, mimeType };
}

/** Video capture: same path, different container. */
export function videoCapture(bytes: Uint8Array, mimeType = 'video/quicktime'): CaptureInput {
  return { modality: 'video', bytes, mimeType };
}

export type PickResult =
  | { ok: true; input: CaptureInput }
  | { ok: false; reason: 'cancelled' | 'denied' | 'unreadable'; detail?: string };

/**
 * Read a picked asset into bytes.
 *
 * The file is read from the device's own storage, so this works with no signal --
 * REQ-CAP2 requires all four modalities to work "fully using the device's internal
 * capabilities with no connectivity", and the camera does not care about wifi.
 *
 * Base64 is a real cost here: a 12MP photo is ~4MB, ~5.5MB as base64, and it is
 * held in memory twice while decoding. Tolerable for photos, and the reason video
 * is capped hard below. If this bites, the fix is a streaming read into the
 * capture path -- not a smaller promise to the user.
 */
async function readAsset(uri: string, modality: 'photo' | 'video', mime: string): Promise<PickResult> {
  try {
    const b64 = await FS.readAsStringAsync(uri, { encoding: FS.EncodingType.Base64 });
    const bytes = new Uint8Array(Buffer.from(b64, 'base64'));
    if (!bytes.length) return { ok: false, reason: 'unreadable', detail: 'empty file' };
    return {
      ok: true,
      input: modality === 'photo' ? photoCapture(bytes, mime) : videoCapture(bytes, mime),
    };
  } catch (e: any) {
    return { ok: false, reason: 'unreadable', detail: e?.message ?? String(e) };
  }
}

function mimeFor(uri: string, modality: 'photo' | 'video') {
  const ext = uri.split('.').pop()?.toLowerCase();
  if (modality === 'photo') return ext === 'png' ? 'image/png' : ext === 'heic' ? 'image/heic' : 'image/jpeg';
  return ext === 'mp4' ? 'video/mp4' : 'video/quicktime';
}

/**
 * Snap a photo. ONE deliberate touch (mandate #3's hands-free budget): the camera
 * opens straight to capture, with no album, no filter, no crop step. A gloved hand
 * on a ladder gets the shutter and nothing else.
 *
 * NO EDITING (`allowsEditing: false`) is a durability decision, not a UX one:
 * mandate #1 says media is immutable and never edited. Letting the OS hand back a
 * cropped derivative would make the bytes we hash and store something other than
 * what the camera saw.
 */
export async function snapPhoto(): Promise<PickResult> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return { ok: false, reason: 'denied' };

  const r = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    allowsEditing: false,   // immutable evidence: never a cropped derivative
    quality: 0.8,           // compressed at capture; the stored bytes ARE the evidence
    exif: false,            // we stamp GPS ourselves (see stamp.ts) rather than
                            // trust EXIF, which is trivially editable and often
                            // stripped by the OS anyway
  });
  if (r.canceled || !r.assets?.length) return { ok: false, reason: 'cancelled' };
  const a = r.assets[0];
  return readAsset(a.uri, 'photo', mimeFor(a.uri, 'photo'));
}

/**
 * Record a short video. Capped at 60s on purpose: this is a capture tool, not a
 * camcorder, and an uncapped clip is a multi-hundred-MB upload that will sit in
 * the outbox on jobsite LTE until it is the reason someone stops trusting the app.
 */
export async function recordVideo(): Promise<PickResult> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return { ok: false, reason: 'denied' };

  const r = await ImagePicker.launchCameraAsync({
    mediaTypes: ['videos'],
    videoMaxDuration: 60,
    quality: ImagePicker.UIImagePickerControllerQualityType.Medium,
  });
  if (r.canceled || !r.assets?.length) return { ok: false, reason: 'cancelled' };
  const a = r.assets[0];
  return readAsset(a.uri, 'video', mimeFor(a.uri, 'video'));
}

/** Pick something already shot -- the photo taken before anyone opened this app. */
export async function pickFromLibrary(): Promise<PickResult> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return { ok: false, reason: 'denied' };

  const r = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images', 'videos'],
    allowsEditing: false,
    quality: 0.8,
  });
  if (r.canceled || !r.assets?.length) return { ok: false, reason: 'cancelled' };
  const a = r.assets[0];
  const modality = a.type === 'video' ? 'video' : 'photo';
  return readAsset(a.uri, modality, mimeFor(a.uri, modality));
}
