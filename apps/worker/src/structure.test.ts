/** The pure half of the structure step: schema + parse guards. No network. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EXTRA_TYPES, parseStructure, parseTask, STRUCTURE_SCHEMA } from './structure.ts';

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

test('no NUMERIC price-shaped field exists anywhere in the schema (mandate #6)', () => {
  // The sanctioned exception is a verbatim-QUOTE string (price_words) — a span
  // of the contractor's own speech, evidence of a mention. What must never
  // exist is a number- or integer-typed field a model-authored figure could
  // ride in on. Walk every property recursively.
  const walk = (node: any, path: string) => {
    if (!node || typeof node !== 'object') return;
    const props = node.properties ?? {};
    for (const [name, def] of Object.entries<any>(props)) {
      const types = [def.type, ...(def.anyOf ?? []).map((a: any) => a.type)].filter(Boolean);
      const moneyName = /amount|price|cents|cost|dollar|rate|total/.test(name);
      if (moneyName) {
        assert.ok(!types.includes('number') && !types.includes('integer'),
          `${path}${name} is a numeric money field`);
        assert.ok(name.endsWith('_words'),
          `${path}${name}: money-adjacent fields must be verbatim *_words quotes`);
      }
      walk(def, `${path}${name}.`);
      if (def.items) walk(def.items, `${path}${name}[].`);
    }
  };
  walk(STRUCTURE_SCHEMA, '');
});

test('a multi-task payload parses with elements grouped per task', () => {
  const r = parseStructure({
    subject: 'Bath extras: panel upgrade and subfloor repair',
    value: 'Part 1... Part 2...',
    who_directed: null, extra_type: 'mep', confidence: 'high',
    tasks: [
      { title: 'Panel upgrade', scope: 'Upgrade the main panel.',
        materials: ['200A panel', '4/0 copper'], price_words: 'twenty four hundred',
        time_words: null, start_words: 'after inspection Friday' },
      { title: 'Subfloor repair', scope: 'Replace rotted subfloor.',
        materials: ['3/4 plywood'], price_words: null,
        time_words: 'about six hours', start_words: null },
    ],
  });
  assert.ok(r);
  assert.equal(r!.tasks.length, 2);
  assert.equal(r!.tasks[0].priceWords, 'twenty four hundred');
  assert.equal(r!.tasks[0].timeWords, null);
  assert.deepEqual(r!.tasks[1].materials, ['3/4 plywood']);
  assert.equal(r!.tasks[1].timeWords, 'about six hours');
});

test('a malformed task drops; the rest stand', () => {
  const r = parseStructure({
    subject: 's', value: 'v', who_directed: null, extra_type: null, confidence: 'high',
    tasks: [
      { title: 'ok', scope: 'fine', materials: [], price_words: null, time_words: null, start_words: null },
      { title: '', scope: 'no title', materials: [] },
      'garbage',
    ],
  });
  assert.equal(r!.tasks.length, 1);
  assert.equal(r!.tasks[0].title, 'ok');
});

test('parseTask refuses a task without its spine', () => {
  assert.equal(parseTask({ scope: 'x' }), null);
  assert.equal(parseTask({ title: 'x' }), null);
  assert.equal(parseTask(null), null);
});

test('non-string materials are dropped, not coerced', () => {
  const t = parseTask({ title: 't', scope: 's', materials: ['pipe', 42, null, ' wire '] });
  assert.deepEqual(t!.materials, ['pipe', 'wire']);
});

test('the taxonomy matches the app: six slugs', () => {
  assert.deepEqual([...EXTRA_TYPES], [
    'structural', 'mep', 'finish', 'code_permit', 'site_condition', 'scope_clarification',
  ]);
});
