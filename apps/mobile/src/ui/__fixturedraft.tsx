/**
 * DEV-ONLY fixture — renders the real ExtraDraftScreen populated exactly like the
 * approved mockup, so the draft screen can be compared pixel-for-pixel in the
 * simulator without capturing media through a camera the simulator does not have.
 *
 * This is scaffolding, not product. It is reached ONLY when
 * `process.env.EXPO_PUBLIC_FIXTURE === '1'` (a branch at the top of App.tsx) and it
 * imports nothing the app does not already ship — it builds `ExtraDraftProps` by
 * hand and hands it to the SAME component production uses, so every style fix made
 * while looking at it lands in the real screen. Delete the file and the App.tsx
 * branch when the screen matches.
 */
import React from 'react';
import { Image } from 'react-native';
import type { ExtraRecord, RecordPhoto, RecordVoice, RecordPerson } from '../record';
import type { SendReadiness } from '../sendreadiness';
import { ExtraDraftScreen, type ExtraDraftProps } from './extradraft';

const houseUri = Image.resolveAssetSource(require('../../assets/house-hero.png')).uri;
const panelUri = Image.resolveAssetSource(require('../../assets/img-house.png')).uri;

const photo = (id: string, uri: string, at: string): RecordPhoto => ({
  captureId: id, modality: 'photo', at, uri, present: true, place: null,
});

const voices: RecordVoice[] = [
  { captureId: 'v1', uri: houseUri, at: 'Jan 18 · 8:32 am', capturedAtMs: 1, present: true,
    transcript: 'Panel is undersized, needs a full 200 amp upgrade to meet code.' },
  { captureId: 'v2', uri: houseUri, at: 'Jan 18 · 8:34 am', capturedAtMs: 2, present: true,
    transcript: 'Also relabel the circuits while the cover is off.' },
];

const photos: RecordPhoto[] = [
  photo('p1', panelUri, 'Jan 18 · 8:33 am'),
  photo('p2', houseUri, 'Jan 18 · 8:33 am'),
  photo('p3', panelUri, 'Jan 18 · 8:34 am'),
];

const people: RecordPerson[] = [
  { roleKey: 'erec.approverRole', name: 'Sarah Miller', when: null, kind: 'approver' },
  { roleKey: 'erec.crewRole', name: 'Marco R.', when: null, kind: 'crew' },
];

const rec: ExtraRecord = {
  id: 'fixture',
  title: 'Panel upgrade — code required',
  status: 'draft',
  amount: '$2,400',
  priced: true,
  nte: null,
  isMini: false,
  extraNo: 4,
  jobName: 'Miller — Hall Bath',
  created: 'Jan 18',
  createdAtMs: 1,
  capturedAt: 'Jan 18 · 8:32 am',
  capturedPlace: '37.77490, -122.41940',
  stateLineKey: 'erec.stDraft',
  people,
  description: 'Install new 200A electrical panel to meet code requirements. Includes '
    + 'removing existing panel, upgrading load center, relabeling circuits, and testing '
    + 'the new system.',
  photos,
  photosTruncated: 0,
  voices,
  history: [],
  synced: true,
};

// The mockup's readiness: cost is SET (shows $2,400), the two blockers named in the
// banner are schedule impact and what's-not-included. Description and photos are
// present. So blockers = the two flow fields still owed.
const readiness: SendReadiness = {
  ok: false,
  blockers: ['no_schedule_effect', 'no_exclusions'],
  recommended: ['no_schedule_effect', 'no_exclusions'],
  completeness: { have: 2, of: 4 },
};

// Bump this to walk down the screen for screenshots. 0 = top.
const FIXTURE_Y = 0;
const noop = () => {};

export function FixtureDraft() {
  // The fixture holds the title in state so renaming actually shows here; the real
  // screen's rename goes through `retitleDraft` and re-reads the record.
  const [title, setTitle] = React.useState(rec.title);
  const props: ExtraDraftProps = {
    rec: { ...rec, title },
    kind: 'extra',
    extraNo: 4,
    readiness,
    proc: 'processed',
    priceMode: 'fixed',
    billingTiming: 'when_completed',
    scheduleEffect: null,
    scheduleDays: null,
    exclusions: null,
    requestedBy: 'Sarah Miller',
    clientTypeLabel: 'General contractor',
    capturedWith: 'Voice note · Jan 18 · 8:32 am',
    onBack: noop,
    onRetitle: setTitle,
    onAddContact: noop,
    onEditDescription: noop,
    onEditCost: noop,
    onEditBilling: noop,
    onEditSchedule: noop,
    onEditExclusions: noop,
    onEditDetails: noop,
    onAddPhotos: noop,
    onPressPhoto: noop,
    onSend: noop,
    onDelete: noop,
    _fixtureScrollY: FIXTURE_Y,
  };
  return <ExtraDraftScreen {...props} />;
}
