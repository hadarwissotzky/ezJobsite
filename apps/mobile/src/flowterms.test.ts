/**
 * The flow terms' WORDING. Run: cd apps/mobile && node --test src/flowterms.test.ts
 *
 * These sentences are frozen into shown_content and signed, so a wording change is
 * a contract change and belongs in a diff someone had to look at. The goldens below
 * are deliberately literal — asserting `includes('Schedule')` would pass on a
 * sentence that said the opposite.
 *
 * The two instruments that render these (renderCard, renderEwaCard) have their own
 * tests for POSITION. This file owns the words themselves.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flowTermLines } from './flowterms.ts';

test('nothing answered renders the empty string, not empty headings', () => {
  assert.equal(flowTermLines({}), '');
  assert.equal(flowTermLines({
    billingTiming: null, scheduleEffect: null, scheduleDays: null, exclusions: null,
  }), '');
});

test('each field renders its own sentence and only its own', () => {
  assert.equal(flowTermLines({ exclusions: 'Permit fees' }), 'Not included: Permit fees\n');
  assert.equal(flowTermLines({ billingTiming: 'next_invoice' }), 'Billed on the next invoice.\n');
  assert.equal(flowTermLines({ billingTiming: 'when_completed' }),
    'Payment is due when the work is completed.\n');
  assert.equal(flowTermLines({ billingTiming: 'other' }), 'Payment timing as discussed.\n');
  assert.equal(flowTermLines({ scheduleEffect: 'no_change' }), 'Schedule: no change.\n');
});

test('adds_days: the count when there is one, honest vagueness when there is not', () => {
  assert.equal(flowTermLines({ scheduleEffect: 'adds_days', scheduleDays: 1 }),
    'Schedule: adds 1 day.\n');
  assert.equal(flowTermLines({ scheduleEffect: 'adds_days', scheduleDays: 3 }),
    'Schedule: adds 3 days.\n');
  // No count stored: say that days are added rather than invent a number or say
  // nothing. Zero and negatives are not counts and take the same branch.
  assert.equal(flowTermLines({ scheduleEffect: 'adds_days' }), 'Schedule: adds days.\n');
  assert.equal(flowTermLines({ scheduleEffect: 'adds_days', scheduleDays: 0 }),
    'Schedule: adds days.\n');
});

test('decision 3: "not sure yet" is shown as an open question, never as silence', () => {
  assert.equal(flowTermLines({ scheduleEffect: 'not_sure' }),
    'Schedule impact: to be confirmed.\n');
});

test('an unrecognised value renders NOTHING rather than a guessed term', () => {
  assert.equal(flowTermLines({ billingTiming: 'weekly??', scheduleEffect: 'maybe' }), '');
});

test('whitespace-only exclusions are not an exclusion', () => {
  assert.equal(flowTermLines({ exclusions: '   \n ' }), '');
  // …and a real one is trimmed, so the frozen text has no stray leading space.
  assert.equal(flowTermLines({ exclusions: '  Paint  ' }), 'Not included: Paint\n');
});

test('the block order is exclusions, payment, schedule — one line each', () => {
  const t = flowTermLines({
    exclusions: 'Drywall repair', billingTiming: 'when_completed',
    scheduleEffect: 'adds_days', scheduleDays: 2,
  });
  assert.equal(t,
    'Not included: Drywall repair\n' +
    'Payment is due when the work is completed.\n' +
    'Schedule: adds 2 days.\n');
});
