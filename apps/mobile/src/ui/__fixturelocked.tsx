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
  status: 'approved',
  amount: '$2,400',
  priced: true,
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
