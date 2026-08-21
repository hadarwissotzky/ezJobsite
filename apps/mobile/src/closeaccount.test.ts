/**
 * Closing the account.
 *   cd apps/mobile && node --test src/closeaccount.test.ts
 *
 * These tests exist for one reason: a purge that under-deletes REPORTS SUCCESS. There
 * is no failing screen, no error, no retry — just data that survived a deletion the
 * person was told had happened. So the cases below are the three ways this silently
 * under-deletes: a paginated listing that stops at 100, a table added later that a
 * hardcoded list never learned about, and a failed remove that gets counted as done.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { LOCAL_MEDIA_DIRS, closeMyAccount, localOwnedTables, purgeRemoteMedia } from './closeaccount.ts';
import { DRAFT_MEDIA_ROOT } from './capturesession.ts';

/* ----------------------------------------------------------------- fakes -- */

type Obj = { name: string };

/** A storage bucket that paginates the way Supabase does: `limit`/`offset`, one level. */
function fakeStorage(tree: Record<string, string[]>, opts: { failRemove?: boolean } = {}) {
  const removed: string[] = [];
  const api = {
    list: async (prefix: string, o: { limit: number; offset: number }) => {
      const all: Obj[] = (tree[prefix] ?? []).map((n) => ({ name: n }));
      return { data: all.slice(o.offset, o.offset + o.limit), error: null };
    },
    remove: async (keys: string[]) => {
      if (opts.failRemove) return { data: null, error: { message: 'denied' } };
      removed.push(...keys);
      return { data: keys.map((k) => ({ name: k })), error: null };
    },
  };
  return { client: { storage: { from: () => api } } as any, removed };
}

function fakeDb(tables: { name: string; type: string }[]) {
  const dropped: string[] = [];
  let cleared = false;
  return {
    dropped,
    wasCleared: () => cleared,
    db: {
      getAll: async (sql: string) => {
        // Mirror the real predicate rather than trusting the caller's filtering: the
        // whole point of the query is which tables it EXCLUDES.
        assert.match(sql, /type = 'table'/);
        return tables.filter((t) => t.type === 'table'
          && !t.name.startsWith('ps_') && !t.name.startsWith('sqlite_'));
      },
      writeTransaction: async (fn: (tx: any) => Promise<void>) => {
        await fn({ execute: async (sql: string) => {
          const m = /DROP TABLE IF EXISTS "(.+)"/.exec(sql);
          if (m) dropped.push(m[1]);
        } });
      },
      disconnectAndClear: async () => { cleared = true; },
    } as any,
  };
}

/* ------------------------------------------------------------- the media -- */

test('a capture folder with more than one page of objects is fully removed', async () => {
  // 250 objects under one capture. A purge that trusts `list`'s default cap deletes
  // the first 100 and reports a clean sweep — the failure this test exists for.
  const files = Array.from({ length: 250 }, (_, i) => `sha${i}.m4a`);
  const { client, removed } = fakeStorage({ 'u1': ['cap-1'], 'u1/cap-1': files });

  const left = await purgeRemoteMedia(client, 'u1');

  assert.equal(left, 0);
  assert.equal(removed.length, 250);
  assert.ok(removed.includes('u1/cap-1/sha249.m4a'), 'the last page must be removed too');
});

test('every capture folder is visited, not just the first', async () => {
  const { client, removed } = fakeStorage({
    'u1': ['cap-1', 'cap-2', 'cap-3'],
    'u1/cap-1': ['a.m4a'], 'u1/cap-2': ['b.jpg'], 'u1/cap-3': ['c.jpg'],
  });

  await purgeRemoteMedia(client, 'u1');

  assert.deepEqual(removed.sort(),
    ['u1/cap-1/a.m4a', 'u1/cap-2/b.jpg', 'u1/cap-3/c.jpg']);
});

test('objects that could not be removed are COUNTED, never reported as deleted', async () => {
  const { client } = fakeStorage(
    { 'u1': ['cap-1'], 'u1/cap-1': ['a.m4a', 'b.jpg'] }, { failRemove: true });

  assert.equal(await purgeRemoteMedia(client, 'u1'), 2);
});

test('an account with no media is not an error', async () => {
  const { client, removed } = fakeStorage({});
  assert.equal(await purgeRemoteMedia(client, 'u1'), 0);
  assert.equal(removed.length, 0);
});

test('the media directory list names directories that actually exist', () => {
  // This list said `draft-media/` for months. The real root is `capture-draft/`, so
  // the delete pointed at nothing, `idempotent: true` swallowed the miss, and every
  // open capture session's photos survived an account close that reported success.
  // A typo and a clean sweep are indistinguishable at runtime — hence this test.
  assert.ok(LOCAL_MEDIA_DIRS.includes(DRAFT_MEDIA_ROOT),
    'draft media must be purged under the constant the writer uses');
  assert.ok(LOCAL_MEDIA_DIRS.includes('capture-quarantine/'),
    'quarantined crash orphans are real capture media and must not survive a purge');
  for (const d of LOCAL_MEDIA_DIRS) {
    assert.ok(d.endsWith('/'), `${d} must be a directory path`);
  }
  assert.equal(new Set(LOCAL_MEDIA_DIRS).size, LOCAL_MEDIA_DIRS.length);
});

/* ------------------------------------------------------------ the device -- */

test('a table added later is dropped without anyone updating a list', async () => {
  const { db, dropped } = fakeDb([
    { name: 'capture_commit', type: 'table' },
    { name: 'change_order', type: 'table' },
    // The whole reason the set is discovered rather than written down.
    { name: 'some_table_invented_next_month', type: 'table' },
  ]);

  assert.deepEqual((await localOwnedTables(db)).sort(),
    ['capture_commit', 'change_order', 'some_table_invented_next_month']);
  assert.equal(dropped.length, 0, 'listing must not delete anything');
});

test("PowerSync's own tables and views are left alone", async () => {
  const { db } = fakeDb([
    { name: 'capture_commit', type: 'table' },
    { name: 'ps_data', type: 'table' },
    { name: 'ps_crud', type: 'table' },
    { name: 'sqlite_sequence', type: 'table' },
    // A PowerSync-managed table is a VIEW over ps_data. Dropping it would remove the
    // sync definition and leave the rows exactly where they were.
    { name: 'project', type: 'view' },
  ]);

  assert.deepEqual(await localOwnedTables(db), ['capture_commit']);
});

/* --------------------------------------------------------------- the act -- */

test('the device is wiped only after the server confirms', async () => {
  const { db, dropped, wasCleared } = fakeDb([{ name: 'change_order', type: 'table' }]);
  const { client } = fakeStorage({});
  client.rpc = async () => ({ data: null, error: { message: 'not signed in' } });

  const r = await closeMyAccount(client, db, 'u1', async () => {});

  assert.equal(r.ok, false);
  // The failure that matters: an empty phone and a full cloud, with the next sync
  // pulling everything back.
  assert.deepEqual(dropped, []);
  assert.equal(wasCleared(), false);
});

test('a successful close wipes the device and reports what went', async () => {
  const { db, dropped, wasCleared } = fakeDb([
    { name: 'change_order', type: 'table' }, { name: 'capture_commit', type: 'table' },
  ]);
  const { client, removed } = fakeStorage({ 'u1': ['cap-1'], 'u1/cap-1': ['a.m4a'] });
  client.rpc = async () => ({ data: { change_orders: 4, captures: 9 }, error: null });

  const r = await closeMyAccount(client, db, 'u1', async () => {});

  assert.deepEqual(r, { ok: true, changeOrders: 4, captures: 9, mediaLeft: 0 });
  assert.deepEqual(dropped.sort(), ['capture_commit', 'change_order']);
  assert.equal(wasCleared(), true);
  assert.deepEqual(removed, ['u1/cap-1/a.m4a']);
});

test('surviving media is surfaced on an otherwise successful close', async () => {
  const { db } = fakeDb([{ name: 'change_order', type: 'table' }]);
  const { client } = fakeStorage(
    { 'u1': ['cap-1'], 'u1/cap-1': ['a.m4a'] }, { failRemove: true });
  client.rpc = async () => ({ data: { change_orders: 1, captures: 1 }, error: null });

  const r = await closeMyAccount(client, db, 'u1', async () => {});

  assert.equal(r.ok, true);
  // "Your account is closed" while a photo survives in a bucket is the same
  // dishonest acknowledgement mandate #1 forbids, pointed the other way.
  assert.equal(r.ok && r.mediaLeft, 1);
});
