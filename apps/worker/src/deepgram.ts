/**
 * Reading a Deepgram response. Pure, and separated from the HTTP call on
 * purpose.
 *
 * HONEST ABOUT WHAT ITS TESTS PROVE. The response shape below is taken from
 * Deepgram's documented pre-recorded API, NOT from a live call — I have no key.
 * A test that feeds this parser a fixture I wrote myself, from the same
 * understanding that produced the parser, proves nothing about Deepgram: it is
 * circular, and this repo has shipped enough checks that verified nothing.
 *
 * SO THE VALUABLE ASSERTION IS THE OTHER ONE. Whatever Deepgram actually
 * returns, this must never invent a transcript. If the expected path is absent
 * -- because the shape differs, the API changed, or the response is an error
 * envelope -- it throws, the worker parks the job with the error attached, and
 * a person reads it in `processing_backlog`. The failure mode being designed
 * against is a SILENT EMPTY STRING: `capture_transcript.text` is `not null` but
 * not non-empty, so '' would insert cleanly, the job would finish, the capture
 * would be marked processed, and the contractor would open a blank preview card
 * with nothing anywhere saying why. That is unrecoverable without re-recording
 * the audio, which is gone.
 *
 * That guarantee holds whether or not my fixture matches reality, which is
 * exactly why it is the thing under test.
 */
import type { Transcript } from './transcribe.ts';

export class DeepgramShapeError extends Error {
  constructor(detail: string, body: unknown) {
    // The body is included, truncated: "shape mismatch" without the payload
    // sends the next person to the same dead end I would be at.
    super(`deepgram response not understood: ${detail} — got ${
      JSON.stringify(body ?? null).slice(0, 300)}`);
    this.name = 'DeepgramShapeError';
  }
}

/**
 * Pull the transcript out of a pre-recorded response.
 *
 * Throws `DeepgramShapeError` rather than returning a partial result. There is
 * no "best effort" reading of a legal instrument's source material.
 */
export function readDeepgram(body: any, durationFallback: number | null = null): Transcript {
  const alt = body?.results?.channels?.[0]?.alternatives?.[0];
  if (!alt) throw new DeepgramShapeError('no results.channels[0].alternatives[0]', body);

  const text = alt.transcript;
  if (typeof text !== 'string') throw new DeepgramShapeError('transcript is not a string', body);
  // An empty transcript is a REAL possible answer (silence), but it must be an
  // explicit one. Returning '' here is fine; what must not happen is '' arriving
  // because a field was missing. The check above is what separates the two.

  const model = body?.metadata?.models?.[0] ?? body?.metadata?.model_info
    ? Object.values(body?.metadata?.model_info ?? {})[0] as any : null;

  return {
    text,
    // REQ-PROC5 wants the language DETECTED. Deepgram returns it per channel
    // when detect_language is on; null when it was not asked for, which is
    // honest — better than defaulting to 'en' and being confidently wrong about
    // a Spanish-speaking crew, which is this product's core ICP.
    language: body?.results?.channels?.[0]?.detected_language
      ?? alt?.languages?.[0] ?? null,
    engine: 'deepgram',
    model: (model?.name as string) ?? body?.metadata?.models?.[0] ?? null,
    durationSec: typeof body?.metadata?.duration === 'number'
      ? body.metadata.duration : durationFallback,
  };
}
