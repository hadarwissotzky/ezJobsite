import '@azure/core-asynciterator-polyfill';
import 'react-native-get-random-values';

import { OPSqliteOpenFactory } from '@powersync/op-sqlite';
import { PowerSyncDatabase } from '@powersync/react-native';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppSchema } from './src/AppSchema';
import { SupabaseConnector } from './src/connector';
import {
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
import { drainOutbox, outboxStatus } from './src/uploader';
import { decisionHistory, decisionSyncStatus, drainDecisionOutbox, ensureDecisionSchema,
         listDecisions, recordDecision, type DecisionRow } from './src/decisions';
import { sendForConfirmation } from './src/confirmations';
import { applyLocalApproval, centsFromInput, createChangeOrder, drainChangeOrderOutbox,
         ensureChangeOrderSchema, hydrateChangeOrders, ledger, money, parseMoney } from './src/changeorder';
import { issueOtp, newOtpCode, renderApproval, signApproval, verifyOtp } from './src/signing';

export const db = new PowerSyncDatabase({
  schema: AppSchema,
  // op-sqlite passed EXPLICITLY. The bare { dbFilename } form does not
  // auto-detect it and falls back to quick-sqlite, which throws at runtime.
  database: new OPSqliteOpenFactory({ dbFilename: 'ezjobsite.db' }),
});

const connector = new SupabaseConnector();
const PROJECT_ID = 'proj-bakeoff-1';
const OWNER = 'owner-local';

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
  | { k: 'refused'; why: string };

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
  // MANDATE #6: the read-back. A price is never accepted without a human
  // looking at it. `confidence` decides whether we dare prefill.
  const [priced, setPriced] = React.useState<null | {
    decisionId: string; scope: string; whoDirected: string;
    amountText: string; confidence: 'high'|'low'|'none'; nteText: string;
  }>(null);
  const [coRows, setCoRows] = React.useState<any[]>([]);
  const [dsync, setDsync] = React.useState<any>(null);
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
      setSaved(await listCommittedCaptures(db));
      const s = (await outboxStatus(db))[0];
      // Captures and decisions ride independent queues, so "not backed up yet"
      // must count both. One green tick that ignores half the queue is a lie.
      const ds = await decisionSyncStatus(db);
      setDsync(ds);
      setDsync(ds);
      setDelivery({ pending: (s?.pending ?? 0) + ds.pending, parked: (s?.parked ?? 0) + ds.parked });
      setDecisions(await listDecisions(db, PROJECT_ID));
      setCoRows(await ledger(db, PROJECT_ID));
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
          const cr = await drainChangeOrderOutbox(db, connector.client, data.user.id);
          if (cr.attempted) console.log('drain change orders:', JSON.stringify(cr));
          // Pull anything this device does not have: a reinstall, a second phone,
          // or a CO authored before the device became the author.
          const hy = await hydrateChangeOrders(db, connector.client, PROJECT_ID, data.user.id);
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
      const r = await performCapture(db, {
        ownerId: 'owner-local', projectId: 'proj-bakeoff-1',
        input: voiceCapture(bytes), stamp: await stampNow(),
      });
      if (r.ok) setUi({ k: 'saved', id: r.captureId });
      else setUi({ k: 'refused', why: r.reason });
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
      const r = await performCapture(db, {
        ownerId: OWNER, projectId: PROJECT_ID, input: picked.input, stamp: await fix,
      });
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
      const r = await performCapture(db, {
        ownerId: OWNER, projectId: PROJECT_ID, input: textCapture(note),
        stamp: await stampNow(),
      });
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
    gate ? 'UNAVAILABLE' :
    ui.k === 'recording' ? 'STOP' :
    ui.k === 'saving' ? 'SAVING…' :
    ui.k === 'arming' ? '…' : 'RECORD';

  // A signature gets the whole screen. Nothing else is reachable while it is up --
  // one deliberate act, no way to wander off halfway through signing.
  if (sign) {
    return (
      <View style={s.c}>
        <Text style={s.h}>EZjobsite</Text>
        <View style={s.card}>
          <Text style={s.cardH}>Signature required</Text>
          <Text style={s.frozen}>{sign.shown}</Text>

          {!sign.verifiedAt ? (
            <>
              <Text style={s.sub}>Owner's mobile — you enter it, not them</Text>
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
                  <Text style={s.confirmT}>SEND CODE</Text>
                </Pressable>
              ) : (
                <>
                  <Text style={s.warn}>
                    No SMS provider yet — code would be texted to {sign.phone}.
                    For now: {sign.sent}
                  </Text>
                  <TextInput style={s.moneyInput} value={sign.code} keyboardType="number-pad"
                    placeholder="6-digit code" placeholderTextColor="#6e7681"
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
                    <Text style={s.confirmT}>VERIFY</Text>
                  </Pressable>
                </>
              )}
            </>
          ) : (
            <>
              <Text style={s.ok}>✓ Phone verified</Text>
              <Text style={s.sub}>Type your full legal name to sign</Text>
              <TextInput style={s.moneyInput} value={sign.legalName}
                placeholder="Full legal name" placeholderTextColor="#6e7681"
                onChangeText={(v) => setSign({ ...sign, legalName: v })} />
              <View style={s.cardBtns}>
                <Pressable style={[s.confirm, sign.legalName.trim().length < 2 && s.btnOff]}
                  disabled={sign.legalName.trim().length < 2}
                  onPress={async () => {
                    const r = await signApproval(connector.client, {
                      changeOrderId: sign.coId, projectId: PROJECT_ID, shownContent: sign.shown,
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
                  <Text style={s.confirmT}>SIGN & APPROVE</Text>
                </Pressable>
                <Pressable style={s.later} onPress={async () => {
                  await signApproval(connector.client, {
                    changeOrderId: sign.coId, projectId: PROJECT_ID, shownContent: sign.shown,
                    signerLabel: 'Owner', legalName: sign.legalName || 'declined',
                    phoneE164: sign.phone, otpVerifiedAt: sign.verifiedAt!,
                    action: 'declined', userAgent: 'EZjobsite iOS',
                  });
                  await applyLocalApproval(db, sign.coId, 'declined', sign.legalName);
                  setSign(null); await refresh();
                }}>
                  <Text style={s.laterT}>Decline</Text>
                </Pressable>
              </View>
            </>
          )}

          {sign.err && <Text style={s.warn}>{sign.err}</Text>}
          <Pressable style={s.later} onPress={() => setSign(null)}>
            <Text style={s.laterT}>Close</Text>
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
      <Text style={s.h}>EZjobsite</Text>

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
        {ui.k === 'saved' ? 'Saved on this phone ✓ — not backed up yet'
          : ui.k === 'refused' ? `Not saved: ${ui.why}`
          : ui.k === 'recording' ? 'Recording…'
          : ui.k === 'saving' ? 'Finishing…'
          : ready ? 'Ready' : 'Starting…'}
      </Text>

      {/* REQ-CAP2: all four modalities, all working with no signal. Big targets,
          one touch each -- mandate #3 assumes gloves, a ladder and a loud room. */}
      <View style={s.mediaRow}>
        <Pressable style={[s.media, gate && s.btnOff]} disabled={!!gate}
          onPress={() => onMedia(snapPhoto, 'Camera')}>
          <Text style={s.mediaIcon}>📷</Text><Text style={s.mediaT}>PHOTO</Text>
        </Pressable>
        <Pressable style={[s.media, gate && s.btnOff]} disabled={!!gate}
          onPress={() => onMedia(recordVideo, 'Camera')}>
          <Text style={s.mediaIcon}>🎥</Text><Text style={s.mediaT}>VIDEO</Text>
        </Pressable>
        <Pressable style={[s.media, gate && s.btnOff]} disabled={!!gate}
          onPress={() => onMedia(pickFromLibrary, 'Photos')}>
          <Text style={s.mediaIcon}>🖼</Text><Text style={s.mediaT}>PICK</Text>
        </Pressable>
      </View>

      <Text style={s.sub}>Or type it</Text>
      <View style={s.noteRow}>
        <TextInput
          style={s.input}
          value={note}
          onChangeText={setNote}
          placeholder="What was decided?"
          placeholderTextColor="#6e7681"
          multiline
          editable={!gate && ui.k !== 'saving'}
        />
        <Pressable
          onPress={onSaveNote}
          disabled={!!gate || !note.trim() || ui.k === 'saving'}
          style={[s.save, (!note.trim() || !!gate) && s.btnOff]}
        >
          <Text style={s.saveT}>SAVE</Text>
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
                projectId: PROJECT_ID, ownerId: OWNER, subject: card.subject, value: card.value,
                captureId: card.captureId, directedBy: card.directedBy, scopeLevel: card.scope,
              });
              setCard(null);
              setUi({ k: 'saved', id: card.captureId });
              if (res.superseded) console.log('superseded:', res.superseded, '->', card.value);
              await refresh();
            }}>
              <Text style={s.confirmT}>CONFIRM</Text>
            </Pressable>
            <Pressable style={s.later} onPress={() => setCard(null)}>
              <Text style={s.laterT}>Not a decision</Text>
            </Pressable>
          </View>
          <Text style={s.cardNote}>Already saved either way — this just says what it means.</Text>
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
                  kind: 'confirm', decisionId: d.id, projectId: PROJECT_ID,
                  projectName: 'Bakeoff Project', subject: d.subject, value: d.current_value,
                  directedBy: d.directed_by ?? 'Owner', counterparty: d.directed_by ?? 'Owner',
                  channel: 'link', whenMs: d.last_changed_ms,
                  linkBase: 'https://ezjobsite.app',
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
            <Text style={s.cardH}>Check the number</Text>
            <Text style={s.moneyScope}>{priced.scope}</Text>

            {priced.confidence === 'low' && (
              <Text style={s.warn}>
                Heard a number but not sure it's the price. Type it.
              </Text>
            )}
            {priced.confidence === 'none' && (
              <Text style={s.warn}>No price heard. Type it.</Text>
            )}

            {/* Read-back: BIG, and tap-to-correct. mandate #6. */}
            <Text style={s.bigMoney}>{money(cents)}</Text>
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
                style={[s.confirm, cents === null && s.btnOff]}
                disabled={cents === null}
                onPress={async () => {
                  const { data } = await connector.client.auth.getUser();
                  if (!data?.user) { setUi({k:'refused',why:'not signed in'}); return; }
                  const r = await createChangeOrder(db, {
                    id: `co-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`,
                    decisionId: priced.decisionId, projectId: PROJECT_ID, ownerId: data.user.id,
                    scope: priced.scope, amountCents: cents!, nteCents: nte,
                    whoDirected: priced.whoDirected,
                    // The read-back happened HERE. This timestamp is the proof,
                    // and the DB refuses the row without it.
                    numbersConfirmedAt: new Date(),
                  });
                  if (r.ok) { setPriced(null); await refresh(); }
                  else setUi({ k: 'refused', why: r.reason });
                }}>
                <Text style={s.confirmT}>
                  {cents === null ? 'ENTER A PRICE' : `YES — ${money(cents)}`}
                </Text>
              </Pressable>
              <Pressable style={s.later} onPress={() => setPriced(null)}>
                <Text style={s.laterT}>Cancel</Text>
              </Pressable>
            </View>
            <Text style={s.cardNote}>
              Nothing is sent until you agree with this figure.
            </Text>
          </View>
        );
      })()}

      {coRows.length > 0 && (
        <>
          <Text style={s.sub}>Change orders ({coRows.length})</Text>
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
          <Text style={s.cardH}>Confirm request created</Text>
          <Text style={s.frozen}>{sentLink.shown}</Text>
          <Text style={s.cardNote}>
            These exact words are frozen — if the decision changes later, this still
            shows what they were asked. It is the binding record.
          </Text>
          <Text style={s.link}>{sentLink.url}</Text>
          <Text style={s.cardNote}>
            No login needed. NOT YET DELIVERED — email/SMS is unbuilt (REQ-VAL8);
            the link works, nothing sends it.
          </Text>
          <Pressable style={s.later} onPress={() => setSentLink(null)}>
            <Text style={s.laterT}>Close</Text>
          </Pressable>
        </View>
      )}

      {history && (
        <View style={s.card}>
          <Text style={s.cardH}>History — nothing is ever overwritten</Text>
          {history.map((h, i) => (
            <Text key={i} style={i === 0 ? s.hNow : s.hOld}>
              {i === 0 ? '● now:  ' : '○ was: '}{h.value}
              {h.directed_by ? `  (${h.directed_by})` : ''}
            </Text>
          ))}
          <Pressable style={s.later} onPress={() => setHistory(null)}>
            <Text style={s.laterT}>Close</Text>
          </Pressable>
        </View>
      )}

      <Text style={s.sub}>
        Saved on this phone ({saved.length})
        {delivery.pending > 0 ? ` · ${delivery.pending} waiting to back up` : ''}
        {delivery.parked > 0 ? ` · ${delivery.parked} FAILED to back up` : ''}
      </Text>
      {delivery.parked > 0 && (
        <Text style={s.parked}>
          {delivery.parked} capture{delivery.parked > 1 ? 's are' : ' is'} saved here but could not
          be backed up. Still on this phone — not lost. Needs attention.
        </Text>
      )}
      <ScrollView style={{ flex: 1 }}>
        {saved.slice().reverse().map((c) => (
          <View key={c.capture_id} style={s.row}>
            <Text style={s.rowT}>{c.capture_id}</Text>
            <Text style={s.rowS}>{c.modality} · {(c.media_bytes / 1024).toFixed(1)} KB · {c.media_sha256.slice(0, 12)}…</Text>
            {/* MANDATE #9 made visible. A missing fix says WHY -- never 0,0 (a spot
                in the Atlantic) and never a guess. Captures taken before the stamp
                existed show "no location" honestly: capture_commit is append-only,
                so those rows cannot be backfilled, and that is a true fact about
                them rather than a bug in this line. */}
            <Text style={s.stamp}>{describeStamp(c)}</Text>
          </View>
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
  moneyInput: { backgroundColor: '#0b0b0c', borderColor: '#30363d', borderWidth: 1, borderRadius: 8,
                color: '#e6edf3', padding: 12, fontSize: 18, marginBottom: 10, textAlign: 'center' },
  ok: { color: '#7ee787', fontSize: 14, marginBottom: 8 },
  warn: { color: '#f0b72f', fontSize: 12, marginBottom: 6 },
  ask: { marginTop: 8 },
  askT: { color: '#58a6ff', fontSize: 13, fontWeight: '600' },
  frozen: { color: '#e6edf3', fontSize: 14, lineHeight: 20, backgroundColor: '#0b0b0c',
            borderColor: '#30363d', borderWidth: 1, borderRadius: 8, padding: 10, marginBottom: 8 },
  link: { color: '#58a6ff', fontFamily: 'Menlo', fontSize: 11, marginVertical: 6 },
  parked: { color: '#ff7b72', fontSize: 12, marginBottom: 8, lineHeight: 16 },
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
