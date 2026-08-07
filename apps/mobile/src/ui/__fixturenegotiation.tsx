/**
 * DEV-ONLY fixture — the real ExtraNegotiationScreen populated like the mockup
 * (post-sent, opened, mid-discussion). Reached only when EXPO_PUBLIC_FIXTURE === '2'.
 * Scaffolding; removed with the other fixtures when the screen matches.
 */
import React from 'react';
import type { ExtraRecord, RecordPhoto, RecordVoice, RecordPerson } from '../record';
import type { ThreadState, ThreadMessage } from '../discussion';
import { Image } from 'react-native';
import { ExtraNegotiationScreen, type ExtraNegotiationProps } from './extranegotiation';

const face = Image.resolveAssetSource(require('../../assets/house-hero.png')).uri;
const panelUri = Image.resolveAssetSource(require('../../assets/img-house.png')).uri;

const people: RecordPerson[] = [
  { roleKey: 'erec.approverRole', name: 'Sarah Miller', when: null, kind: 'approver' },
  { roleKey: 'erec.crewRole', name: 'Marco R.', when: null, kind: 'crew' },
];
const photos: RecordPhoto[] = [
  { captureId: 'p1', modality: 'photo', at: 'Jan 18 · 8:33 am', uri: panelUri, present: true, place: null },
  { captureId: 'p2', modality: 'photo', at: 'Jan 18 · 8:33 am', uri: face, present: true, place: null },
  { captureId: 'p3', modality: 'photo', at: 'Jan 18 · 8:34 am', uri: panelUri, present: true, place: null },
];
const voices: RecordVoice[] = [];

const rec: ExtraRecord = {
  id: 'fixture-neg',
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
  status: 'sent',
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
  stateLineKey: 'erec.stSent',
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

const messages: ThreadMessage[] = [
  { id: 'm1', side: 'client', text: 'Can you confirm this meter will need to be moved?', atMs: 1 },
  { id: 'm2', side: 'contractor', text: 'Yes, the meter moves about 2 feet left to meet clearance. Included in this price.', atMs: 2 },
  { id: 'm3', side: 'client', text: 'Thanks. When would this work be completed?', atMs: 3 },
];

const thread: ThreadState = {
  messages,
  open: true,
  inDiscussion: true,
  unansweredSinceMs: 3,
  awaitingReply: false,
  canReply: true,
  canRevise: true,
};

const NEG_Y = 850;
const noop = () => {};

export function FixtureNegotiation() {
  const props: ExtraNegotiationProps = {
    rec,
    kicker: 'Extra #4 · Miller — Hall Bath',
    terms: {
      billingTiming: 'Upon completion',
      scheduleEffect: null,
      exclusions: null,
    },
    approver: { name: 'Sarah Miller', role: 'Homeowner / Approver', photoUri: face },
    contributors: [
      { name: 'Marco R.', role: 'Captured', photoUri: face },
      { name: 'You', role: 'Priced & sent', photoUri: face },
    ],
    openCount: 3,
    lastOpenedAtMs: 4,
    openQuestions: 0,
    thread,
    undelivered: new Set(),
    remind: { ok: true },
    formatAt: () => 'Jan 18 · 8:40 am',
    onBack: noop,
    onReply: async () => {},
    onRemind: async () => ({ ok: true }),
    onRevise: noop,
    onOpenDetail: noop,
    onViewHistory: noop,
    onNewLinkedExtra: undefined,
    onCapture: noop,
    _fixtureScrollY: NEG_Y,
  };
  return <ExtraNegotiationScreen {...props} />;
}
