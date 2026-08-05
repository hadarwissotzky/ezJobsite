/**
 * renderCard — the FROZEN INSTRUMENT's wording. These tests exist because
 * shown_content is what a client signs: a wording regression here is a
 * contract regression. Pure function, no network, no database.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderCard } from './confirmations.ts';

const BASE = {
  kind: 'confirm' as const,
  subject: 'Panel upgrade', value: 'Upgrade the main electrical panel.',
  directedBy: 'Owner', projectName: 'Miller — Hall Bath',
  whenMs: 1784800000000, companyName: 'EZ Remodeling',
};

test('a priced card carries price, and no flow lines when fields are absent', () => {
  const t = renderCard({ ...BASE, amountCents: 185000 });
  assert.ok(t.includes('Price: $1,850.00'));
  assert.ok(!t.includes('Not included'));
  assert.ok(!t.includes('Schedule'));
  assert.ok(!t.includes('Payment'));
});

test('the NTE clause is present when a cap exists (R3)', () => {
  const t = renderCard({ ...BASE, amountCents: 185000, nteCents: 250000 });
  assert.ok(t.includes('Not to exceed: $2,500.00'));
  assert.ok(t.includes('Work will not exceed $2,500.00 without a new approval.'));
});

test('flow terms render as owner-facing sentences', () => {
  const t = renderCard({
    ...BASE, amountCents: 185000,
    billingTiming: 'when_completed', scheduleEffect: 'adds_days', scheduleDays: 2,
    exclusions: 'Any drywall repair, paint outside of ceiling area, or permit fees.',
  });
  assert.ok(t.includes('Not included: Any drywall repair, paint outside of ceiling area, or permit fees.'));
  assert.ok(t.includes('Payment is due when the work is completed.'));
  assert.ok(t.includes('Schedule: adds 2 days.'));
  // Flow terms sit under the price, inside the TERMS block.
  assert.ok(t.indexOf('Price:') < t.indexOf('Not included:'));
});

test('the document leads with the scope, then who is asking, then the terms', () => {
  // hadar, 2026-08-05: "the recipient needs to be clear and upfront with the SOW,
  // who is it from and what are the terms -- but first the SOW". This ORDER is the
  // requirement, so it is asserted rather than left to whoever next edits the
  // template. A price ahead of the scope reads as a bill instead of a request.
  const t = renderCard({ ...BASE, amountCents: 185000 });
  assert.ok(t.indexOf('SCOPE OF WORK') < t.indexOf('FROM'), 'scope must precede the sender');
  assert.ok(t.indexOf('FROM') < t.indexOf('TERMS'), 'sender must precede the terms');
  assert.ok(t.indexOf('SCOPE OF WORK') < t.indexOf('Price:'), 'scope must precede the price');
  // The scope text itself is under its heading, not floating above it.
  assert.ok(t.indexOf('SCOPE OF WORK') < t.indexOf('Upgrade the main electrical panel.'));
  // Who it is from stays present and above the money.
  assert.ok(t.indexOf('EZ Remodeling') < t.indexOf('Price:'));
  // The closing promise is still last.
  assert.ok(t.trimEnd().endsWith('Nothing proceeds until you approve.'));
});

test('"not sure yet" renders honestly as to-be-confirmed (decision 3)', () => {
  const t = renderCard({ ...BASE, amountCents: 100, scheduleEffect: 'not_sure' });
  assert.ok(t.includes('Schedule impact: to be confirmed.'));
});

test('singular day, plural days, and adds-days-without-count', () => {
  const one = renderCard({ ...BASE, amountCents: 100, scheduleEffect: 'adds_days', scheduleDays: 1 });
  assert.ok(one.includes('Schedule: adds 1 day.'));
  const none = renderCard({ ...BASE, amountCents: 100, scheduleEffect: 'adds_days' });
  assert.ok(none.includes('Schedule: adds days.'));
});

test('billing wordings', () => {
  assert.ok(renderCard({ ...BASE, amountCents: 100, billingTiming: 'next_invoice' })
    .includes('Billed on the next invoice.'));
  assert.ok(renderCard({ ...BASE, amountCents: 100, billingTiming: 'other' })
    .includes('Payment timing as discussed.'));
});

test('an unknown enum value renders NOTHING rather than a wrong sentence', () => {
  const t = renderCard({ ...BASE, amountCents: 100,
    billingTiming: 'weekly??', scheduleEffect: 'maybe' });
  assert.ok(!t.includes('Payment'));
  assert.ok(!t.includes('Schedule'));
});

test('whitespace-only exclusions produce no Not-included line', () => {
  const t = renderCard({ ...BASE, amountCents: 100, exclusions: '   ' });
  assert.ok(!t.includes('Not included'));
});

test('the unpriced confirm card is untouched by flow fields', () => {
  const t = renderCard({ ...BASE, billingTiming: 'when_completed', exclusions: 'x' });
  assert.ok(t.startsWith('Please confirm'));
  assert.ok(!t.includes('Not included'));
  assert.ok(!t.includes('Payment'));
});
