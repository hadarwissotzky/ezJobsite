/**
 * Which steps a claimed job still owes. Pure, so resume behaviour is testable
 * without a database or a paid API call.
 *
 * WHY THIS IS ITS OWN FUNCTION. `processing_job` carries `steps` and
 * `completed_steps` precisely so a job that died after transcribing does not
 * transcribe again — the SQL says so in as many words: "that is a paid API call
 * and a different answer." Getting this wrong costs money per crash and can
 * change a transcript that has already been shown to someone. It is the single
 * most expensive thing in the worker to get wrong, so it is the piece that does
 * not touch the network.
 */

/**
 * The steps a capture can owe.
 *
 * FOUR, not three. I wrote three from memory and a real enqueue proved it wrong:
 * `resolve_project` sits between detect_language and structure, and `finish_job`
 * correctly refused a job whose first three steps were complete. The worker
 * itself survived the mistake because `pendingSteps` reads the list off the JOB
 * rather than from a constant here — which is exactly why the SQL stores it per
 * job and says so.
 *
 * An audio capture owes all four. A `text` capture owes three: 140's trigger
 * drops `transcribe`, because there is nothing to transcribe.
 */
export type Step = 'transcribe' | 'detect_language' | 'resolve_project' | 'structure';

/**
 * Order comes from `steps`, NOT from a constant here. The job declares its own
 * sequence — a photo declares none — and re-deriving it in the worker is how the
 * two drift apart.
 */
export function pendingSteps(
  steps: readonly string[], completed: readonly string[]
): string[] {
  const done = new Set(completed);
  return steps.filter((s) => !done.has(s));
}

/**
 * A job with nothing outstanding is finishable. Kept separate from
 * `pendingSteps` because "no steps left" and "zero steps declared" are the same
 * answer here and must stay that way: a photo declares no steps and is complete
 * on arrival, which is exactly the case `finish_job`'s `is not false` guard
 * exists to handle. If this returned false for the empty list, a photo would sit
 * in the queue forever.
 */
export function isComplete(
  steps: readonly string[], completed: readonly string[]
): boolean {
  return pendingSteps(steps, completed).length === 0;
}
