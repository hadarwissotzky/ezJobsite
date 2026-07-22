/**
 * Tests for R7 quick-add. Run:
 *   cd apps/mobile && node --test src/quickadd.test.ts
 *
 * The phone parser is the reason this file exists. A number read wrong sends a
 * priced approval link to a stranger, and nothing on any screen would ever show
 * the contractor that it happened.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  jobName, normalizePhone, validateQuickAdd, isComplete,
} from './quickadd.ts';

// ── the job's identity ────────────────────────────────────────────────────────

test("PRD R7's own example composes exactly", () => {
  assert.equal(jobName('Sarah Miller', 'Hall bath'), 'Sarah Miller — Hall bath');
});

test('a missing half never produces a dangling dash', () => {
  assert.equal(jobName('Sarah Miller', ''), 'Sarah Miller');
  assert.equal(jobName('', 'Hall bath'), 'Hall bath');
  assert.equal(jobName('  ', ' '), '');
});

test('whitespace a thumb produced is collapsed, not preserved', () => {
  assert.equal(jobName('  Sarah   Miller ', ' Hall  bath  '), 'Sarah Miller — Hall bath');
});

// ── the phone ─────────────────────────────────────────────────────────────────

test('the shapes a US contractor actually types all reach the same E.164', () => {
  for (const typed of ['4155550134', '415-555-0134', '(415) 555-0134',
                       '415.555.0134', '415 555 0134', '14155550134',
                       '1 (415) 555-0134', '+1 415 555 0134']) {
    assert.equal(normalizePhone(typed), '+14155550134', `failed on ${typed}`);
  }
});

test('an international number keeps its own country code', () => {
  assert.equal(normalizePhone('+52 55 1234 5678'), '+525512345678');
  assert.equal(normalizePhone('+44 20 7946 0958'), '+442079460958');
});

test('anything we cannot read with confidence is refused, never guessed', () => {
  assert.equal(normalizePhone(''), null);
  assert.equal(normalizePhone('   '), null);
  assert.equal(normalizePhone('555-0134'), null, '7 digits: no area code, not dialable');
  assert.equal(normalizePhone('24155550134'), null, '11 digits not starting with 1');
  assert.equal(normalizePhone('415555013456789012'), null, 'longer than E.164 allows');
  assert.equal(normalizePhone('+123'), null, 'too short to reach anyone');
  assert.equal(normalizePhone('415-555-CALL'), null, 'vanity numbers are not numbers');
  assert.equal(normalizePhone('Sarah 4155550134'), null, 'a pasted name is not a number');
  assert.equal(normalizePhone('4155550134 ext 12'), null, 'an extension is not part of E.164');
});

test('the parser never returns something that is not E.164', () => {
  const samples = ['4155550134', '+44 20 7946 0958', 'nonsense', '', '+1',
                   '(212) 555 0100', '00447700900123'];
  for (const s of samples) {
    const out = normalizePhone(s);
    if (out === null) continue;
    assert.match(out, /^\+[1-9]\d{7,14}$/, `${s} produced a non-E.164 value: ${out}`);
  }
});

// ── the form gate ─────────────────────────────────────────────────────────────

test('client name and job label are both required', () => {
  assert.deepEqual(validateQuickAdd({ clientName: '', phone: '', jobLabel: 'Hall bath' }),
    { clientName: 'quick.needClient' });
  assert.deepEqual(validateQuickAdd({ clientName: 'Sarah', phone: '', jobLabel: '  ' }),
    { jobLabel: 'quick.needLabel' });
});

test('a blank phone is allowed — the link goes out through the share sheet', () => {
  const e = validateQuickAdd({ clientName: 'Sarah Miller', phone: '', jobLabel: 'Hall bath' });
  assert.deepEqual(e, {});
  assert.equal(isComplete(e), true);
});

test('a phone that WAS typed must be readable, or the job is not created', () => {
  const e = validateQuickAdd({ clientName: 'Sarah', phone: '555-0134', jobLabel: 'Hall bath' });
  assert.equal(e.phone, 'quick.badPhone');
  assert.equal(isComplete(e), false);
});

test('errors are i18n keys, never English sentences', () => {
  const e = validateQuickAdd({ clientName: '', phone: 'nope', jobLabel: '' });
  for (const v of Object.values(e)) {
    assert.match(v as string, /^quick\.[a-zA-Z]+$/, `"${v}" is prose, not a key`);
  }
});
