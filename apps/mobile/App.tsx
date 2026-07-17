import '@azure/core-asynciterator-polyfill';
import 'react-native-get-random-values';

import { OPSqliteOpenFactory } from '@powersync/op-sqlite';
import { PowerSyncDatabase } from '@powersync/react-native';
import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppSchema } from './src/AppSchema';
import { REJECT_DDL, SupabaseConnector } from './src/connector';
import { readCapture,
  applyDurabilityProfile,
  assertDurabilityProfile,
  ensureAppOwnedSchema,
  listCommittedCaptures,
  performCapture,
  recoverySweep,
} from './src/capture';
import { RecordingPresets, readRecordingBytes, requestMic, useAudioRecorder } from './src/recorder';
import { pickFromLibrary, recordVideo, snapPhoto, textCapture, voiceCapture } from './src/modality';
import { describeStamp, ensureLocationPermission, stampNow } from './src/stamp';
import { initFeedback, signalArmed, signalFailed, signalSaved } from './src/feedback';
import { getLang, setLang, t as T, type Lang, type Msg } from './src/i18n';
import { captureStatus, levelColor, screenStatus } from './src/status';
import { FIRST_RUN_TAPS, isFirstRun, markFirstRunDone, nextStep, savedLang, saveLang } from './src/firstrun';
import { addNote, drainNoteOutbox, ensureAnnotationSchema, noteCounts, notesFor,
         playCapture, stopPlayback, type Note } from './src/annotate';
import { listRejected, createProject, ensureProjectSchema, ensureResolutionSchema, fileCapture, inboxCount,
         INBOX_ID, listProjects, resolveProject, touchProject,
         type Project } from './src/projects';
import { canRecordAudio, consentBasisText, defaultConsentFor, ensureConsentSchema,
         getCellularConsent, getRecordingConsent, setCellularConsent, setRecordingConsent,
         type RecordingConsent } from './src/consent';
import { buildDisputeBundle, shareBundle, shareLink } from './src/bundle';
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
  const [ui, setUi] = React.useState<UiState>({ k: 'idle' });
  const [ready, setReady] = React.useState(false);
  const [gate, setGate] = React.useState<string | null>(null);
  const [initError, setInitError] = React.useState<string | null>(null);
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
  // REQ-CON1. Read once and kept in state: the record button must know the answer
  // BEFORE it is tapped, because the one thing it may never do is ask.
  const [consent, setConsent] = React.useState<{ consent: RecordingConsent; basis: string | null }>(
    { consent: null, basis: null });
  const [cellOn, setCellOn] = React.useState(false);
  const [setup, setSetup] = React.useState<null | { jurisdiction: string }>(null);

  // REQ-SET1/EVID2. Null until the first job exists -- a new user has no jobs, and
  // pretending otherwise is what the hardcoded constant was doing.
  const [projectId, setProjectId] = React.useState<string>(INBOX_ID);
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [picker, setPicker] = React.useState(false);
  const [filed, setFiled] = React.useState<Msg | string | null>(null);
  const [inbox, setInbox] = React.useState(0);
  const [inboxOpen, setInboxOpen] = React.useState(false);
  const [inboxRows, setInboxRows] = React.useState<any[]>([]);
  // REQ-EVID1 + REQ-CAP3.
  const [viewing, setViewing] = React.useState<any>(null);
  const [vnotes, setVnotes] = React.useState<Note[]>([]);
  const [noteDraft, setNoteDraft] = React.useState('');
  const [playing, setPlaying] = React.useState(false);
  const [playErr, setPlayErr] = React.useState<string | null>(null);
  const [nCounts, setNCounts] = React.useState<Record<string, number>>({});
  const [rejected, setRejected] = React.useState<any[]>([]);
  const [showDetail, setShowDetail] = React.useState(false);

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
  // Resolved from the session at startup. Nothing that syncs may be written with a
  // placeholder: the server's types are the contract, and a string that cannot be
  // a UUID is not a user.
  const [OWNER, setOwner] = React.useState<string>(OWNER_FALLBACK);
  const [newJob, setNewJob] = React.useState<null | { name: string; address: string }>(null);

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

  const refresh = React.useCallback(async () => {
    try {
      // REQ-EVID2: this job's captures, not every capture on the phone.
      setSaved(await listCommittedCaptures(db, projectId));
      setInbox(await inboxCount(db));
      setNCounts(await noteCounts(db));
      setRejected(await listRejected(db));
      const s = (await outboxStatus(db))[0];
      // Captures and decisions ride independent queues, so "not backed up yet"
      // must count both. One green tick that ignores half the queue is a lie.
      const ds = await decisionSyncStatus(db);
      setDsync(ds);
      const ps = await listProjects(db);
      setProjects(ps);
      // Open where he left off. A contractor who closes the app on the Elm St job
      // and reopens it in the same truck should not have to find it again.
      setProjectId((cur) => (cur === INBOX_ID && ps.length ? ps[0].id : cur));
      setConsent(await getRecordingConsent(db, projectId));
      setCellOn(await getCellularConsent(db));
      setDelivery({ pending: (s?.pending ?? 0) + ds.pending, parked: (s?.parked ?? 0) + ds.parked });
      setDecisions(await listDecisions(db, projectId));
      setCoRows(await ledger(db, projectId));
    } catch { /* pre-init */ }
  }, []);

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
      await ensureConsentSchema(db);
      const sl = await savedLang(db);
      if (sl) { setLang(sl); setLangState(sl); }
      setFirstRun(await isFirstRun(db));
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

      try {
        await connector.login('device1@example.com', 'bakeoff-spike-pw-2026');
        const { data: u } = await connector.client.auth.getUser();
        if (u?.user?.id) setOwner(u.user.id);
        // connect() is fire-and-forget by design, so its rejection lands nowhere
        // and surfaces as an unhandled "TypeError: Network request failed". Being
        // offline is the NORMAL case for this product, not an error -- a red
        // banner on a jobsite with no signal is the tool blaming the user for the
        // conditions it was built for. PowerSync retries internally; we note it
        // and carry on.
        db.connect(connector).catch((e) =>
          console.log('sync will connect when there is signal', e?.message ?? e));
      } catch (e) {
        // Offline is normal and is NOT an error. Capture must work regardless.
        console.log('not signed in / offline — capture still works', e);
      }
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
          if (nr.attempted) console.log('drain notes:', JSON.stringify(nr));
          const cr = await drainChangeOrderOutbox(db, connector.client, data.user.id);
          if (cr.attempted) console.log('drain change orders:', JSON.stringify(cr));
          // Pull anything this device does not have: a reinstall, a second phone,
          // or a CO authored before the device became the author.
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
      // REQ-CON1: the answer is ALREADY KNOWN -- decided once at job setup. This is
      // a LOOKUP, never a prompt. A consent dialog between a man's thumb and the
      // thing he is trying to record is the #1 predicted abandonment point, and it
      // is the one thing this path may never do. Checked BEFORE the mic opens: we
      // must never record first and ask later, because by then the recording
      // exists.
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
    return r;
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
  if (viewing) {
    const v = viewing;
    return (
      <ScrollView style={{ flex: 1, backgroundColor: '#0d1117' }} contentContainerStyle={s.c}>
        <Text style={s.h}>EZjobsite</Text>
        <View style={s.card}>
          <Text style={s.cardH}>{v.modality} capture</Text>

          {!v.ok ? (
            // The row says it exists and the file does not. Loud, never swallowed:
            // this is the loss mandate #1 forbids, and the user must know BEFORE
            // they rely on it in a dispute.
            <Text style={s.warn}>{v.reason}</Text>
          ) : (
            <>
              {v.modality === 'photo' && (
                <Image source={{ uri: v.uri }} style={s.viewImg} resizeMode="contain" />
              )}
              {v.text !== undefined && <Text style={s.frozen}>{v.text}</Text>}
              {/* REQ-EVID1 for the PRIMARY modality. A viewer that shows a byte
                  count for a voice note cannot show the evidence — an inspector
                  asking "what did he say?" got a hash. Plays from disk, so it
                  works in the basement where the question gets asked. */}
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
                  <Text style={s.cardNote}>
                    {T({ k: 'ev.audioMeta', p: { kb: (v.bytes / 1024).toFixed(1) } })}
                  </Text>
                  {playErr && (
                    <Text style={s.warn}>{T({ k: 'ev.playFailed', p: { why: playErr } })}</Text>
                  )}
                </>
              )}
              {v.modality === 'video' && (
                <Text style={s.cardNote}>
                  Video · {(v.bytes / 1024 / 1024).toFixed(1)} MB. Playback isn’t built yet.
                </Text>
              )}

              {/* The stamp, plainly. This is what makes it evidence rather than a file. */}
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
            placeholder={T('ev.addNote')} placeholderTextColor="#6e7681"
            onChangeText={setNoteDraft} />
          <Pressable style={[s.confirmWide, !noteDraft.trim() && s.btnOff]}
            disabled={!noteDraft.trim()}
            onPress={async () => {
              const r = await addNote(db, { captureId: v.captureId, body: noteDraft, author: 'Owner' });
              if (!r.ok) { setUi({ k: 'refused', why: r.reason }); return; }
              setNoteDraft('');
              setVnotes(await notesFor(db, v.captureId));
              setNCounts(await noteCounts(db));
            }}>
            <Text style={s.confirmT}>{T('ev.addNoteBtn')}</Text>
          </Pressable>
          <Text style={s.cardNote}>
            Notes are added, never replaced — an earlier note is never overwritten by
            a later one. The note is what someone said ABOUT this; it isn’t part of
            what was recorded.
          </Text>

          <Pressable style={s.later} onPress={() => { stopPlayback(); setPlaying(false); setViewing(null); }}>
            <Text style={s.laterT}>{T('common.close')}</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  if (inboxOpen) {
    return (
      <View style={s.c}>
        <Text style={s.h}>EZjobsite</Text>
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

  // REQ-SET2. Shown before anything else, and only once.
  // Nothing until we know. A null firstRun rendered the MAIN screen for a frame
  // and then swapped it for the language picker -- a flash of the wrong app, shown
  // to the one user who has never seen the right one.
  if (firstRun === null && ready) return <View style={s.c}><Text style={s.h}>EZjobsite</Text></View>;

  if (firstRun && ready && !gate) {
    const step = nextStep({
      langChosen: !!langPicked,
      hasJob: projects.some((p) => p.id !== INBOX_ID),
      hasConsent: consent.consent !== null,
    });

    if (step === 'done') {
      // No celebration screen. They came here to record something.
      void markFirstRunDone(db).then(() => setFirstRun(false));
      return <View style={s.c}><Text style={s.h}>EZjobsite</Text></View>;
    }

    // 1. LANGUAGE, FIRST AND WITHOUT WORDS.
    //    Asking someone to read English to choose Spanish is the joke every app
    //    makes. Both options are shown in their OWN language, side by side, so
    //    this screen needs no reading at all -- you recognise your language or you
    //    do not.
    if (step === 'lang') {
      return (
        <View style={s.c}>
          <Text style={s.h}>EZjobsite</Text>
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

    // 2. THE JOB. Consent belongs to a project, so there must be one first.
    //    A name is enough -- the address can come later, and demanding one from a
    //    man standing in the room is how you get "asdf".
    if (step === 'job') {
      return (
        <View style={s.c}>
          <Text style={s.h}>EZjobsite</Text>
          <View style={s.card}>
            <Text style={s.cardH}>{T('fr.jobTitle')}</Text>
            <Text style={s.cardNote}>{T('fr.jobWhy')}</Text>
            <TextInput style={s.moneyInput} value={frJob} autoFocus
              placeholder={T('job.name')} placeholderTextColor="#6e7681"
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

    // 3. CONSENT. One tap, strict default. Reuses the same screen the app uses
    //    later -- one implementation, so the legal wording can never drift.
    if (step === 'consent' && !setup) {
      setSetup({ jurisdiction: '' });
    }
  }

  if (newJob) {
    return (
      <View style={s.c}>
        <Text style={s.h}>EZjobsite</Text>
        <View style={s.card}>
          <Text style={s.cardH}>{T('job.newTitle')}</Text>
          <TextInput style={s.moneyInput} value={newJob.name} autoFocus
            placeholder={T('job.name')} placeholderTextColor="#6e7681"
            onChangeText={(v) => setNewJob({ ...newJob, name: v })} />
          <TextInput style={s.moneyInput} value={newJob.address}
            placeholder={T('job.address')} placeholderTextColor="#6e7681"
            onChangeText={(v) => setNewJob({ ...newJob, address: v })} />
          <Text style={s.cardNote}>
            We’ll pin this job to where you are now, so captures here file
            themselves. You can add the address later.
          </Text>
          <Pressable style={[s.confirmWide, !newJob.name.trim() && s.btnOff]}
            disabled={!newJob.name.trim()}
            onPress={async () => {
              // Pin it to HERE. That is what makes resolution work later, and it
              // costs the user nothing: he is standing on the job as he creates it.
              const st = await stampNow();
              const r = await createProject(db, {
                ownerId: OWNER, name: newJob.name, address: newJob.address || null,
                lat: st.lat, lng: st.lng,
              });
              if (!r.ok) { setUi({ k: 'refused', why: r.reason }); return; }
              setProjectId(r.id);
              setProjects(await listProjects(db));
              setNewJob(null); setPicker(false);
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
        <Text style={s.h}>EZjobsite</Text>
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

  if (setup) {
    const suggested = defaultConsentFor(setup.jurisdiction || null);
    const choose = async (c: Exclude<RecordingConsent, null>) => {
      await setRecordingConsent(db, {
        projectId: projectId, consent: c,
        jurisdiction: setup.jurisdiction || null, decidedBy: 'Owner',
      });
      setConsent(await getRecordingConsent(db, projectId));
      setSetup(null);
    };
    return (
      <View style={s.c}>
        <Text style={s.h}>EZjobsite</Text>
        <View style={s.card}>
          <Text style={s.cardH}>{T('consent.title')}</Text>
          <Text style={s.cardNote}>
            Decided once, here. The record button will never stop to ask you.
          </Text>

          <Text style={s.sub}>Where is this job? (2-letter state)</Text>
          <TextInput style={s.moneyInput} value={setup.jurisdiction} autoCapitalize="characters"
            maxLength={2} placeholder="e.g. CA" placeholderTextColor="#6e7681"
            onChangeText={(v) => setSetup({ jurisdiction: v })} />
          <Text style={s.dmeta}>
            {setup.jurisdiction
              ? `Suggested for ${setup.jurisdiction.toUpperCase()}: ${suggested === 'all_party'
                  ? 'everyone must agree' : 'you may record conversations you are part of'}`
              : 'Not set — we assume the strictest rule until you tell us.'}
          </Text>

          <Pressable style={[s.confirmWide, suggested !== 'all_party' && s.btnOff]}
            onPress={() => choose('all_party')}>
            <Text style={s.confirmT}>{T('consent.everyone')}</Text>
          </Pressable>
          <Pressable style={[s.confirmWide, suggested !== 'one_party' && s.btnOff]}
            onPress={() => choose('one_party')}>
            <Text style={s.confirmT}>{T('consent.imPart')}</Text>
          </Pressable>
          <Pressable style={s.later} onPress={() => choose('no_recording')}>
            <Text style={s.laterT}>{T('consent.none')}</Text>
          </Pressable>

          <Text style={s.cardNote}>
            {consentBasisText(suggested, setup.jurisdiction || null)}
            {'\n\n'}This records what you chose. It is not legal advice — recording
            rules differ by state and by who is in the room.
          </Text>
          <Pressable style={s.later} onPress={() => setSetup(null)}>
            <Text style={s.laterT}>{T('common.back')}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (sign) {
    return (
      <View style={s.c}>
        <Text style={s.h}>EZjobsite</Text>
        <View style={s.card}>
          <Text style={s.cardH}>{T('sig.required')}</Text>
          <Text style={s.frozen}>{sign.shown}</Text>

          {!sign.verifiedAt ? (
            <>
              <Text style={s.sub}>{T('sig.ownersMobile')}</Text>
              <TextInput style={s.moneyInput} value={sign.phone} keyboardType="phone-pad"
                placeholder="+15551234567" placeholderTextColor="#6e7681"
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
                    placeholder={T('sig.enterCode')} placeholderTextColor="#6e7681"
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
                placeholder={T('sig.legalName')} placeholderTextColor="#6e7681"
                onChangeText={(v) => setSign({ ...sign, legalName: v })} />
              <View style={s.cardBtns}>
                <Pressable style={[s.confirm, sign.legalName.trim().length < 2 && s.btnOff]}
                  disabled={sign.legalName.trim().length < 2}
                  onPress={async () => {
                    const r = await signApproval(connector.client, {
                      changeOrderId: sign.coId, projectId: projectId, shownContent: sign.shown,
                      signerLabel: 'Owner', legalName: sign.legalName, phoneE164: sign.phone,
                      otpVerifiedAt: sign.verifiedAt!, action: 'approved', userAgent: 'EZjobsite iOS',
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
                    action: 'declined', userAgent: 'EZjobsite iOS',
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

  return (
    <View style={s.c}>
      <Pressable onPress={() => { const n: Lang = lang === 'en' ? 'es' : 'en'; setLang(n); setLangState(n); }}>
        <Text style={s.h}>EZjobsite <Text style={s.langT}>{lang === 'en' ? 'ES' : 'EN'}</Text></Text>
      </Pressable>

      {/* Which job you're on, and one tap to change it. A capture tool that does
          not tell you where things are going is asking for trust it has not
          earned. */}
      <Pressable style={s.jobBar} onPress={() => setPicker(true)}>
        <Text style={s.jobBarT}>
          {projects.find((p) => p.id === projectId)?.name ?? T('job.pick')}
        </Text>
        <Text style={s.jobBarS}>{T('job.change')}</Text>
      </Pressable>

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

      {!gate && !initError && consent.consent === null && (
        <Pressable style={s.consentBanner} onPress={() => setSetup({ jurisdiction: '' })}>
          <Text style={s.consentT}>{T('consent.notSetTitle')}</Text>
          <Text style={s.consentS}>{T('consent.notSetBody')}</Text>
        </Pressable>
      )}

      {(gate || initError) && (
        <View style={s.gate}>
          <Text style={s.gateT}>{initError ? 'EZjobsite couldn’t start safely' : 'Can’t record safely on this device'}</Text>
          <Text style={s.gateS}>
            The database can’t guarantee a save would survive. Rather than tell you
            something is saved and lose it, recording is off.
          </Text>
          <Text style={s.mono}>{gate ?? initError}</Text>
        </View>
      )}

      <Pressable
        onPress={onPress}
        disabled={!ready || !!gate || !!initError || ui.k === 'saving' || ui.k === 'arming'}
        style={[s.btn, ui.k === 'recording' && s.btnRec, (!!gate || !!initError || !ready) && s.btnOff]}
      >
        <Text style={s.btnT}>{label}</Text>
      </Pressable>

      <Text style={s.state}>
        {ui.k === 'saved' ? T('st.savedNotBacked')
          : ui.k === 'refused' ? T({ k: 'cap.notSaved', p: { why: T(ui.why) } })
          : ui.k === 'recording' ? 'Recording…'
          : ui.k === 'saving' ? 'Finishing…'
          : ready ? T('rec.ready') : T('st.starting')}
      </Text>

      {/* REQ-CAP2: all four modalities, all working with no signal. Big targets,
          one touch each -- mandate #3 assumes gloves, a ladder and a loud room. */}
      <View style={s.mediaRow}>
        <Pressable style={[s.media, gate && s.btnOff]} disabled={!!gate}
          onPress={() => onMedia(snapPhoto, 'Camera')}>
          <Text style={s.mediaIcon}>📷</Text><Text style={s.mediaT}>{T('cap.photo')}</Text>
        </Pressable>
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
          placeholderTextColor="#6e7681"
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
                placeholder="what" placeholderTextColor="#6e7681"
                onChangeText={(v) => setDraftLine({ ...draftLine, desc: v })} />
              <TextInput style={s.lineIn} value={draftLine.qty} keyboardType="decimal-pad"
                placeholder="qty" placeholderTextColor="#6e7681"
                onChangeText={(v) => setDraftLine({ ...draftLine, qty: v })} />
              <TextInput style={s.lineIn} value={draftLine.unit} keyboardType="decimal-pad"
                placeholder="each" placeholderTextColor="#6e7681"
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
              placeholderTextColor="#6e7681"
            />
            <Text style={s.sub}>Not to exceed (optional)</Text>
            <TextInput
              style={s.moneyInput}
              value={priced.nteText}
              onChangeText={(v) => setPriced({ ...priced, nteText: v })}
              keyboardType="decimal-pad"
              placeholder="optional cap for T&M"
              placeholderTextColor="#6e7681"
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

      <ScrollView style={{ flex: 1 }}>
        {saved.slice().reverse().map((c) => (
          <Pressable key={c.capture_id} style={s.row} onPress={async () => {
              const v = await readCapture(db, c.capture_id);
              setViewing({ ...v, captureId: c.capture_id });
              setVnotes(await notesFor(db, c.capture_id));
            }}>
            <Text style={s.rowT}>{c.capture_id}</Text>
            {/* ONE status per item. The modality, size and hash are DETAIL —
                they belong on the viewer, which is one tap away. A row that
                shouts its own SHA-256 at a man on a ladder is the system talking
                about itself. */}
            {(() => {
              const st = captureStatus({
                inInbox: c.project_id === INBOX_ID, rejected: false,
                pendingUpload: false, parked: false,
                hasLocation: c.gps_lat != null,
              });
              return (
                <Text style={[s.rowS, { color: levelColor(st.level).text }]}>
                  {T(st.primary)}
                </Text>
              );
            })()}
            <Text style={s.rowS}>
              {c.modality}
              {nCounts[c.capture_id] ? ` · ${nCounts[c.capture_id]} note${nCounts[c.capture_id] > 1 ? 's' : ''}` : ''}
            </Text>
            {/* MANDATE #9 made visible. A missing fix says WHY -- never 0,0 (a spot
                in the Atlantic) and never a guess. Captures taken before the stamp
                existed show "no location" honestly: capture_commit is append-only,
                so those rows cannot be backfilled, and that is a true fact about
                them rather than a bug in this line. */}
            <Text style={s.stamp}>{describeStamp(c)}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  c: { flex: 1, paddingTop: 72, paddingHorizontal: 20, backgroundColor: '#0b0b0c' },
  h: { color: '#7ee787', fontSize: 26, fontWeight: '800', marginBottom: 18 },
  btn: { backgroundColor: '#238636', paddingVertical: 28, borderRadius: 18, alignItems: 'center' },
  btnRec: { backgroundColor: '#da3633' },
  btnOff: { backgroundColor: '#30363d' },
  mediaRow: { flexDirection: 'row', gap: 10, marginBottom: 18 },
  media: { flex: 1, backgroundColor: '#21262d', borderRadius: 12, paddingVertical: 16,
    alignItems: 'center', borderWidth: 1, borderColor: '#30363d' },
  mediaIcon: { fontSize: 26, marginBottom: 4 },
  mediaT: { color: '#e6edf3', fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  stamp: { color: '#6e7681', fontSize: 10 },
  btnT: { color: '#fff', fontSize: 24, fontWeight: '800', letterSpacing: 1 },
  state: { color: '#c9d1d9', fontSize: 15, marginTop: 14, marginBottom: 22, textAlign: 'center' },
  sub: { color: '#8b949e', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  row: { borderTopWidth: 1, borderTopColor: '#21262d', paddingVertical: 10 },
  rowT: { color: '#c9d1d9', fontSize: 13, fontFamily: 'Menlo' },
  rowS: { color: '#6e7681', fontSize: 11, fontFamily: 'Menlo', marginTop: 2 },
  card: { backgroundColor: '#0d2818', borderColor: '#238636', borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 16 },
  cardH: { color: '#7ee787', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  cardV: { color: '#fff', fontSize: 17, lineHeight: 23, marginBottom: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  chip: { color: '#7ee787', backgroundColor: '#132f1f', borderColor: '#238636', borderWidth: 1,
          borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, fontSize: 12, overflow: 'hidden' },
  chipDim: { color: '#6e7681', borderColor: '#30363d', backgroundColor: 'transparent' },
  cardBtns: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  confirm: { flex: 1, backgroundColor: '#238636', borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  // Standalone (not inside s.cardBtns): must NOT use flex:1 -- see above.
  confirmWide: { alignSelf: 'stretch', backgroundColor: '#238636', borderRadius: 10,
    paddingVertical: 16, alignItems: 'center', marginBottom: 10 },
  confirmT: { color: '#fff', fontWeight: '800', letterSpacing: 1 },
  later: { paddingHorizontal: 12, paddingVertical: 14 },
  laterT: { color: '#8b949e', fontSize: 13 },
  cardNote: { color: '#6e7681', fontSize: 11, marginTop: 8 },
  drow: { borderTopWidth: 1, borderTopColor: '#21262d', paddingVertical: 10 },
  dsub: { color: '#8b949e', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 },
  dval: { color: '#e6edf3', fontSize: 15, marginTop: 2 },
  dmeta: { color: '#6e7681', fontSize: 11, marginTop: 3 },
  hNow: { color: '#7ee787', fontSize: 14, marginBottom: 4 },
  hOld: { color: '#6e7681', fontSize: 13, marginBottom: 4, textDecorationLine: 'line-through' },
  money: { backgroundColor: '#1c1400', borderColor: '#9e6a03', borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 16 },
  moneyScope: { color: '#c9d1d9', fontSize: 14, marginBottom: 10 },
  bigMoney: { color: '#f0b72f', fontSize: 44, fontWeight: '800', textAlign: 'center', marginVertical: 6 },
  viewImg: { width: '100%', height: 260, borderRadius: 8, backgroundColor: '#010409',
    marginBottom: 10 },
  evid: { color: '#e6edf3', fontSize: 15, marginBottom: 10 },
  hash: { color: '#8b949e', fontSize: 11, fontFamily: 'Menlo', marginBottom: 8 },
  capNote: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#21262d' },
  capNoteBody: { color: '#e6edf3', fontSize: 14 },
  capNoteMeta: { color: '#6e7681', fontSize: 11, marginTop: 2 },
  inboxItem: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#21262d' },
  inboxWhat: { color: '#8b949e', fontSize: 12, marginBottom: 6 },
  inboxJobs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  inboxJob: { backgroundColor: '#21262d', borderRadius: 8, paddingHorizontal: 12,
    paddingVertical: 10, borderWidth: 1, borderColor: '#30363d' },
  inboxJobT: { color: '#e6edf3', fontSize: 13, fontWeight: '600' },
  langT: { color: '#6e7681', fontSize: 13, fontWeight: '400' },
  oneStatus: { borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 12 },
  oneStatusT: { fontWeight: '700', fontSize: 14 },
  oneStatusD: { color: '#8b949e', fontSize: 11, marginTop: 3 },
  // Thumb-sized. This is the first thing a new user ever touches, and they may be
  // wearing gloves when they do it.
  langBig: { backgroundColor: '#21262d', borderColor: '#30363d', borderWidth: 1,
    borderRadius: 14, paddingVertical: 28, alignItems: 'center', marginBottom: 16 },
  langBigT: { color: '#e6edf3', fontSize: 26, fontWeight: '700' },
  jobBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#161b22', borderColor: '#30363d', borderWidth: 1,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12 },
  jobBarT: { color: '#e6edf3', fontWeight: '700', fontSize: 15, flex: 1 },
  jobBarS: { color: '#6e7681', fontSize: 11 },
  jobRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#21262d' },
  jobName: { color: '#e6edf3', fontSize: 16 },
  jobNameOn: { color: '#7ee787', fontSize: 16, fontWeight: '700' },
  jobMeta: { color: '#6e7681', fontSize: 12, marginTop: 2 },
  consentBanner: { backgroundColor: '#2d2410', borderColor: '#7d6320', borderWidth: 1,
    borderRadius: 10, padding: 12, marginBottom: 14 },
  consentT: { color: '#f0b72f', fontWeight: '700', fontSize: 14, marginBottom: 3 },
  consentS: { color: '#a5934f', fontSize: 12, lineHeight: 17 },
  bundleBtn: { paddingVertical: 8 },
  bundleT: { color: '#58a6ff', fontSize: 14, fontWeight: '600' },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6,
    borderBottomWidth: 1, borderBottomColor: '#21262d' },
  lineDesc: { color: '#e6edf3', fontSize: 14, flex: 1 },
  lineMath: { color: '#8b949e', fontSize: 12 },
  lineX: { color: '#6e7681', fontSize: 16, paddingHorizontal: 6 },
  lineAdd: { flexDirection: 'row', gap: 6, marginTop: 10, marginBottom: 4 },
  lineIn: { flex: 1, backgroundColor: '#0b0b0c', borderColor: '#30363d', borderWidth: 1,
    borderRadius: 8, color: '#e6edf3', paddingHorizontal: 8, paddingVertical: 10, fontSize: 13 },
  linePlus: { backgroundColor: '#21262d', borderRadius: 8, paddingHorizontal: 14,
    justifyContent: 'center' },
  linePlusT: { color: '#e6edf3', fontSize: 20, fontWeight: '800' },
  moneyInput: { backgroundColor: '#0b0b0c', borderColor: '#30363d', borderWidth: 1, borderRadius: 8,
                color: '#e6edf3', padding: 12, fontSize: 18, marginBottom: 10, textAlign: 'center' },
  ok: { color: '#7ee787', fontSize: 14, marginBottom: 8 },
  warn: { color: '#f0b72f', fontSize: 12, marginBottom: 6 },
  ask: { marginTop: 8 },
  askT: { color: '#58a6ff', fontSize: 13, fontWeight: '600' },
  frozen: { color: '#e6edf3', fontSize: 14, lineHeight: 20, backgroundColor: '#0b0b0c',
            borderColor: '#30363d', borderWidth: 1, borderRadius: 8, padding: 10, marginBottom: 8 },
  link: { color: '#58a6ff', fontFamily: 'Menlo', fontSize: 11, marginVertical: 6 },
  noteRow: { flexDirection: 'row', gap: 8, marginBottom: 22 },
  input: { flex: 1, backgroundColor: '#161b22', borderColor: '#30363d', borderWidth: 1,
           borderRadius: 10, color: '#c9d1d9', padding: 12, minHeight: 54, fontSize: 15 },
  save: { backgroundColor: '#1f6feb', borderRadius: 10, paddingHorizontal: 18, justifyContent: 'center' },
  saveT: { color: '#fff', fontWeight: '800', letterSpacing: 1 },
  gate: { backgroundColor: '#3d1d1d', borderColor: '#da3633', borderWidth: 1, borderRadius: 10, padding: 14, marginBottom: 18 },
  gateT: { color: '#ff7b72', fontWeight: '700', marginBottom: 6 },
  gateS: { color: '#c9d1d9', fontSize: 13, lineHeight: 18 },
  mono: { color: '#8b949e', fontFamily: 'Menlo', fontSize: 10, marginTop: 8 },
});
