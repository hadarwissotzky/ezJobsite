/** The pure half of the structure step: schema + parse guards. No network. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EXTRA_TYPES, parseStructure, parseTask, renderScope, STRUCTURE_SCHEMA } from './structure.ts';

/** 393: `value` is no longer supplied by the model — it is rendered from `sections`,
 *  so every fixture that used to pass a value now passes the sections behind it. */
const SEC = (steps: string[] = ['Replace the rotted subfloor under the tub.']) => ({
  background: 'During demo we found rotted subfloor under the tub.',
  steps, included: [], excluded: [], assumptions: [],
});

test('a full valid payload parses', () => {
  const r = parseStructure({
    subject: 'Subfloor rot repair under tub',
    sections: SEC(),
    who_directed: 'Owner',
    extra_type: 'site_condition',
    confidence: 'high',
  });
  assert.ok(r);
  assert.equal(r!.extraType, 'site_condition');
  assert.equal(r!.whoDirected, 'Owner');
  assert.equal(r!.confidence, 'high');
});

test('missing subject, scope, or confidence refuses', () => {
  assert.equal(parseStructure({ sections: SEC(), confidence: 'high' }), null);
  // No sections at all -> nothing to render -> unusable, rather than a blank scope
  // seeded onto a change order.
  assert.equal(parseStructure({ subject: 'x', confidence: 'high' }), null);
  assert.equal(parseStructure({ subject: 'x', sections: SEC() }), null);
  assert.equal(parseStructure(null), null);
  assert.equal(parseStructure('nope'), null);
});

test('a type outside the taxonomy is dropped to null, never adopted', () => {
  const r = parseStructure({
    subject: 's', sections: SEC(), who_directed: null,
    extra_type: 'landscaping', confidence: 'low',
  });
  assert.ok(r);
  assert.equal(r!.extraType, null);
});

test('empty who_directed becomes null, not empty string', () => {
  const r = parseStructure({
    subject: 's', sections: SEC(), who_directed: '  ',
    extra_type: null, confidence: 'high',
  });
  assert.equal(r!.whoDirected, null);
});

test('the schema forbids extra fields and requires every declared one', () => {
  assert.equal((STRUCTURE_SCHEMA as any).additionalProperties, false);
  for (const k of ['subject', 'sections', 'terms', 'who_directed', 'extra_type', 'confidence']) {
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
    sections: SEC(['Upgrade the main panel.', 'Replace the rotted subfloor.']),
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
    subject: 's', sections: SEC(), who_directed: null, extra_type: null, confidence: 'high',
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

// ── tags (392) ────────────────────────────────────────────────────────────────
// They cross a network boundary from a model, so parseStructure re-checks them the
// same way it re-checks everything else. These pin the rules the grid depends on.

test('tags are lowercased, trimmed and deduped', () => {
  const r = parseStructure({
    subject: 'Panel upgrade', sections: SEC(), confidence: 'high', tasks: [],
    tags: ['Kitchen', '  kitchen  ', 'ELECTRICAL', 'electrical'],
  });
  assert.deepEqual(r?.tags, ['kitchen', 'electrical']);
});

test('at most eight tags — a model listing is not tagging', () => {
  const many = Array.from({ length: 20 }, (_, i) => `tag${i}`);
  const r = parseStructure({
    subject: 'x', sections: SEC(), confidence: 'high', tasks: [], tags: many,
  });
  assert.equal(r?.tags.length, 8);
  assert.equal(r?.tags[0], 'tag0', 'keeps the first, which the model ranked highest');
});

test('non-strings are dropped, not coerced — "3" is not a tag', () => {
  const r = parseStructure({
    subject: 'x', sections: SEC(), confidence: 'high', tasks: [],
    tags: ['kitchen', 3, null, undefined, {}, '', '   '],
  });
  assert.deepEqual(r?.tags, ['kitchen']);
});

test('a proposal with no tags field parses to an empty list, not a failure', () => {
  // Every proposal written before 392 has no tags. It must still parse — the field
  // is an addition, not a new requirement on old rows.
  const r = parseStructure({ subject: 'x', sections: SEC(), confidence: 'high', tasks: [] });
  assert.deepEqual(r?.tags, []);
});

test('internal whitespace is collapsed so one tag cannot masquerade as two', () => {
  const r = parseStructure({
    subject: 'x', sections: SEC(), confidence: 'high', tasks: [],
    tags: ['water   damage'],
  });
  assert.deepEqual(r?.tags, ['water damage']);
});

test('the schema demands tags, so the model cannot silently omit them', () => {
  assert.ok((STRUCTURE_SCHEMA.required as readonly string[]).includes('tags'));
});

test('renderScope omits empty sections rather than printing "None" (393)', () => {
  const out = renderScope({
    background: 'Owner asked to move the panel.',
    steps: ['Relocate the panel to the garage wall.'],
    included: [], excluded: [], assumptions: [],
  });
  assert.match(out, /WHY THIS IS NEEDED/);
  assert.match(out, /1\. Relocate the panel/);
  // A heading with nothing under it reads as an oversight, and an empty exclusions
  // list is not a claim that nothing is excluded.
  assert.doesNotMatch(out, /DOES NOT INCLUDE/);
  assert.doesNotMatch(out, /None/);
});

test('a payload with sections but no steps still renders from what it has', () => {
  const r = parseStructure({
    subject: 'x', confidence: 'high',
    sections: { background: 'Found rot under the tub.', steps: [], included: [], excluded: [], assumptions: [] },
  });
  assert.ok(r);
  assert.match(r!.value, /Found rot under the tub/);
});

test('sections that are entirely empty refuse — a blank scope must never be seeded', () => {
  assert.equal(parseStructure({
    subject: 'x', confidence: 'none',
    sections: { background: null, steps: [], included: [], excluded: [], assumptions: [] },
  }), null);
});

test('a day count without adds_days is dropped, because the enum renders the clause', () => {
  const r = parseStructure({
    subject: 'x', confidence: 'high', sections: SEC(),
    terms: { schedule_effect: 'not_sure', schedule_days: 3, billing_timing: null },
  });
  assert.equal(r!.terms.scheduleEffect, 'not_sure');
  assert.equal(r!.terms.scheduleDays, null);
});

test('null schedule_effect stays null — "he did not say" is not "not sure"', () => {
  const r = parseStructure({
    subject: 'x', confidence: 'high', sections: SEC(),
    terms: { schedule_effect: null, schedule_days: null, billing_timing: null },
  });
  assert.equal(r!.terms.scheduleEffect, null);
  assert.equal(r!.terms.billingTiming, null);
});
