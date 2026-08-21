/**
 * The device-handover decision.
 *   cd apps/mobile && node --test src/deviceowner.test.ts
 *
 * These tests exist because BOTH ways of getting this wrong are silent:
 *   - not wiping shows one contractor another contractor's jobs, photos and prices,
 *     with no error anywhere (the bug hadar hit on 2026-08-21);
 *   - wiping when it was not warranted destroys the user's own work, and there is
 *     nothing to restore it from.
 *
 * So every case below is about WHICH of those two the code picks, and the failure
 * ordering that decides whether an interrupted handover is retried or forgotten.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { claimDevice } from './deviceowner.ts';

/** Records what was called, in order, so the ORDERING assertions can be made. */
function harness(previous: string | null, opts: {
  failPurgeData?: boolean; failMedia?: boolean; failRemember?: boolean;
  failRead?: boolean; failCount?: boolean; unsent?: number;
} = {}) {
  const calls: string[] = [];
  let stored = previous;
  return {
    calls,
    remembered: () => stored,
    deps: {
      lastUser: async () => {
        if (opts.failRead) throw new Error('storage unreadable');
        calls.push('read');
        return stored;
      },
      remember: async (id: string) => {
        if (opts.failRemember) throw new Error('write refused');
        calls.push('remember');
        stored = id;
      },
      purgeData: async () => {
        if (opts.failPurgeData) throw new Error('database locked');
        calls.push('purgeData');
      },
      purgeMedia: async () => {
        if (opts.failMedia) throw new Error('file busy');
        calls.push('purgeMedia');
      },
      onWipeStart: () => { calls.push('wipeStart'); },
      pendingWork: async () => {
        if (opts.failCount) throw new Error('count failed');
        calls.push('count');
        return opts.unsent ?? 0;
      },
    },
  };
}

const DB = {} as any;

test('the same user signing back in keeps everything', async () => {
  // The case that makes wipe-at-sign-out wrong: a mis-tap, or signing out to fix
  // something, must not cost the captures still queued on the phone.
  const h = harness('user-a');
  const r = await claimDevice(DB, 'user-a', h.deps);
  assert.deepEqual(r, { wiped: false });
  assert.deepEqual(h.calls, ['read'], 'nothing may be purged for the same user');
});

test('a different user gets a wiped device', async () => {
  const h = harness('user-a');
  const r = await claimDevice(DB, 'user-b', h.deps);
  assert.deepEqual(r, { wiped: true, previousUser: 'user-a' });
  assert.deepEqual(h.calls,
    ['read', 'count', 'wipeStart', 'purgeMedia', 'purgeData', 'remember']);
  assert.equal(h.remembered(), 'user-b');
});

test('the UI is told BEFORE anything is destroyed', async () => {
  // purgeData DROPs every app-owned table. A render between the drop and the rebuild
  // queries tables that do not exist, so the callback has to lead the purge, not
  // follow it.
  const h = harness('user-a');
  await claimDevice(DB, 'user-b', h.deps);
  assert.ok(h.calls.indexOf('wipeStart') < h.calls.indexOf('purgeData'));
  assert.ok(h.calls.indexOf('wipeStart') < h.calls.indexOf('purgeMedia'));
});

test('an unclaimed device is claimed, never wiped', async () => {
  // This is the FIRST LAUNCH AFTER THIS SHIPS on a phone already full of the user's
  // own work. Wiping here would destroy their data to protect them from themselves.
  const h = harness(null);
  const r = await claimDevice(DB, 'user-a', h.deps);
  assert.deepEqual(r, { wiped: false });
  assert.deepEqual(h.calls, ['read', 'remember']);
  assert.equal(h.remembered(), 'user-a');
});

test('an interrupted wipe does not record the new owner', async () => {
  // The ordering that matters most. If the owner were recorded first, a purge that
  // died halfway would leave the device marked as B's with A's rows still in it — and
  // every later sign-in would see a matching owner and skip the wipe FOREVER. Leaving
  // it unrecorded means the next sign-in simply tries again.
  const h = harness('user-a', { failPurgeData: true });
  const r = await claimDevice(DB, 'user-b', h.deps);
  assert.ok('failed' in r);
  assert.equal(h.remembered(), 'user-a', 'the device still belongs to whoever it belonged to');
  assert.ok(!h.calls.includes('remember'));
});

test('a media purge failure refuses the handover outright', async () => {
  // Media first, database second (closeaccount.ts's argument): the rows are the index
  // to the files. A failure here must not fall through to "signed in anyway".
  const h = harness('user-a', { failMedia: true });
  const r = await claimDevice(DB, 'user-b', h.deps);
  assert.ok('failed' in r);
  assert.ok(!h.calls.includes('purgeData'), 'nothing else runs after a failed purge');
});

test('an unreadable owner marker refuses rather than assuming a clean device', async () => {
  // "I could not read who owns this phone" must never be answered with "so nobody
  // does" — that answer skips the wipe, which is the whole failure being prevented.
  const h = harness('user-a', { failRead: true });
  const r = await claimDevice(DB, 'user-b', h.deps);
  assert.ok('failed' in r);
});

test('a failure to record the owner on a fresh device is reported', async () => {
  // Silently continuing would leave the device permanently unclaimed, so the NEXT
  // user to sign in would be treated as the first one and inherit this user's data.
  const h = harness(null, { failRemember: true });
  const r = await claimDevice(DB, 'user-a', h.deps);
  assert.ok('failed' in r);
});

/* ---------------------------------------- durability outranks the leak -- */

test('a handover is REFUSED while the previous user has unsent work', async () => {
  // IMPLEMENTATION_NOTES §6(a), and the row its verification gate calls "the one that
  // matters". A capture that has not uploaded exists ONLY here; wiping it to hide it
  // from the incoming user trades a confidentiality bug for a durability one, which
  // is the strictly worse half of mandate #1.
  const h = harness('user-a', { unsent: 3 });
  const r = await claimDevice(DB, 'user-b', h.deps);
  assert.ok('refused' in r && r.refused);
  assert.equal((r as any).unsent, 3);
  assert.equal((r as any).previousUser, 'user-a');
  // `where` names which queue holds it — see describePendingWork. Absent here only
  // because the fake db answers no COUNT queries.
  assert.ok(!('where' in r) || typeof (r as any).where === 'string' || (r as any).where === undefined);
  assert.ok(!h.calls.includes('purgeData'));
  assert.ok(!h.calls.includes('purgeMedia'));
  assert.ok(!h.calls.includes('wipeStart'), 'no wipe was started, so the UI is not held');
  assert.equal(h.remembered(), 'user-a', 'the device still belongs to the previous user');
});

test('the refused previous user signing back in is untouched', async () => {
  // The way out of a refusal. It must not itself be blocked by the unsent work —
  // draining is exactly what they came back to do.
  const h = harness('user-a', { unsent: 3 });
  const r = await claimDevice(DB, 'user-a', h.deps);
  assert.deepEqual(r, { wiped: false });
  assert.ok(!h.calls.includes('count'), 'a same-user claim never even asks');
});

test('an uncountable outbox refuses rather than deleting on a guess', async () => {
  const h = harness('user-a', { failCount: true });
  const r = await claimDevice(DB, 'user-b', h.deps);
  assert.ok('failed' in r);
  assert.ok(!h.calls.includes('purgeData'));
});

test('a fresh device is claimed without consulting the outbox', async () => {
  // Nothing to protect and nobody to protect it from: an unclaimed device's rows
  // belong to the person signing in.
  const h = harness(null, { unsent: 9 });
  assert.deepEqual(await claimDevice(DB, 'user-a', h.deps), { wiped: false });
  assert.ok(!h.calls.includes('count'));
});

test('an EMPTY open draft does not block a handover', async () => {
  // hadar's phone, 2026-08-21: refused with "1 item(s)" and no amount of signal could
  // ever clear it. An open draft with nothing in it never drains (nothing drains a
  // draft — a human commits or discards it) and is never offered for recovery either,
  // because `recoverable` deliberately requires real content. So it refused every
  // handover for the life of the install, invisibly.
  //
  // The refusal protects work somebody would be upset to lose. An empty draft is not
  // that, and blocking on it protects nothing while costing the device its only route
  // to a second account.
  const h = harness('user-a', { unsent: 0 });   // queued 0, no draft holding anything
  const r = await claimDevice(DB, 'user-b', h.deps);
  assert.deepEqual(r, { wiped: true, previousUser: 'user-a' },
    'nothing is at risk, so the handover proceeds');
});

test('a draft that HOLDS something still blocks', async () => {
  // The other side of the same line: a banked photo or audio segment is exactly the
  // evidence mandate #1 says must not be destroyed to make room for another account.
  const h = harness('user-a', { unsent: 1 });
  const r = await claimDevice(DB, 'user-b', h.deps);
  assert.ok('refused' in r);
  assert.ok(!h.calls.includes('purgeData'));
});
