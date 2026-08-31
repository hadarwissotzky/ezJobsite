/**
 * The line a person reads out loud when something is wrong. Its job is to make three
 * different failures LOOK different — that is the whole reason it exists.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { syncLine, type SyncState } from './syncstate.ts';

const NOW = 1_700_000_000_000;
const base: SyncState = {
  connected: true, everSynced: true, lastSyncedAtMs: NOW - 120_000, projects: 8,
  queued: 0, struggling: 0,
};

test('a healthy phone says when and how many', () => {
  assert.equal(syncLine(base, NOW), 'Synced 2 min ago · 8 jobs on this phone');
});

test('NEVER SYNCED reads differently from OFFLINE — the two hadar could not tell apart', () => {
  // Both show an empty job list. One is a device that has not finished its first
  // sync; the other has synced and genuinely holds nothing. Same screen, opposite
  // causes, and the app used to say nothing for either.
  const never = syncLine({ ...base, everSynced: false, connected: true }, NOW);
  const offline = syncLine({ ...base, connected: false }, NOW);
  assert.equal(never, 'Connected — first sync has not finished');
  assert.match(offline, /^Offline — last synced 2 min ago/);
  assert.notEqual(never, offline);
});

test('SYNCED BUT EMPTY is the case that started this — it must be unmistakable', () => {
  // The server had 8 projects and the phone showed none. This line is the one that
  // would have said so in five seconds: synced fine, holds nothing.
  assert.equal(syncLine({ ...base, projects: 0 }, NOW),
    'Synced 2 min ago · 0 jobs on this phone');
});

test('one job is not "1 jobs"', () => {
  assert.match(syncLine({ ...base, projects: 1 }, NOW), /1 job on this phone$/);
});

test('queued work is named, because it blocks an update from applying', () => {
  assert.match(syncLine({ ...base, queued: 3 }, NOW), /3 waiting to upload$/);
});

test('an unknown last-sync time is admitted, not guessed', () => {
  assert.match(syncLine({ ...base, lastSyncedAtMs: null }, NOW), /at an unknown time/);
});

test('the clock reads in units a person uses', () => {
  const at = (ms: number) => syncLine({ ...base, lastSyncedAtMs: NOW - ms }, NOW);
  assert.match(at(30_000), /just now/);
  assert.match(at(45 * 60_000), /45 min ago/);
  assert.match(at(5 * 3_600_000), /5 h ago/);
  assert.match(at(3 * 86_400_000), /3 d ago/);
});
