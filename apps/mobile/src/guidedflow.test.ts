/**
 * The guided first change order's SEQUENCE.
 *   cd apps/mobile && node --test src/guidedflow.test.ts
 *
 * These are the tests the flow exists to make possible. Spread across App.tsx as six
 * booleans, "where is the user" would be checkable only by holding a phone, recording
 * something and walking ten screens — which means in practice it would be checked once,
 * by hand, on the happy path, and never again.
 *
 * The cases that matter are the ones a first-time user actually produces: he skips the
 * coaching, he skips the job, he force-quits mid-flow and comes back, the pipeline is
 * still thinking when he arrives. None of those are the happy path and all of them are
 * ordinary.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EMPTY_GUIDED, GUIDED_ORDER, guidedBack, guidedIndex, guidedStep,
  type GuidedState,
} from './guidedflow.ts';

const at = (o: Partial<GuidedState>): GuidedState => ({ ...EMPTY_GUIDED, ...o });

test('a brand-new user starts at the intro', () => {
  assert.equal(guidedStep(EMPTY_GUIDED), 'intro');
  assert.equal(guidedBack('intro', EMPTY_GUIDED), null, 'nothing behind the first screen');
});

test('"Show me what to say" goes to the coach; "I know what to do" skips it', () => {
  assert.equal(guidedStep(at({ introDone: true, wantsCoach: true })), 'coach');
  assert.equal(guidedStep(at({ introDone: true, wantsCoach: false })), 'capture');
});

test('leaving the coach reaches the RECORDER, and staying there is not a bounce back', () => {
  // Without a coachDone flag there was no state between the two, so `capture` was
  // unreachable and a user who opened the recorder without speaking would have been
  // returned to the coaching he had just read.
  const s = at({ introDone: true, wantsCoach: true, coachDone: true });
  assert.equal(guidedStep(s), 'capture');
  assert.equal(guidedBack('capture', s), 'coach', 'but back still returns to it');
});

test('the job question comes straight after the recording, before the pipeline', () => {
  // Deliberate: a capture with nowhere to live is the one thing this flow must not
  // leave behind, and it is asked while he still remembers what he just recorded.
  const s = at({ introDone: true, captured: true });
  assert.equal(guidedStep(s), 'job');
});

test('skipping the job is legal and does not strand the capture', () => {
  const s = at({ introDone: true, captured: true, jobSkipped: true });
  assert.equal(guidedStep(s), 'transcript', 'moves on, and the capture is still held');
});

test('a null transcript holds him on the transcript step rather than skipping ahead', () => {
  // "We are still reading it" is information. A blank draft screen is not.
  const s = at({ introDone: true, captured: true, jobId: 'p1', transcript: null });
  assert.equal(guidedStep(s), 'transcript');
});

test('the draft step needs a change order to exist, or it waits', () => {
  const waiting = at({ introDone: true, captured: true, jobId: 'p1', transcript: 'we opened the wall' });
  assert.equal(guidedStep(waiting), 'transcript', 'no change order yet -> still reading back');
  const ready = at({ ...waiting, changeOrderId: 'co1' });
  assert.equal(guidedStep(ready), 'draft');
});

test('a missing PRICE holds him at the gaps step — null is not zero', () => {
  const s = at({
    introDone: true, captured: true, jobId: 'p1', transcript: 't',
    changeOrderId: 'co1', draftAccepted: true, scheduleAnswered: true, amountCents: null,
  });
  assert.equal(guidedStep(s), 'gaps');
  // …and a price of zero is a real answer, not an absent one.
  assert.equal(guidedStep(at({ ...s, amountCents: 0 })), 'owner');
});

test('an unanswered schedule holds him too, and "not sure" counts as answered', () => {
  const base = {
    introDone: true, captured: true, jobId: 'p1', transcript: 't',
    changeOrderId: 'co1', draftAccepted: true, amountCents: 180000,
  };
  assert.equal(guidedStep(at({ ...base, scheduleAnswered: false })), 'gaps');
  assert.equal(guidedStep(at({ ...base, scheduleAnswered: true })), 'owner');
});

test('the full happy path visits every step in order', () => {
  let s = EMPTY_GUIDED;
  const seen: string[] = [];
  const advance: Array<Partial<GuidedState>> = [
    { introDone: true, wantsCoach: true },
    { coachDone: true },
    { captured: true },
    { jobId: 'p1' },
    { transcript: 'we opened the wall' },
    { changeOrderId: 'co1' },
    { draftAccepted: true },
    { amountCents: 180000, scheduleAnswered: true },
    { ownerId: 'a1' },
    { sent: true },
  ];
  seen.push(guidedStep(s));
  for (const step of advance) { s = { ...s, ...step }; seen.push(guidedStep(s)); }
  // CONSECUTIVE REPEATS COLLAPSED, because one of them is real behaviour rather than a
  // bug: the transcript arriving does not by itself produce a draft, so he WAITS on the
  // read-back screen while the change order is built. Two ticks, one screen.
  const walked = seen.filter((v, i) => v !== seen[i - 1]);
  assert.deepEqual(walked, GUIDED_ORDER);
  assert.equal(seen.filter((v) => v === 'transcript').length, 2,
    'he holds on the read-back while the draft is built');
});

// ── re-entry: the app was killed, or he backed out to look at something ────────────

test('re-entry lands on the work that actually stopped, not on a remembered cursor', () => {
  // Nothing here says "he was on step 6". The step is DERIVED, so a cold start with the
  // same database puts him in the same place.
  const midway = at({
    introDone: true, captured: true, jobId: 'p1', transcript: 't', changeOrderId: 'co1',
    draftAccepted: true, amountCents: 180000, scheduleAnswered: true,
  });
  assert.equal(guidedStep(midway), 'owner');
});

// ── back: the two steps that refuse to be re-entered ──────────────────────────────

test('BACK FROM THE JOB SCREEN DOES NOT RE-ENTER THE RECORDER', () => {
  // Mandate #1. Going back into the recorder would either discard the recording or
  // silently start a second one; the first is forbidden and the second is worse.
  assert.equal(guidedBack('job', at({ captured: true })), 'coach');
});

test('there is no way back from a sent change order', () => {
  assert.equal(guidedBack('done', at({ sent: true })), null);
});

test('there is no way back from the transcript — the recording is already made', () => {
  assert.equal(guidedBack('transcript', at({ captured: true })), null);
});

test('back from the recorder respects whether he asked to be coached', () => {
  assert.equal(guidedBack('capture', at({ wantsCoach: true })), 'coach');
  assert.equal(guidedBack('capture', at({ wantsCoach: false })), 'intro');
});

test('every other step walks back one', () => {
  const s = EMPTY_GUIDED;
  assert.equal(guidedBack('coach', s), 'intro');
  assert.equal(guidedBack('draft', s), 'transcript');
  assert.equal(guidedBack('gaps', s), 'draft');
  assert.equal(guidedBack('owner', s), 'gaps');
  assert.equal(guidedBack('review', s), 'owner');
});

test('the rail counts from 1 and ends at 10', () => {
  assert.equal(guidedIndex('intro'), 1);
  assert.equal(guidedIndex('review'), 9);
  assert.equal(guidedIndex('done'), 10);
  assert.equal(GUIDED_ORDER.length, 10);
});
