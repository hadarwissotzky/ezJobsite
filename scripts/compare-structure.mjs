#!/usr/bin/env node
/**
 * Run TWO structuring models over the SAME real transcripts and print what each
 * produced, side by side, with the token cost of each call.
 *
 * WHY THIS EXISTS. `structure.ts` is the one model in this system whose output a
 * homeowner signs — CLAUDE.md mandate #4 calls the structuring layer "the product".
 * It was `claude-opus-4-8` with adaptive thinking, which measured at roughly two
 * thirds of the ~$0.66 it costs to produce a signed change order, against a pricing
 * doc that had assumed ~$0.01 on a cheap model.
 *
 * Both "keep paying for Opus" and "switch and hope" are guesses. This makes it a
 * reading exercise: same transcripts, both models, scope of work printed in full, and
 * the price difference stated. Then somebody decides on what they can see.
 *
 *   node scripts/compare-structure.mjs                    # 5 newest real transcripts
 *   node scripts/compare-structure.mjs --limit 12
 *   node scripts/compare-structure.mjs --a claude-opus-4-8 --b claude-haiku-4-5-20251001
 *   node scripts/compare-structure.mjs --a-thinking       # adaptive thinking on A only
 *
 * Reads transcripts from the live database (`capture_transcript`) because synthetic
 * ones would prove nothing: the failure mode worth catching is a cheaper model doing
 * fine on a clean sentence and badly on a contractor talking over a saw.
 *
 * IT WRITES NOTHING. Read-only against the database, and it never touches
 * `structure_proposal` — the pipeline's own output is not disturbed by a comparison.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// The repo root has no node_modules — `apps/worker` owns both of these, and it is the
// package that actually ships this call. Resolved by absolute path so the script runs
// from anywhere without a second install.
const W = join(ROOT, 'apps/worker/node_modules');
const { createClient } = await import(join(W, '@supabase/supabase-js/dist/index.mjs'));
const Anthropic = (await import(join(W, '@anthropic-ai/sdk/index.mjs'))).default;

function env() {
  const out = {};
  // The worker's .env holds ANTHROPIC_API_KEY; the mobile one holds the Supabase
  // URL and keys. Read both, first-wins, so neither has to be duplicated.
  for (const f of ['apps/worker/.env', 'apps/mobile/.env', '.env']) {
    try {
      for (const line of readFileSync(join(ROOT, f), 'utf8').split('\n')) {
        if (!line.includes('=') || line.trim().startsWith('#')) continue;
        const i = line.indexOf('=');
        const k = line.slice(0, i).trim();
        if (!(k in out)) out[k] = line.slice(i + 1).trim();
      }
    } catch { /* file may not exist; the next one may */ }
  }
  return out;
}

const E = env();
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1] : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

const MODEL_A = arg('a', 'claude-opus-4-8');
const MODEL_B = arg('b', 'claude-sonnet-5');
const LIMIT = Number(arg('limit', '5'));

// Per-million-token list prices, for the cost column. Approximate and clearly labelled
// as such — the POINT of this script is the text above the numbers.
const RATES = {
  'claude-opus-4-8': { in: 15, out: 75 },
  'claude-sonnet-5': { in: 3, out: 15 },
  'claude-haiku-4-5-20251001': { in: 1, out: 5 },
};
const price = (model, usage) => {
  const r = RATES[model];
  if (!r || !usage) return null;
  return (usage.input_tokens * r.in + usage.output_tokens * r.out) / 1e6;
};

const url = E.EXPO_PUBLIC_SUPABASE_URL;
const key = E.SUPABASE_SERVICE_ROLE_KEY || E.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) { console.error('need EXPO_PUBLIC_SUPABASE_URL and a key in .env'); process.exit(2); }
if (!process.env.ANTHROPIC_API_KEY && !E.ANTHROPIC_API_KEY) {
  console.error('need ANTHROPIC_API_KEY (env or .env)'); process.exit(2);
}
process.env.ANTHROPIC_API_KEY ||= E.ANTHROPIC_API_KEY;

const sb = createClient(url, key, { auth: { persistSession: false } });

// The system prompt and schema are imported from the worker rather than restated, or
// this would be comparing two things neither of which is what ships.
const { SYSTEM_PROMPT_FOR_TOOLS, STRUCTURE_SCHEMA_FOR_TOOLS } =
  await import('../apps/worker/src/structure.ts')
    .then((m) => ({
      SYSTEM_PROMPT_FOR_TOOLS: m.SYSTEM_FOR_TOOLS ?? null,
      STRUCTURE_SCHEMA_FOR_TOOLS: m.SCHEMA_FOR_TOOLS ?? null,
    }))
    .catch(() => ({ SYSTEM_PROMPT_FOR_TOOLS: null, STRUCTURE_SCHEMA_FOR_TOOLS: null }));

if (!SYSTEM_PROMPT_FOR_TOOLS || !STRUCTURE_SCHEMA_FOR_TOOLS) {
  console.error(
    'structure.ts does not export SYSTEM_FOR_TOOLS / SCHEMA_FOR_TOOLS.\n' +
    'Add:  export const SYSTEM_FOR_TOOLS = SYSTEM;  export const SCHEMA_FOR_TOOLS = STRUCTURE_SCHEMA;\n' +
    'Exported rather than duplicated here on purpose — a copy would drift from what ships.');
  process.exit(2);
}

const { data: rows, error } = await sb
  .from('capture_transcript')
  .select('capture_id, text, source_language, created_at')
  .order('created_at', { ascending: false })
  .limit(LIMIT);
if (error) { console.error('read failed:', error.message); process.exit(1); }
const real = (rows ?? []).filter((r) => (r.text ?? '').trim().length > 20);
if (!real.length) { console.error('no transcripts with content found'); process.exit(1); }

const client = new Anthropic();

async function run(model, transcript, thinking) {
  const t0 = Date.now();
  const params = {
    model, max_tokens: 4096,
    ...(thinking ? { thinking: { type: 'adaptive' } } : {}),
    output_config: { format: { type: 'json_schema', schema: STRUCTURE_SCHEMA_FOR_TOOLS } },
    system: SYSTEM_PROMPT_FOR_TOOLS,
    messages: [{ role: 'user', content: transcript }],
  };
  try {
    const resp = await client.messages.create(params);
    const block = resp.content.find((b) => b.type === 'text');
    let parsed = null;
    try { parsed = JSON.parse(block?.text ?? ''); } catch { /* shown as unparseable */ }
    return { ms: Date.now() - t0, usage: resp.usage, parsed, raw: block?.text ?? '' };
  } catch (e) {
    return { ms: Date.now() - t0, error: String(e?.message ?? e).slice(0, 200) };
  }
}

const totals = { [MODEL_A]: 0, [MODEL_B]: 0 };

for (const [i, row] of real.entries()) {
  const t = row.text.trim();
  console.log('\n' + '='.repeat(78));
  console.log(`TRANSCRIPT ${i + 1}/${real.length}  ·  ${row.capture_id}  ·  ${t.length} chars  ·  ${row.source_language ?? '?'}`);
  console.log('='.repeat(78));
  console.log(t.slice(0, 600) + (t.length > 600 ? '\n  …' : ''));

  for (const [label, model, thinking] of [
    ['A', MODEL_A, flag('a-thinking')],
    ['B', MODEL_B, flag('b-thinking')],
  ]) {
    const r = await run(model, t, thinking);
    const cost = price(model, r.usage);
    if (cost) totals[model] += cost;
    console.log(`\n── ${label}: ${model}${thinking ? ' +thinking' : ''} ` + '─'.repeat(Math.max(0, 50 - model.length)));
    if (r.error) { console.log('  ERROR:', r.error); continue; }
    console.log(`  ${r.ms} ms · in ${r.usage?.input_tokens} / out ${r.usage?.output_tokens} tok` +
                (cost ? ` · ~$${cost.toFixed(4)}` : ''));
    if (!r.parsed) { console.log('  UNPARSEABLE:', r.raw.slice(0, 300)); continue; }
    // The fields a human actually reads on the document.
    console.log(`  subject   : ${r.parsed.subject ?? '—'}`);
    console.log(`  value     : ${(r.parsed.value ?? '—').slice(0, 400)}`);
    console.log(`  who       : ${r.parsed.who_directed ?? '—'}   type: ${r.parsed.extra_type ?? '—'}   conf: ${r.parsed.confidence ?? '—'}`);
    if (Array.isArray(r.parsed.tasks) && r.parsed.tasks.length) {
      for (const task of r.parsed.tasks.slice(0, 4)) {
        console.log(`  task      : ${task.title ?? '—'}${task.price_cents != null ? ` — $${(task.price_cents / 100).toFixed(2)}` : ''}`);
      }
    }
    if (Array.isArray(r.parsed.tags) && r.parsed.tags.length) {
      console.log(`  tags      : ${r.parsed.tags.join(', ')}`);
    }
  }
}

console.log('\n' + '='.repeat(78));
console.log(`TOTAL over ${real.length} transcripts (list prices, approximate):`);
for (const m of [MODEL_A, MODEL_B]) console.log(`  ${m.padEnd(30)} $${totals[m].toFixed(4)}`);
const [a, b] = [totals[MODEL_A], totals[MODEL_B]];
if (a && b) {
  console.log(`\n  ${MODEL_B} is ${(a / b).toFixed(1)}x cheaper than ${MODEL_A}.`);
  console.log('  Read the scopes above before believing that is a good trade.');
}
