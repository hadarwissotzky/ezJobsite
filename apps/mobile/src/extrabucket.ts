/**
 * WHICH PILE AN EXTRA BELONGS IN — asked once, answered exhaustively.
 *
 * Written 2026-08-24 after the same defect appeared three times in one day.
 *
 * `stateKey` (Home), `jobBucket` (the job screen) and `displayStatus` were three copies
 * of one question, each written as a chain of `if`s ending in a default:
 *
 *     status === 'approved' ? 'approved'
 *     : status === 'draft'  ? 'draft'
 *     : questions > 0 ? 'needs' : 'waiting';
 *
 * That last line silently absorbs every status nobody remembered. Adding `cancelled`
 * meant a withdrawn extra sat under "Waiting for a yes" — the app telling a contractor
 * he was waiting on a client he had just told to stop looking — and `displayStatus`
 * returned 'draft' for it, which offered Send on an instrument the client had been told
 * was off. Both were found by hadar, on his phone, one at a time. Writing this file
 * turned up a THIRD that nobody had found: `superseded`, a retired version, also landed
 * in "waiting".
 *
 * A `Record<StoredStatus, …>` cannot do that. Leave a status out and TypeScript refuses
 * to compile — which is exactly how `LEGAL_TRANSITIONS` and `PROGRESS` caught themselves
 * when `cancelled` was added, in the same hour the three chains did not.
 *
 * PURE, and in its own file so `node --test` can reach it. The two screens that used to
 * own a copy of this now import it.
 */
import { STORED_STATUSES, type StoredStatus, isStoredStatus } from './extrastatus.ts';

/**
 * What a row IS, at the granularity the chips need — declined and withdrawn stay apart
 * here because they wear different words and different colours.
 *
 * `sent` is absent on purpose: a sent extra is `waiting` or `needs` depending on whether
 * the client has asked something, which is the one place a signal outside the status
 * changes the answer.
 */
export type ExtraState =
  | 'draft' | 'waiting' | 'needs' | 'approved' | 'declined' | 'cancelled' | 'superseded';

/** What a LIST needs — the piles Home, the job screen and Activity actually offer. */
export type ExtraBucket = 'draft' | 'waiting' | 'needs' | 'approved' | 'closed';

/**
 * THE TABLE. Every stored status, named.
 *
 * `sent` resolves against the question count; everything else is a constant. A function
 * per entry rather than a value so the one status that depends on a signal cannot be
 * special-cased outside the table and drift from it.
 */
const STATE_OF: Readonly<Record<StoredStatus, (openQuestions: number) => ExtraState>> = {
  draft: () => 'draft',
  // The only entry that reads anything but the status. A client question outranks the
  // wait: he is not waiting on them, they are waiting on him.
  sent: (q) => (q > 0 ? 'needs' : 'waiting'),
  approved: () => 'approved',
  declined: () => 'declined',
  /**
   * A RETIRED VERSION IS NOT A LIVE ONE, and it used to read as one.
   *
   * Nobody reported this; it fell out of writing the table. `superseded` matched none of
   * the old chains' cases, so it took their default and appeared under "Waiting for a
   * yes" — an extra that was replaced weeks ago, counted in the pile of things a
   * contractor is chasing, and inflating the job screen's "Awaiting response" tile.
   */
  superseded: () => 'superseded',
  cancelled: () => 'cancelled',
};

/** The row's own state. `questions` is only consulted for a `sent` extra. */
export function extraState(status: string, openQuestions = 0): ExtraState {
  // An unrecognised string is not a licence — the same posture `stageOf` and
  // `isStoredStatus` take. A draft is the safe read: it is the only state that offers
  // nothing to a client and claims nothing about one.
  if (!isStoredStatus(status)) return 'draft';
  return STATE_OF[status](openQuestions);
}

/**
 * The pile. `declined`, `cancelled` and `superseded` all collapse into `closed`.
 *
 * ONE PILE, not three: they differ in WHO ended it, which the chip on each row already
 * says, and three more filter pills on a jobsite phone buys a distinction readable off
 * the card.
 */
export function extraBucket(status: string, openQuestions = 0): ExtraBucket {
  const s = extraState(status, openQuestions);
  return s === 'declined' || s === 'cancelled' || s === 'superseded' ? 'closed' : s;
}

/** Is this extra finished — by agreement, refusal, withdrawal or replacement? */
export function isClosed(status: string): boolean {
  return extraBucket(status) === 'closed';
}

/** Every status the table covers, for a test that wants to walk all of them. */
export const ALL_STORED: readonly StoredStatus[] = STORED_STATUSES;
