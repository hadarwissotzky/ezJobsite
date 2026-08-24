/**
 * WHAT A PRICE WRITE MAY AND MAY NOT TOUCH.
 *
 * Found by Codex in adversarial review, 2026-08-24, and it was real: `priceDraftExtra`
 * listed `billing_timing`, `schedule_effect`, `schedule_days` and `exclusions` in every
 * UPDATE, binding `o.X ?? null`. Three of its six callers never pass them, so setting a
 * price wrote NULL over terms the contractor had already filled in. Silent — the write
 * succeeded, nothing was reported, and D3 lets an extra send with all four blank, so it
 * could reach a client with its schedule impact and exclusions quietly gone.
 *
 * These tests assert on the SQL that is actually built, because the bug was in the
 * statement rather than in a branch: it did exactly what it said, on every call.
 *
 * Run: cd apps/mobile && node --test src/pricewrite.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { priceDraftExtra } from './changeorder.ts';

/** Captures the UPDATE so the test can read the columns and the WHERE clause. */
function fakeDb() {
  const calls: { sql: string; args: any[] }[] = [];
  const db: any = {
    execute: async (sql: string, args: any[] = []) => {
      calls.push({ sql, args });
      return { rowsAffected: 1 };
    },
    // No queued INSERT, so the outbox refresh is skipped.
    getAll: async () => [],
  };
  return { db, calls };
}

const BASE = { changeOrderId: 'co1', amountCents: 120000,
               whoDirected: 'Owner', numbersConfirmedAt: new Date(0) };

const updateOf = (calls: { sql: string; args: any[] }[]) =>
  calls.find((c) => /UPDATE change_order\b/.test(c.sql))!;

test('a price write leaves terms the caller did not mention ALONE', async () => {
  // The bug, pinned. The auto-fill passes a price and nothing else; it must not
  // reach the four term columns at all.
  const { db, calls } = fakeDb();
  const r = await priceDraftExtra(db, { ...BASE });
  assert.deepEqual(r, { ok: true });

  const upd = updateOf(calls);
  for (const col of ['billing_timing', 'schedule_effect', 'schedule_days', 'exclusions']) {
    assert.ok(!upd.sql.includes(col),
      `a price write set ${col} — it erases a term the contractor entered`);
  }
});

test('an EXPLICIT null still clears a term', async () => {
  // `undefined` means "leave it" and `null` means "clear it". Collapsing the two would
  // fix the erasure by making the composer unable to clear a field it owns.
  const { db, calls } = fakeDb();
  await priceDraftExtra(db, { ...BASE, exclusions: null, scheduleEffect: null });

  const upd = updateOf(calls);
  assert.ok(upd.sql.includes('exclusions = ?'), 'an explicit null no longer clears');
  assert.ok(upd.sql.includes('schedule_effect = ?'));
  assert.ok(upd.args.includes(null));
});

test('the composer still writes every term it passes', async () => {
  const { db, calls } = fakeDb();
  await priceDraftExtra(db, {
    ...BASE, billingTiming: 'on_completion' as any, scheduleEffect: 'adds_days' as any,
    scheduleDays: 3, exclusions: 'Hidden damage',
  });

  const upd = updateOf(calls);
  for (const col of ['billing_timing', 'schedule_effect', 'schedule_days', 'exclusions']) {
    assert.ok(upd.sql.includes(`${col} = ?`), `${col} was dropped from a full save`);
  }
  assert.ok(upd.args.includes(3));
  assert.ok(upd.args.includes('Hidden damage'));
});

test('an auto-fill refuses in the STATEMENT, not in a prior read', async () => {
  // The race: the caller reads "still unpriced", then writes. Between the two he can
  // type his own price on the screen the read was for. The condition has to travel
  // with the write or the app overwrites a number a human entered.
  const { db, calls } = fakeDb();
  await priceDraftExtra(db, { ...BASE, onlyIfUnpriced: true });

  const upd = updateOf(calls);
  assert.match(upd.sql, /amount_cents IS NULL/,
    'the auto-fill can overwrite a price the contractor typed a moment ago');
});

test('a human-initiated write may re-price a priced draft', async () => {
  // The other half. The composer exists to change a price that already exists; the
  // guard must be opt-in or that screen stops working.
  const { db, calls } = fakeDb();
  await priceDraftExtra(db, { ...BASE });

  assert.doesNotMatch(updateOf(calls).sql, /amount_cents IS NULL/);
});

test('every write is still confined to a DRAFT', async () => {
  // Unchanged and load-bearing: a sent or signed extra is frozen, and the WHERE clause
  // is what enforces it here.
  for (const o of [{}, { onlyIfUnpriced: true }]) {
    const { db, calls } = fakeDb();
    await priceDraftExtra(db, { ...BASE, ...o });
    assert.match(updateOf(calls).sql, /status = 'draft'/);
  }
});

test('a refusal names WHICH rule stopped it', async () => {
  const db: any = { execute: async () => ({ rowsAffected: 0 }), getAll: async () => [] };
  const a = await priceDraftExtra(db, { ...BASE, onlyIfUnpriced: true });
  const b = await priceDraftExtra(db, { ...BASE });
  assert.equal(a.ok, false); assert.match((a as any).reason, /already has a price/);
  assert.equal(b.ok, false); assert.match((b as any).reason, /not a draft/);
});
