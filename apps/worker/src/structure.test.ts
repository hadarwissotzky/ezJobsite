/** The pure half of the structure step: schema + parse guards. No network. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EXTRA_TYPES, parseStructure, STRUCTURE_SCHEMA } from './structure.ts';

test('a full valid payload parses', () => {
  const r = parseStructure({
    subject: 'Subfloor rot repair under tub',
    value: 'During demo we found rotted subfloor under the tub. It must be replaced before tile.',
    who_directed: 'Owner',
    extra_type: 'site_condition',
    confidence: 'high',
  });
  assert.ok(r);
  assert.equal(r!.extraType, 'site_condition');
  assert.equal(r!.whoDirected, 'Owner');
  assert.equal(r!.confidence, 'high');
});

test('missing subject, value, or confidence refuses', () => {
  assert.equal(parseStructure({ value: 'x', confidence: 'high' }), null);
  assert.equal(parseStructure({ subject: 'x', confidence: 'high' }), null);
  assert.equal(parseStructure({ subject: 'x', value: 'y' }), null);
  assert.equal(parseStructure(null), null);
  assert.equal(parseStructure('nope'), null);
});

test('a type outside the taxonomy is dropped to null, never adopted', () => {
  const r = parseStructure({
    subject: 's', value: 'v', who_directed: null,
    extra_type: 'landscaping', confidence: 'low',
  });
  assert.ok(r);
  assert.equal(r!.extraType, null);
});

test('empty who_directed becomes null, not empty string', () => {
  const r = parseStructure({
    subject: 's', value: 'v', who_directed: '  ',
    extra_type: null, confidence: 'high',
  });
  assert.equal(r!.whoDirected, null);
});

test('the schema forbids extra fields and requires every declared one', () => {
  assert.equal((STRUCTURE_SCHEMA as any).additionalProperties, false);
  for (const k of ['subject', 'value', 'who_directed', 'extra_type', 'confidence']) {
    assert.ok((STRUCTURE_SCHEMA as any).required.includes(k), k);
  }
});

test('no price-shaped FIELD exists in the schema (mandate #6)', () => {
  // Property names only — the descriptions legitimately SAY "no prices";
  // what must never exist is a field that could carry one.
  const names = Object.keys((STRUCTURE_SCHEMA as any).properties).join(' ').toLowerCase();
  for (const banned of ['amount', 'price', 'cents', 'cost', 'dollar', 'rate', 'total']) {
    assert.ok(!names.includes(banned), `schema has a ${banned} field`);
  }
});

test('the taxonomy matches the app: six slugs', () => {
  assert.deepEqual([...EXTRA_TYPES], [
    'structural', 'mep', 'finish', 'code_permit', 'site_condition', 'scope_clarification',
  ]);
});
