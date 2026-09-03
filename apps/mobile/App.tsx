import '@azure/core-asynciterator-polyfill';
import 'react-native-get-random-values';

import { OPSqliteOpenFactory } from '@powersync/op-sqlite';
import { PowerSyncDatabase, type AbstractPowerSyncDatabase } from '@powersync/react-native';
import * as FS from 'expo-file-system/legacy';
import * as Contacts from 'expo-contacts';
import React from 'react';
import { Alert, AppState, Dimensions, Image, Keyboard, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppSchema } from './src/AppSchema';
import { ago, projectCards, projectCoCounts, type ProjectCard } from './src/ui/home';
import { cachedMaps, mapUrlFor } from './src/mapcache';
import { REJECT_DDL, SupabaseConnector } from './src/connector';
import { forgetSeenOnboarding, getSeenOnboarding, setSeenOnboarding } from './src/auth';
import { buildLine, useOta } from './src/otaclient';
// The same "what is still unfinished" count the OTA gate uses. Reused deliberately:
// two independent definitions of "unsent" would drift, and this one is the audited
// list of every owned outbox.
import { inFlight } from './src/ota';
import { Onboarding } from './src/ui/onboarding';
import { RecordConsent } from './src/ui/recordconsent';
import { SETUP_ART, StepHowItWorks, StepLanguage, StepProfile, type Work } from './src/ui/setupflow';
import { FirstExtra } from './src/ui/firstextra';
import { GuidedCoach } from './src/ui/guidedcoach';
import { StepDone, StepGaps, StepReview, StepTranscript,
         type ScheduleChoice } from './src/ui/guidedsteps';
import { COACH_PROMPTS } from './src/guidedflow';
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
// Camera permission via expo-image-picker, matching `modality.ts:snapPhoto` — the
// codebase's existing way of asking. expo-camera exposes only a hook here, and
// on iOS both resolve to the same NSCameraUsageDescription grant anyway.
import * as ImagePickerPerm from 'expo-image-picker';
import { photoCapture, pickFromLibrary, snapPhoto, textCapture, voiceCapture } from './src/modality';
import { publishReplyMedia } from './src/replymediapublish';
import { checkJobs, checkMembers, checkSendQuota, currentPlan, currentProductId, rememberEntitledPlan,
         rememberEntitledProduct, type QuotaKind } from './src/quota';
import { usageSummary, type UsageSummary } from './src/usage';
import { UsageCard, UsageNudge } from './src/ui/usagecard';
import { QuotaModal } from './src/ui/quotamodal';
import { HeldSendModal } from './src/ui/heldsendmodal';
// What an empty list says. TRUE empties only — a filtered or searched list keeps its one
// quiet line, because a drawing reading "nothing yet" over a filtered list is false.
import { EmptyState } from './src/ui/emptystate';
import { findAddressTwin } from './src/dupeaddress';
// The developer flag (417). A build-time `__DEV__` cannot answer "who is holding the
// phone", which is the case hadar has: replaying the intro on a release build.
import { cachedDeveloper, refreshDeveloper } from './src/devflag';
// The in-app banner for a client message. iOS shows no banner of its own while the app is
// foreground, so this is the only surface that can carry a question arriving mid-session.
import { MessageToast } from './src/ui/messagetoast';
// The one unfinished state that cannot fix itself: processed, silent, and still empty.
import { ClientPickScreen } from './src/ui/clientpickscreen';
import { SilentNoticeSheet } from './src/ui/silentnoticesheet';
import { ensureSilentNoticeSchema, markSilentNoticeShown, pendingSilentNotices,
         type SilentNotice } from './src/silentnotice';
import { pendingNotifications } from './src/discussionstore';
// THE APPROVAL CELEBRATION (hadar, 2026-08-18: "the most important event that everything
// is leading to is approved … we should also celebrate it").
import { ApprovedCelebration } from './src/ui/approvedcelebration';
// The letterhead the EXPORTED document prints. Cached rather than fetched — a change
// order handed over in a basement must still carry the contractor's own name.
import { cacheLetterhead, cachedLetterhead, readLetterhead } from './src/letterhead';
import { celebrationDescription, celebrationLine, ensureCelebrateSchema, markCelebrated,
         pendingCelebrations, type Celebration } from './src/celebrate';
import { SwipeRow } from './src/ui/swiperow';
import { PaywallScreen } from './src/ui/paywallscreen';
import { PLANS, type PlanId } from './src/plans';
import { Icon, type IconName } from './src/ui/icon';
import { Svg, Circle } from 'react-native-svg';
import { C, F } from './src/ui/theme';
import { radii, shadows } from './src/ui/tokens';
import { FusedCapture, type FusedArtifacts } from './src/ui/capturescreen';
import { SplashScreen } from './src/ui/splashscreen';
import { Drawer } from './src/ui/drawer';
import appJson from './app.json';
import { ensurePairSchema, linkPair } from './src/pair';
import { backfillPairOutbox, drainPairOutbox, ensurePairSyncSchema, enqueuePair,
         hydratePairs } from './src/pairsync';
import { ensureAugmentSchema, noteAugment, appendAugmentDesc } from './src/augmentlog';
import { ensureAugmentRetrySchema, markAugmentPending, clearAugmentPending,
         retryPendingAugments } from './src/augmentretry';
import { cancelledSmsBody, clientSmsBody, type ClientSmsKind } from './src/clientsms';
import { reachable, remindTargets } from './src/remindrecipients';
import { sendSms } from './src/sms';
import { runAutoTags } from './src/autotag';
import { AddressInput } from './src/ui/addressinput';
import { FlowRail } from './src/ui/flowrail';
import { FlowHoldScreen } from './src/ui/flowhold';
import { MapThumb } from './src/ui/mapthumb';
import { syncLine, syncState } from './src/syncstate';
import { OfflineBar } from './src/ui/offlinebar';
import { deleteEmptyProject, deleteHoldsKey, deleteRefusalKey,
         localCaptureCount, purgeProject, purgeRefusalKey } from './src/deleteproject';
import { ReviewScreen } from './src/ui/reviewscreen';
import { PhotoLightbox, RecordScreen, scheduleSentence, billingSentence,
         type RecordLifecycle } from './src/ui/recordscreen';
import { FixtureDraft } from './src/ui/__fixturedraft';
import { FixtureNegotiation } from './src/ui/__fixturenegotiation';
import { FixtureLocked } from './src/ui/__fixturelocked';
// SPEC-extra-lifecycle-v1 — the detail subscreens the three stage screens open.
// They are OVERLAYS in the cascade (an early return above `record`), the same way
// every other screen in this app navigates; a router introduced in one corner would
// be a second navigation model nobody else obeys.
import { BillingSheet, ClientSheet, CostSheet, DescriptionSheet, ExclusionsSheet, ScheduleSheet } from './src/ui/extrasheets';
import { BottomSheet, ConfirmSheet } from './src/ui/kit';
import { FullHistory, PhotosAndProof,
         type RewriteState } from './src/ui/extradetails';
import type { ExtraDetailField } from './src/ui/extranegotiation';
// REQ-LC10..13 — the CONTENT half of the send gate. Orthogonal to canSendExtra
// (the pipeline half): both must pass and they fail for different reasons.
import { sendReadiness, hasWrittenScope, UNTITLED_SCOPE } from './src/sendreadiness';
import { mergeTimeline, openCount, type MergedEvent } from './src/eventtimeline';
import { SettingsScreen } from './src/ui/settingsscreen';
import { extraState, extraBucket, isClosed } from './src/extrabucket';
import { acceptInvite, billingTenantId, createInvite, ensureBillingTenant, ensureOwnCompany,
         listMembers, listMyCompanies, myCompany, resolveMyCompany, setActiveCompany,
         type Member } from './src/company';
import { closeMyAccount } from './src/closeaccount';
import { claimDevice } from './src/deviceowner';
import { restoreAccountFlags } from './src/accountflags';
import { cacheMirroredPhotos, ensureMirrorSchema, hydrateEvidence } from './src/evidencemirror';
import { ensureLogoCached, pickLogo, removeCompanyLogo,
         saveCompanyLogo } from './src/companylogo';
import { configureBilling, entitledPlanNow, entitledProductNow } from './src/billing';
import { LABELS, labelHex } from './src/labels';
import { companyFeed, type FeedItem } from './src/feed';
import { ExtraCard, ExtraList } from './src/ui/extracard';
import { setDraftClient,
} from './src/changeorder';
import { requestExtraReview } from './src/reviewrequest';
import { sendPlan, toggleMember } from './src/sendplan';
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
         SCOPE_MAX_CHARS, isNamedClient } from './src/startextra';
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
import { draftPrice, type PriceMode, type VoicePriceReading } from './src/voiceprice';
import { VoicePriceCard } from './src/ui/voicepricecard';
// R1: the Send-to prefill. GPS decides what to SUGGEST and never what to file --
// prepareSendTo returns candidates and an opinion, the human commits it.
import { SendToCard } from './src/ui/sendtocard';
import { prepareSendTo, quickAddDestination } from './src/sendtoprep';
import type { SendToPrefill, SendToProject } from './src/sendto';
import { displayPhone } from './src/sendto';
// R8 in-app activity centre. The push half needs a provider; this half needs
// nothing but the rows already on the device, and without it there is no path at
// all from "a client asked something" to the contractor noticing.
import { ensureActivitySchema, activityFor, markRead,
         ensureRemindSchema, noteLinkSent, liveLinkFor, noteReminded } from './src/activitystore';
// THE CREDIT GATE (hadar, 2026-08-17: "queue it — but needs to prompt the user letting
// them know that they cannot send if they don't have credits"). Three modules, three
// jobs, and they are deliberately not one: `credits` asks the server what is available
// and holds one, `sendgate` decides what the tap does, `sendhold` is the durable queue
// that makes "it goes out on its own" true rather than a slogan.
import { refreshBalance, releaseCredit, reserveCredit,
         type CreditBalance } from './src/credits';
import { decideSend } from './src/sendgate';
import { clearHold, ensureSendHoldSchema, heldSends, holdSend, holdsToDrain,
         noteHoldAttempt } from './src/sendhold';
// Prices and the checkout address come from the server, never from this binary — the
// rail is a court case away from changing and must not need an App Store review.
import { loadPricing, railsFor, type PricingConfig } from './src/pricingconfig';
// R8 / R5b push. Local notifications: the green light and a client question
// reach the contractor with the phone in his pocket, with no provider behind it.
import { ensureNotifySchema, notifyPermissionStatus, requestNotifyPermission,
         runNotifications } from './src/notifystore';
import { opensConversation } from './src/notify';
// R8: Remind is not Resend. Resend mints a NEW token and retires the one already in
// the client's messages; a reminder must go via the SAME link (R8) or the nudge
// breaks the thing it is nudging about.
import { canRemind, reminderText } from './src/remind';
import { alreadyCommittedItems, closeLandedDrafts,
         ensureDraftSchema, sweepDrafts, recoverableDrafts, readDraftArtifacts,
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
import { unreadByChangeOrder, unreadCount, unreadIds, unreadMessageIdsFor,
         unreadMessagesByChangeOrder, type ActivityRow } from './src/activity';
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
import { initFeedback, signalApproved, signalArmed, signalFailed, signalSaved, signalReady } from './src/feedback';
import { getLang, setLang, t as T, type Lang, type Msg } from './src/i18n';
import { addParty, assignBoundary, drainScopeOutbox, ensurePartySchema, listBoundaries,
         listParties, nameBoundary } from './src/parties';
import { captureStatus, levelColor, screenStatus } from './src/status';
import { FIRST_RUN_TAPS, firstExtraSeen, isFirstRun, markFirstExtraSeen, markFirstRunDone,
         nextStep, resetFirstRunFlags, savedLang, saveLang } from './src/firstrun';
import { getProfile, hasProfile as hasProfileFn, saveLangToAccount, saveProfile } from './src/profile';
import { addNote, drainNoteOutbox, ensureAnnotationSchema, noteCounts, notesFor,
         playCapture, stopPlayback, type Note } from './src/annotate';
import { addTag, drainTagOutbox, ensureTagSchema, projectTags, retractTag,
         tagMap, tagsFor } from './src/tags';
import { listRejected, createProject, ensureProjectSchema, ensureResolutionSchema, fileCapture, inboxCount,
         INBOX_ID, listProjects, resolveProject, touchProject, distanceM, effectiveProject,
         setProjectStatus, type Project } from './src/projects';
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
  ensureApproverSchema, drainR5cOutbox, hydrateApprovers, suggestFor, listRoster, listKnownPeople, addApprover,
  markApproverUsed, setExtraType, reasonText, typeLabel, roleLabel, saveClientApprover, noteSmsConsent,
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
         createdLabel, markLocalSent, money, moneyWhole, parseMoney, validateLines,
         CO_AUTHOR_JOIN, CO_PHOTO_SUBQUERY,
         type LineItem, type LedgerRow, intactLineItems, priceDraftExtra, setDraftFlowFields, rehomeDraftExtra,
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
(globalThis as any).__EZ_BUILD__ = 'v219-hookfix';
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
/**
 * How long the opening artwork stays up at minimum (hadar, 2026-08-26).
 *
 * A FLOOR measured from mount, not a delay added to boot: a launch slower than this
 * is unaffected, and a launch faster than this is padded out to it so the splash
 * reads as an opening rather than a flicker.
 */
const SPLASH_MIN_MS = 2000;

const OWNER_FALLBACK = 'owner-local';

/**
 * HOW CLOSE "YOU ARE STANDING ON IT" IS ALLOWED TO MEAN, in metres.
 *
 * The job picker's closest-job card says that sentence out loud, and it is a claim
 * about the physical world made from a phone fix. A consumer GPS fix is good to
 * roughly 5-20 m in the open and worse between buildings, so 30 m is about the
 * tightest radius the hardware can actually support. Outside it the card still shows
 * the distance — it just stops narrating where he is.
 *
 * Deliberately NOT the project's `geofence_m`: that fence decides what auto-files,
 * and a contractor who set a 200 m fence around a large site did not thereby agree to
 * be told he is standing on a building he can barely see.
 */
/** How many recent locations step 2 shows before "See all". Three is what fits under
 *  the search box without pushing "new location right here" off the screen. */
const RECENT_CAP = 3;

const STANDING_ON_M = 30;

/** How long the splash may cover a first sync before the Home takes over and says
 *  what it actually knows. See `holdExpired` for why a bound is mandatory. */
const FIRST_SYNC_SPLASH_MS = 8_000;

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
  /** The live client link's URL, for the copy row on the waiting card. Null until an
   *  extra has been sent; `co_live_link` holds one live token per extra. */
  linkUrl: string | null;
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

/**
 * The first line of a saved block of text, clipped, for the acknowledgement popup.
 *
 * ECHOING A SCOPE OF WORK IN FULL WOULD DEFEAT THE POPUP: it can run to a paragraph,
 * and a confirmation you have to scroll is not a confirmation. The first line is what a
 * writer put first, so it is the line that identifies the edit. The ellipsis is the
 * honest marker that there is more — the popup confirms WHICH text was saved, and the
 * record behind it is where it is read in full.
 */
function firstLine(text: string, max = 64): string {
  const line = (text ?? '').trim().split('\n')[0]?.trim() ?? '';
  if (line.length <= max) return line;
  return line.slice(0, max - 1).trimEnd() + '…';
}

/** Guards `drainHolds` against two overlapping runs — see the comment there. */
let draining = false;

/**
 * The approval whose celebration is currently on screen, so the tick does not re-fire the
 * haptic every 15 seconds at a contractor who is already reading it. Module scope for the
 * same reason `draining` is: it is checked from a tick and from a foreground listener,
 * and it must not participate in the hook order.
 */
let celebratedHead: string | null = null;

/**
 * The last client message shown as a banner, so a tick that runs before the push path has
 * stamped it does not raise the same banner twice. Module scope for the same reason
 * `draining` is: it is read from a tick and must not join the hook order.
 */
let toastedMessageId: string | null = null;

/**
 * EVERY APP-OWNED LOCAL TABLE, built in the one order that works.
 *
 * Extracted from the launch effect (2026-08-21) because it now has a SECOND caller:
 * a device handover (`claimDevice`) DROPs every one of these tables — that is what a
 * wipe is — and the app has to keep running afterwards for the incoming user. Before
 * this, the only thing that could recreate them was a cold start, so a purge mid-run
 * left the app pointed at tables that no longer existed.
 *
 * DUPLICATING THE LIST WAS THE ALTERNATIVE AND IT WAS WORSE. Thirty `ensure*` calls
 * written out twice drift the first time somebody adds the thirty-first, and the
 * failure is silent: the new table simply does not come back after a handover, and
 * the screen that reads it is empty for reasons nobody will connect to this.
 *
 * THE ORDERING COMMENTS ARE LOAD-BEARING and moved with the calls. Several of these
 * ALTER `change_order`, so it has to exist first; two seed watermarks by selecting
 * existing rows, so the rows have to be there.
 */
async function ensureLocalSchema(
  db: AbstractPowerSyncDatabase, ownerId: string
): Promise<void> {
  await ensureAppOwnedSchema(db);
  await ensureDecisionSchema(db);
  await ensureChangeOrderSchema(db);
  for (const s of REJECT_DDL) await db.execute(s);
  await ensureProjectSchema(db, ownerId);
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
  // AFTER ensureChangeOrderSchema for the same reason ensureNotifySchema is: it seeds
  // its watermark by selecting the already-approved rows, so change_order has to
  // exist. A SEPARATE stamp from notify_sent — see celebrate.ts for why the push and
  // the popup cannot share one.
  await ensureCelebrateSchema(db);
  // AFTER ensureChangeOrderSchema, same as the celebration's: it seeds its watermark
  // by selecting existing change orders, so the table has to exist.
  await ensureSilentNoticeSchema(db);
  // The sends waiting on a credit. BEFORE the auth gate like the rest of these,
  // because a hold written on the last run has to be readable on this one whether or
  // not the session came back — the promise it carries ("it goes out on its own") was
  // made to the person holding the phone, not to a session.
  await ensureSendHoldSchema(db);
  // R1: the draft session store. A SEPARATE directory from capture-tmp, which
  // recoverySweep empties unconditionally — draft media must survive that sweep,
  // so it never lives there.
  await ensureDraftSchema(db);
  await ensureDiscardSchema(db);
  await ensureDiscardSyncSchema(db);
  // R6b: who captured / priced / sent, and who it was addressed to.
  await ensureExtraActorSchema(db);
  await ensureConsentSchema(db);
  await ensurePairSchema(db);
  await ensureAugmentSchema(db);
  await ensureAugmentRetrySchema(db);
  // R2: the device's own copy of transcripts, so the price read-back keeps
  // working in a basement (mandate #7). Fetching is opportunistic; a miss is an
  // empty, flagged price field, never a blocked screen.
  await ensureVoiceCacheSchema(db);
  await ensureSttSchema(db);
  // The account's captures as held in the cloud — what makes an extra's photos show
  // up on a phone that did not take them. A CACHE beside `capture_commit`, never a
  // replacement for it; see evidencemirror.ts for why that distinction is load-bearing.
  await ensureMirrorSchema(db);
  // The transport for capture_pair (sql/418). AFTER ensurePairSchema, which creates
  // the table this queue carries.
  await ensurePairSyncSchema(db);
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
  /** The exact product being paid for, so the paywall's monthly/annual toggle can tell
   *  Core-annual from Core-monthly instead of marking the whole tier as current. */
  const [paywallProduct, setPaywallProduct] = React.useState<string | null>(null);
  const [showFeed, setShowFeed] = React.useState(false);         // REQ-PM9 Company feed
  const [notifTab, setNotifTab] = React.useState<string>('all'); // Notifications filter
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
  /** Owner of a tenant that is an actual COMPANY (not a solo freelancer's own row).
   *  Gates the roster/invite surfaces; billing and the letterhead do not use it. */
  const [hasTeam, setHasTeam] = React.useState(false);
  /** Every tenant this person belongs to, and which one this device is working in.
   *  One or none hides the switcher entirely — the freelancer never sees it. */
  const [companies, setCompanies] = React.useState<
    { id: string; name: string; isOwner: boolean }[]>([]);
  /** The close-account confirmation. Null = closed. */
  const [closeAcct, setCloseAcct] = React.useState<null | { busy: boolean }>(null);
  /**
   * THE COMPANY'S LOGO for the drawer. `co` is name + id, resolved on the same tick as
   * the plan; `logoUri` is a LOCAL file path (companylogo.ts) so the panel draws it with
   * no network and no signed URL to expire.
   */
  const [co, setCo] = React.useState<{ id: string; name: string } | null>(null);
  const [logoUri, setLogoUri] = React.useState<string | null>(null);
  /** The company's CURRENT logo_key, so a removal can delete the file it cached. */
  const [logoKey, setLogoKey] = React.useState<string | null>(null);
  /**
   * ─── THE CREDIT GATE'S THREE PIECES OF STATE ──────────────────────────────────
   *
   * `pricing` is where the checkout lives. Null until the first read, and the buy button
   * is simply absent until then rather than pointed at a guessed URL — `purchaseUrl`
   * returns null without a token, and a dead checkout is the one failure that takes a
   * contractor's money nowhere.
   *
   * `noCredits` is the prompt hadar asked for. It is NOT an error state: the change order
   * is saved, held and going to send. It exists because a queue nobody is told about is
   * worse than a refusal — he would walk away believing the client has it.
   *
   * `heldN` is how many are waiting, so the app can say so out loud instead of only at
   * the moment of the tap.
   */
  /**
   * APPROVALS HE HAS NOT BEEN SHOWN YET, oldest first, shown one at a time.
   *
   * A QUEUE and not a single value: three can land while the app is closed, and stacking
   * three modals or silently dropping two would both be wrong. The head is on screen, the
   * tail is counted in "2 more were approved too" so nothing is hidden.
   */
  const [celebrations, setCelebrations] = React.useState<Celebration[]>([]);
  /** The client message currently banner-ing at the top of the screen, if any. */
  const [msgToast, setMsgToast] = React.useState<
    null | { id: string; changeOrderId: string; scope: string; body: string }>(null);
  /** The processed-but-silent extra currently being reported, if any. */
  const [silent, setSilent] = React.useState<SilentNotice | null>(null);
  /**
   * Developer tools visible? `__DEV__` OR the server flag, resolved together here so the
   * DRAWER ROW AND ITS HANDLER CANNOT DISAGREE — they were gated separately on `__DEV__`,
   * and moving only one would put a row on screen that does nothing when tapped.
   */
  const [devUser, setDevUser] = React.useState(false);
  const devTools = __DEV__ || devUser;
  const [pricing, setPricing] = React.useState<PricingConfig | null>(null);
  /** The server's answer to "what can this account send". Read at launch and after a
   *  purchase return; `null` until then, and null is UNKNOWN and never rendered as 0. */
  const [credits, setCredits] = React.useState<CreditBalance | null>(null);
  const [noCredits, setNoCredits] = React.useState<null | { changeOrderId: string }>(null);
  const [heldN, setHeldN] = React.useState(0);
  /**
   * Has `refresh()` ever completed? A REF, not state — nothing should re-render because
   * of it; it exists so the guided-start gate can refuse to fire on the empty lists that
   * exist before the first read, rather than flashing a walkthrough over an established
   * contractor's Home on every cold start (found by review, 2026-08-13).
   */
  const loadedRef = React.useRef(false);
  const [loadedOnce, setLoadedOnce] = React.useState(false);
  /**
   * HAS ANYBODY ACTUALLY ASKED THE SERVER YET (hadar, 2026-08-21: "this is what I see
   * when I first login" — a full-screen "NO EXTRAS YET" at an account with three).
   *
   * `loadedOnce` means "refresh() has run", which on a freshly signed-in phone is true
   * and useless: it read an empty local table and returned honestly empty. An empty
   * local table is NOT evidence of an empty account until the server has been asked.
   *
   *   'unknown'     — no hydrate has completed this session. Say nothing definite.
   *   'yes'         — the server answered. Zero rows now MEANS zero.
   *   'unreachable' — the server was asked and could not be reached. Zero rows still
   *                   means nothing, and the screen must not pretend otherwise.
   *
   * Sticky once 'yes': a later offline tick does not un-know what we learned.
   */
  const [synced, setSynced] = React.useState<'unknown' | 'yes' | 'unreachable'>('unknown');
  /**
   * HOLD THE SPLASH FOR THE FIRST SYNC — BUT NOT FOREVER (hadar, 2026-08-21: "if it
   * takes time to load the first time we need to display the splash screen until it
   * loads no?").
   *
   * He is right, and only for the FIRST load. Once anything is local this app is
   * local-first and paints instantly from SQLite; the gap is the one moment a device
   * has an account and no rows yet, where the alternative to a splash is a half-built
   * Home that fills in under the reader.
   *
   * THE BOUND IS NOT OPTIONAL, and it is his own finding: on 2026-08-04 he reported a
   * 30-second cold start and the fix was that the session must never gate first paint,
   * because on a jobsite the network is the slow thing and an unbounded splash is
   * indistinguishable from a hang. Mandate #7 says the same: the network is
   * opportunistic, never a precondition. So the hold expires, and what is behind it is
   * a Home that says honestly which of "getting", "none" or "can't reach" it is in.
   *
   * Eight seconds: long enough to cover a normal first pull, short enough that a dead
   * connection is admitted rather than sat on.
   */
  const [holdExpired, setHoldExpired] = React.useState(false);
  const [logoSheet, setLogoSheet] = React.useState(false);
  const [logoBusy, setLogoBusy] = React.useState(false);
  // When set, the capture screen AUGMENTS this existing extra (adds photos/voice as
  // appended evidence) instead of minting a new extra (hadar, 2026-07-25).
  const [augmentCoId, setAugmentCoId] = React.useState<string | null>(null);
  /** Step 6 of a new extra: who is this for. Set by `fileWalkTo` after the job is
   *  chosen; `onDone` starts the processing screen once it is answered or skipped. */
  const [clientPick, setClientPick] = React.useState<null | {
    coId: string; projectId: string;
    roster: Array<{ id: string; name: string; role?: string }>;
    /** Everyone on the account's OTHER locations (`listKnownPeople`), deduped. */
    known: Array<{ id: string; name: string; role?: string; phone?: string | null }>;
    onDone: () => void; busy: boolean;
  }>(null);
  // REQ-PROC8: the capture whose AI proposal is being reviewed, or null.
  const [review, setReview] = React.useState<string | null>(null);
  // Walkthrough saved to the Inbox and awaiting a job: a change order MUST belong to a
  // job, so this sheet asks — nearby jobs, search, or create one here. Captures are
  // already durable before it opens; dismissing leaves them safe in the Inbox.
  const [assign, setAssign] = React.useState<null | {
    /**
     * The captures this walk is about to commit, resolving to their ids and the change
     * order behind them (hadar, 2026-08-23 — the sheet now opens BEFORE the commit
     * finishes, so it cannot be handed the ids up front). `fileWalkTo` awaits this, so
     * a tap that lands before durability waits for it rather than racing it.
     *
     * Optional because the OTHER caller — the parked-capture path on the processing
     * screen — is filing captures that committed long ago and passes `ids` directly.
     */
    ready?: Promise<{ ids: string[]; anchorCoId: string; anchorCaptureId: string | null }>;
    ids?: string[]; lat: number | null; lng: number | null;
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
  /**
   * WHERE HE IS STANDING, in words, for the job picker.
   *
   * The artboard's create-a-job row says "Pre-filled with 1155 Stanyan St" — it names
   * the address before he taps rather than after, so the row is a promise he can read
   * instead of a surprise on the next screen. That needs the reverse geocode resolved
   * while the picker is up, not inside the tap handler.
   *
   * `undefined` = not asked yet, `null` = asked and there is no answer (no fix, or no
   * network for the lookup). The row falls back to its generic subtitle on null, and
   * `newJobHere` still does its own lookup — this is a nicety, never the source of
   * truth for what the new job gets named.
   */
  const [hereAddr, setHereAddr] = React.useState<string | null | undefined>(undefined);
  /** Which fix `hereAddr` was looked up for — see the picker's use of it. */
  const hereAddrKey = React.useRef<string | null>(null);
  const [sendToId, setSendToId] = React.useState<string | null>(null);
  // R8: the bell. `activity` is the list; the bell now NAVIGATES to the notifications
  // screen rather than opening a sheet — `activityOverlay` was a second, older
  // rendering of this same list and was retired 2026-08-18.
  const [activity, setActivity] = React.useState<ActivityRow[]>([]);
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
  // Step 2's recent list is capped; "See all" lifts the cap for the rest of the visit.
  const [showAllJobs, setShowAllJobs] = React.useState(false);
  // The ☰ menu on Home: the jobs list + language now live behind it, because the
  // dashboard's front page is the money, not navigation (hadar, 2026-07-23 mockup).
  const [menuOpen, setMenuOpen] = React.useState(false);

  /**
   * THE SYNC LINE for the drawer. Re-read when the drawer opens and every 5s while it
   * is open — never on a timer behind a closed menu, because this is a diagnostic
   * nobody is reading most of the time and it counts rows in twelve tables.
   */
  const [syncLabel, setSyncLabel] = React.useState<string | null>(null);

  /**
   * CONNECTED, AND HOW MUCH IS WAITING — for the offline bar.
   *
   * Subscribed, not polled: `addNetworkStateListener` fires on the transition, which
   * is the moment the bar has to appear or go. Starts OPTIMISTIC (`true`) so a cold
   * launch never flashes an offline bar at somebody whose phone is fine — the first
   * reading corrects it within a tick, and a false alarm on launch is worse than a
   * beat of silence.
   */
  const [online, setOnline] = React.useState(true);
  const [pendingUp, setPendingUp] = React.useState(0);
  // `netReachable`, not `reachable`: this file already has a `reachable()` that
  // filters remind targets to those with a phone number. Two subjects, one name.
  const [netReachable, setNetReachable] = React.useState<boolean | null>(null);
  const [strugglingUp, setStrugglingUp] = React.useState(0);
  /** A home-screen quick action arrived. Held until the app is `ready` — on a cold start
   *  the deep link lands before the database is open, and a flag waits where a call is
   *  lost. */
  const [pendingCapture, setPendingCapture] = React.useState(false);
  /** The last home-screen quick action taken, so AppDelegate's cold-start retries of the
   *  SAME press collapse to one open. See the `ezjobsite://capture` branch below. */
  const quickActionNonce = React.useRef<string | null>(null);
  /**
   * Which door the current full-screen overlay (Settings or Plans) was opened through, so
   * its back button returns there. The drawer closes itself before running any of its
   * actions, so without this the menu is simply gone when you come back out.
   *
   * ONE variable for both, deliberately: only one of these is ever open at a time, and
   * two flags that must agree about the same fact is how they end up disagreeing.
   */
  const [settingsFrom, setSettingsFrom] = React.useState<'drawer' | 'screen'>('drawer');
  // The Job screen's pill filter (hadar, 2026-07-23 mockup): null = all extras.
  const [jobFilter, setJobFilter] =
    React.useState<null | 'needs' | 'waiting' | 'approved' | 'closed'>(null);
  const [labelFilter, setLabelFilter] = React.useState<string | null>(null); // REQ-PM14 Jobs-list filter
  // The Jobs list filters by STATE now, not only by colour (design, 2026-08-31). It is
  // the same three buckets the job screen and every job card already use, so the pill
  // you press and the number you pressed it because of cannot disagree.
  const [jobStat, setJobStat] = React.useState<'needs' | 'waiting' | 'approved' | null>(null);
  const [jobsArchived, setJobsArchived] = React.useState(false);             // REQ-PM4 Jobs-list archived view
  const [archivedCards, setArchivedCards] = React.useState<ProjectCard[]>([]);
  // Change orders per job, for the Jobs list cards. One read for every job (see
  // projectCoCounts) rather than one per card while the list is being dragged.
  const [jobCounts, setJobCounts] = React.useState<Record<string, import('./src/ui/home').JobCoCounts>>({});
  // Job id -> local file:// URI of its cached map snapshot. Fetched once per set of
  // coordinates and kept on disk, so the list costs one Static Maps request per job
  // ever and still draws with no signal (see src/mapcache.ts).
  const [jobMaps, setJobMaps] = React.useState<Record<string, string>>({});
  // The job just created, while its confirmation sheet is up. Null the rest of the
  // time. Holds the id because both of the sheet's actions need to land ON that job.
  const [jobCreated, setJobCreated] = React.useState<null | { id: string }>(null);
  const [waiting, setWaiting] = React.useState<Array<{
    id: string; scope: string; amount_cents: number; status: string;
    project_id: string; pname: string; signed_by: string | null; created_at_ms: number }>>([]);
  const [recovered, setRecovered] = React.useState<{ cents: number; n: number }>({ cents: 0, n: 0 });
  /**
   * THE WIN OVERLAY IS GONE — REPLACED, not deleted (hadar, 2026-08-18).
   *
   * What used to live here: a `celebrate` state, an in-MEMORY `celebratedRef` watermark,
   * and a 3.8-second auto-dismissing card showing the summed dollar value of whatever had
   * just been approved. It served communication gap #1 and it worked while the app was
   * open.
   *
   * WHY IT COULD NOT STAY. Its watermark was a `useRef` seeded on the first refresh of
   * each launch, so an approval that landed while the app was closed was recorded as
   * already-celebrated the moment he opened it, and he was shown nothing. hadar's ask —
   * "when the app is OPENED after a CO was approved, a popup should show up" — is
   * precisely the case that overlay could never serve, because a watermark that lives in
   * memory cannot remember across a launch.
   *
   * The replacement (`celebrate.ts` + `celebrateEl`) keeps the watermark in SQLite,
   * celebrates one change order at a time rather than a summed batch, carries the signed
   * description, and links to the record. Two celebrations racing each other would have
   * been worse than either alone, so this one is retired rather than left beside it.
   */
  // The Home dashboard's extras, ACROSS every job (hadar, 2026-07-23 mockup): the
  // sent extras waiting on a client, each with who directed it, its job, and whether
  // the client has asked a question. `questions` is the same open-question count the
  // ledger's "discussing" chip reads — a sent extra with one is the ball in YOUR court.
  const [homeExtras, setHomeExtras] = React.useState<Array<{
    id: string; scope: string; amount_cents: number | null; status: string;
    project_id: string; pname: string; who_directed: string; created_at_ms: number;
    signed_by: string | null; questions: number; photo_relpath: string | null;
    // WHO RAISED IT. Home showed the date and no person at all, while the company feed
    // showed both — the same object, two shapes (hadar, 2026-08-17). Null renders as
    // ABSENT, never "Unknown": inventing an author on a record that carries a
    // signature is the one thing this field must not do.
    created_by: string | null;
    // The change-order number is the shared card's kicker (2026-08-13). `nte_cents` and
    // the schedule columns were added here in the same change and removed again when
    // the pricing-type and schedule lines came off the card — they had no other reader.
    co_number: number | null;
    /** 1 when any capture behind this extra is still in the outbox — the row then says
     *  so in steel-blue. SQLite's EXISTS returns an integer, not a boolean. */
    pending_upload: number;
    /** The change order ITSELF is still in this device's outbox — a different
     *  question from whether its media has uploaded. */
    record_pending: number }>>([]);
  // The funnel ABOVE change orders — a walkthrough IS an extra in the making, and the
  // Extras tab must show the whole pipeline, not only the signed paperwork at the end.
  const [captured, setCaptured] = React.useState<Array<{
    pair_id: string; start_ms: number; photos: number; voice_id: string | null }>>([]);
  const [unsent, setUnsent] = React.useState<Array<{
    id: string; subject: string; project_id: string; created_at_ms: number; pname: string }>>([]);
  const [ready, setReady] = React.useState(false);
  /**
   * HOLD THE SPLASH FOR A BEAT (hadar, 2026-08-26: "when the app opens i would like
   * the splashscreen to be visable for 2 seconds or so").
   *
   * Boot can finish in a few hundred milliseconds on a warm start, and the artwork
   * then appeared and vanished as a flicker — which reads as a glitch rather than as
   * an opening. This is a FLOOR, not a delay: the clock starts at mount and runs
   * alongside the real boot work, so a launch that takes longer than the floor pays
   * nothing extra. Only a launch that beats it gets padded.
   *
   * It gates the SPLASH ONLY. Every effect, every read, every migration keeps running
   * underneath — `ready` is untouched, deliberately, because it is what a dozen
   * effects wait on and delaying it would delay actual work rather than a picture.
   */
  const [splashHeld, setSplashHeld] = React.useState(true);
  React.useEffect(() => {
    const id = setTimeout(() => setSplashHeld(false), SPLASH_MIN_MS);
    return () => clearTimeout(id);
  }, []);

  // Placed after `ready` exists — see `syncLabel` above for why it only runs while
  // the drawer is open.
  React.useEffect(() => {
    if (!menuOpen || !ready) return;
    let live = true;
    const read = () => {
      void syncState(db)
        .then((st) => { if (live) setSyncLabel(syncLine(st, Date.now())); })
        .catch(() => { if (live) setSyncLabel(null); });
    };
    read();
    const id = setInterval(read, 5000);
    return () => { live = false; clearInterval(id); };
  }, [menuOpen, ready, db]);

  // The bar's two inputs. The network half is a subscription; the queue half is
  // re-read on every network change and on a slow tick, because a drain that empties
  // the outbox while offline should take the number down with it.
  React.useEffect(() => {
    let live = true;
    const readNet = (st: { isConnected?: boolean | null; isInternetReachable?: boolean | null }) => {
      if (!live) return;
      setOnline(st?.isConnected !== false);
      // CONNECTED IS NOT REACHED. A dead hotspot, a captive portal and cell with a
      // bar and no data all report `isConnected: true` — the bar missed every one of
      // them until this was read too.
      setNetReachable(st?.isInternetReachable ?? null);
    };
    void Network.getNetworkStateAsync().then(readNet).catch(() => {});
    const sub = Network.addNetworkStateListener(readNet);
    return () => { live = false; sub?.remove?.(); };
  }, []);

  React.useEffect(() => {
    if (!ready) return;
    let live = true;
    const read = () => {
      void syncState(db)
        .then((st) => { if (live) { setPendingUp(st.queued); setStrugglingUp(st.struggling); } })
        .catch(() => { /* the bar just drops the count */ });
    };
    read();
    // 20s, not 5: this is a number on a passive bar, not a diagnostic somebody is
    // watching, and it counts rows in twelve tables.
    const id = setInterval(read, 20_000);
    return () => { live = false; clearInterval(id); };
  }, [ready, db, online]);
  const [gate, setGate] = React.useState<string | null>(null);
  const [initError, setInitError] = React.useState<string | null>(null);
  // AUTH. `session` undefined = still checking the stored token; null = logged out;
  // a Session = logged in. A valid stored token lands straight on the main screen.
  const [session, setSession] = React.useState<Session | null | undefined>(undefined);
  // The 4-slide intro is shown once to a logged-out newcomer, then never again.
  const [seenOnboarding, setSeen] = React.useState(false);
  /**
   * DEV ONLY — put the intro on the screen from the Metro inspector.
   *
   * The in-app "Show intro again" row still exists and is the answer for a human. This
   * is the answer for ME: reviewing a design I cannot see means asking the user to hunt
   * for a control on every iteration, and every one of those round trips is a minute of
   * theirs spent doing my verification. `globalThis.__showIntro()` renders it directly.
   */
  React.useEffect(() => {
    if (!__DEV__) return;
    (globalThis as any).__showIntro = () => setForceIntro(true);
    // Same reasoning as __showIntro: the guided start only appears on an account with
    // no jobs and no change orders, which is not a state a working phone can be put
    // into for a design review. This OVERRIDES the data conditions, not just the flag —
    // setting the flag alone would have done nothing on a phone that has jobs.
    (globalThis as any).__showFirstExtra = () => setForceFirstExtra(true);
    // Same door for step 2, so all four guided screens can be reviewed without a mic.
    (globalThis as any).__showCoach = () => { setForceFirstExtra(true); setGuided('coach'); };
    // DEV ONLY — open the paywall without hunting for the CTA that leads to it. The
    // monthly/annual split has two states per card and reviewing them by hand means
    // navigating there twice; this is the door.
    // Routed through `openPaywall`, not `setShowPaywall`: the former reads the current
    // plan first, and skipping it made the sheet open against a stale 'free'.
    (globalThis as any).__showPaywall = () => { void openPaywall(); };
    // DEV ONLY — land on a job screen without tapping through Home. Takes a project id,
    // or defaults to the most recently touched job.
    // DEV ONLY — open a record straight from the inspector, and optionally land on a
    // stage's sheet. Reviewing the Messages sheet otherwise takes four taps through a
    // job and a card, which is four taps I cannot make.
    (globalThis as any).__openRecord = (coId?: string) => {
      void (async () => {
        const pick = coId ?? (await db.getAll<{ id: string }>(
          `SELECT id FROM change_order WHERE status IN ('sent','opened','question')
            ORDER BY created_at_ms DESC LIMIT 1`))[0]?.id;
        if (pick) {
          const row = (await db.getAll<{ project_id: string }>(
            `SELECT project_id FROM change_order WHERE id = ?`, [pick]))[0];
          if (row) setProjectId(row.project_id);
          await openRecord(pick);
        }
      })();
    };
    (globalThis as any).__openJob = (id?: string) => {
      void (async () => {
        const pick = id ?? (await db.getAll<{ id: string }>(
          `SELECT id FROM project ORDER BY COALESCE(last_used_ms, created_at_ms) DESC LIMIT 1`))[0]?.id;
        if (pick) { setProjectId(pick); setNav('project'); await refresh(); }
      })();
    };
    // DEV ONLY — mint the billing tenant and REPORT what the server said. The startup
    // path swallows the outcome by design (a failed mint must never block capture), so
    // there was no way to see whether create_company succeeded, failed, or never ran.
    (globalThis as any).__mintTenant = async () => {
      (globalThis as any).__mint = 'pending';
      try {
        const prof = await getProfile(db);
        const name = (prof?.isSolo ? '' : (prof?.company ?? '')).trim() || (prof?.name ?? '').trim();
        if (!name) { (globalThis as any).__mint = 'no name in profile'; return; }
        // The SAME call the startup path makes. A probe that used the old client-side
        // route would pass while the real one was broken — the mistake `__startRec`
        // already made once.
        const r = await ensureBillingTenant(connector.client, db, {
          companyName: prof?.isSolo ? null : (prof?.company ?? null),
          personName: prof?.name ?? null,
        });
        (globalThis as any).__mint = r ?? ('null — ' + String((globalThis as any).__tenantErr ?? 'no reason'));
      } catch (e: any) {
        (globalThis as any).__mint = 'THREW ' + String(e?.message ?? e);
      }
    };
    (globalThis as any).__hideIntro = () => setForceIntro(false);
    /**
     * DEV ONLY — SCREENSHOT THE PHONE, READABLE FROM THE METRO INSPECTOR.
     *
     * Built after the third round of "it's still off" on a screen I cannot see. Every
     * one of those rounds cost hadar a screenshot and me a guess, and the guesses were
     * the expensive part: I sized the onboarding by eye twice and was wrong twice,
     * because eyeballing a design against a render I am only imagining is not a
     * measurement. This makes it one.
     *
     * base64 into a global rather than a file or an upload: no bucket, no cleanup, no
     * credentials, and nothing left on the device. The reader pulls it in slices,
     * because a whole screen of base64 is megabytes and a single CDP response that size
     * is not worth relying on. JPEG at 0.5 — this is for measuring geometry, not for
     * judging the photograph's grain.
     */
    (globalThis as any).__shot = async () => {
      (globalThis as any).__SHOT = 'pending';
      try {
        const VS = await import('react-native-view-shot');
        (globalThis as any).__SHOT = await VS.captureScreen({
          format: 'jpg', quality: 0.5, result: 'base64',
        });
      } catch (e: any) {
        (globalThis as any).__SHOT = 'ERR ' + String(e?.message ?? e);
      }
    };
  }, []);
  /** Which button on the landing page got him here — 'signup' or 'login'. */
  const [authIntent, setAuthIntent] = React.useState<'signup' | 'login'>('signup');
  // DEV ONLY — read the resolved intent from the inspector. Its own effect, with a real
  // dependency: hung off the big `[]` effect above it would have closed over the first
  // value forever and reported 'signup' no matter which button was pressed.
  React.useEffect(() => {
    if (__DEV__) (globalThis as any).__authIntent = () => authIntent;
  }, [authIntent]);
  /**
   * DEV ONLY — show the intro OVER whatever is on screen.
   *
   * hadar asked "how can I see these pages in the app?" twice, and the honest answer was
   * "you can't, from where you are." The intro renders inside `session === null`, and
   * the replay link I added lives on the sign-in screen — so the moment he signed in,
   * BOTH the pages and the door to them disappeared. A control you can only reach from
   * the state you are trying to leave is not a control.
   *
   * This is a separate flag, checked before every other branch, so it works from any
   * screen and in any auth state. It changes nothing about when a real user sees the
   * intro: `seenOnboarding` still governs that, and the branch that reads this flag is
   * gated on `devTools` — a debug build, or a user flagged in `developer_user` (417).
   * It was `__DEV__` alone until 2026-08-18, which meant the tool did not exist on the
   * exact build hadar wanted it on.
   */
  const [forceIntro, setForceIntro] = React.useState(false);
  /**
   * THE GUIDED FIRST CHANGE ORDER (hadar, 2026-08-12): "the first time a user uses the
   * application and after he registers, if there are no jobs or change orders."
   *
   * Null until the flag has been read — NOT false. A false default would render Home for
   * one frame and then swap it for the walkthrough, which is the flash-of-the-wrong-app
   * this file already fixed once for the language picker. Nothing renders until we know.
   */
  const [firstExtra, setFirstExtra] = React.useState<boolean | null>(null);
  /** DEV ONLY — render the guided start over a populated account. */
  const [forceFirstExtra, setForceFirstExtra] = React.useState(false);
  /**
   * Which guided screen is showing. Only the two screens AHEAD of the recorder need a
   * cursor: from the capture onward `guidedStep()` derives the position from what
   * exists, so there is nothing here to keep in step with the database.
   */
  const [guided, setGuided] = React.useState<'intro' | 'coach' | null>(null);
  /**
   * IS THE GUIDED FLOW RUNNING. Set when he enters from the intro and cleared when he
   * finishes or leaves — it is what makes the recorder show its prompt strip and what
   * routes the post-capture path through the guided screens instead of the ordinary
   * ones. Separate from `guided` (which screen) because the flow outlives both of the
   * screens that cursor names.
   */
  const [guidedOn, setGuidedOn] = React.useState(false);
  /** Step 5/7/9/10's own screen, once the recording exists. Null = not in them. */
  const [gStep, setGStep] = React.useState<null | 'transcript' | 'gaps' | 'review' | 'done'>(null);
  const [gTranscript, setGTranscript] = React.useState<string | null>(null);
  const [gAmount, setGAmount] = React.useState('');
  const [gSched, setGSched] = React.useState<ScheduleChoice | null>(null);
  const [gDays, setGDays] = React.useState('');
  const [gNotes, setGNotes] = React.useState('');
  const [gSending, setGSending] = React.useState(false);
  const [gPlaying, setGPlaying] = React.useState(false);

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
      /**
       * THE HOME SCREEN QUICK ACTION lands here too (hadar, 2026-08-19: "a plugin on the
       * phone desktop — one click create change order"). Long-pressing the app icon posts
       * `ezjobsite://capture` through the same RCTLinkingManager path the sign-in link
       * uses (AppDelegate.swift), so this listener gains one case rather than the app
       * gaining a bridge.
       *
       * IT SETS A FLAG RATHER THAN OPENING THE CAMERA. Two reasons, and the second is the
       * one that makes it work:
       *   · the terms gate has to be honoured exactly as the ⊕ button honours it, and
       *     this closure would otherwise read a STALE `terms` (the effect mounts once);
       *   · on a cold start this URL can arrive before the app is `ready`, and a flag
       *     waits where a function call would simply be lost.
       */
      if (url.startsWith('ezjobsite://capture')) {
        /**
         * ONE NONCE, ONE OPEN (code review, 2026-08-23).
         *
         * AppDelegate now posts this URL SIX times across the first seven seconds,
         * because a cold-start shortcut is dropped outright when no JS listener exists
         * yet and a single 0.35 s post missed it every time the bridge was slower than
         * that. The retries all carry the same `n=`, so taking a nonce once makes the
         * rest free — and stops a late retry re-opening the camera on a man who already
         * pressed back. A second long-press is a new invocation with a new nonce and is
         * honoured. A URL with no nonce (an older build's shortcut) is always taken.
         */
        const n = url.split('n=')[1] ?? null;
        if (n) {
          if (quickActionNonce.current === n) return;
          quickActionNonce.current = n;
        }
        setPendingCapture(true);
        return;
      }
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
    // The recipient's phone, when known — enables automatic SMS (Twilio via the
    // send-sms Edge Function). Null falls back to the phone's own share sheet.
    phone?: string | null;
    /**
     * Why delivery did NOT complete. Null/absent on a successful send.
     *
     * This is the honest half of "just send it" (hadar, 2026-08-14). The request and
     * its frozen instrument exist either way — `markLocalSent` has already moved the
     * row out of draft — so a failure here is not "nothing happened", it is "the
     * client has not been told". The screen has to say that difference out loud, or
     * the contractor walks away believing a link went out that did not.
     */
    failWhy?: string | null;
    /** The facts the SMS body needs, carried so the RETRY on this sheet sends the same
     *  short message the first attempt did — not the seven-segment instrument. */
    sms?: { kind: ClientSmsKind; companyName?: string | null; jobLabel?: string | null;
            amountText?: string | null } } | null>(null);
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
  setRecordWriteUp('unknown'); setRecordPrice(null);
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
    /**
     * AND THEN ASK THE SERVER, instead of concluding from the empty queue that it
     * produced nothing (hadar, 2026-08-21).
     *
     * `captureDelivery` answers a question about THIS PHONE — is the queue empty, is
     * the radio up. The draft screen was reading its silence as an answer about the
     * SERVER, and the two are twenty seconds apart on a good day: on his fireplace
     * extra the outbox emptied at 18:44:03 and the write-up existed at 18:44:23.
     *
     * ONLY when the files are actually up, because until then the question is not
     * even meaningful — nothing has been given to the server to write up, and asking
     * would cost a round trip to learn something we already know.
     *
     * A refusal (offline, timeout) leaves it 'unknown', which is the truthful answer
     * and keeps the screen in its wait state. Mandate #7: no signal is Tuesday, and
     * "we could not ask" must never render as "there is nothing".
     */
    if (d.pending === 0 && d.parked === 0 && !d.gate && ids.length) {
      try {
        const prop = await fetchLatestProposalForCaptures(connector.client, ids);
        if (recordIdRef.current === changeOrderId && !prop) setRecordWriteUp('absent');
        /**
         * AND READ THE PRICE OFF THE SEGMENTS WHILE THE PROPOSAL IS IN HAND
         * (hadar, 2026-08-21: "if it recognises the price line items on the recordings
         * it should total it — the set total button is redundant").
         *
         * The screen's read-back has been parsing `change_order.price_heard`, which is
         * ONE span — sql/396 stores the first priced segment's words and nothing else.
         * On his fireplace extra that span is "cost of $1,200, and that includes the
         * garbage fees", so the button offered $1,200 as the TOTAL of a job that is
         * $1,200 + $400 + the staining. A tappable button that writes a third of the
         * price is worse than no button: it is wrong with a tick next to it.
         *
         * `priceFromTasks` is the function for this and has been since the summing
         * work — it walks EVERY segment the model priced, parses each span with the
         * app's own `parseMoney`, refuses the whole total if any span is unreadable
         * ("4 teen $100"), and returns the breakdown beside the sum. It was wired into
         * the priced composer only, which is the one screen hadar's extras never reach
         * when the transition screen times out. Nothing new is trusted here: same
         * parser, same refusals, same read-back — it is simply asked on the screen
         * where the price is actually missing.
         */
        if (recordIdRef.current === changeOrderId && prop) {
          /**
           * A WHOLE-JOB TOTAL IS NOT A SEGMENT PRICE, AND IT WAS FALLING THROUGH.
           *
           * hadar's fireplace extra ended with "all in all, about $1,200" and arrived
           * with no price: the model was told to leave every segment null when one
           * figure covers the job, and this screen only ever asked the segments.
           *
           * `draftPrice` owns both readings and the rule for which may be written
           * without asking — see its header for why the two differ. It is in
           * voiceprice.ts so the rule is testable; it was inline here, where nothing
           * could reach it.
           */
          const { reading: pr, writable } = draftPrice(prop.tasks, prop.fromTranscript, parseMoney);
          setRecordPrice(pr);
          /**
           * AND WRITE IT, WITHOUT ASKING (hadar, 2026-08-21, asked directly and
           * answered: no tap — fill it in automatically, editable if it is wrong).
           *
           * THIS IS A DELIBERATE, LOGGED DEPARTURE FROM MANDATE #2, which says
           * anything carrying a price takes a human confirmation before it commits.
           * CLAUDE.md §2 allows exactly this — "do not violate without an explicit,
           * logged decision" — and this is the decision, made by the product owner in
           * response to a question that showed him both behaviours side by side.
           *
           * WHAT STILL PROTECTS THE NUMBER, because the mandate's substance is not
           * abandoned, only moved:
           *   · The figure is arithmetic over numbers HE said. The model chose which
           *     words are a price; `parseMoney` — ours, one implementation — made every
           *     number; the model is still forbidden to author one (mandate #6).
           *   · `priceFromTasks` refuses the whole total if ANY segment's span is
           *     unreadable, so a garbled figure produces no prefill rather than a
           *     confident wrong sum. That refusal is the reason this is safe to write.
           *   · The breakdown is on the screen, so the sum is checkable, and the extra
           *     is a DRAFT — he can edit the figure or any line before it goes.
           *   · Sending remains a separate, deliberate human act with the price on
           *     screen. That is the "before it sends" half of mandate #2, intact.
           *
           * ONLY ONTO AN UNPRICED DRAFT. `priceDraftExtra`'s own
           * `WHERE status = 'draft'` is the second guard; this is the first. A figure a
           * human typed is never overwritten by one the app worked out — that would be
           * the app arguing with the contractor about his own price.
           */
          const row = (await db.getAll<{ amount_cents: number | null }>(
            `SELECT amount_cents FROM change_order
              WHERE id = ? AND status = 'draft' AND amount_cents IS NULL`,
            [changeOrderId]))[0];
          if (row && writable && pr && pr.amountCents !== null) {
            const cents = pr.amountCents;
            const co = coRowsRef.current.find((c) => c.id === changeOrderId);
            const res = await priceDraftExtra(db, {
              changeOrderId,
              amountCents: cents,
              lineItems: pr.breakdown.map((b) => ({
                description: b.title, qty: 1, unit_cents: b.cents, total_cents: b.cents,
              })),
              nteCents: pr.mode === 'nte' ? cents : null,
              whoDirected: co?.who_directed || 'Owner',
              numbersConfirmedAt: new Date(),
              // The SELECT above already asked; this asks again IN the write, because
              // between the two he can type his own price on the screen he is looking
              // at. The app must never overwrite a figure a human entered.
              onlyIfUnpriced: true,
            });
            // A refusal is REPORTED. `validateLines` can reject this on a rounding gap,
            // and an auto-fill that silently does nothing is the worst of both worlds —
            // no price and no button, because the button hides once the reading exists.
            if (!res.ok) void logDiag(db, 'price.autofill', res.reason.slice(0, 200));
            else if (recordIdRef.current === changeOrderId) { await openRecord(changeOrderId); }
          }
        }
      } catch { /* could not ask -> stays 'unknown' -> stays a wait */ }
    }
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
    /**
     * THE SENTINEL MUST NOT MATCH A PERSON (hadar, 2026-08-19: created a change order
     * offline and "it entered the person created it as the client by default").
     *
     * `who_directed` is NOT NULL and every extra born from a capture is seeded with the
     * literal role word "Owner" (startextra.ts). This lookup matched that raw string
     * against the roster — and the roster on a real device HAS a person named "Owner",
     * and another named "hadar wissotzky", both left behind by an older build whose
     * client sheet prefilled the sentinel into an editable name field. Verified in the
     * live database, not inferred.
     *
     * So a brand-new extra silently adopted whoever happened to collide with the
     * placeholder, and on his phone that was himself: the contractor became the client
     * of his own change order. Offline made it visible rather than causing it — with no
     * network there is no AI pass to extract a real name, so the seed survives to be
     * matched.
     *
     * `isNamedClient` is the guard that already exists for exactly this word and it is
     * used two lines below for `requestedBy`. It belongs here too: an unnamed extra has
     * NO client, and "no client yet" is the state the draft screen is built to show.
     */
    if (isNamedClient(co.who_directed)) {
      const want = (co.who_directed ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
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
      linkUrl: link?.url ?? null,
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
        // THE UNNAMED SEED IS NOT AN OWNER. `who_directed` is NOT NULL and every
        // extra born from a capture is seeded with the literal role word "Owner"
        // (startextra.ts), so `co.who_directed || null` was never null in practice —
        // which meant the draft screen drew a person row for a signer who does not
        // exist, and its no-owner state was unreachable on every extra this app has
        // ever created. `clientRow` — a REAL roster person matched by name — wins
        // when there is one, exactly as the record header already does.
        requestedBy: clientRow?.name
          ?? (isNamedClient(co.who_directed) ? co.who_directed : null),
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
/**
 * The change order the capture flow just produced, if the contractor is still looking
 * at it. Nothing but the progress rail depends on it.
 *
 * IT IS AN ID, NOT A BOOLEAN, and that is the whole point: a flag would still be true
 * when he closed this record and opened an unrelated draft, and he would be shown "step
 * 5 of 5" on a change order he made last week. Comparing ids means the rail is right by
 * construction rather than by remembering to clear it.
 */
const [flowRecordId, setFlowRecordId] = React.useState<string | null>(null);
/**
 * THE SEQUENCE MUST NOT BLINK (hadar, 2026-09-03: "when i move between the steps it
 * keeps displaying the home screen between next and rendering the next screens").
 *
 * Every step of the create flow is a screen selected by its OWN state — `assign`,
 * `clientPick`, `transition`, the record. Moving between two of them is an async
 * handler: commit the captures, read the roster, mint the extra. For the whole of that
 * await the previous state is already null and the next one is not set yet, so nothing
 * in the chain matches and the render falls through to HOME.
 *
 * The contractor sees his dashboard — "$0 waiting", the upgrade banner — flash between
 * every step of making a change order. It reads as the flow collapsing and restarting,
 * four times in a row, and it is the same defect as the ack landing on Home: a screen
 * appearing at a moment when the app is in the middle of something else.
 *
 * `flowHold` is raised by each hand-off and dropped the moment any flow screen mounts.
 * The step it carries is the one being ENTERED, so the rail keeps counting up instead
 * of resetting.
 *
 * IT SELF-HEALS. A hand-off that throws, or one added later that forgets to raise it,
 * must never strand a man on a placeholder — the backstop below drops it after 2.5s no
 * matter what. Being wrong for two seconds beats being stuck.
 */
const [flowHold, setFlowHold] = React.useState<null | 1 | 2 | 3 | 4 | 5>(null);

/**
 * THE FLOW SURVIVES A RE-RECORD (hadar, 2026-09-02: "in preview mode if I record a
 * change, get me back to the preview — the user stays in a loop until he chooses to
 * send or closes for now").
 *
 * `augmentExtra` calls `closeRecord()` on its way to the camera, and `closeRecord`
 * clears `flowRecordId` — correctly, because leaving a record normally does end the
 * journey. But going out to record a correction is not leaving: it is the middle of
 * reviewing. Without this the contractor came back to the full record screen and the
 * loop broke on its first turn.
 *
 * A REF, NOT STATE: nothing renders from it, and it must survive the unmount that
 * `closeRecord` triggers rather than schedule a re-render into a screen that is going
 * away.
 */
const flowResumeRef = React.useRef<string | null>(null);

const closeRecord = () => {
  // Leaving the record ends the journey. Coming back to it later is not a continuation
  // of anything, so the rail must not survive the exit.
  setFlowRecordId(null);
  recordIdRef.current = null;
  setRecord(null); setApproval(null); setRecordLc(null); setRecordTimeline([]);
  setRecordThread(null); setRecordUndelivered(new Set()); setRecordDelivery(null);
  setRecordWriteUp('unknown'); setRecordPrice(null);
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
/**
 * WHERE BACK GOES (hadar, 2026-08-19: "in the drawer the company section back button
 * closes the drawer while it should take back to the main menu").
 *
 * The drawer's own `go()` closes the drawer before running the action, so by the time
 * Settings is up the menu is gone — and `onBack` only hid Settings, dropping the user on
 * whatever screen was underneath. From the drawer that reads as being thrown out of the
 * menu; the reader's model is a menu he stepped INTO, so back should step out to it.
 *
 * BUT SETTINGS HAS THREE DOORS, and the third is not the drawer: the notifications screen
 * has a gear in its header. Reopening the drawer unconditionally would open a menu that
 * reader never came from. So the origin is remembered and back returns to it.
 */
const openSettings = async (
  mode: 'profile' | 'company' = 'profile', from: 'drawer' | 'screen' = 'drawer'
) => {
  setSettingsFrom(from);
  const p = (await getProfile(db)) ?? { name: '', isSolo: true, company: null, trade: null };
  /**
   * PROMOTE ONLY SOMEBODY WHO BELONGS NOWHERE (review 2026-08-25).
   *
   * `ensureOwnCompany` calls `create_company`, and that RPC's idempotence check is
   * `where owner_id = uid` — OWNERSHIP, not membership (sql/376). A crew member owns
   * nothing, so it does not return his company; it CREATES one and makes him its owner.
   * The condition above is true for exactly that person: the setup flow's 'invited'
   * answer saves `isSolo: false` with his employer's name, so opening Settings once
   * would have handed him a ghost company wearing his boss's name — the same ghost the
   * new onboarding step exists to prevent, re-minted through a different door.
   *
   * It was reachable before that step existed, too: anyone who answered "I have a
   * company" and then joined a real one hit it just the same.
   *
   * `resolveMyCompany`, not `myCompany`, because a device whose `company` bucket has
   * not arrived answers null locally while the server holds a real membership — and
   * null here is what triggers the mint. Asking the server is the whole point; it also
   * caches what it learns, so this costs one round-trip once.
   */
  if (!p.isSolo && (p.company ?? '').trim()) {
    try {
      const existing = await resolveMyCompany(db, connector.client, OWNER);
      if (!existing) {
        await ensureOwnCompany(connector.client, (p.company as string).trim(), p.name);
        await refresh();
      }
    } catch { /* offline — the promote retries next time Settings opens */ }
  }
  setSettingsProfile(p);
  setSettingsMode(mode);
  setShowSettings(true);
};

// Open the paywall, reading the company's current plan so it marks "Your plan".
const openPaywall = async (from: 'drawer' | 'screen' = 'drawer') => {
  setSettingsFrom(from);
  setPaywallPlan(await currentPlan(db));
  /**
   * LOAD THE PRICES HERE, not only in the drawer effect (hadar, 2026-08-19, on the
   * TestFlight build: "where is the pay as you go").
   *
   * The packs section renders only when `pricing` has arrived, and `pricing` was set in
   * ONE place: the effect that also mints the billing tenant, re-keys RevenueCat and
   * resolves the company. So a purchase screen depended on a drawer effect having
   * completed — through several network calls that can be slow, refused, or (on a
   * release build with no store key) skipped entirely. Whatever went wrong in that chain
   * took the packs down with it, silently, and the paywall showed only the tiers.
   *
   * `loadPricing` cannot fail: server, then the device cache, then compiled-in
   * fallbacks — all three carry packs. Calling it at the moment the screen opens makes
   * the section's presence depend on nothing but opening the screen.
   */
  setPricing(await loadPricing(db, connector.client));
  /**
   * AND THE COMPANY, for the same reason. `purchaseUrl` needs `company.id` — RevenueCat
   * REQUIRES the App User ID on a web purchase link or the customer sees a 404, and it is
   * what makes the money land on the account this app reads. `co` was also set only by
   * that drawer effect, so the failure mode was prices with no button: the exact
   * half-configured state `purchaseUrl` returns null for on purpose.
   *
   * Only when it is missing. The resolver hits the network, and re-running it on every
   * open of this screen would add a round-trip to a screen that already has its answer.
   */
  if (!co) {
    try {
      const mine = await resolveMyCompany(db, connector.client, OWNER);
      if (mine) setCo({ id: mine.id, name: mine.name });
    } catch { /* no company resolved -> no web button, prices still stand */ }
  }
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
    const data = resp?.notification?.request?.content?.data;
    const coId = data?.changeOrderId;
    if (!coId) return;
    /**
     * A MESSAGE NOTIFICATION LANDS ON THE MESSAGE (hadar, 2026-08-25: "when i click on
     * a notification that is a new message, not only it should take me to the CO but it
     * should open the message tab").
     *
     * Every push already carries `kind`, and 414's own comment says "`kind` is what the
     * tap handler routes on" — but this handler only ever read `changeOrderId`, so all
     * four kinds landed identically on the record and the client's question, which is
     * the entire reason the phone buzzed, was another tap away behind a sheet.
     *
     * Only 'question' is a message. 'opened', 'reminder_failed' and 'review_request'
     * are ABOUT the record and belong on it, so they are deliberately unchanged.
     *
     * A counter, not a flag: two questions in a row must open the sheet twice, and a
     * boolean that is already true the second time would do nothing.
     */
    if (opensConversation(data?.kind)) setOpenMessagesNonce((n) => n + 1);
    void openRecord(String(coId));
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
  Promise<{ ok: boolean; why?: string; sent?: number; of?: number }> => {
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

  /**
   * A REMINDER IS A RESEND TO THE SAME PEOPLE (hadar, 2026-08-14: "a reminder is the
   * act of resending the same CO to the same people again, and send an SMS like the
   * first time to the clients and other people with a message and a link").
   *
   * It used to open the phone's share sheet and hand him a blank envelope — on a
   * screen that had already named the right recipient two inches above the button
   * ("Waiting on Hadar"). The app knew who and asked him anyway, which is three
   * chances to nudge the wrong person.
   *
   * SAME LINK, NEVER A NEW TOKEN. `liveLinkFor` above, and nothing here mints
   * anything — remind.ts's header owns why: a new token retires the link already
   * sitting in the client's messages, so the nudge would break the thing it is
   * nudging about.
   *
   * The share sheet SURVIVES as the fallback, for the two cases where automatic text
   * cannot happen: no number on file, or Twilio not configured/refusing. Mandate #7 —
   * the link must be able to reach the client with nothing configured.
   */
  const targets = await remindTargets(db, c.id);
  const withPhone = reachable(targets);
  let sent = 0;
  for (const t of withPhone) {
    const r = await sendSms(connector.client, t.phone as string, text);
    if (r.ok) sent += 1;
    else console.log('[remind] SMS to %s failed: %s', t.name, r.reason);
  }

  /**
   * WHY THE SHARE SHEET APPEARED, IN WORDS (hadar, 2026-08-15: "when I click resend it
   * still opens the share bottom popup for me to select contact members").
   *
   * It was doing exactly what it was built to do — and saying nothing, so it read as
   * the feature not working. Three different things land here and they have three
   * different fixes, only one of which is his:
   *   · nobody recorded  — this extra has no approver row to text.
   *   · no number        — we know who, not how. He can add it.
   *   · texting is off   — `send-sms` is not deployed and Twilio is not configured
   *                        (verified against the project 2026-08-15: neither exists).
   *                        Nothing he can do on the phone, and telling him to "check
   *                        the number" would send him hunting for a fault that is ours.
   * The sheet still opens, because mandate #7 says the link must be able to reach the
   * client with nothing configured. It just no longer arrives unexplained.
   */
  const fellBackWhy = targets.length === 0 ? 'r8.noRecipient'
    : withPhone.length === 0 ? 'r8.noNumber'
    : 'r8.smsOff';

  if (sent === 0) {
    const sh = await shareLink(link.url, text);
    // Counted only AFTER the sheet returns. A contractor who opens it and backs out
    // has not reminded anyone, and burning his one-a-day on a cancelled share would
    // be the app lying about what it did.
    if (!sh.ok) return { ok: false, why: sh.reason ?? T('r8.notDelivered') };
  }

  await noteReminded(db, c.id);
  await refresh();
  // The COUNT is reported, not assumed. "Reminded Sarah" and "reminded 0 of 2" must
  // not read the same on a screen where the difference is whether anyone was told.
  return { ok: true, sent, of: targets.length,
           why: sent === 0 ? T(fellBackWhy as any) : undefined };
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
    if (text) {
      await appendAugmentDesc(db, changeOrderId, text);
      await clearAugmentPending(db, changeOrderId).catch(() => { /* best effort */ });
    } else {
      /**
       * NOTHING TO APPEND *YET* IS NOT NOTHING TO APPEND (Codex, 2026-08-23, P1).
       *
       * This read the proposal once, fell back to the cache once, and if both were empty
       * it silently gave up forever — so an edit finished on the device's silence verdict
       * could land the contractor on a record missing the words the SERVER went on to
       * transcribe a minute later. The evidence was always safe; the write-up was not.
       *
       * Marked, and retried on the sync tick for a bounded day. See augmentretry.ts.
       */
      await markAugmentPending(db, changeOrderId, addedIds).catch(() => { /* best effort */ });
    }
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
  /**
   * DURABILITY FIRST, EVEN THOUGH THE SHEET IS ALREADY UP (hadar, 2026-08-23).
   *
   * The job picker now draws before the commit has finished, so a fast tap can arrive
   * while bytes are still being hashed and written. Awaiting `ready` is what keeps
   * mandate #1's order intact: nothing is filed, and therefore nothing is uploaded,
   * until the captures it names actually exist. The wait is invisible on a normal tap
   * because he takes a second or two to read the list.
   *
   * `ids` is still honoured directly for the other caller — the processing screen's
   * parked-capture path files captures that committed long ago.
   */
  const done = a.ready ? await a.ready : null;
  const ids = done?.ids ?? a.ids ?? [];
  if (!ids.length) return;
  for (const id of ids) {
    await fileCapture(db, { captureId: id, projectId: projId, by: OWNER });
  }
  /**
   * RAISE THE CORRIDOR BEFORE TEARING DOWN THE ROOM. Between this line and
   * `setClientPick` below there is `rehomeDraftExtra`, a full `refresh()`, and two
   * roster queries — seconds on a real database, all of it with `assign` already null
   * and `clientPick` not yet set. That whole time the app rendered HOME.
   */
  /**
   * THE LOCATION SCREEN STAYS UP UNTIL THE CLIENT SCREEN IS READY (hadar, 2026-09-03:
   * "between location and client selection i can see the home screen").
   *
   * Tearing `assign` down here and setting `clientPick` sixty lines later left a window
   * containing `rehomeDraftExtra`, a full `refresh()` and two roster queries — seconds
   * on a real database — in which NO flow screen matched and the app rendered Home.
   *
   * The corridor (`flowHold`) covers it, but covering it is second best. This is the
   * same fix `onFusedCapture` already uses one step earlier — "DO NOT close the capture
   * screen here... the job sheet is checked BEFORE showCapture in the render, so it
   * takes over the instant it is set" (2026-07-25). `clientPick` is likewise checked
   * before `assign`, so the handover is a single frame with nothing in between and no
   * placeholder at all.
   *
   * `a` was captured as an argument, so nothing below reads this state; holding it is
   * purely what keeps the screen on the glass.
   */
  setFlowHold(3);
  setAssignQ(''); setFiled(null);
  setHereAddr(undefined); hereAddrKey.current = null;
  setProjectId(projId);
  const anchorCoId = done?.anchorCoId ?? a.anchorCoId;
  const anchorCapId = done?.anchorCaptureId ?? a.anchorCaptureId ?? null;
  if (anchorCoId) await rehomeDraftExtra(db, anchorCoId, projId);
  await refresh();
  const startProcessing = () => {
    if (!anchorCoId) return;
    setTransition({
      ids, anchorCaptureId: anchorCapId, coId: anchorCoId,
      uploaded: false, transcribed: anchorCapId === null, analyzed: false, offline: false,
      stalled: false, uploadDone: 0, uploadTotal: ids.length, lastError: null,
        photoDone: 0, photoTotal: 0, voiceDone: 0, voiceTotal: 0,
      blocked: false, isAugment: false,
    });
  };
  /**
   * WHO IS THIS FOR — hadar's step 6 (2026-08-23), and it did not exist.
   *
   * The client was only ever asked for at SEND time. On an account with no roster that
   * is the worst moment to find out: the scope is written, the price is set, Send is
   * tapped, and only then is there nobody to send to. The live database has the phone
   * account owning this job with ZERO approvers while all 30 roster rows sit under the
   * other account, so the dead end is real and it is today's.
   *
   * BETWEEN THE JOB AND THE PROCESSING SCREEN, which is where his sequence puts it, and
   * the processing screen only starts once this is answered or skipped — one modal at a
   * time. Skipping is free: the send sheet still asks. This is an early chance, never a
   * new gate (mandate #3 — he is on a ladder).
   */
  if (anchorCoId) {
    try {
      const roster = await listRoster(db, projId);
      /**
       * AND EVERYONE ELSE THE ACCOUNT KNOWS (hadar, 2026-09-02: "make sure we display
       * potential clients that are related to the location").
       *
       * `listRoster` is scoped to this project, which is correct and was also the whole
       * problem: a location created on step 2 ninety seconds ago has nobody on it, so
       * step 3's honest answer was an empty list — while the homeowner from last month's
       * job sat in the same table, one row away. `listKnownPeople` has existed since
       * 2026-08-05 for exactly this and nothing on this path had ever called it.
       *
       * Failing to read it must never cost him the roster he DOES have, so it degrades
       * to an empty list rather than joining the outer catch.
       */
      const known = (await listKnownPeople(db, projId).catch(() => []))
        /**
         * THE PLACEHOLDER ROWS ARE NOT PEOPLE, AND THIS SCREEN MUST NOT OFFER THEM.
         *
         * The live database holds `project_approver` rows literally named "Owner" — an
         * older client sheet prefilled the `who_directed` seed into an editable name
         * field and saved it (approvers.ts:298 documents how they got there). They are
         * exactly the kind of row `listKnownPeople` happily returns: active, named,
         * recently used.
         *
         * `saveClientApprover` REFUSES them at the writer, so tapping one would spend a
         * tap and return a loud error he can do nothing about. Filtering here means the
         * screen never shows a card that cannot work. `isNamedClient` is the same single
         * definition the writer uses, so the two cannot drift apart.
         */
        .filter((r) => isNamedClient(r.name));
      // The handover: step 3 goes up and step 2 comes down in the same commit.
      setAssign(null);
      setClientPick({ coId: anchorCoId, projectId: projId,
                      // `role` rides along now: step 3 prints it under the name
                      // ("Property owner", "General contractor / You"). It was being
                      // dropped here, so the screen had a name and nothing else to say.
                      roster: roster.map((r) => ({ id: r.id, name: r.name, role: r.role })),
                      known: known.map((r) => ({ id: r.id, name: r.name, role: r.role,
                                                 phone: r.phone })),
                      onDone: startProcessing, busy: false });
      return;
    } catch { /* no roster readable — never let this stand between him and the upload */ }
  }
  // No client step on this path — step 4 takes over instead, same single commit.
  setAssign(null);
  startProcessing();
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

// DEV ONLY — open the send sheet for a change order id, without the four taps that
// normally lead here.
if (__DEV__) {
  // Mirrors the REAL entry, including `setReturnRecordId` + leaving the record — a hook
  // that skipped those could not have caught the bug it is here to check.
  (globalThis as any).__sendPrep = (coId: string) => {
    void (async () => {
      const rows = await db.getAll<LedgerRow>(
        `SELECT * FROM change_order WHERE id = ?`, [coId]);
      if (!rows[0]) return;
      setReturnRecordId(coId);
      setNav('project');
      closeRecord();
      await openSendPrep(rows[0]);
    })();
  };
  (globalThis as any).__closeSend = () => closeSendPrep();
  (globalThis as any).__invite = () => { void inviteFromSend(); };
  // Calls the SAME helper both taps call — a hook that re-implemented the write would
  // prove nothing about the write.
  (globalThis as any).__pickClient =
    (id: string, name: string) => { void chooseClient({ id, name }); };
}
/**
 * WITHDRAW A SENT EXTRA, and tell everyone who was asked to approve it.
 *
 * hadar, 2026-08-24: "i need to be able to cancel a none approved but sent co -- when
 * that is done by the contractor -- send a note to all of the recepients". This amends
 * SPEC-extra-lifecycle-v1 REQ-LC20, which had named "cancel" as a Stage 2 move that does
 * not exist; the amendment and its reasoning are in that file and in 421.
 *
 * THE SERVER DECIDES, NOT THIS FUNCTION. `cancel_change_order_v1` re-checks ownership,
 * refuses anything that is not `sent`, and refuses outright if a confirmed response
 * exists — so a client who tapped Approve a second earlier WINS, and he is told they
 * already approved it rather than the two racing. The status move and the killing of
 * every live link happen in that one transaction, so an approval in flight cannot land
 * after the withdrawal.
 *
 * THE NOTES GO OUT FROM HERE, deliberately. An RPC that both mutated and sent would own
 * a delivery failure it cannot retry; this way the withdrawal is committed the moment
 * the RPC returns, and a text that fails to send is a message problem, not a lost act.
 * Every recipient is told, including one who was reminded on a second channel — the RPC
 * deduplicates by destination.
 */
const withdrawExtra = async (changeOrderId: string, reason: string | null) => {
  try {
    const { data, error } = await connector.client.rpc('cancel_change_order_v1', {
      p_change_order_id: changeOrderId, p_reason: reason,
    });
    if (error) {
      const hint = (error as any)?.hint ?? '';
      setAck({ kind: 'no',
        title: T('cancel.failedH'),
        detail: hint === 'already_approved' ? T('cancel.alreadyApproved')
              : hint === 'not_sent' ? T('cancel.notSent')
              : error.message });
      return;
    }
    // The local row follows the server's word. `canTransition` is not consulted: this
    // is LEARNING a move the server just made, which is `adoptServerStatus`'s
    // distinction and not this path's to re-litigate.
    await db.execute(
      `UPDATE change_order SET status = 'cancelled' WHERE id = ?`, [changeOrderId]);

    const co = (await db.getAll<{ scope: string; project_id: string }>(
      `SELECT scope, project_id FROM change_order WHERE id = ?`, [changeOrderId]))[0];
    const proj = co ? (await db.getAll<{ name: string }>(
      `SELECT name FROM project WHERE id = ?`, [co.project_id]))[0] : undefined;
    const prof = await getProfile(db);

    const recipients: Array<{ channel: string; destination: string }> =
      ((data as any)?.recipients ?? []).filter((r: any) => r?.destination);
    const body = cancelledSmsBody({
      companyName: prof?.company ?? null,
      jobLabel: proj?.name ?? null,
      reason,
    });
    let told = 0, failed = 0;
    for (const r of recipients) {
      if (r.channel !== 'sms') continue;
      const sent = await sendSms(connector.client, r.destination, body);
      if (sent.ok) told++; else failed++;
    }
    await refresh();
    /**
     * WHAT ACTUALLY HAPPENED, including the half that did not. A withdrawal whose notes
     * failed to send is the dangerous state — the contractor believes the client knows
     * and the client is still looking at a live-looking text — so the count of failures
     * is stated rather than swallowed.
     */
    setAck({ kind: 'ok', title: T('cancel.doneH'),
      detail: failed > 0
        ? T({ k: 'cancel.doneSomeFailed', p: { n: String(told), f: String(failed) } } as any)
        : T({ k: 'cancel.doneTold', p: { n: String(told) } } as any) });
  } catch (e: any) {
    setAck({ kind: 'no', title: T('cancel.failedH'), detail: e?.message ?? String(e) });
  }
};

/**
 * Invite a teammate from the send sheet.
 *
 * The SAME act as the Settings row — `createInvite`, the free-tier member cap, the
 * share sheet — not a second implementation of it. The cap is checked BEFORE the RPC
 * because an invite minted past the limit is a link that fails when the person taps
 * it, which is a worse way to learn about a plan than being told now.
 */
const inviteFromSend = async () => {
  try {
    /**
     * THE TENANT ID, NOT THE SYNCED ROW (hadar 2026-08-14: "invite someone doesn't
     * work").
     *
     * It called `myCompany`, which reads the local `company` table — and on this device
     * that table is EMPTY, because the deployed PowerSync rules do not include it. So
     * every tap took the "set up your company first" branch on an account that has had a
     * company since July. Same gap that hid the paid plan and blocked the team list; the
     * same workaround applies — `billingTenantId` returns the id the SERVER handed us,
     * remembered in device_settings, and `create_company_invite` re-checks ownership
     * server-side anyway, so nothing is trusted that should not be.
     */
    const co = await myCompany(db, OWNER);
    const companyId = co?.id ?? (await billingTenantId(db, OWNER));
    if (!companyId) {
      setAck({ kind: 'no', title: T('r5c.inviteFailedH'), detail: T('r5c.inviteNoCompany') });
      return;
    }
    const q = await checkMembers(db, companyId);
    if (!q.ok) { setQuota({ kind: 'members', limit: q.limit }); return; }
    const r = await createInvite(connector.client, companyId, 'crew');
    if (!r.ok) {
      // ROUTED TO `ack`, NOT `filed`. `filed` is write-only — nothing in this file
      // renders it — so the previous version of this failed in total silence, which is
      // exactly what "doesn't work" looks like from the outside.
      setAck({ kind: 'no', title: T('r5c.inviteFailedH'), detail: r.reason });
      return;
    }
    /**
     * THE CODE, ALWAYS. The link branch that used to sit here pointed at an unhosted
     * /join page and always won — see createInvite's header in company.ts.
     *
     * THE NAME COMES FROM THE SERVER FIRST. `co` is null on exactly the device this
     * whole branch exists for — the one whose `company` table never synced, which is
     * why `companyId` is read from `billingTenantId` above — so `co?.name ?? ''` sent
     * "Join  on EZChangeOrders" to the one teammate it was supposed to convince.
     * `create_company_invite` already returns the name; use it.
     */
    const msg = T({ k: 'set.inviteMsgCode',
      p: { company: r.companyName || co?.name || '', code: r.token } } as any);
    try { await Share.share({ message: msg }); } catch { /* dismissed */ }
  } catch (e: any) {
    setAck({ kind: 'no', title: T('r5c.inviteFailedH'), detail: String(e?.message ?? e) });
  }
};

/**
 * CLOSING THE SEND SHEET GOES BACK TO THE EXTRA, not to the job (hadar 2026-08-14:
 * "when I close the popup it should get me back to the change order").
 *
 * Opening this sheet from a record CLOSES the record first — the sheet is mounted in
 * the job screen's tree, so getting to it means navigating there. Invisible while the
 * sheet covers the screen, and then dismissing it revealed a job screen the person
 * never asked for. `returnRecordId` already existed for this and was only honoured
 * AFTER a successful send; backing out is the commoner path.
 */
/**
 * CHOOSING THE CLIENT WRITES IT TO THE EXTRA (hadar 2026-08-14).
 *
 * Both places that pick one go through here, so the sheet's state and the record can
 * never disagree. The local state is set FIRST and unconditionally: the tap must feel
 * instant and must survive with no signal (mandate #7), and `setDraftClient` is a local
 * SQLite write whose own outbox carries it up later.
 *
 * A refusal is SHOWN. The one that can really happen is "not a draft anymore" — the
 * extra was sent from another device while this sheet was open — and silently keeping a
 * selection the record rejected is how the app and the document drift apart.
 */
const chooseClient = async (m: { id: string; name: string }) => {
  setSendPrep((p) => p && { ...p, chosenId: m.id, picking: false });
  const coId = sendPrep?.co.id;
  if (!coId) return;
  const r = await setDraftClient(db, coId, m.name);
  if (!r.ok) {
    setAck({ kind: 'no', title: T('r5c.clientNotSaved'), detail: r.reason });
  } else {
    await refresh();
  }
};

const closeSendPrep = () => {
  setSendPrep(null);
  const rid = returnRecordId;
  if (rid) { setReturnRecordId(null); void openRecord(rid); }
};

const openSendPrep = async (c: LedgerRow) => {
  const t = (c.extra_type ?? null) as ExtraType | null;
  const { suggestion, roster } = await suggestFor(db, projectId, t);
  // The group is read here, not at render: an empty list and a list that has not
  // loaded yet look identical on screen, and "nobody to ask" is a fact worth being
  // sure of before it is stated.
  let members: Member[] = [];
  try {
    const co = await myCompany(db, OWNER);
    if (co?.id) members = (await listMembers(db, co.id, OWNER)).filter((m) => !m.isMe);
  } catch { /* no company row on this device — the section simply says so */ }
  /**
   * A CLIENT ALREADY ON THE RECORD IS A CHOICE, NOT A GUESS (hadar 2026-08-14: "I have
   * a draft CO and there is a client assigned, but when I click send it says choose
   * client").
   *
   * A gap I opened. Stopping the ROUTER'S SUGGESTION from auto-selecting was right —
   * an inference must not arrive pre-confirmed. But `chosenId` was then hardcoded to
   * null, which threw away the one thing that genuinely IS a selection: the client
   * saved on this extra, which somebody picked and `setDraftClient` wrote to
   * `who_directed`. So the sheet asked again for an answer it already had.
   *
   * The two are told apart by their SOURCE, not by how they look: `who_directed` is a
   * decision on the record; `suggestion` is the router reading the job. Only the first
   * seeds the sheet.
   *
   * Matched on the normalised name because `who_directed` stores a NAME, not a roster
   * id — same key rule as `saveClientApprover`, so "Sarah  Miller" and "sarah miller"
   * are the same person and a saved client is not lost to a stray space.
   */
  const key = (v: string) => v.trim().toLowerCase().replace(/\s+/g, ' ');
  const saved = isNamedClient(c.who_directed)
    ? roster.find((r) => key(r.name) === key(c.who_directed)) ?? null
    : null;

  setSendPrep({ co: c, type: t, suggestion, roster, members, memberIds: [],
                chosenId: saved?.id ?? null, picking: false, adding: null, busy: false });
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

/**
 * The contractor states he has this person's permission to text them (A2P 10DLC).
 *
 * Write-once in the store, and the roster is RE-READ rather than patched in memory, so the
 * tick and the send gate are looking at the same row — local optimism here would let a
 * failed write look like consent, on the one record a carrier regulator may ask about.
 */
const grantSmsConsent = async (approverId: string) => {
  try {
    await noteSmsConsent(db, approverId);
    /**
     * THE SHEET'S OWN PROJECT, not the screen's.
     *
     * This read `recordLc?.co.project_id ?? projectId`, but the roster it is replacing
     * was built from `sendPrep.co.project_id` (see where the sheet is prepared). Open
     * the sheet from a surface where `recordLc` is null — a Home or Activity card —
     * while `projectId` points at a different job, and the fallback reloads THE WRONG
     * PROJECT'S roster. `chosen` is found by id inside that list, so it becomes null,
     * the recipient disappears from a sheet the user is mid-send on, and the button
     * drops to "nothing to send" moments after they granted consent (review,
     * 2026-08-21).
     *
     * Reading it off `sendPrep` means the list can only ever be replaced by another
     * list of the same job's people.
     */
    const pid = sendPrepRef.current?.co.project_id ?? recordLc?.co.project_id ?? projectId;
    if (pid) {
      const roster = await listRoster(db, pid);
      setSendPrep((p) => (p ? { ...p, roster } : p));
    }
  } catch (e: any) {
    setFiled(String(e?.message ?? e));
  }
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
    // 'client' MOVED who the document is addressed to; 'contact' only added somebody to
    // the job's roster. Two different acts, so two different confirmations — telling a
    // contractor "client updated" after he added an inspector would be a false report of
    // whose signature this extra now waits on.
    setAck({
      kind: 'ok',
      title: T(mode === 'client' ? 'ack.client' : 'ack.contact'),
      detail: v.name.trim() || null,
    });
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

/**
 * HAND THE LINK OVER. One tap sends; the screen after it is a receipt, not a step.
 *
 * hadar, 2026-08-14: "when I click to send it waits, thinks for 5 seconds and then
 * brings this page up — no need for it, it should just send. The next step is a popup
 * with a confirmation of sent or failed."
 *
 * WHY THE INTERSTITIAL WAS WRONG, not merely slow. It asked the contractor to confirm
 * an act he had already confirmed: he chose the client in the send sheet and tapped
 * Send on a screen that told him it was going out for signature. That IS the mandate
 * #2 confirmation — a human looked at the price and the recipient before anything
 * committed. A second "one more step" bought no additional consent; what it bought
 * was a state nobody wants, where the instrument exists, the row has left draft, and
 * the client has heard nothing — which the old screen then had to explain with a
 * "Not sent yet" chip under the word "Sent".
 *
 * TWO ROUTES, IN THIS ORDER, because the link must be able to reach the client with
 * nothing configured (mandate #7):
 *   1. Automatic SMS, when we hold a number. Arrives from the contractor's own
 *      Twilio number without him leaving the app.
 *   2. The phone's own share sheet — always available, works when Twilio is not
 *      deployed or not configured, and is the ONLY route when we have no number.
 * A failed SMS falls through to (2) rather than stopping: the messaging service being
 * down must not be the reason a client never sees a change order.
 */
const deliverLink = async (a: {
  url: string; shown: string; phone?: string | null;
  /** Facts for the SMS body. Each is used ONLY if it appears verbatim in `shown`
   *  (REQ-LC40) — `clientSmsBody` does that checking, not this caller. */
  sms?: { kind: ClientSmsKind; companyName?: string | null; jobLabel?: string | null;
          amountText?: string | null };
}): Promise<{ ok: true } | { ok: false; why: string }> => {
  /**
   * THE TEXT SAYS WHO, WHAT AND HOW MUCH — IT DOES NOT CARRY THE DOCUMENT.
   *
   * This used to send `${shown}\n\n${url}`: the ENTIRE frozen instrument as the
   * message body. `clientsms.ts` was written to replace that and then never wired to
   * anything — it had no non-test call site until now.
   *
   * Two costs, and the money is the smaller one. The 391 layout opens with an em dash,
   * which is not in GSM-7, so the whole message encodes as UCS-2 at 67 chars per
   * segment — SEVEN chargeable segments, asserted in `clientsms.test.ts`, growing with
   * the scope and the NTE clause. And what arrives is a wall of contract text with the
   * only actionable thing in it, the link, below the fold. The person this product is
   * built for reads the first line, does not scroll, and never opens the approval —
   * while the contractor believes he is being ignored.
   *
   * The document lives at the link, where it is rendered, where the photos and the
   * discussion are, and where the signature is collected.
   *
   * FALLS BACK TO THE OLD BODY only when the caller supplies no facts, so no send path
   * can lose its message by omitting an argument.
   */
  const body = a.sms
    ? clientSmsBody({ kind: a.sms.kind, shownContent: a.shown, url: a.url,
                      companyName: a.sms.companyName, jobLabel: a.sms.jobLabel,
                      amountText: a.sms.amountText })
    : `${a.shown}\n\n${a.url}`;
  if (a.phone) {
    const r = await sendSms(connector.client, a.phone, body);
    if (r.ok) return { ok: true };
    // Logged, not shown. Twilio being unconfigured is a fact about the deployment,
    // not about this send — and it is not what stopped the link going out, because
    // the share sheet below is still open in front of him.
    console.log('[send] automatic SMS unavailable: %s', r.reason);
  }
  const s = await shareLink(a.url, a.shown);
  if (s.ok) return { ok: true };
  // `shareLink` returns a reason only when it BROKE. No reason means the share sheet
  // came up and was dismissed — the contractor chose not to send, which is not an
  // error and must not be reported to him as one.
  return { ok: false, why: s.reason ?? T('sent.failNotHanded') };
};

/**
 * THE ONE SEND. Every path that puts a priced commitment in front of a client comes
 * through here — the guided first-run flow, the send-preview sheet, and the drain of
 * anything that was waiting on a credit.
 *
 * ─── WHY THE CREDIT GATE IS AT THE TOP AND NOT AT EACH CALLER ───────────────────
 * It is the choke point, and money gates belong at choke points. A gate copied into two
 * callers is a gate one of them will drift out of, and the drift would not look like a
 * bug — it would look like a contractor sending for free.
 *
 * It sits ABOVE the EWA branch on purpose. An EWA is a signed commitment on a change
 * order row, sql/412 consumes a credit when it is signed, and letting it past the gate
 * would mean the server spending a credit the client never reserved.
 *
 * ─── IT RETURNS WHETHER IT SENT ─────────────────────────────────────────────────
 * It used to return nothing, and the guided flow read "did not throw" as "sent". With a
 * third outcome that is neither success nor error — HELD — that reading becomes a lie:
 * the walkthrough would show its "on its way" screen over a change order still sitting on
 * the phone. So the outcome is a value, and every caller has to look at it.
 */
const sendPricedApproval = async (
  c: LedgerRow, to: RosterMember | null,
): Promise<{ sent: boolean; held?: boolean }> => {
  /**
   * HOLD A CREDIT FIRST — before anything is minted, sent or marked.
   *
   * The order matters in one direction only. Reserving after the send would mean a
   * contractor at zero could send an unlimited number and the server would discover it
   * afterwards; reserving before means the worst case is a reservation held against a
   * send that then failed, and `releaseCredit` below gives it straight back.
   *
   * `reserveCredit` NEVER reports a network failure as a refusal (see credits.ts): an
   * unreachable server yields `reserved: false, reason: 'unreachable'`, and this treats
   * that as sendable. A basement is not a billing decision, and the server settles it on
   * its own terms when the confirmation is minted.
   */
  const res = await reserveCredit(connector.client, c.id);
  if (res.ok && !res.reserved && res.reason === 'no_credits') {
    // HELD, AND SAID OUT LOUD. Not an error, not a refusal — mandate #1's rule about
    // never acknowledging what has not happened, applied to sending. The recipient he
    // just confirmed is stored WITH the hold so the retry reaches the same person.
    await holdSend(db, {
      changeOrderId: c.id,
      approverId: to?.id ?? null, approverName: to?.name ?? null,
      approverPhone: to?.phone ?? null,
    });
    setSendPrep(null);
    setHeldN((await heldSends(db)).length);
    setNoCredits({ changeOrderId: c.id });
    return { sent: false, held: true };
  }
  // A reservation that FAILED (not refused — failed) is a server problem, and it must not
  // become a silent free send. It is reported the way every other refusal on this path
  // is, with the reason.
  if (!res.ok) { setUi({ k: 'refused', why: res.reason }); return { sent: false }; }

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
    if (!re.ok) {
      // THE CREDIT GOES BACK. Nothing was minted, so nothing will ever be signed against
      // this reservation, and leaving it OPEN would charge him for an authorization that
      // does not exist. Idempotent, and a failed release is not worth failing the report
      // of the failure he is already being shown.
      if (res.reserved) void releaseCredit(connector.client, c.id);
      setUi({ k: 'refused', why: T(re.reason as any) });
      return { sent: false };
    }
    await markLocalSent(db, c.id);
    if (to) await markApproverUsed(db, to.id);
    // THE SHEET STAYS UP UNTIL THE HAND-OFF IS DONE. Two reasons, and the second is
    // the one that bites: it keeps "Sending…" on screen instead of dropping the
    // contractor onto the record for the seconds this takes; and closing it first
    // means asking iOS to present the share sheet while a modal dismissal is still
    // animating, which it can simply refuse.
    const d0 = await deliverLink({
      url: re.url, shown: re.shownContent, phone: to?.phone ?? null,
      // An EWA is a T&M authorization and carries NO price — `renderEwaCard` states the
      // rate and cap inside the instrument, and `clientSmsBody` refuses the
      // "nothing proceeds until you approve" closing here because on a capped
      // authorization work proceeds precisely BECAUSE it was approved.
      sms: { kind: 'ewa', companyName: prof0?.company || prof0?.name || null,
             jobLabel: projects.find((p) => p.id === projectId)?.name ?? null },
    });
    setSendPrep(null);
    // The chirp fires on DELIVERY, not on minting. It is the felt confirmation that
    // the commitment went out (gap #7); playing it over a failed hand-off would make
    // the one non-visual signal this app gives say the opposite of the screen.
    if (d0.ok) void signalSaved();
    setSentLink({ url: re.url, shown: re.shownContent,
      // No amount for an EWA: it is stored with amount_cents = 0, so `c.amount` is
      // "$0.00" — and the EWA contract states NO price. Showing $0.00 misrepresents
      // it (Codex P2). Its terms (rate/cap) live in the frozen instrument itself.
      scope: c.scope, amount: undefined,
      jobName: projects.find((p) => p.id === projectId)?.name ?? 'this job',
      sentTo: to?.name ?? c.who_directed ?? null, atMs: Date.now(), phone: to?.phone ?? null,
      shared: d0.ok, failWhy: d0.ok ? null : d0.why,
      sms: { kind: 'ewa', companyName: prof0?.company || prof0?.name || null,
             jobLabel: projects.find((p) => p.id === projectId)?.name ?? null } });
    // It went, so it is no longer waiting. Clearing here and not at the caller keeps the
    // queue honest on EVERY path: an EWA sent from the drain, from the sheet or from the
    // walkthrough all leave the same way.
    await clearHold(db, c.id);
    setHeldN((await heldSends(db)).length);
    await refresh();
    return { sent: true };
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
    // THE BREAKDOWN TRAVELS WITH THE PRICE, for the same reason the cap does: the
    // client's page renders the parts only if they are frozen into the instrument
    // here, and a page that shows one figure with nothing behind it makes a total
    // assembled from three quoted pieces look like a number somebody typed
    // (hadar 2026-08-24). Empty on the extras priced as one figure, which is most.
    // ALL OF IT OR NONE OF IT. `intactLineItems` withholds a breakdown that lost a
    // row or that does not add up to the figure being signed — freezing a partial one
    // beside the real total puts two numbers in front of a client that contradict each
    // other, permanently (Codex, 2026-08-24).
    lineItems: intactLineItems(c.line_items, c.amount_cents),
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
    // Closed AFTER the hand-off, not before — see the EWA path above for why.
    const d = await deliverLink({
      url: r.url, shown: r.shownContent, phone: to?.phone ?? null,
      // `c.amount` is already formatted by `money()` — the one formatter in this app.
      // `clientSmsBody` drops any of these that is not verbatim in the frozen text, so
      // an SMS can never name a figure the signed document does not contain (REQ-LC40).
      sms: { kind: 'confirm', companyName: prof?.company || prof?.name || null,
             jobLabel: projects.find((p) => p.id === projectId)?.name ?? null,
             amountText: c.amount },
    });
    setSendPrep(null);
    if (d.ok) void signalSaved();  // felt confirmation the commitment WENT OUT (gap #7)
    setSentLink({ url: r.url, shown: r.shownContent,
      scope: c.scope, amount: c.amount,
      jobName: projects.find((p) => p.id === projectId)?.name ?? 'this job',
      sentTo: to?.name ?? c.who_directed ?? null, atMs: sentAtMs, phone: to?.phone ?? null,
      shared: d.ok, failWhy: d.ok ? null : d.why,
      sms: { kind: 'confirm', companyName: prof?.company || prof?.name || null,
             jobLabel: projects.find((p) => p.id === projectId)?.name ?? null,
             amountText: c.amount } });
    await clearHold(db, c.id);
    setHeldN((await heldSends(db)).length);
    await refresh();
    return { sent: true };
  }
  // The instrument was never minted. Same reasoning as the EWA branch above: hand the
  // credit back rather than hold it against a send that did not happen.
  if (res.reserved) void releaseCredit(connector.client, c.id);
  setUi({ k: 'refused', why: r.reason });
  return { sent: false };
};

/**
 * SEND WHAT HAS BEEN WAITING ON A CREDIT.
 *
 * This is the half of hadar's instruction that the prompt alone does not satisfy. The app
 * tells him "add more and it goes out on its own — you don't have to come back", and a
 * promise made on screen is a promise the code owes. This is the code.
 *
 * ─── WHEN IT RUNS ───────────────────────────────────────────────────────────────
 * When the app comes to the foreground, which is also the moment he returns from paying
 * on the web — the flow the sentence was written for. It does NOT run in the background
 * and nothing here wakes the phone; the honest boundary is that a contractor who buys
 * credits on a laptop and never opens the app has nothing sent on his behalf.
 *
 * ─── WHY ONLY THE OPEN JOB'S HOLDS ──────────────────────────────────────────────
 * `sendPricedApproval` builds the instrument from the OPEN project — its name goes into
 * the frozen text a client signs, and `sendForConfirmation` files it under that project
 * id. Draining a hold belonging to another job would therefore mint a change order
 * addressed to the wrong jobsite, which is worse than a delayed send by a wide margin.
 * `coRowsRef` holds exactly the open project's rows, so "is this row loaded" IS the test
 * for "can this be sent correctly right now". Holds for other jobs keep waiting and go
 * when he opens that job.
 *
 * ─── IT ASKS THE SERVER FIRST ───────────────────────────────────────────────────
 * `holdsToDrain` decides how many attempts fire from the balance, so a queue of six does
 * not become six sends the instant one bar of signal appears. Each send re-reserves
 * anyway — the balance read is a throttle, never the authority.
 */
const drainHolds = async () => {
  // A PLAIN FLAG, not a ref, and deliberately outside the component: the drain fires from
  // a foreground listener and from a purchase return, and those can land together. It is
  // not a hook because this function sits above the block where the hooks are declared,
  // and a `useRef` here would put a hook call in a place where a later early return could
  // change the hook order — the exact bug that took down every screen on 2026-08-16.
  if (draining) return;
  draining = true;
  try {
    const holds = await heldSends(db);
    setHeldN(holds.length);
    if (!holds.length) return;

    // `refreshBalance`, not `creditBalance`: this runs on the return from paying, which
    // is the exact moment "this account has bought credits" becomes true and the trial's
    // photo and recording caps must retire.
    const bal = await refreshBalance(db, connector.client);
    setCredits(bal);
    // The gate's own vocabulary, so a queued send and a fresh tap cannot disagree about
    // what "may send" means. An unmetered plan drains everything it has.
    const gate = decideSend({
      metered: bal?.metered !== false,
      available: bal?.available ?? 0,
    });
    if (gate.kind !== 'send') return;

    const ready = holdsToDrain(holds, bal?.metered === false ? holds.length : bal?.available ?? null);
    for (const h of ready) {
      const row = coRowsRef.current.find((x) => x.id === h.changeOrderId);
      // Not this job's, or gone. Not a failure and not an attempt — recording one would
      // burn the retry budget of a hold that was never actually tried.
      if (!row) continue;
      // ALREADY PAST DRAFT means the client has it: a hydrate landed, or another device
      // sent it. The hold is discharged rather than re-sent, because sending twice is a
      // second instrument for one decision.
      if (row.status !== 'draft') { await clearHold(db, h.changeOrderId); continue; }
      try {
        // The person he confirmed, not whoever the roster resolves to now. The live row
        // is preferred when it is still there (it carries the role that gets copied onto
        // the record) and the stored copy is the floor.
        const live = h.approverId
          // `projectId`, not a field on the row: a LedgerRow carries no project because
          // `ledger()` only ever returns the OPEN project's rows. That is the same
          // invariant the `!row` skip above relies on.
          ? (await listRoster(db, projectId)).find((m) => m.id === h.approverId) ?? null
          : null;
        const to: RosterMember | null = live ?? (h.approverId && h.approverName ? {
          id: h.approverId, name: h.approverName, role: 'owner' as ApproverRole,
          lastUsedMs: 0, phone: h.approverPhone, email: null, chainSide: null,
          // A HELD send was already gated on consent when it was queued — the checkbox
          // is on the send button, and this row only exists because that button was
          // pressed. Reconstructing it as null would re-block a send he already
          // authorised, on a screen he is not looking at.
          consentAtMs: h.heldAtMs,
        } : null);
        const out = await sendPricedApproval(row, to);
        // `sent: false` with `held: true` means it hit the gate again — the balance moved
        // under us. That is not a failed attempt, it is the queue working.
        if (!out.sent && !out.held) {
          await noteHoldAttempt(db, h.changeOrderId, 'send refused');
        }
      } catch (e: any) {
        await noteHoldAttempt(db, h.changeOrderId, String(e?.message ?? e));
      }
    }
    setHeldN((await heldSends(db)).length);
  } finally {
    draining = false;
  }
};

/**
 * HAS ANYTHING BEEN APPROVED THAT HE HAS NOT SEEN?
 *
 * Cheap enough to run on every tick: one indexed read against local SQLite, and it returns
 * an empty array the overwhelming majority of the time.
 *
 * The haptic fires ONCE PER APPROVAL, keyed on the head of the queue. Re-firing it every
 * 15 seconds while he reads the popup would turn the app's one purely celebratory signal
 * into a nag — the fastest way to make someone dismiss good news without reading it.
 */
const checkCelebrations = async () => {
  const list = await pendingCelebrations(db);
  const head = list[0]?.changeOrderId ?? null;
  if (head && head !== celebratedHead) {
    celebratedHead = head;
    // Felt before it is read. He may be holding the phone at his side, or looking at a
    // wall — this is the channel that reaches him first (feedback.ts's whole premise).
    void signalApproved();
  }
  if (!head) celebratedHead = null;
  setCelebrations(list);
};

/**
 * A CLIENT ASKED SOMETHING WHILE THE APP WAS OPEN.
 *
 * hadar, 2026-08-18: "if the specific CO is not currently open then display a top form
 * notification (that disappears) with the message and a link to the CO."
 *
 * ─── IT READS THE SAME PENDING LIST THE PUSH DOES ───────────────────────────────
 * `pendingNotifications` is the unnotified client messages, and `runNotifications`
 * consumes and stamps them. So this runs FIRST on each tick and takes the same rows: one
 * stamp, two surfaces, both fired at the moment the message lands — which is exactly what
 * the OS does, showing a banner when backgrounded and nothing when not. A second stamp
 * would let the two disagree about what is new.
 *
 * ─── NOT OVER THE THING IT IS ABOUT ─────────────────────────────────────────────
 * Suppressed when that change order is already open. Its thread updates in place, so a
 * banner announcing what he is currently reading is noise — and `recordIdRef` is the
 * authority on what is open, because it survives the renders this runs between.
 *
 * NEWEST ONLY. Three questions arriving at once are three banners fighting for the same
 * strip of screen; the bell and the thread carry the rest, and neither is consumed by
 * this not being shown.
 */
/**
 * PROCESSED, SILENT, AND STILL EMPTY — the one state that never resolves itself.
 *
 * Every other unfinished thing on a draft is waiting on something: bytes upload, a
 * transcript lands, a write-up appears. This one is finished and has produced nothing, so
 * the extra sits looking almost-done until a person speaks or types. `pendingSilentNotices`
 * owns every condition (and refuses to fire while anything is still queued, which is what
 * keeps it honest offline).
 *
 * NEWEST ONLY, one at a time: three sheets stacked is three dismissals, and the rest are
 * still there on the next tick.
 */
const checkSilentExtras = async () => {
  try {
    const list = await pendingSilentNotices(db);
    if (list.length) setSilent((cur) => cur ?? list[0]);
  } catch { /* a popup is the most droppable thing in this app */ }
};

const checkClientMessages = async () => {
  try {
    const pending = await pendingNotifications(db);
    if (!pending.length) return;
    const newest = pending[pending.length - 1];
    if (newest.id === toastedMessageId) return;
    // He is already looking at it.
    if (recordIdRef.current === newest.changeOrderId) return;
    toastedMessageId = newest.id;
    setMsgToast({
      id: newest.id, changeOrderId: newest.changeOrderId,
      scope: newest.scope, body: newest.body,
    });
  } catch { /* a banner is the most droppable thing in this app */ }
};

  /**
   * R5c — the send preview. Tapping "Send for approval" no longer sends; it opens
   * this. That is mandate #2 ("anything carrying a price or a commitment requires a
   * mandatory human confirmation step before it commits or sends"), and it is also
   * the only place the routing suggestion can be shown before it is acted on. A
   * pre-filled recipient nobody read is an inference carrying a price.
   */
  /** The send sheet's own row, for handlers that must not fall back to whatever
   *  project the SCREEN is showing — see `grantSmsConsent`. Assigned every render. */
  const sendPrepRef = React.useRef<any>(null);
  const [sendPrep, setSendPrep] = React.useState<{
    co: LedgerRow;
    type: ExtraType | null;
    suggestion: Suggestion | null;
    roster: RosterMember[];
    chosenId: string | null;     // null = take the suggestion
    picking: boolean;            // showing the full roster to override
    adding: null | { name: string; role: ApproverRole; phone: string };
    /**
     * MY GROUP — the people who can be asked to REVIEW this (hadar 2026-08-14).
     * Separate from `roster` on purpose, because they are separate things and the
     * sheet must not blur them: `roster` is the client side (who signs, one of them),
     * `members` is my company (who gets a notification, any number of them).
     * Empty is normal and not an error — a solo operator has no group, and on a device
     * whose `company_member` has not synced this is also empty.
     */
    members: Member[];
    memberIds: string[];
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
  sendPrepRef.current = sendPrep;
  // FLOW step 3: the Review & Send screen over the details card. Holds the
  // company name so the preview renders the same header the owner will read.
  const [reviewSend, setReviewSend] = React.useState<null | { company: string | null }>(null);
  // FLOW — the processing screen that runs AFTER job selection (hadar, 2026-07-24:
  // "prompt me to choose a jobsite ... right as you click finish, it cannot upload
  // before that"). Job selection now comes first; this shows the live, HONEST
  // stages (each tracks a real signal, never a timer) and then opens the details
  // for the already-filed change order `coId`. On weak/no connection, a message +
  // Done that parks at home (the extra stays a filed draft, finished later).
  /** The live `transition`, for the poll below — see where it is read for why an
   *  updater cannot be trusted to run eagerly. Assigned every render. */
  const transitionRef = React.useRef<any>(null);
  const [transition, setTransition] = React.useState<null | {
    ids: string[]; anchorCaptureId: string | null; coId: string;
    /**
     * The anchor recording held no speech — set by the poll when `voice_silent` has a
     * row for it. Optional because it is DISCOVERED, never declared: no caller can know
     * it at the moment it opens this screen.
     */
    anchorSilent?: boolean;
    /**
     * The added captures are held because the PARENT extra has no jobsite yet — the
     * uploader's `AWAITING_FILING` park. On an edit this is not a hold to act on, it is
     * a fact to state: the amendment is safe and rides up with the extra it belongs to.
     */
    heldForFiling?: boolean;
    uploaded: boolean; transcribed: boolean; analyzed: boolean; offline: boolean;
    stalled: boolean; uploadDone: number; uploadTotal: number;
    lastError: string | null; blocked: boolean;
    /**
     * PER-KIND UPLOAD PROGRESS (hadar, 2026-08-21: "1 out of 4 photos are uploaded,
     * 30% complete").
     *
     * The bar already existed and said "{done} of {total} backed up (photos + audio)",
     * which is true and hard to act on: a contractor watching four photos crawl up a
     * jobsite connection cannot tell whether the thing that is stuck is the recording
     * or the pictures, and one lumped number hides which. Counting them apart is what
     * turns a spinner into information.
     */
    photoDone: number; photoTotal: number;
    voiceDone: number; voiceTotal: number;
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
  // Kept current for the 90-second poll, which cannot rely on a setState updater
  // running eagerly. Assigned every render, never read during one.
  transitionRef.current = transition;

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
    // Latches once the anchor recording is known to hold no speech. Separate from `tr`
    // because the two mean different things to the person reading the screen: `tr` is
    // "this step is finished", `silentSeen` is "and what it found was nothing".
    let silentSeen = false;
    /** Latches when the added captures are waiting on the PARENT extra's jobsite. */
    let heldSeen = false;
    // True while drainOutbox refuses to upload on POLICY (on cellular with
    // cellular-upload off — the default). That is not offline and not slow: it will
    // never finish here, so surface the Wi-Fi escape at once (Codex P2).
    //
    // NOT A LATCH ANY MORE (hadar, 2026-08-21). It was one because the block was
    // unfixable from this screen — the only escapes were Wi-Fi or Settings, and a
    // flag that flickered would have hidden the explanation. Now the screen offers
    // the fix itself, so a latch would leave "turn on cellular upload" on display
    // AFTER he turned it on: the one thing worse than a message with no action is a
    // message that ignores the action.
    //
    // Safe to read per-call because `drainOutbox` sets `blocked` from the gate
    // BEFORE it looks at a single row (uploader.ts) — it is null whenever the gate
    // allowed the attempt, never merely "nothing to do".
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
          blockedSeen = !!r.blocked;
        }
      } catch { /* the capture is safe locally; a failed push just retries */ }
    };
    const isOffline = async () => {
      // Only OFFLINE when the radio says so explicitly — undefined isConnected is
      // "unknown", not "offline" (review #2).
      try { return (await Network.getNetworkStateAsync()).isConnected === false; }
      catch { return false; }  // can't tell → don't cry offline
    };
    /**
     * "EVERY recording in this capture was silent" — never "the first one was".
     *
     * Codex, 2026-08-23, P1: the first version asked only about `anchorCaptureId`, and
     * the anchor is `audioSegments[0]` / `voiceIds[0]`. A session whose opening clip is
     * silent and whose SECOND clip carries the actual explanation would have been
     * declared finished on the strength of the empty one — the screen leaving early on
     * exactly the recording that had the most to say. A verdict about a session has to
     * be a verdict about all of it.
     *
     * `capture_commit` is the authority on which of these ids are voice. Zero voice rows
     * returns false, not vacuous truth: "nothing to be silent about" is the anchor-less
     * case, and that is already handled by `tr`'s initialiser.
     *
     * ISOLATED try/catch, deliberately. Folded into the caller's block, a missing
     * `voice_silent` table (partial migration) threw past the cloud-proposal lookup that
     * shares it, so the one device that most needed the server to release the gate was
     * the one device that could never reach it. A failure here costs this answer only.
     */
    const allVoicesSilent = async (): Promise<boolean> => {
      try {
        const voices = await db.getAll<{ capture_id: string }>(
          `SELECT capture_id FROM capture_commit
            WHERE capture_id IN (${marks}) AND modality = 'voice'`, transition.ids);
        if (!voices.length) return false;
        const ids = voices.map((v) => v.capture_id);
        const q = ids.map(() => '?').join(',');
        const silent = await db.getAll<{ n: number }>(
          `SELECT count(*) AS n FROM voice_silent WHERE capture_id IN (${q})`, ids);
        return (silent[0]?.n ?? 0) >= ids.length;
      } catch { return false; }
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
          /**
           * AN EDIT NEVER ASKS FOR A JOB (hadar, 2026-08-23, option (a)).
           *
           * `uploader.ts` parks a capture whose project is the Inbox sentinel as
           * AWAITING_FILING, because `capture.project_id` references `project(id)` on
           * the server and the Inbox has no row — sending it is a guaranteed FK
           * rejection. `onAugmentCapture` inherits the project from the PARENT extra,
           * so editing an extra that is itself unfiled parked every added capture, the
           * outbox never drained, `up` never came true and the screen hung forever —
           * with or without audio. That is the stall, and it is why nothing has
           * uploaded since the parent extra was created in the Inbox.
           *
           * The park is right and stays: those bytes genuinely cannot be sent yet. What
           * was wrong is the SCREEN treating a known, benign wait as an unfinished
           * upload and demanding the contractor answer a filing question in the middle
           * of an amendment. An edit is not a create; it does not get to ask where the
           * work belongs, because it already belongs wherever its parent does.
           *
           * Only when EVERY remaining row is held for that reason. A genuine failure
           * mixed in still holds the screen, because that one is not benign.
           */
          if (!up && transition.isAugment) {
            const held = (await db.getAll<{ n: number }>(
              `SELECT COUNT(*) AS n FROM capture_outbox
                WHERE capture_id IN (${marks}) AND last_error_code = 'AWAITING_FILING'`,
              transition.ids))[0]?.n ?? 0;
            if (held > 0 && held >= n) { up = true; heldSeen = true; }
          }
          if (!tr) {
            tr = !!(await db.getAll(
              `SELECT 1 FROM voice_transcript_cache WHERE capture_id = ?`,
              [transition.anchorCaptureId]))[0];
            /**
             * SILENCE IS AN ANSWER, NOT A PENDING STATE (hadar, 2026-08-23: "i didnt
             * say anything because i just added photoes").
             *
             * The cache row above is the ONLY evidence this poll ever had that
             * transcription finished, and `transcribeOnDevice` deliberately writes no
             * row when the recording holds no speech. So a man who turned the mic on,
             * said nothing and shot three photos watched "Writing down what you said…"
             * for ninety seconds and was then told his finished capture was slow.
             *
             * `voice_silent` carries that verdict. Reading it here makes the step
             * complete for the honest reason instead of the screen timing out, and
             * `anchorSilent` lets the row say what actually happened.
             */
            if (tr) {
              /**
               * WORDS OUTRANK THE EARLIER SILENCE, and the verdict must be WITHDRAWN,
               * not merely stopped from being re-asserted (code review, 2026-08-23).
               *
               * `silentSeen` latches across ticks, `tr` is recomputed inside each one.
               * Without this line, a cloud transcript landing in the cache after silence
               * had already latched would set `tr` from the row above and skip the block
               * below — leaving `silentSeen` stale at true. The screen would then print
               * "Nothing said — photos only" over a recording that HAS a transcript, and
               * the gate would stop waiting for the AI pass that had just succeeded.
               * A false statement about evidence is the one thing this screen may
               * never make.
               */
              silentSeen = false;
            } else {
              silentSeen = await allVoicesSilent();
              if (silentSeen) tr = true;
            }
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
        /**
         * AND SILENCE ALSO ENDS THE WAIT (hadar, 2026-08-23: "version 13 it's stuck").
         *
         * The rule above hands the server the last word on whether a recording had
         * speech, which is right when there is something to wait FOR. When the
         * recogniser has already reported it heard nothing, there is not: the server
         * refuses an empty transcript too (368), so no structured row is ever written,
         * `analyzedSeen` can never latch, and the screen spends its full ninety seconds
         * before calling a finished capture slow. That is the stall.
         *
         * THE TRADE, STATED: cloud STT is better than on-device, so a recording this
         * device called silent could in principle hold speech the server would catch.
         * The server still processes it and the description still grows if it does —
         * what changes is only that the SCREEN stops standing there waiting for it.
         */
        /**
         * …AND A SERVER THAT HAS NOT RECEIVED THE BYTES CANNOT BE WAITED ON.
         *
         * `heldSeen` means the added captures are parked until the parent extra has a
         * jobsite, so the cloud pass will never run on them — no proposal is coming, and
         * requiring `analyzedSeen` here would hang the edit for its full ninety seconds
         * exactly as the upload gate did before it. The addendum is not lost: the
         * finalizer marks it pending and `retryPendingAugments` applies it once the
         * extra is filed and the words arrive.
         */
        const ready = up && (tr || analyzedSeen) && (analyzedSeen || silentSeen || heldSeen);
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
        /**
         * THE TOTAL IS HOW MANY FILES THERE ARE, not how many were still queued the
         * first time we looked (hadar, 2026-08-21: "I just created a new change order,
         * I didn't see the secondary progress bar").
         *
         * `firstCount` is the outbox count at the FIRST poll. On wifi the captures can
         * drain before that tick ever runs, so `firstCount` is 0 — which made
         * `uploadTotal` 0, and the render is gated on `uploadTotal > 0`, so the bar
         * never appeared at all. The one case where the upload is fast is the case
         * where the bar silently did not exist.
         *
         * `transition.ids` is the set of captures this transition committed. It is
         * known before the first poll, never changes, and is the honest denominator:
         * four photos and a recording is five files whether they take a second or a
         * minute.
         */
        const uploadTotal = transition.ids.length;
        const uploadDone = Math.max(0, uploadTotal - n);

        /**
         * THE SAME ARITHMETIC, SPLIT BY WHAT THE FILE IS.
         *
         * `capture_commit` is the authority on modality — it is the row that records
         * what was captured — and `capture_outbox` is the authority on what is still
         * waiting. Totals come from the commit side so they are stable for the whole
         * transition; done is total-minus-remaining, exactly as the overall figure is
         * derived, so the two can never disagree.
         *
         * Best-effort: a failure here costs the sub-line, never the bar above it or
         * the gate below it.
         */
        let photoTotal = 0, voiceTotal = 0, photoDone = 0, voiceDone = 0;
        try {
          const tot = await db.getAll<{ modality: string; n: number }>(
            `SELECT modality, COUNT(*) AS n FROM capture_commit
              WHERE capture_id IN (${marks}) GROUP BY modality`, transition.ids);
          const left = await db.getAll<{ modality: string; n: number }>(
            `SELECT cc.modality, COUNT(*) AS n
               FROM capture_outbox o JOIN capture_commit cc ON cc.capture_id = o.capture_id
              WHERE o.capture_id IN (${marks}) GROUP BY cc.modality`, transition.ids);
          const at = (rows: typeof tot, m: string) => rows.find((r) => r.modality === m)?.n ?? 0;
          photoTotal = at(tot, 'photo'); voiceTotal = at(tot, 'voice');
          photoDone = Math.max(0, photoTotal - at(left, 'photo'));
          voiceDone = Math.max(0, voiceTotal - at(left, 'voice'));
        } catch { /* the sub-line is omitted; the bar above is unaffected */ }
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
                                    anchorSilent: silentSeen, heldForFiling: heldSeen,
                                    analyzed: analyzedSeen, offline,
                                    uploadDone, uploadTotal, lastError,
                                    photoDone, photoTotal, voiceDone, voiceTotal,
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
          /**
           * HAND-OFF, decided OUTSIDE the state updater.
           *
           * React may invoke a `setState` updater twice, so dispatching from inside one
           * risks running the hand-off twice — the same hazard `dismissAck` documents.
           * The updater now only reads and clears; the dispatch happens after it.
           *
           * hadar, 2026-08-20: "once the CO is processed, we should navigate to the CO
           * details page. we should just acknowledge the creation and processing of the
           * CO with a popup — and by clicking ok taking them to the detail page."
           *
           * A NEW extra used to land in the priced composer (`finishExtraById`) — a
           * form standing between a contractor and the thing he just made, asking for a
           * price the AI has usually already extracted. The record screen shows the
           * write-up, the photos and the price, and carries "Edit details" into that
           * same composer for the cases where it IS wrong. Nothing is lost; the form
           * stops being compulsory.
           *
           * Augment and generate are UNTOUCHED. They are not "a change order was just
           * created" — one grows an existing record and the other is mid-edit — so
           * neither wants this popup, and both already return where they came from.
           */
          /**
           * READ FROM THE REF, NOT OUT OF A setState UPDATER.
           *
           * `handoff` was assigned inside `setTransition(t => …)` and read on the next
           * line — which only works if React evaluates the updater eagerly at dispatch,
           * and it only does that when the fiber has no pending lanes. Inside this
           * 90-second poll, running alongside `refresh()` and its several setStates,
           * that is not a promise React makes.
           *
           * When it is not eager, `handoff` is still null: processing finishes and
           * NOTHING happens — no write-up applied, no "your change order is ready", no
           * navigation. Silently, and only sometimes, which is the worst shape of all
           * (review, 2026-08-21).
           *
           * The ref is current at read time by construction, and the updater keeps its
           * one real job: clearing the state.
           */
          const t = transitionRef.current;
          const handoff: null | { kind: 'gen' | 'aug' | 'new'; coId: string; ids: string[] } =
            t ? { kind: t.isGenerate ? 'gen' : t.isAugment ? 'aug' : 'new',
                  coId: t.coId, ids: t.ids }
              : null;
          /**
           * STEP 4 STAYS UP THROUGH THE HAND-OFF (hadar, 2026-09-03: "between write-up
           * and preview i can see the home screen").
           *
           * On the 'new' path this block hydrates the write-up (up to 3s) and then opens
           * the record. Clearing the processing screen here left all of that with no flow
           * screen matching, so the app rendered HOME between step 4 and step 5 — the
           * longest of the flashes, and I lengthened it myself this morning when I added
           * the hydrate.
           *
           * The screen it holds on is the honest one: every checkmark ticked, 100% done.
           * Another second of that reads as the last step finishing, which is exactly
           * what is happening. It comes down in the same commit that opens the record.
           *
           * `gen` and `aug` clear immediately as before — they have their own
           * destinations and no rail to keep counting.
           */
          if (handoff?.kind !== 'new') setTransition(null);
          if (handoff) {
            const h: { kind: 'gen' | 'aug' | 'new'; coId: string; ids: string[] } = handoff;
            if (h.kind === 'gen') void finishGenerateById(h.coId);
            else if (h.kind === 'aug') {
              // BACK TO THE REVIEW, not to the record. He went out to say more about a
              // change order he is still reviewing; returning him to a different screen
              // than the one he left would end a loop he has not finished.
              if (flowResumeRef.current === h.coId) {
                flowResumeRef.current = null;
                setFlowRecordId(h.coId);
              }
              void finishAugmentById(h.coId, h.ids);
            }
            else {
              /**
               * DO NOT CLAIM A WRITE-UP THAT DID NOT HAPPEN.
               *
               * hadar, 2026-09-02: "i still see this message after the AI processing" —
               * "Your change order is ready. We wrote up what you said." Every recording
               * that night structured to `confidence: none` and produced no scope, no
               * price, no schedule. The pipeline was right to refuse (mandate #6 forbids
               * inventing a price from speech that contains none); the SENTENCE was
               * wrong, and it is the same defect CLAUDE.md names as this project's
               * recurring one — claims that outrun their evidence.
               *
               * Read the row rather than assume: if the scope is still the placeholder,
               * nothing was written up, and the honest thing is to say so and point at
               * the screen where he can write it himself. He still lands in the same
               * place; only the promise changes.
               */
              void (async () => {
                /**
                 * STEP 5's CORRIDOR. This block hydrates (up to 3s) and then opens the
                 * record, and `setTransition(null)` has already run — so without the
                 * hold this is the LONGEST flash of Home in the whole sequence, and I
                 * lengthened it myself when I added the hydrate above.
                 */
                setFlowHold(5);   // backstop only; step 4 above is what he actually sees
                /**
                 * PULL THE WRITE-UP DOWN BEFORE JUDGING IT (hadar, 2026-09-03: "I gave
                 * it a whole description of cabinet — it claims that it couldn't hear
                 * enough write ups which cannot be the case. In the preview when I close
                 * the preview and open the record it's all there").
                 *
                 * He was right and the diagnosis is a RACE I built in.
                 *
                 * `analyzedSeen` latches when a proposal EXISTS ON THE SERVER — that is
                 * the readiness gate, and it was correct. But since sql/394 the scope of
                 * work is written by `apply_proposal_v1` SERVER-SIDE, and this device
                 * only learns it through `hydrateChangeOrders`, which runs on its own
                 * sweep. So the order of events was:
                 *
                 *   1. proposal appears on the server            → ready
                 *   2. hand-off reads the LOCAL change_order row → still empty
                 *   3. "We couldn't make out the work"
                 *   4. hydrate runs seconds later                → the scope lands
                 *   5. he opens the record and it is all there
                 *
                 * The message was never about the recording. It was this device
                 * reporting on a column it had not fetched yet — and it accused the
                 * contractor's own dictation of being inaudible to do it.
                 *
                 * Hydrating first is not a new mechanism: it is the SAME call that fixes
                 * it fifteen seconds later, moved to before the sentence that depends on
                 * it. Scoped to this one project, and to a `getSession()` that is local
                 * (no round trip — the same reason `kickDrain` above uses it). It also
                 * means the review screen he lands on has the write-up ON it rather than
                 * filling in underneath him.
                 *
                 * BEST-EFFORT BY CONSTRUCTION. If it fails or he is offline, `wrote`
                 * falls back to whatever the local row already holds — never worse than
                 * before, and mandate #7 keeps its promise that no message here waits on
                 * the network to be correct.
                 */
                try {
                  const { data: sess } = await connector.client.auth.getSession();
                  const uid = sess?.session?.user?.id;
                  // The project comes off the row rather than the transition state,
                  // which does not carry one. A local read, and the scoped hydrate is
                  // one job's extras rather than the account's.
                  const pid = (await db.getAll<{ p: string | null }>(
                    `SELECT project_id AS p FROM change_order WHERE id = ?`, [h.coId]))[0]?.p;
                  if (uid && pid) {
                    /**
                     * BOUNDED, because this is the same trap I fell into yesterday with
                     * `await openRecord` — a correct-looking await that puts the network
                     * between a contractor and his acknowledgement. Three seconds is far
                     * more than a scoped hydrate needs on any working connection, and on
                     * a dead one he gets the old behaviour instead of a silent screen.
                     *
                     * The window is narrow by construction: reaching this branch at all
                     * required `analyzedSeen`, which only latches on a SUCCESSFUL server
                     * read of the proposal seconds earlier. A phone that was offline
                     * leaves this poll through the 90-second stall branch, not here.
                     */
                    await Promise.race([
                      hydrateChangeOrders(db, connector.client, pid, uid),
                      new Promise((r) => setTimeout(r, 3000)),
                    ]);
                  }
                } catch { /* offline or refused: read what we have */ }

                let wrote = false;
                try {
                  const row = (await db.getAll<{ s: string | null; t: string | null }>(
                    `SELECT scope_of_work AS s, scope AS t FROM change_order WHERE id = ?`,
                    [h.coId]))[0];
                  /**
                   * `hasWrittenScope`, NOT a rule spelled out again here (review,
                   * 2026-09-02). This asked its own question — non-empty and not the
                   * placeholder — while the review screen asked `no_description`, which
                   * also falls back to the title and demands 40 characters. So a
                   * twenty-character scope got a green "we wrote up what you said" over
                   * a screen saying we heard nothing, and a null scope with a long title
                   * got the reverse plus an empty card. One function decides now.
                   */
                  wrote = hasWrittenScope(row?.s, row?.t);
                } catch { wrote = true; /* cannot tell — do not accuse the pipeline */ }

                /**
                 * NAVIGATE FIRST, THEN SPEAK (hadar, 2026-09-02: "this message shows up
                 * before that and it displays the main screen without the creation
                 * progress bar, which breaks the user experience").
                 *
                 * The popup itself is his own 2026-08-20 decision and it stays. What was
                 * wrong was the ORDER. `setTransition(null)` had already torn down the
                 * processing screen, and the navigation was hanging off the ack's `then`
                 * — so for as long as the message was on screen the backdrop was HOME.
                 * A man five steps into making a change order was shown his dashboard,
                 * no rail, no step count, and told something about work he could no
                 * longer see. The flow appeared to have ended and then resumed.
                 *
                 * Opening the record first means the ack lands on step 5 with the rail
                 * behind it, which is where the sentence is actually about something.
                 * `ackEl` is rendered last in the tree, so it overlays whatever screen is
                 * current — no z-order work needed, only the right order.
                 *
                 * ONLY THE 'new' BRANCH MARKS THE FLOW. A generate or an augment lands on
                 * this same screen, but the contractor was editing an extra that already
                 * existed — telling him he is on step 5 of making one would be a rail
                 * describing a journey he never started.
                 */
                // THE HANDOVER: step 4 comes down as step 5 goes up, one commit, nothing
                // in between. `setTransition(null)` was deferred above for exactly this.
                setTransition(null);
                setFlowRecordId(h.coId);
                /**
                 * DISPATCHED, NOT AWAITED (review, 2026-09-02).
                 *
                 * The bug being fixed was that navigation hung off the ack's `then`, so
                 * it happened only when he tapped OK and the backdrop was HOME for the
                 * whole time the message was up. Dispatching it BEFORE the ack fixes
                 * that completely.
                 *
                 * Awaiting it does not fix it better — it introduces a worse bug.
                 * `openRecord` puts the screen up from a local read and THEN makes three
                 * network calls (`withEventLog`, `narrationForExtra`, the server ask).
                 * Awaiting the whole function means that on weak signal — the condition
                 * mandate #7 says to assume — he lands on the record and is told nothing
                 * at all until those time out. An acknowledgement gated on connectivity
                 * is the exact thing that mandate forbids.
                 */
                void openRecord(h.coId);

                setAck({
                  /**
                   * A GREEN TICK ABOVE "WE COULDN'T MAKE OUT THE WORK" (hadar's
                   * screenshot). `kind` was hard-coded 'ok', so the one case that is NOT
                   * a success was drawn with the success mark — the icon said it worked
                   * while the words said it did not, and the icon is read first.
                   *
                   * 'no' is the right shape and not an alarm: `ackBoxNo` is an amber
                   * hairline and `ntAttention`, which is what "say it again and we'll
                   * have it" looks like. Nothing failed that he needs to fear — the
                   * recording IS saved, and mandate #1 is intact — but nothing was
                   * written either, and the mark has to agree with the sentence.
                   */
                  kind: wrote ? 'ok' : 'no',
                  title: T(wrote ? 'proc.readyTitle' : 'proc.nothingHeardTitle'),
                  detail: T(wrote ? 'proc.readyBody' : 'proc.nothingHeardBody'),
                  okLabel: T('common.ok'),
                });
              })();
            }
          }
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
  /** Bumped when a tap on a client-message push should land on the conversation, not
   *  just on the record. Read by the negotiation screen; see `openCo`. */
  const [openMessagesNonce, setOpenMessagesNonce] = React.useState(0);
  /**
   * The records carrying something unread, for the red dot on every card list.
   * Memoised on `activity` because it is read three times per render pass (feed, home
   * and the job screen) and rebuilding the Set each time would be three walks of the
   * same rows for one answer.
   */
  const unreadRecords = React.useMemo(() => unreadByChangeOrder(activity), [activity]);
  /** Unseen MESSAGES per record, for the badge on the open record's Messages tab.
   *  Narrower than `unreadRecords`: see `unreadMessagesByChangeOrder`. */
  const unreadMsgs = React.useMemo(() => unreadMessagesByChangeOrder(activity), [activity]);
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

  /**
   * THE HAND-OFF INTO STEP 5.
   *
   * Steps 3 and 4 are the app's OWN recorder and job sheet — the guided flow does not
   * replace them, so it has to notice when they are finished rather than being told.
   * The moment a record exists while the flow is running we are on the read-back; the
   * transcript arrives later and is kept live here, which is what turns "we're still
   * reading it" into the words without him doing anything.
   *
   * IT LIVES UP HERE WITH THE OTHER HOOKS, not beside the screens it feeds. Placed next
   * to them it sat below `if (ready && !initError)` and every guard after it — so it ran
   * on some renders and not others and React counted a different number of hooks each
   * time: "Rendered more hooks than during the previous render", a red screen the moment
   * the guided flow opened a record. Reading order lost to the rules of hooks.
   */
  React.useEffect(() => {
    if (!guidedOn || !record) return;
    setGTranscript(record.voices.find((v) => v.transcript)?.transcript ?? null);
    // Only ENTERS the flow's screens; never overrides a step he has already moved past.
    setGStep((cur) => cur ?? 'transcript');
  }, [guidedOn, record]);
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
  /**
   * WHETHER THE SERVER HAS BEEN ASKED for the open extra's write-up.
   *
   * 'unknown' until it answers, and it MUST start there on every open: the draft
   * screen may only report "nothing was written up" once somebody actually checked,
   * and a value left over from the last extra is not a check.
   */
  const [recordWriteUp, setRecordWriteUp] =
    React.useState<'unknown' | 'absent'>('unknown');
  /**
   * THE PRICE READ OFF THE AI's SEGMENTS for the open extra — summed, with the
   * per-segment breakdown that makes the sum checkable. Null until the proposal is
   * fetched, and null forever when the recording carried no parseable segment price.
   */
  const [recordPrice, setRecordPrice] = React.useState<VoicePriceReading | null>(null);
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
  /** The live value of `terms`, for continuations that outlive the render that made
   *  them — see `augmentExtra`. Assigned every render, never read during one. */
  const termsRef = React.useRef(false);
  const [showTerms, setShowTerms] = React.useState<
    null | { jur: string | null; detecting: boolean }
  >(null);
  /**
   * DEV ONLY — a window on the flags that decide which screen wins.
   *
   * Its OWN effect with a real dependency list: hung off the `[]` effect above it would
   * have reported the values from first render forever, which is worse than no probe —
   * it would answer confidently and wrongly. Added because "it takes me to the starting
   * page" is a symptom of any of six guards and guessing costs a round trip each time.
   */
  React.useEffect(() => {
    if (!__DEV__) return;
    (globalThis as any).__flags = () => JSON.stringify({
      terms, showCapture, showTerms: !!showTerms, guidedOn, gStep, guided,
      forceFirstExtra, record: !!record, projectId, assign: !!assign, gate: !!gate,
      firstRun, hasProfile: hasProfileState, seenOnboarding, session: session === null ? 'null' : typeof session,
      firstExtra, nav,
    });
    // REMOVED: __startRec used to REIMPLEMENT the entry so the tap could be reproduced
    // from the inspector. That made it a fourth copy — one that would have passed while
    // the three real ones were broken, which is the opposite of what a probe is for.
    // `enterGuided` is a single function now; drive the flow with __showFirstExtra()
    // and press the button.
  });

  /**
   * WHAT THE USER WAS TRYING TO DO WHEN THE GATE FIRED.
   *
   * hadar, 2026-08-20: "when i click start recording it presented me with the geo
   * location permissions and then the audio and when i said yes to both it took me to
   * the first page in the series."
   *
   * That is this ref's absence. Ten call sites read `if (!terms) { openTerms(); return; }`
   * and every one of them RETURNED — dropping the intent on the floor. Accepting the
   * terms then set a flag and closed the screen, so the render tree fell back to
   * whatever it would otherwise show, which from the guided flow is FirstExtra. The
   * user had done everything right and landed at the start again.
   *
   * A ref rather than state: nothing renders from it, and it must survive the re-render
   * that `setTerms(true)` causes without scheduling another one.
   */
  const afterTerms = React.useRef<null | (() => void)>(null);

  termsRef.current = !!terms;

  /**
   * LOAD THE TERMS FLAG AT MOUNT, NOT AT THE END OF `refresh()`
   * (hadar, 2026-08-24: the recording note again, "never show this to me again" —
   * and the screen's own copy says "You only do this once").
   *
   * `terms` is `boolean | null`, where null means NOT LOADED YET. Every gate reads
   * `if (!terms)`, which cannot tell that apart from `false`. It was only set near the
   * END of `refresh()` — after the hydrates, the drains and a dozen awaited reads — and
   * `setReady(true)` deliberately does not wait for `refresh()`. So on a cold start
   * there is a window where the app is usable and `terms` is still null, and a tap on
   * record in that window shows the legal screen to a contractor who accepted it weeks
   * ago, plus fresh mic and location prompts behind it.
   *
   * This is code-review finding #8 from 2026-08-23, which I read and did not fix.
   *
   * `getTermsAccepted` is one local key/value read. It has no business being queued
   * behind the network work, and doing it first closes the window to about a frame.
   */
  React.useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const ok = await getTermsAccepted(db);
        if (alive) setTerms(ok);
      } catch { /* the gate stays closed and `refresh()` will try again */ }
    })();
    return () => { alive = false; };
  }, []);

  /**
   * ASK THE DATABASE BEFORE ASSUMING HE HAS NOT AGREED.
   *
   * The ten gates all read `if (!terms)`, and `terms` is `boolean | null`. Null means
   * "not read yet", and treating it as "not accepted" is what puts a legal screen in
   * front of a man who accepted it weeks ago — the mount effect above makes that window
   * small, and this makes it impossible: an unknown is RESOLVED, never guessed.
   *
   * It cannot resolve the other way. A read that throws leaves the gate closed, because
   * the failure mode of showing the terms once too often is an annoyance and the failure
   * mode of skipping them is recording audio under terms nobody accepted.
   */
  const gateTerms = React.useCallback(async (next: () => void) => {
    let ok = termsRef.current ? true : terms;
    if (ok === null || ok === undefined) {
      try { ok = await getTermsAccepted(db); setTerms(ok); }
      catch { ok = false; }
    }
    if (!ok) { openTermsRef.current?.(next); return; }
    next();
  }, [terms]);

  /** `openTerms` is defined below this point; a ref keeps `gateTerms` from depending on
   *  declaration order, which is how the previous attempt at this file's gates went
   *  wrong (see `afterTerms`). */
  const openTermsRef = React.useRef<null | ((next?: () => void) => void)>(null);

  const openTerms = React.useCallback((next?: () => void) => {
    afterTerms.current = next ?? null;
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
  openTermsRef.current = openTerms;

  /**
   * Consume the quick action once the app can actually honour it.
   *
   * Waits for `ready` (the local database is open and the session applied), then goes
   * through the SAME two steps the ⊕ button does — terms first, capture second. A second
   * copy of that order is how one entry point ends up opening a camera on someone who has
   * never accepted the terms.
   */
  React.useEffect(() => {
    if (!pendingCapture || !ready) return;
    setPendingCapture(false);
    void gateTerms(() => setShowCapture(true));
  }, [pendingCapture, ready, terms]);

  // REQ-SET1/EVID2. Null until the first job exists -- a new user has no jobs, and
  // pretending otherwise is what the hardcoded constant was doing.
  const [projectId, setProjectId] = React.useState<string>(INBOX_ID);
  const [projects, setProjects] = React.useState<Project[]>([]);
  // CompanyCam-style shell: the app opens on the Projects list; a capture happens
  // INSIDE a project. 'home' = the project list, 'project' = one project's
  // camera-first workspace + capture grid.
  const [nav, setNav] = React.useState<'home' | 'project' | 'jobs' | 'activity' | 'notifications'>('home');
  // The Activity page's status tab (hadar, 2026-07-23 mockup): all extras, filtered.
  const [activityTab, setActivityTab] =
    React.useState<'all' | 'waiting' | 'approved' | 'needs' | 'closed'>('all');
  // Home's summary-chip filter. Filters the Home list IN PLACE — tapping a chip must
  // never navigate away (hadar 2026-07-27: "it takes me to another page"). null = show
  // every section; a value shows only that one, and tapping the live chip clears it.
  // Opens on 'needs' (hadar 2026-08-05): what needs YOU is the reason to open the app,
  // so it is selected by default; tapping the live chip still clears to every section.
  /**
   * "Learn how it works", from the first-run Home. It exists because the design put a
   * link there and A LINK THAT OPENS NOTHING IS THE WORST CONTROL ON A FIRST SCREEN —
   * the one user who most needs to be told what this app does is the one who taps it.
   * Three steps, no account state, no network: it is the product in three sentences.
   */
  const [howOpen, setHowOpen] = React.useState(false);
  /**
   * THE APP ICON'S NUMBER — PARKED, NOT DELETED (2026-08-12).
   *
   * `React.useEffect(() => { void setAppBadge(unreadCount(activity)); }, [activity])`
   * belongs here and is the right design: every path that moves the unread count ends
   * by setting `activity`, so this is the one place downstream of all of them.
   *
   * IT IS OFF BECAUSE IT RED-SCREENED THE APP. Touching `setBadgeCountAsync` is the
   * first thing in this app to pull expo-notifications' badge submodule, and something
   * in that chain reads `ReactNative.PushNotificationIOS` — a getter whose module builds
   * a NativeEventEmitter over a native module this build does not contain, so it throws
   * `new NativeEventEmitter() requires a non-null argument` at module scope. My
   * try/catch DOES swallow it (the app keeps working), but Metro's dev `guardedLoadModule`
   * reports a module-factory throw to LogBox before the caller ever sees it — so the user
   * gets a full-screen Uncaught Error for an error that was, in fact, caught.
   *
   * Turning it back on needs the module chain identified from a full stack (the capture
   * in `index.js` records one) and then either the offending require avoided or the
   * native module linked. The in-app bell carries the count in the meantime.
   */
  const [cards, setCards] = React.useState<ProjectCard[]>([]);
  const [search, setSearch] = React.useState('');
  const [picker, setPicker] = React.useState(false);
  const [filed, setFiled] = React.useState<Msg | string | null>(null);
  /**
   * THE EDIT ACKNOWLEDGEMENT (hadar, 2026-08-12: "a popup that confirms the action …
   * if an edit is made, cost was changed, payment timing is changed").
   *
   * WHY AN EDIT NEEDS ONE AT ALL. Every field sheet on the change-order screen closes
   * itself on save and drops you back on the record. That is the SAME thing the screen
   * does when you tap Cancel, so the two outcomes were pixel-identical: the only proof
   * a price had been written was to find the row again and read it. On the one screen
   * where the numbers are the product (mandate #6), "did that save?" is not a question
   * the app gets to leave open.
   *
   * IT ECHOES THE VALUE, NOT JUST THE VERB. "Cost updated · $1,240.00" is a read-back —
   * the same doctrine as the money field's own read-back, at the moment the figure
   * becomes what the client will be shown. "Saved ✓" alone would confirm that SOMETHING
   * was written without confirming WHAT, which is the failure mode mandate #6 exists for.
   *
   * `kind` decides how it leaves. A confirmation auto-dismisses (it is news you already
   * expected, and mandate #3's touch budget does not spend a tap on "OK"); a REFUSAL
   * waits to be dismissed, because it carries the reason the write did not happen and
   * a message that vanishes on its own is a message nobody read.
   */
  /**
   * A different account is taking over this handset and the previous user's data is
   * being removed. True only for the seconds `claimDevice` is running; it holds the
   * whole UI on the splash so nothing reads a table that is momentarily gone.
   */
  const [wiping, setWiping] = React.useState(false);
  /**
   * WHY THE SIGN-IN DID NOT TAKE, shown on the sign-in screen itself.
   *
   * `setAck` cannot carry this: App returns `<AuthScreen>` early on the logged-out
   * branch and `ackEl` is only rendered further down the tree, so an ack raised while
   * signed out is never drawn. hadar hit exactly that — "I am entering the 123456 code
   * but nothing happens" — where the code HAD verified and `claimDevice` then refused
   * the handover and signed him back out, silently.
   */
  const [authNotice, setAuthNotice] = React.useState<
    null | { title: string; detail?: string | null }>(null);
  /** Rows queued in every owned outbox + open drafts, refreshed when the drawer opens.
   *  Null = not counted. What the sign-out confirmation warns about. NOT `unsent`,
   *  which is already taken by the Extras tab's list of undelivered decisions. */
  const [unsentWork, setUnsentWork] = React.useState<number | null>(null);
  const [ack, setAck] = React.useState<null | {
    kind: 'ok' | 'no'; title: string; detail?: string | null;
    /**
     * Label for a confirm button. Its presence also CANCELS the auto-dismiss timer:
     * an ack that hands off somewhere else (2026-08-20 — the post-processing one that
     * opens the change order) must not navigate on a 1.9s fuse while the phone is in
     * a pocket. `kind: 'ok'` without this is unchanged: it still fades by itself.
     */
    okLabel?: string;
    /** Runs when this ack is dismissed, however it is dismissed — the timeout, the
     *  scrim, or the button. Added for the account close, where the sign-out has to
     *  wait until the confirmation has actually been SEEN: signing out immediately
     *  unmounts this overlay, so the person is told nothing and simply finds
     *  themselves back at the login screen. */
    then?: () => void;
  }>(null);
  // The follow-up is read from `ack` and called OUTSIDE the updater. React may invoke a
  // state updater twice, and a double-invoked `then` here is a double sign-out.
  const dismissAck = React.useCallback(() => { ack?.then?.(); setAck(null); }, [ack]);
  React.useEffect(() => {
    // An ack with a button waits for the button. See `okLabel`.
    if (!ack || ack.kind !== 'ok' || ack.okLabel) return;
    const t = setTimeout(dismissAck, 1900);
    return () => clearTimeout(t);
  }, [ack, dismissAck]);
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
  // the in-step form. `pSub` is the sub-screen — THREE now (hadar 2026-08-19, from
  // the mockups): 'lang' (language) → 'who' (name + solo/company) → 'how' (what the
  // app does, ending in "Create first change order"). The old 'trade' grid is gone
  // from first run; `settingsscreen.tsx` still collects it. See ui/setupflow.tsx.
  const [hasProfileState, setHasProfile] = React.useState(false);
  const [pSub, setPSub] = React.useState<'lang' | 'who' | 'how'>('lang');
  const [pName, setPName] = React.useState('');
  /**
   * THREE answers now (review 2026-08-25), not a boolean. 'invited' is the crew member
   * holding a code from their boss, who could previously answer only by lying — and
   * whose lie minted them a ghost company they then defaulted into forever. See
   * `StepProfile` in ui/setupflow.tsx for the full account.
   */
  const [pWork, setPWork] = React.useState<Work | null>(null);
  const [pCompany, setPCompany] = React.useState('');
  const [pInvite, setPInvite] = React.useState('');
  const [pInviteErr, setPInviteErr] = React.useState<string | null>(null);
  const [pJoining, setPJoining] = React.useState(false);
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

  /**
   * UNFINISHED CAPTURES, ASKED FOR AS THE RIGHT USER.
   *
   * Keyed on OWNER and guarded against the placeholder, because that is the whole
   * defect this replaces: the sweep used to run at init when OWNER was still
   * 'owner-local', so it swept nothing and offered nothing, for everyone, always.
   *
   * Runs again on a handover for free — `setOwner` fires for the incoming user, and
   * their drafts (of which there are none on a freshly wiped device) are the ones
   * asked about.
   */
  React.useEffect(() => {
    if (!ready || OWNER === OWNER_FALLBACK) return;
    let live = true;
    (async () => {
      try {
        await sweepDrafts(db, OWNER);
        // BEFORE the offer, not on the button: a draft whose captures already committed
        // is not unfinished work, and showing it as such is how a recovery prompt
        // becomes something people dismiss without reading. See closeLandedDrafts.
        const landed = await closeLandedDrafts(db, OWNER);
        if (landed.closed) console.log('drafts already landed:', JSON.stringify(landed));
        const ds = await recoverableDrafts(db, OWNER);
        if (live) setDrafts(ds);
      } catch (e) {
        console.log('[draft] sweep skipped:', String(e));
      }
    })();
    return () => { live = false; };
  }, [ready, OWNER, db]);

  /** Arms the first-sync splash bound, and re-arms it for the next account after a
   *  sign-out or a handover (both reset `synced` to 'unknown'). */
  React.useEffect(() => {
    if (synced !== 'unknown') return;
    setHoldExpired(false);
    const t = setTimeout(() => setHoldExpired(true), FIRST_SYNC_SPLASH_MS);
    return () => clearTimeout(t);
  }, [synced]);


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
        // CELEBRATE THE YES (gap #1) now lives in `checkCelebrations`, against a durable
        // watermark in `approval_celebrated` rather than a ref that forgot on every
        // launch. Called from the tick and from the foreground listener — see above.
        void checkCelebrations();
        // The Home dashboard: every LIVE extra across all jobs (superseded ones are
        // history), newest first, with its open-question count. Drafts belong here
        // too — they are the creator's unfinished work, private until sent (hadar,
        // 2026-07-23), and a Home that hid them showed nothing at all.
        setHomeExtras(await db.getAll(
          `SELECT co.id, co.scope, co.amount_cents, co.status, co.project_id,
                  COALESCE(p.name, '') AS pname, co.who_directed, co.created_at_ms,
                  co.signed_by, co.co_number,
                  ${CO_PHOTO_SUBQUERY} AS photo_relpath,
                  fa.name AS created_by,
                  -- HAS THE RECORD ITSELF REACHED THE SERVER? The EXISTS below asks
                  -- about its MEDIA, which is a different question: an extra can be
                  -- fully written and still be sitting in this device's queue. The
                  -- artboard's "On this phone" line is about the record, and Home had
                  -- no way to answer it (2026-08-25).
                  EXISTS (SELECT 1 FROM change_order_outbox co2
                           WHERE co2.change_order_id = co.id) AS record_pending,
                  -- STILL ON THE PHONE? (hadar, 2026-08-19: "when the change order is in
                  -- the list it should indicate to the user in the record with colour
                  -- that it is not yet processed".)
                  --
                  -- One EXISTS over the outbox, matching captureStatesForExtra's own
                  -- definition of queued: a row in capture_outbox IS the pending intent.
                  -- Both halves of an extra count — the voice capture on decision_version,
                  -- and the photos paired to it via capture_pair, which never appear
                  -- there. Missing the photos would paint a row as delivered while its
                  -- evidence sat in the queue, which is the exact overclaim
                  -- extraprocstate.ts exists to prevent.
                  -- (No backticks in this string: it is a JS template literal.)
                  EXISTS (
                    SELECT 1 FROM capture_outbox o
                     WHERE o.capture_id IN (
                       SELECT dv.capture_id FROM decision_version dv
                        WHERE dv.decision_id = co.decision_id AND dv.capture_id IS NOT NULL
                       UNION
                       SELECT cp.capture_id FROM capture_pair cp
                        WHERE cp.pair_id IN (
                          SELECT cp2.pair_id FROM capture_pair cp2
                           WHERE cp2.capture_id IN (
                             SELECT dv2.capture_id FROM decision_version dv2
                              WHERE dv2.decision_id = co.decision_id)))) AS pending_upload,
                  (SELECT COUNT(*) FROM co_question q WHERE q.change_order_id = co.id) AS questions
             FROM change_order co LEFT JOIN project p ON p.id = co.project_id
             -- The SAME join the company feed uses, imported rather than copied, so
             -- one extra names one person on both screens.
             LEFT JOIN ${CO_AUTHOR_JOIN} fa ON fa.subject_id = co.id AND fa.rn = 1
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
      // See the guided-start gate: it must distinguish "this account has nothing" from
      // "nothing has loaded yet", and only this line proves a real read completed.
      loadedRef.current = true;
      if (!loadedOnce) setLoadedOnce(true);
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
      // The Jobs list's per-job counts. Its own try inside refresh's: a failure here
      // must cost the cards their numbers, never the ledger this screen runs on.
      try { setJobCounts(await projectCoCounts(db)); } catch { /* cards show zeros */ }
      // Map snapshots, cached to disk. Not awaited into the refresh path: a slow or
      // failed image download must never hold up the ledger this screen runs on.
      void cachedMaps(process.env.EXPO_PUBLIC_STATIC_MAP_URL, ps)
        .then(setJobMaps).catch(() => {});
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

  /**
   * COMING BACK FROM PAYING IS THE MOMENT THE QUEUE MATTERS.
   *
   * The buy button hands him to Safari; the app is backgrounded while he pays and
   * foregrounded when he is done. That transition is the ONLY signal this app gets that a
   * web purchase happened — RevenueCat's grant lands server-side and nothing pushes it
   * here — so it is what makes "add more and it goes out on its own" true.
   *
   * Also runs on any other return to the app, which is deliberate and cheap: the drain
   * reads one balance and does nothing when nothing is waiting.
   */
  React.useEffect(() => {
    if (!ready) return;
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active') return;
      void drainHolds();
      // "When the app is OPENED after a CO was approved" — hadar's words, and the tick
      // alone would not honour them: its interval is suspended while backgrounded, so an
      // approval that landed overnight would wait up to 15 seconds for the confetti. This
      // is the one moment the popup was asked for; it should not be late to it.
      void checkCelebrations();
    });
    return () => sub.remove();
  }, [ready]);

  // Plan + ownership for the drawer. Keyed on OWNER (so it loads once the real user id
  // arrives after sign-in) and on menuOpen (so the plan box is current every time the
  // drawer is opened). Best-effort: a pre-migration/unsynced company reads free +
  // not-owner, the safe default (plan box hides the upgrade, Settings entry hidden).
  React.useEffect(() => {
    if (!ready) return;
    (async () => {
      try {
        setPlanId(await currentPlan(db));
        /**
         * Mint the billing tenant if this account has none — see company.ts. A
         * freelancer is a tenant of one, and without a row RevenueCat gets an anonymous
         * customer and every purchase buys nothing. Idempotent, and a no-op until the
         * profile has a name to call it by.
         */
        const prof = await getProfile(db);
        // The error is RECORDED, not swallowed. A tenant that fails to mint is the
        // difference between billing working and a purchase buying nothing, and a bare
        // `.catch(() => null)` made that invisible — which is how it stayed broken.
        try {
          await ensureBillingTenant(connector.client, db, {
            companyName: prof?.isSolo ? null : (prof?.company ?? null),
            personName: prof?.name ?? null,
          });
        } catch (e: any) {
          if (__DEV__) (globalThis as any).__tenantErr = String(e?.message ?? e);
        }
        // RE-KEY THE SDK. configureBilling ran at sign-in, possibly before any tenant
        // was known, and RevenueCat keeps whatever id it was configured with — an
        // anonymous one — until told otherwise. Without this the tenant is settled and
        // the purchase still attaches to nobody.
        const billTo = await billingTenantId(db, OWNER);
        if (billTo) await configureBilling(billTo);
        // Cache RevenueCat's verdict AFTER the SDK is keyed to the tenant — asking
        // before would return the anonymous customer's (empty) entitlements and cache
        // 'free' over a real subscription.
        const ent = await entitledPlanNow();
        if (ent) { await rememberEntitledPlan(db, ent); setPlanId(await currentPlan(db)); }
        // Which PRODUCT, not just which tier. Cached on every launch so a plan bought on
        // another device shows the right cycle here too.
        const prod = await entitledProductNow();
        if (prod) await rememberEntitledProduct(db, prod);
        setPaywallProduct(await currentProductId(db));
        // PRICES AND THE CHECKOUT ADDRESS. Never fails and never blocks: `loadPricing`
        // falls back to its cache and then to compiled-in numbers, so a paywall in a
        // basement shows last week's prices rather than nothing — the failure that makes
        // a contractor conclude the app is broken and not come back to find out.
        // CACHED FIRST so the rows are there before the network answers, then the real
        // answer — which can also REVOKE, unlike the sticky purchase flag next door.
        setDevUser(await cachedDeveloper(db));
        setDevUser(await refreshDeveloper(db, connector.client));
        setPricing(await loadPricing(db, connector.client));
        // THE BALANCE, and the side effect that matters: `refreshBalance` records
        // "this account has bought credits at some point", which is what retires the
        // trial's photo and recording caps offline (entitlement.ts). Without this read
        // a contractor who paid keeps a 30-photo limit until something else asks.
        setCredits(await refreshBalance(db, connector.client));
        // Anything left waiting on a credit from a previous run goes NOW, before he has
        // to ask. This is the launch half of "it goes out on its own"; the foreground
        // listener below is the return-from-paying half.
        void drainHolds();
        // SERVER FALLBACK, because the local tables are empty on a device whose sync
        // rules have never been deployed — and everything below is gated on this
        // answer, so an empty table silently deletes the Company row, the logo control
        // and the letterhead from the menu (hadar, 2026-08-17: "i cannot see the
        // company section").
        const co = await resolveMyCompany(db, connector.client, OWNER);
        setCompanies(await listMyCompanies(db, OWNER));
        setIsOwner(!!co?.isOwner);
        /**
         * A SOLO OPERATOR STILL HAS A LETTERHEAD.
         *
         * `hasTeam` used to gate the whole Company screen, on the reasoning that "solo
         * is not a company" and the screen was nothing but a roster. That reasoning
         * expired the moment the screen gained the letterhead: a one-man outfit's
         * business name, address and licence number are exactly what has to appear on
         * a change order — in most US states the licence is legally required — and
         * CLAUDE.md is explicit that the product must work for a solo operator, with
         * the office as a role and never a requirement.
         *
         * So the ENTRY is open to anyone who owns a tenant, and `hasTeam` now gates
         * only the roster INSIDE it, which is the part that genuinely needs a team.
         */
        setHasTeam(!!co && !prof?.isSolo);
        setCo(co ? { id: co.id, name: co.name } : null);
        /**
         * THE LOGO'S KEY, FROM SOMEWHERE THAT ACTUALLY HAS IT (hadar, 2026-08-19: "I
         * added a logo, everything worked, the logo showed. But when I close the app and
         * restart it the logo disappears").
         *
         * This read used to be `SELECT logo_key FROM company` alone, under a comment
         * asserting that "logo_key syncs down with the company row". THAT PREMISE IS
         * FALSE ON A REAL DEVICE — `company` is EMPTY locally (the PowerSync gap
         * documented in letterhead.ts and company.ts, and the reason `resolveMyCompany`
         * exists at all). So the key came back null on every launch, `ensureLogoCached`
         * was handed null, and the logo vanished until the next upload put it back in
         * memory. Uploading worked; REMEMBERING never did.
         *
         * Three sources, weakest network dependency first:
         *   1. the local row — right when sync is working, free when it is not there;
         *   2. the letterhead CACHE — written on every successful letterhead read and
         *      after every upload, so this is the one that answers on a warm device;
         *   3. the server — authoritative, and it repopulates the cache for next time.
         *
         * Offline with an empty cache the logo is simply absent for that launch, which is
         * honest: the bytes may not be on this device at all.
         */
        if (co) {
          const row = await db.getAll<{ logo_key: string | null }>(
            `SELECT logo_key FROM company WHERE id = ?`, [co.id]).catch(() => []);
          let k = row[0]?.logo_key ?? null;
          if (!k) k = (await cachedLetterhead(db))?.logoKey ?? null;
          if (!k) {
            try {
              const lh = await readLetterhead(connector.client, co.id);
              if (lh.ok) { k = lh.letterhead.logoKey; await cacheLetterhead(db, lh.letterhead); }
            } catch { /* offline: the cache above was the answer, and it had none */ }
          }
          setLogoKey(k);
          setLogoUri(await ensureLogoCached(connector.client, { companyId: co.id, logoKey: k }));
        } else { setLogoUri(null); setLogoKey(null); }
        // Usage rides the SAME refresh as the plan, on purpose: the two are read
        // together everywhere they are shown, and refreshing them separately is how
        // a drawer ends up displaying free-tier lines beside a paid plan name for a
        // frame. `quota` (the blocking decision) is deliberately not touched here.
        setUsage(await usageSummary(db, co?.id ?? null));
        // What a handover to another account would destroy — see the sign-out
        // confirmation in drawer.tsx. Read on the same trigger as the drawer's other
        // numbers so it is current every time the drawer is opened, and never counted
        // on a tick nobody is looking at. `inFlight` reports -1 when it could not
        // count, which must not be shown as a quantity.
        const f = await inFlight(db);
        setUnsentWork(f.queued < 0 ? null : f.queued + f.openDrafts);
      } catch { setPlanId('free'); setIsOwner(false); setUsage(null); setUnsentWork(null); }
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
      // Every app-owned table, in the one order that works — see ensureLocalSchema.
      // A device handover calls it again after the wipe.
      await ensureLocalSchema(db, OWNER);
      /**
       * NO LOCAL BACKFILL ANY MORE (sql/419). This numbered rows the device had not
       * uploaded, using the same `MAX+1` over local rows that made two offline phones
       * agree on "#4". The server's trigger numbers everything on insert and 419
       * numbered the existing rows in one pass; the hydrate brings those down.
       *
       * A row that has not reached the server yet therefore shows NO number, which is
       * what hadar asked for: "it cannot have a number until it reached the server and
       * the server gave it one."
       */
      // A SEPARATE sweep over a SEPARATE directory. recoverySweep empties capture-tmp
      // unconditionally, so draft media never lives there. Everything this sweep does
      // is in the direction of KEEPING bytes: adopt a file with no row, adopt a
      // directory with no draft.
      /**
       * NOT HERE ANY MORE — see the effect keyed on [ready, OWNER] below.
       *
       * This ran at init with `OWNER` still `OWNER_FALLBACK` ('owner-local'), because
       * `setOwner(s.user.id)` happens inside `applySessionNow`, ~300 lines further
       * down. `recoverableDrafts` filters `owner_id = ?`, so it asked for drafts
       * belonging to a placeholder and got none — every time, for every user.
       *
       * THE RECOVERY PROMPT HAS THEREFORE NEVER FIRED FOR A REAL DRAFT, which is a
       * capture-durability defect on its own: R1 exists so an interrupted walk is
       * offered back, and it was silently asking the wrong question. It surfaced only
       * because the handover refusal started counting the same drafts and hadar's
       * phone reported "unfinished recording 1" for something no screen would show him
       * (2026-08-21).
       *
       * `sweepDrafts` moved with it and that half matters more: it ADOPTS orphaned
       * media into draft rows owned by the id it is given, so running it with
       * 'owner-local' could mint drafts belonging to a user that does not exist —
       * unreachable by recovery and permanently blocking a handover.
       */

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
      /**
       * EVERY DEVICE ARRIVES HERE WITH A BACKLOG. `capture_pair` has been written on
       * every fused capture since it shipped and read by nothing but this phone, so
       * without a backfill the transport added in sql/418 would only ever cover
       * captures taken from now on — and most of a contractor's photos are already
       * behind him. Idempotent; costs one query once the queue has drained.
       */
      const bp = await backfillPairOutbox(db);
      if (bp.queued) console.log('backfill pairs:', JSON.stringify(bp));
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
      // BEFORE the first refresh(): listCaptures now excludes discarded captures
      // by subquery, and a missing table there would fail the whole gallery.
      const sl = await savedLang(db);
      // Restore the display language a returning user already chose. Language is now
      // part of the profile form, not a gate, so there's no separate "picked" flag.
      if (sl) { setLang(sl); setLangState(sl); }
      setFirstRun(await isFirstRun(db));
      setFirstExtra(!(await firstExtraSeen(db)));
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
      /** Guards `restoreFlags` to once per app run — see it for why. */
      let flagsRestored = false;
      /**
       * ASK THE SERVER THE MOMENT SOMEBODY SIGNS IN, not on the next quarter-minute.
       *
       * `drain` is created below and fired immediately — but that immediate call
       * happens at APP INIT, when a mid-run sign-in has not occurred yet and
       * `getUser()` returns nobody, so it does nothing and the interval takes over. A
       * user signing in after launch therefore waited up to 15 seconds for their first
       * hydrate, staring at a Home with nothing on it. Filled in after `drain` is
       * defined, because a direct reference from here would be a temporal-dead-zone
       * error at init time.
       */
      let kickSync: (() => void) | null = null;

      /**
       * WHOSE DEVICE IS THIS (hadar, 2026-08-21: signed out of one account, signed in
       * with another phone number, "at first it logged me in to the last known user on
       * the phone content").
       *
       * `signOut()` ends a session; it never emptied the device, and almost no local
       * read is owner-scoped — they filter by PROJECT, because a device having one user
       * was an assumption nothing enforced. So the second user got the first user's
       * jobs, photos, prices and clients. `claimDevice` is the enforcement: same user
       * back → untouched, different user → wiped before their first frame. The full
       * argument, including the loss this deliberately accepts, is in deviceowner.ts.
       *
       * IT RUNS BEFORE ANY OTHER SIGN-IN WORK, and that is the point — `setOwner`,
       * push registration, billing and `db.connect` all happen after the device is
       * known to be theirs, never beside it.
       */
      const claimFor = async (userId: string): Promise<boolean> => {
        // `onWipeStart` fires only when a wipe is actually about to happen, so the
        // ordinary sign-in never touches this and never flashes the splash. Cleared in
        // every branch below, including the refusal.
        const claim = await claimDevice(db, userId, { onWipeStart: () => setWiping(true) });

        /**
         * EVERY BRANCH IS LOGGED (§6(3)). That finding cost three sessions of
         * misdiagnosis precisely because the refusal reason was legible only to
         * somebody who thought to look at the device's own trail. The next identity
         * question should be answerable from the flight recorder alone.
         */
        const branch = 'failed' in claim ? `failed: ${claim.reason}`
          : 'refused' in claim ? `refused: ${claim.unsent} unsent`
          : claim.wiped ? 'purged' : 'bound';
        void logDiag(db, 'identity.switch', `${branch} → ${userId}`);

        if ('refused' in claim) {
          // DURABILITY WINS — nothing was deleted. See deviceowner.ts.
          setWiping(false);
          setSession(null);
          // BOTH surfaces: the ack for anyone already inside the app, and the notice
          // for the sign-in screen they are about to be returned to — which is where
          // this one is actually read, and where it was invisible.
          // The per-queue breakdown rides on the end of the sentence. It is not
          // translated and does not need to be: it is table names, and it exists so a
          // refusal nobody can resolve becomes one somebody can act on.
          const body = T({ k: 'handover.refusedBody',
                           p: { n: String(claim.unsent) } } as any)
            + (claim.where ? `\n\n(${claim.where})` : '');
          setAck({ kind: 'no', title: T('handover.refusedTitle'), detail: body });
          setAuthNotice({ title: T('handover.refusedTitle'), detail: body });
          await connector.signOut().catch(() => {});
          return false;
        }
        if ('failed' in claim) {
          setWiping(false);
          // REFUSE LOUDLY. Continuing here means signing somebody in over another
          // person's data, which is the defect itself — so the session goes instead.
          console.warn('[handover] refused:', claim.reason);
          const detail = `${T('handover.failedBody')}\n\n(${String(claim.reason).slice(0, 200)})`;
          setAck({ kind: 'no', title: T('handover.failedTitle'), detail });
          setAuthNotice({ title: T('handover.failedTitle'), detail });
          // Set explicitly rather than left to the SIGNED_OUT event: `signOut()` can
          // throw on a dead network, and a `session` stuck at `undefined` leaves the
          // app on the splash with no way forward.
          setSession(null);
          await connector.signOut().catch(() => {});
          return false;
        }
        setAuthNotice(null);   // a claim that got this far succeeded
        if (!claim.wiped) return true;
        console.log('[handover] device wiped, previous user', claim.previousUser);
        /**
         * ONLY THE SCHEMA REBUILD MAY ABORT A HANDOVER.
         *
         * Everything here used to sit in one try, so ANY throw — including a
         * cosmetic one from `refresh()` — signed the incoming user out. And
         * `refresh()` is the likeliest thing to throw at this exact moment:
         * `purgeLocalData` ends with `disconnectAndClear()`, PowerSync has not
         * reconnected yet (that happens a few lines later, once `connected` is
         * false), and `refresh()` reads `project` — a PowerSync-managed VIEW, not
         * one of the tables `ensureLocalSchema` rebuilds.
         *
         * The result was the worst state this path can reach and the one hadar hit
         * twice: the wipe SUCCEEDED, the device is empty, the new owner is already
         * recorded — and then he is bounced to the sign-in screen as though nothing
         * had happened (2026-08-21).
         *
         * So the split is by consequence. The schema is load-bearing: without it
         * every later query fails and signing out is right. Repainting is not — a
         * failed refresh costs a stale screen for one tick, and the next drain fixes
         * it. It must never cost a completed handover.
         */
        try {
          // The tables were DROPped by the purge. Nothing may read them until they are
          // back, so this is awaited before a single query runs.
          await ensureLocalSchema(db, userId);
        } catch (e: any) {
          // The wipe SUCCEEDED and the rebuild did not, so this device is now empty
          // and has no schema. It cannot be used, and pretending otherwise would put
          // the incoming user in front of an app whose every query throws. Sign out;
          // the next launch runs `ensureLocalSchema` from the top and repairs it.
          setWiping(false);
          const why = String(e?.message ?? e).slice(0, 200);
          console.warn('[handover] rebuild failed:', why);
          void logDiag(db, 'identity.switch', `rebuild failed: ${why}`);
          /**
           * THE REASON RIDES ALONG, and it is not decoration.
           *
           * This branch bounced hadar straight back to the sign-in screen with
           * "Could not set up this phone" and nothing else (2026-08-21) — after a
           * wipe that had already succeeded, so the device was empty AND he was
           * logged out, with no way for either of us to learn what threw. On a
           * Release build `diag_log` cannot be read off the device, so a generic
           * sentence here is the end of the trail.
           *
           * Untranslated and truncated: it is an exception message, shown because
           * the alternative is another build spent guessing.
           */
          const detail = `${T('handover.failedBody')}\n\n(${why})`;
          setAck({ kind: 'no', title: T('handover.failedTitle'), detail });
          setAuthNotice({ title: T('handover.failedTitle'), detail });
          setSession(null);
          await connector.signOut().catch(() => {});
          return false;
        }

        // THE HANDOVER IS DONE. Everything below is repainting, and every line of it
        // is best-effort: a failure here leaves a stale screen that the next drain
        // corrects, never a user locked out of a device that is already theirs.
        // PowerSync's own store was cleared too; let the connect below happen again.
        connected = false;
        // The flags went with the wipe. The incoming user's must be rebuilt from
        // THEIR account — a handover inside one app run must not inherit the
        // outgoing user's "already onboarded".
        flagsRestored = false;
        setSynced('unknown');
        // Re-read every list from the now-empty database rather than resetting ~20
        // pieces of state by hand: a hand-written reset list is one `useState` away
        // from leaving the previous user's row on screen, which is the bug.
        setDrafts([]);
        setLogoUri(null); setLogoKey(null);
        setProjectId(INBOX_ID);
        try {
          await refresh();
          setFirstRun(await isFirstRun(db));
          setFirstExtra(!(await firstExtraSeen(db)));
          setHasProfile(await hasProfileFn(db));
        } catch (e: any) {
          // Reported, never fatal, and never swallowed silently — this is the branch
          // that used to sign people out.
          const why = String(e?.message ?? e).slice(0, 160);
          console.warn('[handover] repaint failed:', why);
          void logDiag(db, 'identity.switch', `repaint failed: ${why}`);
        }

        setWiping(false);
        setAck({ kind: 'ok', title: T('handover.wipedTitle'),
                 detail: T('handover.wipedBody') });
        return true;
      };

      /**
       * "AM I A NEW USER?" IS A QUESTION ABOUT THE ACCOUNT, NOT ABOUT THIS PHONE.
       *
       * hadar, 2026-08-21: reinstalled, signed in as an existing user, and was walked
       * through setup and the guided first change order "although I have many CO".
       *
       * `profile_done`, `first_run_done` and `first_extra_seen` all live in
       * `device_settings`, so a reinstall — or the handover wipe above — takes them
       * with it, and a contractor with sixty extras is greeted as somebody who has
       * never made one. `restoreAccountFlags` rebuilds them from the account: the
       * profile out of `user_metadata` (free, offline, already in the token), and the
       * first-run gates out of whether the account demonstrably owns anything.
       *
       * ONCE PER APP RUN, via the same latch pattern as `connected`. A token refresh
       * re-enters this function, and re-running it would re-ask the server — and
       * worse, could interrupt somebody standing in the middle of the setup form.
       */
      const restoreFlags = async (u: NonNullable<Session['user']>) => {
        if (flagsRestored) return;
        flagsRestored = true;
        // NOTHING TO RECONCILE on a device that has already been through setup — and
        // this is what keeps the common cold start free of it. Every branch below
        // reads local state only.
        if (!(await isFirstRun(db)) && (await hasProfileFn(db)) && (await firstExtraSeen(db))) {
          return;
        }
        try {
          const r = await restoreAccountFlags(db, connector.client, u);
          void logDiag(db, 'flags.restore',
            `profile=${r.profile} content=${r.content} offline=${r.offline}`);
        } catch (e: any) {
          // A failed reconciliation shows setup to someone who did not need it —
          // annoying, and strictly better than skipping setup for someone who did.
          console.warn('[flags] restore failed:', e?.message ?? e);
        }
        setFirstRun(await isFirstRun(db));
        setFirstExtra(!(await firstExtraSeen(db)));
        setHasProfile(await hasProfileFn(db));
        // The account may have carried a display language back with the profile.
        const l = await savedLang(db);
        if (l) { setLang(l); setLangState(l); }
      };

      const applySessionNow = async (s: Session | null) => {
        if (s?.user?.id) {
          /**
           * A THROW BELOW MUST NOT STRAND THE APP ON THE SPLASH.
           *
           * `setSession` moved AFTER `claimFor`/`restoreFlags` so the auth gate cannot
           * open on the outgoing user's data. The cost is that anything throwing in
           * between leaves `session` at `undefined` — which renders `<SplashScreen/>`
           * with no message and no way forward, because `applySession`'s catch only
           * console.warns. The old ordering could not produce that; this one can.
           *
           * So the two guarded steps run inside a try that, on any unexpected failure,
           * still admits the session. Signing somebody in to a device that may be
           * mid-repair is bad; leaving them staring at a splash forever is worse, and
           * the claim's OWN refusal paths (which return false) are unaffected — they
           * sign out deliberately and say why.
           */
          // THE CLAIM COMES BEFORE `setSession`, and that is the difference between
          // fixing this bug and merely shortening it: `setSession` is what opens the
          // auth gate, so setting it first would paint the whole app — the previous
          // user's jobs, extras and photos — for the frames before the wipe starts.
          // hadar saw exactly that: "at first it logged me in to the last known user".
          try {
            if (!(await claimFor(s.user.id))) return;
            // ALSO BEFORE `setSession`, and for the same reason: this decides whether
            // the setup flow and the guided first-extra screen render at all, so it
            // has to have answered before the auth gate opens. `session === undefined`
            // (or the auth screen, mid-run) is already on screen while it works.
            await restoreFlags(s.user);
          } catch (e: any) {
            const why = String(e?.message ?? e).slice(0, 160);
            console.warn('[session] claim/flags threw, signing in anyway:', why);
            void logDiag(db, 'identity.switch', `unexpected: ${why}`);
            setWiping(false);   // never leave the splash gate latched
          }
          setSession(s);
          setOwner(s.user.id);
          // REQ-NOTIF1 — register this device for remote push, best-effort.
          void registerPushToken(connector.client, s.user.id);
          // Billing identity is the COMPANY, not the user — the owner pays and crew
          // inherit it, so the receipt must follow the company. Best-effort and
          // non-blocking: with no RevenueCat key this no-ops and the paywall keeps
          // its "coming soon" state. myCompany() reads synced tables, so it may be
          // null on a cold first run; configureBilling runs again on the next session
          // event once membership has synced down.
          // billingTenantId(), not myCompany(): the synced `company` table can be empty
          // while a real tenant exists server-side, and keying RevenueCat off an empty
          // cache is what made purchases attach to an anonymous customer and buy
          // nothing. The remembered id is the server's own answer.
          void billingTenantId(db, s.user.id)
            .then((id) => configureBilling(id))
            .catch(() => {});
          // connect() is fire-and-forget: offline is the NORMAL case for this
          // product, not an error, and PowerSync retries internally. Once per app
          // run -- a token refresh must not stack another connection.
          if (!connected) {
            connected = true;
            db.connect(connector).catch((e) =>
              console.log('sync will connect when there is signal', e?.message ?? e));
          }
          // Their extras, now — not in fifteen seconds. Home shows "Getting your work"
          // until this answers, so the wait is visible and every second of it counts.
          kickSync?.();
        } else {
          setSession(s);
          /**
           * SIGNED OUT. Two things that used to survive it, and both were wrong.
           *
           * `connected` latched true for the life of the app run, so the `if
           * (!connected)` above — written to stop a token REFRESH stacking a second
           * connection — also stopped the next sign-in from connecting at all. A
           * second user on the same app run got no sync, which reads as "nothing ever
           * uploads" and is invisible until somebody looks at the server.
           *
           * And PowerSync itself stayed connected, streaming the departed user's
           * buckets into a device nobody is signed in to.
           */
          connected = false;
          // The NEXT person to sign in on this run is a different account until proven
          // otherwise, and their onboarding flags have to be reconciled against THEIR
          // content — not skipped because the departing user's already were.
          flagsRestored = false;
          // Nothing is known about the next account's extras until its own hydrate runs.
          setSynced('unknown');
          db.disconnect().catch((e) =>
            console.log('disconnect on sign-out failed', e?.message ?? e));
        }
      };

      /**
       * SERIALISED, because these can overlap and the handover must not run twice.
       * The stored-session path fires `applySession(stored)` and then, when the token
       * refresh lands, `applySession(fresh)` — two async claims that could both read
       * "the last user was A" before either records B. Chaining makes the second see
       * what the first wrote, which is the whole basis of `claimDevice`'s decision.
       */
      let sessionWork: Promise<void> = Promise.resolve();
      const applySession = (s: Session | null): Promise<void> => {
        sessionWork = sessionWork
          .then(() => applySessionNow(s))
          .catch((e) => console.warn('session apply failed', e?.message ?? e));
        return sessionWork;
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
        // NOT awaited, deliberately — that is what keeps first paint off the network.
        // The handover inside it is; see `applySession`'s chain.
        void applySession(stored);
        void sessionPromise.then((fresh) => { if (fresh) void applySession(fresh); });
      } else {
        await applySession(await sessionPromise);
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
          /**
           * AND PULL THE ROSTER BACK DOWN — the half that was never built (Codex
           * cross-model review 2026-08-22, P0).
           *
           * The comment directly above says an outbox nothing drains is a queue that
           * looks like sync. This is the same sentence one step further on: an outbox
           * that only ever UPLOADS is a queue that looks like sync too. R5c has pushed
           * every client to Postgres for weeks — 30 rows are there — and no code path
           * in the app has ever read one back, so every device that did not type the
           * client in had an empty roster and every handover destroyed the lot.
           *
           * AFTER the drain, deliberately and for the same reason the supersession
           * push runs before its hydrate: a row still queued here is a local intent
           * the server has not seen, and pulling first would let the server's older
           * answer land on top of it.
           *
           * ACCOUNT-WIDE (null), not the current project: Home and the send sheet
           * both reach across jobs, and a project-scoped pull would leave every other
           * jobsite's clients missing on a second device — the same mistake
           * `hydrateChangeOrders` records having made.
           */
          const rh = await hydrateApprovers(db, connector.client, null);
          if (rh.pulled || rh.updated) console.log('hydrate roster:', JSON.stringify(rh));
          // BEFORE the hydrate below, deliberately: a supersession the server has not
          // accepted yet is a local intent hydrateChangeOrders cannot see.
          const sx = await drainSupersessions(db, connector.client);
          if (sx.attempted) console.log('drain supersessions:', JSON.stringify(sx));
          // R5b. The PULL is the half that did not exist: without it a question the
          // client asked is stored server-side and invisible to the contractor
          // forever. The drain carries his replies back out.
          const br = await drainR5bOutbox(db, connector.client, data.user.id);
          if (br.attempted) console.log('drain r5b:', JSON.stringify(br));
          /**
           * MESSAGE PHOTOS. On the drain, not only after a reply (fixed 2026-08-13,
           * found by review).
           *
           * `publishReplyMedia` had exactly one caller — immediately after a successful
           * `postReply` — so a photo attached in a basement uploaded once, failed, and
           * then waited for the contractor to happen to post ANOTHER reply while online.
           * Its own header promised "the next refresh tries again"; there was no such
           * pass. The bubble said "on this phone only" and told the truth indefinitely.
           */
          const rm = await publishReplyMedia(db, connector.client, { ownerId: data.user.id });
          if (rm.published || rm.failed.length) console.log('drain reply media:', JSON.stringify(rm));
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
          /**
           * `pushCoNumbers` IS GONE, and it was mine from this morning.
           *
           * It uploaded the number the DEVICE minted, which fixed the symptom hadar
           * reported (20 server rows, 0 numbers) by entrenching the cause: a phone
           * that cannot see every extra on a job was still the thing deciding the
           * identifier. sql/419 moved assignment to the server, so pushing a local
           * guess is now actively wrong — it would race the trigger and could win.
           * The hydrate brings the number DOWN; nothing sends one up.
           */
          // ACCOUNT-WIDE (null), not `pid`. Home reads change orders with no project
          // filter, so a project-scoped pull made `synced` answer a different question
          // from the one the screen asks — and left every other job's extras
          // unhydrated on a second device. See hydrateChangeOrders.
          const hy = await hydrateChangeOrders(db, connector.client, null, data.user.id);
          /**
           * THE EVIDENCE BEHIND THE EXTRAS (hadar, 2026-08-21: "images not displaying
           * in the records" after signing in as another user).
           *
           * The extras synced; nothing behind them did. `decision`, `decision_version`
           * and the captures they point at are all written by the capturing device and
           * were never pulled back, so a second phone got the change orders and an
           * empty evidence graph — no versions, no capture ids, no photos.
           *
           * AFTER the change-order hydrate, deliberately: this pulls by decision, and
           * the extras are what say which decisions matter on this job.
           */
          // The server answered, or it did not. Either way Home stops guessing.
          setSynced((prev) => (hy.ok ? 'yes' : prev === 'yes' ? 'yes' : 'unreachable'));
          /**
           * THE PAIR LINK — what ties a walkthrough's photos to what was said.
           * Without it a second device reaches only the ANCHOR capture of each extra,
           * which on hadar's account was 4 photos out of 102.
           */
          const pd = await drainPairOutbox(db, connector.client);
          if (pd.attempted) console.log('drain pairs:', JSON.stringify(pd));
          const ph = await hydratePairs(db, connector.client, null);
          if (ph.pulled) { console.log('hydrate pairs:', JSON.stringify(ph)); await refresh(); }
          /**
           * ACCOUNT-WIDE, like the two hydrates above it (code review, 2026-08-23).
           *
           * `pid` is `projectIdRef.current`, which is INBOX_ID until a job has been
           * opened — and a device that has just signed in has opened none. Passing it
           * scoped the pull to a project that owns nothing, so the evidence graph this
           * whole path exists to restore stayed empty on precisely the device the bug
           * was reported from. Same argument, same fix, same `null`.
           */
          const ev = await hydrateEvidence(db, connector.client, null, data.user.id);
          if (ev.decisions || ev.versions || ev.captures) {
            console.log('hydrate evidence:', JSON.stringify(ev));
          }
          /**
           * THE ADDENDA AN EDIT STILL OWES. `finishAugmentById` used to read the cloud
           * proposal once and give up forever if it had not landed yet; this is the
           * retry that makes "the description still grows" a true statement instead of
           * an assumption. Bounded to a day inside the module. See augmentretry.ts.
           */
          const ra = await retryPendingAugments(db, {
            nowMs: Date.now(),
            fetchProposal: (ids) => fetchLatestProposalForCaptures(connector.client, ids),
            append: async (coId, text) => { await appendAugmentDesc(db, coId, text); },
          }).catch(() => ({ appended: 0, stillPending: 0 }));
          if (ra.appended) {
            console.log('augment addenda applied late:', JSON.stringify(ra));
            await refresh();
          }
          // Then the bytes, a bounded batch per tick — photos only, because photos are
          // what the cards and the record screen draw. See cacheMirroredPhotos.
          // Unscoped for the same reason as the hydrate above: a mirror row this device
          // pulled account-wide must not be filtered out of the download by INBOX_ID.
          const mm = await cacheMirroredPhotos(db, connector.client, {});
          if (mm.downloaded || mm.failed) {
            console.log('mirror media:', JSON.stringify(mm));
            if (mm.downloaded) await refresh();
          }
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
          // BEFORE runNotifications, which STAMPS these rows as notified — after it the
          // list is empty and the banner would never fire.
          await checkClientMessages();
          const nt = await runNotifications(db, pid);
          if (nt.presented || nt.blocked) console.log('notify:', JSON.stringify(nt));
          // THE CELEBRATION, last of all and for the same reason the push is second-last:
          // there is nothing to celebrate until the green light is actually local. It runs
          // on the tick rather than only at launch because an approval that lands while he
          // is looking at the app is the BEST case — he sees the confetti the moment the
          // client signs, not the next time he opens it.
          await checkCelebrations();
          // AFTER the celebration: a signature is better news than an empty draft, and
          // two sheets competing for the same moment should resolve in that order.
          await checkSilentExtras();
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
      // Wired now that `drain` exists — see `kickSync` above.
      kickSync = () => { void drain(); };
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
      if (!terms) { setUi({ k: 'idle' }); void gateTerms(() => { /* re-tap to record */ }); return; }
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
          /**
           * WHO RAISED IT (hadar, 2026-08-19: "new CO created, in the record list the
           * person created it doesn't show up — we should have the creator displayed").
           *
           * `CO_AUTHOR_JOIN` names the EARLIEST actor on the change order, and until now
           * nothing wrote one at CREATION: the acts were written when an extra was
           * PRICED and when it was SENT. So an extra born from a recording had no author
           * row at all and every list showing a person left it blank — while one typed
           * through the priced path got a name immediately, which is why the two looked
           * inconsistent.
           *
           * 'captured' is already in the ActorAct vocabulary and is exactly this fact.
           * Writing it here rather than inside `startExtraFromCapture` keeps that module
           * free of the profile read, and matches where every other noteActorNow call
           * lives — beside the act it records.
           *
           * NOT AWAITED BEFORE `refresh()` on purpose is NOT the rule here: the row must
           * exist before the list re-reads, or the first paint is blank and only corrects
           * on the next tick. It is inside the same `.then` as refresh and precedes it.
           */
          await noteActorNow(db, {
            subjectKind: 'change_order', subjectId: x.changeOrderId, act: 'captured' });
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
    /**
     * THE FIRST STEP SHOWS IMMEDIATELY; THE COMMIT RUNS BEHIND IT
     * (hadar, 2026-08-23: "there is no need for that splash screen -- display the
     * first step right away, if it is new CO then it will be choose the location
     * followed by the homeowner").
     *
     * The job picker needs nothing the commit produces: the GPS fix, the preview
     * thumbnails and the duration all come off `a`, which is in hand the moment the
     * capture screen hands over. Only FILING needs the capture ids, and filing happens
     * after he taps a job. So the sheet no longer waits for two seconds of hashing and
     * disk writes to finish before it will draw.
     *
     * THE ORDER MANDATE #1 REQUIRES IS UNCHANGED. The bytes still commit durably before
     * anything is uploaded or filed, and they commit to the RESOLVED job — Inbox when
     * GPS is unsure — exactly as before. What changed is only what is on screen while
     * that happens. `fileWalkTo` awaits `ready` before it files anything, so a tap that
     * lands early waits for durability rather than racing it.
     *
     * The baking that the capture screen's opaque overlay exists to hide is already
     * FINISHED by the time this runs — `finish()` bakes every photo before it calls
     * `onCapture` — so nothing is exposed by handing the screen over here.
     */
    const commit = (async () => {
      const res = await resolveFor(a.stamp);
      const pairId = `pair-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const ids: string[] = [];
      for (const ph of a.photos) {
        const pr = await performCapture(db, {
          ownerId: OWNER, projectId: res.projectId,
          input: photoCapture(ph.bytes, ph.mime),
          stamp: { ...a.stamp, capturedAtMs: ph.atMs },   // each photo's own snap time
        });
        if (!pr.ok) throw new Error(pr.reason);
        await linkPair(db, pairId, pr.captureId, 'photo', ph.atMs);
        // …and queue it for the server, or the link lives on this phone only — which
        // is how 98 of 102 photos became unreachable from any other device.
        await enqueuePair(db, { pairId, captureId: pr.captureId, role: 'photo',
                                atMs: ph.atMs, projectId: res.projectId });
        await noteCapturedBy(db, pr.captureId);
        ids.push(pr.captureId);
      }
      /**
       * WHAT HE TYPED, committed as a capture of its own (REQ-CAP2 text modality).
       *
       * hadar, 2026-09-02: "you can talk -- or you can write (up to you)." Writing has
       * to produce evidence the same way talking does, or the two inputs are not
       * equals — one becomes a real capture and the other a UI nicety that vanishes.
       *
       * FIRST, BEFORE THE AUDIO, deliberately: it is the smallest and the most certain
       * to succeed, and mandate #1 wants the cheapest durable thing written earliest. A
       * later audio failure refuses loudly without un-saving these words.
       */
      if (a.typedText) {
        const tr = await performCapture(db, {
          ownerId: OWNER, projectId: res.projectId,
          input: textCapture(a.typedText),
          stamp: a.stamp,
        });
        if (!tr.ok) throw new Error(tr.reason);
        await noteCapturedBy(db, tr.captureId);
        ids.push(tr.captureId);
      }
      // The narration, possibly split by a phone call: every segment commits, in order.
      // A failed later segment refuses loudly but never un-saves the earlier ones.
      for (const seg of a.audioSegments) {
        const vr = await performCapture(db, {
          ownerId: OWNER, projectId: res.projectId,
          input: voiceCapture(seg.bytes, seg.mime),
          stamp: { ...a.stamp, capturedAtMs: seg.startedAtMs },
        });
        if (!vr.ok) throw new Error(`some saved; audio did not: ${vr.reason}`);
        await linkPair(db, pairId, vr.captureId, 'voice', seg.startedAtMs);
        await enqueuePair(db, { pairId, captureId: vr.captureId, role: 'voice',
                                atMs: seg.startedAtMs, projectId: res.projectId });
        await noteCapturedBy(db, vr.captureId);
        ids.push(vr.captureId);
      }
      if (!ids.length) throw new Error('nothing to save');
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
        // Same fact, the fused path — see the voice path above for why it is here.
        await noteActorNow(db, {
          subjectKind: 'change_order', subjectId: x.changeOrderId, act: 'captured' });
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
      return {
        ids,
        anchorCoId: anchorCapId ? `co-${anchorCapId}` : `co-${ids[0]}`,
        anchorCaptureId: anchorCapId,
      };
    })();

    // A REFUSAL MUST STILL REACH HIM, and now it has to travel further: the sheet is
    // already up, so the failure takes it down again rather than appearing behind it.
    commit.catch((e: any) => {
      setAssign(null); setHereAddr(undefined); hereAddrKey.current = null;
      setUi({ k: 'refused', why: e?.message ?? String(e) });
    });

    // CLEARED BEFORE THE PICKER OPENS, not after it closes: this walk has its own fix,
    // and showing the last walk's street under "Pre-filled with" would be a promise
    // about the wrong address.
    setHereAddr(undefined); hereAddrKey.current = null;
    setAssign({
      ready: commit,
      lat: a.stamp.lat, lng: a.stamp.lng,
      uris: a.previewUris, secs: a.durationSecs,
    });
    setShowCapture(false);
    // Not awaited into the hand-over: the sheet is drawn, and Home behind it can catch
    // up whenever the write finishes.
    void commit.then(() => refresh()).catch(() => { /* already surfaced above */ });
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
          await enqueuePair(db, { pairId, captureId: an.capture_id,
                                  role: an.modality === 'photo' ? 'photo' : 'voice',
                                  atMs: Date.now(), projectId: co.project_id });
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
        // …and queue it for the server, or the link lives on this phone only — which
        // is how 98 of 102 photos became unreachable from any other device.
        await enqueuePair(db, { pairId, captureId: pr.captureId, role: 'photo',
                                atMs: ph.atMs, projectId: co.project_id });
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
        await enqueuePair(db, { pairId, captureId: vr.captureId, role: 'voice',
                                atMs: seg.startedAtMs, projectId: co.project_id });
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
        photoDone: 0, photoTotal: 0, voiceDone: 0, voiceTotal: 0,
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
        <Text style={s.h}>EZChangeOrders</Text>
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
  // THE SPLASH FLOOR, ahead of every other gate — including the fixtures, so a
  // fixture build opens the same way the real app does. Boot continues underneath.
  if (splashHeld) return <SplashScreen />;

  if (process.env.EXPO_PUBLIC_FIXTURE === '1') return <FixtureDraft />;
  if (process.env.EXPO_PUBLIC_FIXTURE === '2') return <FixtureNegotiation />;
  if (process.env.EXPO_PUBLIC_FIXTURE === '3') return <FixtureLocked />;

  // DEV override: above every other branch, so it wins from any screen and any state.
  /**
   * THE ONE WAY INTO THE GUIDED FLOW.
   *
   * It was written THREE times — the dev override, the coach's button and the intro's
   * button — and the copies disagreed. Only one ever set `guidedOn`, so the whole
   * journey (the recorder's prompt strip, the read-back, the gaps, the review, the sent
   * screen) was dead for real users; and only one carried the signed-out guard, so the
   * other two offered a button that silently bounced. Review found the first on
   * 2026-08-13 and I fixed two of the three, which is how the third survived. It is one
   * function now, and there is nowhere left for a fourth to hide.
   */
  const enterGuided = () => {
    // A capture is filed to an account. There is no version of this that records while
    // signed out, so say that rather than setting state nothing downstream can honour.
    if (session === null) {
      setAck({ kind: 'no', title: T('gf.needSignIn'), detail: T('gf.needSignInWhy') });
      return;
    }
    setForceFirstExtra(false); setGuided(null);
    setGuidedOn(true);
    // The SAME consent gate every capture button passes through. Deliberately does NOT
    // mark the walkthrough seen — backing out of the recorder lands here again, which is
    // the honest place to land when nothing was created.
    void gateTerms(() => setShowCapture(true));
  };

  // `devTools`, not `__DEV__`: the drawer row that sets `forceFirstExtra` is now visible
  // to a flagged user on a release build, and a row that sets a flag nothing reads is a
  // button that does nothing.
  if (devTools && forceFirstExtra) {
    return guided === 'coach'
      ? <GuidedCoach onStart={enterGuided} onBack={() => setGuided('intro')} />
      : (
        <FirstExtra
          onCoach={() => setGuided('coach')}
          onStart={enterGuided}
          onLater={() => { setForceFirstExtra(false); setGuided(null); }}
        />
      );
  }

  if (devTools && forceIntro) {
    // Carries the intent like the real path does. Without this the dev override was the
    // ONE way in that ignored which button was pressed — so testing "Log in" through it
    // would always have landed on sign-up and looked like the routing was broken.
    return (
      <Onboarding onDone={(intent) => {
        setAuthIntent(intent ?? 'signup');
        setForceIntro(false);
      }} />
    );
  }

  /**
   * MID-HANDOVER. `claimDevice` DROPs every app-owned table, and for the moment
   * between the drop and `ensureLocalSchema` putting them back there is nothing to
   * query — so nothing may try. Every render below reads the database, and letting
   * them run against dropped tables would paint the outgoing user's screen full of
   * caught errors on the way to emptying it.
   *
   * BEFORE the `session === undefined` gate, because by this point the incoming user
   * has a perfectly good session; what they do not yet have is a device.
   */
  if (wiping) return <SplashScreen />;

  if (ready && !initError) {
    if (session === undefined) return <SplashScreen />;
    if (session === null) {
      if (!seenOnboarding) {
        return (
          <Onboarding onDone={(intent) => {
            // Remembered so the landing page shows ONCE, and the intent is carried into
            // the form so "Log in" opens the log-in form rather than sign-up.
            setAuthIntent(intent ?? 'signup');
            void setSeenOnboarding();
            setSeen(true);
          }} />
        );
      }
      return (
        <AuthScreen
          connector={connector}
          notice={authNotice}
          initialSignUp={authIntent !== 'login'}
          onReplayIntro={() => { void forgetSeenOnboarding(); setSeen(false); }}
        />
      );
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
    if (step === 'done') {
      // No celebration screen. They came here to create an extra.
      void markFirstRunDone(db).then(() => setFirstRun(false));
      return <SplashScreen />;
    }

    /**
     * THE THREE SETUP SCREENS (hadar 2026-08-19, from the mockups) — language, then
     * who you are, then what the app does. They live in `ui/setupflow.tsx`; this is
     * only the wiring, because the state they edit (`pName`, `pWork`, `pCompany`,
     * `lang`) is owned here and threading it out is the whole job.
     *
     * The old two-step green form is gone, and with it the trade grid: asking a
     * stranger to classify his business before he has seen the app do anything is a
     * question posed at the worst possible moment. Settings still collects it.
     */
    if (step === 'profile') {
      const saveAndGo = async () => {
        await saveProfile(connector, db, {
          name: pName, isSolo: pWork === 'solo',
          // 'invited' carries a company name too — the REAL one, as the server returned
          // it from the join below, not something this person typed. That is what puts
          // his employer on the letterhead instead of a blank.
          company: pWork === 'solo' ? null : pCompany,
          trade: null,   // asked later, in Settings — see setupflow.tsx header
        // The language picked one screen earlier travels with the account, so a
        // reinstall does not put a Spanish speaker back into English.
        }, lang);
        setHasProfile(true);
      };

      /**
       * LEAVING THE "WHO" SCREEN — and, for an invited crew member, JOINING FROM IT.
       *
       * The join happens HERE rather than after setup, and the ordering is the whole
       * fix. `ensureBillingTenant` is a no-op until a profile has a name, and the
       * profile is not saved until `saveAndGo` two screens later — so a membership
       * created now is already in place when the mint finally runs, and
       * `ensure_billing_tenant` returns THAT instead of creating a company of this
       * person's own. No ghost tenant, nothing to switch away from afterwards.
       *
       * A REFUSED CODE KEEPS HIM ON THIS SCREEN. Advancing on failure would strand him
       * in exactly the state this option exists to prevent, and he would have no idea
       * it had happened — the whole reason the old flow was a trap.
       */
      const leaveWho = async () => {
        if (pWork !== 'invited') { setPSub('how'); return; }
        setPJoining(true); setPInviteErr(null);
        const r = await acceptInvite(db, connector.client, pInvite, pName);
        setPJoining(false);
        if (!r.ok) {
          // Msg when recognised, raw string otherwise — joinRefusal in company.ts.
          setPInviteErr(T('set.joinFailed') + ' '
            + (typeof r.reason === 'string' ? r.reason : T(r.reason)));
          return;
        }
        // The name comes back from the server; it is the one that goes on documents.
        setPCompany(r.companyName);
        setPSub('how');
      };

      if (pSub === 'lang') {
        return (
          <StepLanguage lang={lang} art={SETUP_ART.lang}
            onLang={async (l) => { setLang(l); setLangState(l); await saveLang(db, l); }}
            onContinue={() => setPSub('who')} />
        );
      }

      if (pSub === 'who') {
        return (
          <StepProfile art={SETUP_ART.setup}
            name={pName} onName={setPName}
            work={pWork} onWork={(w) => { setPWork(w); setPInviteErr(null); }}
            company={pCompany} onCompany={setPCompany}
            invite={pInvite} onInvite={(v) => { setPInvite(v); setPInviteErr(null); }}
            inviteError={pInviteErr} joining={pJoining}
            onContinue={() => void leaveWho()} />
        );
      }

      /**
       * ONE exit, deliberately. The updated mockups dropped the "Maybe later" this
       * screen used to carry, and that is right: saving here hands off to the
       * `FirstExtra` screen below, which ALREADY offers a later. Two escape hatches
       * one tap apart is just a second chance to leave.
       *
       * Note what this does NOT do — mark the walkthrough seen. That would skip the
       * very thing the button promises.
       */
      return (
        <StepHowItWorks art={SETUP_ART.capture}
          onCreateFirst={() => void saveAndGo()} />
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
        <Text style={s.h}>EZChangeOrders</Text>
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
      // From a CAP he just hit, not from the menu — back belongs on the screen he was
      // working on, not in a drawer he never opened.
      onSeePlans={() => { setQuota(null); void openPaywall('screen'); }} />
  ) : null;

  /**
   * "Saved — waiting to send." Mounted next to quotaEl and for the same structural
   * reason: a RN <Modal> has to sit in the mounted subtree, and the screens below are
   * early returns.
   *
   * ─── WHY THE BUY BUTTON LEAVES THE APP ──────────────────────────────────────────
   * `purchaseUrl` is a RevenueCat Web Purchase Link, and a purchase made there carries no
   * Apple commission (0% on external links in the US today) against 15% through IAP. That
   * is the whole point of the model hadar chose on 2026-08-17: "avoid apple tax as much as
   * we can". `co.id` is appended because it is the same App User ID `billing.ts` gives the
   * SDK — without it the money attaches to an anonymous customer and buys nothing.
   *
   * Null URL = NO BUTTON. Not a disabled one, not one that opens the IAP paywall instead:
   * the message about his change order is true either way, and a dead checkout is the one
   * failure that costs real money.
   */
  /**
   * "APPROVED!" — the popup, over whatever screen he is on.
   *
   * ONLY THE HEAD of the queue renders. Three approvals waiting produce three
   * celebrations in sequence, not three stacked modals: each is a distinct piece of good
   * news and deserves its own moment, and the count of what is still behind it is on the
   * card so nothing is hidden.
   *
   * BOTH BUTTONS STAMP IT. Following the link is as much "he has seen it" as dismissing
   * is — more so. Leaving the stamp to the dismiss button alone would re-throw confetti
   * for a change order he is already reading.
   */
  const celebrateEl = celebrations.length ? (() => {
    const c = celebrations[0];
    const seen = async () => {
      await markCelebrated(db, c.changeOrderId);
      await checkCelebrations();
    };
    return (
      <ApprovedCelebration
        projectName={c.projectName}
        description={celebrationDescription(c)}
        // Built here, not in the component: the component holds no copy, and `money` is
        // this app's ONE formatter (changeorder.ts). A second one would eventually
        // disagree with the ledger about a figure on a signed record.
        detail={T(celebrationLine(c, money) as any)}
        more={celebrations.length - 1}
        onOpen={() => {
          void seen();
          // The job FIRST, then the record — the same order the company feed uses, and
          // the reason it is needed: an approval on another jobsite is still celebrated
          // here, and `openRecord` alone would land him on a record beside the wrong
          // job's ledger.
          if (c.projectId !== projectId) setProjectId(c.projectId);
          setNav('project');
          void openRecord(c.changeOrderId);
        }}
        onClose={() => { void seen(); }} />
    );
  })() : null;

  /**
   * The client-message banner, over whatever screen he is on.
   *
   * Mounted alongside the modals for the same structural reason, but it is NOT a Modal —
   * it is an absolutely-positioned layer, so it floats over the screen without taking the
   * touch surface with it. A Modal here would block the app for six seconds.
   */
  /**
   * "Nothing was said in that recording" — over whatever screen he is on.
   *
   * BOTH ACTIONS REUSE THE EXISTING ONES rather than reimplementing them: `augmentExtra`
   * is the same function the FAB and the Add-photo tile use (it checks terms, cancels the
   * feed return, and files the capture onto THIS extra), and the write path opens the
   * same description editor as the record screen. A second copy of either would be a
   * second place for the capture to land on the wrong extra.
   *
   * THE STAMP IS WRITTEN ON EVERY EXIT, including both actions — he has been told, and
   * being told twice about a recording he has already decided to fix is the thing that
   * makes people dismiss sheets unread.
   */
  const silentEl = silent ? (() => {
    const seen = async () => {
      await markSilentNoticeShown(db, silent.changeOrderId);
      setSilent(null);
    };
    return (
      <SilentNoticeSheet
        scope={silent.scope}
        photos={silent.photos}
        onRecordAgain={() => { void seen(); augmentExtra(silent.changeOrderId); }}
        onWriteItMyself={() => {
          void seen();
          if (silent.projectId !== projectId) setProjectId(silent.projectId);
          void openRecord(silent.changeOrderId).then(() => setDetail((d) =>
            d ?? { field: 'scope', scope: '', rewrite: { phase: 'idle' } } as any));
        }}
        onClose={() => { void seen(); }} />
    );
  })() : null;

  const msgToastEl = msgToast ? (
    <MessageToast
      // The person, when the roster knows them. `who_directed` is who the extra was for,
      // which is the client on the other end of this thread.
      from={coRowsRef.current.find((c) => c.id === msgToast.changeOrderId)?.who_directed ?? null}
      scope={msgToast.scope}
      body={msgToast.body}
      onOpen={() => {
        setMsgToast(null);
        // The record, wherever it lives. `openRecord` loads by id and is not scoped to
        // the open job, so a question on another jobsite still lands on its own thread.
        void openRecord(msgToast.changeOrderId);
      }}
      onDismiss={() => setMsgToast(null)} />
  ) : null;

  /**
   * THE OFFLINE BAR. Mounted with the other overlays rather than in each screen's
   * layout: it is absolutely positioned and `pointerEvents="none"`, so it costs the
   * screens beneath it nothing and can never swallow a tap.
   */
  const offlineEl = <OfflineBar connected={online} reachable={netReachable}
    queued={pendingUp} struggling={strugglingUp} topInset={44} />;

  const heldEl = noCredits ? (
    <HeldSendModal
      held={heldN}
      /**
       * BUYS IN THE APP NOW (2026-08-26), not on the web.
       *
       * This used to open a RevenueCat Web Purchase Link. It was the highest-intent
       * moment in the product — he has just been stopped mid-send — and it handed him
       * to Safari, a password and a card form. For the user CLAUDE.md describes, that
       * is where the purchase dies.
       *
       * It now opens the paywall, which sells the packs through StoreKit: Apple Pay,
       * Face ID, two taps, back where he was. Costs 15% under the Small Business
       * Program and buys the only thing that matters here, which is that the purchase
       * completes.
       *
       * NEVER NULL ANY MORE. The old button vanished when `purchaseUrl` had no token or
       * no company id — a man out of credits with no way to buy any. The paywall opens
       * regardless and says for itself when a rail is unavailable.
       */
      /**
       * SEQUENCED, NOT STACKED — the iOS race this file has already been bitten by
       * (see the purchase handler's note). Both of these are <Modal>s, and presenting
       * one in the same commit that dismisses the other is how the paywall silently
       * fails to appear. The timeout clears the fade before the next present.
       *
       * The delay is also why this cannot be `setShowPaywall` alone: a contractor who
       * taps Buy and sees nothing has been told the app is broken at the exact moment
       * he is trying to give it money.
       */
      onBuy={() => {
        setNoCredits(null);
        setTimeout(() => setShowPaywall(true), 320);
      }}
      onClose={() => setNoCredits(null)} />
  ) : null;

  // The paywall (DEC-11) — a Modal, so mounted beside quotaEl in each early-return
  // screen; `visible` toggles it. Opened from a hit cap ("See plans") or Settings.
  const paywallEl = (
    <PaywallScreen visible={showPaywall} currentPlan={paywallPlan}
      currentProductId={paywallProduct}
      /**
       * PAY AS YOU GO. The prices come from `pricing_config` (server-set, no app release
       * needed to change them) and the door is the RevenueCat web purchase link with
       * `company.id` appended — 0% Apple commission against 15% through IAP, which is
       * the whole reason this rail exists.
       *
       * Both are ABSENT rather than faked when unknown: no pricing yet means no section,
       * and no checkout address means prices with no button. A buy button that opens a
       * 404, or a checkout that attaches the purchase to an anonymous customer the app
       * cannot read, costs more than a missing one.
       */
      packs={pricing?.packs ?? []}
      // The server's kill switch, honoured again — see `packsSellable`. `railsFor`
      // reports 'none' or 'web' when IAP is off, and the app has no web rail any more,
      // so either answer means: do not offer a purchase here.
      packsSellable={pricing ? railsFor(pricing) !== 'none' && railsFor(pricing) !== 'web' : true}
      creditsLeft={credits?.metered ? credits.available : null}
      /**
       * A PACK CHANGES A NUMBER, NOT A TIER. `onPurchased` below is the subscription
       * handler and says "You're now on <plan>"; routing a pack through it announced
       * "You're now on Free" to somebody who had just bought 20 change orders.
       *
       * `drainHolds` is the right call and not merely a balance read: it re-reads the
       * balance AND releases anything queued behind the gate he just paid to clear,
       * which is the reason he bought them.
       */
      onCreditsPurchased={() => { void drainHolds(); }}
      onClose={() => {
        setShowPaywall(false);
        if (settingsFrom === 'drawer') setMenuOpen(true);
      }}
      // Re-read the plan after a purchase. company.plan is written by the RevenueCat
      // webhook and arrives via sync, so this may still read the old tier for a beat —
      // refresh() runs again on the next sync tick and settles it.
      /**
       * A PURCHASE HAS TO LAND EVERYWHERE, NOW.
       *
       * hadar, 2026-08-13: "I got the you're all set message, but the whole app needs to
       * be loaded with all the limits updated, and in the drawer the selected plan needs
       * to be updated." It only re-read the PAYWALL's own copy of the plan — so the
       * sheet knew, and the drawer, the usage lines and every quota check did not, until
       * the app was restarted. Paying for something and watching the app carry on
       * refusing you is the worst moment this product has.
       *
       * The entitlement is cached FIRST so `currentPlan()` can see it: `company.plan`
       * comes from the webhook via PowerSync and is not there yet — on this device it
       * is not there at all.
       */
      onPurchased={async (plan) => {
        if (plan) await rememberEntitledPlan(db, plan);
        // Re-read the product too: after a switch from annual to monthly the TIER is
        // unchanged, so the plan alone would leave the paywall marking the old cycle as
        // current and offering the switch that just happened.
        const prod = await entitledProductNow();
        await rememberEntitledProduct(db, prod);
        setPaywallProduct(prod);
        const p = await currentPlan(db);
        setPaywallPlan(p);
        setPlanId(p);                                   // the drawer's plan row
        const co2 = await myCompany(db, OWNER);
        setUsage(await usageSummary(db, co2?.id ?? null));   // the drawer's usage lines
        setQuota(null);                                 // clear any "you're capped" modal
        await refresh();                                // limits everywhere else

        /**
         * LAND BACK WHERE THE PLAN LIVES (hadar 2026-08-13: "once a selection is made it
         * should have some attinuation and get back to the drawer where the plan will be
         * displayed").
         *
         * Before this, a successful purchase left you on the paywall — the screen whose
         * entire job is to sell you something you have now bought. The one place that
         * states your plan back to you is the drawer, so that is where this ends.
         *
         * SEQUENCED, NOT STACKED. The paywall and the drawer are both Modals, and
         * opening one while the other dismisses is the iOS stacked-modal race this file
         * has already been bitten by. The ack is a plain overlay, so the order becomes:
         * paywall closes -> ack appears over the app -> the drawer opens when the ack is
         * dismissed, by tap or by its own timeout. `then` exists for exactly this.
         */
        setShowPaywall(false);
        setAck({
          kind: 'ok',
          title: T({ k: 'paywall.nowOn', p: { plan: T(('plan.' + p) as any) } } as any),
          detail: T('paywall.limitsLive'),
          then: () => setMenuOpen(true),
        });
      }}
      onContact={() => Linking.openURL('mailto:support@ezchangeorders.com?subject=' + encodeURIComponent('EZChangeOrders — plans')).catch(() => {})} />
  );


  /** Land on the job the sheet is about. Both of its buttons do this; the difference
   *  is only whether the camera opens after. */
  const openCreatedJob = async (id: string) => {
    setProjectId(id);
    setNav('project');
    await refresh();
  };

  /**
   * JOB CREATED (hadar, 2026-08-12). Creating a job used to drop straight into it
   * with no acknowledgement — the form vanished and a different screen appeared, and
   * whether anything had been saved was left to be inferred from the fact that the
   * screen changed.
   *
   * IT OFFERS THE NEXT ACT RATHER THAN ASSUMING IT. A new job exists because work is
   * about to happen on it, so raising the first change order is the likely next move
   * — but it is not the only one, and a contractor setting up three jobs on a Sunday
   * evening should not be pushed into the camera three times. So it is offered, and
   * Close lands on the job either way.
   *
   * NOT SHOWN ON THE ASSIGN PATH. When a job is created to file a walk that is
   * already recorded, `fileWalkTo` continues into the processing screen; a sheet
   * asking whether to create a change order would be interrupting the one that is
   * already being made.
   */
  const jobCreatedEl = jobCreated ? (
    <Modal visible transparent animationType="fade"
      onRequestClose={() => { const id = jobCreated.id; setJobCreated(null); void openCreatedJob(id); }}>
      <View style={s.jcWrap}>
        <View style={s.jcBox}>
          <Pressable style={s.jcX} hitSlop={12} accessibilityLabel={T('common.close')}
            onPress={() => { const id = jobCreated.id; setJobCreated(null); void openCreatedJob(id); }}>
            <Text style={s.jcXT}>✕</Text>
          </Pressable>
          <Icon name="mapHero" size={132} />
          <Text style={s.jcTitle}>{T('job.createdTitle')}</Text>
          <Text style={s.jcSub}>{T('job.createdSub')}</Text>
          <Pressable style={s.jcPrimary} accessibilityRole="button"
            onPress={() => {
              const id = jobCreated.id;
              setJobCreated(null);
              void (async () => {
                await openCreatedJob(id);
                // The same gate the capture button everywhere else passes through:
                // recording consent is asked once per job, before anything records.
                void gateTerms(() => setShowCapture(true));
                setShowCapture(true);
              })();
            }}>
            <Icon name="addSquare" size={19} color="#fff" />
            <Text style={s.jcPrimaryT}>{T('job.createdCo')}</Text>
          </Pressable>
          <Pressable style={s.jcSecondary} accessibilityRole="button"
            onPress={() => { const id = jobCreated.id; setJobCreated(null); void openCreatedJob(id); }}>
            <Text style={s.jcSecondaryT}>{T('common.close')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  ) : null;

  /**
   * The acknowledgement itself. Deliberately SMALL and centred rather than a banner at
   * an edge: the thing it is confirming was a deliberate act a second ago, so it earns
   * the middle of the screen for the moment it is there, and it costs nothing to leave.
   *
   * Tapping anywhere dismisses. On the refusal branch there is also a real button,
   * because "tap anywhere" is a convention a first-time user does not know, and this is
   * the branch where failing to dismiss means failing to read why nothing saved.
   */
  /**
   * AN OVERLAY, NOT A <Modal>, and that is the one thing here worth being deliberate
   * about. Every one of these fires microseconds after a bottom sheet — itself a Modal
   * — has been dismissed, and presenting a modal while iOS is still tearing the last
   * one down is the classic way to get a popup that appears on the simulator and never
   * on the phone. An absolutely-positioned view has no presentation lifecycle to race.
   * It costs nothing: the sheet is already closed by the time this renders, so there is
   * nothing left for a modal's z-order to win against.
   */
  const ackEl = ack ? (
    <Pressable
      style={[StyleSheet.absoluteFill, s.ackWrap]}
      onPress={dismissAck}
      accessibilityLabel={T('common.close')}>
      <View style={[s.ackBox, ack.kind === 'no' && s.ackBoxNo]}>
        <Icon name={ack.kind === 'ok' ? 'ntCheck' : 'ntAttention'} size={46} />
        <Text style={s.ackTitle}>{ack.title}</Text>
        {!!ack.detail && <Text style={s.ackDetail}>{ack.detail}</Text>}
        {(ack.kind === 'no' || !!ack.okLabel) && (
          <Pressable style={s.ackBtn} accessibilityRole="button" onPress={dismissAck}>
            <Text style={s.ackBtnT}>{ack.okLabel ?? T('common.close')}</Text>
          </Pressable>
        )}
      </View>
    </Pressable>
  ) : null;

  /**
   * WHAT THIS APP DOES, in three steps, for someone who has not used it yet.
   *
   * Written as the three things HE does, not the three things the system does. The ICP
   * is explicitly someone for whom software is not second nature (CLAUDE.md §1), so
   * "capture is local-first and the pipeline structures it" is not an explanation — it
   * is the thing he does not need to know. What he needs to know is that talking is
   * enough, that he checks the price before anyone else sees it (mandate #2), and that
   * the client signs on their phone.
   */
  /**
   * ADD · CHANGE · REMOVE the company logo.
   *
   * A sheet rather than three rows in the drawer: it needs to SHOW the current mark
   * (the whole question being answered is "is this the right image?"), and it opens
   * from the drawer, which is itself a Modal — so it goes through the drawer's `go()`
   * close-then-act path at the call site, or iOS refuses to present it.
   *
   * REMOVE IS DESTRUCTIVE-ISH AND SAYS SO. It does not delete the object (see
   * companylogo.ts — old signed documents still render their letterhead), but it does
   * change what every future client sees, so it is worded as an act on the documents
   * rather than on a file.
   */
  const logoEl = (
    <BottomSheet visible={logoSheet} title={T('logo.title')} onClose={() => setLogoSheet(false)}>
      <View style={s.logoPreviewWrap}>
        {logoUri
          ? <Image source={{ uri: logoUri }} style={s.logoPreview} resizeMode="contain" />
          : <View style={[s.logoPreview, s.logoPreviewEmpty]}>
              <Icon name="ntCompany" size={44} />
            </View>}
      </View>
      <Text style={s.logoNote}>{T('logo.note')}</Text>
      <Pressable style={[s.logoBtn, logoBusy && s.btnOff]} disabled={logoBusy}
        accessibilityRole="button"
        onPress={() => void (async () => {
          const picked = await pickLogo();
          if (!picked || !co) return;
          setLogoBusy(true);
          const r = await saveCompanyLogo(connector.client,
            { companyId: co.id, ownerId: OWNER, picked });
          setLogoBusy(false);
          if (!r.ok) {
            setAck({
              kind: 'no', title: T('logo.failed'),
              detail: [T(('logo.err.' + r.reason) as any), r.detail].filter(Boolean).join('\n'),
            });
            return;
          }
          // Cache-bust: the path is stable by design, so <Image> would redraw the OLD
          // bytes from its own memory cache after a REPLACE. The fragment changes the
          // source identity without changing the file.
          setLogoUri(`${r.localUri}?v=${Date.now()}`);
          // The path now carries the key, so the next refresh must not treat the new
          // file as the old one's cache. FROM THE SAVE RESULT, not from the local
          // `company` table: that table is empty on this device, so the old read set the
          // key to null every time and left Remove with nothing to delete.
          setLogoKey(r.logoKey);
          // The exported change order prints this mark, and it reads the cached
          // letterhead rather than the network. Without this line a contractor's new logo
          // would not reach his documents until he next opened Settings with signal.
          void (async () => {
            // WRITE IT EVEN WITH NO PRIOR CACHE. Guarding on `prev` meant a contractor who
            // uploaded a logo before ever opening the Company screen cached nothing — and
            // the cache is what the next launch reads. That is the same bug as the one
            // above, one layer down.
            const prev = await cachedLetterhead(db);
            await cacheLetterhead(db, {
              companyId: co.id, name: prev?.name ?? co.name,
              address: prev?.address ?? null, license: prev?.license ?? null,
              logoKey: r.logoKey, isOwner: true,
            });
          })();
          setLogoSheet(false);
          setAck({ kind: 'ok', title: T('logo.saved'), detail: co.name });
        })()}>
        <Icon name="photo" size={19} color="#fff" />
        <Text style={s.logoBtnT}>{T(logoUri ? 'logo.change' : 'logo.add')}</Text>
      </Pressable>
      {!!logoUri && (
        <Pressable style={s.logoRemove} accessibilityRole="button" disabled={logoBusy}
          onPress={() => void (async () => {
            if (!co) return;
            setLogoBusy(true);
            const r = await removeCompanyLogo(connector.client,
              { companyId: co.id, logoKey });
            setLogoBusy(false);
            if (!r.ok) {
              setAck({
                kind: 'no', title: T('logo.failed'),
                detail: [T('logo.err.save_failed'), r.detail].filter(Boolean).join('\n'),
              });
              return;
            }
            setLogoUri(null); setLogoKey(null);
            setLogoSheet(false);
            setAck({ kind: 'ok', title: T('logo.removed') });
          })()}>
          <Text style={s.logoRemoveT}>{T('logo.remove')}</Text>
        </Pressable>
      )}
    </BottomSheet>
  );

  const howEl = (
    <BottomSheet visible={howOpen} title={T('how.title')} onClose={() => setHowOpen(false)}>
      {([1, 2, 3] as const).map((n) => (
        <View key={n} style={s.howStep}>
          <View style={s.howNum}><Text style={s.howNumT}>{n}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={s.howStepT}>{T(`how.s${n}` as any)}</Text>
            <Text style={s.howStepS}>{T(`how.s${n}sub` as any)}</Text>
          </View>
        </View>
      ))}
      <Text style={s.howFoot}>{T('how.foot')}</Text>
    </BottomSheet>
  );

  if (newJob) {
    // Computed once for the screen: the warning band and the Create button must never
    // disagree about whether this address is already taken.
    const dupeTwin = findAddressTwin(projects, newJob.address,
      { lat: newJob.lat, lng: newJob.lng });
    return (
      /**
       * ── KEYBOARD (hadar, 2026-08-12: "cannot create new job — the keyboard is
       *    hiding the buttons and it doesn't retract") ──────────────────────────
       *
       * This screen was a bare View with a `flex: 1` spacer pinning the footer to the
       * bottom of the WINDOW. The name field autoFocuses, so the keyboard is up before
       * the user has done anything — and it covers the bottom third, which is where
       * Create and Cancel live. Nothing lifted them, nothing scrolled, and there was no
       * way back out: no scroll to drag, no background to tap, and the field's return
       * key was the system default rather than a labelled Done. The screen was a dead
       * end, which is the worst thing a CREATE form can be.
       *
       * Three parts, and all three are needed — any two still leaves it stuck:
       *   1. KeyboardAvoidingView shrinks the box, so the footer is inside the visible
       *      area at all. Same `behavior` split as authscreen.tsx and kit.tsx — one
       *      keyboard strategy in this app, not three.
       *   2. ScrollView (flexGrow so the spacer still works when there IS room) makes
       *      the footer reachable on a short phone, and `keyboardDismissMode="interactive"`
       *      makes the ordinary iOS drag-down put the keyboard away.
       *   3. keyboardShouldPersistTaps="handled" — THE ONE THAT ACTUALLY FIXES
       *      "cannot create". Without it RN spends the first tap dismissing the
       *      keyboard and never delivers it to the button underneath, so tapping Create
       *      with the keyboard up does nothing at all. That is a dead button, and it
       *      reads exactly like the bug reported.
       */
      <KeyboardAvoidingView style={s.njScreen}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {offlineEl}{quotaEl}{heldEl}{celebrateEl}{msgToastEl}{silentEl}
      {jobCreatedEl}
        {discardSheet}
        {paywallEl}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={s.njScroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}>
        {/* ── NEW JOB, on the page ────────────────────────────────────────────
            It was a boxed card floating under a 30pt app-name banner, which is the
            old shell: the app told you its own name at the top of a form and then
            drew a border around the form in case you had not noticed it. The screens
            this sits between — Jobs and Job — put content on the paper with hairline
            rules, so this does too.

            THE FIELDS ARE LABELLED, not placeheld. A placeholder disappears the
            moment someone types, so a person who looks away mid-address comes back to
            two identical boxes with no way to tell which is which. */}
        <Text style={s.njTitle}>{T('job.newTitle')}</Text>
        <Text style={s.njSub}>{T('job.newSub')}</Text>

        <View style={s.njField}>
          <Text style={s.njLab}>{T('job.nameLabel')}</Text>
          {/* returnKeyType="done" so the key he is already looking at says what it
              does. The default "return" on a one-line field reads as a newline, which
              is why nobody presses it to get out. */}
          <TextInput style={s.njInput} value={newJob.name} autoFocus
            placeholder={T('job.name')} placeholderTextColor="#9aa19b"
            returnKeyType="done" onSubmitEditing={() => Keyboard.dismiss()}
            onChangeText={(v) => setNewJob({ ...newJob, name: v })} />
        </View>

        <View style={s.njField}>
          <Text style={s.njLab}>{T('job.addressLabel')}</Text>
          <AddressInput
            value={newJob.address}
            onChangeText={(v) => setNewJob({ ...newJob, address: v })}
            onPick={(h) => setNewJob({ ...newJob, address: h.label, lat: h.lat, lng: h.lng })}
          />
        </View>

        {/* ALREADY GOT ONE? (hadar, 2026-08-31: "we should not allow the creation of
            multiple jobsites with the same address.")

            IT ANSWERS WHILE HE TYPES, not after he commits. A refusal fired by the
            Create button is a wasted trip through a form; a line under the address is
            the answer arriving where the question was asked, and it offers the thing
            he probably wanted — the job that already exists.

            IT WARNS AND OFFERS RATHER THAN REFUSING. Two units of a duplex, and the
            same house remodelled again next year, are indistinguishable from a slip
            of the finger to any comparison of addresses. A hard block makes those
            impossible and tells the contractor the app knows his street better than
            he does. So creating stays possible — but it can no longer happen by
            accident, and the button now says what it is about to do. */}
        {dupeTwin && (
          <Pressable style={s.njDupe} accessibilityRole="button"
            onPress={() => { setNewJob(null); setPicker(false);
                             setProjectId(dupeTwin.id); setNav('project'); }}>
            <Icon name="info" size={17} color="#8B5148" />
            <View style={{ flex: 1 }}>
              <Text style={s.njDupeT}>{T('job.dupeHere')}</Text>
              <Text style={s.njDupeN} numberOfLines={1}>{dupeTwin.name}</Text>
            </View>
            <Text style={s.njDupeGo}>{T('job.dupeOpen')}</Text>
          </Pressable>
        )}

        {/* WHY THE ADDRESS MATTERS, in the terms it matters to him: it is what makes
            a capture file itself later. Stated as the consequence, not as a rule. */}
        <View style={s.njNote}>
          <Icon name="info" size={17} color="#4E6243" />
          <Text style={s.njNoteT}>{T('job.newAddressWhy')}</Text>
        </View>

        <View style={{ flex: 1 }} />

        <View style={s.njFoot}>
          <Pressable style={[s.njCreate, !newJob.name.trim() && s.btnOff]}
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
              // The confirmation sheet takes it from here — it says the job exists and
              // offers the first change order, and both of its buttons land on the job.
              setJobCreated({ id: r.id });
            }}>
            {/* THE LABEL CHANGES WHEN THIS WOULD MAKE A SECOND JOB AT ONE ADDRESS.
                A button that reads the same whether or not it is about to duplicate
                is the button that made the duplicate. */}
            <Text style={s.njCreateT}>{dupeTwin ? T('job.createAnyway') : T('job.create')}</Text>
          </Pressable>
          <Pressable style={s.njCancel} onPress={() => setNewJob(null)}>
            <Text style={s.njCancelT}>{T('common.cancel')}</Text>
          </Pressable>
        </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // REQ-EVID2: "found in ≤2 actions". Tap the job name, tap the job.
  if (picker) {
    return (
      <View style={s.c}>
        <Text style={s.h}>EZChangeOrders</Text>
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
      /**
       * A DEAD BUTTON IS THE ONE THING THIS SCREEN MAY NOT BE (hadar, 2026-08-21:
       * "app gets stuck on this when I try to add photos").
       *
       * Every statement below used to run unguarded, and the FIRST of them is a
       * database write. If `setTermsAccepted` throws — a missing `device_settings`
       * after a handover wipe, a locked database, anything — the rejection was
       * unhandled, `setShowTerms(null)` never ran, and the screen simply stayed with
       * the button doing nothing each time it was pressed. Silent, un-loggable, and
       * indistinguishable from a frozen app.
       *
       * THE WRITE IS ALSO READ BACK. `setTerms(true)` used to be asserted from the
       * fact that the write did not throw; but the effect in `refresh()` re-reads
       * `getTermsAccepted` on the next tick, so a write that lands nowhere flips the
       * gate back to false and the screen returns on the next tap. That is a loop the
       * user cannot escape and cannot see the cause of. Confirming the stored value
       * turns it into one honest refusal instead.
       */
      try {
        await setTermsAccepted(db);
        if (!(await getTermsAccepted(db))) {
          throw new Error('terms acceptance did not persist');
        }
      } catch (e: any) {
        const why = String(e?.message ?? e).slice(0, 160);
        void logDiag(db, 'terms.accept', why);
        console.warn('[terms] accept failed:', why);
        setAck({ kind: 'no', title: T('terms.failedTitle'), detail: T('terms.failedBody') });
        return;
      }
      setTerms(true);
      // BEFORE the continuation runs. `setTerms` does not change `termsRef` until the
      // next render, and the continuation is invoked below in THIS tick.
      termsRef.current = true;
      setShowTerms(null);
      // RESUME WHAT HE WAS DOING. Cleared before running so a continuation that opens
      // this screen again cannot loop, and read into a local first because the callback
      // may set state that re-renders before we get to null it.
      /**
       * ASK FOR EVERYTHING CAPTURE NEEDS, HERE, ONCE.
       *
       * hadar, 2026-08-20: "it presented me with the geo location permissions and then
       * the audio ... now it['s] presenting me with the camera permissions — it should
       * have done all of that the first time."
       *
       * He is right, and the piecemeal version was worse than untidy: the camera prompt
       * arrived on his SECOND change order, long after onboarding, with no screen
       * around it explaining why. Here there is one — this screen exists to say what
       * the app records and why — so it is the honest place to ask for the rest.
       * Location was already requested above while detecting the jurisdiction.
       *
       * AWAITED so the prompts queue instead of racing, and NON-BLOCKING on refusal:
       * a declined camera must not stop a voice capture, and the capture screen still
       * asks again in context if it genuinely needs one. Nothing here is treated as
       * consent to record — that is the acceptance itself, above.
       */
      await requestMic().catch(() => false);
      await ImagePickerPerm.requestCameraPermissionsAsync().catch(() => null);

      const next = afterTerms.current;
      afterTerms.current = null;
      // RECORDED EVEN WHEN THERE IS NOTHING TO RESUME. `openTerms()` is called from
      // eleven places and one of them (the record button) deliberately passes no
      // continuation — so "accepted, then nothing visibly happened" is a REAL outcome
      // for that path and an unexplained freeze for every other. The trail is what
      // tells the two apart afterwards.
      void logDiag(db, 'terms.accept', next ? 'accepted, resuming' : 'accepted, no continuation');
      next?.();
    };
    // Moved out of this file 2026-08-20 (hadar's design). It was the last screen in
    // the guided flow still drawn on the old green `s.card`, sitting between two
    // screens already in the Oswald-over-cream language — see ui/recordconsent.tsx.
    // The English string that used to be hardcoded here ("Checking your location…")
    // now lives in i18n as `terms.detecting`; it was the only untranslated sentence
    // on the screen, which a Spanish-reading contractor would have hit at exactly the
    // moment the app asks him to accept legal terms.
    return (
      <RecordConsent
        jurisdiction={showTerms.jur ?? null}
        allParty={allParty}
        detecting={!!showTerms.detecting}
        onAccept={accept}
        onLater={() => setShowTerms(null)}
      />
    );
  }

  if (sign) {
    return (
      <View style={s.c}>
        <Text style={s.h}>EZChangeOrders</Text>
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
                      otpVerifiedAt: sign.verifiedAt!, action: 'approved', userAgent: 'EZChangeOrders iOS',
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
                    action: 'declined', userAgent: 'EZChangeOrders iOS',
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
/**
   * DROP THE HOLD THE MOMENT A REAL STEP IS UP, and drop it anyway after 2.5 seconds.
   *
   * The first half is the normal path: the next screen's state lands, this fires, the
   * corridor is gone in the same commit.
   *
   * The second half is the one that matters. A hand-off that throws between clearing the
   * old state and setting the new one would otherwise leave a man looking at a rail and a
   * spinner with no way out — worse than the flash this replaces, because a flash ends.
   * The backstop means the failure mode of this whole mechanism is "you see Home a beat
   * later than you should", which is exactly where we started.
   */
  React.useEffect(() => {
    if (!flowHold) return;
    if (assign || clientPick || transition || review || record) { setFlowHold(null); return; }
    const id = setTimeout(() => setFlowHold(null), 2500);
    return () => clearTimeout(id);
  }, [flowHold, assign, clientPick, transition, review, record]);

  if (!ready || !fontsLoaded) return <SplashScreen />;

  /**
   * THE HOLD, RESOLVED IN ONE PLACE. It sits at the TOP of the chain rather than the
   * bottom, because the gap it covers is exactly the moment when no other branch
   * matches — putting it last would work too, but only until somebody adds a branch
   * above Home and quietly reintroduces the flash.
   *
   * A flow screen being up always wins: the hold is dropped in the effect below the
   * moment one mounts, so this can only render while the app is genuinely between two
   * steps of the sequence.
   */
  if (flowHold && !assign && !clientPick && !transition && !review && !record) {
    return <FlowHoldScreen step={flowHold} />;
  }

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
  /**
   * STEP 6, and it renders ABOVE the processing screen on purpose: `fileWalkTo` holds
   * the transition back until this is answered, so the two never stack. Answer or skip,
   * then `onDone` starts the upload.
   */
  if (clientPick) {
    const cp = clientPick;
    const finish = () => { setClientPick(null); cp.onDone(); };
    return (
      <ClientPickScreen
        scope={coRowsRef.current.find((c) => c.id === cp.coId)?.scope ?? T('erec.untitled')}
        roster={cp.roster}
        known={cp.known}
        busy={cp.busy}
        onSkip={finish}
        onPickContact={pickContactValue}
        onPick={async (c) => {
          setClientPick({ ...cp, busy: true });
          // The name is the key `who_directed` stores — same rule as saveClientApprover,
          // so a client picked here and one picked in the send sheet are the same person.
          const r = await setDraftClient(db, cp.coId, c.name).catch(
            () => ({ ok: false as const, reason: 'could not save' }));
          if (!r.ok) setFiled(r.reason);
          await markApproverUsed(db, c.id).catch(() => { /* recency is not load-bearing */ });
          await refresh();
          finish();
        }}
        /**
         * SOMEBODY FROM ANOTHER LOCATION, COPIED ONTO THIS ONE.
         *
         * It is a COPY, not a reference: `project_approver` is per-project by design, so
         * the row he taps stays where it is and a new one is written here. That is the
         * same thing typing their name would do — this only spares him the typing.
         *
         * THEIR ROLE COMES WITH THEM ON THE INSERT. `saveClientApprover` defaults to the
         * client role, and letting that default apply would silently turn the GC he subs
         * for into this job's owner — the exact relabelling `listRoster` refuses when it
         * drops rows with unknown roles.
         *
         * ON A NAME COLLISION IT DOES NOT, and that is correct rather than a gap
         * (review, 2026-09-02): `saveClientApprover`'s existing-row branch updates name,
         * phone and chain side only. If someone by this name is already on this project,
         * rewriting their role from another project's record is the same silent
         * relabelling — so the row keeps the role it has. The claim is scoped to the
         * insert because that is where it is true.
         *
         * The phone rides along so the number is on record. It does NOT make them
         * sendable: `consentAtMs` is a separate fact ("null = never stated, and a client
         * send is refused until it is", approvers.ts:132), it is deliberately not copied
         * — consent given on one job is not consent given on another — and the send
         * sheet still asks. Carrying the number saves the typing, nothing more.
         */
        onPickKnown={async (c) => {
          setClientPick({ ...cp, busy: true });
          try {
            await saveClientApprover(db, { projectId: cp.projectId, name: c.name,
                                           phone: c.phone || null,
                                           role: (c.role as any) || undefined });
            const r = await setDraftClient(db, cp.coId, c.name);
            if (!r.ok) setFiled(r.reason);
            await refresh();
          } catch (e: any) {
            // Same rule as onAdd: loud. A client he picked and did not get is worse
            // than being asked again, because he will believe it is on the extra.
            setFiled(String(e?.message ?? e));
          }
          finish();
        }}
        onAdd={async (name, phone) => {
          setClientPick({ ...cp, busy: true });
          try {
            await saveClientApprover(db, { projectId: cp.projectId, name, phone: phone || null });
            const r = await setDraftClient(db, cp.coId, name);
            if (!r.ok) setFiled(r.reason);
            await refresh();
          } catch (e: any) {
            // LOUD, never silent: a client he typed and did not get is worse than being
            // asked again, because he will believe it is on the extra.
            setFiled(String(e?.message ?? e));
          }
          finish();
        }}
      />
    );
  }

  if (transition) {
    const t = transition;
    // Every row tracks a REAL signal. Transcription only exists when there is an
    // anchor capture; the AI pass belongs to a NEW extra, so an augment does not
    // claim a "details sorted" step it never ran.
    const steps: { done: boolean; doing: string; doneKey: string }[] = [
      { done: true, doing: 'cap.transSaved', doneKey: 'cap.transSaved' },
      { done: t.uploaded, doing: 'cap.transUpload', doneKey: 'cap.transUploaded' },
      // "Written down" is a claim about words, so it cannot be printed over a recording
      // that had none (hadar, 2026-08-23). When the poll finds the anchor was silent the
      // row still COMPLETES — nothing more is coming — but it says what was actually
      // found, and the "photos only" reading is the point: no voice on an extra that has
      // photos means photos are all that were added.
      ...(t.anchorCaptureId !== null
        ? [{ done: t.transcribed, doing: 'cap.transStt',
             doneKey: t.anchorSilent ? 'cap.transSttSilent' : 'cap.transSttDone' }] : []),
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
    /**
     * NEVER ON AN EDIT (hadar, 2026-08-23, option (a)): "if it is an edit not a create
     * new … if a jobsite is already set don't display the jobsite selection/creation."
     *
     * The filing prompt belongs to a NEW extra, which genuinely has nowhere to go until
     * a human says where. An amendment already has a home — its parent's — and asking
     * again in the middle of an edit both blocks the screen and asks a question the
     * answer to which is not the contractor's to give here. `heldForFiling` says the
     * same fact calmly instead, and the extra carries its amendment up whenever it is
     * itself filed.
     */
    const awaitingFiling =
      !t.isAugment && !!t.lastError && /AWAITING_FILING/i.test(t.lastError);
    // Any surfaced error puts the screen into the reassure-and-let-them-proceed state;
    // the message below picks the right plain-language words for which kind it is.
    const trouble = t.offline || t.stalled || t.blocked || !!t.lastError || !!t.heldForFiling;
    const warnKey = awaitingFiling ? 'cap.transNoJob'
      : t.heldForFiling ? 'cap.transHeldForJob'
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

          {/* Last of four on a NEW extra. An AUGMENT is not that sequence: it has no
              job question and no owner question, so numbering it would describe a
              walk he did not take. */}
          {/* The rail, not a lone grey line. This screen is where the wait happens,
              so it is the one that most needs to say how much is left. */}
          {!t.isAugment && (
            <View style={{ alignSelf: 'stretch', marginBottom: 14 }}>
              <FlowRail step={4} />
            </View>
          )}
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

            {/**
              * THE UPLOAD SUB-BAR (hadar, 2026-08-21: "1 out of 4 photos are uploaded,
              * 30% complete").
              *
              * The ring above tracks the WHOLE job — saved, backed up, written down,
              * details sorted. This tracks the one step that can take minutes on a
              * jobsite connection and is the only one whose duration depends on
              * something the contractor can see: how many files he took.
              *
              * A PERCENTAGE AND A COUNT, not one or the other. The percentage answers
              * "is this moving"; the count answers "how much is left", and on four
              * photos over a weak link the second question is the one being asked. The
              * old line gave neither — it said "2 of 5 backed up (photos + audio)",
              * which lumps a 20-second recording in with four photos and hides which
              * of them is the thing that is stuck.
              */}
            {/* NOT gated on `!t.uploaded` any more. Hiding the bar the instant the
                last file lands means a fast upload shows nothing, and "nothing
                happened" is exactly what a progress bar exists to prevent. It stays,
                reaches 100%, and the reader sees the step complete rather than
                inferring it from an absence. */}
            {t.uploadTotal > 0 && (
              <View style={s.trProgWrap}>
                <View style={s.trProgTrack}>
                  <View style={[s.trProgFill,
                    { width: `${Math.round((t.uploadDone / Math.max(1, t.uploadTotal)) * 100)}%` }]} />
                </View>
                <Text style={s.trProgT}>
                  {T({ k: 'cap.transUploadPct',
                       p: { pct: String(Math.round((t.uploadDone / Math.max(1, t.uploadTotal)) * 100)) } } as any)}
                </Text>
                {/* PER KIND, and only for a kind that exists. A voice-only capture must
                    not read "0 of 0 photos" — an absent fact is omitted, never shown as
                    a zero, which is record.ts's rule applied to a progress line. */}
                <View style={s.trProgKinds}>
                  {t.photoTotal > 0 && (
                    <Text style={s.trProgKindT}>
                      {T({ k: 'cap.transUploadPhotos',
                           p: { done: String(t.photoDone), total: String(t.photoTotal) } } as any)}
                    </Text>
                  )}
                  {t.voiceTotal > 0 && (
                    <Text style={s.trProgKindT}>
                      {T({ k: 'cap.transUploadVoice',
                           p: { done: String(t.voiceDone), total: String(t.voiceTotal) } } as any)}
                    </Text>
                  )}
                </View>
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
              {t.lastError && !netRetry && !awaitingFiling && !t.heldForFiling && (
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
                  setHereAddr(undefined); hereAddrKey.current = null;
                  setAssign({ ids, lat: null, lng: null, uris: [], secs: 0,
                              anchorCoId: coId, anchorCaptureId: anchor });
                }}>
                  <Text style={s.trFileT}>{T('cap.transPickJob')}</Text>
                </Pressable>
              )}
              {/**
                * THE SAME RULE AS THE FILING BUTTON ABOVE, APPLIED TO THE OTHER
                * BLOCKER (hadar, 2026-08-21: "it is asking me to turn cell backup on
                * but we don't give the user the option to — there should be a link
                * for them to do it from the message").
                *
                * `cap.transBlocked` said "turn on cellular upload in Settings" and
                * offered nothing. The record screen has had this exact act wired for
                * a while (`onAllowCellular`), so the app could already do it — it
                * simply was not offered on the one screen where the problem is
                * stated, which is the screen he is standing on when it happens.
                *
                * Telling somebody where a toggle lives, in a product built for people
                * who do not think in software, is the failure CLAUDE.md's core design
                * test names: he should not have to go and find it.
                *
                * It kicks the drain immediately, so granting it has a VISIBLE result
                * rather than a promise — the bar above starts moving.
                */}
              {t.blocked && (
                <Pressable style={s.trFile} onPress={() => void (async () => {
                  await setCellularConsent(db, true);
                  setCellOn(true);
                  await redriveNow(db, t.ids);
                  const { data } = await connector.client.auth.getSession();
                  const uid = data?.session?.user?.id;
                  if (!uid) return;
                  // Clear the message from THIS drain's own answer, not optimistically.
                  // If the gate still refuses — consent write failed, or he is on a
                  // network the gate rejects for another reason — the message stays,
                  // which is the truth. The poll below re-asks either way.
                  const r = await drainOutbox(db, connector.client, uid, t.ids);
                  setTransition((cur) => cur && { ...cur, blocked: !!r.blocked });
                })()}>
                  <Text style={s.trFileT}>{T('stuck.allowCell')}</Text>
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
    // Resolved ONCE while the picker is up, so the create-a-job row can name the
    // address it would pre-fill instead of promising one in the abstract.
    //
    // ASKED ONCE PER FIX, guarded by a ref rather than by the state it sets: this runs
    // in the render body, so keying off `hereAddr` alone would re-fire the lookup on
    // every render until the promise came back — and the no-fix branch would be a
    // setState during render, which React is entitled to complain about. The key is
    // the fix itself, so a different walk at a different corner asks again.
    const hereKey = `${assign.lat ?? ''},${assign.lng ?? ''}`;
    if (hereAddrKey.current !== hereKey) {
      hereAddrKey.current = hereKey;
      const { lat, lng } = assign;
      void (lat != null && lng != null ? addressFor(lat, lng) : Promise.resolve(null))
        .then((a) => setHereAddr(a)).catch(() => setHereAddr(null));
    }
    const q = assignQ.trim().toLowerCase();
    const matches = (p: { name: string; address: string | null }) =>
      !q || p.name.toLowerCase().includes(q) || (p.address ?? '').toLowerCase().includes(q);
    const candidates = projects
      .filter((p) => p.id !== INBOX_ID)
      .map((p) => ({
        ...p,
        distM: assign.lat != null && assign.lng != null && p.lat != null && p.lng != null
          ? distanceM({ lat: assign.lat, lng: assign.lng }, { lat: p.lat, lng: p.lng })
          : null,
      }))
      .filter(matches)
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
      //
      // `hereAddr` is REUSED when it has already resolved — the row above promised
      // that exact address, and looking it up again could return a different one and
      // make the promise false. Falls back to its own lookup when the row never got
      // an answer to show.
      const addr = hereAddr ?? (assign.lat != null && assign.lng != null
        ? await addressFor(assign.lat, assign.lng) : null);
      setNewJob({ name: addr ?? '', address: addr ?? '', lat: assign.lat, lng: assign.lng });
    };
    // THE DESIGN hadar supplied 2026-08-07, revised 2026-08-25: a light, calm picker,
    // not the dark capture world. This is the first screen after a change order is
    // saved, and its job is one question — which job is this for.
    //
    // GPS SUGGESTS, IT NEVER DECIDES (mandate #8). The closest job is PROMOTED to a
    // card at the top of the screen — the answer is usually the ground he is standing
    // on, and making him read three section headings to find it was work he should not
    // have had to do. But the card is still only an offer: nothing is pre-selected,
    // and "File it to this job" is a deliberate tap like every other row. The moment
    // that button files anything on its own, this screen has broken the mandate.
    const fmtDist = (m: number) => m < 950 ? `${Math.round(m)} m` : `${(m / 1609.34).toFixed(1)} mi`;
    const located = candidates.filter((p) => p.distM != null);
    // THE HERO IS THE NEAREST PINNED JOB, and only when there IS one. No fix, no
    // pinned jobs, or a search query narrowing things down — all fall back to the
    // plain list, which never claimed to know where he was.
    const hero = !q && located.length > 0 ? located[0] : null;
    const heroDist = hero?.distM ?? null;
    const rest = candidates.filter((p) => p.id !== hero?.id).slice(0, 4);
    const restIds = new Set(rest.map((p) => p.id));
    const recent = [...projects]
      .filter((p) => p.id !== INBOX_ID && p.id !== hero?.id && !restIds.has(p.id))
      .filter(matches)
      .sort((a, b) => (b.last_used_ms ?? 0) - (a.last_used_ms ?? 0))
      .slice(0, 3)
      // Recent rows carry no distance — they are remembered, not located — so the
      // shape is completed with a null rather than the row type being widened.
      .map((p) => ({ ...p, distM: null as number | null }));
    const others = [...rest, ...recent];
    const pickable = projects.filter((p) => p.id !== INBOX_ID).length;
    // The rule only earns its space when there IS something else behind it. With one
    // job on the account it would announce alternatives that do not exist — and the
    // search box below would then need the margin the rule was carrying.
    const showOr = !!hero && (others.length > 0 || pickable > 1);
    const jobRow = (p: typeof candidates[number]) => (
      <Pressable key={p.id} style={s.jpRow} onPress={() => fileAll(p.id)}
        accessibilityRole="button"
        accessibilityLabel={[p.address || p.name, p.distM != null ? fmtDist(p.distM) : null]
          .filter(Boolean).join(', ')}>
        <View style={{ flex: 1 }}>
          {/* THE ADDRESS LEADS. A contractor standing on a street recognises where he
              is, not what somebody typed in the name field three weeks ago. The job
              name is the second line precisely because it is the weaker signal. */}
          <Text style={s.jpAddr} numberOfLines={1}>{p.address || p.name}</Text>
          {!!p.address && !!p.name && p.name !== p.address && (
            <Text style={s.jpName} numberOfLines={1}>{p.name}</Text>
          )}
        </View>
        {p.distM != null && (
          <View style={s.jpDist}>
            <Icon name="mapPin" size={15} color="#4E6243" />
            <Text style={s.jpDistT}>{fmtDist(p.distM)}</Text>
          </View>
        )}
        <Text style={s.jpChev}>›</Text>
      </Pressable>
    );
    return (
      <View style={s.jpC}>
        {offlineEl}{quotaEl}{heldEl}{celebrateEl}{msgToastEl}{silentEl}
      {jobCreatedEl}
        {discardSheet}
        {paywallEl}
        <ScrollView contentContainerStyle={{ padding: 18, paddingTop: 8, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled">
          {/**
            * WHERE HE IS IN THE SEQUENCE (hadar, 2026-08-24: "its subtle but these are
            * multi steps 1. record 2. select job site 3. select owner 4. progress").
            *
            * Four screens follow one Done tap and each one used to arrive as if it were
            * the only thing happening. That is fine when you have seen it before and
            * disorienting the first time: a man who has just finished talking is handed
            * a question, then another question, then a progress ring, with nothing
            * saying how many more there are or that there is an end.
            *
            * A quiet line, not a stepper bar: it answers "how much longer" without
            * becoming furniture on a screen whose job is one question. Step 1 is the
            * recording he just finished — counted, because it is the step he DID, and
            * leaving it out would make "1 of 3" mean something different from what he
            * just lived through.
            */}
          <View style={{ marginBottom: 20 }}><FlowRail step={2} /></View>
          <Text style={s.jpTitle}>{T('assign.title')}</Text>

          {hero ? (
            <View style={s.jpHero}>
              {/* THE EYEBROW SAYS ONE THING NOW (the artboard, 2026-09-02). It used to
                  read "Closest location · Using GPS", which spends the most-read line
                  on the screen explaining the MECHANISM. He does not need to be told
                  the phone used GPS — the pin, the distance pill and "you are standing
                  on it" all say it, and they say it as evidence rather than as a
                  disclaimer. Mandate #8 is about GPS never DECIDING, and it still does
                  not: this card suggests, and the whole rest of the screen is the
                  refusal. That mandate never asked for the word "GPS" on screen. */}
              <View style={s.jpHeroTop}>
                <View style={{ flex: 1 }}>
                  <View style={s.jpHeroEyebrow}>
                    <Icon name="mapPin" size={15} color="#4E6243" />
                    <Text style={s.jpHeroEyebrowT}>{T('jobpick.closest')}</Text>
                  </View>
                  <Text style={s.jpHeroAddr} numberOfLines={2}>{hero.address || hero.name}</Text>
                  {!!hero.address && !!hero.name && hero.name !== hero.address && (
                    <Text style={s.jpHeroName} numberOfLines={1}>{hero.name}</Text>
                  )}
                </View>
                <MapThumb />
              </View>
              {heroDist != null && (
                <View style={s.jpHeroPill}>
                  <Icon name="mapPin" size={14} color="#4E6243" />
                  {/* "You are standing on it" is a CLAIM ABOUT THE WORLD, so it is made
                      only inside a distance a phone fix can support. Outside it the
                      pill says how far and stops talking. */}
                  <Text style={s.jpHeroPillT}>
                    {T({ k: heroDist <= STANDING_ON_M ? 'jobpick.standingOn' : 'jobpick.away',
                         p: { d: fmtDist(heroDist) } } as any)}
                  </Text>
                </View>
              )}
              <Pressable style={s.jpHeroBtn} onPress={() => fileAll(hero.id)}
                accessibilityRole="button">
                <Text style={s.jpHeroBtnT}>{T('jobpick.fileHere')}</Text>
              </Pressable>
            </View>
          ) : (
            <Text style={s.jpSub}>{T('jobpick.sub')}</Text>
          )}

          {/* THE ESCAPE HATCH IS NAMED. Under a card that answers the question for him,
              a bare search box reads as "there is nothing else"; the rule saying "not
              this one?" is what tells him the rest of the screen is still his. */}
          {showOr && (
            <View style={s.jpOrWrap}>
              <View style={s.jpOrLine} />
              <Text style={s.jpOrT}>{T('jobpick.notThisOne')}</Text>
              <View style={s.jpOrLine} />
            </View>
          )}

          <View style={[s.jpSearchWrap, showOr ? { marginTop: 0 } : null]}>
            <Icon name="search" size={18} color="#6b625b" />
            <TextInput style={s.jpSearch} value={assignQ} onChangeText={setAssignQ}
              placeholder={pickable > 1
                ? T({ k: 'jobpick.searchN', p: { n: pickable } } as any)
                : T('jobpick.search')}
              placeholderTextColor="#8c959f" />
          </View>

          {/* CAPPED AT THREE, WITH A WAY TO SEE THE REST (the artboard, 2026-09-02).
              This used to render every location the account has. On a phone with four
              that is a list; on hadar's, with a dozen jobsites on the same street, it
              is a WALL between the search box and "new location right here" — and the
              two things he actually reaches for are the ones it buries.

              Three is what fits above the fold under the search box. "See all" reveals
              the rest IN PLACE rather than navigating: this is step 2 of 5 and he is
              holding an unfiled recording, so a screen that could push him somewhere
              else is a screen that can lose his place. */}
          {!!others.length && (
            <View style={s.jpRecentHead}>
              <Text style={s.jpRecentH}>{T('jobpick.recent')}</Text>
              {others.length > RECENT_CAP && !showAllJobs && (
                <Pressable onPress={() => setShowAllJobs(true)} accessibilityRole="button"
                  hitSlop={12} style={s.jpSeeAll}>
                  <Text style={s.jpSeeAllT}>{T('job.seeAll')}</Text>
                  <Text style={s.jpSeeAllChev}>›</Text>
                </Pressable>
              )}
            </View>
          )}
          {(showAllJobs ? others : others.slice(0, RECENT_CAP)).map((p) => jobRow(p))}

          {/* DASHED because it MAKES a thing rather than choosing one. Below the list
              now (the artboard, 2026-08-25): it used to sit above every job, which put
              "create a new one" in front of a man whose job was almost always already
              on the screen. Creating here still always succeeds, offline included, so
              this screen can never dead-end on a job that does not exist yet. */}
          <Pressable style={s.jpNew} onPress={newJobHere} accessibilityRole="button">
            <View style={s.jpNewPlus}><Text style={s.jpNewPlusT}>+</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={s.jpNewT}>{T('assign.newHere')}</Text>
              <Text style={s.jpNewSub} numberOfLines={2}>
                {hereAddr
                  ? T({ k: 'jobpick.newPrefilled', p: { addr: hereAddr } } as any)
                  : T('jobpick.newSub')}
              </Text>
            </View>
            <Text style={s.jpChev}>›</Text>
          </Pressable>

          {!hero && !others.length && (
            <Text style={s.jpEmpty}>{T('jobpick.none')}</Text>
          )}

          {/* THE TIP CARD IS GONE (the artboard, 2026-09-02, which ends at the dashed
              row). It said the location can still be changed before sending — true, and
              worth saying, but it was saying it to a man who has not yet made the choice
              it is reassuring him about. Reassurance belongs where the regret is, and
              the regret is at REVIEW: `draft.nothingSentYet` is already there, on the
              screen he sends from, where changing his mind still costs nothing.

              Nothing was lost from the product, only from this screen. If the choice
              ever does become hard to reverse, this comment is the trail back. */}
        </ScrollView>
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
    /**
     * `termsRef`, NOT `terms` — and this is the bug hadar reported as "app gets stuck
     * on this when I try to add photos" (2026-08-21).
     *
     * The continuation handed to `openTerms` is THIS closure, captured in the render
     * where `terms` was false. `accept()` calls `setTerms(true)` and then invokes it
     * immediately — before React has re-rendered — so the closure still sees the old
     * `false`, calls `openTerms` again, and the consent screen reappears. Accept,
     * reappear, accept, reappear, forever.
     *
     * The other ten call sites pass `() => setShowCapture(true)`, which reads nothing,
     * which is why only the add-photos path looped. A ref is the fix because it is the
     * one thing that is current at CALL time rather than at render time.
     */
    // Resolves an unread flag rather than assuming the worst — see `gateTerms`. The
    // ref alone could not: it mirrors the same `boolean | null` and is false while
    // unknown, which is the loop this line was written to fix in the first place.
    if (terms === null) { void gateTerms(() => augmentExtra(changeOrderId)); return; }
    if (!termsRef.current) { openTerms(() => augmentExtra(changeOrderId)); return; }
    setAugmentCoId(changeOrderId);
    // THE FEED RETURN IS CANCELLED FIRST, and without this the camera never opens.
    // `closeRecord` sets `showFeed` when the record was opened from the company feed,
    // and the render cascade puts `if (showFeed)` ABOVE `if (showCapture)` — so the
    // feed wins the frame and the capture screen mounts behind it. `closeFeed` does
    // not clear `showCapture` either, so the camera then ambushes the user on the
    // next tab tap. We are not "going back" here; we are going forward into a
    // capture that lands on this same extra.
    returnToFeedRef.current = false;
    // Carry the flow across. Only when THIS record is the one the flow made — an
    // augment of some older extra opened from the list is not a review loop.
    if (flowRecordId === changeOrderId) flowResumeRef.current = changeOrderId;
    closeRecord();
    setShowCapture(true);
  };

  /** Open one of the extra's detail subscreens, seeding the editor buffers from the
   *  row that is on screen. Nothing is written until Save; backing out discards. */
  // DEV ONLY — open the history sheet over whatever record is showing. Assigned here
  // rather than in the mount effect above: `openDetail` is declared in this scope and
  // the effect's closure caught it before it existed.
  if (__DEV__) (globalThis as any).__history = () => openDetail('history');
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
  /**
   * DELETE AN EMPTY JOBSITE. Confirmed first, because it is irreversible — but a
   * light confirmation, not a scary one: there is nothing in it to lose, and the
   * sheet says so ("Nothing is saved in it") rather than warning about consequences
   * that do not exist.
   *
   * THE SERVER DECIDES whether it is really empty. The button is only OFFERED when
   * this device believes the job is empty, which is a hint, not the authority — a
   * capture filed from another phone a second ago is invisible here, and the RPC
   * re-checks inside the DELETE for exactly that.
   */
  const deleteJob = async (projectId: string, name: string) => {
    const r = await deleteEmptyProject(db, connector.client, projectId);
    if (r.ok) {
      // Back to the list first: the screen we are on is about a jobsite that no
      // longer exists, and leaving it up while its data drains is how a render
      // crashes on a row that is gone.
      setNav('jobs');
      setProjectId(INBOX_ID);
      setProjects(await listProjects(db));
      setAck({ kind: 'ok', title: T({ k: 'job.deleted', p: { name } } as any) });
      void refresh();
      return;
    }
    // NAME WHAT IS BLOCKING IT. "Already has work saved in it" is true and useless —
    // it sent hadar looking for change orders that were never there, when the answer
    // was photos.
    const holds = deleteHoldsKey(r);
    setAck({ kind: 'no', title: T(deleteRefusalKey(r) as any),
             detail: holds ? T(holds as any)
                   : 'detail' in r && r.detail ? r.detail : undefined });
  };

  /**
   * Delete a jobsite AND the photographs on it.
   *
   * hadar signed this off 2026-09-01 after four attempts to remove a test jobsite that
   * holds three photos. The refusal was correct and the outcome was still wrong: a
   * jobsite acquires ONE capture and becomes permanent, so a mistyped address with a
   * photo on it is in the account forever. Mandate #1 forbids SILENT loss; this is the
   * opposite of silent, and refusing to ever delete was not buying the mandate anything.
   *
   * THE COUNT IS SHOWN BEFORE THE DEED, from the local ledger so it works with no
   * signal, and the second tap is asked for separately. That sequence IS the exception:
   * take the number away and this is just deletion with extra words.
   *
   * IT GOES THROUGH `purgeProject` NOW, NOT `deleteProjectWithMedia`. The latter could
   * never have worked: `capture` carries an unconditional append-only trigger and
   * SECURITY DEFINER does not exempt a trigger, so every call threw. sql/437 opens one
   * audited door — a NOLOGIN role owning one function — and this is the only caller.
   * The reason string is what lands in the purge ledger beside the actor and the
   * capture ids, so it says where the request came from rather than "user request".
   */
  const deleteJobWithMedia = async (projectId: string, name: string, caps: number) => {
    const r = await purgeProject(db, connector.client, projectId,
                                 `owner deleted the jobsite from the app (${caps || 'unknown'} photos shown)`);
    if (r.ok) {
      setNav('jobs');
      setProjectId(INBOX_ID);
      setProjects(await listProjects(db));
      // THE SERVER'S COUNT, not the local one: it reports what it actually destroyed,
      // and a capture from another device that never reached this phone is still gone.
      // `keysLeft` is said out loud rather than swallowed — the rows are gone either way,
      // but bytes left in the bucket are a fact the person who asked for this should have.
      setAck({ kind: 'ok', title: T({ k: 'job.deleted', p: { name } } as any),
               detail: r.keysLeft > 0
                 ? T({ k: 'job.purgeKeysLeft', p: { n: r.keysLeft } } as any)
                 : r.captures > 0
                   ? T({ k: 'job.delMediaGone', p: { n: r.captures } } as any) : undefined });
      void refresh();
      return;
    }
    if (r.reason === 'has_commitment') {
      setAck({ kind: 'no', title: T('job.delNotEmpty'), detail: T('job.holdsCo') });
      return;
    }
    setAck({ kind: 'no', title: T(purgeRefusalKey(r) as any),
             detail: 'detail' in r && r.detail ? r.detail : undefined });
  };

  /**
   * Try the harmless delete, and OFFER the destructive one only if the server says the
   * job is not empty.
   *
   * THIS EXISTS BECAUSE THE LOCAL COUNT LIES BY OMISSION (hadar, 2026-09-01: "i deleted
   * SFO and it is still there"). `capture_commit` is created by raw DDL and never
   * synced — it is the ledger of captures THIS PHONE made. A capture taken on another
   * device, or before a local wipe, is on the server and absent from it. SFO's three
   * photos were exactly that, so `localCaptureCount` returned 0, the chain took the
   * empty path, and the server refused a jobsite the app had just promised was empty.
   *
   * So the routing decision moved to where the truth is. `deleteEmptyProject` is safe
   * to attempt blind: it deletes ONLY a genuinely empty jobsite and otherwise changes
   * nothing, so using it as the question costs a round trip and risks nothing.
   */
  const tryEmptyThenOfferMedia = async (projectId: string, name: string) => {
    const r = await deleteEmptyProject(db, connector.client, projectId);
    if (r.ok) {
      setNav('jobs');
      setProjectId(INBOX_ID);
      setProjects(await listProjects(db));
      setAck({ kind: 'ok', title: T({ k: 'job.deleted', p: { name } } as any) });
      void refresh();
      return;
    }
    if (r.reason === 'not_empty') {
      // The server knows WHAT is on it but does not send back a count, so this warning
      // names the thing without a number. A commitment is not offered a second chance
      // here — `delete_project_with_media_v1` refuses those, and this only ever reaches
      // a jobsite whose blocker was media.
      Alert.alert(
        T('job.delMediaTitleSome'), T('job.delMediaWarn'),
        [
          { text: T('common.cancel'), style: 'cancel' },
          { text: T('job.delMediaGoSome'), style: 'destructive',
            onPress: () => { void deleteJobWithMedia(projectId, name, 0); } },
        ],
      );
      return;
    }
    const holds = deleteHoldsKey(r);
    // SHOW THE ACTUAL ERROR when there is one. `detail` has always carried the server's
    // message and no branch has ever rendered it, so every genuine failure reads as the
    // same four words — "Could not delete. The job is still here." — and the one fact
    // that would explain it is discarded at the point of display. That cost a full round
    // of guessing at what the RPC was throwing (hadar, 2026-09-01).
    setAck({ kind: 'no', title: T(deleteRefusalKey(r) as any),
             detail: holds ? T(holds as any)
                   : 'detail' in r && r.detail ? r.detail : undefined });
  };

  /** The confirmation chain for Delete. The local count is a HINT that lets the warning
   *  carry a real number when this phone happens to know it; when it does not, the
   *  server is asked instead of guessed. Either way nothing is destroyed without a
   *  second, deliberate tap. */
  const askDeleteJob = async (projectId: string, name: string) => {
    const caps = await localCaptureCount(db, projectId);
    if (caps === 0) {
      Alert.alert(T('job.delete'), T({ k: 'job.delConfirm', p: { name } } as any), [
        { text: T('common.cancel'), style: 'cancel' },
        { text: T('job.delete'), style: 'destructive',
          onPress: () => { void tryEmptyThenOfferMedia(projectId, name); } },
      ]);
      return;
    }
    // STEP ONE states the loss in a number. It does not delete anything, and its
    // forward button says "Continue", not "Delete" — nobody should be able to destroy
    // three photographs by pressing the button they expected to be a confirmation.
    Alert.alert(
      T('job.delete'),
      T({ k: 'job.delWithMediaAsk', p: { name, n: caps } } as any),
      [
        { text: T('common.cancel'), style: 'cancel' },
        { text: T('common.continue'), onPress: () => {
          // STEP TWO is the deliberate one, and it names the number again so the
          // destructive tap is never made against a half-remembered figure.
          Alert.alert(
            T({ k: 'job.delMediaTitle', p: { n: caps } } as any),
            T('job.delMediaWarn'),
            [
              { text: T('common.cancel'), style: 'cancel' },
              { text: T({ k: 'job.delMediaGo', p: { n: caps } } as any), style: 'destructive',
                onPress: () => { void deleteJobWithMedia(projectId, name, caps); } },
            ],
          );
        } },
      ],
    );
  };

  const saveScope = async (changeOrderId: string, text: string) => {
    const ok = await saveScopeOfWork(db, changeOrderId, text);
    if (!ok) {
      // Routed to the acknowledgement popup as well as `filed`. `filed` is currently
      // WRITE-ONLY — nothing in this file renders it — so every refusal on this screen
      // was silent, which is the exact failure the confirmation is being added to end.
      // Left in place rather than removed: it is read by nothing today and its other
      // callers are on screens the popup is not mounted on.
      setFiled(T('erec.errSaveScope'));
      setAck({ kind: 'no', title: T('ack.notSaved'), detail: T('erec.errSaveScope') });
      return;
    }
    setDetail(null);
    await openRecord(changeOrderId);
    void refresh();
    setAck({ kind: 'ok', title: T('ack.description'), detail: firstLine(text) });
  };

  /** Rename the extra from the header — `change_order.scope`, the title only. */
  const saveTitle = async (changeOrderId: string, text: string) => {
    const ok = await retitleDraft(db, changeOrderId, text);
    if (!ok) {
      setFiled(T('erec.errSaveScope'));
      setAck({ kind: 'no', title: T('ack.notSaved'), detail: T('erec.errSaveScope') });
      return;
    }
    setDetail(null);
    await openRecord(changeOrderId);
    void refresh();
    setAck({ kind: 'ok', title: T('ack.title'), detail: firstLine(text) });
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
      setAck({ kind: 'no', title: T('ack.notSaved'), detail: T('erec.errPriceFirst') });
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
    // THE FIGURE, NOT "saved". Through `money()` — the one formatter — so the popup
    // cannot render a number in a shape the document never uses. The cap rides along
    // when there is one, because on a T&M extra the cap is the number that binds.
    const nte = d.priceMode === 'nte' ? centsFromInput(d.nteText) : null;
    setAck({
      kind: 'ok',
      title: T('ack.cost'),
      detail: nte == null ? money(amount)
        : `${money(amount)} · ${T({ k: 'ack.nte', p: { cap: money(nte) } } as any)}`,
    });
  };

  /**
   * Save ONE flow field from its drawer — schedule, billing or exclusions.
   *
   * Deliberately NOT `savePrice`: that path demands a price (and stamps the read-back
   * proof), so answering "does this move the schedule?" on an unpriced draft was
   * refused with "set a price first". `setDraftFlowFields` writes the three flow
   * columns and leaves the money alone. Still one guarded UPDATE per save.
   */
  const saveFlow = async (
    changeOrderId: string,
    d: NonNullable<typeof detail>,
    // WHICH SHEET SAVED. All three write the same row through the same call, so the
    // write cannot tell them apart — but the confirmation must, or every one of them
    // says the same thing and confirms nothing in particular. The call site is the only
    // place that knows, so it says so.
    field: 'schedule' | 'billing' | 'exclusions',
  ) => {
    const days = parseInt(d.scheduleDaysText, 10);
    const effDays = d.scheduleEffect === 'adds_days' && days > 0 ? days : null;
    const fin = await setDraftFlowFields(db, {
      changeOrderId,
      billingTiming: (d.billingTiming as BillingTiming) ?? null,
      scheduleEffect: (d.scheduleEffect as ScheduleEffect) ?? null,
      scheduleDays: effDays,
      exclusions: d.exclusions,
    });
    if (!fin.ok) { setUi({ k: 'refused', why: fin.reason }); return; }
    setDetail(null);
    await openRecord(changeOrderId);
    void refresh();
    // The echoed value comes from the SAME renderers the record and the client's
    // document use (billingSentence / scheduleSentence), not a second wording written
    // for the popup — so what he is told he saved is what the owner will read.
    const shown = field === 'billing' ? billingSentence(d.billingTiming)
      : field === 'schedule' ? scheduleSentence(d.scheduleEffect, effDays)
      : (d.exclusions.trim() ? firstLine(d.exclusions) : T('det.exclusionsNone'));
    setAck({
      kind: 'ok',
      title: T(field === 'billing' ? 'ack.billing'
             : field === 'schedule' ? 'ack.schedule' : 'ack.exclusions'),
      detail: shown,
    });
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
          <PhotoLightbox uri={zoomUri}
            uris={record.photos.filter((p) => p.present).map((p) => p.uri)}
            onClose={() => setZoomUri(null)} />
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


  /**
   * GUIDED STEPS 5, 7, 9 AND 10.
   *
   * Placed above `showCapture` deliberately: `gStep` is only ever set AFTER a capture
   * exists, so these cannot shadow the recorder — but they must beat the ordinary record
   * and home screens, which is what would otherwise render underneath.
   *
   * Every one of them writes through the SAME store calls the ordinary screens use
   * (`savePrice`, `saveFlow`, `sendPricedApproval`). The guided flow is a different way
   * of ASKING, never a second way of writing: a parallel writer is how two paths end up
   * disagreeing about what a change order is.
   */
  if (guidedOn && gStep && record) {
    const co = recordLc?.co;
    const jobName = projects.find((p) => p.id === projectId)?.name ?? '';
    const owner = recordLc?.clientRow ?? null;
    if (gStep === 'transcript') {
      return (
        <>
        {ackEl}
        <StepTranscript
          transcript={gTranscript}
          // The clip's own stamp, not "now" — this screen is read back later as often
          // as immediately, and a fresh timestamp on an hour-old recording is a lie.
          at={record.voices[0]?.at ?? record.capturedAt ?? ''}
          duration={record.voices.length ? T('gs.t.clip') : '—'}
          playing={gPlaying}
          onPlay={() => setGPlaying((v) => !v)}
          onEdit={() => { setGStep(null); openDetail('scope'); }}
          onNext={() => setGStep('gaps')}
        />
        </>
      );
    }
    if (gStep === 'gaps') {
      return (
        <>
        {ackEl}
        <StepGaps
          amountText={gAmount} onAmount={setGAmount}
          schedule={gSched} onSchedule={setGSched}
          days={gDays} onDays={setGDays}
          notes={gNotes} onNotes={setGNotes}
          priceAlreadyKnown={co?.amount_cents != null}
          onNext={() => void (async () => {
            if (!co) return;
            // ONE WRITE, through the ordinary writer. `priceDraftExtra` carries its own
            // draft-only guard and refreshes the queued payload; going around it would
            // mean the guided flow could produce a row the ordinary screens refuse.
            const cents = centsFromInput(gAmount);
            if (cents === null) { setAck({ kind: 'no', title: T('erec.errPriceFirst') }); return; }
            const days = parseInt(gDays, 10);
            const fin = await priceDraftExtra(db, {
              changeOrderId: co.id, amountCents: cents, nteCents: null,
              lineItems: co.lineItems,
              billingTiming: (co.billing_timing as BillingTiming) ?? null,
              scheduleEffect: (gSched === 'none' ? 'no_change'
                : gSched === 'adds' ? 'adds_days' : 'not_sure') as ScheduleEffect,
              scheduleDays: gSched === 'adds' && days > 0 ? days : null,
              exclusions: gNotes.trim() || co.exclusions || null,
              whoDirected: co.who_directed || 'Owner',
              numbersConfirmedAt: new Date(),
            });
            // The refusal is SHOWN. `setUi({k:'refused'})` renders nowhere in this
            // app — it only drives haptics and the record button's label — so using it
            // here made a rejected write indistinguishable from a dead button.
            if (!fin.ok) {
              setAck({ kind: 'no', title: T('gs.g.notSaved'), detail: fin.reason });
              return;
            }
            await noteActorNow(db, { subjectKind: 'change_order', subjectId: co.id, act: 'priced' });
            await openRecord(co.id);
            // No owner yet -> the roster sheet, which is step 8 and already exists.
            if (!owner) { setClientOpen('client'); setGStep(null); return; }
            setGStep('review');
          })()}
        />
        </>
      );
    }
    if (gStep === 'review') {
      return (
        <>
        {ackEl}
        {/* The walkthrough is its own early return and mounts none of the modals below,
            so a first-time contractor whose very first send hits the gate would otherwise
            watch the button stop working with no explanation at all. */}
        {heldEl}
        {/* WITHOUT THIS the out-of-credits modal's Buy is dead on this screen: it sets
            `showPaywall`, and the paywall only exists where it is mounted. */}
        {paywallEl}
        <StepReview
          // The stored sentinel is the string 'Owner'; what a person READS is
          // translated. See `client.unnamed` for why the two must stay apart.
          toName={owner?.name ?? recordLc?.view.requestedBy ?? T('client.unnamed')}
          toAddr={owner?.phone ?? null}
          jobName={jobName}
          scope={record.title}
          price={record.priced ? record.amount : money(co?.amount_cents ?? null)}
          schedule={scheduleSentence(co?.schedule_effect ?? null, co?.schedule_days ?? null)
            ?? T('elock.schedNotStated')}
          sending={gSending}
          onBack={() => setGStep('gaps')}
          onSend={() => void (async () => {
            const row = coRowsRef.current.find((c) => c.id === record.id);
            if (!row) return;
            setGSending(true);
            // The ORDINARY sender. Mandate #2's confirmation is this screen; the act
            // behind it must be the same act every other path performs.
            //
            // AND THE SENT SCREEN ONLY SHOWS IF IT SENT. The `finally` used to fall
            // through to step 10 whether or not the send threw, which would have told a
            // first-time user his change order was on its way when it was not — the one
            // claim this product cannot get wrong.
            try {
              // THE OUTCOME IS READ. "Did not throw" is no longer the same as "sent":
              // a held send returns `sent: false` and its own prompt is already on
              // screen, so stepping to 'done' here would put "it's on its way" over a
              // change order still sitting on the phone.
              const out = await sendPricedApproval(row, owner as any);
              if (out.sent) setGStep('done');
            } catch (e: any) {
              setAck({ kind: 'no', title: T('gs.r.failed'), detail: String(e?.message ?? e) });
            } finally { setGSending(false); }
          })()}
        />
        </>
      );
    }
    return (
      <StepDone
        toName={owner?.name ?? T('client.unnamed')}
        onView={() => { setGStep(null); setGuidedOn(false); void markFirstExtraSeen(db); setNav('home'); }}
        onAnother={() => {
          setGStep(null); setGuidedOn(false); void markFirstExtraSeen(db);
          if (!terms) { openTerms(() => setShowCapture(true)); return; }
          setShowCapture(true);
        }}
      />
    );
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
        // The invite act, reachable from where he is rather than only from the send
        // sheet. Same function, same cap check, same share sheet.
        onInvite={() => { void inviteFromSend(); }}
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
          onSave={(v) => { void saveFlow(record.id, { ...sd, ...v }, 'schedule'); }}
        />}
        {sheetField === 'billing' && <BillingSheet
          visible
          editable={sheetsEditable}
          billingTiming={sd.billingTiming}
          onClose={closeSheet}
          onSave={(v) => { void saveFlow(record.id, { ...sd, ...v }, 'billing'); }}
        />}
        {sheetField === 'exclusions' && <ExclusionsSheet
          visible
          editable={sheetsEditable}
          exclusions={sd.exclusions}
          onClose={closeSheet}
          onSave={(v) => { void saveFlow(record.id, { ...sd, ...v }, 'exclusions'); }}
        />}
      </>
    ) : null;
    return (
      <>
      {clientSheet}
      {sheets}
      <RecordScreen
        /* Step 5 of 5, and only on the record the flow just made. Compared by id so the
           rail cannot outlive the journey — see `flowRecordId`. */
        inFlow={!!record && record.id === flowRecordId}
        openMessages={openMessagesNonce}
        unreadMessages={record ? (unreadMsgs.get(record.id) ?? 0) : 0}
        /* Opening the conversation is seeing it. Without this the badge would still
           claim a message was waiting after he had just read it — and a count that does
           not clear trains the reader to ignore it, which would cost the header bell
           its meaning too, since they share a colour. */
        onMessagesSeen={async () => {
          if (!record) return;
          const ids = unreadMessageIdsFor(activity, record.id);
          if (!ids.length) return;
          await markRead(db, ids);
          await refresh();          // rebuilds `activity` with the new read-state
        }}
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
          // The URL itself, so the waiting card can offer it for an email. Same link
          // Remind texts — `liveLinkFor` reads the one live token.
          linkUrl: recordLc.linkUrl,
        }}
        approval={approval}
        thread={recordThread}
        openQuestions={questions[record.id] ?? 0}
        undelivered={recordUndelivered}
        onBack={closeRecord}
        onCapture={() => augmentExtra(record.id)}
        // The composer's own mic used to point here too. It does not any more: it runs
        // live dictation into the reply field (livedictation.ts), which is what a
        // microphone in a message box should do. `augmentExtra` — the fused capture
        // screen that adds voice or photos to the RECORD — keeps this door and the two
        // on the locked screen, so nothing was removed, only un-crossed.
        delivery={recordDelivery}
        writeUp={recordWriteUp}
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
          /**
           * THE TOTAL IS THE SUM OF THE PRICED SEGMENTS, and the segments are shown so
           * the sum can be checked (hadar, 2026-08-21).
           *
           * The segment reading wins whenever it produced a figure, because it is the
           * one that read the WHOLE recording: `record.priceHeard` is a single span and
           * on a multi-segment job it is a fraction of the price wearing the total's
           * label. The single-span parse stays as the fallback for everything the model
           * did not segment — a short "it's four hundred bucks" still works exactly as
           * it did.
           *
           * WHAT IS NOT CHANGING: nothing is written until he presses. The figure is
           * arithmetic over numbers HE said, parsed by our parser and never authored by
           * the model, and `numbers_confirmed_at` is still stamped by that press and
           * still gates Send (mandates #2 and #6). What the press no longer is, is a
           * separate act of stating a total — the total is now derived from the lines,
           * which is also what `validateLines` has always required of it.
           */
          const seg = recordPrice;
          if (seg && seg.prefill && seg.amountCents !== null && seg.breakdown.length > 1) {
            const cents = seg.amountCents;
            const lines: LineItem[] = seg.breakdown.map((b) => ({
              description: b.title, qty: 1,
              unit_cents: b.cents, total_cents: b.cents,
            }));
            return {
              words: seg.heard ?? '',
              label: money(cents),
              // Each segment with its own figure, above the total. He confirms the
              // PARTS — a total he has to take on trust is the thing mandate #6 exists
              // to prevent, and three lines he can check is not that.
              breakdown: seg.breakdown.map((b) => ({ title: b.title, amount: money(b.cents) })),
              onUse: async () => {
                const co = coRowsRef.current.find((c) => c.id === record.id);
                const r = await priceDraftExtra(db, {
                  changeOrderId: record.id,
                  amountCents: cents,
                  lineItems: lines,
                  // A CAP STAYS A CAP. `priceFromTasks` reads the total as NTE if ANY
                  // segment was capped, because a sum containing a cap is not firm.
                  // Recording it as a fixed price would put a number on an instrument
                  // the contractor cannot hold — the more dangerous of the two errors —
                  // so the cap is carried through and `nteClause` states it on the
                  // document.
                  nteCents: seg.mode === 'nte' ? cents : null,
                  whoDirected: co?.who_directed || 'Owner',
                  numbersConfirmedAt: new Date(),
                  onlyIfUnpriced: true,
                });
                // A refusal here used to be swallowed. `validateLines` can reject this
                // (a rounding gap between the lines and the sum) and a silent no leaves
                // him tapping a button that does nothing — the failure this project
                // keeps re-learning.
                if (!r.ok) { setAck({ kind: 'no', title: T('ack.notSaved'), detail: r.reason }); return; }
                await refresh();
                await openRecord(record.id);
              },
            };
          }
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
        photoDone: 0, photoTotal: 0, voiceDone: 0, voiceTotal: 0,
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
        onReply={async (text: string, captureIds: readonly string[]) => {
          const pr = await postReply(db, {
            changeOrderId: record.id, body: text, ownerId: OWNER, captureIds,
          });
          // postReply reports failure as a value, not a throw. Throwing here is what
          // keeps the typed words in the composer and puts the reason on screen.
          if (!pr.ok) throw new Error(pr.reason);
          setRecordThread(await threadFor(db, record.id));
          setRecordUndelivered(await undeliveredReplyIds(db));
          // The message is already durable and already queued. Its PHOTOS catch up on
          // their own — deliberately not awaited, and deliberately allowed to fail:
          // mandate #7 says the reply must not depend on signal, and a composer that
          // waited on Storage would make "sent" mean something different in a
          // basement. Until this lands, the bubble says the photo is on this phone
          // only, which is the truth.
          // .catch LAST: placed before .then it changed the resolved type to
          // `void | ReplyMediaReport` and the success handler stopped type-checking.
          void publishReplyMedia(db, connector.client, { ownerId: OWNER })
            .then((rep) => { if (rep.published > 0) void refresh(); })
            .catch(() => { /* the drain retries it; never a rejection into the UI */ });
          void refresh();
        }}
        // THE MESSAGE CAMERA (hadar, 2026-08-09). One touch, one photo, committed
        // through the same durable path as every other capture — so it is
        // recoverable before the composer shows it (mandate #1) and it rides the
        // outbox that already works. It is NOT `onCapture`: nothing here touches
        // `decision_version` or `capture_pair`, which is exactly what keeps it out
        // of the extra's evidence grid and out of the document the client signs.
        onSnapPhoto={async () => {
          const picked = await snapPhoto();
          // Cancelled or refused. The camera closing is the feedback; a toast here
          // would be an error message for a decision the user just made.
          if (!picked.ok) return null;
          const stamp = await stampNow();   // mandate #9: stamped like any other photo
          const r = await performCapture(db, {
            // The extra's own job, from the lifecycle layer — NOT the app's
            // currently-selected job. A record opened from Home can belong to a
            // different job than the one on screen, and filing the photo to the
            // wrong project would put it under the wrong client's RLS.
            ownerId: OWNER, projectId: recordLc?.co?.project_id ?? projectId,
            input: picked.input, stamp,
          });
          if (!r.ok) throw new Error(r.reason);
          return r.captureId;
        }}
        /**
         * THE ROLL, for a message. The same commit path as the camera above — a picked
         * photo is stamped and committed like any other capture (mandate #9) before its
         * id ever reaches the composer, so the composer never holds undurable bytes.
         *
         * `fromLibrary` is what the stamp carries honestly: this photo was taken at a
         * time and place this app cannot vouch for, and the record says so rather than
         * implying the contractor shot it on site just now.
         */
        onPickPhoto={async () => {
          const picked = await pickFromLibrary();
          if (!picked.ok) return null;
          const stamp = await stampNow();
          const r = await performCapture(db, {
            ownerId: OWNER, projectId: recordLc?.co?.project_id ?? projectId,
            input: picked.input, stamp,
          });
          if (!r.ok) throw new Error(r.reason);
          return r.captureId;
        }}
        /**
         * R8: remind. The verdict above decides whether the button is live; this is
         * the act, and `remindExtra` re-checks and returns its own refusal (no live
         * link, rate limit, a cancelled share sheet).
         *
         * THE OUTCOME GOES TO THE ACK POPUP (hadar, 2026-08-15: "after a reminder it
         * needs to have some sort of bottom popup notifying the user if it succeeded
         * or not — right now nothing is showing up").
         *
         * It used to go to a caption inside the waiting card, which is invisible: the
         * tap that texts a client and the tap that does nothing at all looked
         * identical on a screen he is reading at arm's length in daylight. A
         * reminder is a message to another human — the app does not get to be quiet
         * about whether it went.
         *
         * A SUCCESS AUTO-DISMISSES; A REFUSAL WAITS. Same rule as every other ack
         * here: news he expected costs no tap (mandate #3), and a reason that
         * vanishes on its own is a reason nobody read.
         */
        onRemind={async () => {
          const r = await remindExtra(
            { id: record.id, status: record.status, scope: record.title, amount: record.amount },
            (questions[record.id] ?? 0) > 0);
          if (!r.ok) {
            setAck({ kind: 'no', title: T('r8.ackFailed'), detail: r.why ?? null });
          } else if ((r.sent ?? 0) > 0) {
            setAck({ kind: 'ok',
              title: (r.sent ?? 0) === 1
                ? T('r8.ackTexted')
                : T({ k: 'r8.ackTextedN', p: { n: String(r.sent) } } as any),
              detail: T('r8.ackSameLink') });
          } else {
            // It went out, but by his own hand through the share sheet — and the
            // reason the automatic path could not be used is the useful half.
            setAck({ kind: 'ok', title: T('r8.ackByHand'), detail: r.why ?? null });
          }
          return r;
        }}
        // REQ-LC22. `threadState.canRevise` (which is `canSupersede`) decides inside
        // the screen; the old `canSupersede(record.status) && row` here was that rule
        // stated twice, and the `row` half of it silently removed Revise from every
        // record opened cross-project.
        onRevise={() => {
          const c = recordLc?.co;
          if (!c) { setFiled(T('erec.errStillLoading')); return; }
          closeRecord(); startRevision(c);
        }}
        /**
         * WITHDRAW (421). Offered only while the extra is genuinely `sent`: the server
         * refuses anything else, and an affordance that always fails is worse than one
         * that is absent. The confirmation is mandatory and states the two consequences
         * he cannot see — the link dies, and everyone gets a text — because this cannot
         * be undone (mandate #2: nothing carrying a commitment moves unasked).
         */
        onWithdraw={record.status === 'sent'
          ? () => {
              const id = record.id;
              Alert.alert(
                T('cancel.confirmH'), T('cancel.confirmBody'),
                [
                  { text: T('common.cancel'), style: 'cancel' },
                  { text: T('cancel.confirmYes'), style: 'destructive',
                    onPress: () => { closeRecord(); void withdrawExtra(id, null); } },
                ],
              );
            }
          : undefined}
        onOpenDetail={(field) => openDetail(field)}
        /**
         * PICKING A PRICING MODE opens the cost editor already switched to it, rather
         * than writing anything here. `authorize` seeds the editor with `fixed` and an
         * EMPTY amount: that state IS the authorize case — an extra with no figure is
         * only a RECOMMENDED gap, never a blocker, so it sends as "the owner authorises
         * the work and the price follows". Clearing a price is a money change and gets
         * the same editor, the same read-back and the same Save as setting one.
         */
        onPickPriceMode={(m) => {
          openDetail('cost');
          setDetail((d) => (d && d.field === 'cost'
            ? { ...d,
                priceMode: m === 'nte' ? 'nte' : 'fixed',
                ...(m === 'authorize' ? { amountText: '', nteText: '' } : {}),
                ...(m === 'fixed' ? { nteText: '' } : {}) }
            : d));
        }}
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
        /**
         * "CREATE ANOTHER EXTRA" IS NOW CAPTURE, NOT A BLANK ROW (hadar, 2026-08-18:
         * it "should take the user to the home page, and invoke the record extra work
         * button").
         *
         * It used to call `createFollowOnExtra`, which mints an origin-linked row
         * (REQ-LC31/D6) and drops you into an EMPTY draft. That is the wrong shape for
         * what a contractor is doing at this moment: he is standing in front of more
         * work, and this product's whole claim is capture-first — say it or snap it, and
         * the write-up follows. A blank form asks him to type.
         *
         * SAME FUNCTION AS THE ⊕ BUTTON, not a copy of it: the terms gate has to be
         * checked before the camera opens, and a second call site that forgot it would
         * open the shutter on someone who has never accepted the terms.
         *
         * WHAT THIS GIVES UP, stated: the new extra carries NO origin link back to this
         * approved one. `createFollowOnExtra` is still there and still the only writer of
         * that link — nothing about REQ-LC31 changed — but nothing calls it from here
         * any more, so a follow-on captured this way is an independent extra. If the
         * lineage matters more than the capture flow, this is the line to revisit.
         */
        onCreateLinkedExtra={() => {
          closeRecord();
          setNav('home');
          if (!terms) { openTerms(() => setShowCapture(true)); return; }
          setShowCapture(true);
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
      {/* THE HISTORY, AS A SHEET OVER THE RECORD (2026-08-14). It used to be returned
          from the detail router as a whole SCREEN, which meant looking up what happened
          to an extra replaced the extra. A sheet cannot be returned that way — a modal
          rendered on its own dims a screen that is no longer mounted — so it moved here,
          beside the record it is about. Every caller (the Activity sheet, the ⋯
          overflow, the version row, the sealed record) is unchanged: they all just say
          "show the history". */}
      {detail?.field === 'history' && (
        <FullHistory
          status={record.status}
          events={recordTimeline}
          formatAt={createdLabel}
          approval={approval}
          total={record.priced ? record.amount : null}
          scheduleLine={scheduleSentence(recordLc?.co?.schedule_effect ?? null,
                                         recordLc?.co?.schedule_days ?? null)}
          onBack={() => setDetail(null)}
        />
      )}
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
      {/* LAST. It is an overlay, not a modal, so paint order IS its z-order — declared
          before RecordScreen it would render behind the screen it is confirming. */}
      {ackEl}
      </>
    );
  }

  // ── THE ONE BOTTOM NAV ────────────────────────────────────────────────────
  // Home · Jobs · + (capture) · Company · Activity. Defined once so every screen that
  // shows it (Feed, Home, Jobs, Job) can never drift. Declared HERE, above the first
  // screen that renders it (the feed), because a `const` is not hoisted — a use before
  // this line is a temporal-dead-zone crash. `absolute` pins it over a plain-View
  // screen (the Job screen); the others use it as a flex child at the column's foot.
  /**
   * THE ONE DASHBOARD HEADER — Home, Jobs and Company (hadar, 2026-08-12: "the home
   * header needs to be the same in jobs, company should have the hamburger and the
   * notification").
   *
   * They had drifted into three different shapes: Home had menu + bell, Company had
   * menu and an empty spacer where the bell belongs, and Jobs had neither — a blank
   * on the left and a ＋ on the right. So the drawer and the activity centre appeared
   * and disappeared depending on which tab you were standing on, which is the kind of
   * thing that teaches someone the app is unreliable rather than that a button moved.
   *
   * `extra` is for a screen's own action (Jobs' ＋). It sits INSIDE the right group,
   * before the bell, so the bell is always the last thing on the row and the thumb
   * learns one place for it.
   */
  const dashHeader = (title: string, extra?: React.ReactNode) => (
    <View style={s.dashHdr}>
      {/* DRAWER LEFT, TITLE CENTRED, ACTIONS RIGHT — one header on Home, Jobs and
          Company (hadar, 2026-08-12). The three had drifted apart: Home had drawer +
          bell, Company had a drawer and an empty spacer, Jobs had neither. Right-hand
          side is the screen's own action (Jobs' ＋) then the bell, and the bell is
          LAST everywhere so the thumb learns one position for it. */}
      <Pressable style={s.hdrBtn} onPress={() => setMenuOpen(true)}
        accessibilityLabel={T('home.menu')} hitSlop={10}>
        <Text style={s.hdrIcon}>☰</Text>
      </Pressable>
      <Text style={s.hdrTitle} numberOfLines={1}>{title}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {extra}
        <Pressable style={s.hdrBtn} hitSlop={10}
          accessibilityLabel={T('r8.activity')}
          onPress={async () => {
            // A SCREEN, not the old scrim card. Notifications is a place you go and
            // can come back to, so it gets an address in the nav rather than being a
            // sheet that eats the screen and loses your place when it closes.
            closeFeed(); setNav('notifications');
            setNotifyPerm(await notifyPermissionStatus());
          }}>
          <Icon name="remind" size={22} color="#151A1E" />
          {unreadCount(activity) > 0 && (
            <View style={s.hdrBadge}><Text style={s.hdrBadgeT}>{unreadCount(activity)}</Text></View>
          )}
        </Pressable>
      </View>
    </View>
  );

  const bottomNav = (active: 'home' | 'jobs' | 'activity' | 'company' | 'notifications' | null, absolute: boolean) => (
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
          {/* STROKE GLYPHS HERE, NOT THE TWO-TONE DROP. The drop's nav art is
              pre-coloured and cannot show selected/unselected — and the design's own
              render uses outlines that turn green with a bar under the label, which
              is a state a contractor can see at a glance in sunlight. The artwork
              stays in the kit for the letterhead, where it is a logo, not a state. */}
          <Icon name="home" size={23} color={active === 'home' ? '#2F5233' : '#7A8085'} />
          <Text style={[s.tabLab, active === 'home' && s.tabLabOn]}>{T('home.navHome')}</Text>
          {active === 'home' && <View style={s.tabUnder} />}
        </Pressable>
        <Pressable style={s.tab} accessibilityLabel={T('home.navJobs')}
          onPress={() => { closeFeed(); setNav('jobs'); void refresh(); }}>
          <Icon name="job" size={23} color={active === 'jobs' ? '#2F5233' : '#7A8085'} />
          <Text style={[s.tabLab, active === 'jobs' && s.tabLabOn]}>{T('home.navJobs')}</Text>
          {active === 'jobs' && <View style={s.tabUnder} />}
        </Pressable>
      </View>
      <Pressable style={[s.fab, (!!gate || !!initError) && s.fabOff]}
        disabled={!!gate || !!initError} hitSlop={8}
        accessibilityLabel={T('home.recordExtra')}
        onPress={() => { if (!terms) { openTerms(() => setShowCapture(true)); return; } setShowCapture(true); }}>
        {/* A FILLED DARK PUCK WITH A WHITE MIC (hadar, 2026-08-27: "make the + circle
            bigger and darker with a white mic inside").

            THIS REVERSES AN EARLIER DECISION, and the earlier reasoning is worth
            keeping visible rather than deleting: the ring was outlined precisely so
            "a solid puck in the middle of the bar" would not outrank each screen's
            own primary action. hadar has now asked for the opposite, and he is
            looking at the real thing on a real phone — on a jobsite, in sunlight,
            the outlined version reads as a disabled control rather than as the one
            button the whole product exists to offer.

            THE MIC LEADS AND THE + QUALIFIES. The + alone said "add something"
            without saying what; the mic is the promise — talk — and the small +
            keeps "this makes a new one". White on ink-green is the highest contrast
            pair available here, which is the point of the change. */}
        <View style={s.fabGlyph}>
          <Icon name="micLine" size={30} color="#FFFFFF" />
          {/* SUPERSCRIPT, not a sibling (hadar's reference shot, 2026-08-27). Side by
              side they read as two controls — "a mic" and "an add" — and the eye has to
              decide which one it is about to press. Hung off the mic's shoulder they are
              one mark that means "a new one, by talking". */}
          <View style={s.fabPlus}>
            <Icon name="extra" size={13} color="#FFFFFF" />
          </View>
        </View>
      </Pressable>
      <View style={s.tabHalf}>
        {/* THE COMPANY STREAM HOLDS THIS SLOT (hadar, 2026-08-12: "in the bottom menu
            we should have company stream at the bottom not alerts"). I had given it to
            notifications earlier the same day, reading the design's fourth glyph as a
            bell. Wrong call, and the reason it is wrong is worth keeping: NOTIFICATIONS
            ALREADY HAVE A DOOR ON EVERY SCREEN — the header bell, with the same unread
            badge — so putting them here spent a permanent tab on a second entrance to
            one place. The stream has no other standing entrance. A tab is for a place
            you go; a bell is for something arriving.
            The ☰ drawer's "Company feed" row stays: harmless, and it is the drawer's
            job to list every destination whether or not it also has a tab. */}
        <Pressable style={s.tab} accessibilityLabel={T('feed.title')}
          onPress={() => void openFeed()}>
          <Icon name="feed" size={23} color={active === 'company' ? '#2F5233' : '#7A8085'} />
          <Text style={[s.tabLab, active === 'company' && s.tabLabOn]}>{T('home.navCompany')}</Text>
          {active === 'company' && <View style={s.tabUnder} />}
        </Pressable>
        {/* Profile opens the ☰ drawer (the account / settings / plan / support hub).
            It is an OVERLAY, not a destination, so it never carries an `active` state —
            the drawer element is mounted on every screen that renders this bar. */}
        <Pressable style={s.tab} accessibilityLabel={T('home.navProfile')}
          onPress={() => setMenuOpen(true)}>
          <Icon name="person" size={23} color="#7A8085" />
          <Text style={s.tabLab}>{T('home.navProfile')}</Text>
        </Pressable>
      </View>
    </View>
  );

  // The ☰ drawer, defined ONCE and mounted on every screen that shows the bottom bar —
  // because the Profile tab (which opens it) lives in that shared bar. Previously the
  // drawer was only on Home and the Company feed, so a Profile tap from Jobs or a Job
  // screen would have opened nothing.
  /**
   * The drawer AND the sheets it opens, as one element.
   *
   * `logoEl` is bundled in here rather than mounted screen by screen for the reason
   * this file has already paid for twice (the drawer's Upgrade row, then swipe-delete):
   * the drawer is reachable from six screens, `setLogoSheet(true)` only flips state, and
   * on any screen where the sheet is not in the tree the tap is a dead button. One
   * element, one mount site, and the two cannot drift apart.
   */
  /**
   * `onCompanyFeed`, `onInbox` and `inboxCount` were removed here on 2026-08-12 with
   * their drawer rows. The feed keeps its bottom-nav tab and loses nothing.
   *
   * THE INBOX LOSES EVERYTHING, and that is worth writing down rather than discovering
   * later. `if (inboxOpen)` below is still written and still correct, and nothing can
   * now set `inboxOpen`: the only other caller sits inside the `not_safe` status banner
   * and tests `screen.level === 'needs_you'` within a branch already guarded on
   * 'not_safe', so it has never once been reachable. Unfiled captures are mandate #1
   * material, so the screen is PARKED, not deleted — it needs a door somebody chose,
   * not a third one invented here.
   */
  /**
   * CLOSING THE ACCOUNT — the confirmation, and what it is honest about.
   *
   * IT STATES WHAT SURVIVES. Mandate #5's erasure carve-out keeps a hash + metadata
   * stub, and a client may already hold a signed copy of an approved change order.
   * "Everything is gone" is the easy sentence and a false one.
   *
   * IT WARNS ABOUT THE SUBSCRIPTION RATHER THAN BLOCKING ON IT. Apple owns the
   * subscription (3.1.2) and deleting the data while it renews is a genuinely bad
   * combination — but refusing to delete until they cancel would trap somebody inside
   * a paid account, which is the exact complaint that started this. So a paying user
   * is told, in the body, that cancelling is a separate act done in the App Store, and
   * the confirm still works.
   */
  const closeAcctEl = closeAcct ? (
    <ConfirmSheet
      visible
      title={T('set.closeTitle')}
      body={planId === 'free'
        ? T('set.closeBody')
        : `${T('set.closeBody')}\n\n${T('set.closeHasPlan')}`}
      confirmLabel={T('set.closeConfirm')}
      cancelLabel={T('common.cancel')}
      busy={closeAcct.busy}
      onClose={() => { if (!closeAcct.busy) setCloseAcct(null); }}
      onConfirm={() => void (async () => {
        setCloseAcct({ busy: true });
        const r = await closeMyAccount(connector.client, db, OWNER);
        setCloseAcct(null);
        if (!r.ok) { setAck({ kind: 'no', title: T('set.closeFailed'), detail: r.reason }); return; }
        // The sign-out waits for the ack to be dismissed. Doing it here would unmount
        // the overlay in the same tick and drop them at the login screen with no word
        // about what just happened to their data.
        const bye = () => { void connector.signOut(); };
        if (r.mediaLeft > 0) {
          // A partial sweep is reported, not rounded up to success. Photos surviving in
          // the bucket after "your account is closed" is the same dishonest
          // acknowledgement mandate #1 forbids, pointed the other way.
          setAck({ kind: 'no', title: T('set.closedTitle'),
                   detail: T('set.closedPartial').replace('{n}', String(r.mediaLeft)),
                   then: bye });
        } else {
          setAck({ kind: 'ok', title: T('set.closedTitle'), then: bye });
        }
      })()}
    />
  ) : null;

  const drawerEl = (
    <>
    {logoEl}
    {closeAcctEl}
    <Drawer
      visible={menuOpen}
      onClose={() => setMenuOpen(false)}
      onProfile={() => void openSettings('profile')}
      onCompanySettings={() => void openSettings('company')}
      onPlans={() => void openPaywall()}
      planName={T(('plan.' + planId) as any)}
      usage={usage}
      isFreePlan={planId === 'free'}
      // The Company entry follows OWNERSHIP, not team size — see the note at
      // `setHasTeam`. A solo contractor needs the letterhead behind this row.
      isOwner={isOwner} hasTeam={hasTeam}
      logoUri={logoUri}
      companyName={co?.name ?? null}
      canEditLogo={isOwner}
      onLogoPress={() => setLogoSheet(true)}
      appVersion={(appJson as any)?.expo?.version ?? '1.0.0'}
      syncLabel={syncLabel ?? undefined}
      buildLabel={buildLine({
        version: (appJson as any)?.expo?.version ?? '1.0.0',
        updateId: ota.updateId,
        embedded: ota.embedded,
      })}
      updateReady={ota.canRestart}
      onApplyUpdate={() => { setMenuOpen(false); void ota.restart(db); }}
      onCheckUpdates={ota.checkNow}
      onSignOut={async () => { setMenuOpen(false); await connector.signOut(); }}
      unsent={unsentWork}
      /**
       * THE ANSWER TO "WHO AM I SIGNED IN AS" — and until 2026-08-21 the app had none.
       *
       * Supabase stores the phone WITHOUT its leading '+', so it is put back before
       * `displayPhone` groups it; an ungrouped 11-digit run is not proof-readable, and
       * proof-reading is the entire job of this line. Email is the fallback for an
       * account that signed in that way; null shows nothing rather than "unknown".
       */
      account={session?.user?.phone
        ? displayPhone(`+${String(session.user.phone).replace(/\D/g, '')}`)
        : (session?.user?.email ?? null)}
      companies={companies}
      activeCompanyId={co?.id ?? null}
      /**
       * SWITCHING RE-KEYS BILLING. The RevenueCat customer IS the tenant id, so a
       * switch that changed only what the app displayed would leave purchases attached
       * to the company he just left — and the plan he is entitled to is the ACTIVE
       * tenant's, not the last one he happened to open.
       */
      onSwitchCompany={(id) => void (async () => {
        await setActiveCompany(db, id);
        await configureBilling(id);
        const co2 = await myCompany(db, OWNER);
        setCo(co2 ? { id: co2.id, name: co2.name } : null);
        setIsOwner(!!co2?.isOwner);
        setPlanId(await currentPlan(db));
        setMenuOpen(false);
        await refresh();
      })()}
      onCloseAccount={() => setCloseAcct({ busy: false })}
      devTools={devTools}
      onShowIntro={() => setForceIntro(true)}
      /**
       * REPLAY THE WALKTHROUGH — WITHOUT SIGNING OUT (hadar, 2026-08-13).
       *
       * It used to sign out, on the reasoning that a "first run" starts logged out. In
       * practice that made every single test cycle cost a fresh magic link, and Supabase
       * rate-limits those: "login → drawer → simulate → create your account → too many
       * tries" was the loop, and the tool caused the error it was being used to reach.
       *
       * Signing out buys ONE thing — the pre-login intro — and that already has its own
       * door ("Show intro (dev)") which renders over any auth state. So this now resets
       * the flags and opens the guided first change order in place. Testing the genuinely
       * logged-out path is still possible: Sign out is three rows below.
       */
      onSimulateFirstRun={() => void (async () => {
        await resetFirstRunFlags(db);
        setFirstRun(true); setFirstExtra(true);
        setGuided(null); setGuidedOn(false); setGStep(null);
        setMenuOpen(false);
        setForceFirstExtra(true);
      })()}
    />
    </>
  );

  /**
   * WHERE AN EXTRA STANDS, in the five words the UI is allowed to use.
   *
   * Hoisted above the Company feed (2026-08-12) so both screens read ONE definition.
   * It used to sit beside `extraRow`, several hundred lines below the feed's early
   * return — out of reach by the temporal dead zone, which is exactly why the feed grew
   * its own `coChip(displayStatus(...))` vocabulary instead. Two status vocabularies on
   * two screens listing the SAME rows is how "Waiting" on one becomes "Sent" on the
   * other, and neither is wrong enough to notice.
   *
   * Note `questions > 0` outranks 'sent': an extra the client has asked something about
   * is in YOUR court, not theirs, whatever the status column says.
   */
  /**
   * `cancelled` IS NAMED, because the fall-through lied about it (hadar, 2026-08-24:
   * "if a CO was declined or canceled we need a section to host them or a TAG").
   *
   * Everything unmatched here ends at `questions > 0 ? 'needs' : 'waiting'`, so a
   * withdrawn extra wore the Waiting chip and sat under "Waiting for a yes" — telling
   * the contractor he is waiting on a client he has just told to stop looking. A new
   * terminal status that is not listed becomes a lie about the one state it is not.
   */
  /**
   * ONE TABLE, NOT THREE CHAINS (2026-08-24). This was a chain of `if`s ending in
   * `questions > 0 ? 'needs' : 'waiting'`, which silently absorbed every status nobody
   * remembered — `cancelled` and `superseded` both read as "waiting for a yes". See
   * `extrabucket.ts` for the three defects that came out of that default and why the
   * answer is an exhaustive `Record` TypeScript can refuse.
   */
  const stateKey = (status: string, questions: number) => extraState(status, questions);
  const stateColor: Record<string, { bg: string; fg: string; emoji: string; label: string }> = {
    waiting:  { bg: 'rgba(164,122,63,0.13)', fg: '#A47A3F', emoji: '⏳', label: T('act.chipWaiting') },
    needs:    { bg: 'rgba(109,127,137,0.14)', fg: '#5E7079', emoji: '💬', label: T('act.chipNeeds') },
    approved: { bg: '#E7ECDD',                fg: '#536B49', emoji: '✅', label: T('act.chipApproved') },
    draft:    { bg: '#EFEBE3',                fg: '#5E666E', emoji: '📝', label: T('act.chipCreated') },
    declined: { bg: 'rgba(139,81,72,0.13)',  fg: '#8B5148', emoji: '✋', label: T('act.chipDeclined') },
    // NEUTRAL, not the declined red: a decline is the client's refusal, a withdrawal is
    // his own act carried out. Same reasoning as the record screen's banner tone.
    cancelled: { bg: '#EFEBE3',              fg: '#5E666E', emoji: '↩︎', label: T('act.chipCancelled') },
    // `stateKey` can return this since 2026-08-24 — a retired version used to take the
    // old chain's default and read as "waiting". These maps are indexed by its output
    // WITHOUT a fallback (`stateColor[st].label`), so a missing entry is a crash, not a
    // wrong colour.
    superseded: { bg: '#EFEBE3',             fg: '#5E666E', emoji: '↺', label: T('co.chip.superseded') },
  };
  // Outlined status pill for the Home rows — the mockup's look (thin colored
  // border + colored text, no fill), in the design-system palette (global.css).
  const chipStyle: Record<string, { border: string; text: string }> = {
    waiting:  { border: '#efd667', text: '#8a6d1f' },  // butter-400 border, amber text
    needs:    { border: '#c3bab2', text: '#3d3733' },  // ink-300 border, ink-700 text
    approved: { border: '#3bbe77', text: '#157a47' },  // mint-500 border, mint-700 text
    draft:    { border: '#c3bab2', text: '#6b625b' },
    declined: { border: '#e0a59c', text: '#8B5148' },
    cancelled: { border: '#c3bab2', text: '#6b625b' },
    superseded: { border: '#c3bab2', text: '#6b625b' },
  };
  /**
   * THE CHIP EVERY EXTRA ROW WEARS — one source for Home, the company feed AND the
   * Job screen (2026-08-13).
   *
   * There were two palettes for the same five states: the Job screen carried its own
   * blue/amber/green outline map inline, and Home and the feed used `chipStyle` above.
   * The same extra therefore wore a different colour depending on which screen you
   * opened it from, which is the opposite of what a status chip is for.
   *
   * This is the Job screen's palette — outlined on white, with `approved` the one that
   * takes a tint — extended to the two states it never had to draw: `draft` (Home shows
   * unsent work; a job screen only lists sent extras) and `declined`.
   */
  const extraChip = (st: string) => {
    /**
     * FILLED, NOT OUTLINED (hadar, 2026-08-24, with the marketing sheet beside it:
     * "the tags on the records -- not sent needs to be much more visual -- like these
     * colors").
     *
     * These were white pills with a thin coloured border and coloured text. At 11pt on
     * a card that already carries a green kicker, a bold title and two grey lines, the
     * outline reads as more furniture — and "Not sent", the one state that is asking
     * him for something, was the quietest of the lot in plain grey.
     *
     * A solid fill is the whole point: the status is the thing a man scanning a list of
     * fourteen extras is looking for, and it should be findable without reading. The
     * palette matches the one on the product sheet — blue for sent, amber for a client
     * question, green for approved.
     *
     * `line` is kept and set to the fill so the shape is unchanged; a filled pill with
     * a contrasting border reads as two shapes.
     */
    /**
     * READ OFF THE SHEET, INCLUDING THE PART I GOT WRONG FIRST TIME.
     *
     * My first pass at these fills (build 38) made APPROVED a saturated green with white
     * text. The sheet does not: approved is a LIGHT green fill with dark green text,
     * while sent is the only saturated one. That is not a detail — it is the hierarchy.
     * Sent is the state still in motion and it shouts; approved is settled and it sits
     * quietly. A saturated green makes the finished thing the loudest row in the list.
     *
     * So: one saturated fill (sent/blue), two light fills with dark text (approved,
     * in-review), and the rest keyed to those two shapes.
     */
    const map: Record<string, { color: string; bg: string; line: string }> = {
      // Sent and waiting. The one saturated fill, because it is the one still moving.
      waiting:  { color: '#FFFFFF', bg: '#5B7FC7', line: '#5B7FC7' },
      // The client asked something — "In Review" on the sheet. Amber, dark text.
      needs:    { color: '#5C4310', bg: '#E9A93C', line: '#E9A93C' },
      // Light fill, dark text. Settled, and it should read that way.
      approved: { color: '#2E6B36', bg: '#CDE8CE', line: '#CDE8CE' },
      // NOT SENT — the one he asked for by name. It is waiting on HIM, so it takes the
      // amber family rather than the grey it had, which said "nothing here". Lighter
      // than `needs` so the two warm states are not the same colour at a glance.
      draft:    { color: '#5C4310', bg: '#F5DFA8', line: '#EBCE8C' },
      // Refused by the client. The one red in the set, kept light like the others so it
      // reports rather than alarms — a decline is a fact he has to act on, not a fault.
      declined: { color: '#8B3A2C', bg: '#F3D3CD', line: '#F3D3CD' },
      // Withdrawn: ended, by him. Neutral, same weight as the rest.
      cancelled: { color: '#4A4A46', bg: '#E2DED6', line: '#E2DED6' },
      // Replaced by a newer version. Ended, and not by anybody's decision — the same
      // neutral as withdrawn.
      superseded: { color: '#4A4A46', bg: '#E2DED6', line: '#E2DED6' },
    };
    const c = map[st] ?? map.draft;
    // "Not sent" rather than "Created" for a draft: what a draft needs to say on a row
    // is where it stands, and the thing that has not happened is the send.
    const label = st === 'draft' ? T('home.notSent')
      : st === 'waiting' ? T('job.chipWaiting')
      : st === 'needs' ? T('job.chipNeeds')
      : st === 'approved' ? T('job.chipApproved')
      : (stateColor[st]?.label ?? st);
    return { ...c, label };
  };

  /** The chip as both screens draw it: outlined, sentence case, one label per state. */
  const stateChip = (st: string) => (
    <View style={[s.exChip, { borderColor: chipStyle[st].border }]}>
      <Text style={[s.exChipT, { color: chipStyle[st].text }]}>
        {st === 'draft' ? T('home.notSent') : stateColor[st].label}
      </Text>
    </View>
  );

  // REQ-PM9 — Company feed: every extra across every project, newest first. Now a
  // first-class bottom-nav tab ("Company"), not a drawer overlay — so its header
  // carries the ☰ menu (not a back arrow) and it shows the bottom nav (hadar 2026-07-27).
  if (showFeed) {
    return (
      <View style={s.homeC}>
        {dashHeader(T('feed.title'))}
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 96 }}
          refreshControl={<RefreshControl refreshing={pulling} onRefresh={onPullRefresh} tintColor={C.steel} />}>
          {feedItems.length === 0 && (
            <EmptyState
              title={T('feed.emptyTitle')} body={T('feed.emptyBody')} />
          )}
          {(() => {
          /**
           * THE FEED ROW IS NOW THE HOME ROW (hadar, 2026-08-12: "the records should note
           * who created it, when, its current state — follow the design from the home
           * record page").
           *
           * It was a different row drawn from the same data: one-line title, a right-hand
           * column stacking a timestamp over a filled pill, and its own status vocabulary
           * via `coChip(displayStatus(...))`. Two designs for one object, and the feed's
           * was the weaker of the two — a filled pill in a second palette, a title clipped
           * at one line so two panel extras read identically, and no author anywhere.
           *
           * Same components as Home now: `exGroup` surface, `exRow`/`exName`/`exSub`/
           * `exPrice`, the outlined `stateChip`, the chevron. What changed beyond the
           * skin is the meta line — WHO raised it and WHEN, which is the fact a
           * company-wide stream needs and a single-job list does not.
           *
           * THE DAY HEADERS STAY. They group by LAST activity, which is what the feed is
           * ordered by and therefore the only honest way to break it up; Home's buckets
           * are by status, which this screen already says on every row's chip.
           */
          const nowMs = Date.now();
          let prevKey: string | null = null;
          // Rows are grouped into one card per day — the same "one quiet surface,
          // hairlines inside" rule Home follows, instead of a bordered card per row.
          const days: Array<{ key: string; label: string; items: typeof feedItems }> = [];
          for (const f of feedItems) {
            const dayKey = f.atMs > 0 ? feedDayKey(f.atMs) : 'undated';
            if (dayKey !== prevKey) {
              days.push({
                key: dayKey,
                label: f.atMs > 0 ? feedDayLabel(f.atMs, nowMs) : T('feed.earlier'),
                items: [],
              });
              prevKey = dayKey;
            }
            days[days.length - 1].items.push(f);
          }
          return days.map((day) => (
            <React.Fragment key={day.key}>
              <Text style={s.feedDayHead}>{day.label}</Text>
              <ExtraList>
                {day.items.map((f) => {
                  const st = stateKey(f.status, f.openQuestions);
                  return (
                    <ExtraCard key={f.id} chip={extraChip(st)}
                      kicker={f.coNumber != null
                        ? T({ k: 'job.coNo', p: { n: f.coNumber } })
                        : T('job.coNoNumber')}
                      title={f.scope}
                      // THE FIRST PHOTO, when this device holds it (hadar, 2026-08-14).
                      // `companyFeed` joins it with the same `CO_PHOTO_SUBQUERY` the job
                      // and Home lists use, so one extra shows one cover everywhere.
                      // Voice-only extras — and other members' rows, whose media is not
                      // on this phone — fall back to the microphone placeholder rather
                      // than to a broken image.
                      photoUri={f.photoRelpath ? FS.documentDirectory + f.photoRelpath : null}
                      // WHO RAISED IT gets the card's PERSON slot — a glyph and ink
                      // under the title (hadar, 2026-08-14) — not a third grey line
                      // between the job name and the date. On a company-wide stream
                      // "whose extra is this" is the question an owner opens the screen
                      // to ask, and it was the least visible thing on the row.
                      // Omitted when unknown (feed.ts) — never rendered as "Unknown":
                      // inventing an author on a record that will carry a signature is
                      // the one thing this line must not do.
                      person={f.createdBy
                        ? { label: T('feed.raisedByLab'), name: f.createdBy } : null}
                      // The WHEN pairs with the WHO on the closing line, right-aligned.
                      personRight={f.createdAtMs > 0 ? shortDate(f.createdAtMs, nowMs) : null}
                      meta={[f.projectName]}
                      conversation={f.openQuestions > 0 ? T('job.inConversation') : null}
                      unread={unreadRecords.has(f.id)}
                      amount={f.amountCents != null ? `+${moneyWhole(f.amountCents)}` : null}
                      onPress={() => {
                        returnToFeedRef.current = true;
                        setShowFeed(false);
                        setProjectId(f.projectId);
                        void openRecord(f.id);
                      }} />
                  );
                })}
              </ExtraList>
            </React.Fragment>
          ));
          })()}
        </ScrollView>
        {bottomNav('company', false)}
        {drawerEl}
        {/* Feed can open the drawer too, so it needs the modals the drawer opens. */}
        {offlineEl}{quotaEl}{heldEl}{celebrateEl}{msgToastEl}{silentEl}
      {jobCreatedEl}
        {paywallEl}
      </View>
    );
  }

  // Settings / Team — profile editing + company membership (hadar 2026-07-25).
  if (showSettings && settingsProfile) {
    return (
      <>
      <SettingsScreen
        db={db} supabase={connector.client} userId={OWNER} profile={settingsProfile}
        lang={lang} mode={settingsMode}
        // The letterhead card draws the logo and hands the tap back here — App.tsx
        // owns the picker, the upload and the local cache (companylogo.ts), and a
        // second copy of that flow inside Settings is a second place for it to break.
        logoUri={logoUri} onLogoPress={() => setLogoSheet(true)}
        // `lang` goes with it here too: Settings can change the display language, and
        // the account copy is what survives a reinstall.
        onSaveProfile={async (p) => { await saveProfile(connector, db, p, lang); setSettingsProfile(p); await refresh(); }}
        /* THE ONE LANGUAGE CONTROL IN THE APP (hadar, 2026-08-26). The drawer's
           duplicate segment is gone; this is the only place the display language is
           chosen after setup, so it owns BOTH halves of the write — the device key that
           the UI reads offline, and the account copy that survives a reinstall. The
           mirror is not awaited: the language must flip instantly with no signal. */
        onSetLang={async (l) => {
          setLang(l); setLangState(l);
          await saveLang(db, l);
          void saveLangToAccount(connector, l);
        }}
        // Settings -> Plans KEEPS the door Settings came through (no argument, so
        // `settingsFrom` is left as it is): he is still inside that journey, and closing
        // Plans should land where it began rather than inventing a new origin.
        onOpenPlans={() => { setShowSettings(false); void openPaywall(settingsFrom); }}
        // The artboard's "Open Company" pointer. Same entry the drawer uses, so there
        // is one way into that screen rather than a second that could drift.
        onOpenCompany={() => setSettingsMode('company')}
        onBack={() => {
          setShowSettings(false);
          // Back into the menu he stepped out of — but only when that is where he was.
          if (settingsFrom === 'drawer') setMenuOpen(true);
        }}
      />
      {/* THE OVERLAYS THIS SCREEN CAN OPEN HAVE TO BE RENDERED BY IT.
          This branch is an EARLY RETURN — nothing below it in the tree mounts — so the
          logo sheet lived in a branch that never runs while Settings is open. Tapping
          "Add logo" on the letterhead card set `logoSheet = true` and drew nothing:
          a dead control, which is the failure CLAUDE.md §1 calls unreadable (hadar,
          2026-08-17: "i still cannot add logo").
          `ackEl` comes too, or the outcome of a save — the "Logo updated" or the
          reason it failed — would be equally invisible. */}
      {logoEl}
      {ackEl}
      </>
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
        // Step 3 of the guided flow. Undefined everywhere else, so the strip is absent
        // for an experienced user capturing his fortieth extra.
        coachPrompts={guidedOn
          ? COACH_PROMPTS.map((p) => ({ label: T(p.title) }))
          : undefined}
        projectName={projects.find((p) => p.id === projectId)?.name ?? 'EZChangeOrders'}
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
  const stateOf = (e: Extra) => stateKey(e.status, e.questions);

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
  /**
   * ONE HOME ROW — the SAME card the Job screen and the company feed draw
   * (`ExtraCard`), not a second shape for the same object.
   *
   * It used to be its own thing: no thumbnail, no change-order number, a two-line
   * title, and the price as a small grey line under the meta instead of the
   * second-loudest thing on the row. Reading the same extra here and inside its job
   * showed two different objects — and every fix made to the job card (the truncating
   * number, the clock in the date, the price sitting a line too low) silently never
   * reached this one.
   *
   * WHAT CHANGES BETWEEN THE SCREENS IS THE META, and only the meta: Home spans jobs,
   * so the job NAME is the first thing that must be said. Inside a job it never is.
   */
  const extraRow = (e: Extra, i: number) => {
    const st = stateOf(e);
    const row = (
      <ExtraCard key={e.id} chip={extraChip(st)}
        /**
         * THE JOB LEADS, THE NUMBER QUALIFIES (hadar, 2026-08-24: "look at the co
         * numbers in waiting an approved they are the same -- that is a bug").
         *
         * `co_number` is per project and correctly so — it is the number printed on the
         * client's own document. Home mixes jobs, so two cards can both read "CO-2".
         *
         * THE JOB NAME USED TO LEAD THIS LINE and no longer does (hadar, 2026-08-31:
         * "first line next to the co-# can you remove the street field"). It was on the
         * card TWICE — here and in `meta` immediately below — so the first line spent
         * its width repeating the third. Removing it costs the card nothing: the
         * address is still there, one line down, in full rather than shortened.
         *
         * What it does cost is the at-a-glance disambiguation of two same-numbered COs
         * on different jobs, which now takes reading one line further. That was the
         * reason it was put here, and it is a real trade, not an oversight.
         */
        kicker={e.co_number != null
          ? T({ k: 'job.coNo', p: { n: e.co_number } })
          : T('job.coNoNumber')}
        title={e.scope || T('home.draftsSec')}
        photoUri={e.photo_relpath ? FS.documentDirectory + e.photo_relpath : null}
        // THE SAME CLOSING LINE AS THE COMPANY FEED (hadar, 2026-08-17: "make sure
        // the home change order records data structure and style looks like the
        // company one, especially how the created and date are").
        // Home used to print the date as the second grey meta line and name nobody, so
        // the same extra read as a different object depending on which screen you
        // opened it from. Now both put WHO raised it and WHEN on one footer row —
        // person left in ink, date hard right — and leave the job name as the only
        // meta line above it.
        person={e.created_by
          ? { label: T('feed.raisedByLab'), name: e.created_by } : null}
        personRight={e.created_at_ms > 0 ? shortDate(e.created_at_ms) : null}
        meta={[e.pname || null]}
        conversation={(e.questions ?? 0) > 0 ? T('job.inConversation') : null}
        unread={unreadRecords.has(e.id)}
        // Still on the phone. Steel-blue, stated calmly — see ExtraCard's `pending`.
        /* THE RECORD FIRST, THEN ITS MEDIA. "Not sent up yet" is the more
           fundamental fact: an extra still in this device's queue does not exist
           anywhere else, and saying only "still processing" about it would describe
           the smaller problem while the bigger one went unmentioned. */
        pending={e.record_pending ? T('erec.onPhone')
          : e.pending_upload ? T('home.notProcessed') : null}
        amount={e.amount_cents != null ? `+${moneyWhole(e.amount_cents)}` : null}
        onPress={() => { setProjectId(e.project_id); void openRecord(e.id); }} />
    );
    // Only a DRAFT is the owner's alone to destroy (discard.ts): once an extra is
    // sent, a counterparty may have opened it and answered, and that is their
    // evidence too. A non-draft row simply does not move.
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
  const draftsOverlay = drafts.length > 0 ? (
    <DraftRecoveryCard
      drafts={drafts}
      busyId={draftBusy}
      onKeep={async (d) => {
        setDraftBusy(d.draftId);
        try {
          /**
           * DID THIS WALK ALREADY BECOME AN EXTRA? (hadar, 2026-08-21: "now I have 2
           * change order #1 in my app as drafts".)
           *
           * `onFusedCapture` commits the captures and creates the extra, and only
           * THEN is the draft marked closed. Kill the app in between — precisely what
           * "didn't complete before the app closed" means — and the draft survives as
           * `open` while its captures are already committed. Re-running it here mints
           * a SECOND extra from one walk, which is what he is looking at.
           *
           * `alreadyCommittedItems` answers it by digest: `capture_commit.media_sha256`
           * is the hash of these very bytes. All of them present means the walk landed
           * and the draft is simply stale — so close it and say so, rather than filing
           * the same photographs twice.
           */
          const seen = await alreadyCommittedItems(db, d.draftId);
          if (seen.total > 0 && seen.committed.length === seen.total) {
            await closeDraft(db, d.draftId, 'committed');
            void logDiag(db, 'draft.recover', `${d.draftId}: already committed, closed`);
            setAck({ kind: 'ok', title: T('r1.draft.alreadyTitle'),
                     detail: T('r1.draft.alreadyBody') });
            return;
          }
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
  /**
   * THE GUIDED START. Ahead of Home, and only when ALL of these hold:
   *   * the walkthrough has never been dismissed on this phone (`firstExtra`)
   *   * there are no change orders
   *   * there are no jobs, INBOX excluded — the inbox is created by the app, not by the
   *     user, so counting it would mean the screen never showed to anybody
   *
   * `firstExtra === true` and not merely truthy: null means the flag has not been read
   * yet, and rendering Home during that tick then swapping is the flash-of-the-wrong-app
   * this file already fixed once for the language picker.
   *
   * `loadedOnce` guards the OTHER half of that, and it is the one review caught: the
   * flag resolves in the init effect while `projects`/`homeExtras` are filled by a
   * refresh that runs afterwards. Without it, every existing user upgrading into this
   * build — none of whom have ever marked `first_extra_seen` — would get the walkthrough
   * over their Home on every cold start until the first refresh landed, and would be
   * STRANDED on it with only "Do this later" if that refresh ever threw.
   *
   * NOT gated on `nav`, so it cannot be swiped past from the tab bar — but it is not a
   * trap either: "Do this later" marks it seen and never asks again.
   */
  /**
   * THE FIRST SYNC, BEHIND THE SPLASH (hadar, 2026-08-21).
   *
   * Only when there is genuinely nothing to draw: an account is signed in, the first
   * refresh has run, it found no extras, and no hydrate has answered yet. A device
   * with local rows never reaches here — it paints them, which is the whole point of
   * being local-first.
   *
   * AFTER the setup gate above, deliberately: a brand-new user belongs in setup, not
   * behind a splash waiting on a sync that will correctly find nothing.
   *
   * `holdExpired` is the escape hatch and it is load-bearing — see its declaration.
   * When it fires, the Home behind this says "Getting your work" or "Can't reach your
   * work" rather than pretending to be finished.
   */
  if (ready && session && loadedOnce && synced === 'unknown' && !holdExpired
      && !homeExtras.length) {
    return <SplashScreen />;
  }

  if (firstExtra === true && loadedOnce && !homeExtras.length
      && !projects.filter((p) => p.id !== INBOX_ID).length) {
    return (
      guided === 'coach' ? (
        <GuidedCoach onStart={enterGuided} onBack={() => setGuided(null)} />
      ) : (
      <FirstExtra
        onCoach={() => setGuided('coach')}
        onStart={enterGuided}
        onLater={() => { void markFirstExtraSeen(db); setFirstExtra(false); }}
      />
      )
    );
  }

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
    /**
     * CLOSED — declined and withdrawn, together, and it is the section that was missing.
     *
     * Home had three buckets. `declined` produced its own state key and appeared in NONE
     * of them, so a client's refusal simply vanished from the screen; `cancelled` fell
     * through into Waiting. Both are ENDED extras, neither is a draft to finish or an
     * answer to chase, and both are things a contractor needs to find again — a decline
     * is the record of why the work did not happen, and it is evidence in exactly the
     * dispute this product exists to prevent.
     *
     * One bucket rather than two: they differ in WHO ended it, which the chip on each row
     * already says, and a fifth pill on a jobsite phone buys a distinction he can read
     * off the card anyway.
     */
    // `isClosed` covers superseded as well — a retired version is ended, and it used to
    // sit in Waiting because nothing named it.
    const closedList = homeExtras.filter((e) => isClosed(e.status));
    // The hero totals money still OUT ON THE CLIENT — sent only. A draft has never
    // left the phone, so it is NOT "waiting for approval" and must not inflate this.
    const outstanding = [...questioned, ...waitingList].reduce((sum, e) => sum + (e.amount_cents ?? 0), 0);
    const outstandingN = questioned.length + waitingList.length;
    const startCapture = () => { if (!terms) { openTerms(() => setShowCapture(true)); return; } setShowCapture(true); };
    // Tapping a summary chip filters the list BELOW IT — no navigation. Tapping the
    // live chip again clears the filter.
    const disabled = !!gate || !!initError;
    /**
     * THE FIRST-RUN HOME (hadar's design, 2026-08-12: "in case no changes were added
     * yet to the system — here is the opening negative view").
     *
     * WHAT IT REPLACES AND WHY. The populated Home leads with a money figure and three
     * count chips. On an empty account that renders as "$0", "0 across 0 extras" and
     * three zeroes — a dashboard reporting nothing, four times over. Zero is a true
     * number and a terrible first screen: it tells a new contractor the app is working
     * and gives him nothing to do.
     *
     * So the whole top half changes shape rather than showing empty versions of itself:
     * a headline that names the state in two words, one sentence saying what to do, the
     * SAME black capture card (it is the only act available, so it is the only control),
     * and one quiet card standing in for the approval list it will become.
     *
     * The house art stays exactly where it is. It is this screen's identity in both
     * states, and moving it would make the first screen a different app from the second.
     */
    /**
     * "NO EXTRAS YET" IS A CLAIM, AND IT NEEDS EVIDENCE (hadar, 2026-08-21).
     *
     * This was `homeExtras.length === 0` alone — a local row count, asserted as a fact
     * about the account one second after sign-in, when the local table is empty for the
     * only uninteresting reason there is: nothing has synced yet. A contractor with
     * three change orders was told he had none, in the largest type on the screen.
     *
     * Three states, and only one of them may make the claim:
     *   have rows        → show them
     *   none, not asked  → say we are fetching. Never "none".
     *   none, asked+told → "NO EXTRAS YET" is now true, and it is safe to say
     *   none, unreachable→ say we could not check. Zero is not the answer, it is the
     *                      absence of one — the same honesty `set.billingUnavailable`
     *                      already uses for purchases.
     */
    const homeEmpty = homeExtras.length === 0 && synced === 'yes';
    const homeUnknown = homeExtras.length === 0 && synced === 'unknown';
    const homeUnreachable = homeExtras.length === 0 && synced === 'unreachable';
    /** Everything that is not a populated hero shares the empty hero's layout. */
    const heroQuiet = homeEmpty || homeUnknown || homeUnreachable;
    return (
      <View style={s.homeC}>
        {discardSheet}
        {dashHeader(T('home.title'))}

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}
          refreshControl={<RefreshControl refreshing={pulling} onRefresh={onPullRefresh} tintColor={C.steel} />}>
          {/* Hero — the money outstanding on the client, across every job. Design
              system: Oswald caps label, huge Oswald figure, Inter sub. The house
              illustration (assets/house-hero.png) sits top-right. */}
          <View style={[s.heroWrap, heroQuiet && s.heroWrapEmpty]}>
            <Image source={require('./assets/house-hero.png')}
              style={[s.houseArt, heroQuiet && s.houseArtEmpty]}
              resizeMode="contain" />
            {heroQuiet ? (
              <>
                {/* Two deliberate lines, written as two: "NO EXTRAS YET" wrapped by the
                    box would break wherever the house left room, and this headline is
                    typography — the break belongs to the design, not to the layout.
                    The other two states borrow the same shape so the screen does not
                    jump when the answer arrives. */}
                <Text style={s.emptyHead}>
                  {homeUnknown ? T('home.loadingHead1')
                    : homeUnreachable ? T('home.offlineHead1') : T('home.emptyHead1')}
                </Text>
                <Text style={s.emptyHead}>
                  {homeUnknown ? T('home.loadingHead2')
                    : homeUnreachable ? T('home.offlineHead2') : T('home.emptyHead2')}
                </Text>
                <Text style={s.emptyLede}>
                  {homeUnknown ? T('home.loadingLede')
                    : homeUnreachable ? T('home.offlineLede') : T('home.emptyLede')}
                </Text>
              </>
            ) : (
              <>
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
              </>
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

          {/* THE EMPTY BODY. One card where the approval list will be, then the way in
              to what this app actually does. The three count chips and the status
              sections are not rendered at all — three zeroes and three absent headings
              is a UI describing its own emptiness in six places. */}
          {homeEmpty && (
            <>
              <View style={s.emptyCard}>
                <View style={s.emptyDisc}>
                  <Icon name="ntClipboard" size={34} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.emptyCardT}>{T('home.emptyWaitTitle')}</Text>
                  <Text style={s.emptyCardS}>{T('home.emptyWaitSub')}</Text>
                </View>
              </View>
              <Pressable style={s.emptyLearn} accessibilityRole="button"
                onPress={() => setHowOpen(true)}>
                <Icon name="info" size={19} color="#1e6b3a" />
                <Text style={s.emptyLearnT}>{T('home.emptyLearn')}</Text>
              </Pressable>
            </>
          )}

          {/* Summary chips (mockup): a glance at what needs you / is out / is won.
              Tapping one filters the sections below IN PLACE; the live chip is ringed
              and tapping it again clears. Never navigates. */}
          {!homeEmpty && (<>
          {/* THE FILTER PILLS ARE GONE (hadar's home artboard, 2026-08-25, and his
              screenshot of them still sitting there).
              They sorted by STATUS, and so did the five sections they steered. Both are
              replaced by "Needs you first" / "Everything else", which answers the
              question a contractor actually opens the phone with. Keeping the pills on
              top of the new grouping was the worst of both: his screenshot shows "Needs
              you" selected and his one extra hidden behind it, on a screen whose whole
              job is showing him what is outstanding. A filter that can hide everything
              needs a reason to exist, and the two sections took it. */}

          {/* Status sections in the mockup's order (waiting out first, then what needs
              you, the running win, and finally your own drafts). Header is an uppercase
              Oswald label + a "See all" link into the filtered Activity tab. Each row
              is the shared extraRow. Drafts have no Activity filter, so no "See all". */}
          {(() => {
            // A filter hides the other sections. "See all" focuses this one; while
            // focused the link flips to "Show all" and clears — both in place.
            const bucket = (labelKey: string, list: Extra[]) => {
              if (!list.length) return null;
              return (
                <React.Fragment key={labelKey}>
                  <View style={s.secHead}>
                    {/* The heading alone now. The "See all" link set the filter that no
                        longer exists, and the artboard leaves this slot empty. */}
                    <Text style={s.secLab}>{T(labelKey)}</Text>
                  </View>
                  {/* THE ROWS CARRY THEIR OWN BORDER NOW, so the section no longer
                      draws one round them (2026-08-13). `exGroup` was a single quiet
                      surface with hairlines inside it — the right answer when a row was
                      a bare line of text. `ExtraCard` is a card, and nesting cards in a
                      card gave every row two edges. Only the gutter survives. */}
                  <ExtraList>{list.map(extraRow)}</ExtraList>
                </React.Fragment>
              );
            };
            // A filter that matches nothing would otherwise paint a blank page — and
            // 'needs' is now the DEFAULT, so that is the common case for a user with
            // extras but nothing awaiting them. Say so, and say how to get out.
            /**
             * TWO SECTIONS, NOT FIVE (hadar's home artboard, 2026-08-25).
             *
             * It was waiting / needs a response / approved / closed — a sort by STATUS,
             * which is the app's vocabulary rather than a contractor's. He opens the
             * phone with one question: what do I have to do. So the screen answers that
             * question first and puts the rest under one heading, with each row's status
             * pill still saying which is which.
             *
             * `needs` is already exactly "needs you first" — drafts he has not sent, and
             * sent extras where the client has asked something. Nothing about the
             * derivation changes; only how many headings sit over it.
             *
             * AND THE FILTER PILLS ARE GONE WITH THEM. They sorted by the same status
             * vocabulary; keeping them on top of this grouping let "Needs you" hide the
             * account's only extra, which is what hadar photographed.
             */
            /**
             * FOUR GROUPS (hadar, 2026-08-25, having lived with the artboard's two).
             *
             * The artboard drew "Needs you first" and "Everything else". Two proved too
             * coarse in use: "waiting on client" is the state he checks most often and
             * can do least about, and folding it into "everything else" buried the money
             * actually in play under closed and approved records.
             *
             * So the split is by WHOSE MOVE IT IS, which is still not the old sort by
             * status — that had five headings including "Drafts", and drafts belong with
             * the questions he owes answers to, because both are his move.
             *
             *   needs you  -> his move       (drafts, and client questions)
             *   waiting    -> the client's move
             *   approved   -> nobody's move, and it is the good news
             *   everything else -> declined, withdrawn: over
             */
            /* "EVERYTHING ELSE" IS GONE FROM HOME (hadar, 2026-08-27: "remove
               everything else section"). Declined and withdrawn records are over —
               nobody's move — and a summary screen answering "what do I have to do"
               spent its last heading on them. They are not lost: every one still
               counts toward the "Show all" footer below and lives in the feed. */

            /**
             * HOME IS A SUMMARY, NOT THE ARCHIVE (hadar, 2026-08-25: "nor there i a
             * continues load").
             *
             * The artboard shows one card under "Needs you first", three under
             * "Everything else", and then "Show all 8 change orders" — so the screen
             * holds back the tail and offers the way to it. Home rendered EVERY
             * non-superseded extra instead, which is why the footer button never
             * appeared: its condition compared the total against the two lists, and
             * those two lists ARE the total. It could not fire.
             *
             * WHAT NEEDS HIM IS NEVER TRUNCATED. Only the rest is capped. Hiding a
             * draft he has not sent, or a client question he has not answered, behind a
             * "show all" would be the app deciding his backlog is too long to mention —
             * on the screen whose whole job is telling him what is outstanding.
             */
            const REST_ON_HOME = 3;
            /** Home is a summary: each of the three non-urgent groups shows its most
             *  recent few and the footer offers the rest. "Needs you first" is NOT
             *  capped — see below. */
            const cap = (l: Extra[]) => l.slice(0, REST_ON_HOME);
            const hiddenCount = [waitingList, approvedList]
              .reduce((n, l) => n + Math.max(0, l.length - REST_ON_HOME), 0)
              // The closed records render nowhere on Home now, so ALL of them are
              // "more to see", not just the tail past the cap.
              + closedList.length;
            return (<>
              {bucket('home.needsYouFirst', needs)}
              {bucket('home.waitingOnClient', cap(waitingList))}
              {bucket('home.approvedSec', cap(approvedList))}
              {/* SHOW ALL — the artboard's footer.
                  Home holds the most recent extras; this is the way to the full list
                  across every job, which is what `openFeed` already is. Only when there
                  is more to see than is on screen: a button offering "show all 3" under
                  three rows is furniture, not a way out. */}
              {hiddenCount > 0 && (
                <Pressable onPress={() => void openFeed()} accessibilityRole="button"
                  style={({ pressed }) => [s.showAllBtn, pressed ? { opacity: 0.6 } : null]}>
                  <Text style={s.showAllBtnT}>
                    {/* The TOTAL, as the artboard has it — "show all 8", not "show 4
                        more". He is choosing to see everything, and the number that
                        makes that worth tapping is how much there is. */}
                    {T({ k: 'home.showAllN', p: { n: homeExtras.length } })}
                  </Text>
                </Pressable>
              )}
              {/* The FILTERED-empty state is gone with the filters. There is no longer a
                  way to reach a screen that has change orders but shows none, so an
                  empty state explaining that state would be unreachable code. */}
            </>);
          })()}
          </>)}
        </ScrollView>

        {/* The one bottom nav (Home active here). */}
        {bottomNav('home', false)}

        {/* Overlays float ABOVE the fixed tab bar in a scrim — inline cards would
            render under the bar and be unreachable. Draft recovery shows itself
            (mandate #1). The BELL no longer appears here — it navigates to the
            notifications screen now, so the scrim exists purely for draft recovery. */}
        {drafts.length > 0 && (
          <View style={s.homeScrim}>
            <ScrollView contentContainerStyle={{ paddingTop: 56, paddingBottom: 40 }}
              keyboardShouldPersistTaps="handled">
            {draftsOverlay}
            </ScrollView>
          </View>
        )}

        {/* The ☰ opens a LEFT DRAWER (hadar, 2026-07-27), not the old centred card that
            re-listed jobs. Jobs own the bottom-nav Jobs tab; this holds the secondary
            destinations only. Each row navigates to a screen that already exists.
            Also reachable from the Profile tab in the bottom bar (2026-07-28). */}
        {drawerEl}
        {howEl}
        {/* MOUNTED HERE OR THE DRAWER'S "Upgrade" DOES NOTHING (hadar 2026-08-04:
            "it takes me nowhere, just closes the drawer"). setShowPaywall(true) only
            flips state — if <PaywallScreen> is not in THIS screen's tree there is
            nothing to render, and the tap is silently swallowed. The drawer is
            reachable from home, jobs and activity, so the modals it can open have to
            be mounted on all three; jobs already had them, home and activity did not.
            AFTER {drawerEl} deliberately: a Modal declared before its sibling content
            does not present on iOS. */}
        {offlineEl}{quotaEl}{heldEl}{celebrateEl}{msgToastEl}{silentEl}
        {/* WITHOUT THIS, FINISHING A RECORDING LANDS HERE AND STOPS.
            (hadar, 2026-09-01: "when i recorded it skipped the preview -- it just went
            to the home screen.")

            The post-processing handoff is an ack — "your change order is ready", with an
            OK whose `then` opens the record. Processing finishes while HOME is the
            screen underneath, so `setAck` wrote into a tree with nothing to draw it: no
            popup, no tap, no navigation, and the change order stayed a draft nobody was
            looking at. The one screen the flow always returns to was the one screen that
            could not report its own completion.

            FOURTH TIME THIS PATTERN HAS BITTEN TODAY — the drawer's Upgrade, Home's
            swipe-delete, the job screen's Delete, and now this. Setting state is not
            mounting a view, and every screen in this file is an early return that has to
            remember every modal by hand. The real fix is one shell that mounts them
            once; until that exists this list is a hand-maintained invariant, which is
            another way of saying it will be wrong again. */}
        {ackEl}
        {/* WITHOUT THIS the out-of-credits modal's Buy is dead on this screen: it sets
            `showPaywall`, and the paywall only exists where it is mounted. */}
        {paywallEl}
      {jobCreatedEl}
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
    // EVERYTHING EXCEPT THE STATE FILTER. The pill counts are taken from here, not
    // from `shown`, or selecting a pill would rewrite every other pill's number to
    // describe the slice you are already inside — each count has to keep answering
    // "how many are there", not "how many survive what I just pressed".
    const jobsBase = jobsSrc
      .filter((p) => p.id !== INBOX_ID)
      .filter((p) => !q || p.name.toLowerCase().includes(q) ||
                     (p.address ?? '').toLowerCase().includes(q))
      .filter((p) => !activeLabel || p.label === activeLabel);
    // A STATE PILL KEEPS THE JOBS THAT HAVE SOMETHING IN THAT STATE — it does not
    // reduce the cards to that state. "Needs approval" answers "which jobs want me",
    // and the card still shows all three counts, because the answer to "which jobs
    // want me" is useless without "and what else is on them".
    const inState = (k: 'needs' | 'waiting' | 'approved') =>
      jobsBase.filter((p) => (jobCounts[p.id]?.[k] ?? 0) > 0).length;
    const shown = jobStat ? jobsBase.filter((p) => (jobCounts[p.id]?.[jobStat] ?? 0) > 0) : jobsBase;
    const open = (id: string) => { setProjectId(id); void touchProject(db, id); setNav('project'); };
    return (
      <View style={s.homeC}>
        {offlineEl}{quotaEl}{heldEl}{celebrateEl}{msgToastEl}{silentEl}
      {jobCreatedEl}
        {discardSheet}
        {paywallEl}
        {/* A SUCCESSFUL DELETE LANDS HERE, not on the job screen it was fired from —
            `deleteJob` navigates away before it acknowledges, so the confirmation is
            raised on one screen and must be drawn on this one. */}
        {ackEl}
        {/* Header: title · new job (the ＋ opens the create-job screen, an early
            return, so it works from here). */}
        {/* NO ＋ HERE (hadar, 2026-08-12). Creating a job is still reachable — the
            job picker (tap the job on the Job screen) ends in "New job", and that is
            the place it is actually wanted: you discover the job is missing while
            trying to pick it. A header ＋ on a list is a second door to the same act,
            and this header is now shared with Home and Company, where it has no
            meaning at all. */}
        {dashHeader(T('home.navJobs'))}
        <ScrollView style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 96 }}
          refreshControl={<RefreshControl refreshing={pulling} onRefresh={onPullRefresh} tintColor={C.steel} />}>
          {/* CREATE, ABOVE THE FILTER (hadar, 2026-08-12). It replaces the header ＋
              removed a build ago: same act, but a labelled button on the list says
              what it does, and a glyph in a header shared with Home and Company could
              not. Above the Active/Archived pills because it belongs to the LIST, not
              to whichever slice of it is showing — under the filter it would read as
              "create an archived job". */}
          {/* SEARCH FIRST, AND ALWAYS (design, 2026-08-31). It used to sit below the
              Active/Archived pills and only appear past four jobs — so the control
              MOVED as the list grew, and the one contractor who most needs it (the one
              with thirty jobs) had learnt the screen without it. A field that appears
              on its own is a field nobody looks for. It is hidden only at zero jobs,
              where there is nothing to search.

              The magnifier is inside the field, not beside it: the placeholder alone
              read as an empty name box. */}
          {jobsSrc.length > 0 && (
            <View style={s.jlSearch}>
              <Icon name="search" size={19} color="#8c959f" />
              <TextInput style={s.jlSearchIn} value={search} onChangeText={setSearch}
                placeholder={T('jobs.searchPh')} placeholderTextColor="#8c959f"
                returnKeyType="search" clearButtonMode="while-editing" />
            </View>
          )}

          <Pressable style={s.jlNew} accessibilityRole="button"
            onPress={() => setNewJob({ name: '', address: '' })}>
            <Icon name="extra" size={18} color="#fff" />
            <Text style={s.jlNewT}>{T('job.new')}</Text>
          </Pressable>

          {/* THE ACTIVE/ARCHIVED PAIR IS NOT HERE ANY MORE (hadar, 2026-08-31: "i would
              like to remove the active and archived filter"). It sat at the top
              competing with the state filter below it, and the overwhelming majority
              of openings want the active list — which it made you re-read every time.

              IT IS MOVED, NOT DELETED, and the difference matters: this control is the
              ONLY door to an archived job, and the un-archive button lives inside that
              view. Deleting it outright would strand every archived job with no way
              back — silently, since they would simply stop existing on screen. It is
              now one plain line at the FOOT of the list, where a rare escape hatch
              belongs. Say the word and archiving goes entirely, but that is a bigger
              decision than moving a control. */}

          {/* ── FILTER BY STATE (design, 2026-08-31) ──────────────────────────
              The only filter this list had was by COLOUR LABEL, which answers a
              question a contractor rarely asks, and it disappeared entirely when no
              job carried a label — so most accounts had no filter at all.

              These four are the buckets already printed on every card below. THE
              ICONS AND COLOURS ARE THE CARD'S, DELIBERATELY: orange person, blue
              clock, green check. The pill and the number it filters on are the same
              thing said twice, so the eye can travel from a count on a card to the
              pill that isolates it without translating.

              ALL IS A REAL PILL, and the default. Expressing "everything" by having
              nothing selected makes the most common state the only one with no
              control — the same defect the job screen's pills were fixed for. */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.jlSF}>
            {([
              { k: null,       label: T('job.pillAll'),      icon: null,                tint: '#3f423e', n: jobsBase.length },
              { k: 'needs',    label: T('job.statNeeds'),    icon: 'person' as const,   tint: '#C2610C', n: inState('needs') },
              { k: 'waiting',  label: T('job.pillWaiting'),  icon: 'clock' as const,    tint: '#2E5AA8', n: inState('waiting') },
              { k: 'approved', label: T('job.statApproved'), icon: 'approved' as const, tint: '#2F5233', n: inState('approved') },
            ] as const).map((f) => {
              const on = jobStat === f.k;
              // A PILL THAT CAN ONLY RETURN NOTHING IS NOT OFFERED. Pressing it would
              // empty the screen and teach that the row breaks things — and it is the
              // honest reading of grey, which otherwise just looks switched off.
              const dead = f.n === 0 && !on;
              return (
                <Pressable key={String(f.k)} hitSlop={4} disabled={dead}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on, disabled: dead }}
                  accessibilityLabel={`${f.label}: ${f.n}`}
                  style={[s.jlSFB, on && s.jlSFBOn, dead && s.jlSFBOff]}
                  onPress={() => setJobStat(f.k as any)}>
                  {f.icon && <Icon name={f.icon} size={15}
                    color={on ? '#fff' : dead ? '#B7B2A8' : f.tint} />}
                  <Text style={[s.jlSFT, on && s.jlSFTOn, dead && s.jlSFTOff]}>{f.label}</Text>
                  {/* THE NUMBER IS WHY THE ROW READS AS A FILTER AT ALL (hadar asked
                      twice what it was). A row of bare words is decoration; a word
                      with a count is plainly a filter over a set, and it says what is
                      behind the pill before you spend a tap finding out. */}
                  <Text style={[s.jlSFN, on && s.jlSFTOn, dead && s.jlSFTOff]}>{f.n}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
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
          {/* ── THE JOB CARD (design, 2026-08-11) ──────────────────────────────
              A one-line row with a capture count told a contractor nothing he acts
              on: how many photographs are on a job is not a state. The card answers
              the question he opens this screen with — where does each job stand —
              with the same three buckets the job screen uses, so the numbers here
              and one tap in are the same numbers.

              THE MAP IS A GOOGLE STATIC SNAPSHOT (hadar: "use google map snap shot"),
              CACHED TO DISK by src/mapcache.ts and read from a file:// URI — one
              billed request per job per set of coordinates, and the card still draws
              with no signal. With no key, no coordinates, or a failed download, it
              falls back to the kit's illustration rather than an empty grey box. */}
          {shown.map((p) => {
            const cc = jobCounts[p.id] ?? { needs: 0, waiting: 0, approved: 0 };
            // The cached FILE first; the live URL only until the download lands, so
            // the very first paint still shows a map instead of the illustration.
            const mapUrl = jobMaps[p.id]
              ?? mapUrlFor(process.env.EXPO_PUBLIC_STATIC_MAP_URL, p.lat, p.lng);
            const stat = (n: number, label: string, icon: 'statPerson' | 'statClock' | 'statCheck',
                          tint: string, ring: string) => (
              <View style={s.jlStat}>
                <View style={[s.jlStatIco, { backgroundColor: ring }]}>
                  <Icon name={icon === 'statPerson' ? 'person' : icon === 'statClock' ? 'clock' : 'approved'}
                    size={16} color={tint} />
                </View>
                <Text style={s.jlStatLab} numberOfLines={1}>{label}</Text>
                <Text style={[s.jlStatN, { color: tint }]}>{n}</Text>
              </View>
            );
            return (
            <Pressable key={p.id} style={s.jlCard}
              onPress={() => {
                // Archived rows OPEN read-only (retention view). They are not in the
                // active `projects` state, so add the tapped one so the Job screen
                // resolves it (review 2026-07-25: don't dead-tap the row).
                if (jobsArchived) setProjects((ps) => ps.some((x) => x.id === p.id) ? ps : [...ps, p]);
                open(p.id);
              }}>
              {mapUrl
                ? <Image source={{ uri: mapUrl }} style={s.jlMap} resizeMode="cover" />
                : <View style={[s.jlMap, s.jlMapEmpty]}><Icon name="mapHero" size={74} /></View>}

              {/* The text column stands off the map. Went 3 -> 12 -> 22: the map is a
                  full-bleed panel with detail running to its edge, so it needs more
                  clearance than the card's other sides, where the neighbour is just
                  the card border. Asymmetric on purpose. */}
              <View style={{ flex: 1, minWidth: 0, padding: 12, paddingLeft: 22 }}>
                <View style={s.jlTitleRow}>
                  {labelHex(p.label) && (
                    <View style={{ width: 9, height: 9, borderRadius: 5, marginRight: 7,
                      backgroundColor: labelHex(p.label) as string }} />
                  )}
                  <Text style={s.jlName} numberOfLines={2}>{p.name}</Text>
                  <Icon name="chevRight" size={15} color="#8A93A0" />
                </View>
                {!!p.address && p.address !== p.name && (
                  <Text style={s.jlAddr} numberOfLines={1}>{p.address}</Text>
                )}
                {!!p.lastMs && (
                  <View style={s.jlAct}>
                    <Icon name="cal" size={13} color="#4E6243" />
                    <Text style={s.jlActT}>
                      {T({ k: 'jobs.lastActivity', p: { ago: ago(p.lastMs, now) } })}
                    </Text>
                  </View>
                )}

                <View style={s.jlStats}>
                  {stat(cc.needs, T('job.statNeeds'), 'statPerson', '#C2610C', '#FBEFE0')}
                  <View style={s.jlStatDiv} />
                  {stat(cc.waiting, T('job.pillWaiting'), 'statClock', '#2E5AA8', '#E8EFFA')}
                  <View style={s.jlStatDiv} />
                  {stat(cc.approved, T('job.statApproved'), 'statCheck', '#2F5233', '#E9EFE5')}
                </View>

                {jobsArchived && (
                  <Pressable hitSlop={10} style={s.jlUnarchive}
                    onPress={async () => {
                      // Un-archiving re-consumes an active-job slot, so it faces the same
                      // free-tier cap as creating one (review 2026-07-25: this was a bypass).
                      const jq = await checkJobs(db);
                      if (!jq.ok) { setQuota({ kind: 'jobs', limit: jq.limit }); return; }
                      const r = await setProjectStatus(connector.client, db, p.id, 'in_progress');
                      if (r.ok) { await refresh(); await loadArchived(); } else setFiled(statusErr(r.code));
                    }}>
                    <Text style={s.jlUnarchiveT}>{T('pm4.unarchive')}</Text>
                  </Pressable>
                )}
              </View>
            </Pressable>
            );
          })}
          {!shown.length && (
            // THE THREE CASES ARE NOT THE SAME EMPTY, and only one of them earns the
            // illustration. "No jobs yet" is a fact about the account; "no jobs match
            // that" is a fact about the search box, and a drawing over it would both
            // overstate the situation and hide the fact that clearing the search brings
            // everything back.
            (jobsArchived || q)
              ? <Text style={s.homeEmpty}>
                  {jobsArchived ? T('pm4.noArchived') : T('home.noMatch')}
                </Text>
              : <EmptyState
                  title={T('home.emptyJobsTitle')} body={T('home.emptyJobsBody')} />
          )}
          {/* The archived list's only entrance, and its only exit. A plain line, not a
              pill: it must be findable, and it must not look like the state filters
              above, which is exactly the confusion that got the old pair removed. */}
          <Pressable hitSlop={8} style={s.jlArch}
            accessibilityRole="button"
            onPress={async () => {
              if (jobsArchived) { setJobsArchived(false); return; }
              setJobsArchived(true); await loadArchived();
            }}>
            <Text style={s.jlArchT}>
              {jobsArchived ? T('pm4.activeJobs') : T('pm4.archived')}
            </Text>
          </Pressable>
        </ScrollView>
        {bottomNav('jobs', false)}
        {drawerEl}
        {drafts.length > 0 && (
          <View style={s.homeScrim}>
            <ScrollView contentContainerStyle={{ paddingTop: 56, paddingBottom: 40 }}
              keyboardShouldPersistTaps="handled">
              {draftsOverlay}
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
  /**
   * NOTIFICATIONS (design, 2026-08-12).
   *
   * It replaces a scrim card that listed forty rows of "title / detail" with no
   * grouping, no filter and no sense of when anything happened — everything from this
   * morning and everything from last month looked identical, so the only way to find
   * the thing that changed was to read all of it.
   *
   * GROUPED BY DAY, because recency is the first question. "Today" is what he acts
   * on; "This week" is what he checks he did not miss. The buckets are computed from
   * the row's own timestamp against local midnight, not from a stored bucket, so they
   * stay correct as the day rolls over without anything having to rewrite rows.
   *
   * THE FILTER IS BUILT FROM THE DATA. The design draws All / Jobs / Change Orders /
   * System. Every notification this product currently raises is about a change order
   * — there are no job or system notifications yet — so rendering three fixed pills
   * would give two that are permanently empty and teach a contractor that the filter
   * is broken. Categories with no rows are not offered; when job or system events
   * exist, their pill appears with them.
   */
  if (nav === 'notifications') {
    const nowMs = Date.now();
    const startOfDay = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
    const today = startOfDay(nowMs);
    const yesterday = today - 86400000;
    const weekAgo = today - 6 * 86400000;

    // kind -> the mark and the category it filters under. One table, so a new kind
    // cannot be added to activity.ts and silently render as an unlabelled grey dot.
    // THE DROP'S OWN MARKS. Each carries its disc and its colour, so nothing here
    // paints a ring — a styled circle behind a drawn one never quite agreed on size,
    // which is the mistake the job screen's stat cards already made. The colours are
    // the drop's and they mean things: blue is a message from the client, orange is
    // something changed, green is settled.
    const MARK: Record<string, { icon: IconName; cat: string }> = {
      question: { icon: 'ntChat',     cat: 'co' },   // blue bubble — the client spoke
      approved: { icon: 'ntCheck',    cat: 'co' },   // green tick in its pale disc
      declined: { icon: 'ntExcluded', cat: 'co' },   // ✕ with the attention dot
      unpriced: { icon: 'ntDollar',   cat: 'co' },   // a price he owes
      sent:     { icon: 'ntMail',     cat: 'co' },   // it left
    };
    const CATS: Array<{ k: string; label: string }> = [{ k: 'all', label: T('nt.all') }];
    for (const c of [{ k: 'co', label: T('nt.changeOrders') }]) {
      if (activity.some((a) => (MARK[a.kind]?.cat ?? 'co') === c.k)) CATS.push(c);
    }
    const rows = activity.filter((a) =>
      notifTab === 'all' || (MARK[a.kind]?.cat ?? 'co') === notifTab);

    const groups: Array<{ label: string; rows: typeof rows }> = [
      { label: T('nt.today'),     rows: rows.filter((a) => a.atMs >= today) },
      { label: T('nt.yesterday'), rows: rows.filter((a) => a.atMs >= yesterday && a.atMs < today) },
      { label: T('nt.thisWeek'),  rows: rows.filter((a) => a.atMs >= weekAgo && a.atMs < yesterday) },
      { label: T('nt.earlier'),   rows: rows.filter((a) => a.atMs < weekAgo) },
    ].filter((g) => g.rows.length > 0);

    const stamp = (ms: number) =>
      ms >= today ? new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
      : ms >= yesterday ? T('nt.yesterday')
      : ms >= weekAgo ? new Date(ms).toLocaleDateString(undefined, { weekday: 'short' })
      : new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

    return (
      <View style={s.homeC}>
        {offlineEl}{quotaEl}{heldEl}{celebrateEl}{msgToastEl}{silentEl}
        {/* WITHOUT THIS the out-of-credits modal's Buy is dead on this screen: it sets
            `showPaywall`, and the paywall only exists where it is mounted. */}
        {paywallEl}
        {jobCreatedEl}
        <View style={s.dashHdr}>
          <Pressable style={s.hdrBtn} hitSlop={12} accessibilityLabel={T('common.back')}
            onPress={() => { setNav('home'); void refresh(); }}>
            <Icon name="ntBack" size={22} />
          </Pressable>
          <Text style={s.hdrTitle}>{T('nt.title')}</Text>
          <Pressable style={s.hdrBtn} hitSlop={10} accessibilityLabel={T('drawer.profile')}
            // FROM A SCREEN, not the drawer: back belongs on the notifications list.
            onPress={() => void openSettings('profile', 'screen')}>
            <Icon name="gear" size={21} color="#2F5233" />
          </Pressable>
        </View>

        <ScrollView style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 110 }}
          refreshControl={<RefreshControl refreshing={pulling} onRefresh={onPullRefresh} tintColor={C.steel} />}>

          {CATS.length > 1 && (
            <View style={s.ntPills}>
              {CATS.map((c) => (
                <Pressable key={c.k} style={[s.ntPill, notifTab === c.k && s.ntPillOn]}
                  accessibilityRole="button" accessibilityState={{ selected: notifTab === c.k }}
                  onPress={() => setNotifTab(c.k)}>
                  <Text style={[s.ntPillT, notifTab === c.k && s.ntPillTOn]}>{c.label}</Text>
                </Pressable>
              ))}
            </View>
          )}

          {/* PUSH PERMISSION, only while it is still askable. A standing row telling
              someone notifications are off, on the notifications screen, after they
              have said no, is nagging. */}
          {notifyPerm === 'undetermined' && (
            <Pressable style={s.ntPerm}
              onPress={async () => setNotifyPerm(await requestNotifyPermission())}>
              <Icon name="ntAttention" size={20} />
              <Text style={s.ntPermT}>{T('r8.pushWhy')}</Text>
              <Text style={s.ntPermA}>{T('r8.pushAsk')}</Text>
            </Pressable>
          )}

          {groups.map((g) => (
            <View key={g.label}>
              <Text style={s.ntGroup}>{g.label}</Text>
              <View style={s.ntCard}>
                {g.rows.map((a, i) => {
                  const m = MARK[a.kind] ?? { icon: 'ntQuestion' as IconName, cat: 'co' };
                  return (
                    <Pressable key={a.id} style={[s.ntRow, i > 0 && s.ntRowDiv]}
                      accessibilityRole="button"
                      onPress={async () => {
                        await markRead(db, [a.id]);
                        await refresh();          // rebuilds `activity` with the new read-state
                        void openRecord(a.changeOrderId);
                      }}>
                      <Icon name={m.icon} size={42} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={s.ntTitle} numberOfLines={1}>{T(('r8.kind.' + a.kind) as any)}</Text>
                        <Text style={s.ntBody} numberOfLines={2}>
                          {a.detail ?? `${a.scope}${a.jobName ? ` · ${a.jobName}` : ''}`}
                        </Text>
                      </View>
                      <View style={s.ntRight}>
                        {/* HOW MUCH IS AT STAKE (hadar, 2026-08-25: "it reports on the
                            level or urgency"). A question on a $12,000 extra and one on
                            a $200 extra were the same row and had to be opened to be
                            told apart — on the one list whose whole job is deciding
                            what to deal with first.
                            Omitted, not zeroed, when the extra has no figure yet: a
                            draft the pipeline has not priced is a real state, and "$0"
                            would tell the reader the work is free. */}
                        {a.amountCents != null && (
                          <Text style={s.ntAmt} numberOfLines={1}>
                            {moneyWhole(a.amountCents)}
                          </Text>
                        )}
                        <Text style={s.ntWhen}>{stamp(a.atMs)}</Text>
                        {/* Unread is a filled dot, read is a hollow grey one — the row
                            never loses its trailing mark, so the column stays aligned
                            and "read" is a state rather than an absence. */}
                        <View style={[s.ntDot, a.read ? s.ntDotRead : s.ntDotUnread]} />
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}

          {!rows.length && (
            <EmptyState
              title={T('r8.emptyTitle')} body={T('r8.emptyBody')} />
          )}
          {!!rows.length && (
            <View style={s.ntEnd}>
              <View style={s.ntEndRule} />
              <Text style={s.ntEndT}>{T('nt.caughtUp')}</Text>
              <View style={s.ntEndRule} />
            </View>
          )}
          {/* Gated on unreadIds, NOT unreadCount: 'sent' rows are unread but deliberately
              unbadged, and gating on the badge left them with no control that could ever
              clear their dot. The button clears every unread row it can see. */}
          {unreadIds(activity).length > 0 && (
            <Pressable style={s.ntMarkAll} onPress={async () => {
              await markRead(db, unreadIds(activity));
              await refresh();
            }}>
              <Text style={s.ntMarkAllT}>{T('r8.markAllRead')}</Text>
            </Pressable>
          )}
        </ScrollView>
        {bottomNav('notifications', false)}
        {drawerEl}
      </View>
    );
  }

  if (nav === 'activity') {
    // stateOf + stateColor are now shared with Home (defined once, above).
    const tabLabel: Record<typeof activityTab, string> = {
      all: T('act.tabAll'), waiting: T('act.tabWaiting'),
      approved: T('act.tabApproved'), needs: T('act.tabNeeds'),
      closed: T('home.closedChip'),
    };
    const TABS: Array<typeof activityTab> = ['all', 'waiting', 'approved', 'needs', 'closed'];
    /**
     * `closed` matches TWO state keys — declined and cancelled — so it cannot be the
     * plain equality every other tab uses (hadar, 2026-08-24). Before `stateKey` named
     * `cancelled`, a withdrawn extra answered `stateOf(e) === 'waiting'` and showed under
     * Waiting here as well; now it answers neither, so without this tab it would be
     * reachable only through All.
     */
    const list = homeExtras.filter((e) => {
      if (activityTab === 'all') return true;
      const k = stateOf(e);
      if (activityTab === 'closed') return isClosed(e.status);
      return k === activityTab;
    });
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
            <EmptyState
              title={T('act.emptyTitle')} body={T('act.emptyBody')} />
          )}
        </ScrollView>
        {bottomNav('activity', false)}
        {drawerEl}
        {/* Same reason as home — the drawer opens from here too. */}
        {offlineEl}{quotaEl}{heldEl}{celebrateEl}{msgToastEl}{silentEl}
      {jobCreatedEl}
        {paywallEl}
        {drafts.length > 0 && (
          <View style={s.homeScrim}>
            <ScrollView contentContainerStyle={{ paddingTop: 56, paddingBottom: 40 }}
              keyboardShouldPersistTaps="handled">
              {draftsOverlay}
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
  /**
   * CLOSED IS ITS OWN BUCKET HERE TOO (hadar, 2026-08-24: "under the job section i
   * should be able to see the closed as well").
   *
   * The same fall-through Home had: everything that is not approved, not a draft and
   * not discussing landed in `waiting`, so a DECLINED extra and a WITHDRAWN one both
   * counted toward "Awaiting response" on the job's own stat tile. The tile is a
   * number he reads to decide whether to chase anybody, and it was counting work
   * nobody is going to answer.
   *
   * Ended is ended, whoever ended it — the chip on each card says which.
   */
  /**
   * The same table Home uses. It used to be its own chain with its own default, and its
   * own version of the bug: declined and withdrawn extras counted toward the job's
   * "Awaiting response" tile — a number he reads to decide whether to chase anybody.
   *
   * A DRAFT STILL COUNTS AS `needs` HERE, which differs from Home and is deliberate: on
   * a job screen an unfinished extra IS work owed, and it is his own.
   */
  const jobBucket = (c: LedgerRow): 'needs' | 'waiting' | 'approved' | 'closed' => {
    const b = extraBucket(c.status, questions[c.id] ?? 0);
    return b === 'draft' ? 'needs' : b;
  };
  const jobNeeds = coRows.filter((c) => jobBucket(c) === 'needs');
  const jobWaiting = coRows.filter((c) => jobBucket(c) === 'waiting');
  const jobApproved = coRows.filter((c) => jobBucket(c) === 'approved');
  const jobClosed = coRows.filter((c) => jobBucket(c) === 'closed');
  // The Closed control only exists while something is closed, so a stuck `closed`
  // filter could freeze this list empty with nothing on screen to clear it — the
  // same trap the Jobs list defuses for a colour whose chip has gone. Read the
  // filter through this, never raw.
  const jobFx = jobFilter === 'closed' && !jobClosed.length ? null : jobFilter;
  const jobTotal = coRows.reduce((n, c) => n + (c.amount_cents ?? 0), 0);
  const jobShown = jobFilter === 'needs' ? jobNeeds
    : jobFilter === 'waiting' ? jobWaiting
    : jobFilter === 'approved' ? jobApproved
    : jobFilter === 'closed' ? jobClosed : coRows;
  const jobMapUrl = jobProj
    ? (jobMaps[jobProj.id]
        ?? mapUrlFor(process.env.EXPO_PUBLIC_STATIC_MAP_URL, jobProj.lat, jobProj.lng))
    : null;
  const startCaptureJob = () => { if (!terms) { openTerms(() => setShowCapture(true)); return; } setShowCapture(true); };
  return (
    <View style={s.c}>
      {offlineEl}{quotaEl}{heldEl}{celebrateEl}{msgToastEl}{silentEl}
      {jobCreatedEl}
        {discardSheet}
      {paywallEl}
      {/* WITHOUT THIS, DELETE IS A DEAD BUTTON (hadar, 2026-09-01: "i click on delete
          this job but it doesn't delete the job").

          `deleteJob` reports BOTH outcomes through `setAck` — the refusal and the
          confirmation — and `ackEl` was mounted on five screens, none of them this one.
          So the state flipped into a tree with nothing to draw it and the tap did
          nothing visible, whether the server had refused or agreed. The comment above
          the button says the worst case is "a button that then explains why it
          declined"; it could not explain, because the explanation had nowhere to go.

          Same omission as the drawer's Upgrade and Home's swipe-delete before it, on
          the same screen-local-modal pattern: setting state is not mounting a view. */}
      {ackEl}
      {/* Header: back · Job · bell (mockup 2026-07-23). Fixed above the scroll. */}
      {/* ── THE LETTERHEAD HEADER (design, 2026-08-11) ─────────────────────────
          It said "‹  Job  🔔". "Job" is the app telling the contractor which screen
          he is on, which he knows; the design uses that space for the two facts a
          jobsite screen should carry — which company this is, and which human is
          running it — because the same header appears on the document the client
          signs and the two must agree.

          THE BELL IS NOT LOST: unread activity moves onto the envelope, which is the
          same act (open what came in) with a mark that survives on a white bar. */}
      <View style={s.jsHdr}>
        {/* BACK GOES TO JOBS, NOT HOME (hadar, 2026-08-11). This screen is reached
            by picking a job off the Jobs list, so Home was not where the contractor
            came from — going there discarded his place in the list and made "back"
            mean "start again" every time he wanted the next job. */}
        <Pressable style={s.jsHdrBack} hitSlop={12} accessibilityLabel={T('common.back')}
          onPress={() => { setNav('jobs'); setJobFilter(null); void refresh(); }}>
          <Icon name="chevLeft" size={20} color="#22252A" />
        </Pressable>
        {/* "JOB", CENTRED (hadar, 2026-08-12). The header carried the company name
            and the contractor's own name — his letterhead, which is the right content
            for the CLIENT's page and pointless on his own phone: he knows which
            company he works for, and it pushed the one useful word off the row. The
            company and contact identity still exist and still render where they are
            read by someone who does not already know them — the approval page. */}
        <Text style={s.jsHdrTitle} numberOfLines={1}>{T('job.title')}</Text>
        <Pressable style={s.jsHdrMail} hitSlop={10} accessibilityLabel={T('r8.activity')}
          // THE BELL OPENS THE NOTIFICATIONS SCREEN (hadar, 2026-08-18: "why is the
          // notification style still like this in some cases?").
          //
          // It used to open `activityOverlay`, a second notification surface that
          // predated the design system: a mint-green `s.card`, emoji status icons, and
          // "Mark all as read" / "Close" as 13px grey text links. The real screen was
          // built later and this was never retired, so the same list existed twice in
          // two different visual languages and only one of them ever got updated.
          //
          // Deleting the duplicate rather than restyling it: two surfaces that must be
          // kept looking alike is the condition that produced this.
          onPress={() => setNav('notifications')}>
          <Icon name="envelope" size={22} color="#2F5233" />
          {unreadCount(activity) > 0 && (
            <View style={s.hdrBadge}><Text style={s.hdrBadgeT}>{unreadCount(activity)}</Text></View>
          )}
        </Pressable>
      </View>

      {/* ONE outer ScrollView for the whole body (fixes the old overflow). The
          bottom nav floats absolutely below, so nothing here can displace it. */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 96 }}>
        {/* ── THE HERO ────────────────────────────────────────────────────────
            NO CARD. The design sits the job on the page itself — bordered, it read
            as one more object in a list of objects, and this is the thing the whole
            screen is about. Tapping it still switches jobs. */}
        <Pressable style={s.jsHero} onPress={() => setPicker(true)}>
          {jobMapUrl
            ? <Image source={{ uri: jobMapUrl }} style={s.jsHeroMap} resizeMode="cover" />
            : <View style={s.jsHeroMap}><Icon name="mapHero" size={92} /></View>}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.jsHeroName} numberOfLines={2}>{jobProj?.name ?? T('job.pick')}</Text>
            {!!jobProj?.address && jobProj.address !== jobProj.name && (
              <Text style={s.jsHeroAddr} numberOfLines={2}>{jobProj.address}</Text>
            )}
            {/* EST. COMPLETION IS OMITTED, NOT GUESSED. The design carries a date
                here and nothing in this product stores a job's end; printing one
                derived from schedule days would be a completion date nobody set,
                on the screen a contractor reads it off to a client. */}
            <Text style={s.jsHeroSub}>{T({ k: 'job.acrossReq', p: { n: coRows.length } })}</Text>
          </View>
        </Pressable>

        {/* JOB SETTINGS REMOVED (hadar, 2026-08-11). Colour label, project status
            (Lead / In progress / Complete) and Archive are gone from this screen —
            the design has none of them and they are controls a contractor touches
            about once per job, sitting above the list he opened the screen to read.

            STATED PLAINLY: this screen was their ONLY entry point, so setting a
            colour, changing a job's status and archiving a job are now unreachable
            in the app. The columns, the writers and the Jobs-list FILTERS that read
            them are all untouched — only the way in is gone. They want a home on the
            Jobs list or in the drawer; this is a removal, not a migration, and it is
            recorded here so it cannot pass for one. */}

        {/* THE BLACK "RECORD EXTRA WORK" CARD IS GONE FROM HERE. It is the same act
            as "Create new change order" at the foot of the list, which is where the
            design puts it — and I added that button while leaving this one, so the
            screen carried two primaries for one act, a screenful apart, in different
            colours and different words. The bottom one wins: it is where a contractor
            lands after reading the list and finding the extra he meant to raise is not
            in it. Home still leads with the capture card; that is the screen whose
            whole job is starting one. */}

        {/* THE OLD PILL ROW IS GONE. It duplicated the three stat cards below —
            same three buckets, same counts, two controls for one choice — and it had
            no "All", so showing everything meant deselecting rather than selecting.
            The counts now ARE the filter, and a real All pill sits with the rest. */}

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

      {/* REQ-X3's ONE status, now NARROWED TO THE ONE THAT MATTERS (hadar,
          2026-08-11: "remove the 3 need a job").
          The banner had four levels and three of them were noise on this screen:
            · needs_you — "3 need a job →". Removed. Unfiled captures are NOT
              stranded: the drawer carries the Inbox with its own count, which is the
              route that exists on every screen rather than only this one.
            · safe / waiting — "backed up", "waiting to back up". Reassurance, not
              action, in a coloured box above the work.
          WHAT STAYS IS `not_safe`, and it is not negotiable: "this won't back up"
          is the one sentence mandate #1 forbids being silent about. Deleting the
          banner outright would have taken it with the other three. */}
      {screen && screen.level === 'not_safe' && (
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
          <Text style={s.gateT}>{initError ? 'EZChangeOrders couldn’t start safely' : 'Can’t record safely on this device'}</Text>
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
      {/* NO `coRows.length > 0` GATE ANY MORE (hadar, 2026-09-01: "this is what I
          expect for the job even when empty but I get a completely empty screen when
          there are no co. the header is missing sections").

          THE WHOLE SCREEN BELOW THE HERO WAS BEHIND THAT ONE CONDITION — the counts,
          the money, the "Change orders" heading and the list. So a jobsite with no
          change order rendered its hero and then nothing at all: not an empty state, a
          void. A screen that vanishes reads as a screen that failed to load.

          IT ALSO SWALLOWED THE FIX I SHIPPED THIS MORNING. I put the illustrated empty
          state inside the card list, which is inside this block — so the one case it
          existed for was the exact case that could not reach it. It has never rendered
          once. That is what a gate this high up does: it hides the handling of the
          state it triggers on.

          Everything here is safe at zero: both totals `reduce` from 0, the tiles show
          their own counts, the Closed tile is already conditional, and the banner
          returns null with nothing flagged. */}
      {(() => {
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
          {/* ── THE JOB'S STATE, IN THREE COUNTS AND TWO FIGURES (hadar's job-screen
              design, 2026-08-10) ────────────────────────────────────────────────
              The screen used to open with two money columns and nothing else, so
              "what is waiting on ME?" — the only question a contractor opens this
              screen to ask — was answerable only by reading every row.

              COUNTS AND MONEY ARE SEPARATED ON PURPOSE. A count is work to do; a
              figure is money at stake. Three extras needing approval and $5,400
              pending are different facts and the old card fused them into one line
              per column. */}
          <View style={s.jsStats}>
            {([
              { k: 'needs',    icon: 'statPerson' as const, label: T('job.statNeeds'),    n: jobNeeds.length },
              { k: 'waiting',  icon: 'statClock'  as const, label: T('job.pillWaiting'),  n: jobWaiting.length },
              { k: 'approved', icon: 'statCheck'  as const, label: T('job.statApproved'), n: jobApproved.length },
              // A FOURTH TILE ONLY WHEN THERE IS SOMETHING IN IT. A job where nothing
              // was ever declined or withdrawn should not carry a permanent zero — it
              // reads as a category he is failing at rather than one that is empty.
              ...(jobClosed.length
                ? [{ k: 'closed' as const, icon: 'statClock' as const,
                     label: T('job.statClosed'), n: jobClosed.length }]
                : []),
            ] as const).map((st) => (
              // THE TILE IS THE FILTER, and the only one on this screen. It briefly was
              // not — I made these inert and kept the pills, which fixed the duplication
              // the wrong way round: it left the bare words and threw away the counts.
              // Tap to narrow, tap again to clear.
              <Pressable key={st.k} style={[s.jsStat, jobFx === st.k && s.jsStatOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: jobFx === st.k }}
                accessibilityLabel={`${st.label}: ${st.n}`}
                onPress={() => setJobFilter(jobFx === st.k ? null : st.k)}>
                {/* ICON ON ITS OWN LINE. Beside the words it left ~70pt for a
                    two-word label in three columns on a 13 mini, and every card
                    truncated: "Needs appro…", "Awaitin g resp…", "Approv ed". A
                    label that has to be guessed is not a label. */}
                {/* ICON AND LABEL SHARE THE ROW, as the design draws them, with the
                    label free to take two lines. I had stacked them after the labels
                    truncated — the truncation was the FONT, not the layout: 12.5px
                    beside a 30px disc leaves "Awaiting response" nowhere to go on a
                    375pt screen, 11.5px wrapping to two lines fits. */}
                <View style={s.jsStatTop}>
                  <Icon name={st.icon} size={24} />
                  {/* SAME TYPE SIZE ON ALL THREE. `adjustsFontSizeToFit` shrank only
                      the label that did not fit, so "Awaiting response" rendered
                      visibly smaller than its neighbours — three cards, three type
                      sizes. Two lines are reserved for every card instead, so they
                      match whether the words wrap or not. */}
                  <Text style={s.jsStatLab} numberOfLines={2}>{st.label}</Text>
                </View>
                <Text style={s.jsStatN}>{st.n}</Text>
              </Pressable>
            ))}
          </View>

          {/* PENDING is money OUT ON THE CLIENT — sent and not yet answered. It is
              deliberately not "everything unapproved": a draft on this phone is not
              money at stake, it is work not yet done, and counting it here would
              tell a contractor he is owed something he has not asked for. */}
          <View style={s.jsMoney}>
            <View style={s.jsMoneyCol}>
              <Icon name="statMoney" size={32} />
              <View>
                <Text style={s.jsMoneyLab}>{T('job.totAwaiting')}</Text>
                {/* NO CENTS. The design writes $5,400 and moneyWhole already exists
                    for exactly this ("the .00 is noise at that size", 2026-07-27). */}
                <Text style={[s.jsMoneyVal, s.jsMoneyWait]}>{moneyWhole(awaitingCents)}</Text>
              </View>
            </View>
            <View style={s.jsMoneyDiv} />
            <View style={s.jsMoneyCol}>
              <Icon name="statCheck" size={32} />
              <View>
                <Text style={s.jsMoneyLab}>{T('job.totApproved')}</Text>
                <Text style={s.jsMoneyVal}>{moneyWhole(approvedCents)}</Text>
              </View>
            </View>
          </View>

          <Text style={s.jsH2}>{T('job.changeOrders')}</Text>
          {/* THE PILL ROW IS GONE (hadar, 2026-08-31: "all and gray filters are still
              in the jobs page"). He asked what it was twice, and on THIS screen the
              honest answer was worse than on the Jobs list: the tiles directly above
              already carry the same four buckets, the same icons and the same counts,
              so the pills were the same information a second time in a weaker form —
              the words without the numbers.

              THE TILES FILTER AGAIN, which is where this started: one control, not
              two. Tap a tile to narrow the list, tap it again for everything. The
              cost is that "show me all" has no control of its own — a real loss, and
              the reason the pills were added in the first place — but it buys a
              screen with one filter on it instead of two that disagreed about what
              each bucket was called. */}
          {/* ── ONE FLAT LIST OF RICH CARDS ────────────────────────────────────
              The grouped Waiting / Needs you / Approved sections are gone. They
              answered the same question the three counts above now answer, and they
              answered it worse: the same extra could only be found under whichever
              heading its status put it, so scanning "what is on this job" meant
              reading three lists and holding the order in your head. The pills
              filter; the list stays one list, newest first.

              EACH CARD CARRIES WHAT DISTINGUISHES ONE EXTRA FROM ANOTHER: its number,
              its photograph, its title, when it started and who asked for it, what it
              does to the schedule, its state, and its price. The old card had a
              thumbnail, a title, a type and an amount — two extras raised the same
              week on the same job were indistinguishable. */}
          {(() => {
            // The chip palette moved to `extraChip` so Home, the feed and this screen
            // cannot drift apart — it was defined here AND as `chipStyle` above, and the
            // same extra wore a different colour depending on which screen you opened it
            // from. Outlined, not filled: a filled block the size of a word competed
            // with the price for the same glance.
            // EVERY FILTER GETS ITS OWN BRANCH, including `closed`. It did not have
            // one — the chain ended `: jobApproved`, so selecting Closed silently
            // showed the APPROVED list: a filter that lied about what it was showing.
            // The correct five-way version already existed a few hundred lines up as
            // `jobShown`, computed and never read; this is that logic, in the place
            // that actually renders.
            const rows = jobFx === 'needs' ? jobNeeds
              : jobFx === 'waiting' ? jobWaiting
              : jobFx === 'approved' ? jobApproved
              : jobFx === 'closed' ? jobClosed : coRows;

            if (rows.length === 0) {
              /**
               * TWO DIFFERENT FACTS, and they were sharing one grey line.
               *
               * hadar, 2026-08-31: a jobsite with nothing on it did not get the
               * illustrated empty state that Home and the Jobs list use — it got a
               * sentence, which reads as a list that failed to load rather than as a
               * job waiting for its first change order.
               *
               * But a FILTER that matches nothing is not an empty job: the jobsite is
               * full, it is being seen through a narrow pill. Putting the illustration
               * there would call a busy jobsite empty, so that case keeps the quiet
               * line — it is a statement about the filter, not about the job.
               */
              return coRows.length === 0
                ? <EmptyState compact title={T('job.emptyTitle')} body={T('job.emptyBody')} />
                : <Text style={s.jsEmpty}>{T('job.noneInFilter')}</Text>;
            }

            return rows.map((c) => {
              const bucket = jobBucket(c);
              const asked = isNamedClient(c.who_directed) ? c.who_directed : null;
              return (
                <ExtraCard key={c.id} chip={extraChip(bucket)}
                  kicker={c.co_number != null
                    ? T({ k: 'job.coNo', p: { n: c.co_number } })
                    : T('job.coNoNumber')}
                  title={c.scope}
                  photoUri={c.photo_relpath ? FS.documentDirectory + c.photo_relpath : null}
                  // INSIDE ONE JOB every row shares the address, so it is never said
                  // here — the two facts that separate these rows are when it was
                  // raised and who asked for it.
                  // The same PERSON slot the feed uses, so a human is drawn one way on
                  // every list in the app. The person differs — this is who ASKED for
                  // the work, the feed's is who RAISED the record — which is exactly
                  // why the label travels with the name.
                  /* WHO RAISED IT, like the feed and Home (hadar 2026-08-25: "i cannot
                     see who created it at the bottom it is missing").
                     This showed `asked` — who_directed, the person who ASKED for the
                     work — under "Requested by". Two problems: it is a different fact
                     from who created the record, and `isNamedClient` returns null for
                     the "Owner" sentinel, so on most rows the footer had no name at all.
                     Falls back to the requester when no author row has reached this
                     device, which is better than an empty footer and still true. */
                  person={c.created_by
                    ? { label: T('feed.raisedByLab'), name: c.created_by }
                    : asked ? { label: T('job.requestedByLab'), name: asked } : null}
                  // Same closing line as the feed. It keeps its "Initiated" word — inside
                  // a job the rows differ by WHICH date this is, and the feed's bare date
                  // sits under a heading that already said so.
                  personRight={T({ k: 'job.initiated', p: { d: shortDate(c.created_at_ms) } })}
                  meta={[]}
                  conversation={(questions[c.id] ?? 0) > 0 ? T('job.inConversation') : null}
                  unread={unreadRecords.has(c.id)}
                  /* `synced` is EXISTS(change_order_outbox) — the ledger has carried it
                     since it was written and no list ever showed it. */
                  pending={c.synced ? null : T('erec.onPhone')}
                  amount={c.amount_cents != null ? `+${moneyWhole(c.amount_cents)}` : null}
                  onPress={() => { void openRecord(c.id); }} />
              );
            });
          })()}

          {/* DELETE — only for a jobsite this device believes holds NOTHING.
              Offered at the very bottom, quiet and destructive-coloured, because it is
              the least common thing anyone does here and the one that cannot be undone.

              THE CONDITION IS A HINT, NOT THE AUTHORITY. `coRows` is what this phone
              knows; a capture filed from another device a second ago is invisible to
              it. The server re-checks fourteen tables inside the DELETE, so the worst
              this can do is offer a button that then explains why it declined. */}
          {coRows.length === 0 && (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                const name = projects.find((x) => x.id === projectId)?.name ?? '';
                void askDeleteJob(projectId, name);
              }}
              style={({ pressed }) => [s.jsDelete, pressed ? { opacity: 0.6 } : null]}>
              <Text style={s.jsDeleteT}>{T('job.delete')}</Text>
            </Pressable>
          )}

          {/* ARCHIVE — THE ANSWER FOR A JOB THAT CANNOT BE DELETED.
              (hadar, 2026-08-31: "In the app I still see duplication of addresses.")

              THIS BUTTON DID NOT EXIST, and that was a hole, not a decision. REQ-PM4's
              archived VIEW was built, the un-archive button inside it was built, and
              `pm4.archive` has been sitting in both languages since — but nothing in
              the app ever set a project to `archived`. So the archived list could only
              ever be empty, and the only way off the Jobs list was deletion.

              THAT IS WHY IT MATTERS HERE. Four jobsites at 1155 Stanyan hold 88
              captures between them, two of them under APPROVED change orders that
              mandate #1 says are frozen and permanent. None of them can be deleted, and
              nor should they be — but they can leave the list he works from every day
              without a single capture being destroyed. Tidying and destroying were the
              same act until now, so the only tool for a cluttered list was the one tool
              that is irreversible.

              NO `coRows` GATE, unlike delete: archiving takes nothing away, and a job
              with change orders on it is the ordinary case for a finished job. */}
          <Pressable accessibilityRole="button"
            onPress={() => {
              const name = projects.find((x) => x.id === projectId)?.name ?? '';
              Alert.alert(
                T('pm4.archive'),
                T({ k: 'job.archConfirm', p: { name } } as any),
                [
                  { text: T('common.cancel'), style: 'cancel' },
                  { text: T('pm4.archive'),
                    onPress: () => { void (async () => {
                      const r = await setProjectStatus(connector.client, db, projectId, 'archived');
                      if (!r.ok) { setFiled(statusErr(r.code)); return; }
                      // Off this screen: it is no longer in the list this screen came
                      // from, so staying here would strand him on a job he just filed
                      // away with a back button leading somewhere it is missing.
                      setProjects(await listProjects(db));
                      setNav('jobs');
                    })(); } },
                ],
              );
            }}
            style={({ pressed }) => [s.jsArch, pressed ? { opacity: 0.6 } : null]}>
            <Text style={s.jsArchT}>{T('pm4.archive')}</Text>
          </Pressable>


          {/* THE BOTTOM ACTIONS ARE GONE (hadar, 2026-08-11). "Create new change
              order" and "View change order log" both left the screen.

              CAPTURE IS NOT LOST — the + in the bottom bar is the same act and is on
              every screen, which is why the black card at the top of this one was
              removed a build ago for competing with it. Three doors to one action
              was the problem; this leaves the one that is always in reach.

              THE LOG IS LOST FROM HERE, and it was this screen's only link to it.
              The activity centre it opened is still reachable from the envelope in
              the header (which also carries the unread count), so nothing is
              stranded — but the named entry point is gone and that is a removal, not
              a move. */}
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
      {/* R1: a walk this phone still holds and never filed. Offered BEFORE anything
          else on the screen, because it is the only thing here that can be lost —
          everything below it is already committed. */}
      {draftsOverlay}
      {sendPrep && (() => {
        const sp = sendPrep;
        const sug = sp.suggestion;
        const suggested = sug && sug.kind === 'suggested' ? sug.approver : null;
        /**
         * A SUGGESTION IS NOT A SELECTION (hadar 2026-08-14: "I opted to send a drafted
         * change order, the change order has no client selected, no team members, and
         * yet this is what I see" — a filled-in recipient and a live green Send).
         *
         * `chosen` used to fall back to the router's suggestion whenever nothing had
         * been picked. Everything downstream then read as though a client existed: the
         * card showed a name, `sendPlan` returned `approval`, the button went live, and
         * the hint under it promised "this sends the change order for signature" — for
         * an extra whose own draft screen says "No client selected yet". One tap from
         * there and a signature request goes to somebody nobody chose.
         *
         * The suggestion still shows, with its reason, because that is R5c's whole
         * point — but it is now a PROPOSAL you tap to accept, not a decision already
         * taken on your behalf. Mandate #2 is a human confirming a commitment; tapping
         * Send past a name the app filled in silently is not that confirmation, it is
         * the absence of one.
         */
        const chosen = sp.chosenId
          ? sp.roster.find((r) => r.id === sp.chosenId) ?? null
          : null;
        const proposal = !sp.chosenId
          ? sp.roster.find((r) => r.id === suggested?.id) ?? null
          : null;
        const unconfirmed = !!chosen && sug?.kind === 'suggested'
          && sug.approver.id === chosen.id && !sug.bindsMoney;
        return (
          /* A BOTTOM SHEET, like every other one on this record (2026-08-14). It was a
             card floating in a dim, 64pt down from the top — the only modal in the app
             that arrived from nowhere in particular. The sheet also gives the recipient
             lists room to grow: a company with eight people had them running off a
             fixed-height card. */
          /* NOT `tall`. A fixed 90% left this sheet two-fifths full on a solo account —
             the client, one line saying the team is empty, the button, and then a
             screenful of nothing under it, which is the same floating-in-a-gap problem
             the price section had. Without `tall` the sheet sizes to its content and
             still grows to 88% when a real roster and a real team fill it. */
          <BottomSheet visible title={T('r5c.sendTo')}
            onClose={closeSendPrep}>
          <View>
            {/* NO DOCUMENT HEADER (hadar 2026-08-14: "no need for the title of the
                change order and change order number — they just clicked on the button,
                they know where it is from").
                It was three lines of headline naming a document the reader had been
                looking at one tap earlier, and it pushed the only DECISION on this
                sheet — who gets it — below the fold. The 2026-08-08 note argued mandate
                #2 needs the commitment named before it is confirmed; that still holds,
                and it is satisfied by the screen this sheet opens ON TOP OF, which
                states the scope, the price and the terms in full. Naming it twice is
                not twice as confirmed. */}

            {/* The extra's KIND is set by the AI on processing (hadar, 2026-07-24:
                "i don't want the user to tag it"); the manual type picker was
                removed. sp.type still carries the AI's category for approver
                routing — it just isn't asked here. */}

            {/* ── THE CLIENT ─────────────────────────────────────────────────────
                A HEADING, because the section had none (hadar 2026-08-14: "no client
                for the change order, it opens with SEND TO and lists hadar wissotzky,
                not sure why — it needs to distinguish between client and team, the UX
                and journey confuses me").
                The team block had a heading and this one did not, so the two read as
                different KINDS of thing rather than as two parallel choices: a bare
                person row under the document looked like a fact about the extra instead
                of a slot waiting to be filled. Both now say what they are and what
                picking them does. */}
            {!sp.adding && !sp.picking && (
              <>
                {/* LABEL AND TAG. The explainer sentence under each heading is gone
                    (hadar 2026-08-14: "too much text, a lot of things going on — I am at
                    a jobsite, I am asking myself what do you want from me?").
                    "They sign it. This becomes a real change order." was true and it was
                    also the third line of prose before he reached a single control. What
                    each choice DOES is still said — once, in the line under the button,
                    where it changes with what he has picked and is read at the moment it
                    matters. Twice is not clearer, it is longer. */}
                <View style={[s.spSecLab, { marginTop: 2 }]}>
                  <Text style={s.spSecName}>{T('r5c.secClient')}</Text>
                  <View style={[s.spTag, s.spTagReq]}>
                    <Text style={[s.spTagT, { color: '#3A5230' }]}>{T('r5c.required')}</Text>
                  </View>
                </View>
              </>
            )}
            {sp.adding ? (
              <View style={{ marginTop: 18 }}>
                <Text style={s.spSecH}>{T('r5c.whoApproves')}</Text>
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
                <Pressable style={[s.spSend, !sp.adding.name.trim() && s.spSendOff]}
                  disabled={!sp.adding.name.trim()}
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
                  <Text style={s.spSendT}>{T('r5c.addApprover')}</Text>
                </Pressable>
              </View>
            ) : sp.picking ? (
              <View style={{ marginTop: 18 }}>
                <Text style={s.spSecH}>{T('r5c.whoApproves')}</Text>
                {sp.roster.map((m) => (
                  <Pressable key={m.id} style={s.spRow}
                    onPress={() => { void chooseClient(m); }}>
                    <View style={s.spAvatar}><Icon name="person" size={21} color="#4a4a46" /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.spRowT} numberOfLines={1}>{m.name}</Text>
                      <Text style={s.spRowSub} numberOfLines={1}>{roleLabel(m.role)}</Text>
                    </View>
                    <Text style={s.spChev}>›</Text>
                  </Pressable>
                ))}
                <Pressable style={s.spRow}
                  onPress={() => setSendPrep((p) => p && { ...p, picking: false,
                    adding: { name: '', role: 'owner', phone: '' } })}>
                  <View style={s.spAvatar}><Icon name="personAdd" size={21} color="#4a4a46" /></View>
                  <Text style={[s.spRowT, { flex: 1 }]}>{T('r5c.addApprover')}</Text>
                  <Text style={s.spChev}>›</Text>
                </Pressable>
              </View>
            ) : !chosen ? (
              /* NOTHING IS SELECTED, AND THAT IS THE LOUDEST THING HERE (hadar
                 2026-08-14: "my takeaway — who gets this? → HW. That is wrong").
                 He read it exactly as it was drawn. The suggestion was a full bordered
                 card carrying an 18pt name; the "no client chosen" line was quiet grey
                 above it. The biggest thing on a sheet titled "Who gets this?" was a
                 person's name, so the sheet appeared to answer its own question with
                 somebody nobody had picked.
                 Inverted: the EMPTY SLOT is the object now — dashed, stated, with the
                 one action that fills it directly beneath. The router's guess survives
                 as a single quiet line, because it is a shortcut, not a state. */
              <>
                {/* THE EMPTY SLOT IS THE BUTTON. It was a dashed box saying "No client
                    selected yet" with a bordered "Choose a client" directly beneath —
                    two objects stating one fact and offering one act. The gap it names
                    and the tap that fills it are the same place now. */}
                {/* NAMED ON THE RECORD BUT NOT ON THE ROSTER. `who_directed` stores a
                    NAME; sending needs a person with a phone or an email. Somebody typed
                    into the composer lands here — and telling him to "choose a client"
                    when the extra plainly names one is the same confusion this whole
                    sequence has been fixing. Say what is actually missing. */}
                {isNamedClient(sp.co.who_directed) && (
                  <Text style={s.spEmpty}>
                    {T({ k: 'r5c.savedNoContact', p: { name: sp.co.who_directed } } as any)}
                  </Text>
                )}
                <Pressable style={s.spSlot}
                  onPress={() => setSendPrep((p) => p && { ...p, picking: true })}
                  accessibilityRole="button">
                  <Icon name="personAdd" size={22} color="#4E6243" />
                  <Text style={s.spSlotT}>{T('r5c.chooseClient')}</Text>
                </Pressable>
                {proposal && (
                  /* ONE LINE. Enough to offer it, not enough to be mistaken for the
                     answer. The reason it was suggested moved into the picker, where
                     somebody comparing candidates can read it. */
                  <Pressable style={s.spSuggest}
                    accessibilityRole="button"
                    accessibilityLabel={T({ k: 'r5c.useSuggested', p: { name: proposal.name } } as any)}
                    onPress={() => { void chooseClient(proposal); }}>
                    <Text style={s.spSuggestT} numberOfLines={2}>
                      {T({ k: 'r5c.suggested', p: { name: proposal.name } } as any)}
                    </Text>
                    <Text style={s.spSuggestUse}>{T('r5c.useThem')}</Text>
                  </Pressable>
                )}
              </>
            ) : chosen ? (
              <>
                <Pressable style={s.spPicked}
                  onPress={() => setSendPrep((p) => p && { ...p, picking: true })}>
                  <View style={s.spAvatar}><Icon name="approved" size={21} color="#3A5230" /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.spRowT} numberOfLines={1}>{chosen.name}</Text>
                    {/* The REASON, shown verbatim. R5c: "with the reason visible" — a
                        pre-filled recipient the sender cannot check IS the failure this
                        line exists to prevent, so two lines was the wrong budget: it cut
                        "…on this job → hadar wissotzky" off at the arrow, hiding the half
                        that names who it landed on. */}
                    <Text style={s.spRowSub} numberOfLines={2}>{roleLabel(chosen.role)}</Text>
                  </View>
                  <Text style={s.spChangeT}>{T('r5c.change')}</Text>
                </Pressable>
                {unconfirmed && (
                  <View style={s.spWarn}>
                    <Icon name="alert" size={24} color="#C98A14" />
                    <Text style={[s.spWarnT, { flex: 1 }]}>{T('r5c.unconfirmedAuthority')}</Text>
                  </View>
                )}
              </>
            ) : (
              <>
                {/* NOBODY CAN SIGN THIS. Said as a warning above the act that clears
                    it, not as a red line under a dead button — the contractor has to
                    understand the block before he meets it. */}
                <View style={s.spWarn}>
                  <Icon name="alert" size={26} color="#C98A14" />
                  <View style={{ flex: 1 }}>
                    <Text style={s.spWarnT}>{T('r5c.noSignerH')}</Text>
                    <Text style={s.spWarnT}>{T('r5c.noSignerB')}</Text>
                  </View>
                </View>
                <Pressable style={s.spRow}
                  onPress={() => setSendPrep((p) => p && { ...p,
                    adding: { name: '', phone: '', role: (sug && sug.kind === 'needs_approver'
                      && sug.wantedRole) ? sug.wantedRole : 'owner' } })}>
                  <View style={s.spAvatar}><Icon name="personAdd" size={21} color="#4a4a46" /></View>
                  <Text style={[s.spRowT, { flex: 1 }]}>{T('r5c.addApprover')}</Text>
                  <Text style={s.spChev}>›</Text>
                </Pressable>
              </>
            )}

            {/* ── MY GROUP ─────────────────────────────────────────────────────
                WHO YOU SEND TO DECIDES THE STAGE (hadar 2026-08-14). A client turns
                this draft into a signing instrument; a teammate does not — they get a
                notification, the extra stays a draft, and the review carries on. The
                two are drawn as separate sections with different words for that reason,
                and `sendPlan` (sendplan.ts) is the one place the rule is decided.

                A teammate is NEVER given a signing link. `request_extra_review` (407)
                mints no confirmation_request and cannot touch `change_order`; the
                strongest thing a colleague can do is open the draft and keep working. */}
            {!sp.adding && !sp.picking && (
              <View style={{ marginTop: 20 }}>
                <View style={s.spSecLab}>
                  <Text style={s.spSecName}>{T('r5c.secTeam')}</Text>
                  <View style={[s.spTag, s.spTagOpt]}>
                    <Text style={[s.spTagT, { color: '#6b625b' }]}>{T('r5c.optional')}</Text>
                  </View>
                </View>
                {sp.members.map((m) => {
                  const on = sp.memberIds.includes(m.memberId);
                  return (
                    <Pressable key={m.memberId} style={s.spRow}
                      accessibilityRole="button" accessibilityState={{ selected: on }}
                      onPress={() => setSendPrep((p) => p && {
                        ...p, memberIds: [...toggleMember(
                          { clientId: p.chosenId, memberIds: p.memberIds }, m.memberId).memberIds] })}>
                      <View style={s.spAvatar}>
                        <Icon name={on ? 'approved' : 'person'} size={21}
                          color={on ? '#3A5230' : '#4a4a46'} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.spRowT} numberOfLines={1}>
                          {m.name ?? T('r5c.teamMate')}</Text>
                        <Text style={s.spRowSub} numberOfLines={1}>{T('set.role.' + m.role as any)}</Text>
                      </View>
                    </Pressable>
                  );
                })}

                {/* THE INVITE, WHERE THE NEED IS FELT (hadar 2026-08-14: "I am missing a
                    link to invite someone to the team — it is an opportunity to invite
                    someone").
                    Reaching for a colleague and finding nobody there is the one moment
                    somebody actually wants to add one; sending them to Settings to look
                    for it is sending them away from the thought. Same act as the
                    Settings row — same RPC, same plan cap, same share sheet — offered
                    here rather than duplicated. */}
                <Pressable style={s.spLink} onPress={() => { void inviteFromSend(); }}
                  accessibilityRole="button">
                  <Icon name="personAdd" size={18} color="#4E6243" />
                  <Text style={s.spLinkT}>{T('r5c.inviteTeam')}</Text>
                </Pressable>
              </View>
            )}

            {/* Send is DISABLED until SOMEBODY is named — a client to sign it, or a
                colleague to look at it. Sending a priced commitment to nobody is not a
                degraded send, it is a lost one; and a refused button now looks refused
                and says what would un-refuse it. */}
            {!sp.adding && !sp.picking && (() => {
              const plan = sendPlan({ clientId: chosen?.id ?? null, memberIds: sp.memberIds });
              const memberRows = sp.memberIds
                .map((id) => sp.members.find((m) => m.memberId === id))
                .filter((m): m is Member => !!m);
              /**
               * A2P 10DLC CONSENT (campaign rejected 2026-08-19: error 30909, the
               * reviewer could not verify the Call to Action).
               *
               * In this product the person who RECEIVES the text never visits a website
               * first — the contractor types their number in. There is no web form for a
               * carrier reviewer to inspect, and "there is no form" reads as "there is no
               * consent". This is the artefact: the contractor states, on the record,
               * that he has this person's permission, and the send is refused until he
               * does.
               *
               * ASKED ONCE PER RECIPIENT, not per send. Consent is a fact about a person,
               * not about a message; re-asking on every send would be a tick-box he
               * learns to tap without reading, which is worse evidence than asking once
               * and worse for a gloved thumb besides. `approver.consentAtMs` carries it.
               *
               * IT IS ONLY REQUIRED WHERE A TEXT WILL ACTUALLY GO. A review request to a
               * colleague inside the company is not an A2P message to a consumer, so a
               * `review`-only send is not gated.
               */
              const needsConsent = plan.kind === 'approval' && !!chosen && !chosen.consentAtMs;
              const blocked = plan.kind === 'nothing' || sp.busy || needsConsent;
              return (
              <>
                {needsConsent && (
                  <Pressable
                    onPress={() => { if (chosen) void grantSmsConsent(chosen.id); }}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: false }}
                    style={s.spConsent}>
                    <View style={s.spConsentBox} />
                    <Text style={s.spConsentT}>
                      {T({ k: 'sms.consent', p: { name: chosen?.name ?? '' } } as any)}
                    </Text>
                  </Pressable>
                )}
                <Pressable style={[s.spSend, blocked && s.spSendOff]}
                  disabled={blocked}
                  onPress={async () => {
                    setSendPrep((p) => p && { ...p, busy: true });
                    // The client half FIRST: it is the one that changes the record's
                    // stage, and if it fails there is nothing to tell anybody about.
                    if (plan.kind === 'approval' && chosen) {
                      await sendPricedApproval(sp.co, chosen);
                    }
                    if (memberRows.length) {
                      const r = await requestExtraReview(connector.client, sp.co.id,
                        memberRows.map((m) => m.userId));
                      if (!r.ok) {
                        setAck({ kind: 'no', title: T('r5c.askFailed'), detail: r.reason });
                      }
                      else if (plan.kind === 'review') {
                        // Nothing else says anything happened: the sheet closes onto an
                        // unchanged draft, which is exactly right and exactly silent.
                        setSendPrep(null);
                        setAck({ kind: 'ok',
                          title: T({ k: 'r5c.askedN', p: { n: String(r.notified) } } as any) });
                      }
                    }
                    setSendPrep((p) => p && { ...p, busy: false });
                  }}>
                  <Icon name="send" size={23} color="#fff" />
                  <Text style={s.spSendT}>
                    {sp.busy ? T('r5c.sending')
                      : plan.kind === 'review' ? T('r5c.askReview') : T('r5c.sendIt')}
                  </Text>
                </Pressable>
                {/* What this tap will DO, in one line, before it is tapped. The two
                    outcomes are genuinely different and the button alone cannot say so. */}
                <Text style={s.spHint}>
                  {plan.kind === 'nothing' ? T('r5c.needSomeone')
                    : plan.kind === 'review' ? T('r5c.staysDraft')
                    : T('r5c.goesToClient')}
                </Text>
              </>
              );
            })()}
          </View>
          </BottomSheet>
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
          {/* A TITLED BAR, NOT A FLOATING ✕ (hadar's design, 2026-08-08). The close
              glyph sat alone in the corner with nothing naming the sheet, so the
              screen's first readable word was its own headline. */}
          <View style={s.sentBar}>
            <Text style={s.sentBarT}>{T(sentLink.shared ? 'sent.barSent' : 'sent.barFailed')}</Text>
            <Pressable style={s.sentClose} hitSlop={14} onPress={() => {
              setSentLink(null); setPhotoNote(null);
              if (returnRecordId) { const rid = returnRecordId; setReturnRecordId(null); void openRecord(rid); }
            }}>
              <Text style={s.sentCloseT}>✕</Text>
            </Pressable>
          </View>

          {/* THE MARK. Sent gets the design's signed-document illustration; not-yet
              keeps the small tinted badge, because the drawing says "done" and this
              state is not.
              KNOWN GAP, stated rather than papered over: the design's hand-drawn
              clipboard-with-signature-and-check does not exist as an asset in this
              repo. `checklist` is the nearest APPROVED artwork (the transition set's
              clipboard, pre-coloured sage) and is drawn large here as a stand-in.
              Drop the real drawing into assets/icons and change the name — nothing
              else about this block needs to move.

              Neither is a text character any more: `↗` and `✓` were rendered in
              Barlow, which has neither, so iOS fell back to the emoji font and drew a
              blue-and-white system tile in the middle of a cream sheet. */}
          {sentLink.shared ? (
            <View style={s.sentArt}><Icon name="checklist" size={104} /></View>
          ) : (
            <View style={s.sentBadgeBad}><Icon name="alert" size={29} color="#8A1F11" /></View>
          )}

          <Text style={s.sentH}>{T(sentLink.shared ? 'sent.title' : 'sent.failTitle')}</Text>
          <Text style={s.sentSub}>{T(sentLink.shared ? 'sent.waiting' : 'sent.failSub')}</Text>
          {/* THE REASON, VERBATIM. "Couldn't send" with no cause leaves the contractor
              tapping the same button hoping; the number being unreachable and the share
              sheet being dismissed are different problems with different fixes. */}
          {!sentLink.shared && !!sentLink.failWhy && (
            <Text style={s.sentWhyBad}>{sentLink.failWhy}</Text>
          )}

          {/* THE ROWS ARE STACKED, NOT OPPOSED. Label over value with a glyph in the
              left gutter — the design's shape, and the one that survives real data:
              the old label-left / value-right row right-aligned every value, so a
              two-line scope came out ragged-left and collided with its own price. */}
          <View style={s.sentRows}>
            {!!sentLink.jobName && (
              <View style={s.sentRow}>
                <Icon name="job" size={18} color="#9AA1A8" />
                <View style={{ flex: 1 }}>
                  <Text style={s.sentLab}>{T('sent.job')}</Text>
                  <Text style={s.sentVal} numberOfLines={2}>{sentLink.jobName}</Text>
                </View>
              </View>
            )}
            {/* THE MONEY SITS ALONE ON THE RIGHT (hadar's design, 2026-08-07). It was
                appended to the scope with a middle dot, which made the one number the
                client is agreeing to the tail of a sentence. */}
            {!!sentLink.scope && (
              <View style={s.sentRow}>
                <Icon name="doc" size={18} color="#9AA1A8" />
                <View style={{ flex: 1 }}>
                  <Text style={s.sentLab}>{T('sent.request')}</Text>
                  <Text style={s.sentVal} numberOfLines={2}>{sentLink.scope}</Text>
                </View>
                {!!sentLink.amount && <Text style={s.sentAmt}>{sentLink.amount}</Text>}
              </View>
            )}
            {!!sentLink.sentTo && (
              <View style={s.sentRow}>
                <Icon name="person" size={18} color="#9AA1A8" />
                <View style={{ flex: 1 }}>
                  <Text style={s.sentLab}>{T('sent.to')}</Text>
                  <Text style={s.sentVal} numberOfLines={1}>{sentLink.sentTo}</Text>
                  {/* THE TIME ON ITS OWN LINE, as the design draws it. It was glued to
                      the name with a middle dot, so a long name pushed the one fact
                      that says WHEN this went out off the end of the row. */}
                  {!!sentLink.atMs && (
                    <Text style={s.sentWhen}>
                      {new Date(sentLink.atMs).toLocaleString(undefined,
                        { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </Text>
                  )}
                </View>
              </View>
            )}
            {/* No glyph on Status — the chip is the mark. */}
            <View style={[s.sentRow, s.sentRowLast]}>
              <Text style={[s.sentLab, { flex: 1 }]}>{T('sent.status')}</Text>
              <View style={sentLink.shared ? s.sentChip : s.sentChipBad}>
                <Text style={sentLink.shared ? s.sentChipT : s.sentChipBadT}>
                  {T(sentLink.shared ? 'sent.waitingChip' : 'sent.failChip')}</Text></View>
            </View>
          </View>

          {photoNote && <Text style={s.cardNote}>{photoNote}</Text>}

          {/* THE ORDER IS: DO THE ACT, THEN LEAVE (hadar, 2026-08-08). "View request"
              used to sit ABOVE the send button — a bordered pill between the sentence
              telling him to tap Send and the button that sends. The one thing this
              sheet exists for was the third control down the screen. */}

          {/* A SUCCESSFUL SEND CARRIES NO SEND CONTROLS (hadar's design, 2026-08-08:
              the sent state is "View request" and nothing else). Re-sending is not
              lost — the record's Remind (R8) owns it, with the backoff rules a raw
              re-send has not got.

              ON FAILURE THERE IS EXACTLY ONE BUTTON, and it is the same act the Send
              button just attempted: try both routes again, SMS first, then the phone's
              own share sheet. The screen used to offer two — "Text it to Dave now" and
              "Send it another way" — which asked a man on a ladder to diagnose which
              transport had failed before he could get the link out. */}
          {!sentLink.shared && (
            <Pressable style={s.confirmWide} onPress={async () => {
              const again = await deliverLink({
                url: sentLink.url, shown: sentLink.shown, phone: sentLink.phone ?? null,
                sms: sentLink.sms });
              if (again.ok) void signalSaved();
              setSentLink((sl) => sl && {
                ...sl, shared: again.ok, failWhy: again.ok ? null : again.why });
            }}>
              <Text style={s.confirmT}>{T('sent.retry')}</Text>
            </Pressable>
          )}

          {/* VIEW REQUEST — the way OUT. It opens the extra's record, which is where
              the answer will arrive, so the contractor leaves this screen looking at
              the thing he is now waiting on rather than at Home. */}
          {!!returnRecordId && (
            <Pressable style={s.sentView} onPress={() => {
              const rid = returnRecordId;
              setSentLink(null); setPhotoNote(null); setReturnRecordId(null);
              void openRecord(rid);
            }}>
              <Text style={s.sentViewT}>{T('sent.viewRequest')}</Text>
            </Pressable>
          )}

          {/* Only when it actually went. "You'll get a notification when the client
              responds" under a failed hand-off promises an answer from somebody who
              was never asked. */}
          {sentLink.shared && <Text style={s.sentFoot}>{T('sent.foot')}</Text>}
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

// `coChip` lived here: the FILLED status pill, the feed's own status vocabulary.
// Removed 2026-08-12 when the feed adopted Home's outlined `stateChip` and left it
// with no callers. One vocabulary for one object was the point of the change.

// Light theme. Palette (GitHub-light / CompanyCam-ish): page #f6f8fa, surfaces
// #ffffff, borders #d0d7de, text #1f2328 / #57606a / #8c959f, brand green #1f883d,
// blue #0969da, amber #9a6700, red #cf222e. Overlays that sit ON photos keep a dark
// translucent backing so their text reads over any image.
const s = StyleSheet.create({
  // ── transition screen (FLOW step 1.5), themed 2026-07-27 ──────────────────
  trScreen: { flex: 1, backgroundColor: C.paper },
  trScroll: { alignItems: 'center', paddingTop: 74, paddingHorizontal: 22, paddingBottom: 40 },
  // 28.5 — 5% down from 30, matching the job picker.
  trTitle: { fontFamily: F.disp, fontSize: 28.5, color: C.ink, textTransform: 'uppercase',
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
  trProgT: { fontFamily: F.bodySemi, fontSize: 13.5, color: C.ink, marginTop: 6 },
  // The per-kind counts, quieter than the percentage above them: the percentage is
  // the glance, these are the detail somebody reads when the glance says "slow".
  trProgKinds: { flexDirection: 'row', gap: 14, marginTop: 3 },
  trProgKindT: { fontFamily: F.body, fontSize: 12.5, color: C.steel },

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

  // 16, TO MATCH HOME (hadar, 2026-08-11: "inconsistent with the rest of the pages").
  // Home puts no padding on its container and gives every block `marginHorizontal:
  // 16` — the CTA card, the summary row, the extras group all sit on that gutter. The
  // job screen padded its container 20 instead, so its content was 8pt narrower
  // overall and every card edge missed Home's by 4pt. One number, and now the two
  // screens line up when you flick between them.
  // paddingHorizontal MUST STAY EQUAL TO `EXTRA_GUTTER` (ui/extracard.tsx). The job
  // screen is the one surface whose extra cards are NOT wrapped in `ExtraList` — this
  // padding insets its header, stat tiles and card list together, so it arrives at the
  // same gutter by a different route. Change one without the other and the job screen's
  // cards stop matching Home's, which is the drift this pair of comments exists to stop.
  c: { flex: 1, paddingTop: 72, paddingHorizontal: 16, backgroundColor: '#F7F5F0' },
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
  sentCard: { backgroundColor: '#fff', borderRadius: 18, padding: 20, paddingTop: 8, alignItems: 'center' },
  // The bar: title centred, ✕ absolutely placed so the title stays centred on the
  // CARD rather than on the space left over beside the button.
  sentBar: { alignSelf: 'stretch', height: 44, alignItems: 'center', justifyContent: 'center' },
  sentBarT: { fontFamily: 'Barlow_700Bold', fontSize: 16.5, color: '#151A1E' },
  sentClose: { position: 'absolute', right: 0, top: 4, width: 36, height: 36,
    alignItems: 'center', justifyContent: 'center' },
  sentCloseT: { fontSize: 18, color: '#8A93A0' },
  sentArt: { marginTop: 6, marginBottom: 14, alignItems: 'center', justifyContent: 'center' },
  sentBadge: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#E9F6ED',
    alignItems: 'center', justifyContent: 'center', marginTop: 8, marginBottom: 12 },
  sentBadgeBad: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#FCECE8',
    alignItems: 'center', justifyContent: 'center', marginTop: 8, marginBottom: 12 },
  // The verbatim failure reason. Quieter than the headline and narrower than the
  // card, because it is evidence for the retry — not the message itself.
  sentWhyBad: { fontFamily: 'Barlow_400Regular', fontSize: 13.5, color: '#8A1F11',
    textAlign: 'center', marginTop: 6, marginBottom: 2, lineHeight: 19 },
  sentAmt: { fontFamily: 'Oswald_700Bold', fontSize: 19, color: '#131110', marginLeft: 12 },
  sentWhen: { fontFamily: 'Barlow_400Regular', fontSize: 13.5, color: '#8A93A0', marginTop: 1 },
  // `alignSelf: 'stretch'` because sentCard centres its children: without it this
  // button shrank to the width of the words "View request" and floated mid-card,
  // reading as a chip rather than as one of the two ways off this screen.
  sentView: { alignSelf: 'stretch', marginTop: 14, minHeight: 52, borderRadius: 14,
    borderWidth: 1.5, borderColor: '#d8d2cb', alignItems: 'center', justifyContent: 'center' },
  sentViewT: { fontFamily: 'Inter_600SemiBold', fontSize: 16, color: '#131110' },
  // CONDENSED CAPS, the design's headline. It was sentence-case Barlow at 22, the
  // same weight as a row value, so the sheet had no clear top.
  sentH: { fontFamily: 'BarlowCondensed_700Bold', fontSize: 28, color: '#151A1E',
    textTransform: 'uppercase', letterSpacing: 0.6, textAlign: 'center' },
  sentSub: { fontFamily: 'Barlow_400Regular', fontSize: 15, color: '#6B7280',
    marginTop: 2, marginBottom: 18, textAlign: 'center' },
  sentRows: { alignSelf: 'stretch', borderWidth: 1, borderColor: '#EEEFEC', borderRadius: 12, marginBottom: 16 },
  // Glyph gutter · stacked label/value · optional trailing amount or chip.
  sentRow: { flexDirection: 'row', alignItems: 'center', gap: 11,
    paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#F2F3F0' },
  sentRowLast: { borderBottomWidth: 0 },
  sentLab: { fontFamily: 'BarlowCondensed_600SemiBold', fontSize: 12.5, color: '#8A93A0',
    textTransform: 'uppercase', letterSpacing: 0.8 },
  sentVal: { fontFamily: 'Barlow_600SemiBold', fontSize: 15, lineHeight: 20, color: '#151A1E' },
  sentChip: { borderRadius: 8, borderWidth: 1, borderColor: '#F59E0B', backgroundColor: '#FEF6E7',
    paddingVertical: 4, paddingHorizontal: 10 },
  sentChipT: { fontFamily: 'Barlow_600SemiBold', fontSize: 12.5, color: '#B26A00' },
  // RED, NOT AMBER. Amber is "waiting on somebody else", which is the successful
  // state one line above; a failed hand-off is waiting on YOU and must not wear the
  // same colour as the thing it is not.
  sentChipBad: { borderRadius: 8, borderWidth: 1, borderColor: '#C0442E', backgroundColor: '#FCECE8',
    paddingVertical: 4, paddingHorizontal: 10 },
  sentChipBadT: { fontFamily: 'Barlow_600SemiBold', fontSize: 12.5, color: '#8A1F11' },
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
  // The six FILLED status swatches (chipApproved/Pending/Declined/Revised/Discussing/
  // Draft) were `coChip`'s palette and went with it, 2026-08-12. `chipBase`/`chipText`
  // stay: they still dress other chips.
  bell: { fontSize: 17, opacity: 0.55, paddingHorizontal: 6 },
  bellOn: { fontSize: 15, color: '#fff', backgroundColor: '#4E6243', overflow: 'hidden',
            borderRadius: 11, paddingHorizontal: 8, paddingVertical: 2,
            fontFamily: 'BarlowCondensed_700Bold' },

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
  // The first-run styles lived here: the folded-in language toggle (frLangLab,
  // frLangRow, frLangChip and its on-states), the profile card (frCard, frNote,
  // frInput, the frPick family, the frCta family — added and superseded on the same
  // day), the two-step spine (frDots, frDot, frDotOn) and the trade picker
  // (tradeGrid, tradeCell, tradeCellT). All removed 2026-08-19 when the three-screen
  // flow replaced them; it carries its own styles in `ui/setupflow.tsx`. Verified 0
  // remaining readers before deleting. TRADES itself survives in `src/profile.ts`,
  // because `settingsscreen.tsx` still renders the chips — only the first-run copy
  // of the picker is gone.
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
  // hadar, 2026-08-18: "very faint color and text — needs to be legible in the outdoors."
  // #8c959f on the cream paper measured about 3:1, below the 4.5:1 floor for body text,
  // and this app is read in direct sun with a phone at arm's length. C.steel is ~7:1 and
  // is the colour every other secondary line on these screens already uses; the size and
  // weight go up for the same reason. This style now serves only the FILTERED/SEARCHED
  // empties — true empties render <EmptyState>, which sets its own type.
  homeEmpty: { color: C.steel, fontFamily: 'Barlow_600SemiBold', fontSize: 16,
    lineHeight: 23, textAlign: 'center', marginTop: 40, width: '100%' },
  // Company-feed day header (Today / Yesterday / date). Small caps label, olive-tinted.
  // 18, MATCHING HOME'S `secHead` (hadar, 2026-08-27: "The co record in the list is
  // shorter width wise in the company feed page then the homepage ... need to unify
  // them"). The feed's ScrollView used to carry `paddingHorizontal: 16` AND the cards
  // sat in `exList`, which adds another 16 — so a feed card was inset 32 a side against
  // Home's 16 and read as a narrower, different object. The scroll padding is gone; the
  // heading now carries its own inset, the way Home's already did.
  feedDayHead: { fontFamily: 'BarlowCondensed_600SemiBold', fontSize: 13, color: '#5E666E',
    textTransform: 'uppercase', letterSpacing: 1.4, marginHorizontal: 18,
    marginTop: 20, marginBottom: 6 },

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
  // RED (hadar 2026-08-12), not the mint it was. Green is this app's colour for SETTLED
  // — the approved chip, the recovered pill, the signed stamp — so a green count on the
  // bell read as "things went well" at a glance, which is the opposite of what a badge
  // is for. Red is the app's one alarm colour (#cf222e, the palette's), used nowhere
  // else on this header, and it matches the OS badge sitting on the icon.
  hdrBadge: { position: 'absolute', top: 3, right: 3, minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: '#cf222e', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
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
  // ── first-run Home (no extras yet) ──
  // The hero keeps its geometry and swaps its content. Slightly taller, because two
  // lines of headline plus three of lede is more than the label/figure/sub it replaces.
  heroWrapEmpty: { paddingTop: 10, paddingBottom: 22 },
  // The art moves DOWN and shrinks a touch: with a headline this tall the two would
  // otherwise fight for the same corner. It stays right-anchored — same identity, same
  // side of the screen, in both states.
  houseArtEmpty: { top: 26, width: 196, height: 156 },
  // 44pt Oswald, tight leading, one word per line by hand. The same family and weight
  // as the money figure it stands in for, so the two states read as one screen.
  emptyHead: { fontFamily: 'Oswald_700Bold', fontSize: 44, lineHeight: 46, color: '#131110',
    textTransform: 'uppercase', letterSpacing: -0.5 },
  // Deliberately narrow (maxWidth) rather than full-bleed: it wraps to three short
  // lines clear of the house instead of running under it.
  emptyLede: { fontFamily: 'Inter_400Regular', fontSize: 17, lineHeight: 24, color: '#6b625b',
    maxWidth: 240, marginTop: 14 },
  // The standing-in card. Hairline and cream, NOT the black CTA treatment — it is a
  // statement about the future, and the only thing on this screen to press is above it.
  emptyCard: { flexDirection: 'row', alignItems: 'center', gap: 16, marginHorizontal: 16,
    backgroundColor: '#fdfbf8', borderWidth: 1, borderColor: '#ece5de', borderRadius: 16,
    paddingVertical: 20, paddingHorizontal: 18 },
  emptyDisc: { width: 66, height: 66, borderRadius: 33, backgroundColor: '#e4f4eb',
    alignItems: 'center', justifyContent: 'center' },
  emptyCardT: { fontFamily: 'Inter_700Bold', fontSize: 17, color: '#131110', letterSpacing: -0.2 },
  emptyCardS: { fontFamily: 'Inter_400Regular', fontSize: 14.5, lineHeight: 20, color: '#6b625b',
    marginTop: 4 },
  emptyLearn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
    alignSelf: 'center', marginTop: 22, paddingVertical: 10, paddingHorizontal: 14 },
  emptyLearnT: { fontFamily: 'Inter_600SemiBold', fontSize: 16, color: '#1e6b3a' },
  // ── how it works ──
  howStep: { flexDirection: 'row', gap: 14, marginBottom: 20 },
  howNum: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#131110',
    alignItems: 'center', justifyContent: 'center' },
  howNumT: { fontFamily: 'Oswald_700Bold', fontSize: 16, color: '#fff' },
  howStepT: { fontFamily: 'Inter_700Bold', fontSize: 16.5, color: '#131110' },
  howStepS: { fontFamily: 'Inter_400Regular', fontSize: 14.5, lineHeight: 21, color: '#6b625b',
    marginTop: 3 },
  howFoot: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, color: '#8a827a',
    marginTop: 2, marginBottom: 10 },

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
  /**
   * QUIET UNTIL CHOSEN (hadar, 2026-08-18: "rather than them being 3 colors we need a
   * better on-state design — the selected filter has the prominent color").
   *
   * All three used to be filled at once — ink, butter, mint — with the live one marked
   * by a 2px ring. Three saturated chips competing on one row means the eye has to find
   * a BORDER to answer "which am I looking at", and a border is the weakest signal
   * available. Worse, the colours were reading as importance rather than as state: the
   * amber chip looked like a warning whether or not it was selected.
   *
   * Now there is exactly one loud thing on the row. Unselected chips are the muted
   * surface the rest of the app uses for inert controls; the selected one fills solid
   * ink and inverts its text. Which subset you are looking at is answered by weight, not
   * by hue — which also survives sunlight and colour-blindness, unlike three pastels a
   * shade apart.
   *
   * THE COUNT KEEPS ITS SEMANTIC COLOUR when the chip is quiet, because that badge is
   * the one place the number's MEANING matters — "3 need you" is a different fact from
   * "3 approved". On the selected chip it goes translucent white, since the fill is
   * already carrying the emphasis and a coloured dot on ink reads as a defect.
   */
  // The three per-filter styles are gone: an unselected chip no longer has a colour of
  // its own. Kept as no-ops would have been three names doing nothing, which is how a
  // style sheet starts lying about what it controls.
  // On the selected (ink) chip: the badge stops competing and becomes a hole in the
  // fill. A saturated dot on solid ink reads as something gone wrong.
  secHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 18,
    marginTop: 10, marginBottom: 10 },
  // The artboard's full-width footer button: outlined and white, so it reads as a way
  // ONWARD rather than as another record. It carries no colour — nothing here is an
  // action on money.
  showAllBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 6, marginHorizontal: 16, minHeight: 48,
    borderWidth: 1, borderColor: '#e2dbd4', borderRadius: 12, backgroundColor: '#ffffff',
  },
  showAllBtnT: { fontFamily: 'Inter_600SemiBold', fontSize: 14.5, color: '#3d3733' },
  secLab: { fontFamily: 'Oswald_600SemiBold', fontSize: 15, color: '#6b625b', textTransform: 'uppercase', letterSpacing: 0.8 },
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
  // Gutter only. The rows inside are `ExtraCard`s and draw their own border, so this
  // must NOT add a second one — `exGroup` above is kept for the surfaces that still
  // hold bare rows rather than cards.
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
  tabLab: { fontFamily: 'Inter_500Medium', fontSize: 11.5, color: '#7A8085' },
  tabLabOn: { color: '#2F5233', fontFamily: 'Inter_600SemiBold' },
  // The selected bar under the label. Colour never alone (kit rule) — but here the
  // bar IS the second signal, so a green label over a green rule reads as chosen
  // even to someone who cannot separate the two greens from the greys.
  tabUnder: { height: 3, borderRadius: 2, backgroundColor: '#2F5233',
    alignSelf: 'stretch', marginTop: 5, marginHorizontal: 10 },
  // 64, FILLED, INK-GREEN (hadar, 2026-08-27: "bigger and darker with a white mic
  // inside"). It was a 56pt white circle with a pale ring and dark glyphs, which on a
  // white tab bar had almost nothing to separate it from the bar.
  //
  // THE RING IS WHITE NOW, not green: on a filled dark puck the job of the border is to
  // cut the shadow away from the bar beneath it, and a white collar does that on a
  // white bar. A dark border on a dark fill would be invisible and the puck would
  // smear into its own shadow.
  // ITS OWN DISABLED FILL, not the shared `btnOff`. That one is `#c4cdd5`, a pale grey
  // sized for dark text on a light button — and the glyphs in here are now WHITE, which
  // on pale grey is barely a shape. A muted green keeps the white legible while still
  // reading as unavailable.
  // Its own disabled fill, not the shared `btnOff` — that one is `#c4cdd5`, a pale grey
  // sized for DARK text on a light button, and these glyphs are white. `C.muted` is the
  // palette's mid grey and holds white legibly while still reading as unavailable.
  fabOff: { backgroundColor: C.muted },
  // MATCHED TO hadar's REFERENCE SHOT (2026-08-27): a dark disc, no ring, a white mic
  // carrying a small +.
  //
  // NO BORDER. The white collar I tried first was solving a problem this does not have
  // — it existed to cut the shadow away from a dark puck. The reference has no ring,
  // and without one the disc reads as a control sitting IN the bar rather than a badge
  // stuck on top of it.
  //
  // `C.ink` — OUR OWN PALETTE, NOT A SAMPLED HEX (hadar, 2026-08-27: "we can use one of
  // our collors in our pallete"). I had matched the reference's slate `#2C3A47` by eye,
  // which put a blue-grey into an app that has no blue-grey in it. `ink` is the
  // palette's named colour for exactly this — theme.ts calls it "primary text + dark
  // primary buttons" — so the capture button is now the same dark as every other
  // primary button instead of a one-off.
  //
  // THE TOKEN, not `#151A1E`. That literal appears eleven times in this file and is the
  // pre-palette value; it differs from `ink` by a hair nobody can see, but a token
  // follows the palette when the palette moves and a copied hex does not.
  fab: { width: 68, height: 68, borderRadius: 34, backgroundColor: C.ink,
    // Lifted so the same proportion of the disc clears the bar at the larger size.
    alignItems: 'center', justifyContent: 'center', marginTop: -24,
    shadowColor: '#151A1E', shadowOpacity: 0.32, shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 }, elevation: 6 },
  // The mic and its + are one mark; this box exists so the + can hang off the mic's
  // shoulder without pushing it off centre.
  fabGlyph: { alignItems: 'center', justifyContent: 'center' },
  fabPlus: { position: 'absolute', top: -3, right: -10 },
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
  /** The step line on the post-record screens. Label-quiet: it reports, it does not
   *  compete with the question underneath it. */
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
  // ── job picker (hadar's design, 2026-08-07) — light, calm, one question ──────
  jpC: { flex: 1, backgroundColor: '#faf7f3', paddingTop: 54 },
  jpHero: { backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e2dbd4',
    borderRadius: 14, padding: 16, marginTop: 16 },
  jpHeroTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  jpHeroEyebrow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  jpHeroEyebrowT: { fontFamily: 'Inter_600SemiBold', fontSize: 12, letterSpacing: 1.1,
    textTransform: 'uppercase', color: '#4E6243' },
  jpHeroAddr: { fontFamily: 'Inter_700Bold', fontSize: 24, lineHeight: 29,
    letterSpacing: -0.4, color: '#131110', marginTop: 10 },
  jpHeroName: { fontFamily: 'Inter_400Regular', fontSize: 15, color: '#6b625b', marginTop: 3 },
  jpHeroPill: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12,
    alignSelf: 'flex-start', backgroundColor: '#e7ece2', borderRadius: 999,
    paddingHorizontal: 12, paddingVertical: 5 },
  jpHeroPillT: { fontFamily: 'Inter_600SemiBold', fontSize: 13.5, color: '#4E6243' },
  // 54pt, because this is the button the whole screen exists to offer and it is
  // pressed with a glove on.
  jpHeroBtn: { minHeight: 54, borderRadius: 8, backgroundColor: '#2F4F2A',
    alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  jpHeroBtnT: { fontFamily: 'Inter_700Bold', fontSize: 17, color: '#ffffff' },
  jpOrWrap: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 26,
    marginBottom: 16 },
  jpOrLine: { height: 1, backgroundColor: '#e2dbd4', flexGrow: 1 },
  jpOrT: { fontFamily: 'Inter_600SemiBold', fontSize: 13.5, color: '#6b625b' },
  // 29.5/34 — 5% down from 31/36 (hadar, 2026-08-27). The line-height comes down with
  // it: shrinking the face alone would leave a two-line title looking loosely leaded.
  jpTitle: { fontFamily: 'Inter_700Bold', fontSize: 29.5, lineHeight: 34, color: '#131110' },
  jpSub: { fontFamily: 'Inter_400Regular', fontSize: 15.5, color: '#6b625b', marginTop: 4 },
  jpSearchWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16,
    backgroundColor: '#fff', borderColor: '#e2dbd4', borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 14, minHeight: 52 },
  jpSearch: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 16, color: '#131110', paddingVertical: 12 },
  jpNew: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12,
    backgroundColor: '#eef2ea', borderColor: '#4E6243', borderWidth: 1.5, borderStyle: 'dashed',
    borderRadius: 14, padding: 14 },
  jpNewPlus: { width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, borderColor: '#4E6243',
    alignItems: 'center', justifyContent: 'center' },
  jpNewPlusT: { fontFamily: 'Inter_400Regular', fontSize: 20, color: '#4E6243', lineHeight: 24 },
  jpNewT: { fontFamily: 'Inter_700Bold', fontSize: 17, color: '#3d5236' },
  jpNewSub: { fontFamily: 'Inter_400Regular', fontSize: 14, color: '#5d6b56', marginTop: 1 },
  jpRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10,
    backgroundColor: '#fdfbf9', borderColor: '#e9e2db', borderWidth: 1, borderRadius: 12,
    paddingVertical: 14, paddingHorizontal: 14 },
  jpAddr: { fontFamily: 'Inter_700Bold', fontSize: 16.5, color: '#131110' },
  jpName: { fontFamily: 'Inter_400Regular', fontSize: 14, color: '#6b625b', marginTop: 2 },
  jpDist: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  jpDistT: { fontFamily: 'Inter_600SemiBold', fontSize: 14.5, color: '#4a4a46' },
  jpChev: { fontFamily: 'Inter_400Regular', fontSize: 22, color: '#b3aaa2' },
  jpRecentHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 26, marginBottom: 2 },
  jpRecentH: { fontFamily: 'Inter_700Bold', fontSize: 20, color: '#131110' },
  // 44pt of height on a text link, because gloves do not care that it is styled quietly.
  jpSeeAll: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44,
    paddingLeft: 12 },
  jpSeeAllT: { fontFamily: 'Inter_600SemiBold', fontSize: 16, color: '#2F4F2A' },
  jpSeeAllChev: { fontFamily: 'Inter_400Regular', fontSize: 17, color: '#2F4F2A' },
  jpEmpty: { fontFamily: 'Inter_400Regular', fontSize: 15, color: '#8c959f', marginTop: 24, textAlign: 'center' },
  jpTip: { flexDirection: 'row', gap: 12, marginTop: 26, backgroundColor: '#eef2ea',
    borderRadius: 14, padding: 14 },
  jpTipH: { fontFamily: 'Inter_700Bold', fontSize: 15.5, color: '#4E6243' },
  jpTipT: { fontFamily: 'Inter_400Regular', fontSize: 14.5, lineHeight: 20, color: '#3d4a38', marginTop: 2 },
  // ── JOB SCREEN — measured off the design render, not eyeballed (2026-08-11) ──
  //
  // Every number below came from the same 393pt-wide render, so the proportions hold
  // together instead of each control being nudged on its own. The earlier pass was
  // built from a description of the design and drifted on all of it at once: radii
  // half again too round, cards a third too tall, filled pills where the design has
  // outlines, and cents on figures the design writes whole.
  //
  // THE PAGE IS THE BACKGROUND. Nothing on this screen paints its own white except
  // the change-order cards and the stat cards; the header and the hero sit on the
  // paper, divided by hairlines. A white header on a cream page drew a band across
  // the top that nothing in the design has.

  // Header: transparent, one hairline under it.
  jsHdr: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 0,
    paddingTop: 6, paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#DCD9D1' },
  jsHdrBack: { width: 26, height: 38, alignItems: 'center', justifyContent: 'center' },
  // Centred by taking the row's spare width, so the back chevron and the envelope
  // flank it evenly without either being pushed off on a narrow screen.
  jsHdrTitle: { flex: 1, minWidth: 0, textAlign: 'center',
    fontFamily: 'Inter_600SemiBold', fontSize: 18, color: '#131110' },
  jsHdrMail: { width: 28, height: 38, alignItems: 'center', justifyContent: 'center' },

  jsHero: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 12 },
  jsHeroMap: { width: 96, height: 74, alignItems: 'center', justifyContent: 'center',
    borderRadius: 8, overflow: 'hidden' },
  jsHeroName: { fontFamily: 'Inter_700Bold', fontSize: 24, lineHeight: 29, color: '#131110',
    letterSpacing: -0.5 },
  jsHeroAddr: { fontFamily: 'Inter_400Regular', fontSize: 13.5, lineHeight: 18,
    color: '#5f5a53', marginTop: 3 },
  jsHeroSub: { fontFamily: 'Inter_400Regular', fontSize: 13, color: '#8c959f', marginTop: 4 },

  // Stat cards: SHORTER (71pt, was 96), radius 8 (was 14), content packed left.
  // Measured off the render: the screen inside the bezel is 730px for 393pt, so the
  // scale is 1.858 and every figure below is a divided measurement, not a guess.
  //   card       220 x 132 px  ->  118 x 71 pt
  //   disc        44 px        ->   24 pt
  //   left inset  20 px        ->   11 pt
  //   numeral cap 35 px        ->   26 pt type
  // WHAT WAS ACTUALLY WRONG: the label. At 11.5pt "Awaiting response" needs ~98pt
  // and the card gives it ~83, so the middle card wrapped to two lines while the
  // outer two did not — three cards the same size holding different shapes, which is
  // what reads as "designed differently" before you can say why. It is one line in
  // the design and it is one line now, which sets the type size rather than taste.
  jlNew: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
    minHeight: 50, borderRadius: 8, backgroundColor: '#2F4F2A', marginTop: 12 },
  // ── the Jobs list header (design, 2026-08-31) ──
  jlSearch: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48,
    paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: '#D5D0C7',
    backgroundColor: '#fff', marginTop: 4 },
  // The field takes the rest of the row rather than a fixed width, or a long address
  // types past the edge of the box.
  jlSearchIn: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 15.5, color: '#151A1E',
    paddingVertical: 12 },
  jlArch: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  jlArchT: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: '#5E666E',
    textDecorationLine: 'underline' },
  jlSF: { flexDirection: 'row', gap: 8, paddingVertical: 12, paddingRight: 12 },
  jlSFB: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 40,
    paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: '#D6D2C7',
    backgroundColor: '#fff' },
  jlSFBOn: { backgroundColor: '#2F4F2A', borderColor: '#2F4F2A' },
  jlSFT: { fontFamily: 'Inter_500Medium', fontSize: 13.5, color: '#3f423e' },
  jlSFTOn: { color: '#fff', fontFamily: 'Inter_600SemiBold' },
  // Bolder than the word beside it: the count is the part that is scanned.
  jlSFN: { fontFamily: 'Inter_700Bold', fontSize: 13.5, color: '#3f423e' },
  jlSFBOff: { backgroundColor: '#F4F1EA', borderColor: '#E4E0D6' },
  jlSFTOff: { color: '#B7B2A8' },
  jlNewT: { fontFamily: 'Inter_700Bold', fontSize: 16, color: '#fff' },
  // ── notifications ──
  tabBadge: { position: 'absolute', top: -4, right: -8, minWidth: 17, height: 17,
    borderRadius: 9, backgroundColor: '#C2610C', alignItems: 'center',
    justifyContent: 'center', paddingHorizontal: 4 },
  tabBadgeT: { fontFamily: 'Inter_700Bold', fontSize: 10.5, color: '#fff' },
  ntPills: { flexDirection: 'row', gap: 8, marginTop: 12, marginBottom: 4 },
  ntPill: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 15, borderRadius: 999,
    borderWidth: 1, borderColor: '#D6D2C7', backgroundColor: 'transparent' },
  ntPillOn: { backgroundColor: '#131110', borderColor: '#131110' },
  ntPillT: { fontFamily: 'Inter_500Medium', fontSize: 13.5, color: '#3f423e' },
  ntPillTOn: { color: '#FFFFFF', fontFamily: 'Inter_600SemiBold' },
  ntPerm: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: '#F1F4EF',
    borderRadius: 8, padding: 12, marginTop: 10 },
  ntPermT: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 13, color: '#3d4a38' },
  ntPermA: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: '#2F5233' },
  ntGroup: { fontFamily: 'Inter_500Medium', fontSize: 13.5, color: '#6b625b',
    marginTop: 18, marginBottom: 8 },
  ntCard: { backgroundColor: '#FFFFFF', borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#DEDBD3', borderRadius: 12, overflow: 'hidden' },
  ntRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 13 },
  ntRowDiv: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#EBE8E1' },
  ntTitle: { fontFamily: 'Inter_700Bold', fontSize: 15.5, color: '#131110' },
  ntBody: { fontFamily: 'Inter_400Regular', fontSize: 13.5, lineHeight: 18.5,
    color: '#5f5a53', marginTop: 2 },
  ntRight: { alignItems: 'flex-end', gap: 8 },
  /**
   * The amount on a notification row. Bold and in ink, ABOVE the timestamp — it is the
   * thing being scanned for, and the time is the qualifier. Same brand green and weight
   * the card uses for a price (`extracard`'s `amt`), so a figure means the same thing
   * wherever it appears.
   */
  ntAmt: { fontFamily: 'Inter_700Bold', fontSize: 14, color: '#2F5233', letterSpacing: -0.3 },
  ntWhen: { fontFamily: 'Inter_400Regular', fontSize: 12.5, color: '#8c959f' },
  ntDot: { width: 9, height: 9, borderRadius: 5 },
  ntDotUnread: { backgroundColor: '#2F5233' },
  ntDotRead: { backgroundColor: '#D2CEC6' },
  ntEnd: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 22 },
  ntEndRule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: '#DEDBD3' },
  ntEndT: { fontFamily: 'Inter_400Regular', fontSize: 13.5, color: '#8c959f' },
  ntMarkAll: { minHeight: 46, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  ntMarkAllT: { fontFamily: 'Inter_600SemiBold', fontSize: 14.5, color: '#2F5233' },

  // ── job created sheet ──
  jcWrap: { flex: 1, backgroundColor: 'rgba(20,22,20,0.45)', alignItems: 'center',
    justifyContent: 'center', padding: 24 },
  jcBox: { width: '100%', maxWidth: 380, backgroundColor: '#FFFFFF', borderRadius: 16,
    paddingHorizontal: 22, paddingTop: 26, paddingBottom: 20, alignItems: 'center' },
  jcX: { position: 'absolute', top: 10, right: 12, width: 36, height: 36,
    alignItems: 'center', justifyContent: 'center' },
  jcXT: { fontSize: 19, color: '#8A93A0' },
  jcTitle: { fontFamily: 'Inter_700Bold', fontSize: 25, color: '#131110', marginTop: 10,
    letterSpacing: -0.5 },
  jcSub: { fontFamily: 'Inter_400Regular', fontSize: 14.5, lineHeight: 20, color: '#5f5a53',
    textAlign: 'center', marginTop: 8, marginBottom: 20 },
  jcPrimary: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 9, minHeight: 54, borderRadius: 8,
    backgroundColor: '#2F4F2A' },
  jcPrimaryT: { fontFamily: 'Inter_700Bold', fontSize: 16.5, color: '#fff' },
  jcSecondary: { alignSelf: 'stretch', minHeight: 50, borderRadius: 8, borderWidth: 1.5,
    borderColor: '#2F4F2A', alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  jcSecondaryT: { fontFamily: 'Inter_600SemiBold', fontSize: 16, color: '#2F4F2A' },

  // ── new job screen shell ──
  // Was `s.c` (flex + paddingTop 72 + padding 16). Split in two because the padding now
  // belongs to the SCROLL CONTENT and the flex to the keyboard-avoiding box — a
  // ScrollView with padding on the outer view clips its own content instead of scrolling
  // it. flexGrow keeps the `flex: 1` spacer working, so on a tall phone with no keyboard
  // the footer still sits at the bottom rather than riding up under the note.
  njScreen: { flex: 1, backgroundColor: '#F7F5F0' },
  njScroll: { flexGrow: 1, paddingTop: 72, paddingHorizontal: 16, paddingBottom: 24 },

  // ── company logo ──
  logoPreviewWrap: { alignItems: 'center', marginTop: 4, marginBottom: 14 },
  // Big enough to judge by. The whole question this sheet answers is "is this the mark
  // my clients should see?", and that cannot be answered off a 44pt thumbnail.
  logoPreview: { width: 132, height: 132, borderRadius: 14, borderWidth: 1,
    borderColor: '#ece5de', backgroundColor: '#fff' },
  logoPreviewEmpty: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#fdfbf8' },
  logoNote: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, color: '#6b625b',
    textAlign: 'center', marginBottom: 18 },
  logoBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
    minHeight: 52, borderRadius: 10, backgroundColor: '#2F4F2A' },
  logoBtnT: { fontFamily: 'Inter_700Bold', fontSize: 16.5, color: '#fff' },
  logoRemove: { alignItems: 'center', justifyContent: 'center', minHeight: 48, marginTop: 4 },
  logoRemoveT: { fontFamily: 'Inter_600SemiBold', fontSize: 15.5, color: '#cf222e' },

  // ── edit acknowledgement ──
  // BOTTOM-ANCHORED (hadar, 2026-08-15: "it needs to have some sort of bottom
  // popup"). Every other transient surface in this app is a bottom sheet, and an ack
  // floating in the middle of the screen was the one thing that arrived somewhere
  // else — over the content it is reporting on, under the thumb that cannot reach it.
  // At the bottom it lands where his hand already is and where he has learned to look.
  ackWrap: { flex: 1, backgroundColor: 'rgba(20,22,20,0.35)', alignItems: 'center',
    justifyContent: 'flex-end', paddingHorizontal: 14, paddingBottom: 28 },
  ackBox: { width: '100%', maxWidth: 460, backgroundColor: '#FFFFFF', borderRadius: 18,
    paddingHorizontal: 22, paddingTop: 22, paddingBottom: 20, alignItems: 'center' },
  // A refusal is not a confirmation wearing a different icon: it carries the warning
  // hairline so the two are told apart before either is read.
  ackBoxNo: { borderWidth: 1.5, borderColor: '#E4A33B' },
  ackTitle: { fontFamily: 'Inter_700Bold', fontSize: 18.5, color: '#131110', marginTop: 10,
    textAlign: 'center', letterSpacing: -0.3 },
  // The echoed value. Bigger and darker than a caption because on the cost sheet THIS
  // is the line worth reading — the title only names which field moved.
  ackDetail: { fontFamily: 'Inter_600SemiBold', fontSize: 16, lineHeight: 22, color: '#2F4F2A',
    textAlign: 'center', marginTop: 6 },
  ackBtn: { alignSelf: 'stretch', minHeight: 46, borderRadius: 8, borderWidth: 1.5,
    borderColor: '#2F4F2A', alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  ackBtnT: { fontFamily: 'Inter_600SemiBold', fontSize: 15.5, color: '#2F4F2A' },

  // ── new job (design pass, 2026-08-12) ──
  njTitle: { fontFamily: 'Inter_700Bold', fontSize: 27, color: '#131110',
    letterSpacing: -0.6, marginTop: 4 },
  njSub: { fontFamily: 'Inter_400Regular', fontSize: 14.5, lineHeight: 20,
    color: '#5f5a53', marginTop: 6, marginBottom: 22 },
  njField: { marginBottom: 16 },
  njLab: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: '#3f423e', marginBottom: 7 },
  njInput: { minHeight: 52, borderRadius: 8, borderWidth: 1, borderColor: '#DEDBD3',
    backgroundColor: '#FFFFFF', paddingHorizontal: 14,
    fontFamily: 'Inter_400Regular', fontSize: 16, color: '#131110' },
  njNote: { flexDirection: 'row', gap: 10, alignItems: 'flex-start',
    backgroundColor: '#F1F4EF', borderRadius: 8, padding: 12, marginTop: 2 },
  njNoteT: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 13.5, lineHeight: 19,
    color: '#3d4a38' },
  // The commit sits at the BOTTOM of the screen, where the thumb already is, rather
  // than immediately under the last field where it competes with the keyboard.
  njDupe: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12,
    paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10, borderWidth: 1,
    borderColor: '#E4CFC9', backgroundColor: '#FBF1EE' },
  njDupeT: { fontFamily: 'Inter_600SemiBold', fontSize: 13.5, color: '#8B5148' },
  njDupeN: { fontFamily: 'Inter_400Regular', fontSize: 13, color: '#6b625b', marginTop: 1 },
  njDupeGo: { fontFamily: 'Inter_700Bold', fontSize: 13.5, color: '#8B5148',
    textDecorationLine: 'underline' },
  njFoot: { paddingBottom: 10 },
  njCreate: { minHeight: 54, borderRadius: 8, backgroundColor: '#2F4F2A',
    alignItems: 'center', justifyContent: 'center' },
  njCreateT: { fontFamily: 'Inter_700Bold', fontSize: 17, color: '#fff' },
  njCancel: { minHeight: 46, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  njCancelT: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: '#5f5a53' },

  // ── Jobs list card (design, 2026-08-11) ──
  jlCard: { flexDirection: 'row', backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#DEDBD3', borderRadius: 12,
    overflow: 'hidden', marginBottom: 12 },
  jlMap: { width: 104, alignSelf: 'stretch', minHeight: 150, backgroundColor: '#ECEDEA' },
  jlMapEmpty: { alignItems: 'center', justifyContent: 'center' },
  jlTitleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  jlName: { flex: 1, minWidth: 0, fontFamily: 'Inter_700Bold', fontSize: 16.5,
    lineHeight: 21, color: '#131110', letterSpacing: -0.3 },
  jlAddr: { fontFamily: 'Inter_400Regular', fontSize: 13, color: '#6b625b', marginTop: 3 },
  jlAct: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  jlActT: { fontFamily: 'Inter_400Regular', fontSize: 13, color: '#4a4a46' },
  jlStats: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 11, paddingTop: 11,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E4E1D9' },
  jlStat: { flex: 1, alignItems: 'center' },
  jlStatDiv: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', backgroundColor: '#E4E1D9' },
  jlStatIco: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  jlStatLab: { fontFamily: 'Inter_400Regular', fontSize: 10.5, color: '#5f5a53', marginTop: 5 },
  jlStatN: { fontFamily: 'Inter_700Bold', fontSize: 20, marginTop: 2, letterSpacing: -0.4 },
  jlUnarchive: { minHeight: 40, justifyContent: 'center', marginTop: 6 },
  jlUnarchiveT: { fontFamily: 'Inter_600SemiBold', fontSize: 13.5, color: '#4E6243' },
  // Quiet, and the palette's muted brick rather than a red — deleting an empty
  // jobsite is tidying, not an emergency. 48pt because it is still destructive.
  // Archive sits ABOVE delete and in the calm steel, not the brick: it is the safe
  // action of the two, and the safe one should be the one the thumb reaches first.
  jsArch: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  jsArchT: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: '#5E666E' },
  jsDelete: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 22 },
  jsDeleteT: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: '#8B5148' },
  jsStats: { flexDirection: 'row', gap: 8, marginTop: 2 },
  jsStat: { flex: 1, backgroundColor: '#FFFFFF', borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#DEDBD3', borderRadius: 8, paddingHorizontal: 11, paddingVertical: 10,
    minHeight: 71, justifyContent: 'space-between' },
  jsStatOn: { borderWidth: 1.5, borderColor: '#2F5233' },
  jsStatTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  jsStatLab: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 10.5, lineHeight: 13,
    color: '#3f423e', height: 26 },
  // CENTRED under the label (hadar, 2026-08-11). Left-aligned, a single digit sat
  // hard against the card's left edge with the whole label above it — the number is
  // the thing being read and it looked like an afterthought pinned to a corner.
  jsStatN: { fontFamily: 'Inter_700Bold', fontSize: 26, color: '#2F5233',
    letterSpacing: -0.8, lineHeight: 30, textAlign: 'center', alignSelf: 'stretch' },

  // Money band: radius 8, peach, one hairline divider.
  jsMoney: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FBF6EC',
    borderWidth: 1, borderColor: '#EDE3D2', borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 12, marginTop: 9 },
  jsMoneyCol: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9 },
  jsMoneyDiv: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch',
    backgroundColor: '#E2D6C2', marginHorizontal: 6 },
  jsMoneyLab: { fontFamily: 'Inter_400Regular', fontSize: 12.5, color: '#5f5a53' },
  jsMoneyVal: { fontFamily: 'Inter_700Bold', fontSize: 22, color: '#2F5233', marginTop: 1,
    letterSpacing: -0.6 },
  jsMoneyWait: { color: '#2F5233' },

  jsH2: { fontFamily: 'Inter_700Bold', fontSize: 21, color: '#131110', marginTop: 16,
    letterSpacing: -0.4 },

  // ── the record row's type scale (hadar 2026-08-13: "increase the gaps between
  // lines and increase the font of the smaller letters") ──────────────────────────
  // The card had one dominant size (the 18pt title) and everything else at 10.5-12pt,
  // which read as a headline with fine print under it. The supporting lines carry the
  // facts somebody actually scans for — which extra, when, how long, how much — so
  // they were too quiet, and packed too tightly to separate at a glance. Small type is
  // raised roughly a point each and the vertical rhythm opened up; the title and the
  // price keep their sizes, because the hierarchy was right, only the floor was low.
  // WIDTH RECLAIMED FROM THE FURNITURE, NOT FROM THE TYPE (2026-08-13). The widest
  // pair this row can hold — "Change Order #18" beside "Waiting on owner" — overran a
  // 375pt screen by a few points and clipped the chip. The fix is not to shrink the
  // text that was just deliberately enlarged: the thumbnail gives up 4pt and the two
  // gaps 3pt between them, which buys the top row its margin and widens the meta and
  // schedule lines underneath for free.
  jsCard: { flexDirection: 'row', gap: 9, backgroundColor: '#FFFFFF', borderWidth: 1,
    borderColor: '#E4E1D9', borderRadius: 8, padding: 12, marginBottom: 8 },
  jsThumb: { width: 72, height: 72, borderRadius: 6, backgroundColor: '#EFEBE3' },
  jsCardTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  // flexShrink, not flex — the number gives way to the chip rather than the other way
  // round, and never collapses below a readable width.
  // THE NUMBER HOLDS ITS WIDTH; THE CHIP IS WHAT GIVES.
  //
  // Reversed on 2026-08-13, from a screenshot where the first row read "Change Order
  // #..." while the row under it read "Change Order #17". The comment above used to
  // argue the other way, and it had it backwards: the number is the record's
  // IDENTIFIER — the only thing separating two extras raised the same week on the same
  // job, which is the exact confusion this card was redesigned to end. The chip can
  // afford to lose a character because its meaning is carried three other ways: its
  // colour, its outline, and the filter pill the reader just tapped.
  jsCardNo: { flexShrink: 0, fontFamily: 'Inter_600SemiBold', fontSize: 13.5, color: '#2F5233' },
  jsChip: { flexShrink: 1, marginLeft: 'auto', borderRadius: 999, borderWidth: 1,
    paddingHorizontal: 7, paddingVertical: 3 },
  jsChipT: { fontFamily: 'Inter_600SemiBold', fontSize: 11, letterSpacing: 0.1 },
  jsCardName: { fontFamily: 'Inter_700Bold', fontSize: 18, lineHeight: 23, color: '#131110',
    marginTop: 5, letterSpacing: -0.3 },
  jsCardMeta: { fontFamily: 'Inter_400Regular', fontSize: 13, color: '#6b625b', marginTop: 2 },
  jsCardSched: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  jsCardSchedT: { fontFamily: 'Inter_400Regular', fontSize: 13, color: '#6b625b' },
  // The second row: meta on the left, price and chevron pinned right. Both hold their
  // width (flexShrink 0) so the text column is what gives, not the money.
  jsCardBottom: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 6 },
  jsCardPrice: { flexShrink: 0, alignItems: 'flex-end' },
  jsCardAmt: { fontFamily: 'Inter_700Bold', fontSize: 18, color: '#2F5233', letterSpacing: -0.5 },
  jsCardAmtL: { fontFamily: 'Inter_400Regular', fontSize: 12.5, color: '#6b625b', marginTop: 2 },
  jsChev: { fontFamily: 'Inter_400Regular', fontSize: 20, color: '#b3aaa2', marginTop: 2 },
  jsEmpty: { fontFamily: 'Inter_400Regular', fontSize: 14.5, color: '#8c959f',
    textAlign: 'center', paddingVertical: 24 },
  // ── R5c send sheet (hadar's design, 2026-08-08) ──────────────────────────────
  // Cream paper, not the old amber `money` box. The amber is spent on the ONE
  // warning that stops the send, so it means something when it appears.
  spCard: { backgroundColor: '#FBF9F1', borderRadius: 20, borderWidth: 1,
    borderColor: '#DDE0CE', padding: 22 },
  spKicker: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: '#6F7A5E',
    textTransform: 'uppercase', letterSpacing: 1.5 },
  spTitle: { fontFamily: 'Inter_700Bold', fontSize: 29, lineHeight: 35, color: '#131110',
    marginTop: 8 },
  spDoc: { fontFamily: 'Inter_400Regular', fontSize: 16, color: '#8A8A80', marginTop: 6 },
  spSecH: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: '#6F7A5E',
    textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 10 },

  // ── the send sheet's hierarchy (rebuilt 2026-08-14) ─────────────────────────────
  // hadar: "it's hard to tell without spending time to learn this form what it is —
  // lacks UX balance that visually sets intuitively."
  //
  // THE DIAGNOSIS: everything weighed the same. The chosen client, "choose someone
  // else" and "invite someone" were three identical bordered cards — same border, same
  // radius, same 44pt disc, same 18pt bold label. Identical shape reads as identical
  // meaning, so nothing said which one was the decision, which was an alternative, and
  // which was an unrelated action. With no visual ranking the eye cannot skim; you have
  // to READ all of it, which is the complaint.
  //
  // THE RULE APPLIED: a STATE is a filled card. An ALTERNATIVE is an outlined row. An
  // ACTION is a text link. Three jobs, three shapes.
  spSecLab: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 22 },
  // Sentence case, one or two words. The old labels were sentences set in caps with
  // letter-spacing — "ASK SOMEONE ON YOUR TEAM TO REVIEW IT" wrapped to two lines, and
  // a label that wraps is a sentence wearing a label's clothes.
  // 22, not 19 (hadar: "their titles are so small, the only thing I see is HW"). The
  // section names have to out-weigh whatever sits under them, or the loudest NAME on
  // the sheet becomes its apparent answer.
  spSecName: { fontFamily: 'Inter_700Bold', fontSize: 22, color: '#131110', letterSpacing: -0.3 },
  // Required vs optional, stated once and visibly, instead of left to the prose.
  spTag: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2.5 },
  spTagReq: { backgroundColor: '#EDF2E9' },
  spTagOpt: { backgroundColor: '#EFEBE3' },
  spTagT: { fontFamily: 'Inter_600SemiBold', fontSize: 11.5, letterSpacing: 0.3 },
  spSecSub: { fontFamily: 'Inter_400Regular', fontSize: 14.5, color: '#6b625b', marginTop: 3 },
  // CHOSEN: filled, not outlined. A selection should look settled.
  spPicked: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 12,
    minHeight: 64, borderRadius: 14, backgroundColor: '#EDF2E9',
    borderWidth: 1, borderColor: '#C3D3BA', paddingHorizontal: 14, paddingVertical: 10 },
  // An ACTION, not an option. No border, no disc competing with the recipients.
  spLink: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, marginTop: 6 },
  spLinkT: { fontFamily: 'Inter_600SemiBold', fontSize: 16, color: '#4E6243' },
  // Left-aligned like everything else it sits under. Centred text inside a
  // left-aligned form has nothing to hang from.
  spEmpty: { fontFamily: 'Inter_400Regular', fontSize: 15, color: '#8A8A80', marginTop: 10 },

  // THE EMPTY SLOT. Dashed, because a dashed outline reads as "something goes here"
  // in a way a solid one never does — a solid box with grey text reads as a disabled
  // item that already has content.
  spSlot: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12,
    minHeight: 62, borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed',
    borderColor: '#7E8C72', paddingHorizontal: 16 },
  spSlotT: { fontFamily: 'Inter_700Bold', fontSize: 17, color: '#2F3D28' },
  // The act that fills the slot, directly under it and clearly primary WITHIN the
  // section — outlined rather than filled, so it never competes with Send.
  spChoose: { minHeight: 54, borderRadius: 12, borderWidth: 1.5, borderColor: '#3E4A33',
    alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  spChooseT: { fontFamily: 'Inter_700Bold', fontSize: 17, color: '#2F3D28' },
  // The router's guess, demoted to one quiet line. It used to be the largest object on
  // the sheet; a shortcut must never outrank the decision it shortcuts.
  spSuggest: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 46,
    marginTop: 8 },
  spSuggestT: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 14.5, color: '#6b625b' },
  spSuggestUse: { fontFamily: 'Inter_700Bold', fontSize: 14.5, color: '#4E6243' },
  spWarn: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 18,
    backgroundColor: '#FBEFD8', borderRadius: 12, padding: 14 },
  spWarnT: { fontFamily: 'Inter_400Regular', fontSize: 15.5, lineHeight: 21, color: '#8A5A11' },
  spRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 14,
    minHeight: 66, borderWidth: 1.5, borderColor: '#3E4A33', borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 10 },
  spAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#EDEAE2',
    alignItems: 'center', justifyContent: 'center' },
  spRowT: { fontFamily: 'Inter_700Bold', fontSize: 18, color: '#131110' },
  spRowSub: { fontFamily: 'Inter_400Regular', fontSize: 14, color: '#6b625b', marginTop: 2 },
  spChev: { fontFamily: 'Inter_400Regular', fontSize: 24, color: '#3E4A33' },
  spChangeT: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: '#4E6243' },
  // The A2P consent tick. A full-width row rather than a small box: it is a statement he
  // is making on the record, and it has to be readable and tappable with gloves on.
  spConsent: { flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: '#FBF8F1', borderWidth: 1, borderColor: '#D8D1C4', borderRadius: 12,
    padding: 14, marginBottom: 10, minHeight: 56 },
  spConsentBox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2,
    borderColor: '#4E6243', marginTop: 1 },
  spConsentT: { flex: 1, fontFamily: 'Barlow_400Regular', fontSize: 14.5, lineHeight: 20,
    color: '#161918' },
  spSend: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12,
    minHeight: 66, borderRadius: 12, backgroundColor: '#4E6243', marginTop: 18 },
  // Refused reads as refused. Paired with the `spHint` line below it, which names
  // the missing thing — a greyed button with no reason is the same dead end.
  spSendOff: { backgroundColor: '#B9C1AE' },
  spSendT: { fontFamily: 'Inter_700Bold', fontSize: 20, color: '#fff' },
  spHint: { fontFamily: 'Inter_400Regular', fontSize: 15, color: '#8A8A80',
    textAlign: 'center', marginTop: 10 },
  spCancel: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', marginTop: 8 },
  spCancelT: { fontFamily: 'Inter_700Bold', fontSize: 17, color: '#131110' },
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
  // jobItem/jobItemName/jobItemMeta went with the feed's old row (2026-08-12) —
  // its bordered card and Barlow scale, replaced by Home's exGroup/exRow family.
  jobCount: { fontFamily: 'BarlowCondensed_700Bold', fontSize: 19, color: '#151A1E', marginRight: 8 },
});
