/**
 * Tests for R1's "Send to" prefill. Run: cd apps/mobile && node --test src/sendto.test.ts
 *
 * The acceptance criteria from PRD R1, as executable statements. The two that
 * carry real money: `selectedId` must be null with two jobs in range (the duplex),
 * and a bare phone number must never be silently turned into a number that cannot
 * receive the approval link.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendToPrefill, checkQuickAdd, canSend, displayPhone, MAX_RECENTS, type SendToProject } from './sendto.ts';

const p = (id: string, name: string, distanceM: number | null, lastUsedMs = 0,
           phoneE164: string | null = '+15125550147'): SendToProject =>
  ({ id, name, distanceM, lastUsedMs, phoneE164 });

const ELM = p('j1', 'Elm St', 12, 300);
const OAK = p('j2', 'Oak Ave', 8, 200);
const PINE = p('j3', 'Pine Rd', null, 100);
const CEDAR = p('j4', 'Cedar Ct', null, 50);

// ── the acceptance criteria ───────────────────────────────────────────────────

test('AC: one known project in GPS range pre-fills Send-to with a detected marker', () => {
  const r = sendToPrefill({ inRange: [ELM], others: [PINE, CEDAR], hasFix: true });
  assert.equal(r.kind, 'detected');
  assert.equal(r.selectedId, 'j1');
  assert.equal(r.reasonKey, 'r1.sendto.detected');
  assert.equal(r.reasonParams.name, 'Elm St');
});

test('AC: the detected job is changeable in one tap — the alternatives ship with it', () => {
  const r = sendToPrefill({ inRange: [ELM], others: [PINE, CEDAR], hasFix: true });
  // The other jobs are already on screen. If options were [ELM] alone, changing it
  // would mean opening a search box, which is not one tap.
  assert.deepEqual(r.options.map((o) => o.id), ['j1', 'j3', 'j4']);
});

test('AC: two projects in range give a two-option picker and NOTHING is auto-selected', () => {
  const r = sendToPrefill({ inRange: [ELM, OAK], others: [PINE], hasFix: true });
  assert.equal(r.kind, 'pick');
  assert.equal(r.selectedId, null);           // the duplex refusal
  assert.deepEqual(r.options.map((o) => o.id), ['j2', 'j1']);   // nearest first
  assert.equal(r.reasonParams.n, 2);
  // The recents must NOT be mixed in: the question is which of these two, and a
  // longer list invites picking the habitual job instead of the one he is at.
  assert.equal(r.options.length, 2);
});

test('a three-way ambiguity is still a picker, not a nearest-wins guess', () => {
  const r = sendToPrefill({ inRange: [ELM, OAK, p('j5', 'Ash Ln', 3, 0)], others: [], hasFix: true });
  assert.equal(r.kind, 'pick');
  assert.equal(r.selectedId, null);
});

test('AC: GPS unavailable shows recents, and nothing is pre-selected', () => {
  const r = sendToPrefill({ inRange: [], others: [PINE, CEDAR], hasFix: false });
  assert.equal(r.kind, 'recents');
  assert.equal(r.selectedId, null);
  assert.equal(r.reasonKey, 'r1.sendto.noLocation');
  assert.deepEqual(r.options.map((o) => o.id), ['j3', 'j4']);   // most recent first
});

test('a fix that matches nothing says so, and still does not pick the nearest', () => {
  const r = sendToPrefill({ inRange: [], others: [PINE, CEDAR], hasFix: true });
  assert.equal(r.kind, 'recents');
  assert.equal(r.selectedId, null);
  // Different reason from the no-fix case: "you are not at any job" and "I don't
  // know where you are" are different things to tell someone.
  assert.equal(r.reasonKey, 'r1.sendto.notAtAnyJob');
});

test('recents are capped so the list stays one-handed', () => {
  const many = Array.from({ length: 12 }, (_, i) => p(`x${i}`, `Job ${i}`, null, 1000 - i));
  const r = sendToPrefill({ inRange: [], others: many, hasFix: false });
  assert.equal(r.options.length, MAX_RECENTS);
  assert.equal(r.options[0].id, 'x0');
  assert.equal(sendToPrefill({ inRange: [], others: many, hasFix: false, maxRecents: 2 }).options.length, 2);
});

test('a brand new phone with no jobs at all dead-ends into quick-add, not into nothing', () => {
  const r = sendToPrefill({ inRange: [], others: [], hasFix: false });
  assert.equal(r.kind, 'empty');
  assert.equal(r.selectedId, null);
  assert.equal(r.reasonKey, 'r1.sendto.nothingYet');
});

test('ties in recency break by name, so the order never depends on row order', () => {
  const b = p('b', 'Bravo', null, 500);
  const a = p('a', 'Alpha', null, 500);
  assert.deepEqual(sendToPrefill({ inRange: [], others: [b, a], hasFix: false }).options.map((o) => o.name),
                   ['Alpha', 'Bravo']);
});

// ── quick-add (name + phone) ──────────────────────────────────────────────────

test('quick-add refuses a nameless destination', () => {
  assert.deepEqual(checkQuickAdd({ name: '   ', phone: '5125550147' }),
                   { ok: false, problemKey: 'r1.quickadd.needName' });
});

test('a 10-digit number is normalised to +1 and shown back for proof-reading', () => {
  const r = checkQuickAdd({ name: 'Dana', phone: '(512) 555-0147' });
  assert.deepEqual(r, { ok: true, name: 'Dana', phoneE164: '+15125550147' });
  assert.equal(displayPhone('+15125550147'), '+1 512 555 0147');
});

test('an international number is trusted as typed — no country code is invented', () => {
  assert.deepEqual(checkQuickAdd({ name: 'Luis', phone: '+52 55 1234 5678' }),
                   { ok: true, name: 'Luis', phoneE164: '+525512345678' });
});

test('a number we would have to guess at is REFUSED, never stored half-right', () => {
  // 7 digits: a local number with the area code missing. Storing it produces a
  // link that never arrives and a contractor who thinks he is being ignored.
  assert.equal(checkQuickAdd({ name: 'Sam', phone: '5550147' }).ok, false);
  assert.equal(checkQuickAdd({ name: 'Sam', phone: '123456789012345678' }).ok, false);
  assert.equal(checkQuickAdd({ name: 'Sam', phone: '+123' }).ok, false);
  assert.equal(checkQuickAdd({ name: 'Sam', phone: 'call the office' }).ok, false);
});

test('a name-only destination is allowed but cannot be sent to', () => {
  const r = checkQuickAdd({ name: 'The Millers', phone: '' });
  assert.deepEqual(r, { ok: true, name: 'The Millers', phoneE164: null });
  assert.equal(canSend(null), false);
  assert.equal(canSend('+15125550147'), true);
  assert.equal(canSend('5125550147'), false);
});

test('displayPhone never mangles a number it does not recognise', () => {
  assert.equal(displayPhone('+525512345678'), '+525512345678');
  assert.equal(displayPhone(null), '');
});
