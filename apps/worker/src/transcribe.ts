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

export type Transcript = {
  text: string;
  /** REQ-PROC5: the SOURCE language, detected rather than assumed. */
  language: string | null;
  engine: string;
  model: string | null;
  durationSec: number | null;
};

/**
 * @returns the transcript, or `null` when no credential is configured — which
 *          the caller turns into `block_job(..., 'needs_api_key')`.
 */
export async function transcribe(_captureId: string): Promise<Transcript | null> {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return null;

  // NOT IMPLEMENTED, and left honest rather than sketched. Writing an untested
  // HTTP call against an API whose response shape I cannot verify would produce
  // exactly what this repo keeps generating: code that looks finished, passes a
  // review, and has never once run. It needs the audio fetched from storage, the
  // provider's response parsed, and both checked against a real response.
  //
  // What IS settled and encoded above: the return shape the rest of the pipeline
  // consumes, where the key comes from, and that a missing key parks the job
  // instead of crashing the worker.
  throw new Error(
    'DEEPGRAM_API_KEY is set but the provider call is not implemented. ' +
    'Unset it to park jobs as needs_api_key, or implement transcribe().');
}
