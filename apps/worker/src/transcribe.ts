/**
 * Speech to text. THE ONE FUNCTION THAT NEEDS A CREDENTIAL.
 *
 * Everything else in this worker runs and is tested without one. This is
 * deliberately the whole surface of the dependency: when a key and a provider
 * arrive, this is the only file that changes.
 *
 * IT RETURNS null RATHER THAN THROWING when there is no key. `processing_job`
 * has a `needs_api_key` blocked_reason and `block_job` takes a reason a person
 * can act on, so "no key" is a routine, expected, actionable state in this
 * design — not an exception. Throwing would make it look like a crash in the
 * backlog view, and REQ-PROC6 is specifically about a person being able to read
 * why work is parked.
 *
 * The provider is NOT chosen here. The PRD names Deepgram ("reuse the EzQuote
 * Pro pipeline patterns"), and SECRETS-ROTATION.md adds the constraint that
 * matters more than the choice: ezQuotePro shipped its Deepgram key inside the
 * client bundle, so the key is already public. Its instruction is "move STT
 * behind the backend so the key never reaches a client." That is why this file
 * lives in a worker and not in the app.
 */

import { readDeepgram } from './deepgram.ts';

export type Transcript = {
  text: string;
  /** REQ-PROC5: the SOURCE language, detected rather than assumed. */
  language: string | null;
  engine: string;
  model: string | null;
  durationSec: number | null;
};

/**
 * @param audio raw bytes; the caller fetches them from storage, so this stays a
 *              pure provider call and can be exercised with a fixture.
 * @returns the transcript, or `null` when no credential is configured — which
 *          the caller turns into `block_job(..., 'needs_api_key')`.
 * @throws  on a provider error or an unrecognised response shape. Never returns
 *          a partial or empty-by-accident transcript.
 */
/** Is a credential configured at all? Checked BEFORE any download: a keyless
 *  worker that fetches the audio first burns bandwidth on every job, on every
 *  attempt, to learn something it already knew. */
export function hasSttKey(): boolean {
  return !!process.env.DEEPGRAM_API_KEY;
}

export async function transcribe(
  audio: ArrayBuffer, contentType = 'audio/m4a'
): Promise<Transcript | null> {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return null;

  // detect_language is ON because REQ-PROC5 wants the source language detected
  // rather than assumed, and this product's core ICP includes Spanish-speaking
  // crews. punctuate because the transcript is read by a person in the preview
  // card, not only parsed for a number.
  const url = 'https://api.deepgram.com/v1/listen'
    + '?model=nova-2&smart_format=true&punctuate=true&detect_language=true';

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Token ${key}`, 'Content-Type': contentType },
    body: audio,
  });

  // A non-2xx is read for its body before throwing: Deepgram puts err_msg there,
  // and that string is what ends up in `processing_job.last_error` where a
  // person can act on it. "HTTP 401" alone sends them to the dashboard guessing.
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`deepgram HTTP ${res.status}: ${body.slice(0, 300)}`);
  }

  // readDeepgram THROWS on any shape it does not understand rather than
  // returning an empty transcript. See deepgram.ts: a silent '' would insert
  // cleanly, finish the job, mark the capture processed, and leave the
  // contractor a blank preview card after the audio is gone.
  return readDeepgram(await res.json());
}
