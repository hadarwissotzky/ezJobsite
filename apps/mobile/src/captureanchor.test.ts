/**
 * Run: cd apps/mobile && node --test src/captureanchor.test.ts
 *
 * The case that matters is `speak, photograph, then type` — the exact sequence that
 * silently detached a contractor's evidence from his change order before 2026-09-03.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { pickAnchor } from './captureanchor.ts';

test('voice wins, whatever else was captured and in whatever order', () => {
  // THE REGRESSION. Old code did ids[photos.length] over [p1,p2,TEXT,v1] -> the text.
  assert.deepEqual(
    pickAnchor({ photoIds: ['p1', 'p2'], textId: 't1', voiceIds: ['v1', 'v2'] }),
    { captureId: 'v1', voiceCaptureId: 'v1' });
  // Same walkthrough without the typed correction — the answer must not change.
  assert.deepEqual(
    pickAnchor({ photoIds: ['p1', 'p2'], textId: null, voiceIds: ['v1', 'v2'] }),
    { captureId: 'v1', voiceCaptureId: 'v1' });
});

test('no voice: a PHOTO anchors it, never the text beside it', () => {
  // Text carries no `capture_pair` row, so anchoring on it would orphan the photos.
  assert.deepEqual(
    pickAnchor({ photoIds: ['p1'], textId: 't1', voiceIds: [] }),
    { captureId: 'p1', voiceCaptureId: null });
});

test('text alone anchors itself — a walk that finds nothing is then the truth', () => {
  assert.deepEqual(
    pickAnchor({ photoIds: [], textId: 't1', voiceIds: [] }),
    { captureId: 't1', voiceCaptureId: null });
});

test('nothing captured yields nothing, rather than a fabricated id', () => {
  assert.deepEqual(
    pickAnchor({ photoIds: [], textId: null, voiceIds: [] }),
    { captureId: null, voiceCaptureId: null });
});

test('voiceCaptureId is null without audio, so nobody waits on a transcript', () => {
  assert.equal(pickAnchor({ photoIds: ['p1'], textId: 't1', voiceIds: [] }).voiceCaptureId, null);
});
