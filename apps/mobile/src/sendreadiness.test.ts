/**
 * Tests for D3's send gate. Run:
 *   cd apps/mobile && node --test src/sendreadiness.test.ts
 *
 * TWO FAILURES THESE EXIST TO CATCH, and neither shows up by reading the code:
 *
 *   1. A $0 EXTRA TREATED AS UNPRICED, or an unpriced one treated as free.
 *      `amount_cents` is nullable precisely because "he never said a price" and
 *      "this costs nothing" are different facts, and every falsy check written in
 *      a hurry (`if (!amountCents)`) collapses them. One of those two directions
 *      tells a homeowner the work is free.
 *   2. A RECOMMENDED ITEM CREEPING INTO THE HARD GATE. D3 says photos, payment
 *      timing, schedule impact and exclusions warn and never block. That is one
 *      `if` away from being wrong, and the day it goes wrong the app stops being
 *      sendable from a jobsite.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  sendReadiness, sendGate, blockerKey, recommendationKey, UNTITLED_SCOPE, RECOMMENDED,
  MIN_SCOPE_OF_WORK_CHARS,
  type SendRecommendation,
} from './sendreadiness.ts';

/**
 * This directory, as a plain path. Deliberately NOT `new URL(…, import.meta.url)`:
 * this project's tsconfig pulls in Expo's DOM lib, so `URL` here is the DOM URL and
 * `tsc` refuses to hand it to node:fs — a typecheck failure in the only tests the
 * repo has. Decoded because a checkout under a path with a space would otherwise
 * arrive percent-escaped and the read would fail with a file-not-found that looks
 * like the guarded file was deleted.
 */
const HERE = decodeURIComponent(
  import.meta.url.replace(/^file:\/\//, '').replace(/\/[^/]+$/, ''));

/** A complete, sendable, priced extra. Each test spoils exactly one thing. */
const full = {
  kind: 'extra' as const,
  scope: 'Replace the cracked water heater in the utility room',
  amountCents: 185000,
  nteCents: null,
  priceMode: 'fixed' as const,
  photoCount: 3,
  billingTiming: 'next_invoice',
  scheduleEffect: 'adds_days',
  exclusions: 'drywall repair',
};

// ── REQ-LC10 / D3: what blocks, and what emphatically does not ────────────────

test('a complete extra is ready and complete', () => {
  const r = sendReadiness(full);
  assert.equal(r.ok, true);
  assert.deepEqual(r.blockers, []);
  assert.deepEqual(r.recommended, []);
  assert.deepEqual(r.completeness, { have: 4, of: 4 });
});

// hadar 2026-07-28 reversed D3: ALL SIX items block Send, per the design's "these
// are required for approval". These three tests asserted the old rule and are
// rewritten to the new one — the assertions are inverted deliberately, not relaxed.
test('DESCRIPTION AND PHOTOS BLOCK; the terms only warn (hadar 2026-08-07)', () => {
  const r = sendReadiness({
    ...full, photoCount: 0, amountCents: null,
    billingTiming: null, scheduleEffect: null, exclusions: null,
  });
  // Photos are evidence — without them the document does not show the work.
  assert.deepEqual(r.blockers, ['no_photos']);
  assert.equal(r.ok, false);
  // The terms name themselves, mark the checklist incomplete, and send anyway.
  assert.deepEqual(r.recommended,
    ['no_cost', 'no_billing_timing', 'no_schedule_effect', 'no_exclusions']);
  assert.deepEqual(r.completeness, { have: 0, of: 4 });
});

test('everything soft missing but description and photos present -> SENDABLE', () => {
  // The whole point of the 2026-08-07 reversal: a contractor who has said what the
  // work is and shown it may send, and settle the terms after.
  const r = sendReadiness({
    ...full, amountCents: null, billingTiming: null, scheduleEffect: null, exclusions: null,
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.blockers, []);
});

test('each soft item is detected on its own and none of them blocks Send', () => {
  const spoil: Record<SendRecommendation, object> = {
    no_cost: { amountCents: null },
    no_billing_timing: { billingTiming: null },
    no_schedule_effect: { scheduleEffect: null },
    no_exclusions: { exclusions: null },
  };
  for (const item of RECOMMENDED) {
    const r = sendReadiness({ ...full, ...spoil[item] });
    assert.deepEqual(r.recommended, [item], item);
    // Soft since 2026-08-07: named and counted, but Send stays live.
    assert.deepEqual(r.blockers, [], item);
    assert.equal(r.ok, true, item);
    assert.deepEqual(r.completeness, { have: 3, of: 4 }, item);
  }
});

test('whitespace is not an answer', () => {
  const r = sendReadiness({ ...full, exclusions: '   ', billingTiming: '  ' });
  assert.deepEqual(r.recommended, ['no_billing_timing', 'no_exclusions']);
  // Soft since 2026-08-07: named, marked incomplete, and sendable.
  assert.deepEqual(r.blockers, []);
  assert.equal(r.ok, true);
});

test("'not sure' about the schedule is a COMPLETE answer, not a missing one", () => {
  // FLOW decision 3: it renders to the owner as "Schedule impact: to be
  // confirmed", which is honest and revisable. Nagging about it would push a
  // contractor into guessing a number he does not have.
  const r = sendReadiness({ ...full, scheduleEffect: 'not_sure' });
  assert.deepEqual(r.recommended, []);
  assert.deepEqual(r.completeness, { have: 4, of: 4 });
});

// ── the description ───────────────────────────────────────────────────────────

test('an empty or whitespace scope blocks', () => {
  assert.deepEqual(sendReadiness({ ...full, scope: '' }).blockers, ['no_description']);
  assert.deepEqual(sendReadiness({ ...full, scope: '   \n' }).blockers, ['no_description']);
  assert.equal(sendReadiness({ ...full, scope: '' }).ok, false);
});

test('391: the gate reads the SCOPE OF WORK, not the title', () => {
  // The whole point of the split. A perfectly good title must not satisfy a gate
  // that exists to make sure the CLIENT has something to read — that is exactly the
  // state every change order in the database was in: 27 characters on average,
  // longest 39, none approved.
  const shortSow = { ...full, scopeOfWork: 'Firewall salvage: sanding and staining' };
  assert.deepEqual(sendReadiness(shortSow).blockers, ['no_description'],
    'a 38-character scope of work is a title wearing a different hat');

  const realSow = {
    ...full,
    scopeOfWork: 'Move the original 1910 fireplace mantel from the downstairs bedroom '
      + 'into the living room and refinish it in place.',
  };
  assert.deepEqual(sendReadiness(realSow).blockers, [], 'a real scope of work passes');
});

test('391: scopeOfWork wins over scope when both are present', () => {
  // The failure this prevents: a long title masking an empty scope of work, so the
  // gate passes and the client signs nothing.
  const r = sendReadiness({ ...full, scopeOfWork: 'Too short' });
  assert.deepEqual(r.blockers, ['no_description'],
    'a long title must not rescue a two-word scope of work');
});

test('391: a row with no scopeOfWork falls back to scope, unchanged', () => {
  // Back-compat, and it matters: every extra created before 391 has a null column.
  // Those rows must behave exactly as they did rather than becoming unsendable.
  const { scopeOfWork, ...noSow } = { ...full, scopeOfWork: undefined };
  assert.deepEqual(sendReadiness(noSow).blockers, [],
    'the pre-391 row still sends on the strength of its scope');
  assert.deepEqual(sendReadiness({ ...noSow, scope: '' }).blockers, ['no_description']);
});

test('391: the minimum is exactly MIN_SCOPE_OF_WORK_CHARS, boundary included', () => {
  const at = 'x'.repeat(MIN_SCOPE_OF_WORK_CHARS);
  const under = 'x'.repeat(MIN_SCOPE_OF_WORK_CHARS - 1);
  assert.deepEqual(sendReadiness({ ...full, scopeOfWork: at }).blockers, []);
  assert.deepEqual(sendReadiness({ ...full, scopeOfWork: under }).blockers, ['no_description']);
  // Trimmed before measuring: padding is not scope.
  assert.deepEqual(
    sendReadiness({ ...full, scopeOfWork: `   ${under}   ` }).blockers, ['no_description']);
});

test('the UNTITLED placeholder is not a description', () => {
  // scope is NOT NULL, so a just-created extra always has words. They are
  // startextra.ts's placeholder saying it has not been written up yet, and sending
  // it would put "Untitled extra — still being written up" on a priced document.
  const r = sendReadiness({ ...full, scope: UNTITLED_SCOPE });
  assert.deepEqual(r.blockers, ['no_description']);
  assert.equal(sendReadiness({ ...full, scope: `  ${UNTITLED_SCOPE}  ` }).ok, false,
    'padded is still the placeholder');
});

test('DRIFT GUARD: the placeholder literal still matches startextra.ts', () => {
  // This module cannot import UNTITLED (startextra.ts pulls in @powersync and
  // @supabase through changeorder.ts and the test would stop running), so the
  // string is restated. The copy is checked here rather than trusted: if someone
  // rewords the placeholder, the send gate would silently start accepting it as a
  // real description.
  const src = readFileSync(`${HERE}/startextra.ts`, 'utf8');
  const m = src.match(/export const UNTITLED = '([^']*)'/);
  assert.ok(m, 'startextra.ts no longer declares UNTITLED the way this guard reads it');
  assert.equal(m![1], UNTITLED_SCOPE);
});

// ── REQ-LC12: what "cost" means, per kind. NULL IS NOT ZERO ───────────────────

test('an unpriced extra SENDS, as an acknowledgement (hadar 2026-08-07)', () => {
  // The trade, stated: no figure reaches the frozen instrument, so the client agrees
  // to the WORK and the money is settled after. renderCard draws that variant — it
  // never prints an empty price.
  const r = sendReadiness({ ...full, amountCents: null });
  assert.deepEqual(r.blockers, []);
  assert.deepEqual(r.recommended, ['no_cost']);
  assert.equal(r.ok, true);
});

test('a genuinely $0 extra is NOT blocked', () => {
  // The whole reason amount_cents is nullable. Zero is a number somebody said.
  const r = sendReadiness({ ...full, amountCents: 0 });
  assert.deepEqual(r.blockers, []);
  assert.equal(r.ok, true);
});

test('T&M always carries a cap — an NTE extra with no nte_cents is blocked', () => {
  assert.deepEqual(
    sendReadiness({ ...full, priceMode: 'nte', nteCents: null }).blockers, ['no_cost']);
  assert.deepEqual(
    sendReadiness({ ...full, priceMode: 'nte', nteCents: 250000 }).blockers, []);
});

test('an NTE mode with NO CAP still blocks — a ceiling-less cap is not a softer promise', () => {
  // The one price case that survives 2026-08-07 as hard: he chose to state a
  // not-to-exceed, and a not-to-exceed clause with no number in it says nothing while
  // looking like a limit.
  assert.deepEqual(
    sendReadiness({ ...full, priceMode: 'nte', amountCents: 120000, nteCents: null })
      .blockers, ['no_cost']);
});

test('an NTE extra with a cap but no amount now SENDS', () => {
  const r = sendReadiness({ ...full, priceMode: 'nte', amountCents: null, nteCents: 250000 });
  assert.deepEqual(r.blockers, []);
  assert.equal(r.ok, true);
});

test('an EWA is never blocked on price — it deliberately states no amount', () => {
  const r = sendReadiness({ ...full, kind: 'ewa', amountCents: null, nteCents: null });
  assert.deepEqual(r.blockers, []);
  assert.equal(r.ok, true);
  // Its OWN blockers (proceed term, and rate + cap on tm_capped) are not this
  // function's: ewa.ts:validateEwaTerms owns them and the EWA send path calls both.
});

test('a Decision is never blocked on price — it carries none by definition', () => {
  const r = sendReadiness({ ...full, kind: 'decision', amountCents: null, nteCents: null });
  assert.deepEqual(r.blockers, []);
});

test('a description is required on every kind, priced or not', () => {
  for (const kind of ['extra', 'decision', 'ewa'] as const) {
    assert.deepEqual(sendReadiness({ ...full, kind, scope: '' }).blockers,
      ['no_description'], kind);
  }
});

test('both blockers report together, description first', () => {
  const r = sendReadiness({ ...full, scope: '', scopeOfWork: '', photoCount: 0 });
  assert.deepEqual(r.blockers, ['no_description', 'no_photos']);
});

// ── keys, not sentences ───────────────────────────────────────────────────────

test('every code maps to its own i18n key', () => {
  assert.equal(blockerKey('no_description'), 'send.blocked.noDescription');
  assert.equal(blockerKey('no_cost'), 'send.blocked.noCost');
  const keys = RECOMMENDED.map(recommendationKey);
  assert.equal(new Set(keys).size, RECOMMENDED.length, 'two items must never share a line');
  assert.equal(recommendationKey('no_cost'), 'send.recommended.noCost');
  assert.equal(blockerKey('no_photos'), 'send.blocked.noPhotos');
});

test('the keys this module returns exist in BOTH languages', () => {
  // t() returns the KEY when it misses, so a missing Spanish line puts
  // "send.blocked.noCost" on the screen of the contractor this app is for.
  const src = readFileSync(`${HERE}/i18n.ts`, 'utf8');
  const dict = (name: string) => {
    const i = src.indexOf(`const ${name}: Record<string, string> = {`);
    const j = src.indexOf('\n};', i);
    return new Set([...src.slice(i, j).matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1]));
  };
  const en = dict('EN'), es = dict('ES');
  for (const k of [blockerKey('no_description'), blockerKey('no_cost'),
                   ...RECOMMENDED.map(recommendationKey)]) {
    assert.ok(en.has(k), `${k} missing from EN`);
    assert.ok(es.has(k), `${k} missing from ES`);
  }
});

// ── REQ-LC13: the two gates are orthogonal and both must pass ─────────────────

test('content is refused before pipeline — it is the one he can act on', () => {
  // Uses a CONTENT blocker that still blocks: a missing description. Price stopped
  // being one on 2026-08-07, so an unpriced extra no longer exercises this ordering.
  const unpriced = sendReadiness({ ...full, scope: '', scopeOfWork: '' });
  const g = sendGate(unpriced, 'queued');
  assert.equal(g.ok, false);
  assert.equal(g.kind, 'content',
    'telling him to wait for signal hides the field he could fix right now');
});

test('a complete extra whose photos are still in the outbox is refused on the pipeline', () => {
  for (const proc of ['captured', 'queued', 'uploaded'] as const) {
    const g = sendGate(sendReadiness(full), proc);
    assert.equal(g.ok, false, proc);
    assert.equal(g.kind, 'pipeline', proc);
    assert.ok(g.kind === 'pipeline' && g.whyKey.startsWith('send.notReady.'), proc);
  }
});

test('both clear: complete content over processed evidence', () => {
  assert.deepEqual(sendGate(sendReadiness(full), 'processed'), { ok: true });
});
