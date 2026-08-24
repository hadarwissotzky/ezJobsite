/**
 * THE COST GRID's one piece of logic: reading a stored breakdown back safely.
 *
 * hadar, 2026-08-24: "if there were a separation of cost by part (breakdown) this
 * breakdown needs to be displayed clearly and that is true for the homeowners side
 * (client portal)". The grid itself is layout; what needed pinning is the read, because
 * `line_items` is TEXT holding JSON and a bad value must not take an extra's whole
 * record down with it.
 *
 * Run: cd apps/mobile && node --test src/costbreakdown.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseLineItems } from './changeorder.ts';

const LINES = JSON.stringify([
  { description: 'Pull permit and disconnect', qty: 1, unit_cents: 40000, total_cents: 40000 },
  { description: 'Install and terminate', qty: 2, unit_cents: 37500, total_cents: 75000 },
]);

test('a stored breakdown reads back whole', () => {
  const got = parseLineItems(LINES);
  assert.equal(got.length, 2);
  assert.equal(got[0].description, 'Pull permit and disconnect');
  assert.equal(got[1].total_cents, 75000);
});

test('no breakdown is an empty grid, not a crash', () => {
  // The ordinary extra: one price for the whole job, no parts. Every one of these is
  // a real value the column carries somewhere.
  for (const raw of [null, undefined, '', '[]']) {
    assert.deepEqual(parseLineItems(raw), [], `${JSON.stringify(raw)} did not read as "no parts"`);
  }
});

test('a corrupt breakdown does not take the record with it', () => {
  // A truncated write. The extra still has a scope, a price and a signature, and
  // refusing to open it because one display grid will not parse is the worse failure.
  assert.deepEqual(parseLineItems('[{"description":"Panel a'), []);
  assert.deepEqual(parseLineItems('not json at all'), []);
});

test('a value that is not a list is not a breakdown', () => {
  // `{}` and `"text"` parse fine as JSON and are not arrays. Reading .length off them
  // is how a grid renders `undefined` rows.
  assert.deepEqual(parseLineItems('{"description":"Panel"}'), []);
  assert.deepEqual(parseLineItems('"just a string"'), []);
  assert.deepEqual(parseLineItems('null'), []);
});

test('an unusable row is dropped, the usable ones survive', () => {
  const got = parseLineItems(JSON.stringify([
    { description: 'Good line', qty: 1, unit_cents: 900, total_cents: 900 },
    { qty: 1, unit_cents: 100 },                       // no description
    { description: 'No total', qty: 1, unit_cents: 5 }, // no total_cents
    { description: 'NaN total', total_cents: Number.NaN },
    null,
  ]));
  assert.equal(got.length, 1);
  assert.equal(got[0].description, 'Good line');
});

test('DROPPING A ROW IS WHY NOTHING SUMS THIS ARRAY', () => {
  // The reason the screens and the client page both take their total from the extra's
  // own amount_cents. Here two of three lines are unreadable: a grid that summed what
  // it could parse would show $400 under a signature for a $2,400 job — quietly short,
  // and confidently wrong beside a price. Mandate #6's whole point.
  const got = parseLineItems(JSON.stringify([
    { description: 'Permit', qty: 1, unit_cents: 40000, total_cents: 40000 },
    { description: 'Panel', qty: 1, unit_cents: 125000 },
    { qty: 2, unit_cents: 37500, total_cents: 75000 },
  ]));
  const summed = got.reduce((n, l) => n + l.total_cents, 0);
  assert.equal(got.length, 1);
  assert.notEqual(summed, 240000,
    'if this ever equals the real total, the "never sum the rows" rule stopped mattering');
});

test('the stored row is never rewritten — the parser only reads', () => {
  // Nothing here saves, so an unparseable value stays on the row and is recoverable
  // by hand. The check is that the input is not mutated into something "clean".
  const raw = '[{"description":"Panel","total_cents":900,"extra":"keep me"}]';
  const before = raw;
  const got = parseLineItems(raw);
  assert.equal(raw, before);
  assert.equal((got[0] as unknown as { extra: string }).extra, 'keep me',
    'the reader stripped a field it did not recognise');
});
