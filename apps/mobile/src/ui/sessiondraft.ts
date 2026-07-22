/**
 * R1 — the React side of a durable capture session.
 *
 * A hook rather than more code inside `FusedCapture`, for one reason that is not
 * tidiness: the capture screen is already the most crowded file in the app and
 * the part being added here (bank on every stop, bank on backgrounding, stop at
 * the cap) is exactly the part that must keep working when everything else on
 * that screen is failing. Isolating it makes the integration a handful of call
 * sites instead of a rewrite, and leaves the durability rules in one place where
 * they can be read end to end.
 *
 * All the arithmetic is in `capturesession.ts` (pure, unit-tested) and all the
 * writes are in `capturedraft.ts`. This file only decides WHEN.
 */
import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { AbstractPowerSyncDatabase } from '@powersync/react-native';

import { capState, type CapState } from '../capturesession';
import {
  openDraft, setDraftStamp, bankPhoto, bankAudioSegment, bankedRecordedMs,
  closeDraft, type BankResult,
} from '../capturedraft';
import type { Stamp } from '../stamp';

/**
 * Fire when the app stops being the thing on screen.
 *
 * 'inactive' counts, not just 'background'. On iOS an incoming call, Control
 * Centre or the app switcher hits 'inactive' first, and on a low-memory device
 * the process can be killed from there without ever reaching 'background'. The
 * whole point is to have banked the bytes BEFORE the OS decides; waiting for the
 * later, more definite state is waiting for a notification that may not come.
 */
export function useLeavingForeground(cb: () => void): void {
  const ref = React.useRef(cb);
  ref.current = cb;
  React.useEffect(() => {
    let last: AppStateStatus = AppState.currentState;
    const sub = AppState.addEventListener('change', (next) => {
      if (last === 'active' && next !== 'active') ref.current();
      last = next;
    });
    return () => sub.remove();
  }, []);
}

export type SessionDraft = {
  /** null until the draft row exists. Banking before that is a no-op, reported. */
  draftId: string | null;
  /** Audio already on disk, in ms. Drives the cap; never wall clock. */
  bankedMs: number;
  cap: CapState;
  /**
   * Banks that FAILED. Non-zero means something the user believes is captured is
   * not yet safe, and the screen must say so rather than let "Done" imply it.
   */
  unsafe: number;
  photo(o: { srcUri: string; atMs: number; mime?: string; fromLibrary?: boolean }): Promise<BankResult>;
  segment(o: { srcUri: string; startedAtMs: number; durationMs: number; mime?: string }): Promise<BankResult>;
  /** Call ONLY after every capture has committed. Deletes the draft's copies. */
  commit(): Promise<void>;
  /** The human threw the walk away. Their decision, recorded, not second-guessed. */
  discard(): Promise<void>;
};

export function useSessionDraft(o: {
  db: AbstractPowerSyncDatabase;
  ownerId: string;
  /** The capture's own fix. May be null for the first seconds while GPS resolves. */
  stamp: Stamp | null;
  /** False while permissions are still being asked; no draft is opened until true. */
  enabled: boolean;
  /** Resume an existing draft instead of starting one (crash recovery). */
  resumeDraftId?: string | null;
}): SessionDraft {
  const { db, ownerId, enabled, resumeDraftId } = o;
  const [draftId, setDraftId] = React.useState<string | null>(resumeDraftId ?? null);
  const [bankedMs, setBankedMs] = React.useState(0);
  const [unsafe, setUnsafe] = React.useState(0);
  const stampedRef = React.useRef(false);

  React.useEffect(() => {
    if (!enabled || draftId) return;
    let live = true;
    (async () => {
      try {
        const id = await openDraft(db, { ownerId, stamp: null });
        if (live) setDraftId(id);
      } catch {
        // A draft we cannot open means this session is NOT crash-safe. The screen
        // still records — mandate #1 says a capture is never blocked — but
        // `unsafe` is what tells the user the difference.
        if (live) setUnsafe((n) => n + 1);
      }
    })();
    return () => { live = false; };
  }, [db, ownerId, enabled, draftId]);

  // Fill the stamp once the fix lands. Guarded twice (a ref here, a WHERE clause
  // in SQL) because a re-render with a newer fix must not move the location of a
  // capture that already has one.
  React.useEffect(() => {
    if (!draftId || !o.stamp || stampedRef.current) return;
    stampedRef.current = true;
    setDraftStamp(db, draftId, o.stamp).catch(() => { /* header keeps its nulls, honestly */ });
  }, [db, draftId, o.stamp]);

  React.useEffect(() => {
    if (!draftId) return;
    bankedRecordedMs(db, draftId).then(setBankedMs).catch(() => { /* keep the last known */ });
  }, [db, draftId]);

  const photo: SessionDraft['photo'] = React.useCallback(async (p) => {
    if (!draftId) { setUnsafe((n) => n + 1); return { ok: false, reason: 'no draft' }; }
    const r = await bankPhoto(db, draftId, p);
    if (!r.ok) setUnsafe((n) => n + 1);
    return r;
  }, [db, draftId]);

  const segment: SessionDraft['segment'] = React.useCallback(async (seg) => {
    if (!draftId) { setUnsafe((n) => n + 1); return { ok: false, reason: 'no draft' }; }
    const r = await bankAudioSegment(db, draftId, seg);
    if (r.ok) setBankedMs((ms) => ms + Math.max(0, Math.round(seg.durationMs)));
    else setUnsafe((n) => n + 1);
    return r;
  }, [db, draftId]);

  const commit = React.useCallback(async () => {
    if (draftId) await closeDraft(db, draftId, 'committed');
  }, [db, draftId]);
  const discard = React.useCallback(async () => {
    if (draftId) await closeDraft(db, draftId, 'discarded');
  }, [db, draftId]);

  return { draftId, bankedMs, cap: capState(bankedMs), unsafe, photo, segment, commit, discard };
}
