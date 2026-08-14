/**
 * THE GUIDED FIRST CHANGE ORDER — the sequence, as data.
 *
 * hadar, 2026-08-12: "generate a workflow for a user that never used the application
 * before and never recorded, or rarely uses technology, to successfully create a change
 * order", against a ten-screen reference flow.
 *
 * ─── WHY THE SEQUENCE IS A MODULE AND NOT A PILE OF `useState` ──────────────────
 * The app can already do every ACT in this flow: it records, it makes a job, it drafts,
 * it prices, it picks an owner, it sends. What it has never had is an ORDER — a thing
 * that knows a first-time user is on step 4 of 10, what he has finished, what he may
 * skip, and where "back" goes. Spread across App.tsx that knowledge would live in six
 * booleans whose legal combinations nobody could enumerate, and the failure mode is not
 * a crash: it is a man stranded on a screen with no way forward, holding the recording
 * he just made. Here it is one type, one transition function, and tests.
 *
 * ─── WHAT THIS FILE IS NOT ──────────────────────────────────────────────────────
 * It renders nothing and touches no database. It answers exactly one question — given
 * what has happened, which step is the user on — so the answer can be tested without a
 * simulator, a microphone or an account. Every screen it names already exists or is
 * being built beside it; this is the spine they hang from.
 *
 * ─── THE ONE RULE THAT IS NOT ABOUT CONVENIENCE ─────────────────────────────────
 * `capture` is the only step whose completion is not reversible by going back, and the
 * flow may never re-enter it in a way that discards what was captured. Mandate #1: a
 * recording that exists must never be lost to navigation. `back()` from `job` therefore
 * does NOT return to the recorder — it returns to the coach screen, which is inert.
 */

/** The ten steps, in the order the reference flow walks them. */
export type GuidedStep =
  /** 1 — set expectations. What is about to happen, and that nothing sends itself. */
  | 'intro'
  /** 2 — coach. The four things worth saying, and a worked example to hear. */
  | 'coach'
  /** 3 — record. The existing capture screen, with the prompts kept within reach. */
  | 'capture'
  /** 4 — name the job. Skippable: a capture with no job is held, never lost (REQ-P2). */
  | 'job'
  /** 5 — read back what we heard, with the audio beside it. */
  | 'transcript'
  /** 6 — the draft we built from it. */
  | 'draft'
  /** 7 — fill the gaps: price, schedule, notes. */
  | 'gaps'
  /** 8 — who should see this. */
  | 'owner'
  /** 9 — review before sending. The last screen before a commitment (mandate #2). */
  | 'review'
  /** 10 — sent. */
  | 'done';

export const GUIDED_ORDER: GuidedStep[] = [
  'intro', 'coach', 'capture', 'job', 'transcript',
  'draft', 'gaps', 'owner', 'review', 'done',
];

/**
 * What the flow knows about the user's progress. Every field is a FACT ABOUT THE WORLD,
 * not a screen name: the step is derived from these, never stored, so the flow cannot
 * disagree with the database about what exists.
 */
export type GuidedState = {
  /** He has seen the intro and chosen a way in. */
  introDone: boolean;
  /** He asked to be coached, or skipped straight to recording. `false` is not a
   *  failure — the reference flow offers "I know what to do" on the first screen. */
  wantsCoach: boolean;
  /**
   * He has finished with the coach screen and pressed Start recording.
   *
   * A SEPARATE FLAG FROM `captured`, and the tests are why: without it there was no
   * state meaning "coached, standing in front of the recorder, nothing recorded yet" —
   * so `capture` was unreachable, and a user who tapped Start recording and then did
   * not speak would have been sent back to the coaching he had just read.
   */
  coachDone: boolean;
  /** A capture exists on the device. Once true it never goes false: mandate #1. */
  captured: boolean;
  /** The capture is filed to a real job (not the inbox). */
  jobId: string | null;
  /** He chose to name the job later. Skipping is legal and the capture is still held. */
  jobSkipped: boolean;
  /** The pipeline has produced words for him to check. Null while it is still running. */
  transcript: string | null;
  /** A change order row exists, built from the capture. */
  changeOrderId: string | null;
  /** He has read the draft and accepted it as a starting point. */
  draftAccepted: boolean;
  /** Price is set — `null` is NOT zero (changeorder.ts). Until this is a number the
   *  extra cannot be sent, and the gaps step is where it gets answered. */
  amountCents: number | null;
  /** Schedule has been answered, including "not sure", which IS an answer (FLOW #3). */
  scheduleAnswered: boolean;
  /** Somebody has been chosen to receive it. */
  ownerId: string | null;
  /** The send has completed. */
  sent: boolean;
};

export const EMPTY_GUIDED: GuidedState = {
  introDone: false, wantsCoach: false, coachDone: false, captured: false,
  jobId: null, jobSkipped: false,
  transcript: null, changeOrderId: null, draftAccepted: false, amountCents: null,
  scheduleAnswered: false, ownerId: null, sent: false,
};

/**
 * WHERE THE USER IS, derived from what exists.
 *
 * Read top-down: the FIRST unmet precondition is the step. That ordering is the whole
 * design — it means the flow can be re-entered at any time (the app was killed, the
 * phone died mid-record, he backed out to look at something) and it will put him back
 * exactly where the work actually stopped, because it asks the world rather than
 * remembering a cursor.
 */
export function guidedStep(s: GuidedState): GuidedStep {
  if (s.sent) return 'done';
  if (!s.introDone) return 'intro';
  // The coach is offered, not imposed. "I know what to do" sets wantsCoach false and
  // this falls straight through to the recorder.
  if (s.wantsCoach && !s.coachDone && !s.captured) return 'coach';
  if (!s.captured) return 'capture';
  // A capture with nowhere to live is the one thing this flow must never leave behind,
  // so the job question comes IMMEDIATELY after the recording and before anything that
  // depends on the pipeline. Skipping is allowed; ignoring is not.
  if (!s.jobId && !s.jobSkipped) return 'job';
  // Null transcript = the pipeline has not finished. The caller shows the waiting state
  // ON the transcript step rather than skipping ahead, because "we are still reading
  // it" is information and a blank next screen is not.
  if (s.transcript === null) return 'transcript';
  if (!s.draftAccepted) return s.changeOrderId ? 'draft' : 'transcript';
  if (s.amountCents === null || !s.scheduleAnswered) return 'gaps';
  if (!s.ownerId) return 'owner';
  return 'review';
}

/**
 * The step BACK from here, or null when there is nowhere to go.
 *
 * Not simply the previous entry in GUIDED_ORDER. Two steps refuse to be re-entered:
 *
 *   * `capture` — going back into the recorder from the job screen would either discard
 *     the recording or silently start a second one. Mandate #1 forbids the first and
 *     the second is worse. Back from `job` lands on `coach`, which is inert.
 *   * `done` — the change order has been sent and a counterparty may already be reading
 *     it. There is no back from an act that left the phone (REQ-LC15).
 */
export function guidedBack(step: GuidedStep, s: GuidedState): GuidedStep | null {
  switch (step) {
    case 'intro': return null;
    case 'coach': return 'intro';
    case 'capture': return s.wantsCoach ? 'coach' : 'intro';
    case 'job': return 'coach';
    case 'transcript': return null;   // the recording is made; there is nothing behind it
    case 'draft': return 'transcript';
    case 'gaps': return 'draft';
    case 'owner': return 'gaps';
    case 'review': return 'owner';
    case 'done': return null;
  }
}

/** 1-based position for the "step N of 10" rail. `done` reports the full count so the
 *  rail reads complete rather than wrapping to zero. */
export function guidedIndex(step: GuidedStep): number {
  return GUIDED_ORDER.indexOf(step) + 1;
}

/**
 * The four things worth saying into the recorder, in the order the reference flow puts
 * them. Exported because THREE screens need the same list and the same wording — the
 * coach screen teaches them, the recorder keeps them within reach as prompts, and the
 * gaps screen asks for whichever went unanswered. Three copies would drift, and the
 * drift would show up as the app asking for something it already told him to say.
 */
export const COACH_PROMPTS = [
  { key: 'changed', title: 'gf.p1t', body: 'gf.p1b' },
  { key: 'needed', title: 'gf.p2t', body: 'gf.p2b' },
  { key: 'cost', title: 'gf.p3t', body: 'gf.p3b' },
  { key: 'schedule', title: 'gf.p4t', body: 'gf.p4b' },
] as const;
