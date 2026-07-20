import '@azure/core-asynciterator-polyfill';
import 'react-native-get-random-values';

import { OPSqliteOpenFactory } from '@powersync/op-sqlite';
import { PowerSyncDatabase } from '@powersync/react-native';
import * as FS from 'expo-file-system/legacy';
import React from 'react';
import { Dimensions, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppSchema } from './src/AppSchema';
import { ago, projectCards, staticMapUrl, type ProjectCard } from './src/ui/home';
import { REJECT_DDL, SupabaseConnector } from './src/connector';
import { getSeenOnboarding, setSeenOnboarding } from './src/auth';
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
import { photoCapture, pickFromLibrary, recordVideo, textCapture, voiceCapture } from './src/modality';
import { FusedCapture, type FusedArtifacts } from './src/ui/capturescreen';
import { ensurePairSchema, linkPair } from './src/pair';
import { runAutoTags } from './src/autotag';
import { AddressInput } from './src/ui/addressinput';
import { ReviewScreen } from './src/ui/reviewscreen';
import { useFonts } from 'expo-font';
import { Barlow_400Regular, Barlow_500Medium, Barlow_600SemiBold, Barlow_700Bold } from '@expo-google-fonts/barlow';
import { BarlowCondensed_600SemiBold, BarlowCondensed_700Bold } from '@expo-google-fonts/barlow-condensed';
import { describeStamp, ensureLocationPermission, stampNow, type Stamp } from './src/stamp';
import { addressFor } from './src/geocode';
import { resolveJurisdiction } from './src/jurisdiction';
import { initFeedback, signalArmed, signalFailed, signalSaved } from './src/feedback';
import { getLang, setLang, t as T, type Lang, type Msg } from './src/i18n';
import { addParty, assignBoundary, drainScopeOutbox, ensurePartySchema, listBoundaries,
         listParties, nameBoundary } from './src/parties';
import { captureStatus, levelColor, screenStatus } from './src/status';
import { FIRST_RUN_TAPS, isFirstRun, markFirstRunDone, nextStep, savedLang, saveLang } from './src/firstrun';
import { hasProfile as hasProfileFn, saveProfile, TRADES } from './src/profile';
import { addNote, drainNoteOutbox, ensureAnnotationSchema, noteCounts, notesFor,
         playCapture, stopPlayback, type Note } from './src/annotate';
import { addTag, drainTagOutbox, ensureTagSchema, projectTags, retractTag,
         tagMap, tagsFor } from './src/tags';
import { listRejected, createProject, ensureProjectSchema, ensureResolutionSchema, fileCapture, inboxCount,
         INBOX_ID, listProjects, resolveProject, touchProject, distanceM,
         type Project } from './src/projects';
import { canRecordAudio, defaultConsentFor, ensureConsentSchema,
         getCellularConsent, getTermsAccepted, setCellularConsent,
         setTermsAccepted } from './src/consent';
import { buildDisputeBundle, buildProgressUpdate, shareBundle, shareLink,
         shareProgressUpdate } from './src/bundle';
import { drainOutbox, outboxStatus } from './src/uploader';
import { decisionHistory, decisionSyncStatus, drainDecisionOutbox, ensureDecisionSchema,
         listDecisions, recordDecision, type DecisionRow } from './src/decisions';
import { sendForConfirmation } from './src/confirmations';
import { applyLocalApproval, centsFromInput, createChangeOrder, drainChangeOrderOutbox,
         ensureChangeOrderSchema, hydrateChangeOrders, ledger, lineTotal, linesSum, makeLine,
         money, parseMoney, validateLines, type LineItem } from './src/changeorder';
import { issueOtp, newOtpCode, renderApproval, signApproval, verifyOtp } from './src/signing';

export const db = new PowerSyncDatabase({
  schema: AppSchema,
  // op-sqlite passed EXPLICITLY. The bare { dbFilename } form does not
  // auto-detect it and falls back to quick-sqlite, which throws at runtime.
  database: new OPSqliteOpenFactory({ dbFilename: 'ezjobsite.db' }),
});

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

export default function App() {
  // The design language (prototype): condensed display for things you RECOGNISE,
  // humanist body for things you READ. Gated below so text never flashes unstyled.
  const [fontsLoaded] = useFonts({
    Barlow_400Regular, Barlow_500Medium, Barlow_600SemiBold, Barlow_700Bold,
    BarlowCondensed_600SemiBold, BarlowCondensed_700Bold,
  });
  const [ui, setUi] = React.useState<UiState>({ k: 'idle' });
  const [showCapture, setShowCapture] = React.useState(false);   // REQ-CAP-FUSED screen
  // REQ-PROC8: the capture whose AI proposal is being reviewed, or null.
  const [review, setReview] = React.useState<string | null>(null);
  // Walkthrough saved to the Inbox and awaiting a job: a change order MUST belong to a
  // job, so this sheet asks — nearby jobs, search, or create one here. Captures are
  // already durable before it opens; dismissing leaves them safe in the Inbox.
  const [assign, setAssign] = React.useState<null | {
    ids: string[]; lat: number | null; lng: number | null;
    uris: string[]; secs: number;
  }>(null);
  const [assignQ, setAssignQ] = React.useState('');
  // The wedge home (prototype c1): extras awaiting a signature, and the money already
  // recovered. Both read from real change_order rows — never invented.
  const [waiting, setWaiting] = React.useState<Array<{
    id: string; scope: string; amount_cents: number; status: string;
    project_id: string; pname: string }>>([]);
  const [recovered, setRecovered] = React.useState<{ cents: number; n: number }>({ cents: 0, n: 0 });
  const [ready, setReady] = React.useState(false);
  const [gate, setGate] = React.useState<string | null>(null);
  const [initError, setInitError] = React.useState<string | null>(null);
  // AUTH. `session` undefined = still checking the stored token; null = logged out;
  // a Session = logged in. A valid stored token lands straight on the main screen.
  const [session, setSession] = React.useState<Session | null | undefined>(undefined);
  // The 4-slide intro is shown once to a logged-out newcomer, then never again.
  const [seenOnboarding, setSeen] = React.useState(false);
  const [delivery, setDelivery] = React.useState<{pending:number;parked:number}>({pending:0,parked:0});
  const [decisions, setDecisions] = React.useState<DecisionRow[]>([]);
  // The ONE confirm surface (REQ-VAL6). Null = not confirming anything.
  const [card, setCard] = React.useState<null | {
    captureId: string; subject: string; value: string; directedBy: string; scope: 'project'|'party';
  }>(null);
  const [history, setHistory] = React.useState<any[] | null>(null);
  const [sentLink, setSentLink] = React.useState<{url:string; shown:string} | null>(null);

  // Where the no-login page is hosted. REQ-VAL3's link is only as good as the
  // page it lands on, so this is configuration, not a constant -- and its absence
  // is surfaced instead of silently producing dead links.
  const CONFIRM_BASE = process.env.EXPO_PUBLIC_CONFIRM_BASE ?? '';
  // MANDATE #6: the read-back. A price is never accepted without a human
  // looking at it. `confidence` decides whether we dare prefill.
  const [priced, setPriced] = React.useState<null | {
    decisionId: string; scope: string; whoDirected: string;
    amountText: string; confidence: 'high'|'low'|'none'; nteText: string;
  }>(null);
  const [coRows, setCoRows] = React.useState<any[]>([]);
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
  const [nav, setNav] = React.useState<'home' | 'project'>('home');
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
  const [langPicked, setLangPicked] = React.useState(false);
  const [frJob, setFrJob] = React.useState('');
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
                  COALESCE(p.name, '') AS pname
             FROM change_order co LEFT JOIN project p ON p.id = co.project_id
            WHERE co.status IN ('draft','sent')
            ORDER BY co.created_at_ms DESC LIMIT 4`));
        const rec = (await db.getAll<{ cents: number; n: number }>(
          `SELECT COALESCE(SUM(amount_cents),0) AS cents, COUNT(*) AS n
             FROM change_order WHERE status = 'approved'`))[0];
        setRecovered(rec ?? { cents: 0, n: 0 });
      } catch { /* CO schema not up yet */ }
      // The Projects-home cards: counts, last activity and a cover photo per job.
      setCards(await projectCards(db, ps));
      // Open where he left off. A contractor who closes the app on the Elm St job
      // and reopens it in the same truck should not have to find it again.
      setProjectId((cur) => (cur === INBOX_ID && ps.length ? ps[0].id : cur));
      setTerms(await getTermsAccepted(db));
      setCellOn(await getCellularConsent(db));
      setDelivery({ pending: (s?.pending ?? 0) + ds.pending, parked: (s?.parked ?? 0) + ds.parked });
      setDecisions(await listDecisions(db, pid));
      setCoRows(await ledger(db, pid));
    } catch { /* pre-init */ }
  }, []);

  // Reload the workspace whenever the selected project changes — opening a job from
  // the Projects home, or the auto-select above, both land the right captures.
  React.useEffect(() => { if (ready) void refresh(); }, [projectId, ready, refresh]);

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
      await ensureAppOwnedSchema(db);
      await ensureDecisionSchema(db);
      await ensureChangeOrderSchema(db);
      for (const s of REJECT_DDL) await db.execute(s);
      await ensureProjectSchema(db, OWNER);
      await ensureResolutionSchema(db);
      await ensureAnnotationSchema(db);
      await ensureTagSchema(db);
      await ensurePartySchema(db);
      await ensureConsentSchema(db);
      await ensurePairSchema(db);
      const sl = await savedLang(db);
      // setLangPicked too: a returning user already chose a language, so the setup
      // flow must not re-show the language screen when it re-enters for a missing profile.
      if (sl) { setLang(sl); setLangState(sl); setLangPicked(true); }
      setFirstRun(await isFirstRun(db));
      setHasProfile(await hasProfileFn(db));
      await initFeedback();

      // THE GATE. If the write connection cannot promise durability we do not
      // arm the recorder at all. Refusing loudly beats saying "saved" and lying.
      const prof = await assertDurabilityProfile(db);
      if (!prof.ok) {
        setGate(prof.writeReport.filter((r: any) => !r.ok).map((r: any) => `${r.name}=${r.got}`).join(', '));
      }

      // Recovery runs before anything else can be recorded.
      const rec = await recoverySweep(db);
      if (rec.integrityErrors.length) {
        console.warn('captures with unreadable media:', rec.integrityErrors);
      }

      // AUTH (replaces the bakeoff hardcoded login). A stored token -> straight to
      // the main screen; no token -> the onboarding/sign-in flow renders. The intro
      // is shown once, so load that flag before deciding what to draw.
      setSeen(await getSeenOnboarding());
      let connected = false;
      const applySession = (s: Session | null) => {
        setSession(s);
        if (s?.user?.id) {
          setOwner(s.user.id);
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
      try {
        const { data: sess } = await connector.client.auth.getSession();
        applySession(sess.session ?? null);
      } catch (e) {
        console.log('session check failed — treating as logged out', e);
        setSession(null);
      }
      // Keep session + sync in step on later sign-in / sign-out. Skip INITIAL_SESSION:
      // getSession above already applied the startup state.
      const { data: authSub } = connector.client.auth.onAuthStateChange((event, s) => {
        if (event === 'INITIAL_SESSION') return;
        applySession(s);
      });
      cleanups.push(() => authSub.subscription.unsubscribe());
      await refresh();
      setReady(true);

      // Drain the outbox. Runs on a timer, not on a network event, because
      // "online" is a lie you find out about by trying. Offline is the normal
      // case: drainOutbox simply fails transiently and backs off.
      const drain = async () => {
        try {
          const { data } = await connector.client.auth.getUser();
          if (!data?.user) return;             // not signed in -> nothing to do
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
          // Pull anything this device does not have: a reinstall, a second phone,
          // or a CO authored before the device became the author.
          // Tie walkthrough photos to the sentences spoken over them, once the
          // transcript (with segments) has landed server-side. Idempotent per pair.
          try { await runAutoTags(db, connector.client); } catch { /* offline is normal */ }
          const hy = await hydrateChangeOrders(db, connector.client, projectId, data.user.id);
          if (hy.pulled || hy.statusUpdated) { console.log('hydrate:', JSON.stringify(hy)); await refresh(); }
          if (r.uploaded || r.alreadyApplied || r.parked ||
              dr.uploaded || dr.alreadyApplied || dr.parked ||
              cr.uploaded || cr.alreadyApplied || cr.parked) await refresh();
        } catch (e: any) { /* offline is normal; backoff already recorded */ }
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
      return;
    }
    if (ui.k === 'recording') {
      setUi({ k: 'saving' });
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
        if (res.confidence !== 'high') setFiled(res.why);
      } else setUi({ k: 'refused', why: r.reason });
      await refresh();
    }
  };

  /**
   * REQ-CAP2 photo/video. Same commit path, same durability gate, new producer --
   * capture.ts did not change to accommodate them.
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
    setShowCapture(false);
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
        ids.push(vr.captureId);
      }
      if (!ids.length) { setUi({ k: 'refused', why: 'nothing to save' }); return; }
      setUi({ k: 'saved', id: ids[0] });
      if (res.projectId === INBOX_ID) {
        // Saved safe — now the ONE question a change order cannot skip: which job?
        setAssign({ ids, lat: a.stamp.lat, lng: a.stamp.lng,
                    uris: a.previewUris, secs: a.durationSecs });
      } else if (res.confidence !== 'high') {
        setFiled(res.why);
      }
    } catch (e: any) {
      setUi({ k: 'refused', why: e?.message ?? String(e) });
    } finally {
      await refresh();
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
      if (r.ok) setUi({ k: 'saved', id: r.captureId });
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
                    {c.modality === 'video' ? '🎥' : c.modality === 'voice' ? '🎙' : '📝'}
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
                {(v.modality === 'voice' || v.modality === 'video') && (
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
                {v.modality === 'video' && (
                  <Text style={s.cardNote}>
                    Video · {(v.bytes / 1024 / 1024).toFixed(1)} MB. Raw video isn’t
                    retained — the audio and stills are the evidence (REQ-TL4).
                  </Text>
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
  if (ready && !initError) {
    if (session === undefined) return <View style={s.c}><Text style={s.h}>EZchangeorder</Text></View>;
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
  if (firstRun === null && ready) return <View style={s.c}><Text style={s.h}>EZchangeorder</Text></View>;

  // Enter setup when it's a first run OR the profile is missing — an existing user
  // (first_run_done already set) with no profile must still be asked who they are.
  if ((firstRun || !hasProfileState) && ready && !gate) {
    const step = nextStep({
      langChosen: !!langPicked,
      hasProfile: hasProfileState,
      hasJob: projects.some((p) => p.id !== INBOX_ID),
    });
    // Small progress spine across the three setup steps (research: progress
    // indicators lower onboarding anxiety). Language is step 0 here.
    const stepIndex = step === 'lang' ? 0 : step === 'profile' ? 1 : 2;
    const Dots = () => (
      <View style={s.frDots}>
        {[0, 1, 2].map((d) => (
          <View key={d} style={[s.frDot, d === stepIndex && s.frDotOn]} />
        ))}
      </View>
    );

    if (step === 'done') {
      // No celebration screen. They came here to record something.
      void markFirstRunDone(db).then(() => setFirstRun(false));
      return <View style={s.c}><Text style={s.h}>EZchangeorder</Text></View>;
    }

    // 1. LANGUAGE, FIRST AND WITHOUT WORDS.
    //    Asking someone to read English to choose Spanish is the joke every app
    //    makes. Both options are shown in their OWN language, side by side, so
    //    this screen needs no reading at all -- you recognise your language or you
    //    do not.
    if (step === 'lang') {
      return (
        <View style={s.c}>
          <Text style={s.h}>EZchangeorder</Text>
          <Dots />
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <Pressable style={s.langBig} onPress={async () => {
              setLang('en'); setLangState('en'); await saveLang(db, 'en'); setLangPicked(true);
            }}>
              <Text style={s.langBigT}>English</Text>
            </Pressable>
            <Pressable style={s.langBig} onPress={async () => {
              setLang('es'); setLangState('es'); await saveLang(db, 'es'); setLangPicked(true);
            }}>
              <Text style={s.langBigT}>Español</Text>
            </Pressable>
          </View>
        </View>
      );
    }

    // 2. WHO YOU ARE — name + solo/company, then trade (skippable). The minimum that
    //    personalises a proposal; NOT a Jobber-style survey (research 2026-07-17).
    //    Two sub-screens inside one step so a skipped trade still advances cleanly.
    if (step === 'profile') {
      if (pSub === 'who') {
        const canGo = pName.trim().length > 0 && pSolo !== null &&
          (pSolo === true || pCompany.trim().length > 0);
        return (
          <View style={s.c}>
            <Text style={s.h}>EZchangeorder</Text>
            <Dots />
            <View style={s.card}>
              <Text style={s.cardH}>{T('fr.whoTitle')}</Text>
              <Text style={s.cardNote}>{T('fr.whoWhy')}</Text>
              <TextInput style={s.moneyInput} value={pName} autoFocus
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

    // 2. THE JOB. Consent belongs to a project, so there must be one first.
    //    A name is enough -- the address can come later, and demanding one from a
    //    man standing in the room is how you get "asdf".
    if (step === 'job') {
      return (
        <View style={s.c}>
          <Text style={s.h}>EZchangeorder</Text>
          <Dots />
          <View style={s.card}>
            <Text style={s.cardH}>{T('fr.jobTitle')}</Text>
            <Text style={s.cardNote}>{T('fr.jobWhy')}</Text>
            <TextInput style={s.moneyInput} value={frJob} autoFocus
              placeholder={T('job.name')} placeholderTextColor="#8c959f"
              onChangeText={setFrJob} />
            <Pressable style={[s.confirmWide, !frJob.trim() && s.btnOff]}
              disabled={!frJob.trim()}
              onPress={async () => {
                const st = await stampNow();
                const r = await createProject(db, { ownerId: OWNER, name: frJob,
                  lat: st.lat, lng: st.lng });
                if (!r.ok) { setUi({ k: 'refused', why: r.reason }); return; }
                setProjectId(r.id);
                setProjects(await listProjects(db));
              }}>
              <Text style={s.confirmT}>{T('job.create')}</Text>
            </Pressable>
          </View>
        </View>
      );
    }

    // CONSENT IS NOT A FIRST-RUN STEP (2026-07-17). It is deferred to the first
    // record tap (canRecordAudio gate) + the dismissible banner below. See
    // firstrun.ts header point 3.
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

  if (newJob) {
    return (
      <View style={s.c}>
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
                      await applyLocalApproval(db, sign.coId, 'approved', sign.legalName);
                      setSign(null); await refresh();
                    } else setSign({ ...sign, err: r.reason });
                  }}>
                  <Text style={s.confirmT}>{T('sig.sign')}</Text>
                </Pressable>
                <Pressable style={s.later} onPress={async () => {
                  await signApproval(connector.client, {
                    changeOrderId: sign.coId, projectId: projectId, shownContent: sign.shown,
                    signerLabel: 'Owner', legalName: sign.legalName || 'declined',
                    phoneE164: sign.phone, otpVerifiedAt: sign.verifiedAt!,
                    action: 'declined', userAgent: 'EZchangeorder iOS',
                  });
                  await applyLocalApproval(db, sign.coId, 'declined', sign.legalName);
                  setSign(null); await refresh();
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
  if (!ready || !fontsLoaded) return <View style={s.c}><Text style={s.h}>EZchangeorder</Text></View>;

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
      />
    );
  }

  // WHICH JOB? — a change order must belong to a job. The captures are ALREADY saved
  // (Inbox) before this renders; this sheet only files them. Options, per the spec:
  // nearby jobs first, search by name/address, or create a new job right here.
  if (assign) {
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
    const fileAll = async (projId: string) => {
      for (const id of assign.ids) {
        await fileCapture(db, { captureId: id, projectId: projId, by: OWNER });
      }
      setAssign(null); setAssignQ(''); setFiled(null);
      setProjectId(projId);
      await refresh();
    };
    const newJobHere = async () => {
      // Seed the job from where the user is standing: reverse-geocoded address when
      // reachable, honest fallback when not. GPS pin comes from the capture's own fix.
      const addr = assign.lat != null && assign.lng != null
        ? await addressFor(assign.lat, assign.lng) : null;
      const r = await createProject(db, {
        ownerId: OWNER, name: addr ?? T('assign.newJobName'),
        address: addr, lat: assign.lat, lng: assign.lng,
      });
      if (!r.ok) { setUi({ k: 'refused', why: r.reason }); return; }
      await fileAll(r.id);
    };
    // SAME dark world as the capture screen — this is step two of the SAME workflow,
    // not a different app. It opens with the receipt of the walk just taken (green
    // check, thumbnails, duration), then asks the one remaining question.
    const mm = `${Math.floor(assign.secs / 60)}:${String(assign.secs % 60).padStart(2, '0')}`;
    return (
      <View style={s.assignC}>
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

  // REQ-CAP-FUSED: the fused photo+voice capture screen overlays everything when open.
  if (showCapture) {
    return (
      <FusedCapture
        projectName={projects.find((p) => p.id === projectId)?.name ?? 'EZchangeorder'}
        onCapture={onFusedCapture}
        onClose={() => setShowCapture(false)}
        resolveLabel={resolveStampLabel}
      />
    );
  }

  // ── PROJECTS HOME ─────────────────────────────────────────────────────────
  // CompanyCam's organising idea: you land on your JOBS, each shown by its most
  // recent photo, and you dive into one to capture. Filing is by GPS underneath,
  // so this list is navigation, not the thing that decides where a capture goes.
  if (nav === 'home') {
    const now = Date.now();
    const q = search.trim().toLowerCase();
    const shown = cards
      .filter((p) => p.id !== INBOX_ID)
      .filter((p) => !q || p.name.toLowerCase().includes(q) ||
                     (p.address ?? '').toLowerCase().includes(q));
    const open = (id: string) => { setProjectId(id); void touchProject(db, id); setNav('project'); };
    return (
      <View style={s.homeC}>
        <View style={s.homeTop}>
          <Text style={s.brand}>EZ<Text style={s.brandAccent}>changeorder</Text></Text>
          <View style={s.topRight}>
            {inbox > 0 && (
              <Pressable onPress={async () => {
                setInboxRows(await listCommittedCaptures(db, INBOX_ID)); setInboxOpen(true);
              }}>
                <Text style={s.chipWait}>{T({ k: 'home.inbox', p: { n: inbox } })}</Text>
              </Pressable>
            )}
            <Pressable onPress={() => {
              const n: Lang = lang === 'en' ? 'es' : 'en'; setLang(n); setLangState(n);
            }}>
              <Text style={s.langPill}>{lang === 'en' ? 'ES' : 'EN'}</Text>
            </Pressable>
          </View>
        </View>

        {/* CAPTURE FIRST — the trigger moment is "I need to get this down before it
            slips", so recording starts before any job is chosen. GPS files it after. */}
        <View style={s.hero}>
          <Text style={s.heroH}>{T('home.gotOne')}</Text>
          <Text style={s.heroSub}>{T('home.sayIt')}</Text>
          <View style={s.capBigBase}>
            <Pressable
              style={[s.capBig, (!!gate || !!initError) && s.btnOff]}
              disabled={!!gate || !!initError}
              onPress={() => { if (!terms) { openTerms(); return; } setShowCapture(true); }}>
              <Text style={s.capBigIcon}>🎙</Text>
              <Text style={s.capBigT}>{T('home.capture')}</Text>
            </Pressable>
          </View>
          <Text style={s.heroHint}>{T('home.filesItself')}</Text>
        </View>

        <View style={s.jobsWrap}>
          {waiting.length > 0 && (
            <>
              <Text style={[s.sectionLab, { marginBottom: 8 }]}>{T('home.waiting')}</Text>
              {waiting.map((w) => (
                <Pressable key={w.id} style={s.waitCard}
                  onPress={() => { setProjectId(w.project_id); setNav('project'); }}>
                  <View style={s.waitRow1}>
                    <Text style={s.waitName} numberOfLines={1}>
                      {w.pname ? w.pname + ' — ' : ''}{w.scope}
                    </Text>
                    <Text style={s.waitAmt}>{money(w.amount_cents)}</Text>
                  </View>
                  <View style={s.waitRow2}>
                    <Text style={s.waitMeta}>
                      {w.status === 'sent' ? T('home.stSent') : T('home.stDraft')}
                    </Text>
                    <View style={[s.waitChip, w.status === 'sent' ? s.waitChipSent : s.waitChipDraft]}>
                      <Text style={[s.waitChipT, w.status === 'sent' && { color: '#0D0F12' }]}>
                        {w.status === 'sent' ? T('home.stSent') : T('home.stDraft')}
                      </Text>
                    </View>
                  </View>
                </Pressable>
              ))}
            </>
          )}
          {recovered.n > 0 && (
            <View style={s.recCard}>
              <View>
                <Text style={s.recLab}>{T('home.recovered')}</Text>
                <Text style={s.recVal}>{money(recovered.cents)}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={s.recLab}>{T('home.approvedN')}</Text>
                <Text style={s.recVal}>{recovered.n}</Text>
              </View>
            </View>
          )}
          <View style={s.jobsHead}>
            <Text style={s.sectionLab}>{T('home.yourJobs')}</Text>
            <Pressable onPress={() => setNewJob({ name: '', address: '' })}>
              <Text style={s.addJob}>＋ {T('home.newProject')}</Text>
            </Pressable>
          </View>
          {cards.length > 4 && (
            <TextInput style={s.searchIn} value={search} onChangeText={setSearch}
              placeholder={T('home.search')} placeholderTextColor="#8c959f" />
          )}
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 28 }}>
            {shown.map((p) => (
              <Pressable key={p.id} style={s.jobItem} onPress={() => open(p.id)}>
                <View style={{ flex: 1 }}>
                  <Text style={s.jobItemName} numberOfLines={1}>{p.name}</Text>
                  <Text style={s.jobItemMeta} numberOfLines={1}>
                    {p.address ?? T('home.noAddress')}
                    {p.lastMs ? ' · ' + ago(p.lastMs, now) : ''}
                  </Text>
                </View>
                <Text style={s.jobCount}>{p.captureCount}</Text>
                <Text style={s.chev}>›</Text>
              </Pressable>
            ))}
            {!shown.length && (
              <Text style={s.homeEmpty}>{q ? T('home.noMatch') : T('home.noProjects')}</Text>
            )}
          </ScrollView>
        </View>
      </View>
    );
  }

  // ── PROJECT DETAIL (camera-first workspace) ───────────────────────────────
  return (
    <View style={s.c}>
      <View style={s.detailHead}>
        <Pressable style={s.backBtn} onPress={() => { setNav('home'); void refresh(); }}>
          <Text style={s.backT}>‹ {T('home.projects')}</Text>
        </Pressable>
        <Pressable onPress={() => { const n: Lang = lang === 'en' ? 'es' : 'en'; setLang(n); setLangState(n); }}>
          <Text style={s.langPill}>{lang === 'en' ? 'ES' : 'EN'}</Text>
        </Pressable>
      </View>

      {/* The project you're in. Tapping it still opens the switcher — the back
          arrow is the primary way home, the title is the quick jump. */}
      <Pressable style={s.jobBar} onPress={() => setPicker(true)}>
        <View style={{ flex: 1 }}>
          <Text style={s.jobBarT} numberOfLines={1}>
            {projects.find((p) => p.id === projectId)?.name ?? T('job.pick')}
          </Text>
          <Text style={s.jobBarAddr} numberOfLines={1}>
            {projects.find((p) => p.id === projectId)?.address ?? T('home.noAddress')}
          </Text>
        </View>
        <Text style={s.jobBarS}>{T('job.change')}</Text>
      </Pressable>

      {/* REQ-MAP1: a static map of the job location, when pinned + configured. */}
      {(() => {
        const proj = projects.find((p) => p.id === projectId);
        const url = proj ? staticMapUrl(proj.lat, proj.lng) : null;
        return url ? (
          <Image source={{ uri: url }} style={s.detailMap} resizeMode="cover" />
        ) : null;
      })()}

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

      {/* REQ-CAP-FUSED: the flagship — snap a photo WHILE narrating, one decision
          moment. Records audio, so it passes the one-time Terms gate like recording. */}
      <Pressable
        onPress={() => { if (!terms) { openTerms(); return; } setShowCapture(true); }}
        disabled={!ready || !!gate || !!initError}
        style={[s.fusedBtn, (!!gate || !!initError || !ready) && s.btnOff]}
      >
        <Text style={s.fusedT}>📸🎙  {T('cap.snapTalk')}</Text>
      </Pressable>

      <Text style={s.state}>
        {ui.k === 'saved' ? T('st.savedNotBacked')
          : ui.k === 'refused' ? T({ k: 'cap.notSaved', p: { why: T(ui.why) } })
          : ui.k === 'saving' ? 'Finishing…'
          : ready ? T('rec.ready') : T('st.starting')}
      </Text>

      {/* REQ-PROC8: the pipeline structures what was said; this is where a human
          checks it. Offered right after a save, when the moment is still in mind. */}
      {ui.k === 'saved' && (
        <Pressable style={s.reviewBtn} onPress={() => setReview(ui.id)}>
          <Text style={s.reviewT}>{T('rev.open')}</Text>
        </Pressable>
      )}

      {/* Consolidated capture: Snap + Talk (above) is the one screen for photo + voice.
          These stay as secondary "other ways" — a clip of video, an existing photo. */}
      <View style={s.mediaRow}>
        <Pressable style={[s.media, gate && s.btnOff]} disabled={!!gate}
          onPress={() => onMedia(recordVideo, 'Camera')}>
          <Text style={s.mediaIcon}>🎥</Text><Text style={s.mediaT}>{T('cap.video')}</Text>
        </Pressable>
        <Pressable style={[s.media, gate && s.btnOff]} disabled={!!gate}
          onPress={() => onMedia(pickFromLibrary, 'Photos')}>
          <Text style={s.mediaIcon}>🖼</Text><Text style={s.mediaT}>{T('cap.pick')}</Text>
        </Pressable>
      </View>

      <Text style={s.sub}>{T('cap.orType')}</Text>
      <View style={s.noteRow}>
        <TextInput
          style={s.input}
          value={note}
          onChangeText={setNote}
          placeholder={T('cap.whatDecided')}
          placeholderTextColor="#8c959f"
          multiline
          editable={!gate && ui.k !== 'saving'}
        />
        <Pressable
          onPress={onSaveNote}
          disabled={!!gate || !note.trim() || ui.k === 'saving'}
          style={[s.save, (!note.trim() || !!gate) && s.btnOff]}
        >
          <Text style={s.saveT}>{T('cap.save')}</Text>
        </Pressable>
      </View>

      {card && (
        <View style={s.card}>
          <Text style={s.cardH}>Is this the decision?</Text>
          <Text style={s.cardV}>{card.value}</Text>
          <View style={s.chips}>
            {/* REQ-VAL4/VAL6: defaulted, tap-to-change, INSIDE the one surface. */}
            <Pressable onPress={() => setCard({ ...card, directedBy: card.directedBy === 'Owner' ? 'GC' : card.directedBy === 'GC' ? 'Architect' : 'Owner' })}>
              <Text style={s.chip}>directed by: {card.directedBy} ✎</Text>
            </Pressable>
            <Pressable onPress={() => setCard({ ...card, scope: card.scope === 'project' ? 'party' : 'project' })}>
              <Text style={s.chip}>{card.scope}-scope ✎</Text>
            </Pressable>
            <Text style={[s.chip, s.chipDim]}>about: {card.subject}</Text>
          </View>
          <View style={s.cardBtns}>
            <Pressable style={s.confirm} onPress={async () => {
              const res = await recordDecision(db, {
                projectId: projectId, ownerId: OWNER, subject: card.subject, value: card.value,
                captureId: card.captureId, directedBy: card.directedBy, scopeLevel: card.scope,
              });
              setCard(null);
              setUi({ k: 'saved', id: card.captureId });
              if (res.superseded) console.log('superseded:', res.superseded, '->', card.value);
              await refresh();
            }}>
              <Text style={s.confirmT}>{T('dec.confirm')}</Text>
            </Pressable>
            <Pressable style={s.later} onPress={() => setCard(null)}>
              <Text style={s.laterT}>{T('dec.notADecision')}</Text>
            </Pressable>
          </View>
          <Text style={s.cardNote}>{T('dec.alreadySaved')}</Text>
        </View>
      )}

      {decisions.length > 0 && (
        <>
          <Text style={s.sub}>Decisions ({decisions.length})</Text>
          {dsync && (
            <Text style={s.dmeta}>
              cloud: {dsync.synced} synced · {dsync.pending} waiting · {dsync.parked} stuck
              {dsync.lastError ? `\n${dsync.lastError}` : ''}
            </Text>
          )}
          {decisions.map((d) => (
            <Pressable key={d.id} style={s.drow} onPress={async () => {
              setHistory(await decisionHistory(db, d.id));
            }}>
              <Text style={s.dsub}>{d.subject}</Text>
              <Text style={s.dval}>{d.current_value}</Text>
              <Text style={s.dmeta}>
                {d.scope_level}-scope · {d.directed_by ?? 'unattributed'}
                {d.version_count > 1 ? ` · changed ${d.version_count - 1}× (tap for history)` : ''}
              </Text>
              <Pressable style={s.ask} onPress={async () => {
                const r = await sendForConfirmation(connector.client, {
                  kind: 'confirm', decisionId: d.id, projectId: projectId,
                  projectName: 'Bakeoff Project', subject: d.subject, value: d.current_value,
                  directedBy: d.directed_by ?? 'Owner', counterparty: d.directed_by ?? 'Owner',
                  channel: 'link', whenMs: d.last_changed_ms,
                  // Was hardcoded to https://ezjobsite.app -- A DOMAIN THAT DOES
                  // NOT EXIST. Every confirmation link ever generated pointed at
                  // nothing. Now env-driven, and CONFIRM_BASE is checked before
                  // anything is sent (below) rather than discovered by a
                  // homeowner tapping a dead link.
                  linkBase: CONFIRM_BASE,
                });
                if (r.ok) setSentLink({ url: r.url, shown: r.shownContent });
                else setUi({ k: 'refused', why: r.reason });
              }}>
                <Text style={s.askT}>Ask {d.directed_by ?? 'them'} to confirm →</Text>
              </Pressable>
              <Pressable style={s.ask} onPress={() => {
                const pm = parseMoney(d.current_value);
                setPriced({
                  decisionId: d.id, scope: d.current_value,
                  whoDirected: d.directed_by ?? 'Owner',
                  // A low-confidence guess is NOT prefilled. Make them type it
                  // rather than nudge them into agreeing with a wrong number.
                  amountText: pm.confidence === 'high' && pm.cents !== null
                    ? (pm.cents / 100).toFixed(2) : '',
                  confidence: pm.confidence, nteText: '',
                });
              }}>
                <Text style={s.askT}>Price it (change order) →</Text>
              </Pressable>
            </Pressable>
          ))}
        </>
      )}

      {priced && (() => {
        const cents = centsFromInput(priced.amountText);
        const nte = centsFromInput(priced.nteText);
        return (
          <View style={s.money}>
            <Text style={s.cardH}>{T('co.check')}</Text>
            <Text style={s.moneyScope}>{priced.scope}</Text>

            {priced.confidence === 'low' && (
              <Text style={s.warn}>{T('co.unsure')}</Text>
            )}
            {priced.confidence === 'none' && (
              <Text style={s.warn}>{T('co.noPriceHeard')}</Text>
            )}

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

            <View style={s.cardBtns}>
              <Pressable
                style={[s.confirm, (cents === null || !!validateLines(lines, cents ?? 0)) && s.btnOff]}
                disabled={cents === null || !!validateLines(lines, cents ?? 0)}
                onPress={async () => {
                  const { data } = await connector.client.auth.getUser();
                  if (!data?.user) { setUi({k:'refused',why:'not signed in'}); return; }
                  const r = await createChangeOrder(db, {
                    id: `co-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`,
                    decisionId: priced.decisionId, projectId: projectId, ownerId: data.user.id,
                    scope: priced.scope, amountCents: cents!, nteCents: nte,
                    whoDirected: priced.whoDirected, lineItems: lines,
                    // The read-back happened HERE. This timestamp is the proof,
                    // and the DB refuses the row without it.
                    numbersConfirmedAt: new Date(),
                  });
                  if (r.ok) { setPriced(null); setLines([]); await refresh(); }
                  else setUi({ k: 'refused', why: r.reason });
                }}>
                <Text style={s.confirmT}>
                  {cents === null ? T('co.enterPrice') : T({ k: 'co.yes', p: { amount: money(cents) } })}
                </Text>
              </Pressable>
              <Pressable style={s.later} onPress={() => { setPriced(null); setLines([]); }}>
                <Text style={s.laterT}>{T('common.cancel')}</Text>
              </Pressable>
            </View>
            <Text style={s.cardNote}>{T('co.nothingSent')}</Text>
          </View>
        );
      })()}

      {coRows.length > 0 && (
        <>
          <Text style={s.sub}>Change orders ({coRows.length})</Text>
        {/* REP-2. Sits ABOVE the evidence export on purpose: telling the client
            what is happening is the weekly act; exporting an evidence bundle is
            the thing you do when that stopped working. Ordering them the other way
            round would put the lawsuit before the conversation. */}
        <Pressable style={s.bundleBtn} onPress={async () => {
          const r = await buildProgressUpdate(connector.client, projectId);
          if (!r.ok) { setBundling(r.reason); return; }
          const s2 = await shareProgressUpdate(r.text);
          if (!s2.ok && s2.reason) setBundling(s2.reason);
        }}>
          <Text style={s.bundleT}>{T('rep.send')}</Text>
        </Pressable>

        <Pressable style={s.bundleBtn} onPress={async () => {
          setBundling('Assembling…');
          const r = await buildDisputeBundle(connector.client, projectId);
          if (!r.ok) { setBundling(`Could not assemble: ${r.reason}`); return; }
          const s2 = await shareBundle(r.htmlPath);
          setBundling(s2.ok
            ? `Bundle ready — ${(r.json.change_orders ?? []).length} change order(s), ` +
              `${(r.json.decisions ?? []).length} decision(s), ${(r.json.captures ?? []).length} capture(s)`
            : s2.reason ?? 'saved');
        }}>
          <Text style={s.bundleT}>Export evidence bundle →</Text>
        </Pressable>
        {bundling && <Text style={s.dmeta}>{bundling}</Text>}
          {coRows.map((c) => (
            <View key={c.id} style={s.drow}>
              <Text style={s.dval}>{c.amount} {c.is_mini ? '· mini' : ''}</Text>
              <Text style={s.dsub}>{c.scope}</Text>
              <Text style={s.dmeta}>
                {c.status}{c.nte ? ` · NTE ${c.nte}` : ''}
                {c.signed_by ? ` · signed ${c.signed_by}` : ''}
                {c.approved_running ? ` · approved to date ${c.approved_running}` : ''}
              </Text>
              {!c.signed_by && (
                <Pressable style={s.ask} onPress={() => setSign({
                  coId: c.id,
                  // FROZEN HERE. Rendered once. If the CO changed after this
                  // point the signature would evidence the wrong thing.
                  shown: renderApproval({
                    scope: c.scope, amount: c.amount, nte: c.nte,
                    whoDirected: 'Owner', projectName: 'Bakeoff Project',
                  }),
                  phone: '', code: '', sent: null, legalName: '',
                  verifiedAt: null, err: null,
                })}>
                  <Text style={s.askT}>Get it signed →</Text>
                </Pressable>
              )}
            </View>
          ))}
        </>
      )}


      {sentLink && (
        <View style={s.card}>
          <Text style={s.cardH}>{T('conf.created')}</Text>
          <Text style={s.frozen}>{sentLink.shown}</Text>
          <Text style={s.cardNote}>
            These exact words are frozen — if the decision changes later, this still
            shows what they were asked. It is the binding record.
          </Text>
          <Text style={s.link}>{sentLink.url}</Text>
          <Text style={s.cardNote}>{T('conf.noLogin')}</Text>

          {/* REQ-VAL8, delivered.
              We do NOT need an email provider. The user is a solo operator with
              2-10 employees who ALREADY texts this client -- their phone has
              iMessage, WhatsApp, email and every channel their client actually
              reads. A link they send themselves arrives from a number the client
              recognises; one we send lands in spam from a stranger. The share
              sheet is not a stopgap here, it is the better answer. */}
          <Pressable style={s.confirmWide} onPress={async () => {
            const r = await shareLink(sentLink.url, sentLink.shown);
            if (!r.ok) setUi({ k: 'refused', why: r.reason ?? 'could not share' });
          }}>
            <Text style={s.confirmT}>{T('conf.send')}</Text>
          </Pressable>

          <Pressable style={s.later} onPress={() => setSentLink(null)}>
            <Text style={s.laterT}>{T('common.close')}</Text>
          </Pressable>
        </View>
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

      <Text style={s.sub}>
        {T({ k: 'st.onThisPhone', p: { n: saved.length } })}
        {delivery.pending > 0 ? T({ k: 'st.waiting', p: { n: delivery.pending } }) : ''}
      </Text>

      {/* REQ-GAL3: filter the grid by tag. "all" clears the filter. */}
      {projTags.length > 0 && (
        <View style={[s.chips, { marginBottom: 8 }]}>
          <Pressable onPress={() => setTagFilter(null)}>
            <Text style={[s.chip, !tagFilter && s.chipOn]}>all</Text>
          </Pressable>
          {projTags.map((tg) => (
            <Pressable key={tg} onPress={() => setTagFilter(tagFilter === tg ? null : tg)}>
              <Text style={[s.chip, tagFilter === tg && s.chipOn]}>{tg}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* CompanyCam's core surface: a reverse-chron GRID of everything captured
          here. Photos and videos show their own frame; voice and text get a
          labelled tile. One tap opens the full evidence viewer (REQ-EVID1). The
          per-item state is a quiet corner dot, not a shouted line — the one
          status banner up top already carries what needs doing (REQ-X3). */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.grid}>
        {/* REQ-GAL1: reverse-chron, DATE-GROUPED. `saved` is newest-first; a
            full-width header emitted at each day boundary forces a flex-wrap break,
            so tiles group cleanly under their day. Tap a tile → the swipe viewer at
            that index. */}
        {(() => {
          let lastDay = '';
          const nodes: React.ReactNode[] = [];
          saved.forEach((c, i) => {
            // REQ-GAL3 filter: skip captures without the active tag. `i` stays the
            // index in `saved` so the viewer pager (which shows all) still aligns.
            if (tagFilter && !(gridTags[c.capture_id] ?? []).includes(tagFilter)) return;
            const day = new Date(c.captured_at_ms).toDateString();
            if (day !== lastDay) {
              lastDay = day;
              nodes.push(
                <Text key={`d-${day}`} style={s.gridDate}>{dayLabel(c.captured_at_ms)}</Text>
              );
            }
            const st = captureStatus({
              inInbox: c.project_id === INBOX_ID, rejected: false,
              pendingUpload: !!c.pending_upload, parked: false,
              hasLocation: c.gps_lat != null,
            });
            nodes.push(
              <Pressable key={c.capture_id} style={s.tile} onPress={() => setViewer({ index: i })}>
                {c.modality === 'photo' ? (
                  <Image source={{ uri: FS.documentDirectory + c.media_relpath }}
                    style={s.tileImg} resizeMode="cover" />
                ) : (
                  <View style={[s.tileImg, s.tileIcon]}>
                    <Text style={s.tileIconT}>
                      {c.modality === 'video' ? '🎥' : c.modality === 'voice' ? '🎙' : '📝'}
                    </Text>
                  </View>
                )}
                {/* corner dot = still on this phone / not yet backed up. */}
                {(!!c.pending_upload || c.gps_lat == null) && (
                  <View style={s.tileDot}>
                    <View style={[s.tileDotInner, { backgroundColor: levelColor(st.level).text }]} />
                  </View>
                )}
                {nCounts[c.capture_id] ? (
                  <Text style={s.tileNotes}>💬 {nCounts[c.capture_id]}</Text>
                ) : null}
                <Text style={s.tileMeta} numberOfLines={1}>
                  {c.modality}{c.gps_lat == null ? ' · 📍?' : ''}
                </Text>
              </Pressable>
            );
          });
          return nodes;
        })()}
        {!saved.length && (
          <Text style={s.homeEmpty}>{T('detail.noCaptures')}</Text>
        )}
      </ScrollView>
    </View>
  );
}

// Light theme. Palette (GitHub-light / CompanyCam-ish): page #f6f8fa, surfaces
// #ffffff, borders #d0d7de, text #1f2328 / #57606a / #8c959f, brand green #1f883d,
// blue #0969da, amber #9a6700, red #cf222e. Overlays that sit ON photos keep a dark
// translucent backing so their text reads over any image.
const s = StyleSheet.create({
  c: { flex: 1, paddingTop: 72, paddingHorizontal: 20, backgroundColor: '#FAFAF8' },
  h: { color: '#0D0F12', fontFamily: 'BarlowCondensed_700Bold', fontSize: 30, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 18 },
  btn: { backgroundColor: '#0D0F12', paddingVertical: 28, borderRadius: 18, alignItems: 'center' },
  btnRec: { backgroundColor: '#C6281C' },
  fusedBtn: { backgroundColor: '#FF5A00', paddingVertical: 24, borderRadius: 18,
    alignItems: 'center', marginBottom: 12 },
  fusedT: { color: '#fff', fontFamily: 'BarlowCondensed_700Bold', fontSize: 23, textTransform: 'uppercase', letterSpacing: 1.2 },
  // REQ-PROC8 entry — the accent, because reviewing the proposal is the next real move.
  reviewBtn: { alignSelf: 'center', backgroundColor: '#FFF1E8', borderColor: '#FF5A00',
    borderWidth: 1.5, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 22, marginTop: 10 },
  reviewT: { color: '#FF5A00', fontFamily: 'BarlowCondensed_700Bold', fontSize: 18, textTransform: 'uppercase', letterSpacing: 1 },
  btnOff: { backgroundColor: '#c4cdd5' },
  mediaRow: { flexDirection: 'row', gap: 10, marginBottom: 18 },
  media: { flex: 1, backgroundColor: '#ffffff', borderRadius: 12, paddingVertical: 16,
    alignItems: 'center', borderWidth: 1, borderColor: '#E4E5E1' },
  mediaIcon: { fontSize: 26, marginBottom: 4 },
  mediaT: { color: '#0D0F12', fontFamily: 'BarlowCondensed_600SemiBold', fontSize: 13, textTransform: 'uppercase', letterSpacing: 1.2 },
  stamp: { color: '#8c959f', fontSize: 10 },
  btnT: { color: '#fff', fontFamily: 'BarlowCondensed_700Bold', fontSize: 25, textTransform: 'uppercase', letterSpacing: 1.2 },
  state: { color: '#5C6570', fontFamily: 'Barlow_400Regular', fontSize: 15, marginTop: 14, marginBottom: 22, textAlign: 'center' },
  sub: { color: '#5C6570', fontFamily: 'BarlowCondensed_600SemiBold', fontSize: 12.5, textTransform: 'uppercase', letterSpacing: 1.6, marginBottom: 8 },
  row: { borderTopWidth: 1, borderTopColor: '#E4E5E1', paddingVertical: 10 },
  rowT: { color: '#57606a', fontSize: 13, fontFamily: 'Menlo' },
  rowS: { color: '#8c959f', fontSize: 11, fontFamily: 'Menlo', marginTop: 2 },
  card: { backgroundColor: '#dafbe1', borderColor: '#2da44e', borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 16 },
  cardH: { color: '#5C6570', fontFamily: 'BarlowCondensed_600SemiBold', fontSize: 12.5, textTransform: 'uppercase', letterSpacing: 1.6, marginBottom: 8 },
  cardV: { color: '#0D0F12', fontSize: 17, lineHeight: 23, marginBottom: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  chip: { color: '#0E8A4C', backgroundColor: '#dafbe1', borderColor: '#2da44e', borderWidth: 1,
          borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, fontSize: 12, overflow: 'hidden' },
  chipDim: { color: '#8c959f', borderColor: '#E4E5E1', backgroundColor: 'transparent' },
  chipOn: { color: '#fff', backgroundColor: '#0D0F12', borderColor: '#0D0F12' },
  cardBtns: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  confirm: { flex: 1, backgroundColor: '#0D0F12', borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  // Standalone (not inside s.cardBtns): must NOT use flex:1 -- see above.
  confirmWide: { alignSelf: 'stretch', backgroundColor: '#0D0F12', borderRadius: 10,
    paddingVertical: 16, alignItems: 'center', marginBottom: 10 },
  confirmT: { color: '#fff', fontFamily: 'BarlowCondensed_700Bold', fontSize: 18, textTransform: 'uppercase', letterSpacing: 1.2 },
  later: { paddingHorizontal: 12, paddingVertical: 14 },
  laterT: { color: '#57606a', fontSize: 13 },
  cardNote: { color: '#5C6570', fontFamily: 'Barlow_400Regular', fontSize: 13, lineHeight: 19, marginTop: 8 },
  drow: { borderTopWidth: 1, borderTopColor: '#E4E5E1', paddingVertical: 10 },
  dsub: { color: '#57606a', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 },
  dval: { color: '#0D0F12', fontSize: 15, marginTop: 2 },
  dmeta: { color: '#5C6570', fontFamily: 'Barlow_400Regular', fontSize: 12.5, marginTop: 3 },
  hNow: { color: '#0E8A4C', fontSize: 14, marginBottom: 4 },
  hOld: { color: '#8c959f', fontSize: 13, marginBottom: 4, textDecorationLine: 'line-through' },
  money: { backgroundColor: '#fff8c5', borderColor: '#F5B000', borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 16 },
  moneyScope: { color: '#57606a', fontSize: 14, marginBottom: 10 },
  bigMoney: { color: '#9a6700', fontSize: 44, fontWeight: '800', textAlign: 'center', marginVertical: 6 },
  viewImg: { width: '100%', height: 260, borderRadius: 8, backgroundColor: '#E4E5E1',
    marginBottom: 10 },
  evid: { color: '#0D0F12', fontSize: 15, marginBottom: 10 },
  hash: { color: '#57606a', fontSize: 11, fontFamily: 'Menlo', marginBottom: 8 },
  capNote: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#E4E5E1' },
  capNoteBody: { color: '#0D0F12', fontSize: 14 },
  capNoteMeta: { color: '#8c959f', fontSize: 11, marginTop: 2 },
  inboxItem: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#E4E5E1' },
  inboxWhat: { color: '#57606a', fontSize: 12, marginBottom: 6 },
  inboxJobs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  inboxJob: { backgroundColor: '#ffffff', borderRadius: 8, paddingHorizontal: 12,
    paddingVertical: 10, borderWidth: 1, borderColor: '#E4E5E1' },
  inboxJobT: { color: '#0D0F12', fontSize: 13, fontWeight: '600' },
  langT: { color: '#8c959f', fontSize: 13, fontWeight: '400' },
  scopeLink: { paddingVertical: 8, marginBottom: 6 },
  scopeLinkT: { color: '#9a6700', fontSize: 13, fontWeight: '600' },
  bndRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#E4E5E1' },
  bndSubject: { color: '#0D0F12', fontSize: 15 },
  bndOwner: { color: '#0E8A4C', fontSize: 12, marginTop: 2 },
  bndGap: { color: '#9a6700', fontSize: 12, marginTop: 2, fontWeight: '700' },
  bndJobs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  p5: { backgroundColor: '#ffffff', borderColor: '#E4E5E1', borderWidth: 1,
    borderRadius: 10, padding: 12, marginBottom: 12 },
  p5T: { color: '#0D0F12', fontWeight: '700', fontSize: 15, marginBottom: 2 },
  p5S: { color: '#57606a', fontSize: 12, marginBottom: 10 },
  oneStatus: { borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 12 },
  oneStatusT: { fontWeight: '700', fontSize: 14 },
  oneStatusD: { color: '#57606a', fontSize: 11, marginTop: 3 },
  // Thumb-sized. This is the first thing a new user ever touches, and they may be
  // wearing gloves when they do it.
  langBig: { backgroundColor: '#ffffff', borderColor: '#E4E5E1', borderWidth: 1,
    borderRadius: 14, paddingVertical: 28, alignItems: 'center', marginBottom: 16 },
  langBigT: { color: '#0D0F12', fontFamily: 'Barlow_700Bold', fontSize: 26 },
  // first-run progress dots
  frDots: { flexDirection: 'row', justifyContent: 'center', marginBottom: 8, marginTop: 2 },
  frDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#E4E5E1', marginHorizontal: 4 },
  frDotOn: { backgroundColor: '#0D0F12', width: 20 },
  // profile pick buttons (solo/company) — big touch targets (research: 48dp+, gloves)
  pickWide: { alignSelf: 'stretch', backgroundColor: '#ffffff', borderColor: '#E4E5E1',
    borderWidth: 1, borderRadius: 12, paddingVertical: 18, alignItems: 'center', marginBottom: 10 },
  pickOn: { borderColor: '#0D0F12', backgroundColor: '#eafaf0', borderWidth: 2 },
  pickT: { color: '#0D0F12', fontSize: 18, fontWeight: '700' },
  pickTOn: { color: '#0E8A4C' },
  // trade grid — 2-up big cells
  tradeGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 6 },
  tradeCell: { width: '48%', backgroundColor: '#ffffff', borderColor: '#E4E5E1', borderWidth: 1,
    borderRadius: 12, paddingVertical: 20, alignItems: 'center', marginBottom: 10 },
  tradeCellT: { color: '#0D0F12', fontSize: 16, fontWeight: '700' },
  jobBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#ffffff', borderColor: '#E4E5E1', borderWidth: 1,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12 },
  jobBarT: { color: '#0D0F12', fontWeight: '700', fontSize: 15, flex: 1 },
  jobBarS: { color: '#8c959f', fontSize: 11 },
  jobRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#E4E5E1' },
  jobName: { color: '#0D0F12', fontSize: 16 },
  jobNameOn: { color: '#0E8A4C', fontSize: 16, fontWeight: '700' },
  jobMeta: { color: '#8c959f', fontSize: 12, marginTop: 2 },
  consentBanner: { backgroundColor: '#fff8c5', borderColor: '#F5B000', borderWidth: 1,
    borderRadius: 10, padding: 12, marginBottom: 14 },
  consentT: { color: '#9a6700', fontWeight: '700', fontSize: 14, marginBottom: 3 },
  consentS: { color: '#7d5e00', fontSize: 12, lineHeight: 17 },
  bundleBtn: { paddingVertical: 8 },
  bundleT: { color: '#FF5A00', fontSize: 14, fontWeight: '600' },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6,
    borderBottomWidth: 1, borderBottomColor: '#E4E5E1' },
  lineDesc: { color: '#0D0F12', fontSize: 14, flex: 1 },
  lineMath: { color: '#57606a', fontSize: 12 },
  lineX: { color: '#8c959f', fontSize: 16, paddingHorizontal: 6 },
  lineAdd: { flexDirection: 'row', gap: 6, marginTop: 10, marginBottom: 4 },
  lineIn: { flex: 1, backgroundColor: '#ffffff', borderColor: '#E4E5E1', borderWidth: 1,
    borderRadius: 8, color: '#0D0F12', paddingHorizontal: 8, paddingVertical: 10, fontSize: 13 },
  linePlus: { backgroundColor: '#E4E5E1', borderRadius: 8, paddingHorizontal: 14,
    justifyContent: 'center' },
  linePlusT: { color: '#0D0F12', fontSize: 20, fontWeight: '800' },
  moneyInput: { backgroundColor: '#ffffff', borderColor: '#E4E5E1', borderWidth: 1, borderRadius: 8,
                color: '#0D0F12', padding: 12, fontSize: 18, marginBottom: 10, textAlign: 'center' },
  ok: { color: '#0E8A4C', fontSize: 14, marginBottom: 8 },
  warn: { color: '#9a6700', fontSize: 12, marginBottom: 6 },
  ask: { marginTop: 8 },
  askT: { color: '#FF5A00', fontSize: 13, fontWeight: '600' },
  frozen: { color: '#0D0F12', fontSize: 14, lineHeight: 20, backgroundColor: '#ffffff',
            borderColor: '#E4E5E1', borderWidth: 1, borderRadius: 8, padding: 10, marginBottom: 8 },
  link: { color: '#FF5A00', fontFamily: 'Menlo', fontSize: 11, marginVertical: 6 },
  noteRow: { flexDirection: 'row', gap: 8, marginBottom: 22 },
  input: { flex: 1, backgroundColor: '#ffffff', borderColor: '#E4E5E1', borderWidth: 1,
           borderRadius: 10, color: '#0D0F12', padding: 12, minHeight: 54, fontSize: 15 },
  save: { backgroundColor: '#FF5A00', borderRadius: 10, paddingHorizontal: 18, justifyContent: 'center' },
  saveT: { color: '#fff', fontWeight: '800', letterSpacing: 1 },
  gate: { backgroundColor: '#ffebe9', borderColor: '#C6281C', borderWidth: 1, borderRadius: 10, padding: 14, marginBottom: 18 },
  gateT: { color: '#C6281C', fontWeight: '700', marginBottom: 6 },
  gateS: { color: '#57606a', fontSize: 13, lineHeight: 18 },
  mono: { color: '#57606a', fontFamily: 'Menlo', fontSize: 10, marginTop: 8 },

  // ── Projects home ──────────────────────────────────────────────────────
  homeHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  langPill: { color: '#57606a', fontSize: 12, fontWeight: '700', borderWidth: 1,
    borderColor: '#E4E5E1', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  searchIn: { backgroundColor: '#ffffff', borderColor: '#E4E5E1', borderWidth: 1,
    borderRadius: 10, color: '#0D0F12', paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, marginBottom: 12 },
  newProjBtn: { backgroundColor: '#0D0F12', borderRadius: 12, paddingVertical: 16,
    alignItems: 'center', marginBottom: 14 },
  newProjT: { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: 0.5 },
  inboxCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff8c5',
    borderColor: '#F5B000', borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 14 },
  inboxCardIcon: { fontSize: 22 },
  inboxCardT: { color: '#9a6700', fontWeight: '700', fontSize: 15 },
  inboxCardS: { color: '#7d5e00', fontSize: 12, marginTop: 2 },
  chev: { color: '#9a6700', fontSize: 26, fontWeight: '300' },
  projCard: { backgroundColor: '#ffffff', borderColor: '#E4E5E1', borderWidth: 1,
    borderRadius: 14, overflow: 'hidden', marginBottom: 14 },
  projCover: { width: '100%', height: 150, backgroundColor: '#E4E5E1' },
  projCoverEmpty: { alignItems: 'center', justifyContent: 'center' },
  projCoverEmptyT: { color: '#afb8c1', fontSize: 64, fontWeight: '800' },
  projBody: { padding: 14 },
  projName: { color: '#0D0F12', fontSize: 18, fontWeight: '700' },
  projMeta: { color: '#57606a', fontSize: 13, marginTop: 3 },
  projStats: { color: '#8c959f', fontSize: 12, marginTop: 8 },
  homeEmpty: { color: '#8c959f', fontSize: 14, textAlign: 'center', marginTop: 40, width: '100%' },

  // ── Project detail ─────────────────────────────────────────────────────
  detailHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 12 },
  backBtn: { paddingVertical: 4, paddingRight: 12 },
  backT: { color: '#FF5A00', fontSize: 16, fontWeight: '600' },
  jobBarAddr: { color: '#8c959f', fontSize: 12, marginTop: 2 },
  detailMap: { width: '100%', height: 120, borderRadius: 10, marginBottom: 12, backgroundColor: '#E4E5E1' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingBottom: 40 },
  gridDate: { width: '100%', color: '#57606a', fontSize: 12, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 1, marginTop: 12, marginBottom: 2 },
  tile: { width: '31.8%', aspectRatio: 1, backgroundColor: '#ffffff', borderRadius: 10,
    overflow: 'hidden', borderWidth: 1, borderColor: '#E4E5E1' },
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
  homeC: { flex: 1, backgroundColor: '#FAFAF8', paddingTop: 54 },
  homeTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingBottom: 6 },
  brand: { fontFamily: 'BarlowCondensed_700Bold', fontSize: 22, color: '#0D0F12',
    textTransform: 'uppercase', letterSpacing: 0.6 },
  brandAccent: { color: '#FF5A00' },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chipWait: { fontFamily: 'BarlowCondensed_600SemiBold', fontSize: 12.5, color: '#0D0F12',
    backgroundColor: '#F5B000', textTransform: 'uppercase', letterSpacing: 1.2,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4, overflow: 'hidden' },
  hero: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 26, paddingVertical: 16 },
  heroH: { fontFamily: 'BarlowCondensed_700Bold', fontSize: 34, color: '#0D0F12',
    textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'center' },
  heroSub: { fontFamily: 'Barlow_400Regular', fontSize: 15, color: '#5C6570',
    marginTop: 6, marginBottom: 20, textAlign: 'center' },
  capBig: { width: 140, height: 140, borderRadius: 70, backgroundColor: '#FF5A00',
    alignItems: 'center', justifyContent: 'center', shadowColor: '#FF5A00', shadowOpacity: 0.35,
    shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
  capBigIcon: { fontSize: 40, marginBottom: 2 },
  capBigT: { fontFamily: 'BarlowCondensed_700Bold', fontSize: 18, color: '#fff',
    textTransform: 'uppercase', letterSpacing: 1.6 },
  heroHint: { fontFamily: 'Barlow_400Regular', fontSize: 13, color: '#5C6570',
    marginTop: 12, textAlign: 'center' },
  capBigBase: { borderRadius: 74, backgroundColor: '#E04E00', paddingBottom: 7 },
  waitCard: { backgroundColor: '#fff', borderColor: '#E4E5E1', borderWidth: 1, borderRadius: 14,
    padding: 13, marginBottom: 8 },
  waitRow1: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  waitName: { flex: 1, fontFamily: 'Barlow_700Bold', fontSize: 15.5, color: '#0D0F12' },
  waitAmt: { fontFamily: 'BarlowCondensed_700Bold', fontSize: 19, color: '#0D0F12' },
  waitRow2: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  waitMeta: { fontFamily: 'Barlow_400Regular', fontSize: 12.5, color: '#5C6570' },
  waitChip: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 4 },
  waitChipSent: { backgroundColor: '#F5B000' },
  waitChipDraft: { backgroundColor: '#0D0F12' },
  waitChipT: { fontFamily: 'BarlowCondensed_600SemiBold', fontSize: 12, color: '#fff',
    textTransform: 'uppercase', letterSpacing: 1 },
  recCard: { backgroundColor: '#0D0F12', borderRadius: 16, padding: 15, marginBottom: 12,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  recLab: { fontFamily: 'BarlowCondensed_600SemiBold', fontSize: 12, color: '#9BA2AB',
    textTransform: 'uppercase', letterSpacing: 1.4 },
  recVal: { fontFamily: 'BarlowCondensed_700Bold', fontSize: 28, color: '#fff', marginTop: 2 },
  jobsWrap: { flex: 1, paddingHorizontal: 18, paddingTop: 4 },
  jobsHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 8 },
  sectionLab: { fontFamily: 'BarlowCondensed_600SemiBold', fontSize: 13, color: '#5C6570',
    textTransform: 'uppercase', letterSpacing: 1.8 },
  addJob: { fontFamily: 'BarlowCondensed_600SemiBold', fontSize: 14, color: '#FF5A00',
    textTransform: 'uppercase', letterSpacing: 1 },
  assignC: { flex: 1, backgroundColor: '#0D0F12', paddingTop: 54 },
  assignReceipt: { marginHorizontal: 18, backgroundColor: '#15271C', borderColor: '#1E5236',
    borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 16 },
  assignSaved: { color: '#3fb950', fontFamily: 'BarlowCondensed_700Bold', fontSize: 19,
    textTransform: 'uppercase', letterSpacing: 1 },
  assignThumb: { width: 44, height: 44, borderRadius: 8, borderWidth: 1, borderColor: '#2A2E35' },
  assignMeta: { color: '#AEB4BD', fontFamily: 'BarlowCondensed_600SemiBold', fontSize: 16,
    marginLeft: 12, letterSpacing: 1 },
  assignH: { color: '#fff', fontFamily: 'BarlowCondensed_700Bold', fontSize: 28,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 },
  assignSearch: { backgroundColor: '#1B1E24', borderColor: '#2A2E35', borderWidth: 1,
    borderRadius: 12, paddingHorizontal: 14, minHeight: 52, fontSize: 16, color: '#fff',
    fontFamily: 'Barlow_400Regular', marginBottom: 10 },
  assignRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1B1E24',
    borderColor: '#2A2E35', borderWidth: 1, borderRadius: 14, paddingHorizontal: 14,
    paddingVertical: 15, marginBottom: 8 },
  assignRowName: { color: '#fff', fontFamily: 'Barlow_600SemiBold', fontSize: 16.5 },
  assignRowMeta: { color: '#8A9099', fontFamily: 'Barlow_400Regular', fontSize: 13.5, marginTop: 2 },
  assignChev: { color: '#5C6570', fontSize: 22, marginLeft: 8 },
  assignNew: { backgroundColor: '#FF5A00', borderRadius: 14, minHeight: 56, alignItems: 'center',
    justifyContent: 'center', marginBottom: 12 },
  assignNewT: { color: '#fff', fontFamily: 'BarlowCondensed_700Bold', fontSize: 18,
    textTransform: 'uppercase', letterSpacing: 1 },
  jobItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderColor: '#E4E5E1', borderWidth: 1, borderRadius: 14, paddingHorizontal: 14,
    paddingVertical: 14, marginBottom: 8 },
  jobItemName: { fontFamily: 'Barlow_600SemiBold', fontSize: 16.5, color: '#0D0F12' },
  jobItemMeta: { fontFamily: 'Barlow_400Regular', fontSize: 13, color: '#5C6570', marginTop: 2 },
  jobCount: { fontFamily: 'BarlowCondensed_700Bold', fontSize: 19, color: '#0D0F12', marginRight: 8 },
});
