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
  { captureId: 'v1', uri: houseUri, at: 'Jan 18 · 8:32 am', capturedAtMs: 1, present: true, silent: false,
    transcript: 'Panel is undersized, needs a full 200 amp upgrade to meet code.' },
  { captureId: 'v2', uri: houseUri, at: 'Jan 18 · 8:34 am', capturedAtMs: 2, present: true, silent: false,
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
  status: 'draft',
  scopeOfWorkNative: null,
  scopeNativeLang: null,
  amount: '$2,400',
  // A PRICED-IN-PARTS extra, so the cost grid is visible in the preview. The parts
  // sum to the $2,400 above; the screen shows that total from `amount` and never
  // adds these up itself.
  costLines: [
    { title: 'Pull permit and disconnect', detail: null, amount: '$400.00' },
    { title: 'Panel and breakers', detail: null, amount: '$1,250.00' },
    { title: 'Install and terminate', detail: '2 × $375.00', amount: '$750.00' },
  ],
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
