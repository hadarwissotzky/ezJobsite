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
 * Text is implemented first, deliberately:
 *   - it is a REQUIREMENT (REQ-CAP2), not a workaround;
 *   - it needs no microphone, camera, or permission, so it is the one modality
 *     that can prove the whole path on a simulator;
 *   - it is what a crew member uses in a loud room or with a dead battery on
 *     the mic — the "type it" fallback the product needs anyway.
 */
import { Buffer } from 'buffer';

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

/** Voice capture: bytes come from the recorder. See recorder.ts. */
export function voiceCapture(bytes: Uint8Array): CaptureInput {
  return { modality: 'voice', bytes, mimeType: 'audio/m4a' };
}

/** Photo capture: bytes come from the camera. Not built yet (REQ-CAP2 gap). */
export function photoCapture(bytes: Uint8Array): CaptureInput {
  return { modality: 'photo', bytes, mimeType: 'image/jpeg' };
}
