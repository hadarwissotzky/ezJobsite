/**
 * The rules that decide whether an edit's addendum is still owed.
 *
 * Aimed at the dangerous cases, not the happy path: the bug this module fixes was a
 * silent give-up, so every test here is about something NOT being forgotten — or, in the
 * expiry case, about it being forgotten deliberately rather than retried forever.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addendumTextFrom, markAugmentPending, clearAugmentPending, pendingAugments,
  retryPendingAugments, RETRY_WINDOW_MS, AUGMENT_PENDING_DDL,
} from './augmentretry.ts';

/** The two tables this module reads, and nothing else. */
function fakeDb() {
  const pending = new Map<string, { capture_ids: string; first_at_ms: number }>();
  const transcripts = new Map<string, string>();
  return {
    transcripts,
    pending,
    async execute(sql: string, args: any[] = []) {
      if (/INSERT OR REPLACE INTO augment_pending/.test(sql)) {
        pending.set(args[0], { capture_ids: args[1], first_at_ms: args[2] });
        return { rowsAffected: 1 };
      }
      if (/DELETE FROM augment_pending/.test(sql)) {
        return { rowsAffected: pending.delete(args[0]) ? 1 : 0 };
      }
      if (/CREATE TABLE/.test(sql)) return { rowsAffected: 0 };
      throw new Error('unexpected execute: ' + sql);
    },
    async getAll<T>(sql: string, args: any[] = []): Promise<T[]> {
      if (/FROM augment_pending/.test(sql) && /count\(\*\)/.test(sql)) {
        return [{ n: pending.size }] as any;
      }
      if (/FROM augment_pending/.test(sql)) {
        return [...pending.entries()]
          .map(([k, v]) => ({ change_order_id: k, ...v }))
          .sort((a, b) => a.first_at_ms - b.first_at_ms) as any;
      }
      if (/FROM voice_transcript_cache/.test(sql)) {
        return args.map((id) => ({ text: transcripts.get(id) }))
          .filter((r) => r.text !== undefined) as any;
      }
      throw new Error('unexpected getAll: ' + sql);
    },
  } as any;
}

test('the DDL is STRICT — a malformed marker must fail loudly, not coerce', () => {
  assert.match(AUGMENT_PENDING_DDL, /STRICT/);
});

test('a high-confidence proposal supplies the addendum', () => {
  assert.equal(
    addendumTextFrom({ confidence: 'high', value: 'Install a new 200A panel.' }, []),
    'Install a new 200A panel.');
});

test('MANDATE #2 — anything below high confidence falls back to his own words', () => {
  assert.equal(
    addendumTextFrom({ confidence: 'medium', value: 'AI guess' }, ['what he actually said']),
    'what he actually said',
    'a low-confidence AI value must never stand in for the contractor');
});

test('no proposal and no transcript yields empty — which the caller leaves PENDING', () => {
  assert.equal(addendumTextFrom(null, [null, undefined, '   ']), '');
});

test('several added clips join in order rather than only the first surviving', () => {
  assert.equal(addendumTextFrom(null, ['first', 'second']), 'first\n\nsecond');
});

test('an edit whose words have not arrived stays pending instead of being forgotten',
  async () => {
    const db = fakeDb();
    await markAugmentPending(db, 'co-1', ['c1']);
    const r = await retryPendingAugments(db, {
      nowMs: Date.now(),
      fetchProposal: async () => null,
      append: async () => { throw new Error('must not append an empty addendum'); },
    });
    assert.equal(r.appended, 0);
    assert.equal(r.stillPending, 1);
    assert.equal(db.pending.size, 1, 'the marker survives so a later tick can try again');
  });

test('the cloud transcript arriving later DOES grow the description', async () => {
  const db = fakeDb();
  await markAugmentPending(db, 'co-1', ['c1']);
  const appended: Array<[string, string]> = [];
  const r = await retryPendingAugments(db, {
    nowMs: Date.now(),
    fetchProposal: async () => ({ confidence: 'high', value: 'Move the mantel.' }),
    append: async (co, text) => { appended.push([co, text]); },
  });
  assert.equal(r.appended, 1);
  assert.deepEqual(appended, [['co-1', 'Move the mantel.']]);
  assert.equal(db.pending.size, 0, 'a satisfied marker is cleared, so it cannot append twice');
});

test('a marker past its window is dropped, not retried forever', async () => {
  const db = fakeDb();
  await markAugmentPending(db, 'co-old', ['c1']);
  const now = Date.now() + RETRY_WINDOW_MS + 1;
  const out = await pendingAugments(db, now);
  assert.deepEqual(out, []);
  assert.equal(db.pending.size, 0);
});

test('a second edit of the same extra replaces the id set rather than queueing twice',
  async () => {
    const db = fakeDb();
    await markAugmentPending(db, 'co-1', ['c1']);
    await markAugmentPending(db, 'co-1', ['c2', 'c3']);
    const out = await pendingAugments(db, Date.now());
    assert.equal(out.length, 1);
    assert.deepEqual(out[0].captureIds, ['c2', 'c3'],
      'the newer set is the one whose words are missing');
  });

test('an unreadable id list is dropped rather than retried on a parse error forever',
  async () => {
    const db = fakeDb();
    db.pending.set('co-bad', { capture_ids: 'not json', first_at_ms: Date.now() });
    assert.deepEqual(await pendingAugments(db, Date.now()), []);
    assert.equal(db.pending.size, 0);
  });

test('marking with no captures records nothing — there is no addendum to owe', async () => {
  const db = fakeDb();
  await markAugmentPending(db, 'co-1', []);
  assert.equal(db.pending.size, 0);
});

test('clearing is idempotent', async () => {
  const db = fakeDb();
  await markAugmentPending(db, 'co-1', ['c1']);
  await clearAugmentPending(db, 'co-1');
  await clearAugmentPending(db, 'co-1');
  assert.equal(db.pending.size, 0);
});
