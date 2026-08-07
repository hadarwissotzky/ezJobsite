/**
 * DEV-ONLY fixture — the real ExtraLockedScreen populated like the approved mockup.
 * Reached only when EXPO_PUBLIC_FIXTURE === '3'. Removed with the other fixtures.
 */
import React from 'react';
import { Image } from 'react-native';
import type { ExtraRecord, RecordPhoto, RecordEvent } from '../record';
import type { ApprovalPanel } from '../eventlog';
import { ExtraLockedScreen, type ExtraLockedProps } from './extralocked';

const panelUri = Image.resolveAssetSource(require('../../assets/img-house.png')).uri;
const houseUri = Image.resolveAssetSource(require('../../assets/house-hero.png')).uri;

const photos: RecordPhoto[] = [
  { captureId: 'p1', modality: 'photo', at: 'Jan 18 · 8:33 am', uri: panelUri, present: true, place: null },
  { captureId: 'p2', modality: 'photo', at: 'Jan 18 · 8:33 am', uri: houseUri, present: true, place: null },
  { captureId: 'p3', modality: 'photo', at: 'Jan 18 · 8:34 am', uri: panelUri, present: true, place: null },
];

const rec: ExtraRecord = {
  id: 'fixture-locked',
  title: 'Panel upgrade — code required',
  // 391 — the fixtures carry the worked fireplace example so the three lifecycle
  // screens are exercised against a REAL scope of work rather than a one-line
  // title. The length is the whole point of the split.
  scopeOfWork: `Move the original 1910 fireplace mantel and surround from the downstairs bedroom into the living room, move the living room's existing mantel down into the bedroom, and refinish the 1910 piece in its new position.

1 · Protect both rooms. Dust barriers at both doorways, negative-air fan while sanding, both fireboxes sealed.
2 · Document and remove the 1910 mantel by hand — plaster-keyed and cut-nailed, not screwed.
3 · Move the living room mantel down to the bedroom and make good the opening.
4 · Install the 1910 mantel in the living room — blocking, level, scribed to the wall.
5 · Strip and sand: hand-sand all profiles and carving, machine only the flat faces, to 180.
6 · Stain to a sample you approve on an offcut of the actual mantel, then two coats clear satin.
7 · Reinstate, caulk, touch up and clean both rooms.

ASSUMING · Both chimney breasts sound · The 1910 piece comes off intact — if not we stop and call you · Paint assumed to contain LEAD until tested.`,
  status: 'approved',
  amount: '$2,400',
  priced: true,
  // 396: a priced fixture has nothing to read back — the quote only exists
  // while a price does not.
  priceHeard: null,
  nte: null,
  isMini: false,
  extraNo: 4,
  jobName: 'Miller — Hall Bath',
  created: 'Jan 18',
  createdAtMs: 1,
  capturedAt: 'Jan 18 · 8:32 am',
  capturedPlace: null,
  stateLineKey: 'erec.stApproved',
  people: [],
  description: 'Install new 200A electrical panel to meet code requirements.',
  photos,
  photosTruncated: 0,
  voices: [
    { captureId: 'v1', uri: houseUri, at: 'Jan 18 · 8:32 am', capturedAtMs: 1, present: true,
      transcript: 'Panel is undersized, needs a full 200 amp upgrade to meet code.' },
    { captureId: 'v2', uri: houseUri, at: 'Jan 18 · 8:34 am', capturedAtMs: 2, present: true,
      transcript: 'Also relabel the circuits while the cover is off.' },
  ],
  history: [],
  synced: true,
};

const approval: ApprovalPanel = {
  signal: null,
  lastOpenedMs: null,
  snapshot: {
    content: 'Install new 200A electrical panel to meet code. Fixed price $2,400.',
    verified: true,
    signedName: 'Sarah Miller',
    signedAt: 'Jan 18, 2025 at 10:12 AM',
    action: 'confirmed',
    superseded: false,
  },
  neverFetched: false,
};

// The steps that led to the approval — created, sent (NOT the approval itself; that
// renders from the frozen snapshot).
const chain: RecordEvent[] = [
  { atMs: 3, at: 'Jan 18, 2025 at 8:35 AM', what: 'Sent for approval by You' },
  { atMs: 2, at: 'Jan 18, 2025 at 8:32 AM', what: 'Created by Marco R.' },
];

const LK_Y = 0;
const noop = () => {};

export function FixtureLocked() {
  const props: ExtraLockedProps = {
    rec,
    agreed: {
      billingTiming: 'when_completed',
      scheduleEffect: 'no_change',
      scheduleDays: null,
      exclusions: null,
    },
    approval,
    chain,
    approver: { name: 'Sarah Miller', role: 'Homeowner / Approver' },
    approverNote: 'Looks good. Please proceed.',
    kicker: 'Extra #4 · Miller — Hall Bath',
    onBack: noop,
    onViewSignedApproval: noop,
    onViewFullHistory: noop,
    onCreateLinkedExtra: noop,
    onPressPhoto: noop,
    _fixtureScrollY: LK_Y,
  };
  return <ExtraLockedScreen {...props} />;
}
