import assert from 'node:assert/strict';
import test from 'node:test';
import { discardSummary, planDiscard, type CaptureRef } from './discard.ts';

const own = (id: string): CaptureRef => ({ captureId: id, usedByExtras: 1, uploaded: false });
const shared = (id: string): CaptureRef => ({ captureId: id, usedByExtras: 2, uploaded: false });

test('a draft with its own captures can be discarded whole', () => {
  const p = planDiscard({ status: 'draft', hasLiveLink: false }, [own('c1'), own('c2')]);
  assert.equal(p.allowed, true);
  if (!p.allowed) return;
  assert.deepEqual(p.deleteCaptures, ['c1', 'c2']);
  assert.deepEqual(p.keepCaptures, []);
});

// THE ONE THAT MATTERS MOST. revision.ts reuses prior.decision_id, so a revised
// extra shares captures with the original. Deleting "this extra's assets"
// without checking would silently gut the sibling — and the sibling may be SENT.
test('a capture another extra still reaches is never deleted', () => {
  const p = planDiscard({ status: 'draft', hasLiveLink: false }, [own('c1'), shared('c2')]);
  assert.equal(p.allowed, true);
  if (!p.allowed) return;
  assert.deepEqual(p.deleteCaptures, ['c1']);
  assert.deepEqual(p.keepCaptures, [{ captureId: 'c2', why: 'shared' }]);
});

test('a sent extra is refused — supersede is the path for those', () => {
  for (const status of ['sent', 'approved', 'declined', 'superseded', 'discussing']) {
    const p = planDiscard({ status, hasLiveLink: false }, [own('c1')]);
    assert.equal(p.allowed, false, status);
    if (!p.allowed) assert.equal(p.reason, 'already_sent', status);
  }
});

// A whitelist, not `status !== 'sent'`. A future status must be refused by
// default rather than allowed by omission — the failure of a blacklist is
// silent and destroys data.
test('an unknown future status is refused, not allowed by omission', () => {
  const p = planDiscard({ status: 'awaiting_countersign', hasLiveLink: false }, []);
  assert.equal(p.allowed, false);
});

test('a draft holding a live link is refused', () => {
  const p = planDiscard({ status: 'draft', hasLiveLink: true }, [own('c1')]);
  assert.equal(p.allowed, false);
  if (!p.allowed) assert.equal(p.reason, 'has_link');
});

test('a missing extra is refused rather than treated as empty', () => {
  const p = planDiscard(null, []);
  assert.equal(p.allowed, false);
  if (!p.allowed) assert.equal(p.reason, 'not_found');
});

// Local deletion of an uploaded capture is not deletion. The caller has to know
// which ones need the server so it can report honestly instead of claiming a
// success it only half achieved.
test('uploaded captures are flagged as needing the server', () => {
  const p = planDiscard({ status: 'draft', hasLiveLink: false }, [
    { captureId: 'c1', usedByExtras: 1, uploaded: true },
    { captureId: 'c2', usedByExtras: 1, uploaded: false },
    { captureId: 'c3', usedByExtras: 2, uploaded: true },   // shared: not ours
  ]);
  assert.equal(p.allowed, true);
  if (!p.allowed) return;
  assert.deepEqual(p.needsServer, ['c1']);
});

test('an extra with no captures is still discardable', () => {
  const p = planDiscard({ status: 'draft', hasLiveLink: false }, []);
  assert.equal(p.allowed, true);
  if (!p.allowed) return;
  assert.deepEqual(p.deleteCaptures, []);
});

// Mandate #2: a confirmation that does not name what it destroys is a speed bump.
test('the confirmation names the counts, and says when some are kept', () => {
  const plain = planDiscard({ status: 'draft', hasLiveLink: false }, [own('c1'), own('c2')]);
  assert.deepEqual(discardSummary(plain), { k: 'discard.confirm', p: { n: 2, kept: 0 } });

  const mixed = planDiscard({ status: 'draft', hasLiveLink: false }, [own('c1'), shared('c2')]);
  assert.deepEqual(discardSummary(mixed), { k: 'discard.confirmShared', p: { n: 1, kept: 1 } });
});

test('a refused plan has no summary to show', () => {
  assert.equal(discardSummary(planDiscard(null, [])), null);
});
