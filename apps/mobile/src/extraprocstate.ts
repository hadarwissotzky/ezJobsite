/**
 * An extra's pipeline state — the WEAKEST state across the captures it is made of.
 *
 * An "extra" is a voice recording PLUS its photos. `status.ts:procState` answers
 * that question for ONE capture; nothing answered it for the group, so the send
 * screen had to pick a capture to believe. Picking the recording (the obvious
 * choice — it is the one that carries the price) reports 'processed' while a photo
 * is still sitting in the outbox, and the change order goes out missing the
 * evidence for the work it charges for. That is mandate #1 losing a capture at the
 * last possible moment: the file is still on the phone, but the document that was
 * supposed to carry it has already left without it.
 *
 * PURE. One type-only import and nothing else — same rule as `extrastatus.ts` and
 * `sendto.ts`, and for the same three reasons: this decides whether a priced,
 * binding document may be sent, it is a pure function of its inputs, and
 * `extraprocstate.test.ts` can only run at all (node --test strips the types and
 * resolves nothing else) if this file pulls in no runtime module. `import type` is
 * erased before Node ever sees it; a value import of `status.ts` would drag in
 * `i18n.ts` and the tests would stop running.
 *
 * THE WEAKEST WINS, and read `status.ts`'s header for why the states mean what they
 * mean. The short version: the queue IS the state, and 'uploaded'/'processed' are
 * things the SERVER said, never things this device concluded from silence. Take the
 * strongest state across a group and you rebuild that bug one level up — the group
 * would be claiming a readiness that only its luckiest member actually has.
 */
import type { ProcState } from './status.ts';

/**
 * Weakness order: captured < queued < uploaded < processed.
 * Lower rank = less ready = wins. Same shape as `status.ts`'s RANK, and the same
 * idea: the group reports the least-good true thing, never the best one.
 */
const RANK: Record<ProcState, number> = {
  captured: 0,
  queued: 1,
  uploaded: 2,
  processed: 3,
};

/**
 * The state of the whole extra: an extra is only as ready as its least-ready part.
 *
 * THE EMPTY ARRAY RETURNS 'captured', and the choice matters more than it looks.
 *
 * 'processed' is the one answer that must never come back, because 'processed' is
 * the only answer that opens the send gate below. Returning the STRONGEST state for
 * the EMPTIEST input is the "a check that verified nothing reported success"
 * failure in its purest form — a group with no captures has had nothing uploaded
 * and nothing processed, so every fact 'processed' asserts is unverified.
 *
 * 'captured' is the weakest state and therefore the safe one: it cannot open the
 * gate, and `canSendExtra` will explain the refusal in the user's words rather than
 * leaving a dead button. It is a slight overclaim in the other direction — nothing
 * was captured either — but that error costs a refused send the contractor can act
 * on, where the opposite error costs an unbacked change order that is already gone.
 *
 * An empty group is a bug upstream in any case (an extra always has at least its
 * recording), and this is not the place to fix it. It is the place to make sure
 * that bug cannot become a send.
 */
export function extraProcState(captures: readonly ProcState[]): ProcState {
  // Explicit, and NOT a seed value on the reduce below. Seeding with 'processed'
  // reads as harmless — the fold walks it down to the true weakest — but it hands
  // 'processed' straight back for an empty group, which is the one answer this
  // function must never give. The empty case is checked, not fallen through.
  if (captures.length === 0) return 'captured';

  return captures.reduce((weakest, c) => (RANK[c] < RANK[weakest] ? c : weakest));
}

/**
 * May this extra be sent?
 *
 * ONLY from 'processed'. The other three are not "probably fine" — each one names
 * a specific thing that has not been confirmed by the party that owns the fact, and
 * mandate #6 puts the burden on the sender: an unconfirmed number must never be
 * sent, and the price on an extra is not confirmed until the pipeline that read it
 * has finished and said so. Gating on anything weaker means the client receives a
 * document built from a transcript that may still change.
 *
 * `whyKey` is a KEY, never a sentence — i18n.ts's header explains why a module that
 * returns baked prose cannot be localized. It is present on every refusal, because
 * a disabled Send button with no reason is the thing that makes a man on a ladder
 * tap it eleven times. The keys are added to i18n.ts by a separate step.
 *
 * WHY THESE THREE REASONS. They are the user-facing translation of the three states,
 * and they deliberately do not include "uploading" — there is no state that means
 * "bytes in flight", because the queue IS the state:
 *
 *   captured -- nothing has confirmed it left this phone. Not an error and not a
 *               fault: mandate #7 says no signal is the expected condition.
 *   queued   -- the outbox still holds the intent. This is literally waiting for
 *               signal, and it is the honest word for it.
 *   uploaded -- the server has the bytes and its pipeline has not said 'processed'.
 *               Waiting on them, not on us.
 */
export function canSendExtra(s: ProcState): { ok: boolean; whyKey?: string } {
  switch (s) {
    case 'processed':
      return { ok: true };
    case 'uploaded':
      return { ok: false, whyKey: 'send.notReady.processing' };
    case 'queued':
      return { ok: false, whyKey: 'send.notReady.waitingForSignal' };
    case 'captured':
      return { ok: false, whyKey: 'send.notReady.notSentYet' };
  }
}
