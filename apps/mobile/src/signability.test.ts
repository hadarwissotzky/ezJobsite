/**
 * THE GENERATED ONE-LINE CHANGE ORDERS (hadar, 2026-09-06: "generate during
 * validation some one line co and make sure they pass").
 *
 * Each fixture is a one-breath capture as the STRUCTURED EXTRACTION the worker's
 * model produces from it — the deterministic layer under test starts there, because
 * that is where the backend determination runs. The two paths that matter:
 *
 *   · the COMPLETE one-liner sails through with ZERO questions — the simple-process
 *     half of the balance (SPEC-single-line-co-v1 D6);
 *   · the under-communicated one-liner (CO #5's real ramble) yields EXACTLY the
 *     right questions, severity-ordered, capped at three — the successful-signage
 *     half.
 *
 * parseMoney is the REAL parser, not a stub: the split between "priced line" and
 * "open-ended" must be the one production makes (mandate #6 — one money parser).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSignability, type SignabilityInput } from './signability.ts';
import { parseMoney } from './money.ts';

/** The caller's derivation, mirrored: a priced segment parses to cents; price words
 *  with no readable figure make the segment OPEN-ENDED, never a guessed number. */
function splitSegments(tasks: { title: string; priceWords: string | null }[]) {
  const lineItems: { title: string; cents: number }[] = [];
  const openEndedTitles: string[] = [];
  for (const t of tasks) {
    if (t.priceWords === null) continue;
    const m = parseMoney(t.priceWords);
    if (m.cents !== null && m.confidence === 'high') {
      lineItems.push({ title: t.title, cents: m.cents });
    } else {
      openEndedTitles.push(t.title);
    }
  }
  return { lineItems, openEndedTitles };
}

// ── fixture 1: the complete one-liner — zero questions, nothing new shown ────────
test('a complete one-line CO passes with no questions at all', () => {
  // "Replace the rotted deck rail, $2,400 fixed, you pay when the work is done,
  //  adds two days. Paint stays out of it."
  const seg = splitSegments([
    { title: 'Deck rail replacement', priceWords: '$2,400' },
  ]);
  const r = evaluateSignability({
    ...seg,
    excluded: ['Painting of the new rail.'],
    billingTiming: 'when_completed',
    scheduleEffect: 'adds_days',
  });
  assert.equal(r.complete, true);
  assert.equal(r.gaps.length, 0);
});

// ── fixture 2: CO #5's real ramble — the specimen this spec was cut from ─────────
test("CO #5's one-breath ramble yields exactly its three gaps, in severity order", () => {
  const seg = splitSegments([
    { title: 'Hardwood floor installation', priceWords: 'The installation is gonna be $5,000' },
    { title: 'Trash and ecology fees', priceWords: 'fees are about $600 for trash for ecology' },
    { title: 'New baseboards', priceWords: 'whatever material is gonna be cost' },
  ]);
  // The real parse must split them this way, or the fixture is fiction.
  assert.equal(seg.lineItems.length, 2);
  assert.deepEqual(seg.openEndedTitles, ['New baseboards']);

  const r = evaluateSignability({
    ...seg,
    excluded: [
      'Supply of the hardwood flooring, which the client is providing.',
      'The trash and ecology disposal fees, which are charged in addition to the installation.',
      'The baseboard material, which is billed at whatever the material costs.',
      'Any hidden damage found to the subfloor once the existing flooring is removed.',
    ],
    billingTiming: null,          // he never said when he gets paid
    scheduleEffect: 'adds_days',  // "a week to demo" — the schedule WAS addressed
  });

  assert.equal(r.complete, false);
  assert.deepEqual(r.gaps.map((g) => g.kind), ['fee_conflict', 'open_cost', 'no_billing']);
  // The contradiction names the fee line, not the baseboards: sharing a subject
  // with an exclusion is legitimate (install inside, material out) — only the
  // "charged in addition" phrasing over an already-summed line is a conflict.
  assert.equal(r.gaps[0].kind === 'fee_conflict' && r.gaps[0].about, 'Trash and ecology fees');
});

// ── fixture 3: whole-job total, terms spoken — complete without line items ───────
test('a single whole-job figure with terms is complete', () => {
  const r = evaluateSignability({
    lineItems: [],                // "call it three grand for the whole thing"
    openEndedTitles: [],
    excluded: ['Hidden damage found once the wall is open.'],
    billingTiming: 'next_invoice',
    scheduleEffect: 'no_change',
  });
  assert.equal(r.complete, true);
});

// ── fixture 4: "not sure yet" is an ANSWER, not a gap ────────────────────────────
test('an explicit not_sure on schedule raises no question', () => {
  const r = evaluateSignability({
    lineItems: [{ title: 'Attic fan swap', cents: 90000 }],
    openEndedTitles: [],
    excluded: [],
    billingTiming: 'when_completed',
    scheduleEffect: 'not_sure',
  });
  assert.equal(r.complete, true);
});

// ── fixture 5: the cap — never more than three questions on one send ─────────────
test('gaps are capped at three, and complete stays false past the cap', () => {
  const r = evaluateSignability({
    lineItems: [
      { title: 'Dump run fees', cents: 40000 },
      { title: 'Permit runner fees', cents: 25000 },
    ],
    openEndedTitles: ['Tile (material)', 'Grout (material)'],
    excluded: [
      'Dump run fees are charged in addition to the work.',
      'Permit runner fees are billed in addition.',
    ],
    billingTiming: null,
    scheduleEffect: null,
  });
  assert.equal(r.complete, false);
  assert.equal(r.gaps.length, 3);
  assert.deepEqual(r.gaps.map((g) => g.kind), ['fee_conflict', 'fee_conflict', 'open_cost']);
});

// ── fixture 6: the other phrasing of the same contradiction ──────────────────────
test('"on top of" reads as the same in-addition contradiction', () => {
  const r = evaluateSignability({
    lineItems: [{ title: 'Haul-away and disposal', cents: 35000 }],
    openEndedTitles: [],
    excluded: ['Disposal and haul-away are billed on top of the quoted price.'],
    billingTiming: 'when_completed',
    scheduleEffect: 'no_change',
  });
  assert.equal(r.gaps[0]?.kind, 'fee_conflict');
});
