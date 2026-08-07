import '@azure/core-asynciterator-polyfill';
import 'react-native-get-random-values';

import { OPSqliteOpenFactory } from '@powersync/op-sqlite';
import { PowerSyncDatabase } from '@powersync/react-native';
import * as FS from 'expo-file-system/legacy';
import * as Contacts from 'expo-contacts';
import React from 'react';
import { Alert, Dimensions, Image, Linking, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppSchema } from './src/AppSchema';
import { ago, projectCards, staticMapUrl, type ProjectCard } from './src/ui/home';
import { REJECT_DDL, SupabaseConnector } from './src/connector';
import { getSeenOnboarding, setSeenOnboarding } from './src/auth';
import { buildLine, useOta } from './src/otaclient';
import { Onboarding } from './src/ui/onboarding';
import { AuthScreen } from './src/ui/authscreen';
import type { Session } from '@supabase/supabase-js';
import { readCapture,
  applyDurabilityProfile,
  assertDurabilityProfile,
  ensureAppOwnedSchema,
  listCommittedCaptures,
  performCapture,
  recoverySweep,
} from './src/capture';
import { RecordingPresets, readRecordingBytes, requestMic, useAudioRecorder } from './src/recorder';
import { photoCapture, pickFromLibrary, textCapture, voiceCapture } from './src/modality';
import { checkJobs, checkSendQuota, currentPlan, type QuotaKind } from './src/quota';
import { usageSummary, type UsageSummary } from './src/usage';
import { UsageCard, UsageNudge } from './src/ui/usagecard';
import { QuotaModal } from './src/ui/quotamodal';
import { SwipeRow } from './src/ui/swiperow';
import { PaywallScreen } from './src/ui/paywallscreen';
import { PLANS, type PlanId } from './src/plans';
import { Icon } from './src/ui/icon';
import { Svg, Circle } from 'react-native-svg';
import { C, F } from './src/ui/theme';
import { radii, shadows } from './src/ui/tokens';
import { FusedCapture, type FusedArtifacts } from './src/ui/capturescreen';
import { SplashScreen } from './src/ui/splashscreen';
import { Drawer } from './src/ui/drawer';
import appJson from './app.json';
import { ensurePairSchema, linkPair } from './src/pair';
import { ensureAugmentSchema, noteAugment, appendAugmentDesc } from './src/augmentlog';
import { sendSms } from './src/sms';
import { runAutoTags } from './src/autotag';
import { AddressInput } from './src/ui/addressinput';
import { ReviewScreen } from './src/ui/reviewscreen';
import { PhotoLightbox, RecordScreen, scheduleSentence,
         type RecordLifecycle } from './src/ui/recordscreen';
import { FixtureDraft } from './src/ui/__fixturedraft';
import { FixtureNegotiation } from './src/ui/__fixturenegotiation';
import { FixtureLocked } from './src/ui/__fixturelocked';
// SPEC-extra-lifecycle-v1 — the detail subscreens the three stage screens open.
// They are OVERLAYS in the cascade (an early return above `record`), the same way
// every other screen in this app navigates; a router introduced in one corner would
// be a second navigation model nobody else obeys.
import { BillingSheet, ClientSheet, CostSheet, DescriptionSheet, ExclusionsSheet, ScheduleSheet } from './src/ui/extrasheets';
import { ConfirmSheet } from './src/ui/kit';
import { FullHistory, PhotosAndProof,
         type RewriteState } from './src/ui/extradetails';
import type { ExtraDetailField } from './src/ui/extranegotiation';
// REQ-LC10..13 — the CONTENT half of the send gate. Orthogonal to canSendExtra
// (the pipeline half): both must pass and they fail for different reasons.
import { sendReadiness, UNTITLED_SCOPE } from './src/sendreadiness';
import { mergeTimeline, openCount, type MergedEvent } from './src/eventtimeline';
import { SettingsScreen } from './src/ui/settingsscreen';
import { ensureOwnCompany, myCompany } from './src/company';
import { configureBilling } from './src/billing';
import { LABELS, labelHex } from './src/labels';
import { companyFeed, type FeedItem } from './src/feed';
import { registerPushToken } from './src/push';
import { extraRecord, type ExtraRecord } from './src/record';
import { DiscussionLog, ThreadScreen } from './src/ui/threadscreen';
import { parseThreadLink, threadState, type ThreadMessage } from './src/discussion';
import { drainR5bOutbox, ensureDiscussionSchema, postReply, pullThreads,
         threadFor, threadsForProject, undeliveredReplyIds } from './src/discussionstore';
import { revisionOf } from './src/revision';
// R3 step one. The screen composes the authorization; the store is local-first; the
// sender is separate because putting a signable link in a client's hands is a
// different act from storing a record (same split as confirmations.ts).
import { EwaScreen, UnpricedEwaBanner } from './src/ui/ewascreen';
import { drainEwaOutbox, ensureEwaSchema, ewaIds, listEwa, linkPriceToEwa,
         markEwaApproved, markReminded, type EwaRow } from './src/ewastore';
import { sendEwa } from './src/ewasend';
// R2 on device. No key, no signal needed — the contractor in a crawlspace gets a
// filled preview before he stands up. The worker still re-transcribes via the
// cloud and supersedes this under 150's newest-wins.
import { drainSttOutbox, ensureSttSchema, startLive, transcribeOnDevice } from './src/ondevicestt';
import { fetchLatestProposalForCaptures, type Proposal } from './src/proposals';
import { discardCapture, discardExtra, drainServerDiscards, drainDiscardedExtras, ensureDiscardSchema, ensureDiscardSyncSchema, previewDiscard } from './src/discardstore';
import { startExtraFromCapture, titleExtraIfUntitled, retitleDraft, setDraftSummary,
         saveScopeOfWork, SCOPE_OF_WORK_MAX_CHARS,
         SCOPE_MAX_CHARS } from './src/startextra';
import { cleanupTestData } from './src/testdatacleanup';
import { logDiag } from './src/diaglog';
// The send gate. hadar: "only then it can be sent to the owner for approval —
// until then we keep the raw data on the device and waiting for processing."
// Nothing enforced that; openSendPrep had no check of any kind.
import { canSendExtra, extraProcState } from './src/extraprocstate';
import { captureStatesForExtra } from './src/extrareadiness';
import { discardSummary } from './src/discard';
import { ensureVoiceCacheSchema, voiceReadingForDecision, narrationForExtra,
         captureIdsForDecision, type VoiceReading } from './src/voicesource';
import type { PriceMode, VoicePriceReading } from './src/voiceprice';
import { VoicePriceCard } from './src/ui/voicepricecard';
// R1: the Send-to prefill. GPS decides what to SUGGEST and never what to file --
// prepareSendTo returns candidates and an opinion, the human commits it.
import { SendToCard } from './src/ui/sendtocard';
import { prepareSendTo, quickAddDestination } from './src/sendtoprep';
import type { SendToPrefill, SendToProject } from './src/sendto';
// R8 in-app activity centre. The push half needs a provider; this half needs
// nothing but the rows already on the device, and without it there is no path at
// all from "a client asked something" to the contractor noticing.
import { ensureActivitySchema, activityFor, markRead,
         ensureRemindSchema, noteLinkSent, liveLinkFor, noteReminded } from './src/activitystore';
// R8 / R5b push. Local notifications: the green light and a client question
// reach the contractor with the phone in his pocket, with no provider behind it.
import { ensureNotifySchema, notifyPermissionStatus, requestNotifyPermission,
         runNotifications } from './src/notifystore';
// R8: Remind is not Resend. Resend mints a NEW token and retires the one already in
// the client's messages; a reminder must go via the SAME link (R8) or the nudge
// breaks the thing it is nudging about.
import { canRemind, reminderText } from './src/remind';
import { ensureDraftSchema, sweepDrafts, recoverableDrafts, readDraftArtifacts,
         closeDraft } from './src/capturedraft';
// REQ-PROC4's acceptance test. Behind a flag because it writes 100 captures; see
// the block in init for why it is wired here and not behind a button.
import { runCycles } from './src/harness';
// The wired loop, exercised against the real local database. Same flag discipline.
import { runLoopCheck } from './src/loopcheck';
import type { DraftSummary } from './src/capturesession';
import { DraftRecoveryCard } from './src/ui/draftrecovery';
// R6 AC2: the FROZEN instrument, on the contractor's side. The record screen was
// rendering change_order.scope — the MUTABLE local row — while the client held
// shown_content. In a dispute they would each be reading a different document and
// neither would know it.
import { ensureEventLogSchema, readEventLog, withEventLog, type ApprovalPanel } from './src/eventlog';
import { unreadCount, unreadIds, type ActivityRow } from './src/activity';
import { buildApprovalDoc, shareApprovalDoc } from './src/approvalrecordshare';
import { ApprovalDocSheet } from './src/ui/approvaldocsheet';
import { useFonts } from 'expo-font';
import { Barlow_400Regular, Barlow_500Medium, Barlow_600SemiBold, Barlow_700Bold } from '@expo-google-fonts/barlow';
import { BarlowCondensed_600SemiBold, BarlowCondensed_700Bold } from '@expo-google-fonts/barlow-condensed';
// Design system fonts (Website/src/styles/global.css): Oswald = display (condensed,
// heavy — the "MONEY WAITING" caps), Inter = body. Home screen matches these.
import { Oswald_500Medium, Oswald_600SemiBold, Oswald_700Bold } from '@expo-google-fonts/oswald';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { describeStamp, ensureLocationPermission, stampNow, type Stamp } from './src/stamp';
import { addressFor } from './src/geocode';
import { resolveJurisdiction } from './src/jurisdiction';
import { initFeedback, signalArmed, signalFailed, signalSaved, signalReady } from './src/feedback';
import { getLang, setLang, t as T, type Lang, type Msg } from './src/i18n';
import { addParty, assignBoundary, drainScopeOutbox, ensurePartySchema, listBoundaries,
         listParties, nameBoundary } from './src/parties';
import { captureStatus, levelColor, screenStatus } from './src/status';
import { FIRST_RUN_TAPS, isFirstRun, markFirstRunDone, nextStep, savedLang, saveLang } from './src/firstrun';
import { getProfile, hasProfile as hasProfileFn, saveProfile, TRADES } from './src/profile';
import { addNote, drainNoteOutbox, ensureAnnotationSchema, noteCounts, notesFor,
         playCapture, stopPlayback, type Note } from './src/annotate';
import { addTag, drainTagOutbox, ensureTagSchema, projectTags, retractTag,
         tagMap, tagsFor } from './src/tags';
import { listRejected, createProject, ensureProjectSchema, ensureResolutionSchema, fileCapture, inboxCount,
         INBOX_ID, listProjects, resolveProject, touchProject, distanceM, effectiveProject,
         setProjectLabel, setProjectStatus, type Project } from './src/projects';
import { canRecordAudio, defaultConsentFor, ensureConsentSchema,
         getCellularConsent, getTermsAccepted, setCellularConsent,
         setTermsAccepted } from './src/consent';
import { buildDisputeBundle, buildProgressUpdate, shareBundle, shareLink,
         shareProgressUpdate } from './src/bundle';
import { captureDelivery, drainOutbox, outboxStatus, reconcileDuplicateParks, redriveNow,
         redriveParkedCaptures, type CaptureDelivery } from './src/uploader';
import * as Network from 'expo-network';
import { decisionHistory, decisionSyncStatus, drainDecisionOutbox, ensureDecisionSchema,
         listDecisions, linkCaptureToDecision, recordDecision, type DecisionRow } from './src/decisions';
import { renderCard, sendForConfirmation } from './src/confirmations';
import { publishApprovalPhotos } from './src/approvalphotopublish';
import {
  ensureApproverSchema, drainR5cOutbox, suggestFor, listRoster, listKnownPeople, addApprover,
  markApproverUsed, setExtraType, reasonText, typeLabel, roleLabel, saveClientApprover,
  retireApprover,
  type RosterMember,
} from './src/approvers';
// R6b item 3. Actor facts are written at the moment they happen; nothing on the
// record screen may infer an actor at render time (see record.ts's header).
import { drainExtraActorOutbox, ensureExtraActorSchema, noteActorNow, noteApprover,
         noteCapturedBy } from './src/recordactors';
import {
  EXTRA_TYPES, APPROVER_ROLES, isExtraType,
  type ClientType, type ExtraType, type ApproverRole, type Suggestion,
} from './src/approverrouting';
import { applyLocalApproval, centsFromInput, createChangeOrder, createLinkedExtra, drainChangeOrderOutbox,
         ensureChangeOrderSchema, hydrateChangeOrders, ledger, lineTotal, linesSum, makeLine, redriveParked,
         createdLabel, markLocalSent, money, moneyWhole, parseMoney, validateLines, CO_PHOTO_SUBQUERY,
         type LineItem, type LedgerRow, priceDraftExtra, setDraftFlowFields, rehomeDraftExtra,
         backfillCoNumbers,
         shortDate,
         type BillingTiming, type ScheduleEffect,
} from './src/changeorder';
import { displayStatus, type LedgerStatus } from './src/extrastatus';
// SPEC-extra-lifecycle-v1 §1 — the ONE authority on what may be done to a row at
// its stage. The record screen's prop gating used to be a pile of local status
// comparisons; each one is now this predicate, so the rule has a single owner.
import { canDelete, stageOf } from './src/extralifecycle';
import { ensureLedgerStatusSchema, hydrateQuestions, openQuestions, supersededBy, versionNumber,
         supersedeExtra, drainSupersessions, reassertSupersessions } from './src/ledgerstatus';
import { issueOtp, newOtpCode, renderApproval, signApproval, verifyOtp } from './src/signing';

export const db = new PowerSyncDatabase({
  schema: AppSchema,
  // op-sqlite passed EXPLICITLY. The bare { dbFilename } form does not
  // auto-detect it and falls back to quick-sqlite, which throws at runtime.
  database: new OPSqliteOpenFactory({ dbFilename: 'ezjobsite.db' }),
});

// Build marker (2026-08-06). Proves WHICH JS the phone is running: Metro served a stale
// graph twice in one day, and "it didn't update" was indistinguishable from "the fix is
// wrong" until this could be read back off the device. One string, no data exposed.
(globalThis as any).__EZ_BUILD__ = 'v33-codexp1';
// DEV-ONLY read handle. Stripped from any release build by the __DEV__ guard, which
// Metro constant-folds to false — so this cannot ship. It exists because three separate
// bugs today were diagnosed in seconds by asking the DEVICE what it holds, and guessed
// at for far longer whenever it was absent.
if (__DEV__) (globalThis as any).__db = db;

const connector = new SupabaseConnector();
// The job the app is currently showing. Was a hardcoded constant -- every capture
// in this app's history was filed to that string. It is now STATE, seeded from the
// last job used, so the app opens where the contractor left off.
const LAST_PROJECT_KEY = 'last_project_id';
// The signed-in user's UUID. Was the literal 'owner-local' -- a spike constant
// that survived into product code and caused a severe bug: project.owner_id is a
// UUID on the server, so every job created on the device failed its upsert with
// 22P02 (invalid uuid). 22P02 is not in the connector's fatal set, so it was not
// discarded -- it THREW, tx.complete() never ran, and THE ENTIRE POWERSYNC UPLOAD
// QUEUE STALLED PERMANENTLY. Jobs, consent and every later PowerSync write stopped
// reaching the cloud, silently, with the app still saying "saved ✓".
const OWNER_FALLBACK = 'owner-local';

/**
 * SPEC-extra-lifecycle-v1 — what `openRecord`'s stage layer holds.
 *
 * `view` is the screen's contract (recordscreen.tsx). `co` is the RAW row, kept
 * beside it because the record's actions — revise, remind, follow-on — need columns
 * no `ExtraRecord` carries. Declared at module scope, not inline in the `useState`,
 * so `lifecycleFor` can name its own return type instead of reaching forward to a
 * `const` declared several hundred lines below it.
 */
type RecordLcState = {
  /** The roster row behind this extra's client. Null until somebody is named. */
  clientRow: RosterMember | null;
  /** Everyone already known on this job — what the client drawer offers first, so
   *  naming a client is a tap and not a keyboard. */
  roster: RosterMember[];
  /** Everyone named on any OTHER job (`listKnownPeople`), deduped. The picker's
   *  second section, so a person the app already knows never needs the phone's
   *  contact picker a second time. */
  known: RosterMember[];
  /** WHICH VERSION this row is — derived from the supersession lineage, never stored
   *  (see `versionNumber`). 1 = the original. */
  version: number;
  view: RecordLifecycle;
  co: {
    id: string; decision_id: string; project_id: string; scope: string;
    /** 391 — the detailed client-facing scope; `scope` is the title. */
    scope_of_work: string | null;
    who_directed: string; amount_cents: number | null; nte_cents: number | null;
    billing_timing: string | null; schedule_effect: string | null;
    schedule_days: number | null; exclusions: string | null;
    /** Carried ONLY so the price editor can write them back unchanged.
     *  `priceDraftExtra` sets `line_items = ?` on every save, so an editor that did
     *  not read them would silently destroy the breakdown the contractor typed. */
    lineItems: LineItem[];
  };
  /** R8's rate-limit inputs, so the verdict can be recomputed at render against a
   *  question count that changes under the open record. */
  remindCount: number;
  remindLastMs: number | null;
};

/** A stable per-CALENDAR-DAY key in LOCAL time — the thing the feed groups on.
 *  Not the raw ms and not UTC: two extras a minute apart across midnight are
 *  different days, and two at 1am and 11pm the same day must group together. */
function feedDayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** The human header for a day group: Today / Yesterday, else a written date. The
 *  year is shown only when it is not the current one, so most headers stay short. */
function feedDayLabel(ms: number, nowMs: number): string {
  const key = feedDayKey(ms);
  if (key === feedDayKey(nowMs)) return T('feed.today');
  if (key === feedDayKey(nowMs - 86400000)) return T('feed.yesterday');
  const d = new Date(ms);
  const locale = getLang() === 'es' ? 'es-419' : 'en-US';
  const sameYear = d.getFullYear() === new Date(nowMs).getFullYear();
  return d.toLocaleDateString(locale, sameYear
    ? { weekday: 'short', month: 'short', day: 'numeric' }
    : { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * REQ-VAL6: scope, subject and who-directed are INFERRED WITH DEFAULTS, never a
 * form. The user gets ONE card and ONE action. These heuristics are deliberately
 * dumb -- the AI structuring layer replaces them at the P1.5 gate. What matters
 * now is that the SHAPE is right: defaulted + tap-to-change, never a questionnaire.
 */
function inferDecision(text: string): { subject: string; value: string; scope: 'project'|'party' } {
  const t = text.trim();
  // "<subject> is/= <value>" -> subject/value; else the whole thing is the value.
  const m = t.match(/^(?:the\s+)?([\w\s]{2,24}?)\s+(?:is|=|to be|should be|will be)\s+(.+)$/i);
  const subject = m ? m[1].trim() : t.split(/[\s,.]+/).slice(0, 3).join(' ');
  const value = m ? m[2].trim() : t;
  // party-scope if it names a trade/party; else project-scope.
  const scope = /\b(electrician|plumber|mechanical|framer|sub|gc|crew)\b/i.test(t) ? 'party' : 'project';
  return { subject, value, scope };
}

/** Date-header label for the photo grid: "Today" / "Yesterday" / "Mon, Jul 14". */
function dayLabel(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/**
 * The three states a capture can be in, from the user's point of view.
 * "Saved" is the ONLY one that makes a promise, and it is only ever shown
 * after the local commit returns.
 */
type UiState =
  | { k: 'idle' }
  | { k: 'arming' }
  | { k: 'recording' }
  | { k: 'saving' }
  | { k: 'saved'; id: string }
  | { k: 'refused'; why: Msg | string };

/**
 * Notification DISPLAY config (2026-07-26). Two things the app needs to actually SHOW
 * a notification, both missing before: a foreground handler (so a notification appears
 * even with the app open — otherwise iOS suppresses it), and an Android channel
 * (Android 8+ silently drops notifications posted to no channel). Best-effort: on a
 * platform without notifications this no-ops and the app is unaffected.
 */
async function configureNotifications(): Promise<void> {
  try {
    const N = await import('expo-notifications');
    N.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true,
      }),
    });
    if (Platform.OS === 'android') {
      await N.setNotificationChannelAsync('default', {
        name: 'Updates', importance: N.AndroidImportance.DEFAULT,
      });
    }
  } catch { /* notifications unavailable — the app works without them */ }
}

export default function App() {
  // The design language (prototype): condensed display for things you RECOGNISE,
  // humanist body for things you READ. Gated below so text never flashes unstyled.
  const [fontsLoaded] = useFonts({
    Barlow_400Regular, Barlow_500Medium, Barlow_600SemiBold, Barlow_700Bold,
    BarlowCondensed_600SemiBold, BarlowCondensed_700Bold,
    Oswald_500Medium, Oswald_600SemiBold, Oswald_700Bold,
    Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold,
  });
  const [ui, setUi] = React.useState<UiState>({ k: 'idle' });
  const [showCapture, setShowCapture] = React.useState(false);   // REQ-CAP-FUSED screen
  const [showSettings, setShowSettings] = React.useState(false); // Settings/Team screen
  const [quota, setQuota] = React.useState<{ kind: QuotaKind; limit: number } | null>(null); // free-tier cap hit
  // What the user has used, for the nudge + drawer. REPORTING ONLY — quota.ts still
  // owns every yes/no, so this can never disagree with what actually blocks.
  const [usage, setUsage] = React.useState<UsageSummary | null>(null);
  const [showPaywall, setShowPaywall] = React.useState(false);
  const [paywallPlan, setPaywallPlan] = React.useState<PlanId>('free');
  const [showFeed, setShowFeed] = React.useState(false);         // REQ-PM9 Company feed
  const [feedItems, setFeedItems] = React.useState<FeedItem[]>([]);
  const feedOpenRef = React.useRef(false);      // feed is showing → refresh() reloads it
  const returnToFeedRef = React.useRef(false);  // an extra was opened FROM the feed
  const [settingsProfile, setSettingsProfile] = React.useState<import('./src/profile').Profile | null>(null);
  // Which face of SettingsScreen to show: personal Profile vs owner-only company Settings.
  const [settingsMode, setSettingsMode] = React.useState<'profile' | 'company'>('profile');
  // Drawer needs the company's plan + whether THIS user is the owner: the plan box shows
  // to everyone, but the Upgrade CTA and the company-Settings entry are owner-only.
  const [planId, setPlanId] = React.useState<PlanId>('free');
  const [isOwner, setIsOwner] = React.useState(false);
  // When set, the capture screen AUGMENTS this existing extra (adds photos/voice as
  // appended evidence) instead of minting a new extra (hadar, 2026-07-25).
  const [augmentCoId, setAugmentCoId] = React.useState<string | null>(null);
  // REQ-PROC8: the capture whose AI proposal is being reviewed, or null.
  const [review, setReview] = React.useState<string | null>(null);
  // Walkthrough saved to the Inbox and awaiting a job: a change order MUST belong to a
  // job, so this sheet asks — nearby jobs, search, or create one here. Captures are
  // already durable before it opens; dismissing leaves them safe in the Inbox.
  const [assign, setAssign] = React.useState<null | {
    ids: string[]; lat: number | null; lng: number | null;
    uris: string[]; secs: number;
    /** The change order behind this walk — filing continues the flow into it. */
    anchorCoId?: string;
    /** The voice capture (null for photos-only) — the transition after filing polls
     *  it for the transcript. */
    anchorCaptureId?: string | null;
  }>(null);
  const [assignQ, setAssignQ] = React.useState('');
  // R1: the Send-to prefill for the walk being filed. Null until prepareSendTo has
  // read the fix; the card renders nothing rather than guessing meanwhile.
  const [sendTo, setSendTo] = React.useState<SendToPrefill | null>(null);
  const [sendToId, setSendToId] = React.useState<string | null>(null);
  // R8: the bell. `activity` is the list; `bell` is whether the sheet is open.
  const [activity, setActivity] = React.useState<ActivityRow[]>([]);
  const [bell, setBell] = React.useState(false);
  // The rough, live transcript shown WHILE recording. Never stored: the real
  // transcript comes from the file after the recording stops. This exists so the
  // contractor can see that something is happening.
  const [live, setLive] = React.useState<string>('');
  // The discard confirmation. Holds the PLAN it was opened with, so the sentence
  // on screen and the act are computed from one set of numbers.
  const [discard, setDiscard] = React.useState<
    { co: LedgerRow; plan: Awaited<ReturnType<typeof previewDiscard>>;
      /** Set when the sheet was opened from a capture rather than a ledger row.
       *  discardCapture takes the whole pair group — recording and photos. */
      captureId?: string } | null>(null);
  const liveRef = React.useRef<{ stop: () => void } | null>(null);
  // null until the bell has been opened once; 'granted' hides the ask.
  const [notifyPerm, setNotifyPerm] = React.useState<string | null>(null);
  // R1: partial sessions found on disk at launch. Every one is offered — see
  // capturesession.ts on why recovery is not "the most recent draft".
  const [drafts, setDrafts] = React.useState<DraftSummary[]>([]);
  const [draftBusy, setDraftBusy] = React.useState<string | null>(null);
  // R6: sent/opened/asked/answered timestamps + the frozen snapshot for the open
  // record. Held beside it, not inside it — the network only ever ADDS here, and a
  // fetch that fails must leave the record exactly as usable as it was.
  const [approval, setApproval] = React.useState<ApprovalPanel | null>(null);
  // The wedge home (prototype c1): extras awaiting a signature, and the money already
  // recovered. Both read from real change_order rows — never invented.
  const [homeTab, setHomeTab] = React.useState<'extras' | 'jobs'>('extras');
  // The ☰ menu on Home: the jobs list + language now live behind it, because the
  // dashboard's front page is the money, not navigation (hadar, 2026-07-23 mockup).
  const [menuOpen, setMenuOpen] = React.useState(false);
  // The Job screen's pill filter (hadar, 2026-07-23 mockup): null = all extras.
  const [jobFilter, setJobFilter] = React.useState<null | 'needs' | 'waiting' | 'approved'>(null);
  const [labelFilter, setLabelFilter] = React.useState<string | null>(null); // REQ-PM14 Jobs-list filter
  const [jobsArchived, setJobsArchived] = React.useState(false);             // REQ-PM4 Jobs-list archived view
  const [archivedCards, setArchivedCards] = React.useState<ProjectCard[]>([]);
  const [waiting, setWaiting] = React.useState<Array<{
    id: string; scope: string; amount_cents: number; status: string;
    project_id: string; pname: string; signed_by: string | null; created_at_ms: number }>>([]);
  const [recovered, setRecovered] = React.useState<{ cents: number; n: number }>({ cents: 0, n: 0 });
  // The win: celebrate a fresh "yes" while the app is foreground (communication gap
  // #1). `celebratedRef` is a watermark of extras already celebrated — null until the
  // first refresh seeds it with history, so opening the app never replays old wins.
  const [celebrate, setCelebrate] = React.useState<{ n: number; cents: number } | null>(null);
  const celebratedRef = React.useRef<Set<string> | null>(null);
  React.useEffect(() => {
    if (!celebrate) return;
    const tm = setTimeout(() => setCelebrate(null), 3800);  // auto-dismiss the win
    return () => clearTimeout(tm);
  }, [celebrate]);
  // The Home dashboard's extras, ACROSS every job (hadar, 2026-07-23 mockup): the
  // sent extras waiting on a client, each with who directed it, its job, and whether
  // the client has asked a question. `questions` is the same open-question count the
  // ledger's "discussing" chip reads — a sent extra with one is the ball in YOUR court.
  const [homeExtras, setHomeExtras] = React.useState<Array<{
    id: string; scope: string; amount_cents: number | null; status: string;
    project_id: string; pname: string; who_directed: string; created_at_ms: number;
    signed_by: string | null; questions: number; photo_relpath: string | null }>>([]);
  // The funnel ABOVE change orders — a walkthrough IS an extra in the making, and the
  // Extras tab must show the whole pipeline, not only the signed paperwork at the end.
  const [captured, setCaptured] = React.useState<Array<{
    pair_id: string; start_ms: number; photos: number; voice_id: string | null }>>([]);
  const [unsent, setUnsent] = React.useState<Array<{
    id: string; subject: string; project_id: string; created_at_ms: number; pname: string }>>([]);
  const [ready, setReady] = React.useState(false);
  const [gate, setGate] = React.useState<string | null>(null);
  const [initError, setInitError] = React.useState<string | null>(null);
  // AUTH. `session` undefined = still checking the stored token; null = logged out;
  // a Session = logged in. A valid stored token lands straight on the main screen.
  const [session, setSession] = React.useState<Session | null | undefined>(undefined);
  // The 4-slide intro is shown once to a logged-out newcomer, then never again.
  const [seenOnboarding, setSeen] = React.useState(false);

  // OTA (SPEC-ota-updates-v1). The check runs in the background and never gates
  // launch; `canRestart` is already gated on every outbox being empty, so the drawer
  // row simply mirrors it rather than re-deciding.
  const ota = useOta(ready ? db : null);

  // THE EMAILED SIGN-IN LINK LANDS HERE (hadar, 2026-08-03). Tapping the link in
  // Mail opens `ezjobsite://auth-callback#access_token=…`; without this listener the
  // app would foreground and do nothing, which reads as the link being broken.
  // Handles both the cold start (getInitialURL — app was not running) and the warm
  // case (addEventListener). Errors are swallowed deliberately: a stray deep link
  // that carries no credentials is not a failure the user caused.
  React.useEffect(() => {
    const take = (url: string | null) => {
      if (!url) return;
      connector.sessionFromUrl(url).catch(() => { /* not a sign-in link */ });
    };
    void Linking.getInitialURL().then(take);
    const sub = Linking.addEventListener('url', ({ url }) => take(url));
    return () => sub.remove();
  }, []);
  const [delivery, setDelivery] = React.useState<{pending:number;parked:number}>({pending:0,parked:0});
  const [decisions, setDecisions] = React.useState<DecisionRow[]>([]);
  // The ONE confirm surface (REQ-VAL6). Null = not confirming anything.
  const [card, setCard] = React.useState<null | {
    captureId: string; subject: string; value: string; directedBy: string; scope: 'project'|'party';
  }>(null);
  const [history, setHistory] = React.useState<any[] | null>(null);
  const [sentLink, setSentLink] = React.useState<{
    url: string; shown: string;
    // For the "Sent for approval" screen (hadar, 2026-07-24 mockup).
    scope?: string; amount?: string; jobName?: string;
    // `shared` = the contractor actually handed the link off (shareLink completed).
    // Until then this is a request that EXISTS but has not reached the client, and
    // the screen must not claim "Sent / Waiting for a yes" (Codex P1, mandate #1).
    sentTo?: string | null; atMs?: number; shared?: boolean;
    // The recipient's phone, when known — enables one-tap automatic SMS (Twilio via
    // the send-sms Edge Function). Null falls back to the manual OS share.
    phone?: string | null } | null>(null);
  // First send is the natural moment to ask for notifications ("we'll tell you when
  // they respond") — onboarding never asked (audit gap 1c). iOS shows the OS dialog
  // once ever; after that this no-ops. If granted, mint the push token immediately.
  const askedNotifyRef = React.useRef(false);
  React.useEffect(() => {
    if (!sentLink || askedNotifyRef.current) return;
    askedNotifyRef.current = true;
    void (async () => {
      try {
        const N = await import('expo-notifications');
        if ((await N.getPermissionsAsync()).status === 'undetermined') {
          await N.requestPermissionsAsync();
          await registerPushToken(connector.client, OWNER);
        }
      } catch { /* best-effort — mandate #7, push is opportunistic */ }
    })();
  }, [sentLink]);
  // After a send/finish that BEGAN on an extra's detail page, return to that page
  // (hadar, 2026-07-24: "after the send button ... take me back to the extra detail
  // page even if it is a draft"). The change-order id to re-open, or null.
  const [returnRecordId, setReturnRecordId] = React.useState<string | null>(null);

// Open the preview instead of sending. R5c + mandate #2: the recipient is a
// SUGGESTION until a human has looked at it.
// R5b. Every message on this extra AND on every version it replaced, plus the price
// it replaced — a question only makes sense against the number they were shown.
const openThread = async (c: LedgerRow, focusReply = false) => {
  const messages = await threadFor(db, c.id);
  const rev = await revisionOf(db, c.id);
  threadIdRef.current = c.id;
  setThread({
    co: c, messages,
    revision: rev ? { priorAmount: money(rev.priorAmountCents), newAmount: c.amount } : null,
    undelivered: await undeliveredReplyIds(db), focusReply,
  });
};

// The one destination R8 names: an item's record (R6b). The bell row and the
// push tap MUST land in the same place -- the AC says "the same destination as
// the push deep-link", and two code paths drifting is how that stops being true.
const openRecord = async (changeOrderId: string) => {
  // NOTHING SILENT (hadar, 2026-07-22): a tap that opens nothing looks identical to
  // "still on the job screen", which is exactly what he reported. extraRecord can
  // BOTH return null (row gone) AND throw (a local-schema mismatch after the
  // R-series migrations). Surface either, loudly, with the real reason — a silent
  // no-op is the same unforgivable sin as a silent save failure.
  let r: ExtraRecord | null;
  try {
    r = await extraRecord(db, changeOrderId);
  } catch (e: any) {
    setFiled('Could not open this extra: ' + (e?.message ?? String(e)));
    return;
  }
  if (!r) {
    setFiled('That extra is no longer here — it may have been deleted.');
    await refresh();
    return;
  }
  recordIdRef.current = changeOrderId; setRecord(r);
  // A record can replace another on screen ("See the current version", a push tap
  // while one is open). The layers below load asynchronously — drop the PRIOR
  // record's now, or its evidence renders under the new title until each read
  // lands (Codex review, 2026-07-22).
  setApproval(null); setRecordLc(null); setRecordTimeline([]);
  setRecordThread(null); setRecordUndelivered(new Set()); setRecordDelivery(null);
  setRecordNextId(null); setDetail(null); setZoomUri(null);
  // SPEC-extra-lifecycle-v1 — the stage layer, and it goes FIRST for a reason: it is
  // the only layer the screen cannot render without (it decides which of D1's three
  // screens this is and whether a priced document may be sent), and it is entirely
  // local. Every layer below it can cross the network, and behind them this one
  // would leave the record on blank paper for as long as a dead connection takes to
  // time out (mandate #7). Its own try/catch like every layer here: a failure
  // degrades, it never blanks the app.
  try {
    const lc = await lifecycleFor(r);
    if (recordIdRef.current === changeOrderId) {
      setRecordLc(lc.state); setRecordTimeline(lc.timeline);
    }
  } catch { setRecordLc(null); setRecordTimeline([]); }
  try {
    const w = await withEventLog(db, connector.client, r);
    setRecord(w); setApproval(w.approval);
  } catch { setApproval(null); }
  // R2: fetch the voice narration for this extra. The ALIGNMENT it returns is no
  // longer rendered — the three stage screens present evidence their own way — but
  // the call is still load-bearing for its side effect: it warms
  // voice_transcript_cache from the server. extraRecord read that cache while it was
  // still COLD (first open), so its voices carry no transcript yet; the re-read
  // below is what puts the full transcription on the draft screen instead of "still
  // writing it down…". Guarded on recordIdRef so a fast re-tap to another extra does
  // not get this one's data stamped over it.
  try {
    await narrationForExtra(db, connector.client, r.id,
      r.photos.map((ph) => ({ captureId: ph.captureId, uri: ph.uri, present: ph.present })));
    try {
      const r2 = await extraRecord(db, changeOrderId);
      if (r2 && recordIdRef.current === changeOrderId) setRecord(r2);
    } catch { /* the first read stands */ }
  } catch { /* no transcript on this device — the record renders without it */ }
  // R5b: the discussion (lineage-walked) and which replies are still queued.
  try {
    setRecordThread(await threadFor(db, changeOrderId));
    setRecordUndelivered(await undeliveredReplyIds(db));
  } catch { setRecordThread(null); setRecordUndelivered(new Set()); }
  // The forward link on a retired version, so the record can hand the reader on.
  try {
    setRecordNextId(r.status === 'superseded' ? await supersededBy(db, changeOrderId) : null);
  } catch { setRecordNextId(null); }
  // WHY THERE IS NO WRITE-UP, if there is none. Local-only and last: it explains a
  // state the layers above have already rendered, and it must never delay them.
  try {
    const ids = [...r.voices.map((v) => v.captureId), ...r.photos.map((ph) => ph.captureId)];
    const d = await captureDelivery(db, ids);
    if (recordIdRef.current === changeOrderId) setRecordDelivery(d);
  } catch { /* no diagnosis is better than a wrong one — StuckBlock renders nothing */ }
};

// DEV auto-open (EXPO_PUBLIC_OPENCO): opens a specific extra once on boot so the real
// record screen can be screenshotted without tap access. Inert without the env flag;
// removed with the fixtures.
const autoOpenedRef = React.useRef(false);
React.useEffect(() => {
  const id = process.env.EXPO_PUBLIC_OPENCO;
  if (id && ready && session && !autoOpenedRef.current) {
    autoOpenedRef.current = true;
    setTimeout(() => { void openRecord(id); }, 400);
  }
}, [ready, session]);

/**
 * SPEC-extra-lifecycle-v1 — assemble everything the three stage screens need.
 *
 * Reads the change_order row DIRECTLY rather than reusing the loaded ledger:
 * `coRows` only ever holds the currently open project, and a record reached from a
 * push or the company feed is routinely another job's — which is why that path used
 * to render read-only. One local read, no network (mandate #7).
 */
const lifecycleFor = async (r: ExtraRecord): Promise<{
  state: RecordLcState; timeline: MergedEvent[];
}> => {
  const raw = (await db.getAll<{
    id: string; decision_id: string; project_id: string; scope: string;
    scope_of_work: string | null;
    who_directed: string; amount_cents: number | null; nte_cents: number | null;
    billing_timing: string | null; schedule_effect: string | null;
    schedule_days: number | null; exclusions: string | null; line_items: string | null;
  }>(
    `SELECT id, decision_id, project_id, scope, scope_of_work, who_directed, amount_cents, nte_cents,
            billing_timing, schedule_effect, schedule_days, exclusions, line_items
       FROM change_order WHERE id = ?`, [r.id]))[0];
  if (!raw) throw new Error(`no change_order ${r.id}`);
  let lineItems: LineItem[] = [];
  // A corrupt breakdown must not take the record down with it, and it must not be
  // silently rewritten to [] either — an unparseable value stays on the row because
  // nothing here saves unless the contractor edits the price.
  try { const p = JSON.parse(raw.line_items ?? '[]'); if (Array.isArray(p)) lineItems = p; }
  catch { lineItems = []; }
  const co = { ...raw, lineItems };

  // R3's standing rule made visible: a cap present means this was quoted T&M.
  const priceMode: PriceMode = co.nte_cents == null ? 'fixed' : 'nte';
  // REQ-LC13's pipeline half. Failing to read it must not be read as "ready" —
  // `extraProcState([])` is the honest floor, and canSendExtra refuses on it.
  let proc = extraProcState([]);
  try { proc = extraProcState(await captureStatesForExtra(db, co.decision_id)); }
  catch { /* schema race — the gate stays shut, which is the safe direction */ }
  // REQ-LC3: `viewed` is DERIVED from confirmation_open evidence, never stored.
  const { events } = await readEventLog(db, r.id);
  // R8's manual-remind verdict at load time. A missing local link is NOT folded in
  // here: `remindExtra` returns `r8.noLink` at press time, which is the refusal the
  // contractor can actually read where he is looking.
  const link = await liveLinkFor(db, r.id);
  // Derived from the lineage each load: a revision made on another phone must change
  // this number here too, and a stored counter would not.
  const version = await versionNumber(db, r.id);
  // The client, from the ROSTER (the source of truth for people). Matched on the name
  // the extra was directed by, case- and space-insensitively — the same rule
  // `saveClientApprover` uses, so the lookup and the write can never disagree.
  let clientRow: RosterMember | null = null;
  let roster: RosterMember[] = [];
  // Everyone named on any OTHER job. Read here, beside the roster, because the two
  // are one question for the picker ("who could this be?") and a second read
  // somewhere else is how the drawer ends up showing one list refreshed and one
  // stale. Its own try: a failure to load the convenience list must never cost the
  // job's own roster, which is the one the client lookup below depends on.
  let known: RosterMember[] = [];
  try {
    roster = await listRoster(db, co.project_id);
    const want = (co.who_directed ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (want) {
      clientRow = roster.find(
        (m) => m.name.trim().toLowerCase().replace(/\s+/g, ' ') === want) ?? null;
    }
  } catch { /* no roster on this device yet — the drawer opens empty, which is honest */ }
  try {
    known = await listKnownPeople(db, co.project_id);
  } catch { /* the wider list is a convenience; without it the drawer still works */ }
  return {
    timeline: mergeTimeline(r.history, events),
    state: {
      co,
      clientRow,
      roster,
      known,
      version,
      remindCount: link?.remindCount ?? 0,
      remindLastMs: link?.lastRemindMs ?? null,
      view: {
        version,
        // REQ-LC12. recordactors.ts states the derivation and it holds here for the
        // same reason: reaching a change_order row means this is an extra — R10's
        // Decision has no change order and cannot arrive on this screen.
        kind: 'extra',
        readiness: sendReadiness({
          kind: 'extra',
          scope: co.scope,
          // 391 — the gate tests the text the client signs, not the title.
          scopeOfWork: co.scope_of_work,
          amountCents: co.amount_cents,
          nteCents: co.nte_cents,
          priceMode,
          // The TRUE count, not the render cap: a photo dropped by the cap is still
          // attached, and counting only what fits on screen would report a gap that
          // does not exist.
          photoCount: r.photos.length + r.photosTruncated,
          billingTiming: co.billing_timing,
          scheduleEffect: co.schedule_effect,
          exclusions: co.exclusions,
        }),
        proc,
        priceMode,
        billingTiming: co.billing_timing,
        scheduleEffect: co.schedule_effect,
        scheduleDays: co.schedule_days,
        exclusions: co.exclusions,
        requestedBy: co.who_directed || null,
        openCount: openCount(events),
        lastOpenedAtMs: events.reduce(
          (m, e) => (e.kind === 'opened' && e.atMs > m ? e.atMs : m), 0) || null,
        // A placeholder the render replaces. The verdict depends on whether a client
        // question is open RIGHT NOW (R8 pauses reminding mid-negotiation), and that
        // count changes under the open record on every refresh tick — computing it
        // once at load would show a live Remind button over a question he owes an
        // answer to. See the record guard, where it is recomputed with `questions`.
        remind: { ok: false, reasonKey: 'r8.notSent' },
      },
    },
  };
};

/** Close the record overlay and drop every layer loaded with it. One function so
 *  a new layer cannot be cleared on one exit path and leak on the other. */
const closeRecord = () => {
  recordIdRef.current = null;
  setRecord(null); setApproval(null); setRecordLc(null); setRecordTimeline([]);
  setRecordThread(null); setRecordUndelivered(new Set()); setRecordDelivery(null);
  setRecordNextId(null); setDetail(null); setZoomUri(null);
  // If this extra was opened FROM the company feed, go back to the feed (fresh) — not
  // to whatever nav was underneath (review 2026-07-25: don't lose the user's place).
  if (returnToFeedRef.current) {
    returnToFeedRef.current = false;
    void companyFeed(db).then(setFeedItems);
    setShowFeed(true);
  }
};

// Open Settings in a given MODE (hadar, 2026-07-27): 'profile' is the personal screen
// (name, trade, language, notifications, join a company); 'company' is the owner-only
// company screen (team roster, plan). Both reuse SettingsScreen; the mode picks which
// sections render. Loads the profile and, for a company profile, promotes the stored
// company NAME into a real tenant (idempotent) so the Team roster works.
const openSettings = async (mode: 'profile' | 'company' = 'profile') => {
  const p = (await getProfile(db)) ?? { name: '', isSolo: true, company: null, trade: null };
  if (!p.isSolo && (p.company ?? '').trim()) {
    try { await ensureOwnCompany(connector.client, (p.company as string).trim(), p.name); await refresh(); }
    catch { /* offline — the promote retries next time Settings opens */ }
  }
  setSettingsProfile(p);
  setSettingsMode(mode);
  setShowSettings(true);
};

// Open the paywall, reading the company's current plan so it marks "Your plan".
const openPaywall = async () => {
  setPaywallPlan(await currentPlan(db));
  setShowPaywall(true);
};

// Translate an RPC error code to a human, localized message — never the raw Postgres
// string (review 2026-07-25: the ICP may run in Spanish and can't act on 'not allowed').
const statusErr = (code: string): string =>
  code === '42501' ? T('pm4.errPermission') : T('pm4.errGeneric');

// REQ-PM9 — open the company feed (extras across every project, reverse-chron).
const openFeed = async () => {
  feedOpenRef.current = true;
  try { setFeedItems(await companyFeed(db)); } catch { setFeedItems([]); }
  setShowFeed(true);
};
const closeFeed = () => { feedOpenRef.current = false; setShowFeed(false); };

// REQ-NOTIF1 — tapping a push opens the referenced extra (data.changeOrderId).
// COLD START too (Codex P1, 2026-07-26): remote payloads carry changeOrderId, and a
// tap that LAUNCHES the app arrives via getLastNotificationResponseAsync — without it,
// a killed-app tap on an approval/decline push opened nothing. (Local notifications
// carry data.url and are handled by the other listener; each no-ops on the other's
// shape, so running both is safe.)
React.useEffect(() => {
  let sub: { remove: () => void } | undefined;
  const openCo = (resp: any) => {
    const coId = resp?.notification?.request?.content?.data?.changeOrderId;
    if (coId) void openRecord(String(coId));
  };
  void (async () => {
    try {
      const N = await import('expo-notifications');
      const last = await N.getLastNotificationResponseAsync();
      if (last) openCo(last);                       // launched by tapping a remote push
      sub = N.addNotificationResponseReceivedListener(openCo);
    } catch { /* notifications module unavailable — no-op */ }
  })();
  return () => { try { sub?.remove(); } catch { /* already gone */ } };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

/**
 * R8 manual remind — ONE implementation for the ledger row and the record screen.
 * Same link, never a new token (remind.ts's header owns the why). Returns the
 * verdict so each caller can show a refusal where its user is actually looking.
 */
// The parameter is a STRUCTURAL SUBSET of LedgerRow, not LedgerRow itself, so the
// record screen can remind about an extra whose job is not the one currently
// loaded. `coRows` only ever holds the open project; requiring the whole row here
// was what made a record reached from a push read-only.
const remindExtra = async (
  c: { id: string; status: string; scope: string; amount: string },
  inDiscussion: boolean):
  Promise<{ ok: boolean; why?: string }> => {
  const link = await liveLinkFor(db, c.id);
  if (!link) return { ok: false, why: T('r8.noLink') };
  const verdict = canRemind(c.status,
    { count: link.remindCount, lastAtMs: link.lastRemindMs, inDiscussion }, Date.now());
  if (!verdict.ok) return { ok: false, why: T(verdict.reasonKey) };
  const prof = await getProfile(db);
  const text = reminderText({
    contractorName: prof?.company || prof?.name || 'Your contractor',
    scope: c.scope, amount: c.amount, url: link.url,
  });
  const sh = await shareLink(link.url, text);
  // Counted only AFTER the sheet returns. A contractor who opens it and backs out
  // has not reminded anyone, and burning his one-a-day on a cancelled share would
  // be the app lying about what it did.
  if (!sh.ok) return { ok: false, why: sh.reason ?? 'could not share' };
  await noteReminded(db, c.id);
  await refresh();
  return { ok: true };
};

/** R5b/R7 Revise & resend — ONE handoff to the priced read-back composer, shared
 *  by the ledger row, the thread screen and the record screen. The price still
 *  goes through the read-back: mandate #6 has no shortcut for the second number. */
// Same structural-subset parameter as remindExtra, for the same reason: a revision
// started from a record opened cross-project must not need the ledger row of a job
// that is not loaded. `amount_cents` is nullable here where LedgerRow's is not —
// 370 made "he never said a price" representable, and an unpriced row must arrive
// at the read-back with an EMPTY field, never with "0.00" typed in for him
// (mandate #6: the app never authors a number).
const startRevision = (c: {
  id: string; decision_id: string; scope: string; who_directed: string;
  amount_cents: number | null; nte_cents: number | null;
  billing_timing: string | null; schedule_effect: string | null;
  schedule_days: number | null; exclusions: string | null;
}) => {
  setPriced({
    decisionId: c.decision_id, scope: c.scope, whoDirected: c.who_directed,
    amountText: c.amount_cents == null ? '' : (c.amount_cents / 100).toFixed(2),
    nteText: c.nte_cents == null ? '' : (c.nte_cents / 100).toFixed(2),
    mode: c.nte_cents == null ? 'fixed' : 'nte', voice: null, supersedes: c.id,
    // A revision carries the prior version's flow terms forward — the price is
    // what changed; the terms stay unless the contractor edits them. Including
    // SILENCE: a version that said nothing about billing is revised into one that
    // still says nothing, rather than one that has quietly acquired a payment term
    // (flowterms.ts, REQ-LC41).
    billingTiming: (c.billing_timing as BillingTiming) ?? null,
    scheduleEffect: (c.schedule_effect as ScheduleEffect) ?? null,
    scheduleDaysText: c.schedule_days ? String(c.schedule_days) : '',
    exclusions: c.exclusions ?? '',
  });
  setLines([]);
};

/**
 * FLOW step 3 — "fill what's missing", opened ON the extra a capture created.
 * hadar, 2026-07-23: "after i finish capture i don't see the next steps." The
 * questions come to the contractor; the ledger is the fallback, not the flow.
 * Loads the draft, opens the composer against the EXISTING row
 * (priceDraftExtra), and fetches the R2 voice prefill the same way the
 * ledger's price-it path does.
 */
const finishExtraById = async (changeOrderId: string) => {
  const rows = await db.getAll<{
    decision_id: string; scope: string; who_directed: string; project_id: string;
    amount_cents: number | null; nte_cents: number | null;
    billing_timing: string | null; schedule_effect: string | null;
    schedule_days: number | null; exclusions: string | null;
  }>(
    `SELECT decision_id, scope, who_directed, project_id, amount_cents, nte_cents,
            billing_timing, schedule_effect, schedule_days, exclusions
       FROM change_order WHERE id = ? AND status = 'draft'`, [changeOrderId]);
  if (!rows.length) return;
  const c = rows[0];
  // The composer renders on the JOB screen. After a capture the user is on
  // home, so setting `priced` alone opened the card on a screen nobody was
  // looking at — hadar, twice, 2026-07-23: "no change". Navigate FIRST.
  setProjectId(c.project_id);
  setNav('project');
  setPriced({
    decisionId: c.decision_id, scope: c.scope, whoDirected: c.who_directed,
    // THE STORED PRICE, not a blank field. This read `amountText: ''` and did not
    // even select `amount_cents`, so "Edit details" on a $1,850 draft — now the
    // permanent secondary button on the draft screen, not just the post-capture
    // step — opened the composer with the price gone. Confirming then hit
    // `confirmPriced`'s `cents === null` and returned silently: nothing saved,
    // nothing said, and the exclusions he came to fix went with it. The empty
    // string stays the honest value when there is genuinely no price (370,
    // mandate #6 — the app never types a number on his behalf).
    amountText: c.amount_cents == null ? '' : (c.amount_cents / 100).toFixed(2),
    nteText: c.nte_cents == null ? '' : (c.nte_cents / 100).toFixed(2),
    mode: c.nte_cents == null ? 'fixed' : 'nte',
    voice: null,
    existingCoId: changeOrderId,
    // NULL STAYS NULL (flowterms.ts: "silence is the default"). Defaulting to
    // 'when_completed' put "Payment is due when the work is completed." into the
    // frozen instrument of every extra that came through here, whether or not the
    // contractor ever considered it — a clause nobody chose — and it also made
    // `sendReadiness`'s `no_billing_timing` recommendation unable to fire, so the
    // draft screen over-reported completeness.
    billingTiming: (c.billing_timing as BillingTiming) ?? null,
    scheduleEffect: (c.schedule_effect as ScheduleEffect) ?? null,
    scheduleDaysText: c.schedule_days ? String(c.schedule_days) : '',
    exclusions: c.exclusions ?? '',
  });
  setLines([]);
  // The recording is processed asynchronously: on-device STT lands the WORDS in
  // seconds, the cloud AI pass isolates the PRICE a beat later. Poll, and — the fix
  // for "none of the information was filled" (hadar, 2026-07-23) — keep polling until
  // the AI has spoken (`analyzed`), not merely until the transcript appears. Stopping
  // at the transcript meant prefilling from the regex and never seeing the AI's price
  // "$1,500". The read-back shows the moment the words exist; the amount fills the
  // moment the AI's figure lands. Never clobber what a human already typed (mandate #6).
  for (let attempt = 0; attempt < 20; attempt++) {
    const v = await voiceReadingForDecision(db, connector.client, c.decision_id, parseMoney);
    let stop = false;
    setPriced((p) => {
      if (!p || p.decisionId !== c.decision_id) { stop = true; return p; }  // card closed / replaced
      const amount = v.price?.prefill && v.price.amountCents !== null
        ? (v.price.amountCents / 100).toFixed(2) : '';
      const takePrice = p.amountText === '' && amount !== '';
      return {
        ...p,
        voice: v.transcript ? v : p.voice,
        mode: takePrice ? (v.price?.mode ?? p.mode) : p.mode,
        amountText: takePrice ? amount : p.amountText,
      };
    });
    if (stop) return;
    if (v.analyzed) {
      // The AI has spoken. Give the extra its real TITLE and its TAG from the
      // model's own subject + type (hadar, 2026-07-23), then reflect the new title
      // in the open form and let the ledger pick up both.
      const applied = await applyProposalToExtra(changeOrderId, c.decision_id);
      if (applied.title) {
        setPriced((p) => (p && p.decisionId === c.decision_id ? { ...p, scope: applied.title as string } : p));
      }
      await refresh();
      return;   // nothing better is coming
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
};

/**
 * Give a processed extra its TITLE and its TAG from the AI's proposal.
 *
 * The model already writes both — `proposed_subject` is a <=60-char title,
 * `proposed_extra_type` is the R5c category (structural / mep / finish / …). This
 * applies them under the mandates:
 *  - Title only when the model was CONFIDENT (mandate #2), over the machine-written
 *    interim title, draft-only. It replaces the first-sentence guess with a real name.
 *  - Tag whenever the model named a valid one. The type is not part of the frozen
 *    instrument (setExtraType's own note), so it carries no confidence gate beyond
 *    "is a real category" and stays editable after send. setExtraType validates and
 *    enqueues its own sync mutation.
 * Returns what it applied so the caller can refresh the open form.
 */
const applyProposalToExtra = async (
  changeOrderId: string, decisionId: string
): Promise<{ title: string | null; tag: string | null }> => {
  const ids = await captureIdsForDecision(db, decisionId);
  const prop: Proposal | null = await fetchLatestProposalForCaptures(connector.client, ids);
  if (!prop || prop.confidence === 'none') return { title: null, tag: null };
  let title: string | null = null;
  let tag: string | null = null;
  // TITLE, SCOPE OF WORK AND THE FLOW TERMS ARE NO LONGER WRITTEN HERE (394).
  //
  // `apply_proposal_v1` does it on the server, the moment the write-up exists, under
  // one SQL predicate — because the web app is coming and the rule that decides what a
  // binding document says must exist ONCE. This device learns the result through
  // `hydrateChangeOrders`, which re-states the same guard locally before adopting it
  // (a draft edited offline can legitimately be ahead of the server).
  //
  // What is still applied from here is what the server does not own: the extra's
  // owner-facing SUMMARY, which is a device-only column, and the AI search tags, which
  // live on the CAPTURES rather than the change order.
  if (prop.confidence === 'high' && prop.value) {
    await setDraftSummary(db, changeOrderId, prop.value);
  }

  // THE SEARCH TAGS (392), applied to the captures this decision was built from.
  //
  // On the CAPTURES and not the change order, because that is where tags live
  // (tags.ts / REQ-GAL3) and what the photo grid filters on — a tag exists so a
  // contractor can find "that subfloor job" six weeks later, and the media is what he
  // will be looking through.
  //
  // author: 'ai' so they are distinguishable from the ones he typed. tags.ts is
  // append-only: he can retract any of them and the retraction is itself recorded,
  // which is what makes it safe to apply a model's proposal without asking first —
  // nothing is destroyed and nothing is hidden. High-confidence only, the same gate
  // as the title and the scope of work.
  if (prop.confidence === 'high' && prop.tags.length) {
    for (const captureId of ids) {
      for (const tag of prop.tags) {
        // Best-effort and never fatal: a tag that fails to write is a search aid that
        // did not land, not evidence that did.
        try { await addTag(db, { captureId, tag, author: 'ai' }); } catch { /* keep going */ }
      }
    }
  }
  if (prop.extraType && isExtraType(prop.extraType) && await setExtraType(db, changeOrderId, prop.extraType)) {
    tag = prop.extraType;
  }

  return { title, tag };
};

/**
 * GENERATE, step 3 — write the model's read onto the change order and go back to it.
 *
 * The whole act is the three steps hadar stated (2026-08-06): the files go up (step 1,
 * the transition screen's drain, now with `redriveNow` so a backed-off row does not
 * make the user wait out a 30-minute schedule), the words are written down and the AI
 * produces the scope (step 2, what the screen waits for), and this is step 3.
 *
 * IT REUSES `applyProposalToExtra` RATHER THAN WRITING THE COLUMNS AGAIN. That
 * function is where mandate #2 lives for this data: high confidence only, `seedOnly`
 * on the scope of work so nothing the contractor typed is overwritten, tags appended
 * (never destructive), and the price deliberately NOT set — the model is not allowed
 * to author a number (mandate #6). A second copy of those rules here is a second
 * place for them to rot.
 *
 * IT ENDS ON THE RECORD, not the composer: the extra already exists and the
 * contractor asked for its write-up, not for a pricing form.
 */
const finishGenerateById = async (changeOrderId: string) => {
  const rows = await db.getAll<{ decision_id: string }>(
    `SELECT decision_id FROM change_order WHERE id = ? AND status = 'draft'`, [changeOrderId]);
  // Not a draft any more (sent or answered while this ran): its instrument is frozen
  // and nothing may be rewritten onto it. Reopen it and say nothing — the record
  // itself now shows the state that makes this refusal obvious.
  if (rows.length) {
    try { await applyProposalToExtra(changeOrderId, rows[0].decision_id); }
    catch (e: any) { void logDiag(db, 'generate.apply', String(e?.message ?? e).slice(0, 200)); }
  }
  await refresh();
  await openRecord(changeOrderId);
};

/**
 * Finish an EDIT to an extra: the added voice has uploaded, transcribed and been
 * analysed, so grow the record's SUMMARY to cover what it said — "the same rules
 * as the new extra" (hadar, 2026-07-27) — then reopen the record.
 *
 * IT NEVER TOUCHES SCOPE OR THE BASE SUMMARY, and that is the whole design. `co.scope`
 * is the title and, once sent, the frozen binding instrument (mandate #5); `co.summary`
 * is written draft-only. A new extra puts the AI's value INTO co.summary because it is
 * still a mutable draft; an edit can land on a SENT extra (hadar chose "sent extras
 * too"), so it appends the AI's read as an append-only addendum that record.ts renders
 * beneath the base summary. Same rule for a draft, so the two cases cannot diverge.
 *
 * IT USES THE OWNER-FACING VALUE, not the terse subject: this feeds the "Summary of
 * the change" the client reads, so the added voice contributes the same clear prose the
 * base summary is made of. MANDATE #2: the AI's words are used only at HIGH confidence;
 * otherwise the addendum is the contractor's OWN transcribed words (which the raw
 * transcript below already shows too), always available offline. The price is never
 * re-derived — an edit adds evidence, not money.
 */
const finishAugmentById = async (changeOrderId: string, addedIds: string[]) => {
  // FIRST: join the added clips to the extra's decision, so the server knows they
  // describe the same work. Without this the structure step sees each clip alone and
  // the write-up gets worse the more the contractor says (see linkCaptureToDecision).
  // Best-effort and never fatal — the evidence is already committed, and a link that
  // failed to write is retried the next time this runs.
  try {
    const co = (await db.getAll<{ decision_id: string; project_id: string; scope: string;
                                 who_directed: string | null }>(
      `SELECT decision_id, project_id, scope, who_directed FROM change_order WHERE id = ?`,
      [changeOrderId]))[0];
    if (co) {
      for (const captureId of addedIds) {
        const said = (await db.getAll<{ text: string }>(
          `SELECT text FROM voice_transcript_cache WHERE capture_id = ?`, [captureId]))[0];
        await linkCaptureToDecision(db, {
          decisionId: co.decision_id, captureId, projectId: co.project_id,
          ownerId: OWNER, subject: co.scope, directedBy: co.who_directed,
          value: said?.text ?? '',
        });
      }
    }
  } catch (e: any) { void logDiag(db, 'augment.link', String(e?.message ?? e).slice(0, 160)); }
  try {
    const prop: Proposal | null =
      await fetchLatestProposalForCaptures(connector.client, addedIds);
    let text = '';
    if (prop && prop.confidence === 'high' && (prop.value || prop.subject)) {
      text = (prop.value || prop.subject || '').trim();
    } else {
      // His own words, verbatim, for every added voice that was written down.
      const marks = addedIds.map(() => '?').join(',');
      const said = await db.getAll<{ text: string }>(
        `SELECT text FROM voice_transcript_cache WHERE capture_id IN (${marks})`, addedIds);
      text = said.map((r) => r.text?.trim()).filter(Boolean).join('\n\n');
    }
    if (text) await appendAugmentDesc(db, changeOrderId, text);
  } catch { /* the evidence is committed; a missing addendum never un-saves it */ }
  await refresh();
  void openRecord(changeOrderId);
};

/**
 * File a just-recorded walk to the job the human picked — the SAME path whether the
 * job already existed or was created on the spot. Files each capture, moves the draft
 * change order to that job, then starts the processing screen that opens the details.
 *
 * ONE function so the two entry points cannot diverge again: creating a new job used
 * to file the captures but skip the rehome + transition, so the extra "finished" as an
 * unprocessed draft with nothing uploaded and no next step (hadar, 2026-07-24).
 */
const fileWalkTo = async (a: NonNullable<typeof assign>, projId: string) => {
  for (const id of a.ids) {
    await fileCapture(db, { captureId: id, projectId: projId, by: OWNER });
  }
  setAssign(null); setAssignQ(''); setFiled(null);
  setProjectId(projId);
  const anchorCoId = a.anchorCoId;
  const anchorCapId = a.anchorCaptureId ?? null;
  if (anchorCoId) await rehomeDraftExtra(db, anchorCoId, projId);
  await refresh();
  if (anchorCoId) {
    setTransition({
      ids: a.ids, anchorCaptureId: anchorCapId, coId: anchorCoId,
      uploaded: false, transcribed: anchorCapId === null, analyzed: false, offline: false,
      stalled: false, uploadDone: 0, uploadTotal: a.ids.length, lastError: null,
      blocked: false, isAugment: false,
    });
  }
};

/**
 * Step 2 confirmed -> the extra is priced. Updates the capture-draft in place
 * (existingCoId) or mints the extra (decision/EWA/revision paths), records the
 * priced actor, settles an EWA link and applies a supersession when relevant.
 * Returns the change order id, or null after a LOUD refusal. Callers own
 * closing the screens and refreshing.
 */
const confirmPriced = async (): Promise<string | null> => {
  if (!priced) return null;
  const cents = centsFromInput(priced.amountText);
  const nte = centsFromInput(priced.nteText);
  if (cents === null || validateLines(lines, cents)) return null;
  const days = parseInt(priced.scheduleDaysText, 10);
  const { data } = await connector.client.auth.getUser();
  if (!data?.user) { setUi({ k: 'refused', why: 'not signed in' }); return null; }
  const flow = {
    billingTiming: priced.billingTiming,
    scheduleEffect: priced.scheduleEffect,
    scheduleDays: priced.scheduleEffect === 'adds_days' && days > 0 ? days : null,
    exclusions: priced.exclusions,
  };
  if (priced.existingCoId) {
    const fin = await priceDraftExtra(db, {
      changeOrderId: priced.existingCoId,
      amountCents: cents, nteCents: nte, lineItems: lines, ...flow,
      whoDirected: priced.whoDirected.trim() || 'Owner',
      numbersConfirmedAt: new Date(),
    });
    if (!fin.ok) { setUi({ k: 'refused', why: fin.reason }); return null; }
    await noteActorNow(db, { subjectKind: 'change_order',
                             subjectId: priced.existingCoId, act: 'priced' });
    return priced.existingCoId;
  }
  // A REVISION KEEPS THE NUMBER IT IS REVISING. "CO #4 v2" is the second version of
  // one change, not a fifth change — renumbering here would put a new number on a
  // document the client already has under the old one. A fresh extra allocates its
  // own (createChangeOrder does it when this is undefined).
  let inheritedNo: number | null = null;
  if (priced.supersedes) {
    try {
      inheritedNo = (await db.getAll<{ co_number: number | null }>(
        `SELECT co_number FROM change_order WHERE id = ?`, [priced.supersedes]))[0]?.co_number ?? null;
    } catch { /* pre-migration row: the new one allocates its own */ }
  }
  const r = await createChangeOrder(db, {
    id: `co-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    decisionId: priced.decisionId, projectId, ownerId: data.user.id,
    scope: priced.scope, amountCents: cents, nteCents: nte, ...flow,
    whoDirected: priced.whoDirected, lineItems: lines,
    coNumber: inheritedNo,
    // The read-back happened HERE. This timestamp is the proof, and the DB
    // refuses the row without it.
    numbersConfirmedAt: new Date(),
  });
  if (!r.ok) { setUi({ k: 'refused', why: r.reason }); return null; }
  await noteActorNow(db, { subjectKind: 'change_order', subjectId: r.id, act: 'priced' });
  if (settling) {
    const lk = await linkPriceToEwa(db, r.id, settling);
    if (!lk.ok) setUi({ k: 'refused', why: T(lk.reason as any) });
    setSettling(null);
  }
  if (priced.supersedes) {
    const sup = await supersedeExtra(db,
      { changeOrderId: priced.supersedes, supersededBy: r.id });
    if (!sup.ok) setUi({ k: 'refused', why: T('co.supersedeRefused') });
  }
  return r.id;
};

const openSendPrep = async (c: LedgerRow) => {
  const t = (c.extra_type ?? null) as ExtraType | null;
  const { suggestion, roster } = await suggestFor(db, projectId, t);
  setSendPrep({ co: c, type: t, suggestion, roster,
                chosenId: null, picking: false, adding: null, busy: false });
};

// Fill the add-someone form from the device's contacts. The native picker is
// user-mediated (no contacts permission prompt, like the photo picker) and returns
// only the one contact the user taps. iOS has NO call-history API, so this is the
// source (hadar, 2026-07-24).
const pickContact = async () => {
  try {
    const picked = await Contacts.presentContactPickerAsync();
    if (!picked) return;
    let phones = picked.phoneNumbers ?? [];
    // The picker can hand back a stub without numbers; fetch the full contact by id.
    if (!phones.length && picked.id) {
      const perm = await Contacts.requestPermissionsAsync();
      if (perm.status === 'granted') {
        const full = await Contacts.getContactByIdAsync(picked.id,
          [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers]);
        phones = full?.phoneNumbers ?? [];
      }
    }
    // ALWAYS prefer the MOBILE line — the approval goes out by SMS (hadar,
    // 2026-07-24). Fall back to the first number if none is labelled mobile.
    const mobile = phones.find((p) => /mobile|cell|iphone|móvil|celular/i.test(p.label ?? ''))
      ?? phones[0];
    const phone = (mobile?.number ?? mobile?.digits ?? '').trim();
    const name = (picked.name || [picked.firstName, picked.lastName].filter(Boolean).join(' ') || '').trim();
    setSendPrep((p) => p && p.adding
      ? { ...p, adding: { ...p.adding, name: name || p.adding.name, phone: phone || p.adding.phone } }
      : p);
    if (!phone) setFiled('That contact has no phone number — type it in.');
  } catch (e: any) {
    setUi({ k: 'refused', why: e?.message ?? String(e) });
  }
};

/**
 * The contact picker as a VALUE, for the client drawer.
 *
 * `pickContact` above fills the send-flow's add-form by side effect; this returns what
 * was tapped so a sheet can put it in its own draft. Same rules: the native picker is
 * user-mediated (no permission prompt), and the MOBILE line wins because the approval
 * link goes out by SMS.
 */
const pickContactValue = async (): Promise<{ name: string; phone: string } | null> => {
  try {
    const picked = await Contacts.presentContactPickerAsync();
    if (!picked) return null;
    let phones = picked.phoneNumbers ?? [];
    if (!phones.length && picked.id) {
      const perm = await Contacts.requestPermissionsAsync();
      if (perm.status === 'granted') {
        const full = await Contacts.getContactByIdAsync(picked.id,
          [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers]);
        phones = full?.phoneNumbers ?? [];
      }
    }
    const mobile = phones.find((p) => /mobile|cell|iphone|móvil|celular/i.test(p.label ?? ''))
      ?? phones[0];
    const phone = (mobile?.number ?? mobile?.digits ?? '').trim();
    const name = (picked.name
      || [picked.firstName, picked.lastName].filter(Boolean).join(' ') || '').trim();
    if (!phone) setFiled(T('client.noContactPhone'));
    return { name, phone };
  } catch (e: any) {
    setUi({ k: 'refused', why: e?.message ?? String(e) });
    return null;
  }
};

/**
 * Save the client. THE ROSTER IS THE SOURCE OF TRUTH (hadar, 2026-07-31): the person
 * — name, phone, and which side of the chain they stand on — is written once to
 * `project_approver` and every extra on the job reads that row. The extra keeps only
 * the name it was directed by, so an already-sent record still resolves on its own.
 */
/**
 * Take somebody off this job (hadar, 2026-08-05). `retireApprover` flips status to
 * 'removed' and enqueues the mutation; it never deletes, because an extra already
 * sent to that person still has to resolve their name.
 *
 * CONFIRMED FIRST, and the confirmation says what removal does NOT do — the fear it
 * has to answer is "will this erase them from the extra I already sent", and the
 * answer is no. A native alert is proportionate: mandate #2 governs price and
 * commitment, and the discard sheet is for destroying evidence, which this is not.
 */
const removePerson = (approverId: string, name: string) => {
  Alert.alert(
    T({ k: 'client.removeTitle', p: { name } } as any),
    T('client.removeBody'),
    [
      { text: T('common.cancel'), style: 'cancel' },
      {
        text: T('client.removeConfirm'),
        style: 'destructive',
        onPress: () => { void (async () => {
          try {
            const moved = await retireApprover(db, approverId);
            // `false` = already retired. Not an error, and not worth a message that
            // implies something failed.
            if (moved) setFiled(T({ k: 'client.removed', p: { name } } as any));
            if (recordLc?.co.id) await openRecord(recordLc.co.id);
            void refresh();
          } catch (e: any) {
            setUi({ k: 'refused', why: e?.message ?? String(e) });
          }
        })(); },
      },
    ]
  );
};

const saveClient = async (
  changeOrderId: string,
  v: { name: string; phone: string | null; clientType: ClientType },
  mode: 'client' | 'contact' = 'client'
) => {
  const pid = recordLc?.co.project_id ?? projectId;
  if (!pid) { setFiled(T('erec.errStillLoading')); return; }
  try {
    await saveClientApprover(db, {
      projectId: pid, name: v.name, phone: v.phone || null, chainSide: v.clientType,
    });
    // ONLY the primary client moves `who_directed`. An additional contact is added to
    // the job's roster and nothing else — the person who approves this extra does not
    // change because somebody added the inspector.
    if (mode === 'client') {
      // Draft-mutable only; a sent extra already names who it went to.
      await db.execute(
        `UPDATE change_order SET who_directed = ? WHERE id = ? AND status = 'draft'`,
        [v.name, changeOrderId]);
    }
    setClientOpen(null);
    await openRecord(changeOrderId);
    void refresh();
  } catch (e: any) {
    setUi({ k: 'refused', why: e?.message ?? String(e) });
  }
};

// Re-derive the suggestion whenever the type changes. The whole point of the
// type is that it moves the recipient; a picker that did not would be theatre.
const changeType = async (t: ExtraType | null) => {
  setSendPrep((p) => p && { ...p, type: t });
  if (!sendPrep) return;
  await setExtraType(db, sendPrep.co.id, t);
  const { suggestion, roster } = await suggestFor(db, projectId, t);
  // chosenId is cleared: an explicit override was made against the OLD
  // suggestion, and silently keeping it after the type changed would show a
  // reason that no longer explains the person.
  setSendPrep((p) => p && { ...p, type: t, suggestion, roster, chosenId: null });
};

const sendPricedApproval = async (c: LedgerRow, to: RosterMember | null) => {
  // R3: an EWA is a DIFFERENT INSTRUMENT and takes a different sender — no price, no
  // running total, kind='ewa'. Branching inside sendForConfirmation would have put a
  // dozen conditionals in the one function whose output a client signs.
  const asEwa = ewas.find((e) => e.id === c.id);
  if (asEwa) {
    const prof0 = await getProfile(db);
    const re = await sendEwa(connector.client, {
      ewaChangeOrderId: c.id, decisionId: c.decision_id, projectId,
      projectName: projects.find((p) => p.id === projectId)?.name ?? 'this job',
      scope: c.scope, directedBy: c.who_directed || 'Owner',
      counterparty: to?.name || c.who_directed || 'Owner',
      terms: asEwa.proceed === 'tm_capped'
        ? { proceed: 'tm_capped', hourlyRateCents: asEwa.hourlyRateCents!,
            capCents: asEwa.capCents!, settlementHours: asEwa.settlementHours }
        : { proceed: 'hold', settlementHours: asEwa.settlementHours },
      channel: 'link', whenMs: Date.now(), linkBase: CONFIRM_BASE,
      companyName: prof0?.company || prof0?.name || null,
      // The flow terms ride into the EWA's frozen text too (DEF-2). An EWA is a
      // change_order row and priceDraftExtra will set these on it, so leaving them
      // here would let a client sign an authorization missing the exclusions and
      // schedule impact they were shown.
      billingTiming: c.billing_timing, scheduleEffect: c.schedule_effect,
      scheduleDays: c.schedule_days, exclusions: c.exclusions,
    });
    if (!re.ok) { setUi({ k: 'refused', why: T(re.reason as any) }); return; }
    await markLocalSent(db, c.id);
    if (to) await markApproverUsed(db, to.id);
    setSendPrep(null);
    void signalSaved();  // felt confirmation the commitment was sent (gap #7)
    setSentLink({ url: re.url, shown: re.shownContent,
      // No amount for an EWA: it is stored with amount_cents = 0, so `c.amount` is
      // "$0.00" — and the EWA contract states NO price. Showing $0.00 misrepresents
      // it (Codex P2). Its terms (rate/cap) live in the frozen instrument itself.
      scope: c.scope, amount: undefined,
      jobName: projects.find((p) => p.id === projectId)?.name ?? 'this job',
      sentTo: to?.name ?? c.who_directed ?? null, atMs: Date.now(), phone: to?.phone ?? null });
    await refresh();
    return;
  }

  // The CONFIRM_BASE check that used to sit here moved INTO
  // sendForConfirmation, which now refuses before it writes. It was here and
  // not on the decision-confirm path, so one of the two send paths could mint
  // a request for a link that goes nowhere. The refusal surfaces through the
  // same `r.ok === false` branch below, so the user-visible behaviour on this
  // path is unchanged.
  const prof = await getProfile(db);
  // Recomputed here rather than captured from the ledger's render scope: this now
  // runs from a sheet that outlives that scope, and a stale figure would freeze a
  // WRONG "extras you've approved on this job" total into the instrument the client
  // signs (mandate #5/#6).
  const approvedCents = coRows
    .filter((x) => x.status === 'approved')
    .reduce((n, x) => n + x.amount_cents, 0);
  const r = await sendForConfirmation(connector.client, {
    kind: 'confirm', decisionId: c.decision_id, projectId,
    projectName: projects.find((p) => p.id === projectId)?.name ?? 'this job',
    // 391 — THE SUBJECT IS THE TITLE, THE VALUE IS THE SCOPE OF WORK. Both were
    // `c.scope`, so the document's body and its heading were one 30-character string
    // and the client signed a title. Falls back to the title for any row created
    // before 391 whose scope_of_work never got written: that row then signs exactly
    // what it would have signed before, never an empty scope.
    subject: c.scope,
    value: (c.scope_of_work || '').trim() || c.scope,
    directedBy: c.who_directed || 'Owner',
    // The APPROVER, not who asked for the work. These are different people
    // and conflating them is how a request reaches someone who cannot
    // authorise it. Falls back to who_directed only when the roster is empty,
    // which is the pre-R5c behaviour and still better than nothing.
    counterparty: to?.name || c.who_directed || 'Owner',
    channel: 'link', whenMs: Date.now(), linkBase: CONFIRM_BASE,
    amountCents: c.amount_cents,
    // The cap travels with the price or the client signs the wrong
    // instrument: renderCard bakes the not-to-exceed clause into the frozen
    // shown_content, and the approval page renders it, only if this is here.
    nteCents: c.nte_cents,
    companyName: prof?.company || prof?.name || null,
    approvedRunningCents: approvedCents, changeOrderId: c.id,
    // Flow terms (375): they ride into the frozen instrument. Null on extras
    // that predate them — renderCard omits the line rather than inventing one.
    billingTiming: c.billing_timing, scheduleEffect: c.schedule_effect,
    scheduleDays: c.schedule_days, exclusions: c.exclusions,
  });
  if (r.ok) {
    // The link is out, so the row says so immediately. The server marks it
    // sent as well (230_close_the_loop) and stays the authority; this is
    // here so the ledger does not keep offering "Send for approval →" for
    // the thing he just watched himself send.
    //
    // The return value is READ, which is the whole reason it exists.
    // markLocalSent only moves a row OUT of 'draft', so false means the
    // change order was already past draft -- the client answered between
    // this screen rendering and this tap, or a hydrate landed first. The
    // link did go out, so nothing is undone and nothing is refused; but the
    // local row is not the one this code just moved, and refresh() below is
    // what makes the screen honest about that.
    const moved = await markLocalSent(db, c.id);
    if (!moved) {
      console.log('[send] %s was already past draft; server state wins', c.id);
    }

    // PRD R4 — the photos go with the price. AFTER the send succeeded and BEFORE the
    // link is handed to the client, so the first person to open it already sees them.
    // This can NEVER turn a successful send into a failure: the approval is live and
    // its price is frozen, so a photo that would not upload is REPORTED, not raised.
    // `data.user.id` and not OWNER: the Storage object key was built from the auth uid
    // by the outbox drainer, and OWNER falls back to 'owner-local' before sign-in.
    // R8: keep the link so a reminder can reuse it. Overwrites — one live link per
    // extra (250), and a new link resets the reminder budget, because nobody has been
    // nagged about the new instrument yet.
    await noteLinkSent(db, { changeOrderId: c.id, token: r.token, url: r.url });

    const { data: who } = await connector.client.auth.getUser();
    const pr = who?.user
      ? await publishApprovalPhotos(db, connector.client,
          { token: r.token, changeOrderId: c.id, ownerId: who.user.id })
      : null;
    setPhotoNote(
      !pr ? null
        : (pr.blocked || pr.failed.length) ? T('r4.photosFailed')
        : pr.droppedOverCap > 0 ? T({ k: 'r4.photosCapped', p: { n: pr.attached } } as any)
        : pr.attached > 0 ? T({ k: 'r4.photosAttached', p: { n: pr.attached } } as any)
        : null
    );
    // AFTER a successful send, never before: last_used_ms drives who gets
    // suggested next, and an attempt that failed is not evidence of anything.
    if (to) await markApproverUsed(db, to.id);
    // R6b item 3 + R5c's AC: "who was entitled to approve this is part of the record,
    // not just who did". AFTER a successful send only — an attempt that failed is not
    // evidence anyone was asked. The role is COPIED onto the record, never joined
    // live: retiring this approver later must not rewrite what an already-signed
    // record says about their authority.
    const sentAtMs = Date.now();
    await noteActorNow(db, { subjectKind: 'change_order', subjectId: c.id,
                             act: 'sent', atMs: sentAtMs });
    if (to) {
      await noteApprover(db, { changeOrderId: c.id, approverId: to.id,
                               name: to.name, role: to.role, atMs: sentAtMs });
    }
    setSendPrep(null);
    void signalSaved();  // felt confirmation the commitment was sent (gap #7)
    setSentLink({ url: r.url, shown: r.shownContent,
      scope: c.scope, amount: c.amount,
      jobName: projects.find((p) => p.id === projectId)?.name ?? 'this job',
      sentTo: to?.name ?? c.who_directed ?? null, atMs: sentAtMs, phone: to?.phone ?? null });
    await refresh();
  } else setUi({ k: 'refused', why: r.reason });
};

  /**
   * R5c — the send preview. Tapping "Send for approval" no longer sends; it opens
   * this. That is mandate #2 ("anything carrying a price or a commitment requires a
   * mandatory human confirmation step before it commits or sends"), and it is also
   * the only place the routing suggestion can be shown before it is acted on. A
   * pre-filled recipient nobody read is an inference carrying a price.
   */
  const [sendPrep, setSendPrep] = React.useState<{
    co: LedgerRow;
    type: ExtraType | null;
    suggestion: Suggestion | null;
    roster: RosterMember[];
    chosenId: string | null;     // null = take the suggestion
    picking: boolean;            // showing the full roster to override
    adding: null | { name: string; role: ApproverRole; phone: string };
    busy: boolean;
  } | null>(null);

  // Where the no-login page is hosted. REQ-VAL3's link is only as good as the
  // page it lands on, so this is configuration, not a constant -- and its absence
  // is surfaced instead of silently producing dead links.
  const CONFIRM_BASE = process.env.EXPO_PUBLIC_CONFIRM_BASE ?? '';
  // MANDATE #6: the read-back. A price is never accepted without a human
  // looking at it. `confidence` decides whether we dare prefill.
  const [priced, setPriced] = React.useState<null | {
    decisionId: string; scope: string; whoDirected: string;
    amountText: string; nteText: string;
    /** R3's one-step modes. */
    mode: PriceMode;
    /** R2: what the RECORDING said. null while it is being read, or when this device
     *  has no transcript for it (offline, or not processed yet). */
    voice: VoiceReading | null;
    /** R7: the extra this new price replaces. Retired when the price is confirmed. */
    supersedes?: string | null;
    /** Set when the composer is FINISHING an existing capture-draft rather than
     *  minting a new extra: confirm updates that row (priceDraftExtra). */
    existingCoId?: string | null;
    /** Flow-mock questions (FLOW-SIMPLEST-JOBSITE.md, phase 3). Billing defaults
     *  to when_completed (decision 2); schedule starts unanswered — "not sure
     *  yet" is an explicit, honest choice, never a silent default. */
    billingTiming: BillingTiming;
    scheduleEffect: ScheduleEffect | null;
    scheduleDaysText: string;
    exclusions: string;
  }>(null);
  // FLOW step 3: the Review & Send screen over the details card. Holds the
  // company name so the preview renders the same header the owner will read.
  const [reviewSend, setReviewSend] = React.useState<null | { company: string | null }>(null);
  // FLOW — the processing screen that runs AFTER job selection (hadar, 2026-07-24:
  // "prompt me to choose a jobsite ... right as you click finish, it cannot upload
  // before that"). Job selection now comes first; this shows the live, HONEST
  // stages (each tracks a real signal, never a timer) and then opens the details
  // for the already-filed change order `coId`. On weak/no connection, a message +
  // Done that parks at home (the extra stays a filed draft, finished later).
  const [transition, setTransition] = React.useState<null | {
    ids: string[]; anchorCaptureId: string | null; coId: string;
    uploaded: boolean; transcribed: boolean; analyzed: boolean; offline: boolean;
    stalled: boolean; uploadDone: number; uploadTotal: number;
    lastError: string | null; blocked: boolean;
    // Augment mode: this transition is backing up ADDED evidence on an existing
    // extra, not a new one. Like a new extra it waits for the added voice to upload,
    // transcribe and be analysed, then grows the record's Description from what was
    // said (hadar 2026-07-27) — the price is never re-derived — and reopens the
    // extra's record instead of the priced composer.
    isAugment: boolean;
    /**
     * GENERATE mode (hadar 2026-08-06, the concept stated in three steps): "1. make
     * sure that all of the files local to the phone associated with the change order
     * are uploaded. 2. transcribe & AI create scope. 3. update the change order
     * records."
     *
     * Steps 1 and 2 are exactly what this screen already watches, which is why it is
     * the same machinery and not a second one. Step 3 is what differs: a NEW extra
     * ends in the priced composer (a human still has to type the number), an AUGMENT
     * ends by appending to the description — a GENERATE ends by writing the model's
     * title, summary, scope of work and tags onto the change order and reopening the
     * record. It is the finish for an extra that already exists but never got its
     * write-up, so dropping the contractor into the composer would be answering a
     * question he did not ask.
     */
    isGenerate?: boolean;
  }>(null);

  // The transition's watcher. Polls the real signals: capture_outbox emptying
  // (uploaded), voice_transcript_cache (written down — works OFFLINE, it is
  // on-device), capture_structured (analyzed — the CLOUD AI pass that writes the
  // title, tag and price).
  //
  // THE GATE (hadar, 2026-07-24): "check the numbers" must NOT open until the
  // file is uploaded AND processed, because the title, the tag and the price all
  // come from the online AI pass. So we advance only on upload + words + analyzed
  // — never on a stopwatch, never before the AI has spoken. A half-processed
  // step 3 (wrong title, no price) is the exact bug this closes.
  //
  // AND (same day, "full signal and wifi" still hit the offline branch): the
  // screen now DRIVES the upload — kicks drainOutbox on entry and every ~5s —
  // instead of only watching it (the background drain runs on a 15s timer, so a
  // fresh capture could sit un-pushed while the screen cried offline). "Offline"
  // is a NETWORK fact (isConnected), asked only after we've waited and are still
  // not ready — a slow-but-connected pipeline is never called offline.
  React.useEffect(() => {
    if (!transition) return;
    let alive = true;
    const marks = transition.ids.map(() => '?').join(',');
    let firstCount = -1;
    let lastN = -1;  // last successful outbox count — the progress fallback if a poll throws
    // Latches true once the AI has written its structured row. No anchor capture
    // (a text-only extra) means nothing to transcribe or analyse — mirror the
    // `transcribed` initializer above.
    let analyzedSeen = transition.anchorCaptureId === null;
    // Latches true if drainOutbox refuses to upload on POLICY (on cellular with
    // cellular-upload off — the default). That is not offline and not slow: it will
    // never finish here, so surface the Wi-Fi escape at once (Codex P2).
    let blockedSeen = false;
    const kickDrain = async () => {
      try {
        // getSession() is LOCAL — no network round-trip. getUser() validates the
        // JWT against the server, which is exactly the thing that may be failing on
        // this screen; we only need the id to trigger the drain (review #6).
        const { data } = await connector.client.auth.getSession();
        const uid = data?.session?.user?.id;
        if (uid) {
          // BEFORE the drain, every time: one transient failure schedules this row
          // 2+ minutes out, and this screen only lives for 90 seconds — without this
          // the retry it is about to run cannot even see the capture it is waiting on.
          await redriveNow(db, transition.ids);
          // THESE captures first: the background drain is fair, this one is urgent.
          const r = await drainOutbox(db, connector.client, uid, transition.ids);
          if (r.blocked) blockedSeen = true;
        }
      } catch { /* the capture is safe locally; a failed push just retries */ }
    };
    const isOffline = async () => {
      // Only OFFLINE when the radio says so explicitly — undefined isConnected is
      // "unknown", not "offline" (review #2).
      try { return (await Network.getNetworkStateAsync()).isConnected === false; }
      catch { return false; }  // can't tell → don't cry offline
    };
    (async () => {
      void kickDrain();  // start the upload NOW, don't wait for the 15s timer
      for (let tick = 0; alive && tick < 90; tick++) {
        let up = false, tr = transition.anchorCaptureId === null;
        // Fall back to the last SUCCESSFUL count, not firstCount, so a transient
        // poll error doesn't snap the progress bar back to 0 (review #5).
        let n = lastN >= 0 ? lastN : (firstCount < 0 ? 0 : firstCount);
        try {
          n = (await db.getAll<{ n: number }>(
            `SELECT count(*) AS n FROM capture_outbox WHERE capture_id IN (${marks})`,
            transition.ids))[0]?.n ?? 0;
          lastN = n;
          if (firstCount < 0) firstCount = n;
          up = n === 0;
          if (!tr) {
            tr = !!(await db.getAll(
              `SELECT 1 FROM voice_transcript_cache WHERE capture_id = ?`,
              [transition.anchorCaptureId]))[0];
          }
          // Once the bytes are up, the only thing left is the cloud AI pass. Poll
          // it EVERY tick until it lands — it is the gate, not a bonus. Look across
          // ALL of this extra's captures, not just the anchor: only the voice one
          // ever gets a structured row, and it may not be the anchor (review #1) —
          // this is the same lookup finishExtraById uses.
          if (up && !analyzedSeen && transition.anchorCaptureId) {
            try {
              if (await fetchLatestProposalForCaptures(connector.client, transition.ids)) {
                analyzedSeen = true;
              }
            } catch { /* best-effort read; try again next tick */ }
          }
        } catch { /* schema races: poll again */ }
        if (!alive) return;

        // ONE gate for both: uploaded + (when there is a voice) its words are down and
        // the AI has spoken. `tr` and `analyzedSeen` both initialise to true when there
        // is no anchor capture, so a photos-only edit still reduces to "ready when up".
        // An edit with a voice now waits for transcription + analysis exactly like a new
        // extra (hadar, 2026-07-27) — the augment path no longer short-circuits on upload.
        // THE AI PASS OUTRANKS THE ON-DEVICE TRANSCRIPT (hadar 2026-08-07: an empty
        // recording is a valid outcome, not a fault). `tr` watches the LOCAL cache that
        // on-device STT fills; `analyzedSeen` means the SERVER has finished reading the
        // recording. When the server has answered, waiting on the device's own copy adds
        // nothing — and on a recording with nothing in it, on-device STT writes no cache
        // row at all, so `tr` could never turn true and the screen sat out its full 90
        // seconds telling a contractor it was slow when it was finished.
        const ready = up && (tr || analyzedSeen) && analyzedSeen;
        // Only ask the radio once we've actually waited a beat and are still not
        // ready — and if we're online, re-kick the push.
        let offline = false;
        if (!ready && tick >= 8 && firstCount > 0) {
          offline = await isOffline();
          if (!alive) return;
          if (!offline && tick % 5 === 0) void kickDrain();
        }
        // Per-file upload progress (audio + each photo is one outbox row): total
        // is what was queued when we started, done is how many have drained.
        const uploadTotal = firstCount < 0 ? 0 : firstCount;
        const uploadDone = firstCount < 0 ? 0 : Math.max(0, firstCount - n);
        // The outbox records WHY a push failed (park() / backoff() store it so it
        // is "surfaced in the UI, never silently dropped"). Only read it once the
        // upload has had a beat to try and hasn't finished (review #3: don't run
        // this SELECT on the happy path). Carry it up so the screen can name it —
        // "Backing it up online…" that never finishes must say what went wrong.
        let lastError: string | null = null;
        if (!up && tick >= 2) {
          try {
            // json_extract of the DESTINATION, not just the error (hadar, 2026-07-27).
            // A bare "23503 violates capture_project_id_fkey" cost a full afternoon of
            // guessing WHICH project was missing; the answer was in the payload the
            // whole time. An FK error that names the row it could not find is a
            // one-line diagnosis instead of a database session.
            const er = (await db.getAll<{ last_error_code: string | null;
                                          last_error_text: string | null;
                                          project_id: string | null }>(
              `SELECT last_error_code, last_error_text,
                      json_extract(payload_json, '$.project_id') AS project_id
                 FROM capture_outbox
                WHERE capture_id IN (${marks}) AND last_error_text IS NOT NULL
                ORDER BY last_attempt_at_ms DESC LIMIT 1`, transition.ids))[0];
            if (er) {
              lastError = [er.last_error_code, er.last_error_text].filter(Boolean).join(': ');
              if (er.project_id) lastError += `  [job: ${er.project_id}]`;
            }
          } catch { /* diagnostic only */ }
        }
        setTransition((t) => t && { ...t, uploaded: up, transcribed: tr,
                                    analyzed: analyzedSeen, offline,
                                    uploadDone, uploadTotal, lastError,
                                    blocked: blockedSeen });

        // THE gate: uploaded + words down + AI has written title/tag/price (or, when
        // augmenting, just uploaded).
        if (ready) {
          // Processing FINISHED — a felt "it's ready" cue (gap #3), so a user who
          // pocketed the phone during upload/AI knows the extra is written up. Distinct
          // from the save chime; the visual checkmarks already say it on screen.
          void signalReady();
          // A beat so the checkmarks are SEEN — a flash reads as a glitch.
          await new Promise((r) => setTimeout(r, 900));
          if (!alive) return;
          setTransition((t) => {
            // New extra → open the priced composer; augment → grow the description
            // from the added voice (same rules as a new extra), then reopen the record.
            if (t) {
              if (t.isGenerate) void finishGenerateById(t.coId);
              else if (t.isAugment) void finishAugmentById(t.coId, t.ids);
              else void finishExtraById(t.coId);
            }
            return null;
          });
          return;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      // 90s and still not fully ready. NEVER dump into an empty step 3 — keep the
      // extra as a draft at home and tell the truth: offline if the phone really
      // is disconnected, else "still finishing" (the pipeline is slow, not you).
      if (alive) {
        const off = await isOffline();
        if (!alive) return;
        setTransition((t) => t && { ...t, offline: off, stalled: !off });
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transition?.ids?.[0]]);
  const [coRows, setCoRows] = React.useState<LedgerRow[]>([]);
  // extra id -> weakest state across its captures. Absent means "not computed
  // yet", which the gate treats as NOT ready: an unknown answer must never open
  // a send, for the same reason procState refuses to infer success from silence.
  const [readiness, setReadiness] = React.useState<Map<string, string>>(new Map());
  // R7: open client questions per extra, keyed by change-order id. Read from the
  // LOCAL mirror, so the "discussing" chip renders in a basement like the rest of
  // this screen (mandate #7).
  const [questions, setQuestions] = React.useState<Record<string, number>>({});
  // R5b. `threads` is every thread on the job, for the ledger's flags; `thread` is
  // the one open on screen. The ref keeps refresh()'s identity stable, exactly as
  // recordIdRef does for the record.
  const [ewas, setEwas] = React.useState<EwaRow[]>([]);
  const [ewaSet, setEwaSet] = React.useState<Set<string>>(new Set());
  // R3 step one, being composed. Null = not authoring one.
  const [ewaDraft, setEwaDraft] = React.useState<null | {
    decisionId: string; scope: string; whoDirected: string;
  }>(null);
  // R3 step two: which EWA the price about to be created will settle.
  const [settling, setSettling] = React.useState<string | null>(null);
  const [threads, setThreads] = React.useState<Map<string, ThreadMessage[]>>(new Map());
  const [thread, setThread] = React.useState<null | {
    co: LedgerRow; messages: ThreadMessage[];
    revision: { priorAmount: string; newAmount: string } | null;
    undelivered: ReadonlySet<string>; focusReply: boolean;
  }>(null);
  const threadIdRef = React.useRef<string | null>(null);
  // The notification tap listener is registered once and outlives every render,
  // so it cannot read `coRows` directly — it would close over whatever was
  // loaded at registration, which on a cold start is the empty array.
  const coRowsRef = React.useRef<LedgerRow[]>([]);
  // PRD R6b: the extra record. The assembled data drives the screen, and the id is
  // kept alongside it so refresh() can re-derive the record while it is open — a
  // record that cannot change is a record that can lie about what is owed.
  const [record, setRecord] = React.useState<ExtraRecord | null>(null);
  const recordIdRef = React.useRef<string | null>(null);
  // R5b on the record (prototype c5): the discussion, its delivery state, and — on
  // a superseded record — what replaced it. Loaded ALONGSIDE the record: each layer
  // may fail without costing the rest.
  const [recordThread, setRecordThread] = React.useState<ThreadMessage[] | null>(null);
  const [recordUndelivered, setRecordUndelivered] = React.useState<ReadonlySet<string>>(new Set());
  // The stuck-extra diagnosis for the OPEN record: are its captures still queued, are
  // they parked, is the radio or the cellular setting holding them? Read per record so
  // the draft screen can NAME the cause instead of offering one button for two
  // different problems.
  const [recordDelivery, setRecordDelivery] = React.useState<CaptureDelivery | null>(null);
  const [recordNextId, setRecordNextId] = React.useState<string | null>(null);
  /**
   * SPEC-extra-lifecycle-v1 — the stage screens' inputs, its own hydration layer.
   *
   * `view` is what the screen reads. `co` is the RAW change_order row, kept beside
   * it because the record's ACTIONS (revise, remind, follow-on) need columns no
   * `ExtraRecord` carries — and reading them here rather than off `coRowsRef`
   * closes the stated cross-project gap: `coRows` only ever holds the currently
   * open project, so a record reached from a push used to render read-only.
   */
  const [recordLc, setRecordLc] = React.useState<RecordLcState | null>(null);
  // The client drawer, open over the record. Its own flag (not `detail`) because it
  // edits the ROSTER, not a field of the change order.
  // The client drawer, and WHAT it is naming. 'client' sets who this extra is FOR;
  // 'contact' adds someone else on the chain (architect, inspector, the GC above you)
  // WITHOUT touching the client — adding a person to keep in the loop must never
  // silently re-point who approves the money.
  const [clientOpen, setClientOpen] = React.useState<null | 'client' | 'contact'>(null);
  // The signed document, shown BEFORE it is exported. Held as the assembled doc (not a
  // flag) so the sheet renders the same object the PDF is built from.
  const [approvalDoc, setApprovalDoc] = React.useState<
    null | { doc: Awaited<ReturnType<typeof buildApprovalDoc>> }>(null);
  /** The merged local+server timeline for the Full history subscreen. Merged ONCE,
   *  here, from record.ts's local events and the server's — `mergeTimeline` already
   *  puts unstamped events last on purpose and re-merging its own output would
   *  double every row. */
  const [recordTimeline, setRecordTimeline] = React.useState<MergedEvent[]>([]);
  /**
   * The open detail subscreen (extradetails.tsx) and its editor buffers.
   *
   * The buffers live HERE and not in the editors because those are controlled
   * components by design: there is one money parser in this product and a second
   * one on a device is how the phone and the server end up disagreeing about what
   * a man typed. Nothing is written until Save; backing out discards.
   */
  const [detail, setDetail] = React.useState<null | {
    field: ExtraDetailField | 'history';
    scope: string;
    priceMode: PriceMode;
    amountText: string; nteText: string;
    scheduleEffect: string | null; scheduleDaysText: string;
    billingTiming: string | null; exclusions: string;
    reading: VoicePriceReading | null;
    rewrite: RewriteState;
  }>(null);
  /** The record's photo lightbox, hoisted so the Photos & proof subscreen — a
   *  sibling early-return in the cascade — opens the SAME viewer instead of
   *  growing a second one. */
  const [zoomUri, setZoomUri] = React.useState<string | null>(null);
  const [dsync, setDsync] = React.useState<any>(null);
  const [bundling, setBundling] = React.useState<string | null>(null);
  const [cellOn, setCellOn] = React.useState(false);
  // PERSONAL-USE CONSENT MODEL (decision: hadar, 2026-07-17). Recording consent is
  // carried by a ONE-TIME Terms acceptance, not a per-job form -- see consent.ts
  // getTermsAccepted and IMPLEMENTATION_NOTES §5.6. `terms` = accepted? (null while
  // loading). `showTerms` opens the acceptance screen at the first record tap; `jur`
  // is the GPS-detected state, used ONLY for a non-blocking all-party reminder -- the
  // app never asserts third-party consent on the user's behalf.
  const [terms, setTerms] = React.useState<boolean | null>(null);
  const [showTerms, setShowTerms] = React.useState<
    null | { jur: string | null; detecting: boolean }
  >(null);
  const openTerms = React.useCallback(() => {
    setShowTerms({ jur: null, detecting: true });
    (async () => {
      // Same best-effort fix the capture path uses (mandate #9), resolved to a state
      // OFFLINE (mandate #7). Powers only the reminder; never blocks acceptance.
      let jur: string | null = null;
      if (await ensureLocationPermission()) {
        const fix = await stampNow();
        if (fix.status === 'ok' && fix.lat != null && fix.lng != null) {
          jur = resolveJurisdiction(fix.lat, fix.lng);
        }
      }
      setShowTerms((t) => (t ? { ...t, jur, detecting: false } : t));
    })();
  }, []);

  // REQ-SET1/EVID2. Null until the first job exists -- a new user has no jobs, and
  // pretending otherwise is what the hardcoded constant was doing.
  const [projectId, setProjectId] = React.useState<string>(INBOX_ID);
  const [projects, setProjects] = React.useState<Project[]>([]);
  // CompanyCam-style shell: the app opens on the Projects list; a capture happens
  // INSIDE a project. 'home' = the project list, 'project' = one project's
  // camera-first workspace + capture grid.
  const [nav, setNav] = React.useState<'home' | 'project' | 'jobs' | 'activity'>('home');
  // The Activity page's status tab (hadar, 2026-07-23 mockup): all extras, filtered.
  const [activityTab, setActivityTab] = React.useState<'all' | 'waiting' | 'approved' | 'needs'>('all');
  // Home's summary-chip filter. Filters the Home list IN PLACE — tapping a chip must
  // never navigate away (hadar 2026-07-27: "it takes me to another page"). null = show
  // every section; a value shows only that one, and tapping the live chip clears it.
  // Opens on 'needs' (hadar 2026-08-05): what needs YOU is the reason to open the app,
  // so it is selected by default; tapping the live chip still clears to every section.
  const [homeFilter, setHomeFilter] = React.useState<null | 'needs' | 'waiting' | 'approved'>('needs');
  const [cards, setCards] = React.useState<ProjectCard[]>([]);
  const [search, setSearch] = React.useState('');
  const [picker, setPicker] = React.useState(false);
  const [filed, setFiled] = React.useState<Msg | string | null>(null);
  // REQ-P5. A proposal is NOT a project — it lives here until someone taps it.
  const [proposal, setProposal] = React.useState<null | { lat: number | null; lng: number | null; why: Msg }>(null);
  const [inbox, setInbox] = React.useState(0);
  const [inboxOpen, setInboxOpen] = React.useState(false);
  const [inboxRows, setInboxRows] = React.useState<any[]>([]);
  // REQ-EVID1 + REQ-CAP3.
  const [viewing, setViewing] = React.useState<any>(null);
  // REQ-GAL2: the full-screen viewer is a PAGER across this project's captures.
  // `viewer.index` is the position in `saved`; `viewing` holds the loaded evidence
  // for the current page (verified hash + notes), refreshed by the effect below.
  const [viewer, setViewer] = React.useState<null | { index: number }>(null);
  const pagerRef = React.useRef<ScrollView | null>(null);
  // REQ-GAL3 user tags: the current capture's tags (viewer), a draft, the grid's
  // capture→tags map + the project's distinct tags (filter chips), and the active
  // filter.
  const [vtags, setVtags] = React.useState<string[]>([]);
  const [tagDraft, setTagDraft] = React.useState('');
  const [gridTags, setGridTags] = React.useState<Record<string, string[]>>({});
  const [projTags, setProjTags] = React.useState<string[]>([]);
  const [tagFilter, setTagFilter] = React.useState<string | null>(null);
  const [vnotes, setVnotes] = React.useState<Note[]>([]);
  const [noteDraft, setNoteDraft] = React.useState('');
  const [playing, setPlaying] = React.useState(false);
  const [playErr, setPlayErr] = React.useState<string | null>(null);
  const [nCounts, setNCounts] = React.useState<Record<string, number>>({});
  const [rejected, setRejected] = React.useState<any[]>([]);
  const [showDetail, setShowDetail] = React.useState(false);
  // REQ-VAL7
  const [scopeOpen, setScopeOpen] = React.useState(false);
  const [boundaries, setBoundaries] = React.useState<any[]>([]);
  const [parties, setParties] = React.useState<any[]>([]);
  const [bndDraft, setBndDraft] = React.useState('');
  const [ptyDraft, setPtyDraft] = React.useState({ name: '', trade: '' });

  /**
   * REQ-X3. ONE status for the whole screen, chosen by what the user must DO —
   * not a sum of every state the system finds interesting. A capture that is
   * unfiled AND unsynced is ONE problem to him ("it needs a job"), because filing
   * is the only action he can take; the sync happens by itself.
   */
  const screen = React.useMemo(() => screenStatus([
    ...Array(inbox).fill(captureStatus({ inInbox: true, rejected: false,
      pendingUpload: false, parked: false, hasLocation: true })),
    ...Array(rejected.length + delivery.parked).fill(captureStatus({ inInbox: false,
      rejected: true, pendingUpload: false, parked: true, hasLocation: true })),
    ...Array(delivery.pending).fill(captureStatus({ inInbox: false, rejected: false,
      pendingUpload: true, parked: false, hasLocation: true })),
  ]), [inbox, rejected.length, delivery.parked, delivery.pending]);
  const [lang, setLangState] = React.useState<Lang>(getLang());
  // REQ-SET2. Derived from what EXISTS, never a stored step counter -- a counter
  // and reality drift apart the moment someone kills the app mid-setup.
  const [firstRun, setFirstRun] = React.useState<boolean | null>(null);
  // First-run profile ("who you are"). hasProfileState gates the step; the rest is
  // the in-step form. `pSub` is the sub-screen: 'who' (name + solo/company) then
  // 'trade' (skippable grid). Kept minimal on purpose — see src/profile.ts.
  const [hasProfileState, setHasProfile] = React.useState(false);
  const [pSub, setPSub] = React.useState<'who' | 'trade'>('who');
  const [pName, setPName] = React.useState('');
  const [pSolo, setPSolo] = React.useState<boolean | null>(null);
  const [pCompany, setPCompany] = React.useState('');
  const [pTrade, setPTrade] = React.useState<string | null>(null);
  // Resolved from the session at startup. Nothing that syncs may be written with a
  // placeholder: the server's types are the contract, and a string that cannot be
  // a UUID is not a user.
  const [OWNER, setOwner] = React.useState<string>(OWNER_FALLBACK);
  // PRD R4. What happened to the photos on the last send — shown beside the link,
  // never swallowed. "Sent" and "sent with the evidence" are different facts.
  const [photoNote, setPhotoNote] = React.useState<string | null>(null);
  const [newJob, setNewJob] = React.useState<
    null | { name: string; address: string; lat?: number | null; lng?: number | null }
  >(null);

  /**
   * REQ-CAP5 + mandate #1: "saved" is confirmed AUDIBLY and visually; failure is
   * loud, never silent.
   *
   * Driven off the UI STATE, not from each call site. Twelve call sites each
   * remembering to beep is twelve chances to forget -- and an audit found the
   * text-capture path had already forgotten, which meant a contractor typing a
   * note on a ladder got no confirmation at all. A new capture path added
   * tomorrow is audible by construction, because it cannot reach `saved` without
   * passing through here.
   *
   * The GATE is upstream and unchanged: `saved` is only ever set from the ok:true
   * branch of performCapture, which returns only after the SQLite transaction
   * commits under synchronous=FULL. This never fires on a raw write -- that is the
   * phantom-"saved" bug REQ-CAP5 exists to prevent.
   */
  React.useEffect(() => {
    if (ui.k === 'saved') void signalSaved();
    else if (ui.k === 'refused') void signalFailed();
    else if (ui.k === 'recording') void signalArmed();
  }, [ui]);
  // §7.2 line items. Kept OUT of `priced` so cancelling the composer cannot
  // disturb a figure the contractor has already read back and agreed with.
  const [lines, setLines] = React.useState<LineItem[]>([]);
  const [draftLine, setDraftLine] = React.useState({ desc: '', qty: '1', unit: '' });
  // §7.1 signing. `shown` is frozen the moment the sheet opens.
  const [sign, setSign] = React.useState<null | {
    coId: string; shown: string; phone: string; code: string; sent: string | null;
    legalName: string; verifiedAt: string | null; err: string | null;
  }>(null);
  const [saved, setSaved] = React.useState<any[]>([]);
  const [note, setNote] = React.useState('');
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  // refresh() must read the CURRENT project, but it is a stable useCallback([])
  // so the init effect (deps [refresh]) never re-runs. A render-synced ref bridges
  // the two: assigned every render, so refresh always sees the live project without
  // being rebuilt when it changes. (Before this, refresh closed over the initial
  // INBOX id and every project switch queried the wrong job — invisible while the
  // spike had one project, load-bearing the moment there are two.)
  const projectIdRef = React.useRef(projectId);
  projectIdRef.current = projectId;


  const refresh = React.useCallback(async () => {
    try {
      const pid = projectIdRef.current;
      // REQ-EVID2: this job's captures, not every capture on the phone.
      const rows = await listCommittedCaptures(db, pid);
      setSaved(rows);
      // REQ-GAL3: tags for this project's captures — the grid filter + per-tile chips.
      const ids = rows.map((c) => c.capture_id);
      try {
        setGridTags(await tagMap(db, ids));
        setProjTags(await projectTags(db, ids));
      } catch { /* schema not up yet */ }
      setInbox(await inboxCount(db));
      setNCounts(await noteCounts(db));
      setRejected(await listRejected(db));
      try {
        setBoundaries(await listBoundaries(db, pid));
        setParties(await listParties(db, pid));
      } catch { /* schema not up yet */ }
      const s = (await outboxStatus(db))[0];
      // Captures and decisions ride independent queues, so "not backed up yet"
      // must count both. One green tick that ignores half the queue is a lie.
      const ds = await decisionSyncStatus(db);
      setDsync(ds);
      const ps = await listProjects(db);
      setProjects(ps);
      try {
        setWaiting(await db.getAll(
          `SELECT co.id, co.scope, co.amount_cents, co.status, co.project_id,
                  COALESCE(p.name, '') AS pname, co.signed_by, co.created_at_ms
             FROM change_order co LEFT JOIN project p ON p.id = co.project_id
            WHERE co.status != 'superseded'
            ORDER BY co.created_at_ms DESC LIMIT 5`));
        const rec = (await db.getAll<{ cents: number; n: number }>(
          `SELECT COALESCE(SUM(amount_cents),0) AS cents, COUNT(*) AS n
             FROM change_order WHERE status = 'approved'`))[0];
        setRecovered(rec ?? { cents: 0, n: 0 });
        // CELEBRATE THE YES (gap #1). Compare approved ids to what we've already
        // celebrated; the first refresh only SEEDS the watermark (never announces
        // history). A fresh approval fires the win overlay + the success haptic/chime.
        {
          const approvedNow = await db.getAll<{ id: string; amount_cents: number | null }>(
            `SELECT id, amount_cents FROM change_order WHERE status = 'approved'`);
          if (celebratedRef.current === null) {
            celebratedRef.current = new Set(approvedNow.map((r) => r.id));
          } else {
            const fresh = approvedNow.filter((r) => !celebratedRef.current!.has(r.id));
            if (fresh.length) {
              fresh.forEach((r) => celebratedRef.current!.add(r.id));
              const cents = fresh.reduce((n, r) => n + (r.amount_cents ?? 0), 0);
              setCelebrate({ n: fresh.length, cents });
              void signalSaved();  // the strongest success cue we have
            }
          }
        }
        // The Home dashboard: every LIVE extra across all jobs (superseded ones are
        // history), newest first, with its open-question count. Drafts belong here
        // too — they are the creator's unfinished work, private until sent (hadar,
        // 2026-07-23), and a Home that hid them showed nothing at all.
        setHomeExtras(await db.getAll(
          `SELECT co.id, co.scope, co.amount_cents, co.status, co.project_id,
                  COALESCE(p.name, '') AS pname, co.who_directed, co.created_at_ms,
                  co.signed_by,
                  ${CO_PHOTO_SUBQUERY} AS photo_relpath,
                  (SELECT COUNT(*) FROM co_question q WHERE q.change_order_id = co.id) AS questions
             FROM change_order co LEFT JOIN project p ON p.id = co.project_id
            WHERE co.status != 'superseded'
            ORDER BY co.created_at_ms DESC`));
        // Stage 1: captured walkthroughs not yet reviewed into a decision.
        const pairRows = await db.getAll<{ pair_id: string; start_ms: number; photos: number; voice_id: string | null }>(
          `SELECT cp.pair_id, MIN(cp.at_ms) AS start_ms,
                  SUM(CASE WHEN cp.role = 'photo' THEN 1 ELSE 0 END) AS photos,
                  (SELECT v.capture_id FROM capture_pair v
                    WHERE v.pair_id = cp.pair_id AND v.role = 'voice'
                    ORDER BY v.at_ms LIMIT 1) AS voice_id
             FROM capture_pair cp
            -- A group with a discarded member is a deleted walkthrough. Without
            -- this, pair rows left behind by older deletes resurrect the card
            -- for captures whose bytes are gone — the tap opens nothing and
            -- delete "does not work" because there is nothing left to delete.
            WHERE cp.pair_id NOT IN
                  (SELECT p2.pair_id FROM capture_pair p2
                     JOIN capture_discarded cd ON cd.capture_id = p2.capture_id)
            GROUP BY cp.pair_id
            ORDER BY start_ms DESC LIMIT 6`);
        const reviewedIds = new Set((await db.getAll<{ capture_id: string }>(
          `SELECT DISTINCT capture_id FROM decision_version WHERE capture_id IS NOT NULL`))
          .map((r) => r.capture_id));
        setCaptured(pairRows.filter((p) => !p.voice_id || !reviewedIds.has(p.voice_id)).slice(0, 4));
        // Stage 2: decisions confirmed but never priced into a change order.
        setUnsent(await db.getAll(
          `SELECT d.id, d.subject, d.project_id, d.created_at_ms, COALESCE(p.name,'') AS pname
             FROM decision d
             LEFT JOIN change_order co ON co.decision_id = d.id
             LEFT JOIN project p ON p.id = d.project_id
            WHERE co.id IS NULL
              -- PLUMBING NEVER RENDERS. startExtraFromCapture creates a decision
              -- behind every extra with subject 'extra <captureId>' — it exists
              -- for the joins (timeline, photo alignment, readiness), and hadar's
              -- model has no user-facing decision step at all. Shown here it
              -- reads as an extra that cannot be opened or deleted, because it
              -- is not an extra: it is the floor under one. When its extra is
              -- deleted, the plumbing row loses its co and would surface as an
              -- undeletable ghost — which is exactly what happened.
              AND d.subject NOT LIKE 'extra %'
              -- And a decision whose backing capture was discarded is dead
              -- regardless of how it was made: same reader-inventory rule as
              -- the walkthrough card.
              AND NOT EXISTS (SELECT 1 FROM decision_version dv
                                JOIN capture_discarded cd ON cd.capture_id = dv.capture_id
                               WHERE dv.decision_id = d.id)
            ORDER BY d.created_at_ms DESC LIMIT 4`));
      } catch { /* CO schema not up yet */ }
      // The Projects-home cards: counts, last activity and a cover photo per job.
      setCards(await projectCards(db, ps));
      // Keep the company feed live while it is open (review 2026-07-25: no stale snapshot).
      if (feedOpenRef.current) { try { setFeedItems(await companyFeed(db)); } catch { /* keep last */ } }
      // Open where he left off. A contractor who closes the app on the Elm St job
      // and reopens it in the same truck should not have to find it again.
      setProjectId((cur) => (cur === INBOX_ID && ps.length ? ps[0].id : cur));
      setTerms(await getTermsAccepted(db));
      setCellOn(await getCellularConsent(db));
      setDelivery({ pending: (s?.pending ?? 0) + ds.pending, parked: (s?.parked ?? 0) + ds.parked });
      setDecisions(await listDecisions(db, pid));
      const ledgerRows = await ledger(db, pid);
      // Readiness per extra, DERIVED not stored — same rule status.ts states for
      // captures. A stored column would go stale exactly when signal returns,
      // which is the moment it most needs to be right.
      const ready = new Map<string, ReturnType<typeof extraProcState>>();
      for (const r of ledgerRows) {
        try {
          ready.set(r.id, extraProcState(await captureStatesForExtra(db, r.decision_id)));
        } catch { /* schema not up yet; the gate closes rather than opens */ }
      }
      setReadiness(ready);
      setCoRows(ledgerRows); coRowsRef.current = ledgerRows;
      try { setQuestions(await openQuestions(db, pid)); } catch { /* schema not up yet */ }
      try { setThreads(await threadsForProject(db, pid)); } catch { /* schema not up yet */ }
      try {
        const jn = projects.find((p) => p.id === pid)?.name ?? '';
        // R3 AC4 -> R8's centre. Derived from the SAME listEwa call the ledger banner
        // uses; passing it in rather than re-querying keeps one answer to "is this
        // overdue", which depends on the clock and would otherwise drift between the
        // two surfaces showing it.
        const overdue: Record<string, number> = {};
        for (const e of await listEwa(db, pid)) {
          if (e.unpriced?.flagged && e.unpriced.dueAtMs != null) {
            overdue[e.id] = e.unpriced.dueAtMs;
          }
        }
        setActivity(await activityFor(db, pid, jn, overdue));
      } catch { /* schema not up yet */ }
      // R3: derived every cycle, never cached — AC4's flag depends on the clock, so a
      // snapshot taken on tap would show "not yet due" hours after it came due.
      try {
        const es = await listEwa(db, pid);
        setEwas(es);
        setEwaSet(await ewaIds(db, pid));
        // The clock starts when this device LEARNS the client approved, not when they
        // signed — the local row has no signature timestamp. Deliberately
        // conservative: it can only ever start LATE, so AC4 never flags early.
        for (const e of es) {
          if (e.rawStatus === 'approved' && e.approvedAtMs == null) {
            await markEwaApproved(db, e.id, Date.now());
          }
        }
      } catch { /* schema not up yet */ }
      // An open thread re-derives on the SAME cycle as everything else, for the same
      // reason the record does: a client can answer while he is reading it.
      const openThreadId = threadIdRef.current;
      if (openThreadId) {
        const msgs = await threadFor(db, openThreadId);
        const und = await undeliveredReplyIds(db);
        setThread((p) => (p && p.co.id === openThreadId ? { ...p, messages: msgs, undelivered: und } : p));
      }
      // An open extra record re-derives on the SAME cycle as everything else.
      // It used to be a snapshot taken once on tap, which meant a contractor could
      // still be reading "waiting on approval" minutes after the client signed --
      // and the state line tells him what to DO, so a stale one gives a stale
      // instruction. Reading a ref (not state) keeps refresh's identity stable.
      const openId = recordIdRef.current;
      if (openId) {
        const fresh = await extraRecord(db, openId);
        if (fresh) setRecord(fresh);
        // SPEC-extra-lifecycle-v1: the STAGE layer re-derives on the same cycle, and
        // it has to. The send gate is two orthogonal questions (REQ-LC13) and one of
        // them — has the evidence left the phone and been processed — is answered by
        // a background pipeline. Taken once on tap it would leave Send refusing with
        // a reason that stopped being true minutes ago, which is the behaviour the
        // old "Upload & process" button existed to work around.
        if (fresh) {
          try {
            const lc = await lifecycleFor(fresh);
            if (recordIdRef.current === openId) {
              setRecordLc(lc.state); setRecordTimeline(lc.timeline);
            }
          } catch { /* the layer already on screen stands */ }
        }
        // R5b: the discussion on the open record re-derives too — a question that
        // just landed must flip the state line and surface the reply bar's context
        // while he is looking at it, same rule as the open thread above.
        try {
          setRecordThread(await threadFor(db, openId));
          setRecordUndelivered(await undeliveredReplyIds(db));
        } catch { /* discussion schema not up yet */ }
      }
    } catch { /* pre-init */ }
  }, []);

  /**
   * PULL TO REFRESH (hadar, 2026-07-31) on Home / Jobs / Company.
   *
   * It re-reads every list from LOCAL SQLite, which is the honest thing for this
   * gesture to do: the record of what happened is on the phone, and a pull that waited
   * on the network would spin forever in a basement (mandate #7). The outbox drain and
   * the server hydrate keep running on their own timers; this does not block on either,
   * and each row still carries its own sync state — so the gesture never claims more
   * than it knows.
   *
   * `refresh` is a stable useCallback declared just below; referencing it from inside
   * this callback body is fine because nothing calls it during render.
   */
  const [pulling, setPulling] = React.useState(false);
  const onPullRefresh = React.useCallback(async () => {
    setPulling(true);
    try { await refresh(); } finally { setPulling(false); }
  }, [refresh]);

  // Reload the workspace whenever the selected project changes — opening a job from
  // the Projects home, or the auto-select above, both land the right captures.
  React.useEffect(() => { if (ready) void refresh(); }, [projectId, ready, refresh]);

  // Plan + ownership for the drawer. Keyed on OWNER (so it loads once the real user id
  // arrives after sign-in) and on menuOpen (so the plan box is current every time the
  // drawer is opened). Best-effort: a pre-migration/unsynced company reads free +
  // not-owner, the safe default (plan box hides the upgrade, Settings entry hidden).
  React.useEffect(() => {
    if (!ready) return;
    (async () => {
      try {
        setPlanId(await currentPlan(db));
        const co = await myCompany(db, OWNER);
        setIsOwner(!!co?.isOwner);
        // Usage rides the SAME refresh as the plan, on purpose: the two are read
        // together everywhere they are shown, and refreshing them separately is how
        // a drawer ends up displaying free-tier lines beside a paid plan name for a
        // frame. `quota` (the blocking decision) is deliberately not touched here.
        setUsage(await usageSummary(db, co?.id ?? null));
      } catch { setPlanId('free'); setIsOwner(false); setUsage(null); }
    })();
  }, [ready, OWNER, menuOpen, db, quota]);

  // R5b AC1 / R8: tapping the notification opens THAT extra, not the app's last
  // screen. Registered once and kept for the app's life — a listener torn down
  // between renders would drop the tap that arrives while the app is waking.
  //
  // getLastNotificationResponseAsync is checked too: a tap on a COLD start
  // delivers through that call, not through the listener, so without it the
  // lock-screen case (the one R5b actually describes) opens to the ledger.
  React.useEffect(() => {
    if (!ready) return;
    let live = true;
    const open = async (url: unknown) => {
      const link = typeof url === 'string' ? parseThreadLink(url) : null;
      if (!link || !live) return;
      // The record opens by id and does not care which job is selected, so this
      // half always works. The thread overlay is built from the LOADED ledger,
      // so a question on a job that is not the one on screen lands on the record
      // without the reply box. That is a real gap, not a silent one: switching
      // the selected job from a tap is a bigger move than this change should
      // make, and the record is the destination R8's AC names either way.
      await openRecord(link.changeOrderId);
      const row = coRowsRef.current.find((c) => c.id === link.changeOrderId);
      if (row && live) await openThread(row, link.focusReply);
    };
    let sub: { remove: () => void } | null = null;
    (async () => {
      try {
        const N = await import('expo-notifications');
        const last = await N.getLastNotificationResponseAsync();
        if (last) await open(last.notification.request.content.data?.url);
        sub = N.addNotificationResponseReceivedListener((r) => {
          void open(r.notification.request.content.data?.url);
        });
      } catch { /* no notifications module on this build; the bell still works */ }
    })();
    return () => { live = false; sub?.remove(); };
  }, [ready]);

  // REQ-GAL2: load the current page's evidence (verified hash + notes) whenever the
  // pager lands on a new capture. readCapture re-hashes from disk, so the
  // intact/tampered verdict is real, per-page. Playback is stopped on a page change.
  React.useEffect(() => {
    if (!viewer) return;
    const c = saved[viewer.index];
    if (!c) return;
    let live = true;
    (async () => {
      stopPlayback(); setPlaying(false); setPlayErr(null);
      const v = await readCapture(db, c.capture_id);
      if (!live) return;
      setViewing({ ...v, captureId: c.capture_id });
      setVnotes(await notesFor(db, c.capture_id));
      setVtags(await tagsFor(db, c.capture_id));
    })();
    return () => { live = false; };
  }, [viewer, saved]);

  React.useEffect(() => {
    const cleanups: Array<() => void> = [];
    (async () => {
     try {
      await db.init();
      await applyDurabilityProfile(db);
      // Kick the auth session read NOW, in parallel with all the local schema setup
      // below (hadar, 2026-07-27: slow startup). getSession() refreshes an expired
      // access token over the NETWORK, and on a weak jobsite connection that round-trip
      // was the single thing the splash waited on. Starting it here overlaps that
      // latency with work that has to happen anyway, instead of paying for it in series
      // after the schema is built. It is awaited (not applied) below, unchanged.
      const sessionPromise = connector.client.auth.getSession()
        .then((r) => r.data.session ?? null)
        .catch(() => null);
      // PAINT ON THE STORED SESSION, DON'T WAIT FOR THE NETWORK (hadar 2026-08-04:
      // "it takes 30 seconds ... until the home page is displayed", already logged in).
      //
      // The auth gate renders NOTHING while `session === undefined`, and getSession()
      // refreshes an expired token over the network before it resolves. So on a weak
      // connection the entire cold start was one HTTP round-trip that the user could
      // not see, could not skip, and did not need: their data is already on the device.
      //
      // Reading the persisted session costs a single AsyncStorage get. It unblocks the
      // gate immediately; `sessionPromise` still resolves below and applies the fresh
      // one, and supabase-js refreshes the token before any request uses it. A device
      // with nothing stored gets null and falls through to the network path unchanged.
      const stored = await connector.storedSession();
      await ensureAppOwnedSchema(db);
      await ensureDecisionSchema(db);
      await ensureChangeOrderSchema(db);
      // Number the extras that predate the column, oldest first per job. A no-op on
      // every launch after the first.
      await backfillCoNumbers(db);
      for (const s of REJECT_DDL) await db.execute(s);
      await ensureProjectSchema(db, OWNER);
      await ensureResolutionSchema(db);
      await ensureAnnotationSchema(db);
      await ensureTagSchema(db);
      await ensurePartySchema(db);
      // AFTER ensureChangeOrderSchema, and that order is load-bearing: this one
      // ALTERs change_order to add extra_type (R5c), so the table has to exist first.
      await ensureApproverSchema(db);
      await ensureLedgerStatusSchema(db);
      // AFTER ensureChangeOrderSchema for the same reason as the lines above: this
      // ALTERs change_order to add superseded_by, the lineage the thread walks to
      // carry a conversation across a revision (R5b AC2).
      await ensureDiscussionSchema(db);
      // AFTER ensureChangeOrderSchema for the same reason as the lines above: this
      // ALTERs change_order to add parent_ewa_id, so the table has to exist first.
      await ensureEwaSchema(db);
      await ensureActivitySchema(db);
      // AFTER ensureChangeOrderSchema: it seeds its watermark by selecting the
      // already-approved rows, so change_order has to exist and be populated.
      await ensureNotifySchema(db);
      await ensureEventLogSchema(db);
      await ensureRemindSchema(db);
      // R1: the draft session store. A SEPARATE directory from capture-tmp, which
      // recoverySweep empties unconditionally — draft media must survive that sweep,
      // so it never lives there.
      await ensureDraftSchema(db);
      // A SEPARATE sweep over a SEPARATE directory. recoverySweep empties capture-tmp
      // unconditionally, so draft media never lives there. Everything this sweep does
      // is in the direction of KEEPING bytes: adopt a file with no row, adopt a
      // directory with no draft.
      try {
        await sweepDrafts(db, OWNER);
        setDrafts(await recoverableDrafts(db, OWNER));
      } catch (e) { console.log('[draft] sweep skipped:', String(e)); }

      // REQ-PROC4: "100 offline/online cycles incl. a mid-sync kill -> NO LOSS/DUP."
      //
      // WIRED HERE, BEFORE THE AUTH GATE, AND BEHIND A FLAG. src/harness.ts is the
      // only thing in this repo that MEASURES mandate #1 — "never lose a capture" —
      // and it had zero callers, so the product's central promise had never been
      // tested. A button would have put it behind sign-in; the durability of local
      // capture has nothing to do with being signed in, and requiring an account to
      // test it would be testing the wrong thing.
      //
      // It writes 100 captures, so it is OFF unless explicitly asked for. The drain
      // it is given is the REAL one: offline it fails and the outbox retries, which
      // is exactly the condition under test.
      if (process.env.EXPO_PUBLIC_RUN_DURABILITY_HARNESS === '1') {
        try {
          const hr = await runCycles(db, {
            ownerId: OWNER, projectId: 'p-alder', cycles: 100,
            drain: async () => { await drainOutbox(db, connector.client, OWNER); },
            // Every tenth cycle abandons the drain mid-flight — the mid-sync kill.
            killOn: (i) => i % 10 === 0,
          });
          console.log('[REQ-PROC4]', JSON.stringify(hr));
        } catch (e: any) {
          console.log('[REQ-PROC4] harness threw:', String(e?.message ?? e));
        }
      }

      // The wired loop, end to end, on the device's own SQLite. Separate flag from
      // the durability harness because they answer different questions: that one
      // asks "can a capture be lost", this one asks "do the pieces I wired actually
      // reach each other". Unit tests cannot answer the second — they prove the
      // decisions, not the plumbing, and plumbing is what broke eight times here.
      await ensureDiscardSchema(db);
      await ensureDiscardSyncSchema(db);
      // One-time repairs for verdicts issued under an older world:
      //  - extras parked on 23502 while the server still demanded a price (370
      //    dropped that) get their upload retried;
      //  - upload rows for captures that were later DELETED are removed — a
      //    deliberately discarded capture must never upload afterwards.
      const rd = await redriveParked(db, ['23502']);
      if (rd) console.log('redrive:', rd);
      //  - captures parked on 23503 because their PROJECT had not reached the
      //    server (the project sync lagged/stalled) get freed: the drain now pushes
      //    the project itself and retries, so these can finally land (hadar,
      //    2026-07-25 — nothing had uploaded since the project queue wedged).
      //  - AWAITING_FILING parks are freed too (Codex P1, 2026-08-07). `park()` sets
      //    next_attempt_at_ms to the year 275760, and the drain only SELECTs rows due
      //    now — so the self-heal branch that re-points a filed capture at its job was
      //    UNREACHABLE for exactly the rows it was written for. Freeing them makes them
      //    schedulable again; if the capture is still unfiled the drain simply re-parks
      //    it, which costs one attempt and changes nothing.
      const rdc = await redriveParkedCaptures(db, ['23503', 'AWAITING_FILING']);
      if (rdc) console.log('redrive captures:', rdc);
      //  - captures parked on 23505 are asked about rather than assumed: a duplicate
      //    key on this path means the SERVER ALREADY HAS the capture, so the retry it
      //    was holding is finished, not lost. `reconcileDuplicateParks` confirms
      //    presence with the server before removing anything, and leaves the park
      //    untouched when offline or unsure. Without it a delivered capture reports a
      //    permanent failure on every screen that reads outbox errors, forever
      //    (hadar 2026-08-07: "it keeps showing up").
      try {
        const dup = await reconcileDuplicateParks(db, connector.client);
        if (dup.cleared) console.log('cleared duplicate parks:', JSON.stringify(dup));
      } catch { /* offline: the park is the safe state, leave it */ }
      await db.execute(
        `DELETE FROM capture_outbox WHERE capture_id IN
           (SELECT capture_id FROM capture_discarded)`);
      // One-shot sweep of the test rows my own harness and loop check left on a
      // real handset. Behind its own flag and AFTER ensureDiscardSchema, because
      // it tombstones through capture_discarded rather than forcing a delete
      // past capture_commit's never-delete trigger.
      if (process.env.EXPO_PUBLIC_CLEAN_TEST_DATA === '1') {
        try {
          const c = await cleanupTestData(db);
          console.log('[cleanup]', JSON.stringify(c));
        } catch (e: any) { console.log('[cleanup] failed:', String(e?.message ?? e)); }
      }

      if (process.env.EXPO_PUBLIC_RUN_LOOP_CHECK === '1') {
        try {
          const lr = await runLoopCheck(db, OWNER, 'p-alder');
          console.log('[LOOPCHECK]', JSON.stringify(lr));
        } catch (e: any) {
          console.log('[LOOPCHECK] threw:', String(e?.message ?? e));
        }
      }
      // R6b: who captured / priced / sent, and who it was addressed to.
      await ensureExtraActorSchema(db);
      await ensureConsentSchema(db);
      await ensurePairSchema(db);
      await ensureAugmentSchema(db);
      // R2: the device's own copy of transcripts, so the price read-back keeps
      // working in a basement (mandate #7). Fetching is opportunistic; a miss is an
      // empty, flagged price field, never a blocked screen.
      await ensureVoiceCacheSchema(db);
      await ensureSttSchema(db);
      // BEFORE the first refresh(): listCaptures now excludes discarded captures
      // by subquery, and a missing table there would fail the whole gallery.
      const sl = await savedLang(db);
      // Restore the display language a returning user already chose. Language is now
      // part of the profile form, not a gate, so there's no separate "picked" flag.
      if (sl) { setLang(sl); setLangState(sl); }
      setFirstRun(await isFirstRun(db));
      setHasProfile(await hasProfileFn(db));
      void initFeedback();            // haptics/sound warmup — not needed before paint
      void configureNotifications();  // display handler + Android channel (2026-07-26)

      // THE GATE. If the write connection cannot promise durability we do not
      // arm the recorder at all. Refusing loudly beats saying "saved" and lying.
      const prof = await assertDurabilityProfile(db);
      if (!prof.ok) {
        setGate(prof.writeReport.filter((r: any) => !r.ok).map((r: any) => `${r.name}=${r.got}`).join(', '));
      }

      // Recovery runs before anything else can be recorded.
      // RUN AFTER FIRST PAINT, NOT BEFORE IT (hadar 2026-08-04, measured: this call
      // was 15,486ms of a 15,546ms cold start).
      //
      // Nothing renders from its result — the only consumer is a console.warn — and
      // what it DOES is cleanup plus detection: delete temp scraps, quarantine crash
      // orphans, flag media that no longer matches its commitment. None of that is
      // something a user waits for, and none of it protects anything by happening
      // 15 seconds earlier. Mandate #1 is unaffected: the sweep never destroys
      // evidence (an unproven orphan is quarantined, never deleted), so running it a
      // beat later cannot lose a capture — it can only report one later.
      //
      // Deliberately fire-and-forget, deliberately AFTER setReady below.
      const runRecoverySweep = () => {
        void recoverySweep(db)
          .then((rec) => {
            if (rec.integrityErrors.length) {
              console.warn('captures with unreadable media:', rec.integrityErrors);
            }
          })
          .catch((e) => console.warn('recovery sweep failed', e?.message ?? e));
      };

      // AUTH (replaces the bakeoff hardcoded login). A stored token -> straight to
      // the main screen; no token -> the onboarding/sign-in flow renders. The intro
      // is shown once, so load that flag before deciding what to draw.
      setSeen(await getSeenOnboarding());
      let connected = false;
      const applySession = (s: Session | null) => {
        setSession(s);
        if (s?.user?.id) {
          setOwner(s.user.id);
          // REQ-NOTIF1 — register this device for remote push, best-effort.
          void registerPushToken(connector.client, s.user.id);
          // Billing identity is the COMPANY, not the user — the owner pays and crew
          // inherit it, so the receipt must follow the company. Best-effort and
          // non-blocking: with no RevenueCat key this no-ops and the paywall keeps
          // its "coming soon" state. myCompany() reads synced tables, so it may be
          // null on a cold first run; configureBilling runs again on the next session
          // event once membership has synced down.
          void myCompany(db, s.user.id)
            .then((c) => configureBilling(c?.id ?? null))
            .catch(() => {});
          // connect() is fire-and-forget: offline is the NORMAL case for this
          // product, not an error, and PowerSync retries internally. Once per app
          // run -- a token refresh must not stack another connection.
          if (!connected) {
            connected = true;
            db.connect(connector).catch((e) =>
              console.log('sync will connect when there is signal', e?.message ?? e));
          }
        }
      };
      // THE SESSION MUST NOT GATE FIRST PAINT (hadar 2026-08-04: 30s cold start while
      // already logged in).
      //
      // This used to be `applySession(await sessionPromise)` immediately before
      // setReady(true) — so however long getSession()'s network token refresh took,
      // the splash sat there. Overlapping it with the schema work (2026-07-27) helped
      // only when the refresh was FASTER than the schema; on a weak connection it is
      // not, and the whole launch became one invisible HTTP round-trip.
      //
      // Now: if a session is already on disk, apply THAT and let the refresh land
      // whenever it lands. The user is in immediately with their own local data, which
      // is what mandate #7 requires — the network is opportunistic, never a
      // precondition. With nothing stored we still wait, because a logged-out device
      // genuinely has nothing to show and flashing sign-in at a returning user is the
      // failure this gate was built to prevent.
      if (stored) {
        applySession(stored);
        void sessionPromise.then((fresh) => { if (fresh) applySession(fresh); });
      } else {
        applySession(await sessionPromise);
      }
      // Keep session + sync in step on later sign-in / sign-out. Skip INITIAL_SESSION:
      // getSession above already applied the startup state.
      const { data: authSub } = connector.client.auth.onAuthStateChange((event, s) => {
        if (event === 'INITIAL_SESSION') return;
        applySession(s);
      });
      cleanups.push(() => authSub.subscription.unsubscribe());
      // NOTE: no `await refresh()` here on purpose (hadar, 2026-07-27: "why is startup
      // so slow"). refresh() runs ~15 queries; blocking first paint on it made the
      // splash sit there. The effect at the top — `if (ready) void refresh()` — fires
      // it the instant setReady flips, so the home shell paints immediately and its
      // content fills a beat later instead of gating the whole launch.
      setReady(true);
      // The shell is on screen; now do the housekeeping.
      runRecoverySweep();

      // Drain the outbox. Runs on a timer, not on a network event, because
      // "online" is a lie you find out about by trying. Offline is the normal
      // case: drainOutbox simply fails transiently and backs off.
      const drain = async () => {
        try {
          const { data } = await connector.client.auth.getUser();
          if (!data?.user) return;             // not signed in -> nothing to do
          // THE CURRENT project, read fresh each tick. This interval is created ONCE
          // (refresh is a stable useCallback), so the closed-over `projectId` is frozen
          // at INBOX_ID from mount — using it made every hydrate/notify query the Inbox
          // forever, so approvals + questions for the OPEN job never landed (Codex P1,
          // 2026-07-26). The ref tracks the live project; use it, never the closure.
          const pid = projectIdRef.current;
          const r = await drainOutbox(db, connector.client, data.user.id);
          if (r.attempted) console.log('drain captures:', JSON.stringify(r));
          // Decisions drain on the same tick but through their own queue. They are
          // NOT chained to the capture drain: a decision must not wait on a blob,
          // and a stuck photo must never hold back the record of what was decided.
          const dr = await drainDecisionOutbox(db, connector.client, data.user.id);
          if (dr.attempted) console.log('drain decisions:', JSON.stringify(dr));
          const nr = await drainNoteOutbox(db, connector.client, data.user.id);
          const sr = await drainScopeOutbox(db, connector.client, data.user.id);
          const tg = await drainTagOutbox(db, connector.client, data.user.id);
          if (sr.attempted) console.log('drain scope:', JSON.stringify(sr));
          if (nr.attempted) console.log('drain notes:', JSON.stringify(nr));
          if (tg.attempted) console.log('drain tags:', JSON.stringify(tg));
          const cr = await drainChangeOrderOutbox(db, connector.client, data.user.id);
          if (cr.attempted) console.log('drain change orders:', JSON.stringify(cr));
          // R5c: roster additions, retirements, recency and extra-type changes. This
          // was WRITTEN AND NOT WIRED -- rows were enqueued atomically and then sat on
          // the device forever, so a second phone saw an empty roster and the type the
          // contractor picked never left the handset. An outbox nothing drains is a
          // queue that looks like sync.
          const ar = await drainR5cOutbox(db, connector.client, data.user.id);
          if (ar.attempted) console.log('drain r5c:', JSON.stringify(ar));
          // BEFORE the hydrate below, deliberately: a supersession the server has not
          // accepted yet is a local intent hydrateChangeOrders cannot see.
          const sx = await drainSupersessions(db, connector.client);
          if (sx.attempted) console.log('drain supersessions:', JSON.stringify(sx));
          // R5b. The PULL is the half that did not exist: without it a question the
          // client asked is stored server-side and invisible to the contractor
          // forever. The drain carries his replies back out.
          const br = await drainR5bOutbox(db, connector.client, data.user.id);
          if (br.attempted) console.log('drain r5b:', JSON.stringify(br));
          const er = await drainEwaOutbox(db, connector.client, data.user.id);
          if (er.attempted) console.log('drain ewa:', JSON.stringify(er));
          const pt = await pullThreads(db, connector.client, pid);
          if (pt.pulled || pt.revisions) { console.log('threads:', JSON.stringify(pt)); await refresh(); }
          // R6b actor facts. Same reason as the roster: a fact that only ever lives
          // on the phone that wrote it is lost with that phone, and "who recorded
          // this" is exactly what gets asked once the phone is gone.
          const aa = await drainExtraActorOutbox(db, connector.client, data.user.id);
          if (aa.attempted) console.log('drain actors:', JSON.stringify(aa));
          // Pull anything this device does not have: a reinstall, a second phone,
          // or a CO authored before the device became the author.
          // Tie walkthrough photos to the sentences spoken over them, once the
          // transcript (with segments) has landed server-side. Idempotent per pair.
          try { await runAutoTags(db, connector.client); } catch { /* offline is normal */ }
          // The late-proposal sweep that used to live here is gone (394): the server
          // applies a write-up the moment it exists, so there is nothing for the app to
          // catch up on except the hydrate below, which learns it.
          const hy = await hydrateChangeOrders(db, connector.client, pid, data.user.id);
          // MUST follow the hydrate. hydrateChangeOrders adopts the server's status for
          // any row with no change_order_outbox entry; a supersession queues in
          // co_supersession, a DIFFERENT table, so an un-uploaded revision would be
          // walked back to 'sent' and the retired extra would reappear as live.
          await reassertSupersessions(db);
          const qz = await hydrateQuestions(db, connector.client, pid);
          // `hy.conflicts` IS IN THE CONDITION, and it was the whole point of
          // counting them: a tick whose only outcome is a refused status printed
          // nothing at all here, so a permanent phone-vs-cloud disagreement about a
          // signed document produced zero output at App level. The per-row line is
          // in the flight recorder (changeorder.ts); this is the count.
          if (hy.pulled || hy.statusUpdated || hy.conflicts || qz.pulled) {
            console.log('hydrate:', JSON.stringify({ ...hy, questions: qz.pulled }));
            await refresh();
          }
          if (r.uploaded || r.alreadyApplied || r.parked ||
              dr.uploaded || dr.alreadyApplied || dr.parked ||
              cr.uploaded || cr.alreadyApplied || cr.parked) await refresh();
          // LAST, and after both the thread pull and the status hydrate: there is
          // nothing to announce until the question and the green light are local.
          // Reads permission, never requests it — the request dialog blocks.
          // Uploads what the phone recognised offline. 368 is the only path an
          // app has into capture_transcript; 150 revoked the direct INSERT.
          const st = await drainSttOutbox(db, connector.client);
          if (st.attempted) console.log('drain stt:', JSON.stringify(st));
          // The cloud half of delete: locally tombstoned captures the server
          // has not yet confirmed. hadar: "all of the items are being deleted
          // with it" — this is what makes that true past the handset.
          const sd = await drainServerDiscards(db, connector.client);
          if (sd.attempted) console.log('drain discards:', JSON.stringify(sd));
          // The change_order half of delete: drop the SERVER's own row for extras
          // deleted while offline, so a reinstall or a second phone cannot re-pull a
          // ghost. hydrate already skips these locally; this makes it true past the
          // handset (hadar, 2026-07-28: delete "doesn't delete the extra").
          const dx = await drainDiscardedExtras(db, connector.client);
          if (dx.attempted) console.log('drain discarded extras:', JSON.stringify(dx));
          const nt = await runNotifications(db, pid);
          if (nt.presented || nt.blocked) console.log('notify:', JSON.stringify(nt));
        } catch (e: any) {
          // Offline IS normal — but "offline" and "a bug five drains into the
          // tick" looked identical here, and that identity cost four diagnosis
          // rounds today: the tick died mid-list and everything after the
          // corpse silently never ran, while everything before it worked. The
          // reason now lands in the flight recorder. Reading diag_log tells you
          // which; a bare catch never could.
          void logDiag(db, 'tick.error', String(e?.message ?? e).slice(0, 200));
        }
      };
      drain();
      const iv = setInterval(drain, 15_000);
      cleanups.push(() => clearInterval(iv));
     } catch (e: any) {
       // A failure here means we cannot promise a save. Say so, loudly, with the
       // reason -- never sit on "Starting..." forever. Silent init failure is the
       // same sin as a silent save failure.
       console.log('INIT FAILED:', e?.message ?? String(e), e?.stack);
       setInitError(e?.message ?? String(e));
       setReady(true);
     }
    })();
    return () => cleanups.forEach((c) => c());
  }, [refresh]);

  const onPress = async () => {
    if (gate) return;
    if (ui.k === 'idle' || ui.k === 'saved' || ui.k === 'refused') {
      setUi({ k: 'arming' });
      // PERSONAL-USE MODEL: recording consent is a ONE-TIME Terms acceptance, not a
      // per-job prompt. If the Terms are not yet accepted, open the acceptance screen
      // (once, ever) instead of arming; after I ACCEPT the user taps record again and
      // this gate passes. Mandate #2 is still honoured -- a human explicitly accepts.
      if (!terms) { setUi({ k: 'idle' }); openTerms(); return; }
      // REQ-CON1: the answer is ALREADY KNOWN -- decided once at Terms acceptance.
      // This is a LOOKUP, never a prompt. A consent dialog between a man's thumb and
      // the thing he is trying to record is the #1 predicted abandonment point, and it
      // is the one thing this path may never do. Checked BEFORE the mic opens: we must
      // never record first and ask later, because by then the recording exists.
      const may = await canRecordAudio(db, projectId);
      if (!may.allowed) { setUi({ k: 'refused', why: may.why }); return; }
      if (!(await requestMic())) { setUi({ k: 'refused', why: 'microphone permission denied' }); return; }
      await recorder.prepareToRecordAsync();
      recorder.record();
      setUi({ k: 'recording' });
      // AFTER the recorder is running, never before, and not awaited into it.
      // The live line is an indicator; the recording is the evidence. If iOS
      // refuses a second listener on the input, startLive returns null, the
      // contractor sees no moving text, and the capture is entirely unaffected.
      setLive('');
      startLive(db, (t) => setLive(t))
        .then((h) => { liveRef.current = h; })
        .catch(() => { /* indicator only */ });
      return;
    }
    if (ui.k === 'recording') {
      setUi({ k: 'saving' });
      // Stop listening BEFORE stopping the recorder: the recogniser must not be
      // holding the input when expo-audio finalises the file.
      try { liveRef.current?.stop(); } catch { /* already stopped */ }
      liveRef.current = null;
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) { setUi({ k: 'refused', why: 'recorder produced no file' }); return; }

      const bytes = await readRecordingBytes(uri);
      // These were STRING LITERALS ('owner-local', 'proj-bakeoff-1'), so the
      // rename of the PROJECT_ID constant walked straight past them: the voice
      // path -- the product's primary modality -- filed every recording to a dead
      // project and never resolved by GPS at all. Found by checking my own claim
      // that the constant was gone instead of trusting it.
      const stamp = await stampNow();
      const res = await resolveFor(stamp);
      const r = await performCapture(db, {
        ownerId: OWNER, projectId: res.projectId,
        input: voiceCapture(bytes), stamp,
      });
      if (r.ok) {
        setUi({ k: 'saved', id: r.captureId });
        // AFTER the capture is durable, never before, and it cannot throw: mandate #1
        // — bookkeeping never delays or endangers a capture.
        await noteCapturedBy(db, r.captureId);
        // R2 on device, under the SAME rule as the line above: after the capture
        // is durable, and it cannot throw. Recognition is a convenience; the
        // recording is the evidence and nothing here may endanger it.
        //
        // Deliberately NOT awaited into the UI path. The contractor sees "saved"
        // the instant it is saved — recognition takes seconds and mandate #3's
        // touch budget does not have seconds to spare. The transcript lands when
        // it lands, and refresh() picks it up.
        // THE RECORDING IS THE EXTRA. hadar: "the user records a change order (a
        // message) and snap some pictures that become a extra". It exists in the
        // ledger from this moment — priceless, untitled, unsendable — rather than
        // waiting for a review screen he never asked for and a Price-it step that
        // asks him to do what R2 promises the app will do.
        //
        // AFTER durability and NOT awaited, same rule as noteCapturedBy above:
        // if this fails he has lost a ledger row, never his evidence.
        void startExtraFromCapture(db, {
          captureId: r.captureId, projectId: res.projectId, ownerId: OWNER,
        }).then(async (x) => {
          if (!x.ok) { console.log('startExtra failed:', x.reason); return; }
          await refresh();
          // FLOW: the questions come next, unprompted. The extra is already
          // durable — this only opens the finishing card over it.
          await finishExtraById(x.changeOrderId);
        }).catch(() => { /* the capture is safe; the ledger row is not owed */ });

        void transcribeOnDevice(db, r.captureId, uri)
          .then(async (t) => {
            if (!t.ok) return;
            // A TITLE FROM HIS OWN WORDS, never invented. The first sentence of
            // what he said is the closest thing to a title that exists before
            // the LLM step runs, and it is his language rather than the app's.
            // titleExtraIfUntitled writes only over the placeholder and only on
            // a draft, so it can never overwrite something he typed or something
            // a client has already been shown.
            const said = await db.getAll<{ text: string }>(
              `SELECT text FROM voice_transcript_cache WHERE capture_id = ?`, [r.captureId]);
            const first = (said[0]?.text ?? '').split(/(?<=[.!?])\s/)[0]?.trim();
            if (first) await titleExtraIfUntitled(db, `co-${r.captureId}`, first);
            await refresh();
          })
          .catch(() => { /* the worker's cloud path still covers this capture */ });
        if (res.confidence !== 'high') setFiled(res.why);
      } else setUi({ k: 'refused', why: r.reason });
      await refresh();
    }
  };

  /**
   * REQ-CAP2 photo. Same commit path, same durability gate, new producer --
   * capture.ts did not change to accommodate it.
   *
   * The GPS fix STARTS WITH THE CAMERA and is awaited after the shutter. The user
   * spends a second or two framing the shot; the fix costs nothing because it
   * happens in that time instead of after it. Mandate #3's touch budget is a hard
   * constraint, and "wait 3 seconds for a satellite" would have spent it.
   */
  /**
   * MANDATE #8: the capture goes where the GPS says, not where the screen says.
   *
   * The visible job is what the contractor is LOOKING at; the fix is where he is
   * STANDING. Those differ constantly -- he opened the app on yesterday's job in
   * the truck and is now in a different kitchen. Filing by the screen would
   * silently mis-file, and a wrong filing is the failure nobody goes looking for.
   * Resolution decides; the screen never does.
   */
  const resolveFor = async (stamp: { lat: number | null; lng: number | null }) => {
    const fix = stamp.lat != null && stamp.lng != null
      ? { lat: stamp.lat, lng: stamp.lng } : null;
    const r = await resolveProject(db, fix);
    if (r.projectId !== INBOX_ID) await touchProject(db, r.projectId);
    // REQ-P5: the capture is ALREADY SAVED by the time this shows. The proposal is
    // an offer, not a gate — mandate #1 says nothing blocks a capture, and mandate
    // #2 says a project is never auto-created. Both hold: it saved to the Inbox,
    // and he can accept the job or ignore it.
    if (r.proposeNew) setProposal(r.proposeNew);
    return r;
  };

  /**
   * Turn a fix into WORDS for the capture stamp. A coordinate pair is unreadable to the
   * person holding the phone and worthless to a client reading the photo later, so the
   * stamp never prints one: it shows the street address (best evidence), falling back to
   * the job we resolved to, and stays honestly empty when neither is available offline.
   */
  const resolveStampLabel = React.useCallback(async (st: Stamp) => {
    let job: string | null = null;
    let place: string | null = null;
    try {
      if (st.lat != null && st.lng != null) {
        const r = await resolveProject(db, { lat: st.lat, lng: st.lng });
        if (r.projectId !== INBOX_ID) {
          job = (await listProjects(db)).find((p) => p.id === r.projectId)?.name ?? null;
        }
        place = await addressFor(st.lat, st.lng);   // network; null when offline
      }
    } catch { /* leave both null — the stamp then says so plainly */ }
    return { place: place ?? job, job };
  }, []);

  // REQ-CAP-FUSED (walkthrough): commit N photos + ONE voice narration as one decision
  // moment. Every capture shares a pair_id; "saved" fires ONLY after ALL of them commit
  // (mandate #1). A partial group (some photos in, voice failed) is surfaced honestly,
  // never a silent "saved". Each photo carries its OWN snap time; the voice spans the walk.
  // REQ-CAP-FUSED, walkthrough commit. Order is mandate #1's: COMMIT DURABLY FIRST —
  // to the resolved job when GPS is sure, to the Inbox when it is not — and only THEN
  // ask the human where it belongs. Holding bytes in memory while a sheet waits for a
  // tap is how a phone call destroys a walkthrough.
  const onFusedCapture = async (a: FusedArtifacts) => {
    // DO NOT close the capture screen here. It shows its own "saving" state while
    // this runs; closing it now drops to Home for the ~1–2s commit before the job
    // sheet is ready — the flash hadar saw (2026-07-25). The job sheet (assign) is
    // checked BEFORE showCapture in the render, so it takes over the instant it is
    // set; showCapture is cleared in the finally as cleanup, causing no flash.
    setUi({ k: 'saving' });
    try {
      const res = await resolveFor(a.stamp);
      const pairId = `pair-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const ids: string[] = [];
      for (const ph of a.photos) {
        const pr = await performCapture(db, {
          ownerId: OWNER, projectId: res.projectId,
          input: photoCapture(ph.bytes, ph.mime),
          stamp: { ...a.stamp, capturedAtMs: ph.atMs },   // each photo's own snap time
        });
        if (!pr.ok) { setUi({ k: 'refused', why: pr.reason }); return; }
        await linkPair(db, pairId, pr.captureId, 'photo', ph.atMs);
        await noteCapturedBy(db, pr.captureId);
        ids.push(pr.captureId);
      }
      // The narration, possibly split by a phone call: every segment commits, in order.
      // A failed later segment refuses loudly but never un-saves the earlier ones.
      for (const seg of a.audioSegments) {
        const vr = await performCapture(db, {
          ownerId: OWNER, projectId: res.projectId,
          input: voiceCapture(seg.bytes, seg.mime),
          stamp: { ...a.stamp, capturedAtMs: seg.startedAtMs },
        });
        if (!vr.ok) { setUi({ k: 'refused', why: `some saved; audio did not: ${vr.reason}` }); return; }
        await linkPair(db, pairId, vr.captureId, 'voice', seg.startedAtMs);
        await noteCapturedBy(db, vr.captureId);
        ids.push(vr.captureId);
      }
      if (!ids.length) { setUi({ k: 'refused', why: 'nothing to save' }); return; }
      setUi({ k: 'saved', id: ids[0] });

      // THE RECORDING IS THE EXTRA — on THIS path too. All of this was wired
      // into the legacy voice-only button while Snap+Talk, the screen people
      // actually record with, committed captures and stopped. hadar's list from
      // using the real device: no transcription, no processing indication, no
      // photos on the record. One cause: the fused path never entered the new
      // model. Keyed on the FIRST VOICE capture so the pair walk reaches every
      // photo; a photos-only session keys on the first photo and simply has no
      // transcript to wait for.
      //
      // AFTER durability, never awaited into the UI path — the same two rules
      // as the voice-only path, for the same reasons.
      const anchorId = a.audioSegments.length ? ids[a.photos.length] : ids[0];
      void startExtraFromCapture(db, {
        captureId: anchorId, projectId: res.projectId, ownerId: OWNER,
      }).then(async (x) => {
        if (!x.ok) { console.log('startExtra (fused) failed:', x.reason); return; }
        await refresh();
      }).catch(() => { /* capture is safe; the ledger row is not owed */ });

      if (a.audioSegments.length) {
        void (async () => {
          // transcribeOnDevice wants the stored file, not the in-memory bytes:
          // the committed copy is the evidence, so it is the thing transcribed.
          const row = await db.getAll<{ media_relpath: string }>(
            `SELECT media_relpath FROM capture_commit WHERE capture_id = ?`, [anchorId]);
          if (!row.length) return;
          const t = await transcribeOnDevice(db, anchorId,
            `${FS.documentDirectory}${row[0].media_relpath}`);
          if (!t.ok) return;
          const said = await db.getAll<{ text: string }>(
            `SELECT text FROM voice_transcript_cache WHERE capture_id = ?`, [anchorId]);
          const first = (said[0]?.text ?? '').split(/(?<=[.!?])\s/)[0]?.trim();
          if (first) await titleExtraIfUntitled(db, `co-${anchorId}`, first);
          await refresh();
        })().catch(() => { /* the worker's cloud path still covers it */ });
      }
      // JOB SELECTION FIRST (hadar, 2026-07-24): the sheet opens the instant the
      // recording is saved — before any upload/processing screen — so the human
      // always picks the job, and nothing is uploaded/processed to a guessed job
      // first. Filing it (fileAll) then starts the processing transition. The job
      // is ALWAYS picked by a human (mandate #8 — GPS only pre-sorts the list).
      const anchorCapId = a.audioSegments.length ? ids[a.photos.length] : null;
      setAssign({
        ids, lat: a.stamp.lat, lng: a.stamp.lng,
        uris: a.previewUris, secs: a.durationSecs,
        anchorCoId: anchorCapId ? `co-${anchorCapId}` : `co-${ids[0]}`,
        anchorCaptureId: anchorCapId,
      });
    } catch (e: any) {
      setUi({ k: 'refused', why: e?.message ?? String(e) });
    } finally {
      // Cleanup only — the job sheet (or a refusal) already owns the screen by now,
      // so this never shows Home. Kept out of the top so the capture screen stays up
      // through the commit.
      setShowCapture(false);
      await refresh();
    }
  };

  // AUGMENT an existing extra with more photos/voice (hadar, 2026-07-25). Same
  // capture machinery as onFusedCapture, but the captures attach to THIS extra's
  // pair instead of minting a new decision/CO — and the priced scope, the amount
  // and any signed instrument are left untouched (chosen behaviour: append as
  // evidence). A history note records the addition. No job pick (it inherits the
  // extra's project), no step-3, no processing transition: it appends and returns.
  const onAugmentCapture = async (coId: string, a: FusedArtifacts) => {
    // Keep the capture screen up through the commit (it shows its own "saving"); the
    // augment transition takes over when set — no drop to Home (hadar 2026-07-25).
    // showCapture + augmentCoId are cleared in the finally as cleanup.
    setUi({ k: 'saving' });
    const newIds: string[] = [];
    try {
      const co = (await db.getAll<{ decision_id: string; project_id: string }>(
        `SELECT decision_id, project_id FROM change_order WHERE id = ?`, [coId]))[0];
      if (!co) { setUi({ k: 'refused', why: 'that extra is no longer here' }); return; }

      // Reach the extra's captures, then their pair. New captures join THAT pair so
      // the photo walk (CO_PHOTO_SUBQUERY) reaches them. If the anchor was never
      // paired (a voice-only extra), mint a pair and pull the anchor in first.
      const anchors = await db.getAll<{ capture_id: string; modality: string | null }>(
        `SELECT dv.capture_id, cc.modality FROM decision_version dv
           LEFT JOIN capture_commit cc ON cc.capture_id = dv.capture_id
          WHERE dv.decision_id = ? AND dv.capture_id IS NOT NULL`, [co.decision_id]);
      let pairId: string | null = null;
      if (anchors.length) {
        const marks = anchors.map(() => '?').join(',');
        pairId = (await db.getAll<{ pair_id: string }>(
          `SELECT pair_id FROM capture_pair WHERE capture_id IN (${marks}) LIMIT 1`,
          anchors.map((x) => x.capture_id)))[0]?.pair_id ?? null;
      }
      if (!pairId) {
        pairId = `pair-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        for (const an of anchors) {
          await linkPair(db, pairId, an.capture_id, an.modality === 'photo' ? 'photo' : 'voice', Date.now());
        }
      }

      let photoN = 0, voiceN = 0;
      for (const ph of a.photos) {
        const pr = await performCapture(db, {
          ownerId: OWNER, projectId: co.project_id,
          input: photoCapture(ph.bytes, ph.mime),
          stamp: { ...a.stamp, capturedAtMs: ph.atMs },
        });
        if (!pr.ok) { setUi({ k: 'refused', why: pr.reason }); return; }
        await linkPair(db, pairId, pr.captureId, 'photo', ph.atMs);
        await noteCapturedBy(db, pr.captureId);
        newIds.push(pr.captureId);
        photoN++;
      }
      const voiceIds: string[] = [];
      for (const seg of a.audioSegments) {
        const vr = await performCapture(db, {
          ownerId: OWNER, projectId: co.project_id,
          input: voiceCapture(seg.bytes, seg.mime),
          stamp: { ...a.stamp, capturedAtMs: seg.startedAtMs },
        });
        if (!vr.ok) { setUi({ k: 'refused', why: `some saved; audio did not: ${vr.reason}` }); return; }
        await linkPair(db, pairId, vr.captureId, 'voice', seg.startedAtMs);
        await noteCapturedBy(db, vr.captureId);
        newIds.push(vr.captureId);
        voiceIds.push(vr.captureId);
        voiceN++;
      }
      if (!photoN && !voiceN) { setUi({ k: 'refused', why: 'nothing to save' }); return; }

      // The note in the history — explicit, not inferred from a timestamp margin.
      const prof = await getProfile(db);
      const now = Date.now();
      if (photoN) await noteAugment(db, { changeOrderId: coId, kind: 'photo', n: photoN, atMs: now, byName: prof?.name ?? null });
      if (voiceN) await noteAugment(db, { changeOrderId: coId, kind: 'voice', n: voiceN, atMs: now, byName: prof?.name ?? null });
      setUi({ k: 'saved', id: coId });
      await refresh();

      // Transcribe each added voice on device — the SAME rule as a new capture: AFTER
      // durability, never awaited into the UI path (mandate #3's touch budget), and it
      // cannot un-save anything. This is what the transition's `tr` gate below waits on,
      // and what finishAugmentById falls back to when the AI is not confident.
      for (const vid of voiceIds) {
        void (async () => {
          const row = await db.getAll<{ media_relpath: string }>(
            `SELECT media_relpath FROM capture_commit WHERE capture_id = ?`, [vid]);
          if (!row.length) return;
          await transcribeOnDevice(db, vid, `${FS.documentDirectory}${row[0].media_relpath}`);
          await refresh();
        })().catch(() => { /* the worker's cloud path still covers this capture */ });
      }

      // The upload-processing screen for an EDIT (hadar 2026-07-25: "to the
      // notification upload processing screen if it's an edit"). When the edit added a
      // voice, the transition now waits for it to upload, transcribe and be analysed —
      // exactly like a new extra — and finishAugmentById then grows the Description
      // (hadar 2026-07-27). Anchor on the first added voice so the poller has a capture
      // to watch; a photos-only edit has no anchor and stays upload-only.
      const augAnchor = voiceIds[0] ?? null;
      setTransition({
        ids: newIds, anchorCaptureId: augAnchor, coId,
        uploaded: false, transcribed: augAnchor === null, analyzed: false, offline: false,
        stalled: false, uploadDone: 0, uploadTotal: newIds.length, lastError: null,
        blocked: false, isAugment: true,
      });
    } catch (e: any) {
      setUi({ k: 'refused', why: e?.message ?? String(e) });
    } finally {
      // Cleanup only — the transition (or a refusal) already owns the screen.
      setShowCapture(false); setAugmentCoId(null);
    }
  };

  const onMedia = async (produce: () => Promise<any>, label: string) => {
    if (gate) return;
    // MANDATE #9's permission, asked HERE and not on cold start: the user has just
    // tapped PHOTO, so "why do you want my location" answers itself. A sheet on
    // launch, before the app has done anything, is how you get denied by someone
    // for whom software is not second nature -- and a denial is sticky.
    // Not gated on the answer: a refused location must never block a capture.
    await ensureLocationPermission();
    const fix = stampNow();          // starts NOW, awaited below. Not blocking.
    const picked = await produce();
    if (!picked.ok) {
      if (picked.reason === 'cancelled') { void fix; return; }   // no capture, no noise
      setUi({ k: 'refused', why: picked.reason === 'denied'
        ? `${label} needs permission — enable it in Settings`
        : picked.detail ?? 'could not read that file' });
      return;
    }
    setUi({ k: 'saving' });
    try {
      const stamp = await fix;
      const res = await resolveFor(stamp);
      const r = await performCapture(db, {
        ownerId: OWNER, projectId: res.projectId, input: picked.input, stamp,
      });
      if (r.ok && res.confidence !== 'high') {
        // REQ-PROC6/P2: say where it went and why, in words. Silence here is how a
        // capture ends up somewhere nobody looks.
        setFiled(res.why);
      }
      if (r.ok) { setUi({ k: 'saved', id: r.captureId }); await noteCapturedBy(db, r.captureId); }
      else setUi({ k: 'refused', why: r.reason });
    } catch (e: any) {
      setUi({ k: 'refused', why: e?.message ?? String(e) });
    }
    await refresh();
  };

  // REQ-CAP2 text capture. Same commit path, different producer.
  const onSaveNote = async () => {
    if (gate || !note.trim()) return;
    setUi({ k: 'saving' });
    try {
      const stamp = await stampNow();
      const res = await resolveFor(stamp);
      const r = await performCapture(db, {
        ownerId: OWNER, projectId: res.projectId, input: textCapture(note), stamp,
      });
      if (r.ok && res.confidence !== 'high') setFiled(res.why);
      if (r.ok) {
        setUi({ k: 'saved', id: r.captureId });
        await noteCapturedBy(db, r.captureId);
        // Capture is SAVED already. The card is about what it MEANS, and it can
        // be dismissed without losing anything -- the evidence is committed.
        const inf = inferDecision(note);
        setCard({ captureId: r.captureId, subject: inf.subject, value: inf.value,
                  directedBy: 'Owner', scope: inf.scope });
        setNote('');
      } else setUi({ k: 'refused', why: r.reason });
      await refresh();
    } catch (e: any) {
      setUi({ k: 'refused', why: e?.message ?? String(e) });
    }
  };

  // REQ-CAP1 — one-action start: ONE large primary control, and the first tap
  // records. No mode, no menu, no confirm. Built from the beginning; tagged now
  // because an untagged requirement reads as an unbuilt one (see REQ-PROC2).
  const label =
    gate ? T('rec.unavailable') :
    ui.k === 'recording' ? T('rec.stop') :
    ui.k === 'saving' ? T('rec.saving') :
    ui.k === 'arming' ? '…' : T('rec.record');

  // A signature gets the whole screen. Nothing else is reachable while it is up --
  // one deliberate act, no way to wander off halfway through signing.
  // REQ-CON1/SET2. Shown when the JOB has no recording decision -- reached from the
  // banner, never from the record button. The strict default is pre-selected so the
  // common case is one tap, which is what "≤ a few actions" has to mean for someone
  // who does not think in software.
  // REQ-SET1: create a job, in the field, in ≤ a few actions. Address optional --
  // a name is enough to start, and demanding a full address from a man standing in
  // the room is how you get "asdf".
  /**
   * REQ-P2: the secondary workflow. "Never lost, never silently mis-filed;
   * resolves in ≤1 action."
   *
   * One tap per capture: pick the job, it is filed. No confirm step -- filing is
   * reversible (the override can be changed) and it is the LOW-stakes end of this
   * product. Mandate #2's confirm-don't-automate is about price and commitment;
   * spending a tap to confirm where a photo goes would be ceremony, and ceremony
   * is what stops people clearing a queue at all.
   */
  /**
   * REQ-EVID1: the capture, standing on its own. What was recorded, when, where,
   * and whether the bytes are still the bytes -- with no handler applied and
   * nothing interpreted. This is the screen an inspector or a peer would be shown.
   * REQ-CAP3 lives here too: a note about any capture, of any modality.
   */
  // REQ-GAL2 — full-screen swipe viewer. A horizontal pager across this project's
  // captures; the current page's evidence (verified hash, notes) loads beneath it.
  // THE CONFIRMATION TAKES THE SCREEN, like every other overlay here (viewer,
  // thread, record). It was first written as a card further down the page, which
  // meant tapping Delete set state and put the confirmation somewhere below the
  // fold — the user saw nothing happen. A destructive confirmation that can be
  // scrolled past is not a confirmation.
  // DELETE, as a drawer over whatever screen you were on (hadar, 2026-07-31).
  //
  // It used to be a full screen that scrolled, and on a 13 mini the confirm button
  // had been pushed past the bottom edge — rendered, enabled, unreachable. A drawer
  // is measured from the bottom, so the button is always under the thumb.
  //
  // NOT an early return any more: falling through lets the sheet sit OVER the list
  // it was opened from, which is what makes it read as a confirmation rather than a
  // place you navigated to. `onDelete` already closed the record, so the screen
  // underneath is the honest one to return to if you cancel.
  const discardSheet = discard ? (
    <ConfirmSheet
      visible
      title={T('discard.title')}
      // The CONSEQUENCE, specific to this row: what goes, what stays, and — when the
      // row has already left the phone — why it cannot go at all.
      body={!discard.plan.allowed
        ? T(discard.plan.reason === 'has_link' ? 'discard.hasLink' : 'discard.alreadySent')
        : [T(discardSummary(discard.plan)!),
           discard.plan.needsServer.length > 0 ? T('discard.serverNote') : null]
            .filter(Boolean).join(' ')}
      confirmLabel={T('discard.yes')}
      cancelLabel={T('common.cancel')}
      busy={!discard.plan.allowed}
      onClose={() => setDiscard(null)}
      onConfirm={async () => {
        // discardExtra re-plans from scratch: the extra can be sent between this
        // sheet opening and the thumb landing.
        // WRAPPED, because it once was not: discardCapture threw on a bad column and
        // the exception went nowhere — nothing deleted, sheet just sitting there. A
        // destructive action that fails MUST say so.
        try {
          const r = discard.captureId
            ? await discardCapture(db, discard.captureId)
            : await discardExtra(db, discard.co.id, connector.client);
          setDiscard(null);
          if (!r.ok) {
            setFiled(T('discard.alreadySent'));
          } else {
            // Land on Home: the record was already closed, so there is nothing to
            // return to — Home is the honest destination for a thing that no longer
            // exists (hadar, 2026-07-27).
            setNav('home'); setJobFilter(null);
          }
          await refresh();
        } catch (e: any) {
          setDiscard(null);
          setFiled(`Delete failed: ${String(e?.message ?? e).slice(0, 90)}`);
        }
      }}
    />
  ) : null;


  if (viewer) {
    const W = Dimensions.get('window').width;
    const v = viewing;                 // evidence for the current page
    const cur = saved[viewer.index];   // the row being viewed
    const close = () => { stopPlayback(); setPlaying(false); setViewer(null); setViewing(null); };
    return (
      <View style={{ flex: 1, backgroundColor: '#f6f8fa' }}>
        <View style={[s.detailHead, { paddingTop: 60, paddingHorizontal: 20 }]}>
          <Pressable style={s.backBtn} onPress={close}>
            <Text style={s.backT}>‹ {T('common.close')}</Text>
          </Pressable>
          <Text style={s.jobBarS}>{viewer.index + 1} / {saved.length}</Text>
          {/* DELETE FROM THE GALLERY. A walkthrough that never became an extra
              is not in the ledger, so it had no delete anywhere at all — hadar:
              "i have walkthough that i cannt delete". This is the one screen
              where every capture is reachable, extra or not.

              It opens the same confirmation as everything else, and
              discardCapture takes the whole pair group, so deleting one frame of
              a walkthrough takes the recording and its photos together rather
              than leaving orphans. */}
          <Pressable
            onPress={() => {
              const cap = saved[viewer.index];
              if (!cap) return;
              setViewer(null);
              setDiscard({
                co: { id: `co-${cap.capture_id}`, scope: T('discard.thisRecording') } as any,
                plan: { allowed: true, deleteCaptures: [cap.capture_id],
                        keepCaptures: [], needsServer: [] },
                captureId: cap.capture_id,
              });
            }}
            hitSlop={10}
            accessibilityLabel={T('discard.action')}>
            <Text style={{ color: '#cf222e', fontSize: 15 }}>{T('discard.action')}</Text>
          </Pressable>
        </View>

        {/* Swipe = paging. Photos pinch-zoom via a nested zoomable ScrollView
            (native on iOS; Android degrades to no-zoom, still swipes). Media renders
            from local media_relpath; the integrity verdict comes from `viewing`. */}
        <ScrollView
          ref={pagerRef}
          horizontal pagingEnabled showsHorizontalScrollIndicator={false}
          onLayout={() => pagerRef.current?.scrollTo({ x: viewer.index * W, animated: false })}
          onMomentumScrollEnd={(e) => {
            const i = Math.round(e.nativeEvent.contentOffset.x / W);
            if (i !== viewer.index && saved[i]) setViewer({ index: i });
          }}
          style={{ maxHeight: 300, flexGrow: 0 }}>
          {saved.map((c) => (
            <View key={c.capture_id} style={{ width: W, height: 300, alignItems: 'center', justifyContent: 'center' }}>
              {c.modality === 'photo' ? (
                <ScrollView maximumZoomScale={4} minimumZoomScale={1}
                  contentContainerStyle={{ width: W, height: 300, alignItems: 'center', justifyContent: 'center' }}>
                  <Image source={{ uri: FS.documentDirectory + c.media_relpath }}
                    style={{ width: W, height: 300 }} resizeMode="contain" />
                </ScrollView>
              ) : (
                <View style={[s.viewImg, s.tileIcon, { width: W - 40, height: 260 }]}>
                  <Text style={{ fontSize: 72 }}>
                    {c.modality === 'voice' ? '🎙' : '📝'}
                  </Text>
                </View>
              )}
            </View>
          ))}
        </ScrollView>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20 }}>
          <View style={s.card}>
            <Text style={s.cardH}>{cur?.modality} capture</Text>
            {!v || v.captureId !== cur?.capture_id ? (
              <Text style={s.cardNote}>Loading…</Text>
            ) : !v.ok ? (
              // Row says it exists, file does not. Loud, never swallowed (mandate #1).
              <Text style={s.warn}>{v.reason}</Text>
            ) : (
              <>
                {v.text !== undefined && <Text style={s.frozen}>{v.text}</Text>}
                {v.modality === 'voice' && (
                  <>
                    <Pressable style={s.confirmWide} onPress={async () => {
                      if (playing) { stopPlayback(); setPlaying(false); return; }
                      const r = await playCapture(v.uri);
                      if (!r.ok) { setPlayErr(r.reason); return; }
                      setPlayErr(null); setPlaying(true);
                    }}>
                      <Text style={s.confirmT}>{T(playing ? 'ev.stop' : 'ev.play')}</Text>
                    </Pressable>
                    {playErr && <Text style={s.warn}>{T({ k: 'ev.playFailed', p: { why: playErr } })}</Text>}
                  </>
                )}
                <Text style={s.sub}>{T('ev.recorded')}</Text>
                <Text style={s.evid}>{new Date(v.capturedAtMs).toLocaleString()}</Text>
                <Text style={s.sub}>{T('ev.where')}</Text>
                <Text style={s.evid}>{describeStamp({ lat: v.lat, lng: v.lng, stamp_status: v.stampStatus })}</Text>
                <Text style={s.sub}>{T('ev.hash')}</Text>
                <Text style={s.hash}>{v.sha256}</Text>
                <Text style={v.intact ? s.ok : s.warn}>
                  {v.intact ? T('ev.intact') : T('ev.tampered')}
                </Text>
              </>
            )}

            {/* REQ-GAL3: user tags. Tap a chip to retract (an event, not a delete);
                type to add. Tags organize the grid; they are not part of the media. */}
            <Text style={s.sub}>Tags</Text>
            <View style={s.chips}>
              {vtags.map((tg) => (
                <Pressable key={tg} onPress={async () => {
                  if (!cur) return;
                  await retractTag(db, { captureId: cur.capture_id, tag: tg, author: 'Owner' });
                  const ids = saved.map((c) => c.capture_id);
                  setVtags(await tagsFor(db, cur.capture_id));
                  setGridTags(await tagMap(db, ids));
                  setProjTags(await projectTags(db, ids));
                }}>
                  <Text style={s.chip}>{tg} ✕</Text>
                </Pressable>
              ))}
              {!vtags.length && <Text style={s.cardNote}>No tags yet</Text>}
            </View>
            <View style={s.lineAdd}>
              <TextInput style={[s.lineIn, { flex: 3 }]} value={tagDraft}
                placeholder="add a tag (e.g. roof, before)" placeholderTextColor="#8c959f"
                autoCapitalize="none" onChangeText={setTagDraft} />
              <Pressable style={[s.linePlus, !tagDraft.trim() && s.btnOff]}
                disabled={!tagDraft.trim() || !cur}
                onPress={async () => {
                  if (!cur) return;
                  await addTag(db, { captureId: cur.capture_id, tag: tagDraft, author: 'Owner' });
                  const ids = saved.map((c) => c.capture_id);
                  setTagDraft('');
                  setVtags(await tagsFor(db, cur.capture_id));
                  setGridTags(await tagMap(db, ids));
                  setProjTags(await projectTags(db, ids));
                }}>
                <Text style={s.linePlusT}>+</Text>
              </Pressable>
            </View>

            {/* REQ-CAP3: a note on any capture, any modality. */}
            <Text style={s.sub}>Notes ({vnotes.length})</Text>
            {vnotes.map((n) => (
              <View key={n.id} style={s.capNote}>
                <Text style={s.capNoteBody}>{n.body}</Text>
                <Text style={s.capNoteMeta}>
                  {n.author ?? 'you'} · {new Date(n.created_at_ms).toLocaleString()}
                </Text>
              </View>
            ))}
            <TextInput style={s.moneyInput} value={noteDraft} multiline
              placeholder={T('ev.addNote')} placeholderTextColor="#8c959f"
              onChangeText={setNoteDraft} />
            <Pressable style={[s.confirmWide, !noteDraft.trim() && s.btnOff]}
              disabled={!noteDraft.trim() || !cur}
              onPress={async () => {
                if (!cur) return;
                const r = await addNote(db, { captureId: cur.capture_id, body: noteDraft, author: 'Owner' });
                if (!r.ok) { setUi({ k: 'refused', why: r.reason }); return; }
                setNoteDraft('');
                setVnotes(await notesFor(db, cur.capture_id));
                setNCounts(await noteCounts(db));
              }}>
              <Text style={s.confirmT}>{T('ev.addNoteBtn')}</Text>
            </Pressable>
            <Text style={s.cardNote}>
              Notes are added, never replaced. The note is what someone said ABOUT
              this; it isn’t part of what was recorded.
            </Text>
          </View>
        </ScrollView>
      </View>
    );
  }

  if (inboxOpen) {
    return (
      <View style={s.c}>
        <Text style={s.h}>EZchangeorder</Text>
        <View style={s.card}>
          <Text style={s.cardH}>{T({ k: 'inbox.title', p: { n: inboxRows.length } })}</Text>
          <Text style={s.cardNote}>
            These saved fine — we just couldn’t tell which job. Tap a job to file it.
          </Text>
          {inboxRows.map((c2) => (
            <View key={c2.capture_id} style={s.inboxItem}>
              <Text style={s.inboxWhat}>
                {c2.modality} · {(c2.media_bytes / 1024).toFixed(1)} KB · {describeStamp(c2)}
              </Text>
              <View style={s.inboxJobs}>
                {projects.filter((p2) => p2.id !== INBOX_ID).map((p2) => (
                  <Pressable key={p2.id} style={s.inboxJob} onPress={async () => {
                    await fileCapture(db, { captureId: c2.capture_id, projectId: p2.id, by: 'Owner' });
                    const left = inboxRows.filter((x) => x.capture_id !== c2.capture_id);
                    setInboxRows(left);
                    setInbox(await inboxCount(db));
                    if (!left.length) setInboxOpen(false);
                    await refresh();
                  }}>
                    <Text style={s.inboxJobT}>{p2.name}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
          {!projects.filter((p2) => p2.id !== INBOX_ID).length && (
            <Text style={s.warn}>{T('inbox.noJobs')}</Text>
          )}
          <Pressable style={s.later} onPress={() => setInboxOpen(false)}>
            <Text style={s.laterT}>{T('common.close')}</Text>
          </Pressable>
          <Text style={s.cardNote}>
            Filing doesn’t rewrite the capture — the original stays exactly as it was
            recorded, and your choice is kept beside it.
          </Text>
        </View>
      </View>
    );
  }

  // AUTH GATE — before first-run, before the main app. A stored token flows straight
  // through to the main screen; a logged-out newcomer sees the 4-slide intro once,
  // then sign-in / register. Held until `ready` (and no init failure) so we never
  // flash sign-in over a valid session still being read from storage.
  // DEV FIXTURE — pixel-perfect visual work on the draft screen without a camera.
  // Gated on an env flag, so it is inert in every real build. Scaffolding; removed
  // with __fixturedraft.tsx when the screen matches the mockup.
  if (process.env.EXPO_PUBLIC_FIXTURE === '1') return <FixtureDraft />;
  if (process.env.EXPO_PUBLIC_FIXTURE === '2') return <FixtureNegotiation />;
  if (process.env.EXPO_PUBLIC_FIXTURE === '3') return <FixtureLocked />;

  if (ready && !initError) {
    if (session === undefined) return <SplashScreen />;
    if (session === null) {
      if (!seenOnboarding) {
        return <Onboarding onDone={() => { void setSeenOnboarding(); setSeen(true); }} />;
      }
      return <AuthScreen connector={connector} />;
    }
  }

  // REQ-SET2. Shown before anything else, and only once.
  // Nothing until we know. A null firstRun rendered the MAIN screen for a frame
  // and then swapped it for the language picker -- a flash of the wrong app, shown
  // to the one user who has never seen the right one.
  if (firstRun === null && ready) return <SplashScreen />;

  // Enter setup when it's a first run OR the profile is missing — an existing user
  // (first_run_done already set) with no profile must still be asked who they are.
  if ((firstRun || !hasProfileState) && ready && !gate) {
    const step = nextStep({ hasProfile: hasProfileState });
    // Progress spine across the two profile sub-screens (research: progress
    // indicators lower onboarding anxiety). 'who' is 0, 'trade' is 1.
    const stepIndex = pSub === 'who' ? 0 : 1;
    const Dots = () => (
      <View style={s.frDots}>
        {[0, 1].map((d) => (
          <View key={d} style={[s.frDot, d === stepIndex && s.frDotOn]} />
        ))}
      </View>
    );

    if (step === 'done') {
      // No celebration screen. They came here to create an extra.
      void markFirstRunDone(db).then(() => setFirstRun(false));
      return <SplashScreen />;
    }

    // THE PROFILE — the one setup screen (2026-07-20). Language folds in as a
    // bilingual toggle at the top; NO job step follows — the user lands on the
    // capture-first home and starts by creating an extra. name + solo/company,
    // then trade (skippable); the minimum that personalises a proposal.
    if (step === 'profile') {
      if (pSub === 'who') {
        // Company name is OPTIONAL (hadar 2026-07-20): picking Company but leaving
        // the name blank must not block onboarding. Only name + solo/company gate.
        const canGo = pName.trim().length > 0 && pSolo !== null;
        return (
          <View style={s.c}>
            <Text style={s.h}>EZchangeorder</Text>
            <Dots />
            <View style={s.card}>
              {/* LANGUAGE, folded in. Each option in its OWN name so choosing needs
                  no reading — but it is no longer a gate before the app explains
                  itself. Tapping switches the whole form live. */}
              <Text style={s.frLangLab}>Language · Idioma</Text>
              <View style={s.frLangRow}>
                <Pressable style={[s.frLangChip, lang === 'en' && s.frLangChipOn]}
                  onPress={async () => { setLang('en'); setLangState('en'); await saveLang(db, 'en'); }}>
                  <Text style={[s.frLangChipT, lang === 'en' && s.frLangChipTOn]}>English</Text>
                </Pressable>
                <Pressable style={[s.frLangChip, lang === 'es' && s.frLangChipOn]}
                  onPress={async () => { setLang('es'); setLangState('es'); await saveLang(db, 'es'); }}>
                  <Text style={[s.frLangChipT, lang === 'es' && s.frLangChipTOn]}>Español</Text>
                </Pressable>
              </View>

              <Text style={s.cardH}>{T('fr.whoTitle')}</Text>
              <Text style={s.cardNote}>{T('fr.whoWhy')}</Text>
              <TextInput style={s.moneyInput} value={pName}
                placeholder={T('fr.yourName')} placeholderTextColor="#8c959f"
                onChangeText={setPName} />
              <Pressable style={[s.pickWide, pSolo === true && s.pickOn]} onPress={() => setPSolo(true)}>
                <Text style={[s.pickT, pSolo === true && s.pickTOn]}>{T('fr.solo')}</Text>
              </Pressable>
              <Pressable style={[s.pickWide, pSolo === false && s.pickOn]} onPress={() => setPSolo(false)}>
                <Text style={[s.pickT, pSolo === false && s.pickTOn]}>{T('fr.company')}</Text>
              </Pressable>
              {pSolo === false && (
                <TextInput style={s.moneyInput} value={pCompany}
                  placeholder={T('fr.companyName')} placeholderTextColor="#8c959f"
                  onChangeText={setPCompany} />
              )}
              <Pressable style={[s.confirmWide, !canGo && s.btnOff]} disabled={!canGo}
                onPress={() => setPSub('trade')}>
                <Text style={s.confirmT}>{T('fr.continue')}</Text>
              </Pressable>
            </View>
          </View>
        );
      }
      // trade sub-screen — big-button grid, skippable
      const finish = async (trade: string | null) => {
        await saveProfile(connector, db, {
          name: pName, isSolo: pSolo === true,
          company: pSolo === false ? pCompany : null, trade,
        });
        setHasProfile(true);
      };
      return (
        <View style={s.c}>
          <Text style={s.h}>EZchangeorder</Text>
          <Dots />
          <View style={s.card}>
            <Text style={s.cardH}>{T('fr.tradeTitle')}</Text>
            <Text style={s.cardNote}>{T('fr.tradeWhy')}</Text>
            <View style={s.tradeGrid}>
              {TRADES.map((tr) => (
                <Pressable key={tr} style={[s.tradeCell, pTrade === tr && s.pickOn]}
                  onPress={() => setPTrade(tr)}>
                  <Text style={[s.tradeCellT, pTrade === tr && s.pickTOn]}>{T('trade.' + tr)}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable style={s.confirmWide} onPress={() => finish(pTrade)}>
              <Text style={s.confirmT}>{T('fr.continue')}</Text>
            </Pressable>
            <Pressable style={s.later} onPress={() => finish(null)}>
              <Text style={s.laterT}>{T('fr.skip')}</Text>
            </Pressable>
          </View>
        </View>
      );
    }

    // NO JOB STEP (2026-07-20). The user does not start by filing a job — after the
    // profile they land on the capture-first home and create an EXTRA. The job is
    // created/assigned during that flow (capture → assign sheet). Consent is still
    // deferred to the first record tap (canRecordAudio gate) + dismissible banner
    // below; by then the capture has a job to attach to. See firstrun.ts header.
  }

  // REQ-VAL7. The air-handler screen: what might fall between trades, and who
  // owns it. Gaps first — the unassigned boundary is the one that costs money.
  if (scopeOpen) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: '#f6f8fa' }} contentContainerStyle={s.c}>
        <Text style={s.h}>EZchangeorder</Text>
        <View style={s.card}>
          <Text style={s.cardH}>{T('sc.title')}</Text>

          {boundaries.map((b) => (
            <View key={b.id} style={s.bndRow}>
              <Text style={s.bndSubject}>{b.subject}</Text>
              <Text style={b.assignedTo ? s.bndOwner : s.bndGap}>
                {b.assignedTo ?? T('sc.nobody')}
                {b.changes > 1 ? ` · ${T({ k: 'sc.changed', p: { n: b.changes } })}` : ''}
              </Text>
              {!b.assignedTo && (
                <View style={s.bndJobs}>
                  {parties.map((pt) => (
                    <Pressable key={pt.id} style={s.inboxJob} onPress={async () => {
                      await assignBoundary(db, { boundaryId: b.id, projectId,
                        ownerId: OWNER, partyName: pt.name, directedBy: 'Owner' });
                      setBoundaries(await listBoundaries(db, projectId));
                    }}>
                      <Text style={s.inboxJobT}>{pt.name}</Text>
                    </Pressable>
                  ))}
                  {!parties.length && <Text style={s.cardNote}>{T('sc.noParties')}</Text>}
                </View>
              )}
            </View>
          ))}

          <Text style={s.sub}>{T('sc.addBoundary')}</Text>
          <View style={s.lineAdd}>
            <TextInput style={[s.lineIn, { flex: 3 }]} value={bndDraft}
              placeholder="e.g. whip to the air handler" placeholderTextColor="#8c959f"
              onChangeText={setBndDraft} />
            <Pressable style={[s.linePlus, !bndDraft.trim() && s.btnOff]}
              disabled={!bndDraft.trim()}
              onPress={async () => {
                await nameBoundary(db, { projectId, subject: bndDraft,
                  trades: parties.map((x) => x.trade) });
                setBndDraft('');
                setBoundaries(await listBoundaries(db, projectId));
              }}>
              <Text style={s.linePlusT}>+</Text>
            </Pressable>
          </View>

          <Text style={s.sub}>{T('sc.addParty')}</Text>
          {parties.map((pt) => (
            <Text key={pt.id} style={s.dmeta}>{pt.name} · {pt.trade}</Text>
          ))}
          <View style={s.lineAdd}>
            <TextInput style={[s.lineIn, { flex: 2 }]} value={ptyDraft.name}
              placeholder={T('sc.partyName')} placeholderTextColor="#8c959f"
              onChangeText={(v) => setPtyDraft({ ...ptyDraft, name: v })} />
            <TextInput style={[s.lineIn, { flex: 2 }]} value={ptyDraft.trade}
              placeholder={T('sc.partyTrade')} placeholderTextColor="#8c959f"
              onChangeText={(v) => setPtyDraft({ ...ptyDraft, trade: v })} />
            <Pressable style={[s.linePlus, (!ptyDraft.name.trim() || !ptyDraft.trade.trim()) && s.btnOff]}
              disabled={!ptyDraft.name.trim() || !ptyDraft.trade.trim()}
              onPress={async () => {
                await addParty(db, { projectId, name: ptyDraft.name, trade: ptyDraft.trade });
                setPtyDraft({ name: '', trade: '' });
                setParties(await listParties(db, projectId));
              }}>
              <Text style={s.linePlusT}>+</Text>
            </Pressable>
          </View>

          <Text style={s.cardNote}>{T('sc.note')}</Text>
          <Pressable style={s.later} onPress={() => setScopeOpen(false)}>
            <Text style={s.laterT}>{T('common.close')}</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  // The free-tier cap modal. Defined once and mounted in each screen that can trip a
  // cap (new-job, assign, and the main dashboard), since those are early returns and a
  // RN <Modal> must sit in the mounted subtree. "See plans" clears the blocking sheets
  // (captures stay committed) and opens Settings → Subscription.
  const quotaEl = quota ? (
    <QuotaModal kind={quota.kind} limit={quota.limit}
      onClose={() => setQuota(null)}
      onSeePlans={() => { setQuota(null); void openPaywall(); }} />
  ) : null;

  // The paywall (DEC-11) — a Modal, so mounted beside quotaEl in each early-return
  // screen; `visible` toggles it. Opened from a hit cap ("See plans") or Settings.
  const paywallEl = (
    <PaywallScreen visible={showPaywall} currentPlan={paywallPlan}
      onClose={() => setShowPaywall(false)}
      // Re-read the plan after a purchase. company.plan is written by the RevenueCat
      // webhook and arrives via sync, so this may still read the old tier for a beat —
      // refresh() runs again on the next sync tick and settles it.
      onPurchased={async () => { setPaywallPlan(await currentPlan(db)); void refresh(); }}
      onContact={() => Linking.openURL('mailto:support@ezchangeorder.com?subject=' + encodeURIComponent('EZchangeorder — plans')).catch(() => {})} />
  );

  // The win overlay (gap #1) — mounted in each early-return screen so it floats over
  // whatever the user is looking at when a "yes" lands. Tap or wait to dismiss.
  const celebrateEl = celebrate ? (
    <Modal visible transparent animationType="fade" onRequestClose={() => setCelebrate(null)}>
      <Pressable onPress={() => setCelebrate(null)}
        style={{ flex: 1, backgroundColor: 'rgba(21,26,30,0.55)', alignItems: 'center', justifyContent: 'center', padding: 28 }}>
        <View style={{ width: '100%', maxWidth: 360, backgroundColor: '#FFFDFC', borderRadius: 22, padding: 28, alignItems: 'center' }}>
          <Text style={{ fontFamily: 'Barlow_700Bold', fontSize: 24, color: '#151A1E', textAlign: 'center', letterSpacing: -0.2 }}>{T('celebrate.title')}</Text>
          <Text style={{ fontFamily: 'Barlow_700Bold', fontSize: 40, color: '#4E6243', marginTop: 12, letterSpacing: -0.8 }}>{money(celebrate.cents)}</Text>
          <Text style={{ fontFamily: 'Barlow_400Regular', fontSize: 15, color: '#5E666E', marginTop: 2 }}>
            {celebrate.n > 1 ? `${T('home.approvedN')} · ${celebrate.n}` : T('home.approvedN')}
          </Text>
        </View>
      </Pressable>
    </Modal>
  ) : null;

  if (newJob) {
    return (
      <View style={s.c}>
        {quotaEl}
        {discardSheet}
        {celebrateEl}
        {paywallEl}
        <Text style={s.h}>EZchangeorder</Text>
        <View style={s.card}>
          <Text style={s.cardH}>{T('job.newTitle')}</Text>
          <TextInput style={s.moneyInput} value={newJob.name} autoFocus
            placeholder={T('job.name')} placeholderTextColor="#8c959f"
            onChangeText={(v) => setNewJob({ ...newJob, name: v })} />
          <AddressInput
            value={newJob.address}
            onChangeText={(v) => setNewJob({ ...newJob, address: v })}
            onPick={(h) => setNewJob({ ...newJob, address: h.label, lat: h.lat, lng: h.lng })}
          />
          <Text style={s.cardNote}>
            Start typing an address or tap “use my location”. If you skip it, we pin
            the job to where you are now, so captures here file themselves.
          </Text>
          <Pressable style={[s.confirmWide, !newJob.name.trim() && s.btnOff]}
            disabled={!newJob.name.trim()}
            onPress={async () => {
              // FREE-TIER jobs cap (hadar 2026-07-25): stop before creating the
              // N+1th job and show the plan modal. If we came from the assign flow,
              // the captures stay committed and the sheet stays open for another job.
              const jq = await checkJobs(db);
              if (!jq.ok) { setQuota({ kind: 'jobs', limit: jq.limit }); return; }
              // Pin it to HERE. That is what makes resolution work later, and it
              // costs the user nothing: he is standing on the job as he creates it.
              const st = await stampNow();
              const r = await createProject(db, {
                ownerId: OWNER, name: newJob.name, address: newJob.address || null,
                // Prefer the chosen address's coords (pins the map there); fall back
                // to where the user is standing.
                lat: newJob.lat ?? st.lat, lng: newJob.lng ?? st.lng,
              });
              if (!r.ok) { setUi({ k: 'refused', why: r.reason }); return; }
              setProjectId(r.id);
              setProjects(await listProjects(db));
              setNewJob(null); setPicker(false);
              // If we got here FROM the post-recording assign flow, the walk's
              // captures were waiting on a job — file them to the one just created
              // through the SAME path a picked job uses, so the draft rehomes and the
              // processing screen opens the details (hadar, 2026-07-24: this branch
              // used to file and stop, leaving an unprocessed draft).
              if (assign) { await fileWalkTo(assign, r.id); return; }
              // CompanyCam: creating a job drops you into it, ready to capture.
              setNav('project');
              await refresh();
            }}>
            <Text style={s.confirmT}>{T('job.create')}</Text>
          </Pressable>
          <Pressable style={s.later} onPress={() => setNewJob(null)}>
            <Text style={s.laterT}>{T('common.cancel')}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // REQ-EVID2: "found in ≤2 actions". Tap the job name, tap the job.
  if (picker) {
    return (
      <View style={s.c}>
        <Text style={s.h}>EZchangeorder</Text>
        <View style={s.card}>
          <Text style={s.cardH}>{T('job.which')}</Text>
          {projects.map((p) => (
            <Pressable key={p.id} style={s.jobRow} onPress={async () => {
              setProjectId(p.id); await touchProject(db, p.id);
              setProjects(await listProjects(db)); setPicker(false); await refresh();
            }}>
              <Text style={p.id === projectId ? s.jobNameOn : s.jobName}>{p.name}</Text>
              <Text style={s.jobMeta}>
                {p.address ?? 'no address'}
                {p.lat != null ? ' · pinned' : ' · not pinned — captures here won’t file themselves'}
              </Text>
            </Pressable>
          ))}
          {!projects.length && (
            <Text style={s.cardNote}>{T('job.noneYet')}</Text>
          )}
          <Pressable style={s.confirmWide} onPress={() => setNewJob({ name: '', address: '' })}>
            <Text style={s.confirmT}>{T('job.new')}</Text>
          </Pressable>
          <Pressable style={s.later} onPress={() => setPicker(false)}>
            <Text style={s.laterT}>{T('common.close')}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ONE-TIME TERMS ACCEPTANCE (personal-use consent model, 2026-07-17). Shown at the
  // first record tap, once ever. The all-party reminder is informational -- it never
  // blocks acceptance, and the app never asserts third-party consent for the user.
  if (showTerms) {
    const allParty = showTerms.jur ? defaultConsentFor(showTerms.jur) === 'all_party' : false;
    const accept = async () => {
      await setTermsAccepted(db);
      setTerms(true);
      setShowTerms(null);
    };
    return (
      <View style={s.c}>
        <Text style={s.h}>EZchangeorder</Text>
        <View style={s.card}>
          <Text style={s.cardH}>{T('terms.title')}</Text>
          <Text style={s.cardNote}>{T('terms.body')}</Text>
          {showTerms.detecting ? (
            <Text style={s.dmeta}>Checking your location…</Text>
          ) : allParty && showTerms.jur ? (
            <Text style={s.warn}>{T({ k: 'terms.reminder', p: { state: showTerms.jur } })}</Text>
          ) : null}
          <Pressable style={s.confirmWide} onPress={accept}>
            <Text style={s.confirmT}>{T('terms.accept')}</Text>
          </Pressable>
          <Pressable style={s.later} onPress={() => setShowTerms(null)}>
            <Text style={s.laterT}>{T('terms.later')}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (sign) {
    return (
      <View style={s.c}>
        <Text style={s.h}>EZchangeorder</Text>
        <View style={s.card}>
          <Text style={s.cardH}>{T('sig.required')}</Text>
          <Text style={s.frozen}>{sign.shown}</Text>

          {!sign.verifiedAt ? (
            <>
              <Text style={s.sub}>{T('sig.ownersMobile')}</Text>
              <TextInput style={s.moneyInput} value={sign.phone} keyboardType="phone-pad"
                placeholder="+15551234567" placeholderTextColor="#8c959f"
                onChangeText={(v) => setSign({ ...sign, phone: v })} />
              {!sign.sent ? (
                <Pressable style={[s.confirmWide, sign.phone.length < 8 && s.btnOff]}
                  disabled={sign.phone.length < 8}
                  onPress={async () => {
                    const code = newOtpCode();
                    const r = await issueOtp(connector.client, sign.coId, sign.phone, code);
                    // NOT DELIVERED: no SMS provider (REQ-VAL8). Shown on screen
                    // so the flow is testable, and labelled as such rather than
                    // pretending a text went out.
                    setSign({ ...sign, sent: code, err: r.ok ? null : r.reason });
                  }}>
                  <Text style={s.confirmT}>{T('sig.sendCode')}</Text>
                </Pressable>
              ) : (
                <>
                  <Text style={s.warn}>
                    No SMS provider yet — code would be texted to {sign.phone}.
                    For now: {sign.sent}
                  </Text>
                  <TextInput style={s.moneyInput} value={sign.code} keyboardType="number-pad"
                    placeholder={T('sig.enterCode')} placeholderTextColor="#8c959f"
                    onChangeText={(v) => setSign({ ...sign, code: v })} />
                  <Pressable style={[s.confirmWide, sign.code.length !== 6 && s.btnOff]}
                    disabled={sign.code.length !== 6}
                    onPress={async () => {
                      const r = await verifyOtp(connector.client, sign.coId, sign.code);
                      if (r.ok && r.status === 'verified') {
                        setSign({ ...sign, verifiedAt: new Date().toISOString(), err: null });
                      } else {
                        setSign({ ...sign, err: r.ok
                          ? `${r.status}${r.attemptsLeft != null ? ` — ${r.attemptsLeft} tries left` : ''}`
                          : r.reason });
                      }
                    }}>
                    <Text style={s.confirmT}>{T('sig.verify')}</Text>
                  </Pressable>
                </>
              )}
            </>
          ) : (
            <>
              <Text style={s.ok}>{T('sig.verified')}</Text>
              <Text style={s.sub}>{T('sig.typeName')}</Text>
              <TextInput style={s.moneyInput} value={sign.legalName}
                placeholder={T('sig.legalName')} placeholderTextColor="#8c959f"
                onChangeText={(v) => setSign({ ...sign, legalName: v })} />
              <View style={s.cardBtns}>
                <Pressable style={[s.confirm, sign.legalName.trim().length < 2 && s.btnOff]}
                  disabled={sign.legalName.trim().length < 2}
                  onPress={async () => {
                    const r = await signApproval(connector.client, {
                      changeOrderId: sign.coId, projectId: projectId, shownContent: sign.shown,
                      signerLabel: 'Owner', legalName: sign.legalName, phoneE164: sign.phone,
                      otpVerifiedAt: sign.verifiedAt!, action: 'approved', userAgent: 'EZchangeorder iOS',
                    });
                    if (r.ok) {
                      // The signature is authored on the server (it needs the OTP
                      // check), so the local row must be told the outcome or the
                      // ledger would keep calling a signed CO a draft.
                      //
                      // THE RETURN VALUE IS READ (REQ-LC8). applyLocalApproval now
                      // refuses to walk a superseded or declined row to approved,
                      // and a refusal that nobody surfaces is the app claiming a
                      // state change that did not happen. The signature itself IS
                      // recorded server-side, so this is not an error to hide the
                      // outcome behind -- it is a disagreement to state plainly.
                      const la = await applyLocalApproval(db, sign.coId, 'approved', sign.legalName);
                      setSign(null); await refresh();
                      if (!la.ok) {
                        console.log('[sign] local approval refused for %s: %s (local status %s)',
                          sign.coId, la.reason, la.status);
                        setFiled(`Signed — but this phone still has this extra as ${
                          la.status ?? 'missing'}, so its status did not change here.`);
                      }
                    } else setSign({ ...sign, err: r.reason });
                  }}>
                  <Text style={s.confirmT}>{T('sig.sign')}</Text>
                </Pressable>
                <Pressable style={s.later} onPress={async () => {
                  // A DECLINE IS A TERMINAL ANSWER and it was the one call here that
                  // threw its result away entirely -- a refusal from the server (this
                  // version is already superseded, or already answered) left the sheet
                  // closing exactly as if the decline had landed.
                  const dr = await signApproval(connector.client, {
                    changeOrderId: sign.coId, projectId: projectId, shownContent: sign.shown,
                    signerLabel: 'Owner', legalName: sign.legalName || 'declined',
                    phoneE164: sign.phone, otpVerifiedAt: sign.verifiedAt!,
                    action: 'declined', userAgent: 'EZchangeorder iOS',
                  });
                  if (!dr.ok) { setSign({ ...sign, err: dr.reason }); return; }
                  const ld = await applyLocalApproval(db, sign.coId, 'declined', sign.legalName);
                  setSign(null); await refresh();
                  if (!ld.ok) {
                    console.log('[sign] local decline refused for %s: %s (local status %s)',
                      sign.coId, ld.reason, ld.status);
                    setFiled(`Recorded — but this phone still has this extra as ${
                      ld.status ?? 'missing'}, so its status did not change here.`);
                  }
                }}>
                  <Text style={s.laterT}>{T('sig.decline')}</Text>
                </Pressable>
              </View>
            </>
          )}

          {sign.err && <Text style={s.warn}>{sign.err}</Text>}
          <Pressable style={s.later} onPress={() => setSign(null)}>
            <Text style={s.laterT}>{T('common.close')}</Text>
          </Pressable>
          <Text style={s.cardNote}>
            The words above are frozen — they are what gets signed, not whatever
            the change order says later.
          </Text>
        </View>
      </View>
    );
  }

  // Cold start: a quiet splash rather than a flash of the capture screen while the
  // database opens and the durability profile is asserted.
  // Fonts gate with the durability gate: never flash unstyled text, never flash the
  // capture screen before the database is up.
  if (!ready || !fontsLoaded) return <SplashScreen />;

  // REQ-PROC8: reviewing what the model proposed for a capture. Overlays everything.
  if (review) {
    return (
      <ReviewScreen
        db={db}
        client={connector.client}
        captureId={review}
        projectId={projectId}
        projectName={projects.find((p) => p.id === projectId)?.name ?? 'This job'}
        ownerId={OWNER}
        onDone={async () => { setReview(null); await refresh(); }}
        onClose={() => setReview(null)}
        // The other answer to "Review before it counts". Until now the screen
        // offered Confirm and Not now — keep it, or keep it for later — and no
        // way to say no. discardCapture refuses once a decision_version points
        // at it, which is the point where discardExtra takes over.
        // ONE confirmation for every way in. The ledger row, the record screen
        // and this all open the same full-screen sheet, so the sentence a person
        // reads before destroying something is written once and cannot drift.
        onDiscard={() => {
          const capId = review;
          setReview(null);
          setDiscard({
            co: { id: `co-${capId}`, scope: T('discard.thisRecording') } as any,
            plan: { allowed: true, deleteCaptures: [capId], keepCaptures: [], needsServer: [] },
            captureId: capId,
          });
        }}
      />
    );
  }

  // FLOW step 1.5 — the transition after capture, themed to the design system
  // (hadar mockup, 2026-07-27). The calm face is the mockup's: a progress ring, one
  // reassuring line, and what happens next.
  //
  // WHAT THE MOCKUP DOES NOT SHOW, AND WHY IT IS STILL HERE: the mockup is a single
  // "working on it" state with nowhere for a failure to appear. The step rows, the
  // upload bar and the raw error underneath are how a backup that has STALLED admits
  // it instead of spinning forever — that surface is exactly how the 23503 project-FK
  // bug was caught (2026-07-27). Mandate #1 is a promise about honesty, not just about
  // bytes: a screen that always looks like it is working is a screen that can lie.
  // Decision: mockup look on the happy path, full detail retained underneath, and the
  // offline/stalled/blocked branch still takes over with plain words + a Done button.
  if (transition) {
    const t = transition;
    // Every row tracks a REAL signal. Transcription only exists when there is an
    // anchor capture; the AI pass belongs to a NEW extra, so an augment does not
    // claim a "details sorted" step it never ran.
    const steps: { done: boolean; doing: string; doneKey: string }[] = [
      { done: true, doing: 'cap.transSaved', doneKey: 'cap.transSaved' },
      { done: t.uploaded, doing: 'cap.transUpload', doneKey: 'cap.transUploaded' },
      ...(t.anchorCaptureId !== null
        ? [{ done: t.transcribed, doing: 'cap.transStt', doneKey: 'cap.transSttDone' }] : []),
      // The AI pass belongs to a new extra AND to a voice edit (which now re-summarises
      // what was added). A photos-only edit ran no AI, so it claims no such step.
      ...((!t.isAugment || t.anchorCaptureId !== null)
        ? [{ done: t.analyzed, doing: 'cap.transAnalyze', doneKey: 'cap.transAnalyzed' }] : []),
    ];
    const doneCount = steps.filter((x) => x.done).length;
    const pct = doneCount / steps.length;
    const current = steps.find((x) => !x.done);
    // A TRANSIENT network failure (backoff stores code 'TRANSIENT', text "Network
    // request failed") is NOT a crash — the extra is saved and the queue is retrying.
    // The contractor must not see "TRANSIENT: Network request failed [job: prj-…]";
    // that dev string reads as broken (hadar, 2026-07-27). Detect it and speak plainly.
    const netRetry = !t.uploaded && !!t.lastError &&
      /TRANSIENT|network request failed|network/i.test(t.lastError);
    // HELD FOR A JOB — not slow, not offline, and NOT something waiting will fix
    // (hadar 2026-08-07, screenshot: "AWAITING_FILING: held: this capture has no job
    // yet" under "we'll have it ready shortly"). The uploader parks an unfiled capture
    // on purpose: the server's FK needs a real project and the Inbox is a sentinel with
    // no row. So the bytes sit there until a human picks the job — which means the
    // screen was promising an arrival that could not happen, and printing a dev string
    // to a contractor instead of the one thing he can do about it.
    const awaitingFiling = !!t.lastError && /AWAITING_FILING/i.test(t.lastError);
    // Any surfaced error puts the screen into the reassure-and-let-them-proceed state;
    // the message below picks the right plain-language words for which kind it is.
    const trouble = t.offline || t.stalled || t.blocked || !!t.lastError;
    const warnKey = awaitingFiling ? 'cap.transNoJob'
      : t.blocked ? 'cap.transBlocked'
      : t.offline ? 'cap.transOffline'
      : netRetry ? 'cap.transRetry'
      : 'cap.transStalled';

    // The ring. Drawn rather than animated: this screen is read at a glance by
    // someone who wants to know it is working, not watched.
    const RING = 148, SW = 12, RAD = (RING - SW) / 2, CIRC = 2 * Math.PI * RAD;

    return (
      <View style={s.trScreen}>
        <ScrollView contentContainerStyle={s.trScroll} showsVerticalScrollIndicator={false}>
          {/* The mockup's background line-art (house frame, tape measure) is still
              omitted — only the four foreground icons were supplied. */}
          <Icon name="hardhat" size={62} />

          <Text style={s.trTitle}>
            {T(t.isAugment ? 'cap.transTitleAug' : 'cap.transTitle')}
          </Text>
          <Text style={s.trSub}>
            {trouble ? T('cap.transSafe') : T('cap.transMoment')}
          </Text>

          <View style={s.trCard}>
            <View style={s.trRingWrap}>
              <Svg width={RING} height={RING}>
                <Circle cx={RING / 2} cy={RING / 2} r={RAD} stroke={C.surfaceMuted}
                  strokeWidth={SW} fill="none" />
                <Circle cx={RING / 2} cy={RING / 2} r={RAD} stroke={C.brand}
                  strokeWidth={SW} fill="none" strokeLinecap="round"
                  strokeDasharray={`${CIRC} ${CIRC}`}
                  strokeDashoffset={CIRC * (1 - pct)}
                  transform={`rotate(-90 ${RING / 2} ${RING / 2})`} />
              </Svg>
              <View style={s.trRingIcon}>
                <Icon name="checklist" size={52} />
              </View>
            </View>

            <Text style={s.trState}>{T('cap.transWorking')}</Text>
            <Text style={s.trStateSub}>
              {current ? T(current.doing) : T('cap.transPreparing')}
            </Text>

            {/* The detail. Not decoration — the only place a stall can speak. */}
            <View style={s.trSteps}>
              {steps.map((st_, i) => (
                <View key={i} style={s.trStepRow}>
                  <Icon name={st_.done ? 'approved' : 'clock'} size={19}
                    color={st_.done ? C.approve : C.steel} />
                  <Text style={[s.trStepT, st_.done && s.trStepTDone]}>
                    {T(st_.done ? st_.doneKey : st_.doing)}
                  </Text>
                </View>
              ))}
            </View>

            {!t.uploaded && t.uploadTotal > 0 && (
              <View style={s.trProgWrap}>
                <View style={s.trProgTrack}>
                  <View style={[s.trProgFill,
                    { width: `${Math.round((t.uploadDone / Math.max(1, t.uploadTotal)) * 100)}%` }]} />
                </View>
                <Text style={s.trProgT}>
                  {T({ k: 'cap.transUploadProg', p: { done: t.uploadDone, total: t.uploadTotal } } as any)}
                </Text>
              </View>
            )}

          </View>

          {/* Trouble takes over: plain words about what is true, and a way out that
              parks everything safe at home. The RAW error is kept only as the small
              secondary line below — for debugging, not as the headline the old screen
              made it (the "TRANSIENT: Network request failed" the contractor saw). */}
          {trouble && (
            <View style={s.trWarn}>
              <Text style={s.trWarnT}>{T(warnKey)}</Text>
              {/* …and for a plain network retry it is not shown AT ALL (hadar
                  2026-08-06, screenshot: "TRANSIENT: Network request failed
                  [job: prj-ms5do1fx-ft284]" under a sentence that already said, in
                  English, that the internet was the problem). Demoting the dev string
                  to a smaller line still left it on screen, and the code plus a job id
                  is not debugging information to the person holding the phone — it is
                  evidence that something broke. A genuine stall keeps it: there the
                  detail is the only clue anyone has. */}
              {t.lastError && !netRetry && !awaitingFiling && (
                <Text style={s.trWarnErr}>{t.lastError}</Text>
              )}
              {/* THE ACT THAT ENDS IT, offered where the problem is stated. Filing is
                  the whole fix — `fileCapture` replaces the parked outbox row with a
                  real destination and the next drain lands it — so this is a one-tap
                  resolution, not a link to somewhere he has to find it. */}
              {awaitingFiling && (
                <Pressable style={s.trFile} onPress={() => {
                  const ids = t.ids, coId = t.coId, anchor = t.anchorCaptureId;
                  setTransition(null);
                  setAssign({ ids, lat: null, lng: null, uris: [], secs: 0,
                              anchorCoId: coId, anchorCaptureId: anchor });
                }}>
                  <Text style={s.trFileT}>{T('cap.transPickJob')}</Text>
                </Pressable>
              )}
              <Pressable
                onPress={() => {
                  // Augment came FROM an extra, so Done returns to it — not Home (the
                  // added evidence is saved and backs up on Wi-Fi). A new extra parks
                  // at Home as a draft.
                  if (t.isAugment) { const cid = t.coId; setTransition(null); void openRecord(cid); }
                  else setTransition(null);
                }}
                style={s.trDone}>
                <Text style={s.trDoneT}>{T('cap.transDone')}</Text>
              </Pressable>
            </View>
          )}

          {!trouble && (
            <View style={s.trNext}>
              {/* Bare, not inside a filled disc: this asset draws its own ring, and
                  nesting it in one gave a double circle. */}
              <Icon name="arrowCircle" size={50} />
              <View style={{ flex: 1 }}>
                <Text style={s.trNextLab}>{T('cap.transUpNext')}</Text>
                <Text style={s.trNextT}>{T('cap.transNextReview')}</Text>
              </View>
            </View>
          )}

          <View style={s.trRule} />
          <View style={s.trSafe}>
            <Icon name="shield" size={22} />
            <Text style={s.trSafeT}>{T('cap.transSafe')}</Text>
          </View>
        </ScrollView>
      </View>
    );
  }

  // WHICH JOB? — a change order must belong to a job. The captures are ALREADY saved
  // (Inbox) before this renders; this sheet only files them. Options, per the spec:
  // nearby jobs first, search by name/address, or create a new job right here.
  if (assign) {
    // R1 AC: one job in range prefills with a Detected marker; two in range offer a
    // picker and NEVER auto-select. Both live in prepareSendTo, which returns an
    // opinion plus its reason -- the same suggest-never-decide split as R5c's
    // approver routing, applied to places instead of people.
    if (!sendTo) {
      void prepareSendTo(db, { lat: assign.lat, lng: assign.lng })
        .then((pf) => { setSendTo(pf); setSendToId(pf.selectedId ?? null); });
    }
    const q = assignQ.trim().toLowerCase();
    const candidates = projects
      .filter((p) => p.id !== INBOX_ID)
      .map((p) => ({
        ...p,
        distM: assign.lat != null && assign.lng != null && p.lat != null && p.lng != null
          ? distanceM({ lat: assign.lat, lng: assign.lng }, { lat: p.lat, lng: p.lng })
          : null,
      }))
      .filter((p) => !q || p.name.toLowerCase().includes(q) || (p.address ?? '').toLowerCase().includes(q))
      .sort((a, b) => (a.distM ?? Infinity) - (b.distM ?? Infinity));
    // Picking an existing job and creating a new one now share ONE path (fileWalkTo):
    // file the captures, rehome the draft, then start the processing screen.
    const fileAll = (projId: string) => fileWalkTo(assign, projId);
    const newJobHere = async () => {
      // OPEN the create-job screen, PRE-FILLED from where the user is standing —
      // reverse-geocoded address when reachable, blank-but-editable when not, GPS
      // pinned to the capture's own fix. It no longer creates silently: a job
      // carries a name + address the user should SEE and can correct before it
      // exists (mandate #2). `assign` stays set while that screen is up, so the
      // create handler files this walk's captures to the new job once confirmed.
      const addr = assign.lat != null && assign.lng != null
        ? await addressFor(assign.lat, assign.lng) : null;
      setNewJob({ name: addr ?? '', address: addr ?? '', lat: assign.lat, lng: assign.lng });
    };
    // SAME dark world as the capture screen — this is step two of the SAME workflow,
    // not a different app. It opens with the receipt of the walk just taken (green
    // check, thumbnails, duration), then asks the one remaining question.
    const mm = `${Math.floor(assign.secs / 60)}:${String(assign.secs % 60).padStart(2, '0')}`;
    return (
      <View style={s.assignC}>
        {quotaEl}
        {discardSheet}
        {celebrateEl}
        {paywallEl}
        <View style={s.assignReceipt}>
          <Text style={s.assignSaved}>✓ {T('assign.saved')}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 6 }} style={{ flexGrow: 0 }}>
              {assign.uris.slice(0, 8).map((u, i) => (
                <Image key={i} source={{ uri: u }} style={s.assignThumb} />
              ))}
            </ScrollView>
            <Text style={s.assignMeta}>
              {assign.uris.length > 0 ? `📸 ${assign.uris.length}   ` : ''}{assign.secs > 0 ? `🎙 ${mm}` : ''}
            </Text>
          </View>
        </View>
        <View style={{ paddingHorizontal: 18, flex: 1 }}>
          <Text style={s.assignH}>{T('assign.title')}</Text>
          {/* R1: the prefill sits ABOVE the search box, because on the common path
              (one job in range) the answer is already there and searching is the
              exception. It states WHY it picked — "📍 Detected" — and changing it is
              one tap. Two in range never auto-selects: GPS decides what to SUGGEST,
              never what to file (mandate #8, suggest-never-decide). */}
          {sendTo && (
            <SendToCard
              prefill={sendTo}
              value={sendToId}
              onChange={(pr: SendToProject) => { setSendToId(pr.id); void fileAll(pr.id); }}
              onQuickAdd={async (o) => {
                // FREE-TIER jobs cap: quick-add creates a NEW job too, so gate it
                // before creating. Captures stay committed; the sheet stays open.
                // quotaBlocked tells the card to show no form error — the modal does.
                const jq = await checkJobs(db);
                if (!jq.ok) { setQuota({ kind: 'jobs', limit: jq.limit }); return { ok: false, quotaBlocked: true }; }
                // Name + phone, created implicitly at first send (R7). The walk files
                // to it immediately — that is the whole point of quick-add.
                const r = await quickAddDestination(db, {
                  ownerId: OWNER, name: o.name, phone: o.phone,
                  lat: assign.lat, lng: assign.lng,
                });
                if (r.ok) { setProjects(await listProjects(db)); void fileAll(r.projectId); }
                return { ok: r.ok, problemKey: r.ok ? undefined : r.problemKey };
              }}
            />
          )}
          <TextInput style={s.assignSearch} value={assignQ} onChangeText={setAssignQ}
            placeholder={T('assign.search')} placeholderTextColor="#7d848d" />
          <Pressable style={s.assignNew} onPress={newJobHere}>
            <Text style={s.assignNewT}>＋ {T('assign.newHere')}</Text>
          </Pressable>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
            {candidates.map((p) => (
              <Pressable key={p.id} style={s.assignRow} onPress={() => fileAll(p.id)}>
                <View style={{ flex: 1 }}>
                  <Text style={s.assignRowName} numberOfLines={1}>{p.name}</Text>
                  <Text style={s.assignRowMeta} numberOfLines={1}>
                    {p.distM != null
                      ? `📍 ${p.distM < 950 ? `${Math.round(p.distM)} m` : `${(p.distM / 1000).toFixed(1)} km`}`
                      : (p.address ?? '')}
                  </Text>
                </View>
                <Text style={s.assignChev}>›</Text>
              </Pressable>
            ))}
          </ScrollView>
          {/* Deliberately NO dismiss/"later" — a change order cannot move without a
              job. The sheet never dead-ends: "new job right here" is a local create
              and always succeeds, even offline. */}
        </View>
      </View>
    );
  }

  // PRD R6b: the extra record. Overlays everything, like review and capture.
  // R5b: the discussion thread. Overlays everything, same as the record.
  if (thread) {
    return (
      <ThreadScreen
        extra={{ id: thread.co.id, scope: thread.co.scope,
                 amount: thread.co.amount, status: thread.co.status }}
        messages={thread.messages}
        revision={thread.revision}
        undelivered={thread.undelivered}
        focusReply={thread.focusReply}
        formatAt={createdLabel}
        onReply={async (text: string) => {
          // Mandate #2: a reply is a MESSAGE. It commits nothing and prices nothing,
          // which is exactly why it needs no confirmation step — and exactly why it
          // must never be allowed to move the extra's status. A new PRICE goes
          // through the read-back composer (R7's Revise), never through a chat box.
          const pr = await postReply(db, { changeOrderId: thread.co.id, body: text, ownerId: OWNER });
          // Same contract as the record screen: a failed local write must throw so
          // the composer keeps the words instead of clearing them over nothing.
          if (!pr.ok) throw new Error(pr.reason);
          await refresh();
        }}
        onRevise={() => {
          // Hand off to the SAME priced composer R7 wired. One place issues a price.
          const c = thread.co;
          threadIdRef.current = null; setThread(null);
          startRevision(c);
        }}
        onBack={() => { threadIdRef.current = null; setThread(null); }}
      />
    );
  }

  /** Capture INTO an existing extra. Capturing from inside an extra always means
   *  adding to it — no job prompt, no new extra (hadar 2026-07-25: "it wanted me to
   *  select a job but this is an augmentation to an existing extra"). One function
   *  so the FAB, the Add-photo tile and the Photos & proof subscreen cannot drift. */
  const augmentExtra = (changeOrderId: string) => {
    if (!terms) { openTerms(); return; }
    setAugmentCoId(changeOrderId);
    // THE FEED RETURN IS CANCELLED FIRST, and without this the camera never opens.
    // `closeRecord` sets `showFeed` when the record was opened from the company feed,
    // and the render cascade puts `if (showFeed)` ABOVE `if (showCapture)` — so the
    // feed wins the frame and the capture screen mounts behind it. `closeFeed` does
    // not clear `showCapture` either, so the camera then ambushes the user on the
    // next tab tap. We are not "going back" here; we are going forward into a
    // capture that lands on this same extra.
    returnToFeedRef.current = false;
    closeRecord();
    setShowCapture(true);
  };

  /** Open one of the extra's detail subscreens, seeding the editor buffers from the
   *  row that is on screen. Nothing is written until Save; backing out discards. */
  const openDetail = (field: ExtraDetailField | 'history') => {
    const c = recordLc?.co;
    if (!c) return;
    setDetail({
      field,
      // 391 — the description editor edits the SCOPE OF WORK, so it must be seeded
      // with it. Seeding from `c.scope` (the title) meant opening the editor
      // silently replaced a written scope with the title the moment you saved.
      scope: (c.scope_of_work || '').trim() || c.scope,
      priceMode: c.nte_cents == null ? 'fixed' : 'nte',
      // EMPTY, not "0.00", when no price was ever given (370). The app never types a
      // number into the price field on his behalf (mandate #6).
      amountText: c.amount_cents == null ? '' : (c.amount_cents / 100).toFixed(2),
      nteText: c.nte_cents == null ? '' : (c.nte_cents / 100).toFixed(2),
      scheduleEffect: c.schedule_effect,
      scheduleDaysText: c.schedule_days ? String(c.schedule_days) : '',
      billingTiming: c.billing_timing,
      exclusions: c.exclusions ?? '',
      reading: null,
      rewrite: { phase: 'idle' },
    });
    // R2's read-back of what the recording said about money — fetched only for the
    // editor that shows it, because it can cross the network and the record itself
    // must open with no network at all (mandate #7).
    if (field !== 'history' && field !== 'photos' && field !== 'scope') {
      void (async () => {
        try {
          const v = await voiceReadingForDecision(db, connector.client, c.decision_id, parseMoney);
          setDetail((d) => (d && d.field === field ? { ...d, reading: v.price } : d));
        } catch { /* no transcript on this device — the editor says so itself */ }
      })();
    }
  };

  /** REQ-LC14: the client-facing scope is editable in Stage 1 only, and
   *  `retitleDraft`'s own `WHERE status = 'draft'` is the guard — not this caller.
   *  REQ-LC8: a write that moved no row is REPORTED, never swallowed. */
  /**
   * 391 — the DESCRIPTION editor writes the SCOPE OF WORK.
   *
   * It used to call `retitleDraft`, i.e. write `scope`, the title — the same
   * function the header rename calls. So editing the scope of work renamed the
   * extra, and renaming the extra destroyed the scope of work, and neither said so.
   */
  const saveScope = async (changeOrderId: string, text: string) => {
    const ok = await saveScopeOfWork(db, changeOrderId, text);
    if (!ok) {
      setFiled(T('erec.errSaveScope'));
      return;
    }
    setDetail(null);
    await openRecord(changeOrderId);
    void refresh();
  };

  /** Rename the extra from the header — `change_order.scope`, the title only. */
  const saveTitle = async (changeOrderId: string, text: string) => {
    const ok = await retitleDraft(db, changeOrderId, text);
    if (!ok) { setFiled(T('erec.errSaveScope')); return; }
    setDetail(null);
    await openRecord(changeOrderId);
    void refresh();
  };

  /** The price + terms editor's save. One writer (`priceDraftExtra`), which carries
   *  its own `WHERE status = 'draft'` and refreshes the queued outbox payload so the
   *  server's first sight of this extra is the priced one. */
  const savePrice = async (changeOrderId: string, co: RecordLcState['co'],
                           d: NonNullable<typeof detail>) => {
    const typed = centsFromInput(d.amountText);
    // NULL IS NOT ZERO (changeorder.ts:50-55). `priceDraftExtra` takes a number, so
    // an empty field with no stored price has nothing honest to write: storing 0
    // would tell a homeowner the work costs nothing. Refuse and say why, rather than
    // save a figure nobody said.
    const amount = typed ?? co.amount_cents;
    if (amount === null) {
      setFiled(T('erec.errPriceFirst'));
      return;
    }
    const days = parseInt(d.scheduleDaysText, 10);
    const fin = await priceDraftExtra(db, {
      changeOrderId,
      amountCents: amount,
      nteCents: d.priceMode === 'nte' ? centsFromInput(d.nteText) : null,
      // Written back unchanged: this editor does not edit the breakdown, and
      // priceDraftExtra sets the column on every save.
      lineItems: co.lineItems,
      billingTiming: (d.billingTiming as BillingTiming) ?? null,
      scheduleEffect: (d.scheduleEffect as ScheduleEffect) ?? null,
      scheduleDays: d.scheduleEffect === 'adds_days' && days > 0 ? days : null,
      exclusions: d.exclusions,
      whoDirected: co.who_directed || 'Owner',
      numbersConfirmedAt: new Date(),
    });
    if (!fin.ok) { setUi({ k: 'refused', why: fin.reason }); return; }
    // The read-back happened on this screen; the actor row is the proof of it.
    await noteActorNow(db, { subjectKind: 'change_order', subjectId: changeOrderId, act: 'priced' });
    setDetail(null);
    await openRecord(changeOrderId);
    void refresh();
  };

  /**
   * Save ONE flow field from its drawer — schedule, billing or exclusions.
   *
   * Deliberately NOT `savePrice`: that path demands a price (and stamps the read-back
   * proof), so answering "does this move the schedule?" on an unpriced draft was
   * refused with "set a price first". `setDraftFlowFields` writes the three flow
   * columns and leaves the money alone. Still one guarded UPDATE per save.
   */
  const saveFlow = async (changeOrderId: string, d: NonNullable<typeof detail>) => {
    const days = parseInt(d.scheduleDaysText, 10);
    const fin = await setDraftFlowFields(db, {
      changeOrderId,
      billingTiming: (d.billingTiming as BillingTiming) ?? null,
      scheduleEffect: (d.scheduleEffect as ScheduleEffect) ?? null,
      scheduleDays: d.scheduleEffect === 'adds_days' && days > 0 ? days : null,
      exclusions: d.exclusions,
    });
    if (!fin.ok) { setUi({ k: 'refused', why: fin.reason }); return; }
    setDetail(null);
    await openRecord(changeOrderId);
    void refresh();
  };

  /**
   * D6 / REQ-LC31 — a change after approval is a NEW INDEPENDENT EXTRA linked by
   * origin. It is NOT a supersession and must not reuse one: nothing is written to
   * the approved row at all. `createLinkedExtra` re-reads the origin's status and
   * refuses anything but `approved`, so a screen that offered this in the wrong
   * state cannot turn it into a supersession wearing a different name.
   *
   * Shaped exactly like `startExtraFromCapture` on purpose: a fresh decision, then
   * an UNPRICED draft at the placeholder scope. The follow-on therefore starts in
   * Stage 1 with both send blockers showing and is priced, previewed and sent by the
   * ordinary path — mandate #2 gets no exception for the second document just
   * because a human approved the first.
   */
  const createFollowOnExtra = async (originId: string, origin: RecordLcState['co']) => {
    const { data } = await connector.client.auth.getUser();
    const uid = data?.user?.id;
    if (!uid) { setUi({ k: 'refused', why: T('erec.errNotSignedIn') }); return; }
    const id = `co-fw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    try {
      const dec = await recordDecision(db, {
        projectId: origin.project_id, ownerId: uid,
        // Per-follow-on, so two changes after the same approval are two extras and
        // never two versions of one decision (startextra.ts's rule, same reason).
        subject: `extra ${id}`, value: UNTITLED_SCOPE,
        directedBy: origin.who_directed || 'Owner',
      });
      const co = await createLinkedExtra(db, {
        id, decisionId: dec.decisionId, projectId: origin.project_id, ownerId: uid,
        scope: UNTITLED_SCOPE,
        // NULL, never 0 (370): nobody has said a price for the follow-on yet.
        amountCents: null, nteCents: null, lineItems: [],
        whoDirected: origin.who_directed || 'Owner',
        numbersConfirmedAt: new Date(),
        originChangeOrderId: originId,
      });
      if (!co.ok) { setUi({ k: 'refused', why: co.reason }); return; }
      await refresh();
      await openRecord(id);
    } catch (e: any) {
      setFiled(T({ k: 'erec.errFollowOn', p: { why: String(e?.message ?? e) } } as any));
    }
  };

  /**
   * SPEC-extra-lifecycle-v1 — the extra's detail SUBSCREENS (extradetails.tsx).
   *
   * WHERE THIS GUARD SITS, AND WHY IT SITS THERE. Directly ABOVE `if (record)`: a
   * subscreen is strictly a child of an open record and renders that record's data,
   * so it has to win the frame while it is open — below `record` the cascade's first
   * truthy guard would swallow it and the tap would do nothing visible. It is ANDed
   * with `record` and `recordLc` for the same reason a guard should never be able to
   * fire without its data: without them there is nothing to render but a blank
   * screen. It sits BELOW `thread` because a thread opened from the ledger is a
   * different stack and must not be covered by this one.
   */
  if (record && recordLc && detail) {
    const co = recordLc.co;
    const back = () => setDetail(null);
    const d = detail;

    if (d.field === 'history') {
      return (
        <FullHistory
          status={record.status}
          events={recordTimeline}
          formatAt={createdLabel}
          approval={approval}
          total={record.priced ? record.amount : null}
          scheduleLine={scheduleSentence(co.schedule_effect, co.schedule_days)}
          onBack={back}
        />
      );
    }

    if (d.field === 'photos') {
      // Appending evidence is legal in Stages 1 and 2 (the augment log is
      // append-only and never touches the frozen instrument) and forbidden once the
      // record is sealed — REQ-LC30, the same rule the kit follows when it omits its
      // own add tile on a frozen record.
      const mayAppend = stageOf(record.status) !== 'locked';
      return (
        <>
          <PhotosAndProof
            status={record.status}
            photos={record.photos.map((p) => ({
              key: p.captureId, uri: p.uri, present: p.present, at: p.at,
              // The real stamp (mandate #9). `record.ts` now selects gps_lat/gps_lng
              // and formats them; the hardcoded `null` that used to sit here made
              // this screen say "No location was recorded" about every photo on
              // every extra — a specific false claim, on the one screen whose job is
              // proving the evidence.
              place: p.place,
            }))}
            truncated={record.photosTruncated}
            capturedAt={record.capturedAt}
            capturedPlace={record.capturedPlace}
            // No column stores "best photo" anywhere in this build (grepped:
            // is_cover/best_photo/cover_photo/hero_photo — zero hits), so the choosing
            // mode is not offered. A control with nowhere to write is worse than no
            // control: it would look like it saved.
            bestKey={null}
            onPressPhoto={(p) => setZoomUri(p.uri)}
            onAddPhoto={mayAppend ? () => augmentExtra(record.id) : undefined}
            onAddVoiceNote={mayAppend ? () => augmentExtra(record.id) : undefined}
            onBack={back}
          />
          {/* The record's own lightbox, mounted here too: this guard returns before
              RecordScreen renders, so without it a tile on this screen would open
              nothing. One component, two mount points — never two viewers. */}
          <PhotoLightbox uri={zoomUri} onClose={() => setZoomUri(null)} />
        </>
      );
    }


    // description · cost · schedule · billing · exclusions are NOT full screens any
    // more (hadar, 2026-07-31): each opens a focused BOTTOM DRAWER over the record.
    // Falling through here — rather than returning a screen — is what lets the record
    // stay visible behind the sheet.
    //
    // THE ONE-WRITE RULE IS UNCHANGED, and it is the reason each sheet's save merges
    // into the SAME draft before writing: `priceDraftExtra` puts all four fields on
    // one row in a single guarded UPDATE, so every sheet commits the full set with its
    // own field replaced. Four sheets, still one write.
  }

  if (record) {
    // The focused field drawers, rendered OVER the record. `detail` still holds the
    // draft (one object, so one save), and each sheet writes the whole set with its
    // own field replaced — see the one-write rule above.
    const sheetField = detail?.field;
    const sd = detail;
    const sheetCo = recordLc?.co;
    const closeSheet = () => setDetail(null);
    const sheetsEditable = stageOf(record.status) === 'draft';
    // The client drawer stands apart from the field sheets: it writes the ROSTER, and
    // it must be reachable even when no `detail` draft is open.
    const clientRow = recordLc?.clientRow ?? null;
    const clientSheet = clientOpen ? (
      <ClientSheet
        visible
        editable={stageOf(record.status) === 'draft'}
        name={clientRow?.name ?? recordLc?.view.requestedBy ?? null}
        clientType={clientRow?.chainSide ?? null}
        // The job's people first: picking one costs no typing and no contact picker.
        known={(recordLc?.roster ?? []).map((m) => ({
          id: m.id, name: m.name, phone: m.phone, clientType: m.chainSide,
        }))}
        // …then everyone from other jobs. Same shape, second section — see
        // ClientSheet for why this order and not merged into one list.
        everyone={(recordLc?.known ?? []).map((m) => ({
          id: m.id, name: m.name, phone: m.phone, clientType: m.chainSide,
        }))}
        // WHICH question the sheet asks. Without it "Add someone else" opened on
        // the existing client's type question (hadar, 2026-08-05).
        mode={clientOpen ?? 'client'}
        onPickContact={pickContactValue}
        onClose={() => setClientOpen(null)}
        onSave={(v) => { void saveClient(record.id, v, clientOpen ?? 'client'); }}
      />
    ) : null;
    const sheets = sd && recordLc && sheetField ? (
      <>
        {sheetField === 'scope' && <DescriptionSheet
          visible
          editable={sheetsEditable}
          value={sd.scope}
          // THE EDITOR'S CAP IS THE WRITER'S CAP, passed rather than defaulted:
          // `retitleDraft` stores SCOPE_MAX_CHARS, and a sheet that counted to a
          // different number would report a save that silently truncated.
          maxChars={SCOPE_MAX_CHARS}
          notesText={record.voices.map((v) => v.transcript?.trim())
            .filter((s): s is string => !!s).join('\n\n')}
          rewrite={sd.rewrite}
          // THERE IS NO REWRITE BACKEND. Nothing in this app invokes a rewrite
          // endpoint, so the tap FAILS LOUDLY with a stated reason rather than
          // spinning forever — the proposal path is correct and lights up the day an
          // Edge Function exists.
          onRewrite={() => setDetail((x) => x && {
            ...x, rewrite: { phase: 'failed', whyKey: 'det.improveNoService' } })}
          onRewriteDone={() => setDetail((x) => x && { ...x, rewrite: { phase: 'idle' } })}
          onClose={closeSheet}
          onSave={(next) => { void saveScope(record.id, next); }}
        />}
        {sheetField === 'cost' && <CostSheet
          visible
          editable={sheetsEditable}
          priceMode={sd.priceMode}
          amountText={sd.amountText}
          nteText={sd.nteText}
          // Mandate #6's read-back, through the ONE money formatter. Null when the
          // text resolves to no number, which is a different fact from zero.
          amountReadback={centsFromInput(sd.amountText) === null
            ? null : money(centsFromInput(sd.amountText))}
          nteReadback={centsFromInput(sd.nteText) === null
            ? null : money(centsFromInput(sd.nteText))}
          reading={sd.reading}
          // From the ONE readiness authority, never re-derived.
          blockers={recordLc.view.readiness.blockers}
          onClose={closeSheet}
          onSave={(v) => { void savePrice(record.id, sheetCo!, { ...sd, ...v }); }}
        />}
        {sheetField === 'schedule' && <ScheduleSheet
          visible
          editable={sheetsEditable}
          scheduleEffect={sd.scheduleEffect}
          scheduleDaysText={sd.scheduleDaysText}
          onClose={closeSheet}
          onSave={(v) => { void saveFlow(record.id, { ...sd, ...v }); }}
        />}
        {sheetField === 'billing' && <BillingSheet
          visible
          editable={sheetsEditable}
          billingTiming={sd.billingTiming}
          onClose={closeSheet}
          onSave={(v) => { void saveFlow(record.id, { ...sd, ...v }); }}
        />}
        {sheetField === 'exclusions' && <ExclusionsSheet
          visible
          editable={sheetsEditable}
          exclusions={sd.exclusions}
          onClose={closeSheet}
          onSave={(v) => { void saveFlow(record.id, { ...sd, ...v }); }}
        />}
      </>
    ) : null;
    return (
      <>
      {clientSheet}
      {sheets}
      <RecordScreen
        rec={record}
        db={db}
        // The stage layer. Null while its read is in flight (or after it failed) —
        // the screen renders paper for that tick rather than guessing a price mode
        // or a readiness verdict it does not have.
        lifecycle={recordLc && {
          ...recordLc.view,
          // R8's verdict, recomputed HERE and not at load: it depends on whether a
          // client question is open right now, and that count changes under the open
          // record on every refresh tick. Computed once at load it would show a live
          // Remind button over a question the contractor owes an answer to.
          remind: canRemind(record.status, {
            count: recordLc.remindCount,
            lastAtMs: recordLc.remindLastMs,
            // The LEDGER's per-version signal, not the lineage-walked thread: the
            // thread carries prior versions' messages and would block reminding on a
            // fresh revision because of a question already answered on the one it
            // replaced.
            inDiscussion: (questions[record.id] ?? 0) > 0,
          }, Date.now()),
        }}
        approval={approval}
        thread={recordThread}
        openQuestions={questions[record.id] ?? 0}
        undelivered={recordUndelivered}
        onBack={closeRecord}
        onCapture={() => augmentExtra(record.id)}
        // KNOWN LIMITATION, stated rather than hidden: there is no voice-ONLY capture
        // mode. `augmentExtra` opens the fused REQ-CAP-FUSED screen, which does record
        // voice — so this is the right destination, not a stand-in. What it is not is a
        // shortcut straight to the recorder. The button previously carried the camera's
        // accessibility label, so a screen reader announced "add photo" on the mic.
        onAddVoice={() => augmentExtra(record.id)}
        delivery={recordDelivery}
        // GRANTED FROM THE SCREEN IT IS BLOCKING (hadar 2026-08-06: the user has to be
        // able to solve this). The cellular default is OFF for a good reason — a 200 MB
        // walkthrough over a hotspot is a bill nobody agreed to — but a contractor who
        // has decided THIS extra is worth the data should not have to find a toggle in
        // Settings he has never seen. Same act, same store, offered where it bites; and
        // it kicks the drain immediately so the permission has a visible result.
        onAllowCellular={async () => {
          await setCellularConsent(db, true);
          setCellOn(true);
          const ids = [...record.voices.map((v) => v.captureId),
                       ...record.photos.map((ph) => ph.captureId)];
          await redriveNow(db, ids);
          const { data } = await connector.client.auth.getSession();
          const uid = data?.session?.user?.id;
          if (uid) await drainOutbox(db, connector.client, uid);
          setRecordDelivery(await captureDelivery(db, ids));
        }}
        // GENERATE THE CHANGE ORDER — the draft screen's button while the pipeline is
        // still running. It re-enters the SAME processing screen a fresh capture uses
        // rather than inventing a second path: that screen pushes what is still queued
        // (now with `redriveNow`, so a backed-off row is retried immediately), watches
        // for the transcript and the AI pass, and hands off to the composer when they
        // land. `isAugment: false` because this extra has never been finished — the
        // outcome is the composer, not an appended description.
        // 396 — THE READ-BACK. Composed here because this is where `parseMoney` lives
        // (one parser in the app, not one per screen) and where the write happens. The
        // screen shows his words and the figure; this is the only thing that can turn a
        // tap into an amount, and it goes through `priceDraftExtra` — the same path the
        // composer uses — so a confirmed price is stamped `numbers_confirmed_at` like
        // every other one. Null when nothing was said, or a price already exists.
        priceHeard={(() => {
          const words = record.priceHeard;
          if (!words) return null;
          const parsed = parseMoney(words);
          // A quote we cannot read CONFIDENTLY is not shown as a figure. It stays in the
          // transcript where he can see it, and he types the number himself — offering
          // a shaky reading of "fourteen fifty" as a tappable price is the exact failure
          // mandate #6 names, and `parseMoney` reports its own confidence for this.
          if (parsed.cents == null || parsed.confidence !== 'high') return null;
          const cents = parsed.cents;
          return {
            words,
            label: money(cents),
            onUse: async () => {
              const co = coRowsRef.current.find((c) => c.id === record.id);
              await priceDraftExtra(db, {
                changeOrderId: record.id,
                amountCents: cents,
                whoDirected: co?.who_directed || 'Owner',
                numbersConfirmedAt: new Date(),
              });
              await refresh();
              await openRecord(record.id);
            },
          };
        })()}
        onGenerate={() => {
          const r = record;
          if (!r) return;
          const ids = [...r.voices.map((v) => v.captureId), ...r.photos.map((ph) => ph.captureId)];
          // Nothing to push and nothing to watch: a text-only extra has no capture the
          // poller could wait on, so the screen would sit at 0 of 0 forever. Say so
          // instead of opening it.
          if (!ids.length) { setFiled(T('draft.generateNothing')); return; }
          const coId = r.id;
          setRecord(null); setApproval(null); setRecordLc(null); setRecordTimeline([]);
          setTransition({
            ids, anchorCaptureId: r.voices[0]?.captureId ?? null, coId,
            uploaded: false, transcribed: r.voices.length === 0, analyzed: false,
            offline: false, stalled: false, uploadDone: 0, uploadTotal: ids.length,
            lastError: null, blocked: false, isAugment: false, isGenerate: true,
          });
        }}
        // THE GATES ARE NOT RE-STATED HERE. The draft screen composes all three
        // (stage `canSend` · content `sendReadiness` · pipeline `canSendExtra`) and
        // disables its own button with the reason printed above it, so this handler
        // is the ACT and not a second copy of the decision. What it still needs is
        // the ledger row: `openSendPrep` derives the recipient from the OPEN
        // project's roster, so a record reached from another job says so instead of
        // opening a preview addressed to the wrong job's people.
        onSend={() => {
          const r = coRowsRef.current.find((c) => c.id === record.id);
          if (!r) {
            setFiled(T('erec.errWrongJob'));
            return;
          }
          // Land on the JOB screen (where the send-preview Modal mounts) and return
          // to this detail page after the send (returnRecordId).
          setReturnRecordId(record.id); setNav('project'); closeRecord(); void openSendPrep(r);
        }}
        // Mandate #2: a reply is a MESSAGE. It commits nothing and prices nothing —
        // and it must never move the extra's status. REQ-LC23's `canReply` is
        // `coStatus === 'sent'` and it is enforced by `threadState` INSIDE the
        // screen; the status test that used to stand here was a second copy of it,
        // and it disagreed (it allowed approved and declined, which 308's server
        // trigger rejects, parking the reply forever while the UI showed it sent).
        onReply={async (text: string) => {
          const pr = await postReply(db, { changeOrderId: record.id, body: text, ownerId: OWNER });
          // postReply reports failure as a value, not a throw. Throwing here is what
          // keeps the typed words in the composer and puts the reason on screen.
          if (!pr.ok) throw new Error(pr.reason);
          setRecordThread(await threadFor(db, record.id));
          setRecordUndelivered(await undeliveredReplyIds(db));
          void refresh();
        }}
        // R8: remind. The verdict above decides whether the button is live; this is
        // the act, and `remindExtra` re-checks and returns its own refusal (no live
        // link, rate limit, a cancelled share sheet) for the screen to print.
        onRemind={() => remindExtra(
          { id: record.id, status: record.status, scope: record.title, amount: record.amount },
          (questions[record.id] ?? 0) > 0)}
        // REQ-LC22. `threadState.canRevise` (which is `canSupersede`) decides inside
        // the screen; the old `canSupersede(record.status) && row` here was that rule
        // stated twice, and the `row` half of it silently removed Revise from every
        // record opened cross-project.
        onRevise={() => {
          const c = recordLc?.co;
          if (!c) { setFiled(T('erec.errStillLoading')); return; }
          closeRecord(); startRevision(c);
        }}
        onOpenDetail={(field) => openDetail(field)}
        // Rename from the header, in place. `retitleDraft`'s own WHERE status='draft'
        // is the guard (REQ-LC14/LC8) — a refused write is REPORTED, never swallowed.
        // The HEADER rename writes the title. Separate from saveScope since 391;
        // before that both wrote `scope` and each silently overwrote the other.
        onRetitle={(next) => { void saveTitle(record.id, next); }}
        // The job's OTHER people — everyone on the roster except whoever is already
        // rendered above as "Requested by". Matched on the same normalised name the
        // client lookup uses, so the person named at the top is never repeated in the
        // list below. Display only: nothing here is an actor on this extra.
        onRemovePerson={removePerson}
        jobPeople={(recordLc?.roster ?? [])
          .filter((m) => {
            const norm = (x: string) => x.trim().toLowerCase().replace(/\s+/g, ' ');
            const client = clientRow?.name ?? recordLc?.view.requestedBy ?? '';
            return !client || norm(m.name) !== norm(client);
          })
          .map((m) => ({ id: m.id, name: m.name, role: roleLabel(m.role) }))}
        onEditClient={() => setClientOpen('client')}
        onAddContact={() => setClientOpen('contact')}
        // What they ARE on this job, from the roster answer. Absent until somebody
        // has chosen — the row then says the generic "Approver" rather than
        // inventing a position nobody picked.
        clientTypeLabel={clientRow?.chainSide
          ? T(`client.type.${clientRow.chainSide}` as any) : null}
        onViewHistory={() => openDetail('history')}
        // The whole price/details composer — FLOW step 3, the same one the ledger
        // and the post-capture path use.
        // Same trap as `augmentExtra`: the composer renders on the JOB screen, which
        // the feed guard sits above. Without cancelling the feed return, tapping
        // "Edit details" on an extra opened from the company feed lands the user back
        // on the feed with the composer mounted underneath it.
        onEditDetails={() => {
          returnToFeedRef.current = false;
          closeRecord();
          void finishExtraById(record.id);
        }}
        onCreateLinkedExtra={() => {
          const c = recordLc?.co;
          if (!c) { setFiled(T('erec.errStillLoading')); return; }
          void createFollowOnExtra(record.id, c);
        }}
        // Mandate #2: this writes a file and opens the OS share sheet. It does not
        // transmit anything to a client, and must never be changed to.
        onViewSignedApproval={() => {
          // SHOW it, then let the reader decide to export. Going straight to the share
          // sheet exported a document nobody had seen.
          void (async () => {
            try { setApprovalDoc({ doc: await buildApprovalDoc(db, record.id) }); }
            catch { setApprovalDoc({ doc: null }); }
          })();
        }}
        onOpenCurrent={recordNextId
          ? () => { void openRecord(recordNextId); } : undefined}
        // REQ-LC14 / T5: destruction is legal in Stage 1 only, and `canDelete` is the
        // single authority for that — `record.status === 'draft'` here was the same
        // rule written a second time. Undefined hides the control entirely rather
        // than showing something that refuses.
        onDelete={canDelete(record.status) ? async () => {
          // Wrapped because it was not: previewDiscard threw on a column that
          // does not exist and this tap died silently (2026-07-23). A delete
          // that fails must SAY so.
          try {
            const plan = await previewDiscard(db, record.id);
            const row = coRowsRef.current.find((c) => c.id === record.id);
            setRecord(null);
            setDiscard({ co: row ?? ({ id: record.id, scope: record.title } as any), plan });
          } catch (e: any) {
            setFiled(T({ k: 'erec.errDeleteOpen', p: { why: String(e?.message ?? e) } } as any));
          }
        } : undefined}
      />
      {discardSheet}
      {/* The signed document. Mounted AFTER the screen: a Modal declared before its
          sibling content does not present on iOS (found the hard way, 2026-07-31). */}
      {approvalDoc && (
        <ApprovalDocSheet
          visible
          doc={approvalDoc.doc?.doc ?? null}
          labels={approvalDoc.doc?.labels ?? null}
          onClose={() => setApprovalDoc(null)}
          onShare={() => { void shareApprovalDoc(db, record.id); }}
        />
      )}
      </>
    );
  }

  // ── THE ONE BOTTOM NAV ────────────────────────────────────────────────────
  // Home · Jobs · + (capture) · Company · Activity. Defined once so every screen that
  // shows it (Feed, Home, Jobs, Job) can never drift. Declared HERE, above the first
  // screen that renders it (the feed), because a `const` is not hoisted — a use before
  // this line is a temporal-dead-zone crash. `absolute` pins it over a plain-View
  // screen (the Job screen); the others use it as a flex child at the column's foot.
  const bottomNav = (active: 'home' | 'jobs' | 'activity' | 'company' | null, absolute: boolean) => (
    <View style={absolute
      ? [s.tabBar, { position: 'absolute' as const, left: -20, right: -20, bottom: 0 }]
      : s.tabBar}>
      {/* Two equal halves flank the FAB so it sits DEAD CENTER (hadar: rebalance).
          Left: Home + Jobs. Right: Company (the feed) + Profile (opens the ☰ drawer —
          hadar 2026-07-28, replacing the Activity tab; Home's buckets and the Company
          feed already cover what Activity listed). Every nav tab clears showFeed, so
          switching away from the feed actually leaves it. */}
      <View style={s.tabHalf}>
        <Pressable style={s.tab} accessibilityLabel={T('home.navHome')}
          onPress={() => { closeFeed(); setNav('home'); setJobFilter(null); void refresh(); }}>
          <Icon name="home" size={22} color={active === 'home' ? '#151A1E' : '#8A93A0'} />
          <Text style={[s.tabLab, active === 'home' && s.tabLabOn]}>{T('home.navHome')}</Text>
        </Pressable>
        <Pressable style={s.tab} accessibilityLabel={T('home.navJobs')}
          onPress={() => { closeFeed(); setNav('jobs'); void refresh(); }}>
          <Icon name="job" size={22} color={active === 'jobs' ? '#151A1E' : '#8A93A0'} />
          <Text style={[s.tabLab, active === 'jobs' && s.tabLabOn]}>{T('home.navJobs')}</Text>
        </Pressable>
      </View>
      <Pressable style={[s.fab, (!!gate || !!initError) && s.btnOff]}
        disabled={!!gate || !!initError} hitSlop={8}
        accessibilityLabel={T('home.recordExtra')}
        onPress={() => { if (!terms) { openTerms(); return; } setShowCapture(true); }}>
        <Icon name="extra" size={26} color="#fff" />
      </Pressable>
      <View style={s.tabHalf}>
        <Pressable style={s.tab} accessibilityLabel={T('feed.title')}
          onPress={() => void openFeed()}>
          <Icon name="feed" size={22} color={active === 'company' ? '#151A1E' : '#8A93A0'} />
          <Text style={[s.tabLab, active === 'company' && s.tabLabOn]}>{T('home.navCompany')}</Text>
        </Pressable>
        {/* Profile opens the ☰ drawer (the account / settings / plan / support hub).
            It is an OVERLAY, not a destination, so it never carries an `active` state —
            the drawer element is mounted on every screen that renders this bar. */}
        <Pressable style={s.tab} accessibilityLabel={T('home.navProfile')}
          onPress={() => setMenuOpen(true)}>
          <Icon name="person" size={22} color="#8A93A0" />
          <Text style={s.tabLab}>{T('home.navProfile')}</Text>
        </Pressable>
      </View>
    </View>
  );

  // The ☰ drawer, defined ONCE and mounted on every screen that shows the bottom bar —
  // because the Profile tab (which opens it) lives in that shared bar. Previously the
  // drawer was only on Home and the Company feed, so a Profile tap from Jobs or a Job
  // screen would have opened nothing.
  const drawerEl = (
    <Drawer
      visible={menuOpen}
      onClose={() => setMenuOpen(false)}
      onProfile={() => void openSettings('profile')}
      onCompanySettings={() => void openSettings('company')}
      onPlans={() => void openPaywall()}
      onInbox={async () => { setInboxRows(await listCommittedCaptures(db, INBOX_ID)); setInboxOpen(true); }}
      inboxCount={inbox}
      planName={T(('plan.' + planId) as any)}
      usage={usage}
      isFreePlan={planId === 'free'}
      isOwner={isOwner}
      lang={lang}
      onToggleLang={async () => {
        const n: Lang = lang === 'en' ? 'es' : 'en';
        setLang(n); setLangState(n); await saveLang(db, n);
      }}
      appVersion={(appJson as any)?.expo?.version ?? '1.0.0'}
      buildLabel={buildLine({
        version: (appJson as any)?.expo?.version ?? '1.0.0',
        updateId: ota.updateId,
        embedded: ota.embedded,
      })}
      updateReady={ota.canRestart}
      onApplyUpdate={() => { setMenuOpen(false); void ota.restart(db); }}
      onCheckUpdates={ota.checkNow}
      confirmBase={CONFIRM_BASE}
      onSignOut={async () => { setMenuOpen(false); await connector.signOut(); }}
    />
  );

  // REQ-PM9 — Company feed: every extra across every project, newest first. Now a
  // first-class bottom-nav tab ("Company"), not a drawer overlay — so its header
  // carries the ☰ menu (not a back arrow) and it shows the bottom nav (hadar 2026-07-27).
  if (showFeed) {
    return (
      <View style={s.homeC}>
        <View style={s.dashHdr}>
          <Pressable style={s.hdrBtn} onPress={() => setMenuOpen(true)}
            accessibilityLabel={T('home.menu')} hitSlop={10}>
            <Text style={s.hdrIcon}>☰</Text>
          </Pressable>
          <Text style={s.hdrTitle}>{T('feed.title')}</Text>
          <View style={s.hdrBtn} />
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 96 }}
          refreshControl={<RefreshControl refreshing={pulling} onRefresh={onPullRefresh} tintColor={C.steel} />}>
          {feedItems.length === 0 && <Text style={s.homeEmpty}>{T('feed.empty')}</Text>}
          {(() => {
          // Group the (already newest-first) feed by calendar day: Today, Yesterday,
          // then written dates. A day header is emitted whenever the day changes as we
          // walk down the list. Undated rows (atMs 0) fall into one "Earlier" bucket at
          // the end rather than a bogus 1970 date.
          const nowMs = Date.now();
          let prevKey: string | null = null;
          return feedItems.map((f) => {
            const dayKey = f.atMs > 0 ? feedDayKey(f.atMs) : 'undated';
            const showHead = dayKey !== prevKey;
            prevKey = dayKey;
            const chip = coChip(displayStatus(f.status, { openQuestions: f.openQuestions }) as any);
            // WHO did WHAT — the verb is the feed's most useful signal, not just the name.
            const actLabel = (f.lastAct && f.actor)
              ? T({ k: 'feed.act.' + f.lastAct, p: { name: f.actor } } as any)
              : (f.actor ?? '');
            const meta = [f.projectName, actLabel].filter(Boolean).join(' · ');
            return (
              <React.Fragment key={f.id}>
              {showHead && (
                <Text style={s.feedDayHead}>
                  {f.atMs > 0 ? feedDayLabel(f.atMs, nowMs) : T('feed.earlier')}
                </Text>
              )}
              <Pressable style={s.jobItem}
                onPress={() => { returnToFeedRef.current = true; setShowFeed(false); setProjectId(f.projectId); void openRecord(f.id); }}>
                <View style={{ flex: 1 }}>
                  <Text style={s.jobItemName} numberOfLines={1}>{f.scope}</Text>
                  {!!meta && <Text style={s.jobItemMeta} numberOfLines={1}>{meta}</Text>}
                </View>
                {/* Right column: time never truncates (it is the sort key), amount + status. */}
                <View style={{ alignItems: 'flex-end', marginLeft: 8 }}>
                  {f.atMs > 0 && (
                    <Text style={{ fontFamily: 'Barlow_400Regular', fontSize: 11, color: '#8c959f' }}>
                      {createdLabel(f.atMs)}
                    </Text>
                  )}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
                    {f.amountCents != null && (
                      <Text style={{ fontFamily: 'Barlow_600SemiBold', fontSize: 12.5, color: '#151A1E' }}>{money(f.amountCents)}</Text>
                    )}
                    <View style={[{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 }, chip.bg]}>
                      <Text style={{ fontFamily: 'Barlow_600SemiBold', fontSize: 10.5, color: chip.dark ? '#151A1E' : '#fff' }}>
                        {chip.label}
                      </Text>
                    </View>
                  </View>
                </View>
              </Pressable>
              </React.Fragment>
            );
          });
          })()}
        </ScrollView>
        {bottomNav('company', false)}
        {drawerEl}
        {/* Feed can open the drawer too, so it needs the modals the drawer opens. */}
        {quotaEl}
        {paywallEl}
      </View>
    );
  }

  // Settings / Team — profile editing + company membership (hadar 2026-07-25).
  if (showSettings && settingsProfile) {
    return (
      <SettingsScreen
        db={db} supabase={connector.client} userId={OWNER} profile={settingsProfile}
        lang={lang} mode={settingsMode} confirmBase={CONFIRM_BASE}
        onSaveProfile={async (p) => { await saveProfile(connector, db, p); setSettingsProfile(p); await refresh(); }}
        onSetLang={async (l) => { setLang(l); setLangState(l); await saveLang(db, l); }}
        onOpenPlans={() => { setShowSettings(false); void openPaywall(); }}
        onBack={() => setShowSettings(false)}
      />
    );
  }

  // REQ-CAP-FUSED: the fused photo+voice capture screen overlays everything when open.
  if (showCapture) {
    // Augment mode: the captures attach to an existing extra and never mint a new
    // one. Everything else about the screen is identical.
    const augId = augmentCoId;
    return (
      <FusedCapture
        db={db}
        ownerId={OWNER}
        projectName={projects.find((p) => p.id === projectId)?.name ?? 'EZchangeorder'}
        onCapture={augId ? (a) => onAugmentCapture(augId, a) : onFusedCapture}
        onClose={() => { setShowCapture(false); setAugmentCoId(null); }}
        resolveLabel={resolveStampLabel}
      />
    );
  }

  // The one status derivation + chip palette, shared by Home and Activity so a
  // "Waiting" pill reads identically wherever an extra appears (was duplicated
  // inside the Activity block; lifted here 2026-07-26 so Home's rows match the
  // mockup's Needs-you / Waiting / Approved chips).
  type Extra = (typeof homeExtras)[number];
  const stateOf = (e: Extra): 'approved' | 'declined' | 'draft' | 'needs' | 'waiting' =>
    e.status === 'approved' ? 'approved'
    : e.status === 'declined' ? 'declined'
    : e.status === 'draft' ? 'draft'
    : e.questions > 0 ? 'needs' : 'waiting';
  const stateColor: Record<string, { bg: string; fg: string; emoji: string; label: string }> = {
    waiting:  { bg: 'rgba(164,122,63,0.13)', fg: '#A47A3F', emoji: '⏳', label: T('act.chipWaiting') },
    needs:    { bg: 'rgba(109,127,137,0.14)', fg: '#5E7079', emoji: '💬', label: T('act.chipNeeds') },
    approved: { bg: '#E7ECDD',                fg: '#536B49', emoji: '✅', label: T('act.chipApproved') },
    draft:    { bg: '#EFEBE3',                fg: '#5E666E', emoji: '📝', label: T('act.chipCreated') },
    declined: { bg: 'rgba(139,81,72,0.13)',  fg: '#8B5148', emoji: '✋', label: T('act.chipDeclined') },
  };
  // Outlined status pill for the Home rows — the mockup's look (thin colored
  // border + colored text, no fill), in the design-system palette (global.css).
  const chipStyle: Record<string, { border: string; text: string }> = {
    waiting:  { border: '#efd667', text: '#8a6d1f' },  // butter-400 border, amber text
    needs:    { border: '#c3bab2', text: '#3d3733' },  // ink-300 border, ink-700 text
    approved: { border: '#3bbe77', text: '#157a47' },  // mint-500 border, mint-700 text
    draft:    { border: '#c3bab2', text: '#6b625b' },
    declined: { border: '#e0a59c', text: '#8B5148' },
  };

  // One Home extra row (mockup parity): a cover-photo thumbnail (falls back to the
  // status emoji when a capture has no photo yet), scope + project, the price, and
  // an outlined status chip. A draft keeps its "Finish & send →" call to action
  // instead of a chip — it is the creator's to move, not the client's.
  /**
   * Ask the store what deleting this row would actually do, then open the SAME
   * confirmation every other delete path uses. previewDiscard gathers the facts and
   * planDiscard decides — so a row that was sent, or whose captures are shared with a
   * revision, is refused with its real reason rather than by a guess made here.
   */
  const askDeleteExtra = async (e: Extra) => {
    try {
      const plan = await previewDiscard(db, e.id);
      setDiscard({ co: { id: e.id, scope: e.scope || T('home.draftsSec') } as any, plan });
    } catch {
      // Could not read the facts -> do not offer a destructive action on a guess.
    }
  };

  // ONE ROW = WHAT IT IS · WHERE · HOW MUCH · WHOSE COURT (hadar 2026-08-06:
  // "simplify them"). The 64pt thumbnail is gone: on a list of extras it was a
  // photo of a wall, repeated ten times, and it pushed the three facts that
  // actually distinguish one row from another into a narrow column. Where a photo
  // matters is the record itself, one tap away — which is what the chevron says.
  // `i` is the index map() already passes; it only decides the hairline, so the
  // first row of a group does not draw a rule against the container's own edge.
  const extraRow = (e: Extra, i: number) => {
    const st = stateOf(e);
    const cp = chipStyle[st];
    // Only a DRAFT is the owner's alone to destroy (discard.ts): once an extra is
    // sent, a counterparty may have opened it and answered, and that is their
    // evidence too. A non-draft row simply does not move.
    const row = (
      <Pressable key={e.id} style={[s.exRow, i > 0 && s.exRowRule]}
        onPress={() => { setProjectId(e.project_id); void openRecord(e.id); }}>
        <View style={{ flex: 1 }}>
          {/* Two lines, not one: a real scope ("Panel upgrade — code required")
              is longer than one phone line, and truncating it hides the words
              that tell the two panel extras apart. */}
          <Text style={s.exName} numberOfLines={2}>{e.scope || T('home.draftsSec')}</Text>
          {/* WHERE · WHEN, on one line. The date was missing entirely, so two extras
              on the same job were told apart only by their price — and "which one did
              I send last week" had no answer on this screen at all. Built by joining
              what exists rather than nesting conditionals, so an extra with no job
              still shows its date instead of dropping the whole line. */}
          {(() => {
            const meta = [e.pname, shortDate(e.created_at_ms)].filter(Boolean).join(' · ');
            return meta ? <Text style={s.exSub} numberOfLines={1}>{meta}</Text> : null;
          })()}
          {e.amount_cents != null && <Text style={s.exPrice}>{money(e.amount_cents)}</Text>}
        </View>
        {/* EVERY row ends the same way: a status, not an action (hadar 2026-08-06).
            A draft used to carry a green "Finish & send →" button, which read as the
            one thing on the row you were meant to press — while the row itself, the
            chevron, and the button all did exactly the same thing. One tap target,
            stated once. What a draft needs to say here is where it stands: not sent. */}
        <View style={[s.exChip, { borderColor: cp.border }]}>
          <Text style={[s.exChipT, { color: cp.text }]}>
            {st === 'draft' ? T('home.notSent') : stateColor[st].label}
          </Text>
        </View>
        <Text style={s.exChev}>›</Text>
      </Pressable>
    );
    return (
      <SwipeRow key={e.id} enabled={st === 'draft'} onDelete={() => void askDeleteExtra(e)}>
        {row}
      </SwipeRow>
    );
  };

  // ── SHARED OVERLAYS ───────────────────────────────────────────────────────
  // The activity centre and the draft-recovery card must reach the user on HOME,
  // not only inside a project: Home is the landing now, and a recoverable draft is
  // the one thing on the phone that can still be LOST (mandate #1). Defined once
  // and rendered in both the Home and Project trees — the early-return structure
  // rules out a single shared wrapper without a larger refactor.
  const activityOverlay = bell ? (
    <View style={s.card}>
      <Text style={s.cardH}>{T('r8.activity')}</Text>
      {notifyPerm && notifyPerm !== 'granted' && (
        <View style={s.coSendRow}>
          <Text style={s.cardNote}>{T('r8.pushWhy')}</Text>
          {notifyPerm === 'denied'
            ? <Text style={s.dmeta}>{T('r8.pushDenied')}</Text>
            : <Pressable onPress={async () => setNotifyPerm(await requestNotifyPermission())}>
                <Text style={s.coNudge}>{T('r8.pushAsk')}</Text>
              </Pressable>}
        </View>
      )}
      {!activity.length && <Text style={s.cardNote}>{T('r8.nothingYet')}</Text>}
      {activity.slice(0, 40).map((a) => (
        <Pressable key={a.id} style={s.coSendRow} onPress={async () => {
          await markRead(db, [a.id]);
          await openRecord(a.changeOrderId);
          setBell(false);
          await refresh();
        }}>
          <Text style={a.read ? s.dval : s.coNudge}>
            {a.kind === 'question' ? '💬 ' : a.kind === 'unpriced' ? '⏱ ' :
             a.kind === 'approved' ? '✅ ' : a.kind === 'declined' ? '✋ ' : '→ '}
            {a.kind === 'unpriced' ? T('r3.unpricedRow') + ' — ' : ''}{a.scope}
          </Text>
          <Text style={s.dmeta}>
            {a.jobName}{a.detail ? ` · ${a.detail}` : ''} · {createdLabel(a.atMs)}
          </Text>
        </Pressable>
      ))}
      {unreadIds(activity).length > 0 && (
        <Pressable style={s.later} onPress={async () => {
          await markRead(db, unreadIds(activity)); await refresh();
        }}>
          <Text style={s.laterT}>{T('r8.markAllRead')}</Text>
        </Pressable>
      )}
      <Pressable style={s.later} onPress={() => setBell(false)}>
        <Text style={s.laterT}>{T('common.close')}</Text>
      </Pressable>
    </View>
  ) : null;
  const draftsOverlay = drafts.length > 0 ? (
    <DraftRecoveryCard
      drafts={drafts}
      busyId={draftBusy}
      onKeep={async (d) => {
        setDraftBusy(d.draftId);
        try {
          const a = await readDraftArtifacts(db, d.draftId);
          await onFusedCapture({
            photos: a.photos, audioSegments: a.audioSegments, stamp: a.stamp,
            previewUris: a.previewUris, durationSecs: a.durationSecs,
          });
          await closeDraft(db, d.draftId, 'committed');
        } catch (e: any) {
          setUi({ k: 'refused', why: String(e?.message ?? e) });
        } finally {
          setDraftBusy(null);
          setDrafts(await recoverableDrafts(db, OWNER));
        }
      }}
      onDiscard={async (d) => {
        setDraftBusy(d.draftId);
        await closeDraft(db, d.draftId, 'discarded');
        setDraftBusy(null);
        setDrafts(await recoverableDrafts(db, OWNER));
      }}
    />
  ) : null;

  // ── PROJECTS HOME ─────────────────────────────────────────────────────────
  // CompanyCam's organising idea: you land on your JOBS, each shown by its most
  // recent photo, and you dive into one to capture. Filing is by GPS underneath,
  // so this list is navigation, not the thing that decides where a capture goes.
  if (nav === 'home') {
    const now = Date.now();
    // Buckets by "whose court is the ball in". NEEDS YOU is everything in YOUR court:
    // an unfinished draft (yours to finish and send) AND a sent extra the client has
    // asked a question about (yours to answer) — hadar 2026-07-27, drafts used to sit
    // in a separate section at the bottom. A sent extra with no question is the
    // client's to approve; approved is done.
    const questioned = homeExtras.filter((e) => e.status === 'sent' && e.questions > 0);
    const needs = homeExtras.filter((e) =>
      e.status === 'draft' || (e.status === 'sent' && e.questions > 0));
    const waitingList = homeExtras.filter((e) => e.status === 'sent' && e.questions === 0);
    const approvedList = homeExtras.filter((e) => e.status === 'approved');
    // The hero totals money still OUT ON THE CLIENT — sent only. A draft has never
    // left the phone, so it is NOT "waiting for approval" and must not inflate this.
    const outstanding = [...questioned, ...waitingList].reduce((sum, e) => sum + (e.amount_cents ?? 0), 0);
    const outstandingN = questioned.length + waitingList.length;
    const startCapture = () => { if (!terms) { openTerms(); return; } setShowCapture(true); };
    // Tapping a summary chip filters the list BELOW IT — no navigation. Tapping the
    // live chip again clears the filter.
    const toggleFilter = (f: 'needs' | 'waiting' | 'approved') =>
      setHomeFilter((cur) => (cur === f ? null : f));
    const disabled = !!gate || !!initError;
    return (
      <View style={s.homeC}>
        {discardSheet}
        {/* Header: menu · Home · activity bell (mockup 2026-07-23). */}
        <View style={s.dashHdr}>
          <Pressable style={s.hdrBtn} onPress={() => setMenuOpen(true)}
            accessibilityLabel={T('home.menu')} hitSlop={10}>
            <Text style={s.hdrIcon}>☰</Text>
          </Pressable>
          <Text style={s.hdrTitle}>{T('home.title')}</Text>
          <Pressable style={s.hdrBtn} hitSlop={10}
            accessibilityLabel={T('r8.activity')}
            onPress={async () => { setBell(true); setNotifyPerm(await notifyPermissionStatus()); }}>
            <Icon name="remind" size={22} color="#151A1E" />
            {unreadCount(activity) > 0 && (
              <View style={s.hdrBadge}><Text style={s.hdrBadgeT}>{unreadCount(activity)}</Text></View>
            )}
          </Pressable>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}
          refreshControl={<RefreshControl refreshing={pulling} onRefresh={onPullRefresh} tintColor={C.steel} />}>
          {/* Hero — the money outstanding on the client, across every job. Design
              system: Oswald caps label, huge Oswald figure, Inter sub. The house
              illustration (assets/house-hero.png) sits top-right. */}
          <View style={s.heroWrap}>
            <Image source={require('./assets/house-hero.png')} style={s.houseArt}
              resizeMode="contain" />
            <Text style={s.heroLabel}>{T('home.heroLabel')}</Text>
            {/* One line, whole dollars, and it SHRINKS to fit its column instead of
                running under the house art — "$300,000" is 8 chars and used to
                collide (hadar 2026-07-27). */}
            <Text style={s.heroBig} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.45}>
              {moneyWhole(outstanding)}
            </Text>
            <Text style={s.heroSub}>
              {outstandingN === 0 ? T('home.awaitNone')
                : T({ k: 'home.acrossN', p: { n: outstandingN } })}
            </Text>
            {/* The money already won — the single most motivating number. */}
            {recovered.n > 0 && (
              <View style={s.recoverPill}>
                <Icon name="approved" size={15} color="#157a47" />
                <Text style={s.recoverPillT}>
                  {T({ k: 'home.recoveredInline', p: { amount: money(recovered.cents) } })}
                </Text>
              </View>
            )}
          </View>

          {/* SUBSCRIPTION STATE, one line, only when it matters (hadar 2026-08-04).
              BELOW the hero deliberately: above it, a banner pushes the money figure
              down and reads as an error state. Here it is the first thing after the
              headline number, which is where a decision about the account belongs.
              Renders nothing at all while there is room — an always-on usage bar
              becomes furniture, and furniture does not convert. */}
          <UsageNudge summary={usage} onUpgrade={() => void openPaywall()} />

          {/* CAPTURE FIRST — the trigger moment is "get this down before it slips",
              so recording starts before any job is chosen. GPS files it after. */}
          <Pressable style={[s.ctaCard, disabled && s.btnOff]} disabled={disabled}
            onPress={startCapture}>
            <Image source={require('./assets/icon-camera-cut.png')} style={s.ctaCamera}
              resizeMode="contain" />
            <View style={{ flex: 1 }}>
              <Text style={s.ctaTitle}>{T('home.recordExtra')}</Text>
              <Text style={s.ctaSub}>{T('home.recordSub')}</Text>
            </View>
          </Pressable>

          {/* Summary chips (mockup): a glance at what needs you / is out / is won.
              Tapping one filters the sections below IN PLACE; the live chip is ringed
              and tapping it again clears. Never navigates. */}
          <View style={s.sumRow}>
            <Pressable style={[s.sumChip, s.sumNeeds, homeFilter === 'needs' && s.sumChipOn]}
              accessibilityState={{ selected: homeFilter === 'needs' }}
              onPress={() => toggleFilter('needs')}>
              <Text style={s.sumChipT}>{T('act.chipNeeds')}</Text>
              <View style={[s.sumCount, s.sumCountDark]}>
                <Text style={s.sumCountT}>{needs.length}</Text>
              </View>
            </Pressable>
            <Pressable style={[s.sumChip, s.sumWait, homeFilter === 'waiting' && s.sumChipOn]}
              accessibilityState={{ selected: homeFilter === 'waiting' }}
              onPress={() => toggleFilter('waiting')}>
              <Text style={[s.sumChipT, s.sumWaitT]}>{T('act.chipWaiting')}</Text>
              <View style={[s.sumCount, s.sumCountWait]}>
                <Text style={s.sumCountT}>{waitingList.length}</Text>
              </View>
            </Pressable>
            <Pressable style={[s.sumChip, s.sumOk, homeFilter === 'approved' && s.sumChipOn]}
              accessibilityState={{ selected: homeFilter === 'approved' }}
              onPress={() => toggleFilter('approved')}>
              <Text style={[s.sumChipT, s.sumOkT]}>{T('act.chipApproved')}</Text>
              <View style={s.sumCheck}>
                <Text style={s.sumCheckT}>✓</Text>
              </View>
            </Pressable>
          </View>

          {/* Status sections in the mockup's order (waiting out first, then what needs
              you, the running win, and finally your own drafts). Header is an uppercase
              Oswald label + a "See all" link into the filtered Activity tab. Each row
              is the shared extraRow. Drafts have no Activity filter, so no "See all". */}
          {(() => {
            // A filter hides the other sections. "See all" focuses this one; while
            // focused the link flips to "Show all" and clears — both in place.
            const bucket = (labelKey: string, f: 'needs' | 'waiting' | 'approved' | null, list: Extra[]) => {
              if (!list.length) return null;
              if (homeFilter && homeFilter !== f) return null;
              const focused = homeFilter === f;
              return (
                <React.Fragment key={labelKey}>
                  <View style={s.secHead}>
                    <Text style={s.secLab}>{T(labelKey)}</Text>
                    {f && (
                      <Pressable onPress={() => setHomeFilter(focused ? null : f)} hitSlop={8}>
                        <Text style={s.seeAll}>{focused ? T('home.showAll') : T('home.seeAll')}</Text>
                      </Pressable>
                    )}
                  </View>
                  {/* ONE card per section, not one per row. Ten bordered cards on a
                      cream page is ten edges, ten gutters and ten shadows competing
                      with the content; a section is a single quiet surface with
                      hairlines inside it (hadar 2026-08-06: "make the background
                      cleaner"). */}
                  <View style={s.exGroup}>{list.map(extraRow)}</View>
                </React.Fragment>
              );
            };
            // A filter that matches nothing would otherwise paint a blank page — and
            // 'needs' is now the DEFAULT, so that is the common case for a user with
            // extras but nothing awaiting them. Say so, and say how to get out.
            const shown = { needs, waiting: waitingList, approved: approvedList };
            return (<>
              {bucket('home.waitingForYes', 'waiting', waitingList)}
              {bucket('home.needsResponse', 'needs', needs)}
              {bucket('home.approvedSec', 'approved', approvedList)}
              {homeFilter && shown[homeFilter].length === 0 && homeExtras.length > 0 && (
                <Text style={s.homeEmpty}>{T('home.emptyFilter')}</Text>
              )}
            </>);
          })()}

          {homeExtras.length === 0 && (
            <Text style={s.homeEmpty}>{T('home.emptyDash')}</Text>
          )}
        </ScrollView>

        {/* The one bottom nav (Home active here). */}
        {bottomNav('home', false)}

        {/* Overlays float ABOVE the fixed tab bar in a scrim — inline cards would
            render under the bar and be unreachable. Draft recovery shows itself
            (mandate #1); the bell and the ☰ menu open on tap. */}
        {(bell || drafts.length > 0) && (
          <View style={s.homeScrim}>
            <ScrollView contentContainerStyle={{ paddingTop: 56, paddingBottom: 40 }}
              keyboardShouldPersistTaps="handled">
            {draftsOverlay}
            {activityOverlay}
            </ScrollView>
          </View>
        )}

        {/* The ☰ opens a LEFT DRAWER (hadar, 2026-07-27), not the old centred card that
            re-listed jobs. Jobs own the bottom-nav Jobs tab; this holds the secondary
            destinations only. Each row navigates to a screen that already exists.
            Also reachable from the Profile tab in the bottom bar (2026-07-28). */}
        {drawerEl}
        {/* MOUNTED HERE OR THE DRAWER'S "Upgrade" DOES NOTHING (hadar 2026-08-04:
            "it takes me nowhere, just closes the drawer"). setShowPaywall(true) only
            flips state — if <PaywallScreen> is not in THIS screen's tree there is
            nothing to render, and the tap is silently swallowed. The drawer is
            reachable from home, jobs and activity, so the modals it can open have to
            be mounted on all three; jobs already had them, home and activity did not.
            AFTER {drawerEl} deliberately: a Modal declared before its sibling content
            does not present on iOS. */}
        {quotaEl}
        {/* AND THE SAME OMISSION BIT THE SWIPE-DELETE (hadar 2026-08-05: "the button
            is there but it doesn't delete once I confirm"). Home is the ONLY screen
            that renders <SwipeRow> (extraRow), so it is the only screen where
            askDeleteExtra runs — and it was the one screen without {discardSheet}.
            setDiscard() flipped state into a tree that had nothing to draw it, so the
            confirmation never appeared and the tap looked like a dead button. Same
            failure as Upgrade, seven lines up, for the same reason. */}
        {discardSheet}
        {paywallEl}
      </View>
    );
  }

  // ── JOBS — the full list, its own bottom-nav destination (hadar, 2026-07-23) ──
  if (nav === 'jobs') {
    const now = Date.now();
    const q = search.trim().toLowerCase();
    const jobsSrc = jobsArchived ? archivedCards : cards;
    const usedLabels = LABELS.filter((l) => jobsSrc.some((p) => p.label === l.key));
    // The filter's controls live inside the usedLabels block, which unmounts when a
    // color stops being used — so a raw labelFilter could freeze the list empty with
    // no reset (review 2026-07-25, QA lens). Ignore a filter whose color is gone.
    const activeLabel = usedLabels.some((l) => l.key === labelFilter) ? labelFilter : null;
    const loadArchived = async () => setArchivedCards(await projectCards(db, await listProjects(db, 'archived')));
    const shown = jobsSrc
      .filter((p) => p.id !== INBOX_ID)
      .filter((p) => !q || p.name.toLowerCase().includes(q) ||
                     (p.address ?? '').toLowerCase().includes(q))
      .filter((p) => !activeLabel || p.label === activeLabel);
    const open = (id: string) => { setProjectId(id); void touchProject(db, id); setNav('project'); };
    return (
      <View style={s.homeC}>
        {quotaEl}
        {discardSheet}
        {celebrateEl}
        {paywallEl}
        {/* Header: title · new job (the ＋ opens the create-job screen, an early
            return, so it works from here). */}
        <View style={s.dashHdr}>
          <View style={s.hdrBtn} />
          <Text style={s.hdrTitle}>{T('home.navJobs')}</Text>
          <Pressable style={s.hdrBtn} hitSlop={10} accessibilityLabel={T('home.newProject')}
            onPress={() => setNewJob({ name: '', address: '' })}>
            <Text style={s.hdrIcon}>＋</Text>
          </Pressable>
        </View>
        <ScrollView style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 96 }}
          refreshControl={<RefreshControl refreshing={pulling} onRefresh={onPullRefresh} tintColor={C.steel} />}>
          {/* REQ-PM4 — Active vs Archived. Archived jobs are retained, out of the way. */}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, marginBottom: 2 }}>
            <Pressable hitSlop={6} onPress={() => setJobsArchived(false)}
              style={{ minHeight: 38, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 19, borderWidth: !jobsArchived ? 2 : 1,
                borderColor: !jobsArchived ? '#151A1E' : '#D5D0C7', backgroundColor: !jobsArchived ? '#151A1E' : '#fff' }}>
              <Text style={{ fontFamily: 'Barlow_600SemiBold', fontSize: 13, color: !jobsArchived ? '#fff' : '#5E666E' }}>{T('pm4.activeJobs')}</Text>
            </Pressable>
            <Pressable hitSlop={6} onPress={async () => { setJobsArchived(true); await loadArchived(); }}
              style={{ minHeight: 38, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 19, borderWidth: jobsArchived ? 2 : 1,
                borderColor: jobsArchived ? '#151A1E' : '#D5D0C7', backgroundColor: jobsArchived ? '#151A1E' : '#fff' }}>
              <Text style={{ fontFamily: 'Barlow_600SemiBold', fontSize: 13, color: jobsArchived ? '#fff' : '#5E666E' }}>{T('pm4.archived')}</Text>
            </Pressable>
          </View>
          {jobsSrc.length > 4 && (
            <TextInput style={s.searchIn} value={search} onChangeText={setSearch}
              placeholder={T('home.search')} placeholderTextColor="#8c959f" />
          )}
          {/* REQ-PM14 — filter by color label. Chips carry the color NAME (not color
              alone — color-blind ICP) and are full-height taps (gloves, mandate #3). */}
          {usedLabels.length > 0 && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 10, flexWrap: 'wrap' }}>
              <Pressable onPress={() => setLabelFilter(null)} hitSlop={6}
                style={{ minHeight: 40, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 20, borderWidth: 1,
                  borderColor: activeLabel === null ? '#151A1E' : '#D5D0C7',
                  backgroundColor: activeLabel === null ? '#151A1E' : '#fff' }}>
                <Text style={{ fontFamily: 'Barlow_600SemiBold', fontSize: 13,
                  color: activeLabel === null ? '#fff' : '#5E666E' }}>{T('label.all')}</Text>
              </Pressable>
              {usedLabels.map((l) => {
                const on = activeLabel === l.key;
                return (
                  <Pressable key={l.key} onPress={() => setLabelFilter(on ? null : l.key)} hitSlop={6}
                    style={{ minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 7,
                      paddingHorizontal: 12, borderRadius: 20, borderWidth: on ? 2 : 1,
                      borderColor: on ? '#151A1E' : '#D5D0C7', backgroundColor: '#fff' }}>
                    <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: l.hex }} />
                    <Text style={{ fontFamily: 'Barlow_600SemiBold', fontSize: 13,
                      color: on ? '#151A1E' : '#5E666E' }}>{T(('label.' + l.key) as any)}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}
          {shown.map((p) => (
            <Pressable key={p.id} style={s.jobItem}
              onPress={() => {
                // Archived rows OPEN read-only (retention view). They are not in the
                // active `projects` state, so add the tapped one so the Job screen
                // resolves it (review 2026-07-25: don't dead-tap the row).
                if (jobsArchived) setProjects((ps) => ps.some((x) => x.id === p.id) ? ps : [...ps, p]);
                open(p.id);
              }}>
              {labelHex(p.label) && (
                <View style={{ width: 10, height: 10, borderRadius: 5, marginRight: 10,
                  backgroundColor: labelHex(p.label) as string }} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={s.jobItemName} numberOfLines={1}>{p.name}</Text>
                <Text style={s.jobItemMeta} numberOfLines={1}>
                  {p.address ?? T('home.noAddress')}
                  {p.lastMs ? ' · ' + ago(p.lastMs, now) : ''}
                </Text>
              </View>
              <Text style={s.jobCount}>{p.captureCount}</Text>
              {jobsArchived ? (
                <Pressable hitSlop={10}
                  style={{ minHeight: 44, paddingHorizontal: 10, justifyContent: 'center' }}
                  onPress={async () => {
                    // Un-archiving re-consumes an active-job slot, so it faces the same
                    // free-tier cap as creating one (review 2026-07-25: this was a bypass).
                    const jq = await checkJobs(db);
                    if (!jq.ok) { setQuota({ kind: 'jobs', limit: jq.limit }); return; }
                    const r = await setProjectStatus(connector.client, db, p.id, 'in_progress');
                    if (r.ok) { await refresh(); await loadArchived(); } else setFiled(statusErr(r.code));
                  }}>
                  <Text style={{ color: '#4E6243', fontFamily: 'Barlow_600SemiBold', fontSize: 13 }}>{T('pm4.unarchive')}</Text>
                </Pressable>
              ) : <Text style={s.chev}>›</Text>}
            </Pressable>
          ))}
          {!shown.length && (
            <Text style={s.homeEmpty}>
              {jobsArchived ? T('pm4.noArchived') : q ? T('home.noMatch') : T('home.noProjects')}
            </Text>
          )}
        </ScrollView>
        {bottomNav('jobs', false)}
        {drawerEl}
        {(bell || drafts.length > 0) && (
          <View style={s.homeScrim}>
            <ScrollView contentContainerStyle={{ paddingTop: 56, paddingBottom: 40 }}
              keyboardShouldPersistTaps="handled">
              {draftsOverlay}
              {activityOverlay}
            </ScrollView>
          </View>
        )}
      </View>
    );
  }

  // ── ACTIVITY — every extra across jobs, by status, day-grouped (mockup) ─────
  // "displays major activity around communication - created, sent, approved, in
  //  communication" (hadar, 2026-07-23). One row per extra; the status IS the
  //  communication state. Reuses homeExtras (all live extras across every job).
  if (nav === 'activity') {
    // stateOf + stateColor are now shared with Home (defined once, above).
    const tabLabel: Record<typeof activityTab, string> = {
      all: T('act.tabAll'), waiting: T('act.tabWaiting'),
      approved: T('act.tabApproved'), needs: T('act.tabNeeds'),
    };
    const TABS: Array<typeof activityTab> = ['all', 'waiting', 'approved', 'needs'];
    const list = homeExtras.filter((e) => activityTab === 'all' || stateOf(e) === activityTab);
    return (
      <View style={s.homeC}>
        <View style={s.dashHdr}>
          <View style={s.hdrBtn} />
          <Text style={s.hdrTitle}>{T('home.navActivity')}</Text>
          <View style={s.hdrBtn} />
        </View>
        {/* Status tabs: All · Waiting · Approved · Needs you. */}
        <View style={s.actTabs}>
          {TABS.map((t) => (
            <Pressable key={t} style={[s.actTab, activityTab === t && s.actTabOn]}
              onPress={() => setActivityTab(t)}>
              <Text style={[s.actTabT, activityTab === t && s.actTabTOn]} numberOfLines={1}>
                {tabLabel[t]}
              </Text>
            </Pressable>
          ))}
        </View>
        <ScrollView style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 96 }}>
          {(() => {
            let lastDay = '';
            const nodes: React.ReactNode[] = [];
            list.forEach((e) => {
              const day = new Date(e.created_at_ms).toDateString();
              if (day !== lastDay) {
                lastDay = day;
                nodes.push(
                  <Text key={`d-${day}`} style={s.actDay}>
                    {dayLabel(e.created_at_ms).toUpperCase()}
                  </Text>
                );
              }
              const c = stateColor[stateOf(e)];
              const dl = dayLabel(e.created_at_ms);
              const when = dl === 'Today'
                ? new Date(e.created_at_ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
                : dl;
              nodes.push(
                <Pressable key={e.id} style={s.actRow}
                  onPress={() => { setProjectId(e.project_id); void openRecord(e.id); }}>
                  {e.photo_relpath
                    ? <Image source={{ uri: FS.documentDirectory + e.photo_relpath }}
                        style={s.actIcon} resizeMode="cover" />
                    : <View style={[s.actIcon, { backgroundColor: c.bg }]}>
                        <Text style={s.actIconT}>{c.emoji}</Text>
                      </View>}
                  <View style={{ flex: 1 }}>
                    <Text style={s.actName} numberOfLines={1}>{e.scope}</Text>
                    {!!e.pname && <Text style={s.actSub} numberOfLines={1}>{e.pname}</Text>}
                  </View>
                  <View style={s.actRight}>
                    <View style={[s.actChip, { backgroundColor: c.bg }]}>
                      <Text style={[s.actChipT, { color: c.fg }]}>{c.label}</Text>
                    </View>
                    <Text style={s.actTime}>{when}</Text>
                  </View>
                </Pressable>
              );
            });
            return nodes;
          })()}
          {!list.length && (
            <Text style={s.homeEmpty}>{T('act.empty')}</Text>
          )}
        </ScrollView>
        {bottomNav('activity', false)}
        {drawerEl}
        {/* Same reason as home — the drawer opens from here too. */}
        {quotaEl}
        {paywallEl}
        {(bell || drafts.length > 0) && (
          <View style={s.homeScrim}>
            <ScrollView contentContainerStyle={{ paddingTop: 56, paddingBottom: 40 }}
              keyboardShouldPersistTaps="handled">
              {draftsOverlay}
              {activityOverlay}
            </ScrollView>
          </View>
        )}
      </View>
    );
  }

  // ── PROJECT DETAIL — the Job screen (mockup 2026-07-23) ───────────────────
  // One outer ScrollView wraps the whole body; the photo grid below is a plain
  // View (NOT a nested ScrollView — that was the tangle that broke the last
  // attempt); the bottom nav is absolutely positioned so no inline overlay can
  // shove it. The capture-workspace tools survive inside the same scroll.
  const jobProj = projects.find((p) => p.id === projectId);
  const jobBucket = (c: LedgerRow): 'needs' | 'waiting' | 'approved' => {
    if (c.status === 'approved') return 'approved';
    if (c.status === 'draft') return 'needs';
    const disp = displayStatus(c.status, { openQuestions: questions[c.id] ?? 0 });
    return disp === 'discussing' ? 'needs' : 'waiting';
  };
  const jobNeeds = coRows.filter((c) => jobBucket(c) === 'needs');
  const jobWaiting = coRows.filter((c) => jobBucket(c) === 'waiting');
  const jobApproved = coRows.filter((c) => jobBucket(c) === 'approved');
  const jobTotal = coRows.reduce((n, c) => n + (c.amount_cents ?? 0), 0);
  const jobShown = jobFilter === 'needs' ? jobNeeds
    : jobFilter === 'waiting' ? jobWaiting
    : jobFilter === 'approved' ? jobApproved : coRows;
  const jobMapUrl = jobProj ? staticMapUrl(jobProj.lat, jobProj.lng) : null;
  const startCaptureJob = () => { if (!terms) { openTerms(); return; } setShowCapture(true); };
  return (
    <View style={s.c}>
      {quotaEl}
        {discardSheet}
      {celebrateEl}
      {paywallEl}
      {/* Header: back · Job · bell (mockup 2026-07-23). Fixed above the scroll. */}
      <View style={s.dashHdr}>
        <Pressable style={s.hdrBtn} hitSlop={10} accessibilityLabel={T('common.back')}
          onPress={() => { setNav('home'); setJobFilter(null); void refresh(); }}>
          <Text style={s.hdrIcon}>‹</Text>
        </Pressable>
        <Text style={s.hdrTitle}>{T('job.title')}</Text>
        <Pressable style={s.hdrBtn} hitSlop={10} accessibilityLabel={T('r8.activity')}
          onPress={async () => { setBell(true); setNotifyPerm(await notifyPermissionStatus()); }}>
          <Icon name="remind" size={22} color="#151A1E" />
          {unreadCount(activity) > 0 && (
            <View style={s.hdrBadge}><Text style={s.hdrBadgeT}>{unreadCount(activity)}</Text></View>
          )}
        </Pressable>
      </View>

      {/* ONE outer ScrollView for the whole body (fixes the old overflow). The
          bottom nav floats absolutely below, so nothing here can displace it. */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 96 }}>
        {/* Job card: map · name · address · total. Tap to switch jobs. */}
        <Pressable style={s.jobCard} onPress={() => setPicker(true)}>
          {jobMapUrl
            ? <Image source={{ uri: jobMapUrl }} style={s.jobCardMap} resizeMode="cover" />
            : <View style={[s.jobCardMap, s.jobCardMapEmpty]}><Icon name="mapPin" size={26} color="#8A93A0" /></View>}
          <View style={{ flex: 1 }}>
            <Text style={s.jobCardName} numberOfLines={1}>{jobProj?.name ?? T('job.pick')}</Text>
            <Text style={s.jobCardAddr} numberOfLines={2}>{jobProj?.address ?? T('home.noAddress')}</Text>
            <Text style={s.jobCardTotal}>{money(jobTotal)}</Text>
            <Text style={s.jobCardSub}>{T({ k: 'job.acrossReq', p: { n: coRows.length } })}</Text>
          </View>
        </Pressable>

        {/* REQ-PM14 — a color label for this job. Full-size taps (gloves, mandate #3);
            the chosen color shows a ✓ (not ring-color alone — color-blind ICP) and its
            NAME reads back; a dedicated ✕ swatch clears (never a hidden re-tap). */}
        {jobProj && (
          <View style={{ marginTop: 4, marginBottom: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
              <Text style={{ fontFamily: 'Barlow_600SemiBold', fontSize: 12.5, color: '#5E666E', marginRight: 6 }}>
                {T('label.title')}
              </Text>
              {/* Clear */}
              <Pressable hitSlop={6}
                onPress={async () => { await setProjectLabel(db, jobProj.id, null); await refresh(); }}
                style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
                <View style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 1.5,
                  borderColor: jobProj.label ? '#D5D0C7' : '#151A1E', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 13, color: jobProj.label ? '#8c959f' : '#151A1E' }}>✕</Text>
                </View>
              </Pressable>
              {LABELS.map((l) => {
                const on = jobProj.label === l.key;
                return (
                  <Pressable key={l.key} hitSlop={6}
                    onPress={async () => { await setProjectLabel(db, jobProj.id, on ? null : l.key); await refresh(); }}
                    style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
                    <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: l.hex,
                      borderWidth: on ? 2 : 0, borderColor: '#151A1E', alignItems: 'center', justifyContent: 'center' }}>
                      {on && <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>✓</Text>}
                    </View>
                  </Pressable>
                );
              })}
            </View>
            {labelHex(jobProj.label) && (
              <Text style={{ fontFamily: 'Barlow_400Regular', fontSize: 12, color: '#5E666E', marginLeft: 2, marginTop: 2 }}>
                {T(('label.' + jobProj.label) as any)}
              </Text>
            )}
          </View>
        )}

        {/* REQ-PM4 — lifecycle. Set where the job is; Archive takes it out of the
            working list (kept for warranty/dispute). Archiving returns to Home. */}
        {jobProj && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 8, marginBottom: 4 }}>
            {(['lead', 'in_progress', 'complete'] as const).map((st) => {
              const on = jobProj.status === st;
              return (
                <Pressable key={st} hitSlop={6}
                  onPress={async () => {
                    const r = await setProjectStatus(connector.client, db, jobProj.id, st);
                    if (r.ok) await refresh(); else setFiled(statusErr(r.code));
                  }}
                  style={{ minHeight: 36, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 18, borderWidth: on ? 2 : 1,
                    borderColor: on ? '#151A1E' : '#D5D0C7', backgroundColor: on ? '#151A1E' : '#fff' }}>
                  <Text style={{ fontFamily: 'Barlow_600SemiBold', fontSize: 12.5, color: on ? '#fff' : '#5E666E' }}>
                    {T(('pm4.' + st) as any)}
                  </Text>
                </Pressable>
              );
            })}
            {/* Archive is the SAFE, reversible path — neutral styling, not alarm-red. */}
            <Pressable hitSlop={6}
              onPress={async () => {
                const r = await setProjectStatus(connector.client, db, jobProj.id, 'archived');
                if (r.ok) { setNav('home'); await refresh(); } else setFiled(statusErr(r.code));
              }}
              style={{ minHeight: 36, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 18, borderWidth: 1, borderColor: '#D5D0C7' }}>
              <Text style={{ fontFamily: 'Barlow_600SemiBold', fontSize: 12.5, color: '#5E666E' }}>{T('pm4.archive')}</Text>
            </Pressable>
          </View>
        )}

        {/* RECORD EXTRA WORK — the one capture entry. */}
        <Pressable style={[s.ctaCard, { marginHorizontal: 0 },
            (!ready || !!gate || !!initError) && s.btnOff]}
          disabled={!ready || !!gate || !!initError} onPress={startCaptureJob}>
          <View style={s.ctaIcon}><Icon name="camera" size={22} color="#fff" /></View>
          <View style={{ flex: 1 }}>
            <Text style={s.ctaTitle}>{T('home.recordExtra')}</Text>
            <Text style={s.ctaSub}>{T('job.recordSub')}</Text>
          </View>
        </Pressable>

        {/* Filter pills: Needs you · Waiting · Approved. Tap to filter, tap again clears. */}
        <View style={s.pillRow}>
          <Pressable style={[s.pill, jobFilter === 'needs' && s.pillNeedsOn]}
            onPress={() => setJobFilter(jobFilter === 'needs' ? null : 'needs')}>
            <Text style={[s.pillT, jobFilter === 'needs' && s.pillTOn]}>{T('job.pillNeeds')}</Text>
            <View style={[s.pillBadge, s.secBadgeMuted]}><Text style={s.secBadgeT}>{jobNeeds.length}</Text></View>
          </Pressable>
          <Pressable style={[s.pill, jobFilter === 'waiting' && s.pillWaitOn]}
            onPress={() => setJobFilter(jobFilter === 'waiting' ? null : 'waiting')}>
            <Text style={[s.pillT, jobFilter === 'waiting' && s.pillTWaitOn]}>{T('job.pillWaiting')}</Text>
            <View style={[s.pillBadge, s.secBadgeWarn]}><Text style={s.secBadgeT}>{jobWaiting.length}</Text></View>
          </Pressable>
          <Pressable style={[s.pill, jobFilter === 'approved' && s.pillOkOn]}
            onPress={() => setJobFilter(jobFilter === 'approved' ? null : 'approved')}>
            <Text style={[s.pillT, jobFilter === 'approved' && s.pillTOkOn]}>{T('job.pillApproved')}</Text>
            <View style={[s.pillBadge, s.secBadgeOk]}><Text style={s.secBadgeT}>{jobApproved.length}</Text></View>
          </Pressable>
        </View>

      {/* REQ-VAL7's way in. Only when there IS a gap: a boundary nobody owns is
          the expensive one, and a link that only appears when it matters is not
          another badge competing for attention (REQ-X3). */}
      {boundaries.some((b) => !b.assignedTo) && (
        <Pressable style={s.scopeLink} onPress={() => setScopeOpen(true)}>
          <Text style={s.scopeLinkT}>
            {T({ k: 'sc.gaps', p: { n: boundaries.filter((b) => !b.assignedTo).length } })}
          </Text>
        </Pressable>
      )}

      {/* REQ-X3: THE one status. Eight parallel banners collapsed to this.
          Each of those eight was added honestly for a good reason, and stacked
          together they were a wall of colour a man on a ladder cannot parse —
          which meant he read none of them. Every "never silent" fix I made was
          making the next one quieter. */}
      {screen && (
        <Pressable style={[s.oneStatus, {
          backgroundColor: levelColor(screen.level).bg,
          borderColor: levelColor(screen.level).border,
        }]} onPress={async () => {
          // The detail is REACHABLE, not displayed. X3 does not say lose the
          // information; it says stop leading with it.
          if (screen.level === 'needs_you') {
            setInboxRows(await listCommittedCaptures(db, INBOX_ID)); setInboxOpen(true);
          } else setShowDetail((v) => !v);
        }}>
          <Text style={[s.oneStatusT, { color: levelColor(screen.level).text }]}>
            {T(screen.primary)}
          </Text>
          {showDetail && screen.detail.map((d, i) => (
            <Text key={i} style={s.oneStatusD}>· {T(d)}</Text>
          ))}
          {showDetail && rejected.slice(0, 2).map((r) => (
            <Text key={r.row_id} style={s.oneStatusD}>
              · {r.tbl} {r.code}: {String(r.message ?? '').slice(0, 50)}
            </Text>
          ))}
        </Pressable>
      )}

      {/* REQ-P5 — propose a new job, confirmation-gated. Shown only when the GPS
          ACTIVELY says he is at none of his jobs; never when we are merely unsure
          (that routes to the Inbox per REQ-P2), because proposing a new job when
          the answer is "I don't know" is how a contractor ends up with four jobs
          for one house. */}
      {proposal && (
        <View style={s.p5}>
          <Text style={s.p5T}>{T(proposal.why)}</Text>
          <Text style={s.p5S}>{T('p5.pinned')}</Text>
          <Pressable style={s.confirmWide} onPress={async () => {
            // Still not auto-created: this IS the confirm. It opens the create
            // screen with the pin already set, so it is one tap to a named job.
            setNewJob({ name: '', address: '' });
            setProposal(null);
          }}>
            <Text style={s.confirmT}>{T('p5.create')}</Text>
          </Pressable>
          <Pressable style={s.later} onPress={() => setProposal(null)}>
            <Text style={s.laterT}>{T('p5.notNew')}</Text>
          </Pressable>
        </View>
      )}

      {(gate || initError) && (
        <View style={s.gate}>
          <Text style={s.gateT}>{initError ? 'EZchangeorder couldn’t start safely' : 'Can’t record safely on this device'}</Text>
          <Text style={s.gateS}>
            The database can’t guarantee a save would survive. Rather than tell you
            something is saved and lose it, recording is off.
          </Text>
          <Text style={s.mono}>{gate ?? initError}</Text>
        </View>
      )}

      {/* Capture lives in the RECORD EXTRA WORK card and the + FAB now (hadar,
          2026-07-23): Snap+Talk, video, pick-photo, and type-it were removed from
          the Job screen — the one capture entry is the CTA above. */}

      {/* The decision list + its inferred-decision card were removed from the Job
          screen (hadar, 2026-07-23: "clean all the decision lists"). Decisions are
          plumbing under an extra, not something the contractor browses here. */}

      {ewaDraft && (
        <EwaScreen
          db={db} decisionId={ewaDraft.decisionId} projectId={projectId}
          projectName={projects.find((p) => p.id === projectId)?.name ?? 'this job'}
          ownerId={OWNER} scope={ewaDraft.scope} whoDirected={ewaDraft.whoDirected}
          onClose={() => setEwaDraft(null)}
          // MANDATE #2: creating it does not send it. It lands in the ledger as a
          // draft and goes out through the same send-preview a priced CO does.
          onCreated={async () => { setEwaDraft(null); await refresh(); }}
        />
      )}
      {priced && (() => {
        const cents = centsFromInput(priced.amountText);
        const nte = centsFromInput(priced.nteText);
        // Step 3 pieces, computed up front. ONE Modal hosts both steps: iOS
        // cannot present a second modal over the first, which is exactly how
        // "Continue to review" fired into the void (hadar, 2026-07-23).
        const days = parseInt(priced.scheduleDaysText, 10);
        const instrument = reviewSend && cents !== null ? renderCard({
          kind: 'confirm', subject: priced.scope, value: priced.scope,
          directedBy: priced.whoDirected.trim() || 'Owner',
          projectName: projects.find((p) => p.id === projectId)?.name ?? 'this job',
          whenMs: Date.now(), amountCents: cents, nteCents: nte,
          companyName: reviewSend.company,
          billingTiming: priced.billingTiming,
          scheduleEffect: priced.scheduleEffect,
          scheduleDays: priced.scheduleEffect === 'adds_days' && days > 0 ? days : null,
          exclusions: priced.exclusions,
        }) : '';
        const finish = async (send: boolean) => {
          const id = await confirmPriced();
          if (!id) { setReviewSend(null); return; }  // refusal shown; back to details
          setReviewSend(null); setPriced(null); setLines([]);
          await refresh();
          if (send) {
            const row = coRowsRef.current.find((x) => x.id === id);
            // REQ-LC13'S CONTENT GATE, AND IT WAS MISSING FROM THIS PATH ENTIRELY.
            // The spec requires all three gates at send; this one — the main flow,
            // capture → price → review → Send — checked the pipeline only. The
            // reachable failure: a capture whose proposal came back `low`/`none`
            // (garbled audio) never gets retitled, so `scope` stays
            // `UNTITLED_SCOPE`; the composer renders it read-only and the pipeline
            // gate passes because the audio DID upload and process. The client then
            // receives a signable priced document whose entire body reads "Untitled
            // extra — still being written up". `sendReadiness` refuses exactly that,
            // and only the record screen was asking it.
            //
            // CONTENT BEFORE PIPELINE, the order sendreadiness.ts states: this is
            // the refusal he can act on standing where he is.
            // THE PHOTO COUNT COMES FROM `extraRecord`, THE ONE DERIVATION.
            // My first attempt at this counted `capture_commit` joined through
            // `decision_version.capture_id` and returned 0 for a record with seven
            // photos: a fused session writes each photo as its own commit row and ties
            // them to the narration through `capture_pair`, which that join never
            // walks. `extraRecord` already walks it — and a second, subtly different
            // count feeding a send gate is precisely the class of bug this audit found.
            let photoCountForSend = 0;
            try {
              const rec = await extraRecord(db, id);
              photoCountForSend = rec ? rec.photos.length + rec.photosTruncated : 0;
            } catch { /* stays 0 — the gate then refuses, the safe way to be wrong */ }
            const ready = row ? sendReadiness({
              kind: 'extra',
              scope: row.scope,
              amountCents: row.amount_cents,
              nteCents: row.nte_cents,
              priceMode: row.nte_cents == null ? 'fixed' : 'nte',
              // THE REAL COUNT. This was hardcoded 0 under a comment claiming "D3
              // guarantees no recommended item can affect either" — true when written,
              // FALSE since 2026-07-28, when all six items became gating
              // (sendreadiness.ts). The stale shortcut made `no_photos` fire on every
              // extra, so `ready.ok` was never true and this whole path — the main
              // capture → price → review → Send flow — silently bounced to the record
              // screen and never sent anything.
              photoCount: photoCountForSend,
              billingTiming: row.billing_timing,
              scheduleEffect: row.schedule_effect,
              exclusions: row.exclusions,
            }) : null;
            if (!ready?.ok) {
              // The record screen is where the blockers are named, one tap each.
              await openRecord(id);
              return;
            }
            // FREE-TIER SEND GATE (hadar 2026-08-04). Checked HERE — after readiness,
            // before the composer — because this is the last point where nothing has
            // left the phone. It gates SENDING, never capturing: every byte of this
            // extra is already committed and stays that way whatever the plan says.
            // All three caps (sent change orders, photos, recording) report through
            // this one call, so the user meets whichever they hit first with copy that
            // names it rather than a generic refusal.
            const coq = await checkSendQuota(db);
            if (!coq.ok) {
              setQuota({ kind: coq.kind, limit: coq.limit });
              return;
            }
            // MUST BE PROCESSED FIRST (hadar, 2026-07-24): the evidence has to be
            // uploaded and the pipeline done before a client gets a link — otherwise
            // they open a request whose photos/transcript are still on the phone.
            // This path used to skip that gate, so an unprocessed extra could go out.
            const st = row ? extraProcState(await captureStatesForExtra(db, row.decision_id)) : 'captured';
            if (!canSendExtra(st as any).ok) {
              // Not ready — land on the extra's detail page, where the processing
              // status and the "Upload & process" button live.
              await openRecord(id);
              return;
            }
            // R5c still owns the actual send: recipient + reason + final tap. After
            // it lands, return to the extra's detail page (returnRecordId).
            if (row) { setReturnRecordId(id); await openSendPrep(row); return; }
          }
          // Saved as a draft (or no row to send): land on the extra's DETAIL page,
          // not the job screen — the composer is step 3, not a destination.
          await openRecord(id);
        };
        return (
          <Modal visible animationType="slide"
            onRequestClose={() => {
              if (reviewSend) { setReviewSend(null); return; }
              setPriced(null); setLines([]);
            }}>
          {reviewSend ? (
          <View style={{ flex: 1, backgroundColor: '#f6f8fa' }}>
            <View style={[s.detailHead, { paddingTop: 60, paddingHorizontal: 20 }]}>
              <Pressable style={s.backBtn} onPress={() => setReviewSend(null)}>
                <Text style={s.backT}>‹ {T('common.back')}</Text>
              </Pressable>
              <Text style={s.cardH}>{T('co.reviewTitle')}</Text>
            </View>
            <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 48 }}>
              <View style={{ backgroundColor: '#dafbe1', borderColor: '#2da44e',
                borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 12 }}>
                <Text style={{ color: '#0E5A24', fontSize: 14 }}>{T('co.reviewNote')}</Text>
              </View>
              <View style={s.money}>
                <Text style={{ fontSize: 15, lineHeight: 23, color: '#1f2328' }}>
                  {instrument}
                </Text>
              </View>
              <Text style={s.cardNote}>{T('co.photosAuto')}</Text>
              <View style={[s.cardBtns, { marginTop: 14 }]}>
                <Pressable style={s.confirm} onPress={() => { void finish(true); }}>
                  <Text style={s.confirmT}>{T('co.sendOwner')}</Text>
                </Pressable>
                <Pressable style={s.later} onPress={() => { void finish(false); }}>
                  <Text style={s.laterT}>{T('co.saveDraft')}</Text>
                </Pressable>
              </View>
              <Text style={s.cardNote}>{T('co.auditNote')}</Text>
            </ScrollView>
          </View>
          ) : (
          <View style={{ flex: 1, backgroundColor: '#f6f8fa' }}>
            <View style={[s.detailHead, { paddingTop: 60, paddingHorizontal: 20 }]}>
              <Pressable style={s.backBtn} onPress={() => { setPriced(null); setLines([]); }}>
                <Text style={s.backT}>‹ {T('common.back')}</Text>
              </Pressable>
              <Text style={s.cardH}>{T('co.detailsTitle')}</Text>
            </View>
            <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 48 }}>
          {priced.voice === null && (
            <View style={{ backgroundColor: '#fff8c5', borderColor: '#d4a72c',
              borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 10, marginTop: 8 }}>
              <Text style={{ color: '#7d5e00', fontSize: 14 }}>{T('co.processing')}</Text>
            </View>
          )}
          <View style={s.money}>
            <Text style={s.cardH}>{T('co.check')}</Text>
            {priced.supersedes && <Text style={s.cardNote}>{T('co.revisingNote')}</Text>}
            <Text style={s.moneyScope}>{priced.scope}</Text>

            {/* R2: what the recording actually said, beside the field it filled.
                Mandate #6's read-back is not a warning string — it is showing the
                contractor the sentence the number came from. */}
            <VoicePriceCard
              reading={priced.voice?.price ?? null}
              multi={priced.voice?.multi ?? null}
              mode={priced.mode}
              onModeChange={(m) => setPriced((p) => p && { ...p, mode: m })}
              amountDisplay={
                centsFromInput(priced.amountText) == null
                  ? '' : money(centsFromInput(priced.amountText)!)
              }
            />

            {/* §7.2 line items. OPTIONAL: "add 3 outlets for $450" is a complete,
                honest change order, and forcing a breakdown out of someone on a
                ladder would spend mandate #3's touch budget to satisfy a
                bookkeeper who is not there. Whoever wants the detail can add it. */}
            {lines.map((li, n) => (
              <View key={n} style={s.lineRow}>
                <Text style={s.lineDesc}>{li.description}</Text>
                <Text style={s.lineMath}>
                  {li.qty} × {money(li.unit_cents)} = {money(li.total_cents)}
                </Text>
                <Pressable onPress={() => {
                  // Removing a line RECOMPUTES the total. The alternative -- leaving
                  // the old figure -- is a change order whose lines contradict its
                  // own total, which is the single worst artefact to hand a lawyer.
                  const next = lines.filter((_, i) => i !== n);
                  setLines(next);
                  setPriced({ ...priced, amountText: next.length
                    ? (linesSum(next) / 100).toFixed(2) : priced.amountText });
                }}>
                  <Text style={s.lineX}>✕</Text>
                </Pressable>
              </View>
            ))}

            <View style={s.lineAdd}>
              <TextInput style={[s.lineIn, { flex: 2 }]} value={draftLine.desc}
                placeholder="what" placeholderTextColor="#8c959f"
                onChangeText={(v) => setDraftLine({ ...draftLine, desc: v })} />
              <TextInput style={s.lineIn} value={draftLine.qty} keyboardType="decimal-pad"
                placeholder="qty" placeholderTextColor="#8c959f"
                onChangeText={(v) => setDraftLine({ ...draftLine, qty: v })} />
              <TextInput style={s.lineIn} value={draftLine.unit} keyboardType="decimal-pad"
                placeholder="each" placeholderTextColor="#8c959f"
                onChangeText={(v) => setDraftLine({ ...draftLine, unit: v })} />
              <Pressable style={s.linePlus} onPress={() => {
                const qty = parseFloat(draftLine.qty);
                const unit = centsFromInput(draftLine.unit);
                if (!draftLine.desc.trim() || !(qty > 0) || unit === null) return;
                const next = [...lines, makeLine(draftLine.desc, qty, unit)];
                setLines(next);
                // The total is DERIVED from the lines, never typed alongside them.
                // Two independently-editable numbers that must agree is a bug with
                // a UI: one of them is always wrong and nobody knows which.
                setPriced({ ...priced, amountText: (linesSum(next) / 100).toFixed(2) });
                setDraftLine({ desc: '', qty: '1', unit: '' });
              }}>
                <Text style={s.linePlusT}>+</Text>
              </Pressable>
            </View>
            {draftLine.desc.trim() && parseFloat(draftLine.qty) > 0 && centsFromInput(draftLine.unit) !== null && (
              <Text style={s.lineMath}>
                = {money(lineTotal(parseFloat(draftLine.qty), centsFromInput(draftLine.unit)!))}
              </Text>
            )}

            {/* Read-back: BIG, and tap-to-correct. mandate #6. */}
            <Text style={s.bigMoney}>{money(cents)}</Text>
            {lines.length > 0 && (
              <Text style={linesSum(lines) === cents ? s.ok : s.warn}>
                {linesSum(lines) === cents
                  ? `${lines.length} line${lines.length > 1 ? 's' : ''} add up to this`
                  : `Lines add up to ${money(linesSum(lines))} — they must match, or remove them`}
              </Text>
            )}
            <TextInput
              style={s.moneyInput}
              value={priced.amountText}
              onChangeText={(v) => setPriced({ ...priced, amountText: v })}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor="#8c959f"
            />
            <Text style={s.sub}>Not to exceed (optional)</Text>
            <TextInput
              style={s.moneyInput}
              value={priced.nteText}
              onChangeText={(v) => setPriced({ ...priced, nteText: v })}
              keyboardType="decimal-pad"
              placeholder="optional cap for T&M"
              placeholderTextColor="#8c959f"
            />

            {/* The flow-mock questions (FLOW-SIMPLEST-JOBSITE.md phase 3). Their
                answers become TERMS in the frozen instrument (renderCard), which
                is why they live here on the read-back card and nowhere later:
                what the contractor confirms is what the owner reads. */}
            <Text style={s.sub}>{T('co.qWho')}</Text>
            <TextInput
              style={[s.moneyInput, { fontSize: 16 }]}
              value={priced.whoDirected}
              onChangeText={(v) => setPriced({ ...priced, whoDirected: v })}
              placeholder={T('co.qWhoPh')}
              placeholderTextColor="#8c959f"
            />
            <Text style={s.sub}>{T('co.qBilling')}</Text>
            <View style={s.qRow}>
              {([['next_invoice', 'co.billNext'], ['when_completed', 'co.billDone'],
                 ['other', 'co.billOther']] as const).map(([v, k]) => (
                <Pressable key={v} onPress={() => setPriced({ ...priced, billingTiming: v })}
                  style={[s.qChip, priced.billingTiming === v && s.qChipOn]}>
                  <Text style={[s.qChipT, priced.billingTiming === v && s.qChipTOn]}>{T(k)}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={s.sub}>{T('co.qSchedule')}</Text>
            <View style={s.qRow}>
              {([['no_change', 'co.schedNo'], ['adds_days', 'co.schedAdds'],
                 ['not_sure', 'co.schedUnsure']] as const).map(([v, k]) => (
                <Pressable key={v}
                  onPress={() => setPriced({ ...priced,
                    scheduleEffect: priced.scheduleEffect === v ? null : v })}
                  style={[s.qChip, priced.scheduleEffect === v && s.qChipOn]}>
                  <Text style={[s.qChipT, priced.scheduleEffect === v && s.qChipTOn]}>{T(k)}</Text>
                </Pressable>
              ))}
            </View>
            {priced.scheduleEffect === 'adds_days' && (
              <TextInput
                style={s.moneyInput}
                value={priced.scheduleDaysText}
                onChangeText={(v) => setPriced({ ...priced, scheduleDaysText: v })}
                keyboardType="number-pad"
                placeholder={T('co.schedDaysPh')}
                placeholderTextColor="#8c959f"
              />
            )}
            <Text style={s.sub}>{T('co.qExcluded')}</Text>
            <TextInput
              style={[s.moneyInput, { fontSize: 15, minHeight: 44 }]}
              value={priced.exclusions}
              onChangeText={(v) => setPriced({ ...priced, exclusions: v })}
              multiline
              placeholder={T('co.exclPh')}
              placeholderTextColor="#8c959f"
            />

            <View style={s.cardBtns}>
              <Pressable
                style={[s.confirm, (cents === null || !!validateLines(lines, cents ?? 0)) && s.btnOff]}
                disabled={cents === null || !!validateLines(lines, cents ?? 0)}
                onPress={async () => {
                  // Step 2 -> step 3. Nothing commits here: the price commits on
                  // Review & Send, where the contractor has seen exactly what
                  // the owner will read (confirmPriced).
                  const prof = await getProfile(db);
                  setReviewSend({ company: prof?.company || prof?.name || null });
                }}>
                <Text style={s.confirmT}>
                  {cents === null ? T('co.enterPrice') : T('co.toReview')}
                </Text>
              </Pressable>
              <Pressable style={s.later} onPress={() => { setPriced(null); setLines([]); }}>
                <Text style={s.laterT}>{T('common.cancel')}</Text>
              </Pressable>
            </View>
            <Text style={s.cardNote}>{T('co.nothingSent')}</Text>
          </View>
            </ScrollView>
          </View>
          )}
          </Modal>
        );
      })()}

      {/* ── THE LEDGER (prototype c4) ──────────────────────────────────────────
          The money at a glance. Where the pipeline USED to dump an unstyled list,
          this is the contractor's answer to "where do I stand on this job?": what's
          approved, what's still out, and the notation status of each one. */}
      {coRows.length > 0 && (() => {
        const approved = coRows.filter((c) => c.status === 'approved');
        const awaiting = coRows.filter((c) => c.status === 'sent');
        // DERIVED HERE from raw cents, in one place. Summing formatted "$1,850"
        // strings would be a parser bug with a lawyer attached (mandate #6).
        const approvedCents = approved.reduce((n, c) => n + c.amount_cents, 0);
        const awaitingCents = awaiting.reduce((n, c) => n + c.amount_cents, 0);
        const proj = projects.find((p) => p.id === projectId);
        // STEP 3 — send the priced approval. Creates the FROZEN priced link the
        // client opens: company (from profile), scope, price, and the running total
        // already approved on this job, all frozen together (mandate #5/#6). The
        // share sheet delivers it from a number the client already recognises.
        return (
        <>
          {/* AC4: "flagged prominently". Above the totals card, not a chip on a row
              he has to scroll to — it is his own late promise. */}
          <UnpricedEwaBanner rows={ewas} onPrice={(e) => {
            markReminded(db, e.id);
            setSettling(e.id);
            setPriced({ decisionId: e.decisionId, scope: e.scope, whoDirected: 'Owner',
                        amountText: '', nteText: '', mode: 'fixed', voice: null,
                        billingTiming: 'when_completed', scheduleEffect: null,
                        scheduleDaysText: '', exclusions: '' });
          }} />
          {/* Approved vs awaiting, AGAINST PRICE — the breakdown to keep (hadar,
              2026-07-24). The flag, progress-update and evidence-bundle tools were
              removed from here: good features, but they blended into the extras. */}
          <View style={s.jxTotals}>
            <View style={s.jxTotCol}>
              <Text style={s.jxTotLab}>{T('job.totApproved')} · {approved.length}</Text>
              <Text style={s.jxTotVal}>{money(approvedCents)}</Text>
            </View>
            <View style={s.jxTotDiv} />
            <View style={s.jxTotCol}>
              <Text style={s.jxTotLab}>{T('job.totAwaiting')} · {awaiting.length}</Text>
              <Text style={[s.jxTotVal, s.jxTotWait]}>{money(awaitingCents)}</Text>
            </View>
          </View>

          {/* Grouped sections with photo thumbnails (the mockup). A card shows the
              photo, title, category and price; tapping it opens the extra's DETAIL
              page, where send / finish / remind / delete / revise now live. A pill
              focuses one section; "See all" toggles that focus. */}
          {(() => {
            // Muted status pill (kit palette) with a line icon + word — colour never
            // alone. Waiting = ochre clock, Needs you = slate reply, Approved = forest check.
            const pill = {
              waiting:  { color: '#A47A3F', bg: 'rgba(164,122,63,0.13)', icon: 'clock' as const,    label: T('job.pillWaiting') },
              needs:    { color: '#5E7079', bg: 'rgba(109,127,137,0.14)', icon: 'reply' as const,    label: T('job.pillNeeds') },
              approved: { color: '#536B49', bg: '#E7ECDD',                icon: 'approved' as const,  label: T('job.pillApproved') },
            };
            const card = (c: LedgerRow, bucket: 'waiting' | 'needs' | 'approved') => {
              const p = pill[bucket];
              return (
              <Pressable key={c.id} style={s.jxCard} onPress={() => { void openRecord(c.id); }}>
                {c.photo_relpath
                  ? <Image source={{ uri: FS.documentDirectory + c.photo_relpath }}
                      style={s.jxThumb} resizeMode="cover" />
                  : <View style={[s.jxThumb, s.coThumbEmpty]}><Icon name="microphone" size={24} color="#8A93A0" /></View>}
                <View style={{ flex: 1 }}>
                  <Text style={s.jxName} numberOfLines={1}>{c.scope}</Text>
                  {c.extra_type && isExtraType(c.extra_type) && (
                    <Text style={s.jxSub} numberOfLines={1}>{typeLabel(c.extra_type)}</Text>
                  )}
                  {c.amount_cents != null && <Text style={s.jxAmt}>{c.amount}</Text>}
                </View>
                <View style={[s.jxChip, { borderColor: p.color, backgroundColor: p.bg,
                  flexDirection: 'row', alignItems: 'center', gap: 4 }]}>
                  <Icon name={p.icon} size={12} color={p.color} />
                  <Text style={[s.jxChipT, { color: p.color }]}>{p.label}</Text>
                </View>
              </Pressable>
              );
            };
            const section = (labelKey: string, rows: LedgerRow[], bucket: 'waiting' | 'needs' | 'approved') => {
              if (rows.length === 0 || (jobFilter !== null && jobFilter !== bucket)) return null;
              return (
                <View style={{ marginTop: 8 }}>
                  <View style={s.jxSecHead}>
                    <Text style={s.jxSecLab}>{T(labelKey)}</Text>
                    <Pressable hitSlop={8} onPress={() => setJobFilter(jobFilter === bucket ? null : bucket)}>
                      <Text style={s.jxSeeAll}>{jobFilter === bucket ? T('job.seeLess') : T('job.seeAll')}</Text>
                    </Pressable>
                  </View>
                  {rows.map((c) => card(c, bucket))}
                </View>
              );
            };
            return (
              <>
                {section('job.secWaiting', jobWaiting, 'waiting')}
                {section('job.secNeeds', jobNeeds, 'needs')}
                {section('job.secApproved', jobApproved, 'approved')}
              </>
            );
          })()}
        </>
        );
      })()}


      {/* ── R5c SEND PREVIEW ─────────────────────────────────────────────────
          What kind of extra is this, and who is entitled to approve it. Nothing is
          sent from here until the contractor taps the confirm button, because
          mandate #2 forbids a priced commitment leaving on an inference and R5c
          requires the routing REASON to be visible, not merely computed. */}
      {/* R8 activity centre. Every row deep-links to the item's record (R6b) —
          the same destination the push would open, so an unanswered question is at
          most two taps from anywhere. */}
      {activityOverlay}
      {/* R1: a walk this phone still holds and never filed. Offered BEFORE anything
          else on the screen, because it is the only thing here that can be lost —
          everything below it is already committed. */}
      {draftsOverlay}
      {sendPrep && (() => {
        const sp = sendPrep;
        const sug = sp.suggestion;
        const suggested = sug && sug.kind === 'suggested' ? sug.approver : null;
        const chosen = sp.chosenId
          ? sp.roster.find((r) => r.id === sp.chosenId) ?? null
          : sp.roster.find((r) => r.id === suggested?.id) ?? null;
        const unconfirmed = !sp.chosenId && sug?.kind === 'suggested' && !sug.bindsMoney;
        return (
          <Modal visible transparent animationType="slide"
            onRequestClose={() => setSendPrep(null)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(13,15,18,0.45)' }}>
          <ScrollView contentContainerStyle={{ padding: 14, paddingTop: 64, paddingBottom: 40 }}
            keyboardShouldPersistTaps="handled">
          <View style={s.money}>
            <Text style={s.cardH}>{T('r5c.sendTo')}</Text>
            <Text style={s.moneyScope}>{sp.co.scope} · {sp.co.amount}</Text>

            {/* The extra's KIND is set by the AI on processing (hadar, 2026-07-24:
                "i don't want the user to tag it"); the manual type picker was
                removed. sp.type still carries the AI's category for approver
                routing — it just isn't asked here. */}

            {/* ── who approves ── */}
            {sp.adding ? (
              <View>
                <Text style={s.cardH}>{T('r5c.whoApproves')}</Text>
                {/* Pull the person + number straight from the phone's contacts —
                    the native picker needs no permission prompt (hadar, 2026-07-24:
                    "add someone ... a phone number and associate it with a person").
                    iOS exposes no call history, so Contacts is the source. */}
                <Pressable style={s.contactBtn} onPress={pickContact}>
                  <Text style={s.contactBtnT}>{T('r5c.fromContacts')}</Text>
                </Pressable>
                <TextInput
                  style={s.input} placeholder={T('r5c.namePlaceholder')}
                  value={sp.adding.name}
                  onChangeText={(v) => setSendPrep((p) => p && p.adding
                    ? { ...p, adding: { ...p.adding, name: v } } : p)}
                />
                <TextInput
                  style={s.input} placeholder={T('r5c.phonePlaceholder')}
                  keyboardType="phone-pad" value={sp.adding.phone}
                  onChangeText={(v) => setSendPrep((p) => p && p.adding
                    ? { ...p, adding: { ...p.adding, phone: v } } : p)}
                />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 8 }}>
                  {APPROVER_ROLES.map((role) => (
                    <Pressable key={role}
                      onPress={() => setSendPrep((p) => p && p.adding
                        ? { ...p, adding: { ...p.adding, role } } : p)}
                      style={[s.chip, sp.adding!.role === role && s.chipOn]}>
                      <Text style={[s.chip, sp.adding!.role === role && s.chipOn,
                                    { borderWidth: 0, paddingHorizontal: 0, paddingVertical: 0 }]}>
                        {roleLabel(role)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Pressable style={s.confirmWide} disabled={!sp.adding.name.trim()}
                  onPress={async () => {
                    const a = sp.adding!;
                    const id = await addApprover(db, {
                      projectId, name: a.name.trim(), role: a.role,
                      phone: a.phone.trim() || null,
                    });
                    const roster = await listRoster(db, projectId);
                    // Chosen explicitly: they were just added FOR this send, so
                    // re-deriving a suggestion here would throw that away.
                    setSendPrep((p) => p && { ...p, roster, chosenId: id, adding: null });
                  }}>
                  <Text style={s.confirmT}>{T('r5c.addApprover')}</Text>
                </Pressable>
              </View>
            ) : sp.picking ? (
              <View>
                <Text style={s.cardH}>{T('r5c.whoApproves')}</Text>
                {sp.roster.map((m) => (
                  <Pressable key={m.id} style={s.coSendRow}
                    onPress={() => setSendPrep((p) => p && { ...p, chosenId: m.id, picking: false })}>
                    <Text style={s.dval}>{m.name}</Text>
                    <Text style={s.dmeta}>{roleLabel(m.role)}</Text>
                  </Pressable>
                ))}
                <Pressable style={s.coSendRow}
                  onPress={() => setSendPrep((p) => p && { ...p, picking: false,
                    adding: { name: '', role: 'owner', phone: '' } })}>
                  <Text style={s.coNudge}>{T('r5c.addApprover')} →</Text>
                </Pressable>
              </View>
            ) : chosen ? (
              <View>
                <Text style={s.dval}>{chosen.name}</Text>
                {/* The REASON, shown verbatim. R5c: "with the reason visible". A
                    pre-filled recipient the sender cannot check is the failure. */}
                <Text style={s.dmeta}>
                  {sp.chosenId ? roleLabel(chosen.role) : reasonText(sug!)}
                </Text>
                {unconfirmed && (
                  <Text style={s.warn}>{T('r5c.unconfirmedAuthority')}</Text>
                )}
                <Pressable style={s.coSendRow}
                  onPress={() => setSendPrep((p) => p && { ...p, picking: true })}>
                  <Text style={s.coNudge}>{T('r5c.change')} →</Text>
                </Pressable>
              </View>
            ) : (
              <View>
                <Text style={s.warn}>{T('r5c.noRoster')}</Text>
                <Pressable style={s.coSendRow}
                  onPress={() => setSendPrep((p) => p && { ...p,
                    adding: { name: '', phone: '', role: (sug && sug.kind === 'needs_approver'
                      && sug.wantedRole) ? sug.wantedRole : 'owner' } })}>
                  <Text style={s.coNudge}>{T('r5c.addApprover')} →</Text>
                </Pressable>
              </View>
            )}

            {/* Send is DISABLED until somebody is named. Sending a priced commitment
                to nobody is not a degraded send, it is a lost one. */}
            {!sp.adding && !sp.picking && (
              <>
                <Pressable style={s.confirmWide} disabled={!chosen || sp.busy}
                  onPress={async () => {
                    setSendPrep((p) => p && { ...p, busy: true });
                    await sendPricedApproval(sp.co, chosen);
                    setSendPrep((p) => p && { ...p, busy: false });
                  }}>
                  <Text style={s.confirmT}>{T('conf.send')}</Text>
                </Pressable>
                <Pressable style={s.coSendRow} onPress={() => setSendPrep(null)}>
                  <Text style={s.dmeta}>{T('common.cancel')}</Text>
                </Pressable>
              </>
            )}
          </View>
          </ScrollView>
          </View>
          </Modal>
        );
      })()}

      {sentLink && (
        <Modal visible transparent animationType="slide"
          onRequestClose={() => {
            setSentLink(null); setPhotoNote(null);
            if (returnRecordId) { const rid = returnRecordId; setReturnRecordId(null); void openRecord(rid); }
          }}>
        <View style={{ flex: 1, backgroundColor: 'rgba(13,15,18,0.45)' }}>
        <ScrollView contentContainerStyle={{ padding: 14, paddingTop: 64, paddingBottom: 40 }}>
        <View style={s.sentCard}>
          <Pressable style={s.sentClose} hitSlop={12} onPress={() => {
            setSentLink(null); setPhotoNote(null);
            if (returnRecordId) { const rid = returnRecordId; setReturnRecordId(null); void openRecord(rid); }
          }}>
            <Text style={s.sentCloseT}>✕</Text>
          </Pressable>
          <View style={s.sentBadge}><Text style={s.sentBadgeIcon}>{sentLink.shared ? '✓' : '↗'}</Text></View>
          <Text style={s.sentH}>{T(sentLink.shared ? 'sent.title' : 'sent.readyTitle')}</Text>
          <Text style={s.sentSub}>{T(sentLink.shared ? 'sent.waiting' : 'sent.readySub')}</Text>

          <View style={s.sentRows}>
            {!!sentLink.jobName && (<View style={s.sentRow}>
              <Text style={s.sentLab}>{T('sent.job')}</Text>
              <Text style={s.sentVal} numberOfLines={1}>{sentLink.jobName}</Text>
            </View>)}
            {!!sentLink.scope && (<View style={s.sentRow}>
              <Text style={s.sentLab}>{T('sent.request')}</Text>
              <Text style={s.sentVal} numberOfLines={1}>
                {sentLink.scope}{sentLink.amount ? ` · ${sentLink.amount}` : ''}
              </Text>
            </View>)}
            {!!sentLink.sentTo && (<View style={s.sentRow}>
              <Text style={s.sentLab}>{T('sent.to')}</Text>
              <Text style={s.sentVal} numberOfLines={1}>
                {sentLink.sentTo}{sentLink.atMs
                  ? ` · ${new Date(sentLink.atMs).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
                  : ''}
              </Text>
            </View>)}
            <View style={s.sentRow}>
              <Text style={s.sentLab}>{T('sent.status')}</Text>
              <View style={s.sentChip}><Text style={s.sentChipT}>
                {T(sentLink.shared ? 'sent.waitingChip' : 'sent.notSentChip')}</Text></View>
            </View>
          </View>

          {photoNote && <Text style={s.cardNote}>{photoNote}</Text>}

          {/* AUTOMATIC SMS (REQ-VAL8) — one tap texts the link via Twilio when we
              have the recipient's number. Falls back to the manual share below if it
              is not configured/deployed, so the link can ALWAYS reach the client. */}
          {!!sentLink.phone && sentLink.url && (
            <Pressable style={s.confirmWide} onPress={async () => {
              const r = await sendSms(connector.client, sentLink.phone as string,
                `${sentLink.shown}\n\n${sentLink.url}`);
              if (!r.ok) { setUi({ k: 'refused', why: `Couldn’t text it automatically (${r.reason}). Use “Send by text” below.` }); return; }
              setSentLink((sl) => sl && { ...sl, shared: true });
            }}>
              <Text style={s.confirmT}>{T({ k: 'sent.textAuto', p: { name: sentLink.sentTo ?? '' } } as any)}</Text>
            </Pressable>
          )}

          {/* The link goes to the client by TEXT — a link the contractor sends
              themselves arrives from a number the client recognises, not spam
              (REQ-VAL8). The always-works manual path. */}
          <Pressable style={sentLink.phone ? s.coSendRow : s.confirmWide} onPress={async () => {
            const r = await shareLink(sentLink.url, sentLink.shown);
            if (!r.ok) setUi({ k: 'refused', why: r.reason ?? 'could not share' });
            // Only NOW has the link reached the client — flip to the sent state.
            else setSentLink((sl) => sl && { ...sl, shared: true });
          }}>
            <Text style={sentLink.phone ? s.dmeta : s.confirmT}>{T(sentLink.shared ? 'sent.shareAgain' : 'sent.share')}</Text>
          </Pressable>

          <Text style={s.sentFoot}>{T('sent.foot')}</Text>
        </View>
        </ScrollView>
        </View>
        </Modal>
      )}

      {history && (
        <View style={s.card}>
          <Text style={s.cardH}>{T('dec.history')}</Text>
          {history.map((h, i) => (
            <Text key={i} style={i === 0 ? s.hNow : s.hOld}>
              {i === 0 ? '● now:  ' : '○ was: '}{h.value}
              {h.directed_by ? `  (${h.directed_by})` : ''}
            </Text>
          ))}
          <Pressable style={s.later} onPress={() => setHistory(null)}>
            <Text style={s.laterT}>{T('common.close')}</Text>
          </Pressable>
        </View>
      )}

      {/* The captures GRID was removed from the Job screen (hadar, 2026-07-23:
          "we don't display images outside of the extras"). Photos and videos now
          live only inside the extra they belong to (the record screen). */}
      </ScrollView>

      {/* The one bottom nav — ABSOLUTE here, so no inline overlay in the scroll can
          push it (the bug that broke the first attempt). No tab is "active": we are
          inside a job, not on one of the three destinations. */}
      {bottomNav(null, true)}
      {drawerEl}
    </View>
  );
}

/** Change-order status → its notation chip (prototype c4). Muted ochre (pending) needs
    dark text to stay legible; everything else is white-on-colour. */
/** Change-order status → its notation chip (prototype c4). Muted ochre (pending) needs
 *  dark text to stay legible; everything else is white-on-colour.
 *  Takes a DERIVED status (extrastatus.ts), never the stored one — `discussing` does
 *  not appear in change_order.status and never should: a status two writers can move
 *  is a status nobody can rely on (220_question_path). */
function coChip(status: LedgerStatus): { label: string; bg: any; dark: boolean } {
  // COLOUR + ICON + LABEL — never colour alone (kit status rule; the ICP is often
  // colour-blind and reading in a second language, so the glyph and the word carry
  // the state, colour only reinforces). Emoji is the app's icon layer (no SVG lib).
  switch (status) {
    case 'approved':   return { label: '✓ ' + T('co.chip.approved'),   bg: s.chipApproved, dark: false };
    case 'sent':       return { label: '⏳ ' + T('co.chip.sent'),       bg: s.chipPending,  dark: true  };
    // Its own colour, not ink: 'superseded' already owns ink, and two statuses that
    // look identical is the failure a status chip exists to prevent.
    case 'discussing': return { label: '💬 ' + T('co.chip.discussing'), bg: s.chipDiscussing, dark: false };
    case 'declined':   return { label: '✕ ' + T('co.chip.declined'),   bg: s.chipDeclined, dark: false };
    case 'superseded': return { label: '↻ ' + T('co.chip.superseded'), bg: s.chipRevised,  dark: false };
    default:           return { label: '✎ ' + T('co.chip.draft'),      bg: s.chipDraft,    dark: false };
  }
}

// Light theme. Palette (GitHub-light / CompanyCam-ish): page #f6f8fa, surfaces
// #ffffff, borders #d0d7de, text #1f2328 / #57606a / #8c959f, brand green #1f883d,
// blue #0969da, amber #9a6700, red #cf222e. Overlays that sit ON photos keep a dark
// translucent backing so their text reads over any image.
const s = StyleSheet.create({
  // ── transition screen (FLOW step 1.5), themed 2026-07-27 ──────────────────
  trScreen: { flex: 1, backgroundColor: C.paper },
  trScroll: { alignItems: 'center', paddingTop: 74, paddingHorizontal: 22, paddingBottom: 40 },
  trTitle: { fontFamily: F.disp, fontSize: 30, color: C.ink, textTransform: 'uppercase',
    letterSpacing: 0.6, textAlign: 'center', marginTop: 14 },
  trSub: { fontFamily: F.body, fontSize: 16, color: C.steel, textAlign: 'center',
    marginTop: 8, lineHeight: 22 },

  trCard: { alignSelf: 'stretch', backgroundColor: C.card, borderRadius: radii.xl,
    padding: 22, marginTop: 26, alignItems: 'center', ...shadows.card },
  trRingWrap: { alignItems: 'center', justifyContent: 'center' },
  trRingIcon: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  trState: { fontFamily: F.bodyBold, fontSize: 18, color: C.ink, textTransform: 'uppercase',
    letterSpacing: 1.1, marginTop: 18 },
  trStateSub: { fontFamily: F.body, fontSize: 15.5, color: C.steel, marginTop: 6,
    textAlign: 'center', lineHeight: 21 },

  trSteps: { alignSelf: 'stretch', marginTop: 18, gap: 10, borderTopWidth: 1,
    borderTopColor: C.line, paddingTop: 16 },
  trStepRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  trStepT: { fontFamily: F.body, fontSize: 15, color: C.steel, flexShrink: 1 },
  trStepTDone: { color: C.ink },

  trProgWrap: { alignSelf: 'stretch', marginTop: 14 },
  trProgTrack: { height: 6, borderRadius: 3, backgroundColor: C.surfaceMuted, overflow: 'hidden' },
  trProgFill: { height: 6, borderRadius: 3, backgroundColor: C.brand },
  trProgT: { fontFamily: F.body, fontSize: 13, color: C.steel, marginTop: 6 },

  trWarn: { alignSelf: 'stretch', backgroundColor: C.brandSoft, borderWidth: 1,
    borderColor: C.caution, borderRadius: radii.lg, padding: 16, marginTop: 18 },
  trWarnT: { fontFamily: F.body, fontSize: 15.5, color: C.ink, lineHeight: 22 },
  trFile: { backgroundColor: '#131110', borderRadius: 14, minHeight: 52,
    alignItems: 'center', justifyContent: 'center', marginTop: 12, paddingHorizontal: 18 },
  trFileT: { color: '#fff', fontFamily: 'Inter_700Bold', fontSize: 16 },
  trWarnErr: { fontFamily: 'Menlo', fontSize: 12, lineHeight: 17, color: C.danger, marginTop: 10 },
  trDone: { minHeight: 60, borderRadius: radii.md, backgroundColor: C.ink,
    alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  trDoneT: { fontFamily: F.bodyBold, fontSize: 17, color: '#fff' },

  trNext: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: C.brandSoft, borderRadius: radii.lg, padding: 16, marginTop: 18 },
  trNextLab: { fontFamily: F.dispSemi, fontSize: 12.5, color: C.brand,
    textTransform: 'uppercase', letterSpacing: 1.4 },
  trNextT: { fontFamily: F.bodyBold, fontSize: 18, color: C.ink, marginTop: 2 },

  trRule: { alignSelf: 'stretch', height: 1, backgroundColor: C.line, marginTop: 26 },
  trSafe: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 14,
    paddingHorizontal: 8 },
  trSafeT: { fontFamily: F.body, fontSize: 14, color: C.steel, lineHeight: 20, flexShrink: 1 },

  c: { flex: 1, paddingTop: 72, paddingHorizontal: 20, backgroundColor: '#F7F4EE' },
  h: { color: '#151A1E', fontFamily: 'Barlow_700Bold', fontSize: 30, letterSpacing: -0.2, marginBottom: 18 },
  btn: { backgroundColor: '#151A1E', paddingVertical: 28, borderRadius: 18, alignItems: 'center' },
  btnRec: { backgroundColor: '#8B5148' },
  fusedBtn: { backgroundColor: '#4E6243', paddingVertical: 24, borderRadius: 18,
    alignItems: 'center', marginBottom: 12 },
  fusedT: { color: '#fff', fontFamily: 'Barlow_700Bold', fontSize: 23, letterSpacing: -0.2 },
  // REQ-PROC8 entry — the accent, because reviewing the proposal is the next real move.
  reviewBtn: { alignSelf: 'center', backgroundColor: '#FFF1E8', borderColor: '#4E6243',
    borderWidth: 1.5, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 22, marginTop: 10 },
  reviewT: { color: '#4E6243', fontFamily: 'Barlow_700Bold', fontSize: 18, letterSpacing: -0.2 },
  btnOff: { backgroundColor: '#c4cdd5' },
  mediaRow: { flexDirection: 'row', gap: 10, marginBottom: 18 },
  media: { flex: 1, backgroundColor: '#ffffff', borderRadius: 12, paddingVertical: 16,
    alignItems: 'center', borderWidth: 1, borderColor: '#D5D0C7' },
  mediaIcon: { fontSize: 26, marginBottom: 4 },
  mediaT: { color: '#151A1E', fontFamily: 'BarlowCondensed_600SemiBold', fontSize: 13, textTransform: 'uppercase', letterSpacing: 1.2 },
  stamp: { color: '#8c959f', fontSize: 10 },
  btnT: { color: '#fff', fontFamily: 'Barlow_700Bold', fontSize: 25, letterSpacing: -0.2 },
  state: { color: '#5E666E', fontFamily: 'Barlow_400Regular', fontSize: 15, marginTop: 14, marginBottom: 22, textAlign: 'center' },
  sub: { color: '#5E666E', fontFamily: 'BarlowCondensed_600SemiBold', fontSize: 12.5, textTransform: 'uppercase', letterSpacing: 1.6, marginBottom: 8 },
  row: { borderTopWidth: 1, borderTopColor: '#D5D0C7', paddingVertical: 10 },
  rowT: { color: '#57606a', fontSize: 13, fontFamily: 'Menlo' },
  rowS: { color: '#8c959f', fontSize: 11, fontFamily: 'Menlo', marginTop: 2 },
  card: { backgroundColor: '#dafbe1', borderColor: '#2da44e', borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 16 },
  // ── "Sent for approval" screen (mockup 2026-07-24) ─────────────────────────
  sentCard: { backgroundColor: '#fff', borderRadius: 18, padding: 20, paddingTop: 44, alignItems: 'center' },
  sentClose: { position: 'absolute', top: 12, right: 14, width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  sentCloseT: { fontSize: 18, color: '#8A93A0' },
  sentBadge: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#E9F6ED',
    alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  sentBadgeIcon: { fontSize: 30, color: '#1A7F37', fontFamily: 'Barlow_700Bold' },
  sentH: { fontFamily: 'Barlow_700Bold', fontSize: 22, color: '#151A1E',
    letterSpacing: -0.2 },
  sentSub: { fontFamily: 'Barlow_400Regular', fontSize: 15, color: '#6B7280', marginTop: 2, marginBottom: 16 },
  sentRows: { alignSelf: 'stretch', borderWidth: 1, borderColor: '#EEEFEC', borderRadius: 12, marginBottom: 16 },
  sentRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#F2F3F0' },
  sentLab: { fontFamily: 'BarlowCondensed_600SemiBold', fontSize: 12.5, color: '#8A93A0',
    textTransform: 'uppercase', letterSpacing: 0.8 },
  sentVal: { flex: 1, textAlign: 'right', marginLeft: 12, fontFamily: 'Barlow_600SemiBold',
    fontSize: 14.5, color: '#151A1E' },
  sentChip: { borderRadius: 8, borderWidth: 1, borderColor: '#F59E0B', backgroundColor: '#FEF6E7',
    paddingVertical: 4, paddingHorizontal: 10 },
  sentChipT: { fontFamily: 'Barlow_600SemiBold', fontSize: 12.5, color: '#B26A00' },
  sentFoot: { fontFamily: 'Barlow_400Regular', fontSize: 12.5, color: '#8A93A0',
    textAlign: 'center', marginTop: 12, lineHeight: 18 },
  cardH: { color: '#5E666E', fontFamily: 'BarlowCondensed_600SemiBold', fontSize: 12.5, textTransform: 'uppercase', letterSpacing: 1.6, marginBottom: 8 },
  cardV: { color: '#151A1E', fontSize: 17, lineHeight: 23, marginBottom: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  // Flow-mock question chips (phase 3). 48px minimum: these are answered on a
  // jobsite, and the field-UX floor applies to every interactive element.
  qRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  qChip: { borderWidth: 1, borderColor: '#d0d7de', borderRadius: 10,
    paddingHorizontal: 14, minHeight: 48, justifyContent: 'center',
    backgroundColor: '#ffffff' },
  qChipOn: { borderColor: '#1f2328', backgroundColor: '#1f2328' },
  qChipT: { fontSize: 15, color: '#1f2328' },
  qChipTOn: { color: '#ffffff' },
  chip: { color: '#536B49', backgroundColor: '#dafbe1', borderColor: '#2da44e', borderWidth: 1,
          borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, fontSize: 12, overflow: 'hidden' },
  chipDim: { color: '#8c959f', borderColor: '#D5D0C7', backgroundColor: 'transparent' },
  chipOn: { color: '#fff', backgroundColor: '#151A1E', borderColor: '#151A1E' },
  cardBtns: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  confirm: { flex: 1, backgroundColor: '#151A1E', borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  // Standalone (not inside s.cardBtns): must NOT use flex:1 -- see above.
  confirmWide: { alignSelf: 'stretch', backgroundColor: '#151A1E', borderRadius: 10,
    paddingVertical: 16, alignItems: 'center', marginBottom: 10 },
  confirmT: { color: '#fff', fontFamily: 'Barlow_700Bold', fontSize: 18, letterSpacing: -0.2 },
  later: { paddingHorizontal: 12, paddingVertical: 14 },
  laterT: { color: '#57606a', fontSize: 13 },
  cardNote: { color: '#5E666E', fontFamily: 'Barlow_400Regular', fontSize: 13, lineHeight: 19, marginTop: 8 },
  drow: { borderTopWidth: 1, borderTopColor: '#D5D0C7', paddingVertical: 10 },
  dsub: { color: '#57606a', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 },
  dval: { color: '#151A1E', fontSize: 15, marginTop: 2 },
  dmeta: { color: '#5E666E', fontFamily: 'Barlow_400Regular', fontSize: 12.5, marginTop: 3 },

  // ── THE LEDGER (prototype c4) ──────────────────────────────────────────────
  ledgerHead: { color: '#151A1E', fontFamily: 'Barlow_700Bold', fontSize: 24,
    letterSpacing: -0.2, marginTop: 6, marginBottom: 10 },
  totalCard: { backgroundColor: '#151A1E', borderRadius: 18, padding: 16, marginBottom: 8 },
  tcRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 3 },
  tcRowLabel: { color: '#AEB4BD', fontFamily: 'Barlow_500Medium', fontSize: 14.5 },
  tcRowVal: { color: '#fff', fontFamily: 'BarlowCondensed_700Bold', fontSize: 18,
    fontVariant: ['tabular-nums'] },
  tcCaution: { color: '#A47A3F' },
  tcGrand: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline',
    borderTopWidth: 1, borderTopColor: '#2A2E35', marginTop: 9, paddingTop: 9 },
  tcGrandLabel: { color: '#E7ECDD', fontFamily: 'BarlowCondensed_600SemiBold', fontSize: 14,
    textTransform: 'uppercase', letterSpacing: 1.6 },
  tcGrandVal: { color: '#fff', fontFamily: 'BarlowCondensed_700Bold', fontSize: 30,
    fontVariant: ['tabular-nums'] },
  flag: { backgroundColor: '#FFF7E0', borderColor: '#F0DE9E', borderWidth: 1, borderRadius: 12,
    paddingVertical: 10, paddingHorizontal: 12, marginBottom: 8 },
  flagT: { color: '#6B5300', fontFamily: 'Barlow_500Medium', fontSize: 13 },
  coCard: { backgroundColor: '#fff', borderColor: '#D5D0C7', borderWidth: 1, borderRadius: 14,
    paddingVertical: 13, paddingHorizontal: 14, marginBottom: 9 },
  coHead: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  coThumb: { width: 64, height: 64, borderRadius: 10, backgroundColor: '#EFEBE3' },
  coThumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  coThumbIcon: { fontSize: 24, opacity: 0.5 },
  coR1: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  coNm: { flex: 1, color: '#151A1E', fontFamily: 'Barlow_600SemiBold', fontSize: 15.5 },
  coR2: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 7 },
  coAmt: { color: '#151A1E', fontFamily: 'BarlowCondensed_700Bold', fontSize: 18,
    fontVariant: ['tabular-nums'] },
  coSub: { color: '#5E666E', fontFamily: 'Barlow_400Regular', fontSize: 12.5, flexShrink: 1,
    textAlign: 'right' },
  coNudge: { color: '#4E6243', fontFamily: 'BarlowCondensed_600SemiBold', fontSize: 13,
    textTransform: 'uppercase', letterSpacing: 0.6 },
  coOnPhone: { color: '#8c959f', fontFamily: 'Barlow_400Regular', fontSize: 11.5, marginTop: 5 },
  // Create date on each ledger row (PRD R7). Hairline above it so it reads as the
  // row's footer rather than another fact competing with the money.
  coCreated: {
    color: '#5E666E', fontFamily: 'BarlowCondensed_600SemiBold', fontSize: 11,
    textTransform: 'uppercase', letterSpacing: 1, marginTop: 6, paddingTop: 6,
    borderTopWidth: 1, borderTopColor: '#D5D0C7',
  },
  // Send sits OUTSIDE the open-record Pressable (see the card above). Its own row,
  // with a real tap target rather than a text hitbox.
  coSendRow: { marginTop: 8, paddingTop: 8, minHeight: 44, justifyContent: 'center' },
  // The AI category tag. Deliberately QUIET — an outlined neutral pill, not another
  // coloured status chip: the status chip (right of the title) carries urgency and
  // must win the eye; the tag only says what kind of work this is.
  coTag: {
    alignSelf: 'flex-start', marginTop: 6, borderRadius: 6, paddingVertical: 2,
    paddingHorizontal: 8, borderWidth: 1, borderColor: '#D0D7DE', backgroundColor: '#F6F8FA',
  },
  coTagT: {
    color: '#5E666E', fontFamily: 'BarlowCondensed_600SemiBold', fontSize: 11.5,
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  // Chips = the notation status. Rounded (not clip-path angled): a clean pill reads
  // better in gloves/sunlight than a cosmetic skew (FIELD-UX). Colour carries meaning.
  chipBase: { borderRadius: 6, paddingVertical: 3, paddingHorizontal: 10 },
  chipText: { color: '#fff', fontFamily: 'BarlowCondensed_600SemiBold', fontSize: 12.5,
    textTransform: 'uppercase', letterSpacing: 0.9 },
  chipTextDark: { color: '#151A1E' },
  chipApproved: { backgroundColor: '#536B49' },
  chipPending: { backgroundColor: '#A47A3F' },
  chipDeclined: { backgroundColor: '#8B5148' },
  chipRevised: { backgroundColor: '#151A1E' },
  // R7 'discussing'. Orange = "this is the one to act on", which is exactly what an
  // unanswered client question is. NOT ink — chipRevised already owns ink, and two
  // statuses that look identical defeat the point of a chip.
  chipDiscussing: { backgroundColor: '#4E6243' },
  bell: { fontSize: 17, opacity: 0.55, paddingHorizontal: 6 },
  bellOn: { fontSize: 15, color: '#fff', backgroundColor: '#4E6243', overflow: 'hidden',
            borderRadius: 11, paddingHorizontal: 8, paddingVertical: 2,
            fontFamily: 'BarlowCondensed_700Bold' },
  chipDraft: { backgroundColor: '#5E666E' },

  hNow: { color: '#536B49', fontSize: 14, marginBottom: 4 },
  hOld: { color: '#8c959f', fontSize: 13, marginBottom: 4, textDecorationLine: 'line-through' },
  money: { backgroundColor: '#fff8c5', borderColor: '#A47A3F', borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 16 },
  moneyScope: { color: '#57606a', fontSize: 14, marginBottom: 10 },
  bigMoney: { color: '#9a6700', fontSize: 44, fontWeight: '800', textAlign: 'center', marginVertical: 6 },
  viewImg: { width: '100%', height: 260, borderRadius: 8, backgroundColor: '#D5D0C7',
    marginBottom: 10 },
  evid: { color: '#151A1E', fontSize: 15, marginBottom: 10 },
  hash: { color: '#57606a', fontSize: 11, fontFamily: 'Menlo', marginBottom: 8 },
  capNote: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#D5D0C7' },
  capNoteBody: { color: '#151A1E', fontSize: 14 },
  capNoteMeta: { color: '#8c959f', fontSize: 11, marginTop: 2 },
  inboxItem: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#D5D0C7' },
  inboxWhat: { color: '#57606a', fontSize: 12, marginBottom: 6 },
  inboxJobs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  inboxJob: { backgroundColor: '#ffffff', borderRadius: 8, paddingHorizontal: 12,
    paddingVertical: 10, borderWidth: 1, borderColor: '#D5D0C7' },
  inboxJobT: { color: '#151A1E', fontSize: 13, fontWeight: '600' },
  langT: { color: '#8c959f', fontSize: 13, fontWeight: '400' },
  scopeLink: { paddingVertical: 8, marginBottom: 6 },
  scopeLinkT: { color: '#9a6700', fontSize: 13, fontWeight: '600' },
  bndRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#D5D0C7' },
  bndSubject: { color: '#151A1E', fontSize: 15 },
  bndOwner: { color: '#536B49', fontSize: 12, marginTop: 2 },
  bndGap: { color: '#9a6700', fontSize: 12, marginTop: 2, fontWeight: '700' },
  bndJobs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  p5: { backgroundColor: '#ffffff', borderColor: '#D5D0C7', borderWidth: 1,
    borderRadius: 10, padding: 12, marginBottom: 12 },
  p5T: { color: '#151A1E', fontWeight: '700', fontSize: 15, marginBottom: 2 },
  p5S: { color: '#57606a', fontSize: 12, marginBottom: 10 },
  oneStatus: { borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 12 },
  oneStatusT: { fontWeight: '700', fontSize: 14 },
  oneStatusD: { color: '#57606a', fontSize: 11, marginTop: 3 },
  // Thumb-sized. This is the first thing a new user ever touches, and they may be
  // wearing gloves when they do it.
  // Language toggle inside the profile form (folded in 2026-07-20). Each option in
  // its own name so it needs no reading; the selected one fills with ink.
  frLangLab: { color: '#5E666E', fontFamily: 'BarlowCondensed_600SemiBold', fontSize: 12.5,
    textTransform: 'uppercase', letterSpacing: 1.6, marginBottom: 8 },
  frLangRow: { flexDirection: 'row', gap: 10, marginBottom: 18 },
  frLangChip: { flex: 1, backgroundColor: '#ffffff', borderColor: '#D5D0C7', borderWidth: 1,
    borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  frLangChipOn: { backgroundColor: '#151A1E', borderColor: '#151A1E' },
  frLangChipT: { color: '#151A1E', fontFamily: 'Barlow_700Bold', fontSize: 17 },
  frLangChipTOn: { color: '#ffffff' },
  // first-run progress dots
  frDots: { flexDirection: 'row', justifyContent: 'center', marginBottom: 8, marginTop: 2 },
  frDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#D5D0C7', marginHorizontal: 4 },
  frDotOn: { backgroundColor: '#151A1E', width: 20 },
  // profile pick buttons (solo/company) — big touch targets (research: 48dp+, gloves)
  pickWide: { alignSelf: 'stretch', backgroundColor: '#ffffff', borderColor: '#D5D0C7',
    borderWidth: 1, borderRadius: 12, paddingVertical: 18, alignItems: 'center', marginBottom: 10 },
  pickOn: { borderColor: '#151A1E', backgroundColor: '#eafaf0', borderWidth: 2 },
  pickT: { color: '#151A1E', fontSize: 18, fontWeight: '700' },
  pickTOn: { color: '#536B49' },
  // trade grid — 2-up big cells
  tradeGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 6 },
  tradeCell: { width: '48%', backgroundColor: '#ffffff', borderColor: '#D5D0C7', borderWidth: 1,
    borderRadius: 12, paddingVertical: 20, alignItems: 'center', marginBottom: 10 },
  tradeCellT: { color: '#151A1E', fontSize: 16, fontWeight: '700' },
  jobBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#ffffff', borderColor: '#D5D0C7', borderWidth: 1,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12 },
  jobBarT: { color: '#151A1E', fontWeight: '700', fontSize: 15, flex: 1 },
  jobBarS: { color: '#8c959f', fontSize: 11 },
  jobRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#D5D0C7' },
  jobName: { color: '#151A1E', fontSize: 16 },
  jobNameOn: { color: '#536B49', fontSize: 16, fontWeight: '700' },
  jobMeta: { color: '#8c959f', fontSize: 12, marginTop: 2 },
  consentBanner: { backgroundColor: '#fff8c5', borderColor: '#A47A3F', borderWidth: 1,
    borderRadius: 10, padding: 12, marginBottom: 14 },
  consentT: { color: '#9a6700', fontWeight: '700', fontSize: 14, marginBottom: 3 },
  consentS: { color: '#7d5e00', fontSize: 12, lineHeight: 17 },
  bundleBtn: { paddingVertical: 8 },
  bundleT: { color: '#4E6243', fontSize: 14, fontWeight: '600' },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6,
    borderBottomWidth: 1, borderBottomColor: '#D5D0C7' },
  lineDesc: { color: '#151A1E', fontSize: 14, flex: 1 },
  lineMath: { color: '#57606a', fontSize: 12 },
  lineX: { color: '#8c959f', fontSize: 16, paddingHorizontal: 6 },
  lineAdd: { flexDirection: 'row', gap: 6, marginTop: 10, marginBottom: 4 },
  lineIn: { flex: 1, backgroundColor: '#ffffff', borderColor: '#D5D0C7', borderWidth: 1,
    borderRadius: 8, color: '#151A1E', paddingHorizontal: 8, paddingVertical: 10, fontSize: 13 },
  linePlus: { backgroundColor: '#D5D0C7', borderRadius: 8, paddingHorizontal: 14,
    justifyContent: 'center' },
  linePlusT: { color: '#151A1E', fontSize: 20, fontWeight: '800' },
  moneyInput: { backgroundColor: '#ffffff', borderColor: '#D5D0C7', borderWidth: 1, borderRadius: 8,
                color: '#151A1E', padding: 12, fontSize: 18, marginBottom: 10, textAlign: 'center' },
  ok: { color: '#536B49', fontSize: 14, marginBottom: 8 },
  warn: { color: '#9a6700', fontSize: 12, marginBottom: 6 },
  ask: { marginTop: 8 },
  askT: { color: '#4E6243', fontSize: 13, fontWeight: '600' },
  frozen: { color: '#151A1E', fontSize: 14, lineHeight: 20, backgroundColor: '#ffffff',
            borderColor: '#D5D0C7', borderWidth: 1, borderRadius: 8, padding: 10, marginBottom: 8 },
  link: { color: '#4E6243', fontFamily: 'Menlo', fontSize: 11, marginVertical: 6 },
  noteRow: { flexDirection: 'row', gap: 8, marginBottom: 22 },
  input: { flex: 1, backgroundColor: '#ffffff', borderColor: '#D5D0C7', borderWidth: 1,
           borderRadius: 10, color: '#151A1E', padding: 12, minHeight: 54, fontSize: 15 },
  save: { backgroundColor: '#4E6243', borderRadius: 10, paddingHorizontal: 18, justifyContent: 'center' },
  contactBtn: { borderWidth: 1.5, borderColor: '#4E6243', borderRadius: 10, paddingVertical: 12,
    alignItems: 'center', marginBottom: 8, marginTop: 4 },
  contactBtnT: { color: '#4E6243', fontFamily: 'Barlow_600SemiBold', fontSize: 15 },
  saveT: { color: '#fff', fontWeight: '800', letterSpacing: 1 },
  gate: { backgroundColor: '#ffebe9', borderColor: '#8B5148', borderWidth: 1, borderRadius: 10, padding: 14, marginBottom: 18 },
  gateT: { color: '#8B5148', fontWeight: '700', marginBottom: 6 },
  gateS: { color: '#57606a', fontSize: 13, lineHeight: 18 },
  mono: { color: '#57606a', fontFamily: 'Menlo', fontSize: 10, marginTop: 8 },

  // ── Projects home ──────────────────────────────────────────────────────
  homeHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  searchIn: { backgroundColor: '#ffffff', borderColor: '#D5D0C7', borderWidth: 1,
    borderRadius: 10, color: '#151A1E', paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, marginBottom: 12 },
  newProjBtn: { backgroundColor: '#151A1E', borderRadius: 12, paddingVertical: 16,
    alignItems: 'center', marginBottom: 14 },
  newProjT: { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: 0.5 },
  inboxCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff8c5',
    borderColor: '#A47A3F', borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 14 },
  inboxCardIcon: { fontSize: 22 },
  inboxCardT: { color: '#9a6700', fontWeight: '700', fontSize: 15 },
  inboxCardS: { color: '#7d5e00', fontSize: 12, marginTop: 2 },
  chev: { color: '#9a6700', fontSize: 26, fontWeight: '300' },
  projCard: { backgroundColor: '#ffffff', borderColor: '#D5D0C7', borderWidth: 1,
    borderRadius: 14, overflow: 'hidden', marginBottom: 14 },
  projCover: { width: '100%', height: 150, backgroundColor: '#D5D0C7' },
  projCoverEmpty: { alignItems: 'center', justifyContent: 'center' },
  projCoverEmptyT: { color: '#afb8c1', fontSize: 64, fontWeight: '800' },
  projBody: { padding: 14 },
  projName: { color: '#151A1E', fontSize: 18, fontWeight: '700' },
  projMeta: { color: '#57606a', fontSize: 13, marginTop: 3 },
  projStats: { color: '#8c959f', fontSize: 12, marginTop: 8 },
  homeEmpty: { color: '#8c959f', fontSize: 14, textAlign: 'center', marginTop: 40, width: '100%' },
  // Company-feed day header (Today / Yesterday / date). Small caps label, olive-tinted.
  feedDayHead: { fontFamily: 'BarlowCondensed_600SemiBold', fontSize: 13, color: '#5E666E',
    textTransform: 'uppercase', letterSpacing: 1.4, marginTop: 20, marginBottom: 6 },

  // ── Project detail ─────────────────────────────────────────────────────
  detailHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 12 },
  backBtn: { paddingVertical: 4, paddingRight: 12 },
  backT: { color: '#4E6243', fontSize: 16, fontWeight: '600' },
  jobBarAddr: { color: '#8c959f', fontSize: 12, marginTop: 2 },
  detailMap: { width: '100%', height: 120, borderRadius: 10, marginBottom: 12, backgroundColor: '#D5D0C7' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingBottom: 40 },
  gridDate: { width: '100%', color: '#57606a', fontSize: 12, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 1, marginTop: 12, marginBottom: 2 },
  tile: { width: '31.8%', aspectRatio: 1, backgroundColor: '#ffffff', borderRadius: 10,
    overflow: 'hidden', borderWidth: 1, borderColor: '#D5D0C7' },
  tileImg: { width: '100%', height: '100%' },
  tileIcon: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#dafbe1' },
  tileIconT: { fontSize: 34 },
  // Badges sit over a photo, so they keep a dark translucent backing + light text
  // regardless of theme — a caption strip on a photo is dark everywhere.
  tileDot: { position: 'absolute', top: 6, right: 6, width: 14, height: 14, borderRadius: 7,
    backgroundColor: '#ffffffcc', borderWidth: 1, borderColor: '#00000022',
    alignItems: 'center', justifyContent: 'center' },
  tileDotInner: { width: 8, height: 8, borderRadius: 4 },
  tileNotes: { position: 'absolute', bottom: 22, left: 6, color: '#fff', fontSize: 11,
    fontWeight: '700', backgroundColor: '#00000099', paddingHorizontal: 5, borderRadius: 6 },
  tileMeta: { position: 'absolute', bottom: 0, left: 0, right: 0, color: '#fff', fontSize: 10,
    paddingHorizontal: 5, paddingVertical: 3, backgroundColor: '#00000099' },
  // ── capture-first home (prototype c1) ──────────────────────────────────────
  homeC: { flex: 1, backgroundColor: '#faf7f3', paddingTop: 54 },  // ink-50
  // ── Home dashboard — matched to the design system: Oswald display + Inter body,
  //    ink/sky/mint/butter palette from Website/src/styles/global.css (2026-07-26) ──
  dashHdr: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingBottom: 6 },
  hdrBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  hdrIcon: { fontSize: 22, color: '#131110' },
  hdrTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 18, color: '#131110' },
  hdrBadge: { position: 'absolute', top: 3, right: 3, minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: '#157a47', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  hdrBadgeT: { color: '#fff', fontSize: 11, fontFamily: 'Inter_700Bold' },
  heroWrap: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 14 },
  // Ratios measured off the mockup (hadar 2026-07-27: "the ratios in the header are
  // wrong"): the headline is a two-line block ~30pt, the figure ~56pt, and the house
  // is a big piece of art filling the right third — not a timid corner decoration.
  heroLabel: { fontFamily: 'Oswald_700Bold', fontSize: 27, lineHeight: 29, color: '#131110',
    textTransform: 'uppercase', letterSpacing: 0.2, maxWidth: 196, marginBottom: 2 },
  // maxWidth is the collision guard: the text box stops short of the house, and
  // adjustsFontSizeToFit shrinks a long figure to fit inside it.
  heroBig: { fontFamily: 'Oswald_700Bold', fontSize: 56, lineHeight: 62, color: '#131110',
    letterSpacing: -0.5, maxWidth: 200 },
  // Hero illustration — the hand-drawn house (assets/house-hero.png), top-right.
  // Its cream ground (#faf7f3) matches the hero bg so it blends without a seam.
  houseArt: { position: 'absolute', right: -8, top: 0, width: 210, height: 168 },
  recoverPill: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, alignSelf: 'flex-start',
    backgroundColor: '#e4f4eb', borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },  // mint-100
  recoverPillT: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: '#157a47' },
  ctaCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#131110',  // ink-900
    marginHorizontal: 16, borderRadius: 16, paddingVertical: 18, paddingHorizontal: 18, marginTop: 2, marginBottom: 16 },
  ctaIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#1e9c5b',  // mint-600
    alignItems: 'center', justifyContent: 'center' },
  ctaIconT: { fontSize: 22 },
  // Home CTA camera (assets/icon-camera-cut.png) — white camera straight on the
  // black card, no tile, matching the mockup.
  ctaCamera: { width: 48, height: 38 },
  ctaTitle: { color: '#fff', fontFamily: 'Oswald_700Bold', fontSize: 20, textTransform: 'uppercase', letterSpacing: 0.4 },
  ctaSub: { color: '#c3bab2', fontFamily: 'Inter_400Regular', fontSize: 13.5, marginTop: 2 },  // ink-300
  // Summary chips — glance-and-jump into the filtered Activity tab.
  sumRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 14 },
  sumChip: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    borderRadius: 12, borderWidth: 1, paddingVertical: 10 },
  sumChipOn: { borderWidth: 2, borderColor: '#131110' },  // the live filter, ringed in ink
  sumNeeds: { backgroundColor: '#f0ebe6', borderColor: '#e2dbd4' },   // ink-100 / ink-200
  sumWait: { backgroundColor: '#fbf3d4', borderColor: '#efd667' },    // butter-100 / butter-400
  sumOk: { backgroundColor: '#e4f4eb', borderColor: '#9fe0bb' },      // mint-100
  sumChipT: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: '#131110' },
  sumWaitT: { color: '#8a6d1f' },
  sumOkT: { color: '#157a47' },
  sumCount: { minWidth: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  sumCountDark: { backgroundColor: '#131110' },
  sumCountWait: { backgroundColor: '#c99a2e' },
  sumCountT: { fontFamily: 'Inter_700Bold', fontSize: 11.5, color: '#fff' },
  sumCheck: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#157a47', alignItems: 'center', justifyContent: 'center' },
  sumCheckT: { color: '#fff', fontSize: 12, fontFamily: 'Inter_700Bold' },
  secHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 18,
    marginTop: 10, marginBottom: 10 },
  secLab: { fontFamily: 'Oswald_600SemiBold', fontSize: 15, color: '#6b625b', textTransform: 'uppercase', letterSpacing: 0.8 },
  seeAll: { fontFamily: 'Inter_600SemiBold', fontSize: 13.5, color: '#285791' },  // sky-700
  secBadge: { minWidth: 20, height: 20, borderRadius: 10, alignItems: 'center',
    justifyContent: 'center', paddingHorizontal: 6 },
  secBadgeWarn: { backgroundColor: '#F59E0B' },
  secBadgeInfo: { backgroundColor: '#4E6243' },
  secBadgeMuted: { backgroundColor: '#6B7280' },
  secBadgeOk: { backgroundColor: '#2DA44E' },
  secBadgeT: { color: '#fff', fontSize: 12, fontFamily: 'Barlow_700Bold' },
  // Extra row: scope + job + price · outlined status pill · chevron. One section =
  // one white surface (exGroup); rows divide with a hairline, not with their own
  // borders. `overflow: hidden` is load-bearing — it clips the first and last row's
  // square corners to the group's radius, and SwipeRow's reveal to the card.
  exGroup: { backgroundColor: '#fff', borderColor: '#ece5de', borderWidth: 1,
    borderRadius: 14, marginHorizontal: 16, marginBottom: 14, overflow: 'hidden' },
  exRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff',
    paddingVertical: 14, paddingHorizontal: 16 },
  exRowRule: { borderTopWidth: 1, borderTopColor: '#f0ebe6' },  // ink-100 hairline
  exName: { fontFamily: 'Inter_600SemiBold', fontSize: 15.5, lineHeight: 20, color: '#131110' },
  exSub: { fontFamily: 'Inter_400Regular', fontSize: 13, color: '#6b625b', marginTop: 2 },
  exPrice: { fontFamily: 'Oswald_700Bold', fontSize: 18, color: '#131110', marginTop: 3, letterSpacing: -0.3 },
  exChip: { borderWidth: 1.5, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 12 },
  exChipT: { fontFamily: 'Inter_600SemiBold', fontSize: 12.5 },
  exChev: { fontFamily: 'Inter_400Regular', fontSize: 22, color: '#c3bab2', marginLeft: 2 },
  tabBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderTopWidth: 1, borderTopColor: '#E9EAE7', backgroundColor: '#fff',
    paddingTop: 8, paddingBottom: 26, paddingHorizontal: 8 },
  // Each half takes equal space on either side of the centered FAB.
  tabHalf: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  tab: { alignItems: 'center', justifyContent: 'center', minWidth: 64, gap: 2 },
  tabIcon: { fontSize: 20, opacity: 0.45 },
  tabIconOn: { opacity: 1 },
  tabLab: { fontFamily: 'Barlow_500Medium', fontSize: 11, color: '#8A93A0' },
  tabLabOn: { color: '#151A1E' },
  fab: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#151A1E',
    alignItems: 'center', justifyContent: 'center', marginTop: -18,
    shadowColor: '#151A1E', shadowOpacity: 0.4, shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  fabT: { color: '#fff', fontSize: 30, marginTop: -2, fontFamily: 'Barlow_400Regular' },
  homeScrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(13,15,18,0.45)', paddingHorizontal: 14 },
  // ── Job screen (per-job detail, mockup 2026-07-23) ─────────────────────────
  jobCard: { flexDirection: 'row', gap: 14, backgroundColor: '#fff', borderColor: '#E9EAE7',
    borderWidth: 1, borderRadius: 16, padding: 14, marginTop: 6, marginBottom: 16 },
  jobCardMap: { width: 96, height: 96, borderRadius: 12, backgroundColor: '#EFEBE3' },
  jobCardMapEmpty: { alignItems: 'center', justifyContent: 'center' },
  jobCardPin: { fontSize: 30 },
  jobCardName: { fontFamily: 'Barlow_700Bold', fontSize: 20, color: '#151A1E' },
  jobCardAddr: { fontFamily: 'Barlow_400Regular', fontSize: 13, color: '#6B7280', marginTop: 1 },
  jobCardTotal: { fontFamily: 'Barlow_700Bold', fontSize: 30, color: '#151A1E', marginTop: 6, letterSpacing: -0.5 },
  jobCardSub: { fontFamily: 'Barlow_400Regular', fontSize: 13, color: '#6B7280' },
  pillRow: { flexDirection: 'row', gap: 8, marginBottom: 18 },
  pill: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderRadius: 10, borderWidth: 1, borderColor: '#E9EAE7', backgroundColor: '#fff',
    paddingVertical: 10, paddingHorizontal: 6 },
  pillNeedsOn: { borderColor: '#6B7280', backgroundColor: '#F1F2F4' },
  pillWaitOn: { borderColor: '#F59E0B', backgroundColor: '#FEF6E7' },
  pillOkOn: { borderColor: '#2DA44E', backgroundColor: '#E9F6ED' },
  pillT: { fontFamily: 'Barlow_600SemiBold', fontSize: 13, color: '#57606a' },
  pillTOn: { color: '#151A1E' },
  pillTWaitOn: { color: '#B26A00' },
  pillTOkOn: { color: '#1A7F37' },
  pillBadge: { minWidth: 18, height: 18, borderRadius: 9, alignItems: 'center',
    justifyContent: 'center', paddingHorizontal: 5 },
  // ── Job extras: approved/awaiting breakdown + grouped sections (2026-07-24) ─
  jxTotals: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderColor: '#E9EAE7', borderWidth: 1, borderRadius: 14, paddingVertical: 14,
    marginTop: 4, marginBottom: 4 },
  jxTotCol: { flex: 1, alignItems: 'center' },
  jxTotDiv: { width: 1, height: 34, backgroundColor: '#ECEEEA' },
  jxTotLab: { fontFamily: 'BarlowCondensed_600SemiBold', fontSize: 11.5, color: '#6B7280',
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 3 },
  jxTotVal: { fontFamily: 'Barlow_700Bold', fontSize: 20, color: '#1A7F37' },
  jxTotWait: { color: '#B26A00' },
  jxSecHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 8, marginTop: 6 },
  jxSecLab: { fontFamily: 'BarlowCondensed_700Bold', fontSize: 14, color: '#151A1E',
    textTransform: 'uppercase', letterSpacing: 0.8 },
  jxSeeAll: { fontFamily: 'Barlow_500Medium', fontSize: 13, color: '#4E6243' },
  jxCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff',
    borderColor: '#E9EAE7', borderWidth: 1, borderRadius: 12, padding: 10, marginBottom: 8 },
  jxThumb: { width: 64, height: 64, borderRadius: 10, backgroundColor: '#EFEBE3' },
  jxName: { fontFamily: 'Barlow_600SemiBold', fontSize: 15.5, color: '#151A1E' },
  jxSub: { fontFamily: 'Barlow_400Regular', fontSize: 12.5, color: '#8A93A0', marginTop: 1 },
  jxAmt: { fontFamily: 'Barlow_700Bold', fontSize: 15.5, color: '#151A1E', marginTop: 3 },
  jxChip: { borderRadius: 8, borderWidth: 1, paddingVertical: 5, paddingHorizontal: 10 },
  jxChipT: { fontFamily: 'Barlow_600SemiBold', fontSize: 12.5 },
  // ── Activity page (mockup 2026-07-23) ──────────────────────────────────────
  actTabs: { flexDirection: 'row', gap: 6, paddingHorizontal: 14, paddingBottom: 10 },
  actTab: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 20,
    borderWidth: 1, borderColor: '#D5D0C7', backgroundColor: '#fff', paddingVertical: 8 },
  actTabOn: { backgroundColor: '#151A1E', borderColor: '#151A1E' },
  actTabT: { fontFamily: 'Barlow_600SemiBold', fontSize: 12.5, color: '#57606a' },
  actTabTOn: { color: '#fff' },
  actDay: { fontFamily: 'BarlowCondensed_600SemiBold', fontSize: 12, color: '#8A93A0',
    letterSpacing: 1.2, marginTop: 16, marginBottom: 8 },
  actRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff',
    borderColor: '#EEEFEC', borderWidth: 1, borderRadius: 12, paddingVertical: 11,
    paddingHorizontal: 12, marginBottom: 8 },
  actIcon: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  actIconT: { fontSize: 18 },
  actName: { fontFamily: 'Barlow_600SemiBold', fontSize: 15, color: '#151A1E' },
  actSub: { fontFamily: 'Barlow_400Regular', fontSize: 12.5, color: '#8A93A0', marginTop: 1 },
  actRight: { alignItems: 'flex-end', gap: 4 },
  actChip: { borderRadius: 6, paddingVertical: 3, paddingHorizontal: 8 },
  actChipT: { fontFamily: 'Barlow_600SemiBold', fontSize: 11.5 },
  actTime: { fontFamily: 'Barlow_400Regular', fontSize: 11.5, color: '#8A93A0' },
  homeTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingBottom: 6 },
  brand: { fontFamily: 'Barlow_700Bold', fontSize: 22, color: '#151A1E',
    letterSpacing: -0.2 },
  brandAccent: { color: '#4E6243' },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hero: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 26, paddingVertical: 16 },
  heroH: { fontFamily: 'Barlow_700Bold', fontSize: 34, color: '#151A1E',
    letterSpacing: -0.2, textAlign: 'center' },
  heroSub: { fontFamily: 'Inter_400Regular', fontSize: 14, color: '#6b625b', marginTop: 4 },
  capBig: { width: 140, height: 140, borderRadius: 70, backgroundColor: '#4E6243',
    alignItems: 'center', justifyContent: 'center', shadowColor: '#4E6243', shadowOpacity: 0.35,
    shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
  capBigIcon: { fontSize: 40, marginBottom: 2 },
  capBigT: { fontFamily: 'Barlow_700Bold', fontSize: 18, color: '#fff',
    letterSpacing: -0.2 },
  heroHint: { fontFamily: 'Barlow_400Regular', fontSize: 13, color: '#5E666E',
    marginTop: 12, textAlign: 'center' },
  capBigBase: { borderRadius: 74, backgroundColor: '#34412E', paddingBottom: 7 },
  waitCard: { backgroundColor: '#fff', borderColor: '#D5D0C7', borderWidth: 1, borderRadius: 14,
    padding: 13, marginBottom: 8 },
  waitRow1: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  waitName: { flex: 1, fontFamily: 'Barlow_700Bold', fontSize: 15.5, color: '#151A1E' },
  waitAmt: { fontFamily: 'BarlowCondensed_700Bold', fontSize: 19, color: '#151A1E' },
  waitRow2: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  waitMeta: { fontFamily: 'Barlow_400Regular', fontSize: 12.5, color: '#5E666E' },
  homeTabs: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  homeTab: { flex: 1, minHeight: 44, borderRadius: 12, borderWidth: 1.5, borderColor: '#D5D0C7',
    backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  homeTabOn: { backgroundColor: '#151A1E', borderColor: '#151A1E' },
  homeTabT: { fontFamily: 'BarlowCondensed_700Bold', fontSize: 16, color: '#5E666E',
    textTransform: 'uppercase', letterSpacing: 1.4 },
  homeTabTOn: { color: '#fff' },
  waitCardTodo: { borderColor: '#FFD9C2', backgroundColor: '#FFF7F2' },
  waitChipTodo: { backgroundColor: '#4E6243' },
  waitCardOk: { backgroundColor: '#F3FAF5', borderColor: '#BFE3CD' },
  waitNameOk: { color: '#536B49' },
  waitChipOk: { backgroundColor: '#536B49' },
  waitChipNo: { backgroundColor: '#8B5148' },
  waitChip: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 2,
    transform: [{ skewX: '-10deg' }] },
  waitChipSent: { backgroundColor: '#A47A3F' },
  waitChipDraft: { backgroundColor: '#151A1E' },
  waitChipT: { fontFamily: 'BarlowCondensed_600SemiBold', fontSize: 12, color: '#fff',
    textTransform: 'uppercase', letterSpacing: 1 },
  recCard: { backgroundColor: '#151A1E', borderRadius: 16, padding: 15, marginBottom: 12,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  recLab: { fontFamily: 'BarlowCondensed_600SemiBold', fontSize: 12, color: '#9BA2AB',
    textTransform: 'uppercase', letterSpacing: 1.4 },
  recVal: { fontFamily: 'BarlowCondensed_700Bold', fontSize: 28, color: '#fff', marginTop: 2 },
  jobsWrap: { flex: 1, paddingHorizontal: 18, paddingTop: 4 },
  assignC: { flex: 1, backgroundColor: '#151A1E', paddingTop: 54 },
  assignReceipt: { marginHorizontal: 18, backgroundColor: '#15271C', borderColor: '#1E5236',
    borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 16 },
  assignSaved: { color: '#3fb950', fontFamily: 'BarlowCondensed_700Bold', fontSize: 19,
    textTransform: 'uppercase', letterSpacing: 1 },
  assignThumb: { width: 44, height: 44, borderRadius: 8, borderWidth: 1, borderColor: '#2A2E35' },
  assignMeta: { color: '#AEB4BD', fontFamily: 'BarlowCondensed_600SemiBold', fontSize: 16,
    marginLeft: 12, letterSpacing: 1 },
  assignH: { color: '#fff', fontFamily: 'Barlow_700Bold', fontSize: 28,
    letterSpacing: -0.2, marginBottom: 12 },
  assignSearch: { backgroundColor: '#1B1E24', borderColor: '#2A2E35', borderWidth: 1,
    borderRadius: 12, paddingHorizontal: 14, minHeight: 52, fontSize: 16, color: '#fff',
    fontFamily: 'Barlow_400Regular', marginBottom: 10 },
  assignRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1B1E24',
    borderColor: '#2A2E35', borderWidth: 1, borderRadius: 14, paddingHorizontal: 14,
    paddingVertical: 15, marginBottom: 8 },
  assignRowName: { color: '#fff', fontFamily: 'Barlow_600SemiBold', fontSize: 16.5 },
  assignRowMeta: { color: '#8A9099', fontFamily: 'Barlow_400Regular', fontSize: 13.5, marginTop: 2 },
  assignChev: { color: '#5E666E', fontSize: 22, marginLeft: 8 },
  assignNew: { backgroundColor: '#4E6243', borderRadius: 14, minHeight: 56, alignItems: 'center',
    justifyContent: 'center', marginBottom: 12 },
  assignNewT: { color: '#fff', fontFamily: 'Barlow_700Bold', fontSize: 18,
    letterSpacing: -0.2 },
  jobItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderColor: '#D5D0C7', borderWidth: 1, borderRadius: 14, paddingHorizontal: 14,
    paddingVertical: 14, marginBottom: 8 },
  jobItemName: { fontFamily: 'Barlow_600SemiBold', fontSize: 16.5, color: '#151A1E' },
  jobItemMeta: { fontFamily: 'Barlow_400Regular', fontSize: 13, color: '#5E666E', marginTop: 2 },
  jobCount: { fontFamily: 'BarlowCondensed_700Bold', fontSize: 19, color: '#151A1E', marginRight: 8 },
});
