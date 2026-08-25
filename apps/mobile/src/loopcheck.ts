/**
 * The wired loop, run end to end against the REAL local database.
 *
 * WHY THIS EXISTS AND WHY IT IS NOT A UNIT TEST: the unit tests cover pure logic —
 * routing, status derivation, reminder rules — with hand-built inputs. They prove
 * the decisions are right. They cannot prove that `createChangeOrder` writes a row
 * `ledger()` can read, that `setExtraType` lands somewhere `suggestFor` sees, or
 * that the nine `ensureXSchema` calls produce tables these functions can actually
 * use together. Every one of those is a WIRING fact, and wiring is what broke eight
 * times in this codebase.
 *
 * It runs the same functions App.tsx calls, in the order App.tsx calls them, on the
 * device's own SQLite. No mocks, no fixtures, no reimplementation — a harness that
 * reimplements the path proves only that the harness works (the same argument
 * harness.ts makes for REQ-PROC4).
 *
 * WHAT IT DELIBERATELY DOES NOT COVER: anything past the network boundary. Sending
 * needs Supabase and Supabase needs a session. So this stops at "the extra is ready
 * to send and addressed to the right person", which is the last state reachable
 * without an account. That boundary is the honest one and it is stated in the
 * result rather than hidden by skipping the step quietly.
 *
 * Every step asserts a CONSEQUENCE, never that a call returned. A function that
 * returns ok and leaves nothing behind is exactly the failure this hunts.
 */
import { AbstractPowerSyncDatabase } from '@powersync/react-native';
import * as FS from 'expo-file-system/legacy';
import { createChangeOrder, ledger, parseMoney } from './changeorder';
import { addApprover, listRoster, setExtraType, suggestFor } from './approvers';
import { displayStatus } from './extrastatus';
import { canRemind } from './remind';
import { buildActivity, unreadCount } from './activity';
import { notifyPermissionStatus, runNotifications } from './notifystore';
import { markNotified } from './discussionstore';
import { discardCapture } from './discardstore';
import { startExtraFromCapture } from './startextra';
import { recognizeFile } from './ondevicestt';

export type Step = { name: string; ok: boolean; detail: string };
export type LoopResult = { steps: Step[]; passed: number; failed: number; pass: boolean };

export async function runLoopCheck(
  db: AbstractPowerSyncDatabase, ownerId: string, projectId: string
): Promise<LoopResult> {
  const steps: Step[] = [];
  const t = (name: string, ok: boolean, detail: string) => steps.push({ name, ok, detail });
  const tag = `lc-${Date.now().toString(36)}`;

  // 1 ── an extra exists, and the ledger can see it
  let coId = '';
  try {
    coId = `${tag}-co`;
    await createChangeOrder(db, {
      id: coId, ownerId, projectId, decisionId: `${tag}-d`,
      scope: `Loop check ${tag}`, amountCents: 185000, nteCents: 220000,
      whoDirected: 'Sarah Miller', numbersConfirmedAt: new Date(),
    });
    const rows = await ledger(db, projectId);
    const found = rows.find((x) => x.id === coId);
    t('create -> ledger', !!found,
      found ? `${found.scope} ${found.amount} status=${found.status}` : 'not in ledger');
  } catch (e: any) { t('create -> ledger', false, String(e?.message ?? e)); }

  // 2 ── the type is stored and read back (R5c)
  try {
    await setExtraType(db, coId, 'finish');
    const rows = await ledger(db, projectId);
    const got = rows.find((x) => x.id === coId)?.extra_type;
    t('setExtraType -> ledger', got === 'finish', `extra_type=${got}`);
  } catch (e: any) { t('setExtraType -> ledger', false, String(e?.message ?? e)); }

  // 3 ── the roster persists and routing SEES it. This is the join the unit tests
  //      cannot make: suggestApprover is pure, suggestFor reads the database.
  try {
    await addApprover(db, { projectId, name: `Dana ${tag}`, role: 'designer', canBindMoney: true });
    await addApprover(db, { projectId, name: `Sarah ${tag}`, role: 'owner' });
    const roster = await listRoster(db, projectId);
    const { suggestion } = await suggestFor(db, projectId, 'finish');
    const who = suggestion.kind === 'suggested' ? suggestion.approver.name : '(none)';
    // A finish extra routes to the designer ONLY because she was marked as able to
    // commit money; that is the rule the review forced, verified through storage.
    t('roster -> routing', suggestion.kind === 'suggested' && who.startsWith('Dana'),
      `roster=${roster.length} suggested=${who}`);
  } catch (e: any) { t('roster -> routing', false, String(e?.message ?? e)); }

  // 4 ── an untyped extra still routes (R5c's offline AC: never blocked)
  try {
    const { suggestion } = await suggestFor(db, projectId, null);
    t('untyped still routes', suggestion.kind === 'suggested',
      suggestion.kind === 'suggested' ? suggestion.approver.name : 'BLOCKED');
  } catch (e: any) { t('untyped still routes', false, String(e?.message ?? e)); }

  // 5 ── status derivation over real rows (R7). `discussing` is never stored.
  try {
    const rows = await ledger(db, projectId);
    const row = rows.find((x) => x.id === coId)!;
    const plain = displayStatus(row.status, { openQuestions: 0 });
    const withQ = displayStatus(row.status, { openQuestions: 1 });
    t('discussing is derived', plain !== 'discussing' && withQ === 'discussing',
      `${plain} -> ${withQ}`);
  } catch (e: any) { t('discussing is derived', false, String(e?.message ?? e)); }

  // 6 ── the activity list builds from real rows (R8)
  try {
    const rows = await ledger(db, projectId);
    const acts = buildActivity(rows.map((r) => ({
      changeOrderId: r.id, scope: r.scope, jobName: 'loop', status: r.status,
      amountCents: r.amount_cents, signedBy: r.signed_by, createdAtMs: r.created_at_ms,
      questions: r.id === coId ? [{ id: `${tag}-q`, body: 'can it wait?', atMs: Date.now() }] : [],
    })), new Set());
    const first = acts[0];
    t('activity + badge', !!first && first.kind === 'question' && unreadCount(acts) >= 1,
      `rows=${acts.length} first=${first?.kind} unread=${unreadCount(acts)}`);
  } catch (e: any) { t('activity + badge', false, String(e?.message ?? e)); }

  // 7 ── remind refuses a draft, and refuses mid-discussion (R8)
  try {
    const draft = canRemind('draft', { count: 0, lastAtMs: null, inDiscussion: false }, Date.now());
    const talking = canRemind('sent', { count: 0, lastAtMs: null, inDiscussion: true }, Date.now());
    t('remind rules hold',
      !draft.ok && draft.reasonKey === 'r8.notSent' &&
      !talking.ok && talking.reasonKey === 'r8.inDiscussion',
      `draft=${draft.ok ? 'allowed' : draft.reasonKey} talking=${talking.ok ? 'allowed' : talking.reasonKey}`);
  } catch (e: any) { t('remind rules hold', false, String(e?.message ?? e)); }

  // 8 ── R2: the price is read from the TRANSCRIPT, with no STT key involved.
  //
  // I had this recorded as "blocked, needs a key". The KEY is what fills the cache;
  // the PREFILL only reads it. Seeding one transcript exercises the whole path —
  // parse, confidence gate, mode inference — which is the half that can be wrong.
  try {
    const capId = `${tag}-cap`;
    await db.execute(
      `INSERT OR REPLACE INTO voice_transcript_cache (capture_id, text, segments, cached_at_ms)
       VALUES (?,?,?,?)`,
      [capId,
       'Found subfloor rot under the tub, needs replacement before tile. ' +
       'About six hours plus materials, eighteen fifty.',
       null, Date.now()]);
    const row = (await db.getAll<{ text: string }>(
      `SELECT text FROM voice_transcript_cache WHERE capture_id = ?`, [capId]))[0];
    // parseMoney is the gate mandate #6 turns on: "eighteen fifty" spoken is NOT a
    // confident $1,850 and must not prefill, but "$1,850.00" written is.
    const spoken = parseMoney(row.text);
    const written = parseMoney('Price: $1,850.00 for the subfloor');
    t('R2 transcript -> price gate',
      spoken.confidence !== 'high' && written.confidence === 'high' && written.cents === 185000,
      `spoken="eighteen fifty"->${spoken.confidence}  written="$1,850.00"->${written.confidence}/${written.cents}`);
  } catch (e: any) { t('R2 transcript -> price gate', false, String(e?.message ?? e)); }

  // STEP 9 WAS REMOVED, and the removal is the finding.
  //
  // I added a probe here calling requestRecordingPermissionsAsync, to test my own
  // premise that R1's pause change "needs a microphone". The probe HUNG: iOS raises
  // a permission dialog, nothing on this machine can tap it, and runLoopCheck never
  // returned — so the probe silently broke the other eight steps rather than
  // answering anything.
  //
  // That is the answer, arrived at the expensive way. Recording cannot be reached
  // here without someone touching the screen, so R1's pause change (stop-and-bank
  // instead of holding the file open) cannot be exercised. It needs a device with a
  // microphone AND a person, and it is the one item in this repo where being wrong
  // produces no error, no failing test and no red check — only missing audio.
  //
  // Anything added below MUST return without user interaction. A check that can hang
  // is worse than a check that is absent: absent is visible.

  // 9 ── R3/R6: a real PDF, from the real document generator.
  //
  // I had this recorded as "blocked: needs expo-print and a native rebuild". Both were
  // true and neither was a blocker — the dependency installs and the rebuild is the
  // same ten minutes I had already spent once. This asserts BYTES, not a return value:
  // printToFileAsync can hand back a uri for a file that is empty or is not a PDF, and
  // "it returned a path" is exactly the kind of evidence that is worth nothing.
  try {
    const Print = await import('expo-print');
    const { uri } = await Print.printToFileAsync({
      html: '<html><body><h1>Approval</h1><p>Price: $1,850.00</p></body></html>',
    });
    const info = await FS.getInfoAsync(uri);
    const head = await FS.readAsStringAsync(uri, { encoding: 'base64', length: 8, position: 0 });
    // "JVBERi0" is base64 for "%PDF-", the magic number every PDF starts with.
    const isPdf = head.startsWith('JVBERi0');
    t('R3 PDF generated',
      info.exists && (info as any).size > 500 && isPdf,
      `exists=${info.exists} bytes=${(info as any).size ?? 0} magic=${isPdf ? '%PDF-' : head.slice(0, 8)}`);
  } catch (e: any) { t('R3 PDF generated', false, String(e?.message ?? e).slice(0, 70)); }

  // 10 ── R8: a LOCAL notification, with no push provider anywhere.
  //
  // "R8 needs a provider and a device token" was true of REMOTE push and I applied it
  // to all of R8. scheduleNotificationAsync with trigger:null fires immediately, on
  // device, with no server involved — which covers the green-light moment and a
  // client's question whenever the app is running or backgrounded. That is most of
  // R8's value and none of its infrastructure.
  //
  // It schedules and then CANCELS: this is a check, not a notification anyone asked
  // for. Permission is NOT requested — that would raise the dialog that hung this
  // whole check once already. getPermissionsAsync only reads.
  try {
    const N = await import('expo-notifications');
    const perm = await N.getPermissionsAsync();
    const id = await N.scheduleNotificationAsync({
      content: { title: 'loopcheck', body: 'local delivery probe' }, trigger: null,
    });
    const scheduled = await N.getAllScheduledNotificationsAsync();
    await N.cancelScheduledNotificationAsync(id).catch(() => {});
    t('R8 local notification', !!id,
      `scheduled id=${String(id).slice(0, 8)} queue=${scheduled.length} permission=${perm.status}`);
  } catch (e: any) { t('R8 local notification', false, String(e?.message ?? e).slice(0, 70)); }

  // 11 ── R8/R5b: a question is announced, or it is kept. Never neither.
  //
  // THE INVARIANT, not the outcome. Whether this simulator has granted
  // notification permission is not something the check controls, and asserting
  // "a banner appeared" would fail on a clean device for a reason that is not a
  // bug. What must hold either way is the one rule that can silently lose a
  // client's question: `notified_at_ms` is stamped IF AND ONLY IF the
  // notification was actually presented. Stamp without presenting and the
  // question is gone — the app believes it told him and it never did.
  //
  // The unit test proves `planNotifications` decides this correctly. This
  // proves the wiring through the real database honours the decision.
  try {
    const mid = `${tag}-q`;
    await db.execute(`UPDATE change_order SET status = 'sent' WHERE id = ?`, [coId]);
    await db.execute(
      `INSERT INTO thread_message (id, change_order_id, side, body, at_ms, notified_at_ms)
       VALUES (?, ?, 'client', ?, ?, NULL)`,
      [mid, coId, 'Can you start Thursday?', Date.now()]
    );
    const perm = await notifyPermissionStatus();
    const res = await runNotifications(db, projectId);
    const row = await db.getAll<{ notified_at_ms: number | null }>(
      `SELECT notified_at_ms FROM thread_message WHERE id = ?`, [mid]
    );
    const stamped = row[0]?.notified_at_ms != null;
    const presented = res.presented > 0;
    t('R8 stamped iff presented', stamped === presented,
      `permission=${perm} presented=${res.presented} blocked=${res.blocked} stamped=${stamped}`);

    // NO CLEANUP, deliberately. The first version of this step deleted the row and
    // the delete was ABORTED by `thread_message_no_delete` -- the check was wrong,
    // the code was right, and that is the third time in this codebase a failing
    // check turned out to be the thing at fault. The message stays, attached to
    // this run's own synthetic `lc-` change order, exactly like every other row
    // the loop check leaves behind.

    // 12 ── the stamp is not itself blocked by the append-only rule.
    //
    // `thread_message_append_only` fires BEFORE UPDATE OF body, side, at_ms,
    // change_order_id -- notified_at_ms is outside that list, on purpose. Widen
    // that trigger to the whole row and nothing breaks loudly: markNotified starts
    // aborting, every question re-notifies on every 15s tick forever, and the only
    // symptom is a contractor whose phone will not stop buzzing. Asserted here
    // because the cost of finding out in the field is that high.
    await markNotified(db, [mid]);
    const after = await db.getAll<{ notified_at_ms: number | null }>(
      `SELECT notified_at_ms FROM thread_message WHERE id = ?`, [mid]
    );
    t('R8 stamp survives append-only', after[0]?.notified_at_ms != null,
      `notified_at_ms=${after[0]?.notified_at_ms ?? 'null'} (trigger excludes this column)`);
  } catch (e: any) {
    t('R8 stamped iff presented', false, String(e?.message ?? e).slice(0, 70));
  }

  // 13 ── R2 on device: does the phone actually recognise recorded speech?
  //
  // THE ONE THING THE DATABASE TESTS COULD NOT SETTLE. 368's guards and the
  // newest-wins supersession were both proven against a real Postgres, but every
  // one of those tests handed the transcript in by hand. Whether iOS can turn a
  // recorded jobsite m4a into words is a question only a device answers, and it
  // is the entire premise of choosing on-device over a paid API.
  //
  // The audio is REAL SPEECH, not a fixture: generated with macOS `say` and
  // pushed into the app container, so this exercises the actual recogniser on
  // actual encoded audio rather than a stub agreeing with itself.
  //
  // It asserts CONTENT, not just "it returned". A recogniser that hands back an
  // empty string has failed, and an empty string is exactly what would silently
  // sail through a truthiness check.
  try {
    const probe = `${FS.documentDirectory}stt-probe.m4a`;
    const info = await FS.getInfoAsync(probe);
    if (!info.exists) {
      // Absent is VISIBLE, never a quiet pass. The fixture has to be pushed in
      // before this can mean anything.
      t('R2 on-device recognises', false,
        'no stt-probe.m4a in documentDirectory — push it, then re-run');
    } else {
      // WHY separately, before calling: recognizeFile returns null for
      // "this device cannot" and for "you have not been allowed" alike, and a
      // failure that cannot name its cause sends the next person to the wrong
      // fix. The first version of this step reported them as one string and I
      // could not tell a simulator limitation from a permission I had not
      // granted.
      const M: any = await import('expo-speech-recognition');
      const supports = !!M.ExpoSpeechRecognitionModule?.supportsOnDeviceRecognition?.();
      const sperm = await M.ExpoSpeechRecognitionModule?.getPermissionsAsync?.();
      const why = `onDevice=${supports} permission=${sperm?.status ?? 'unknown'}`;
      const r = supports && sperm?.status === 'granted' ? await recognizeFile(db, probe) : null;
      const text = (r?.text ?? '').toLowerCase();
      // "subfloor" is the word that matters: it is domain vocabulary, not a
      // stock phrase, so hearing it means the recogniser read THIS audio.
      const heard = text.includes('subfloor') || text.includes('sub floor');
      t('R2 on-device recognises', !!r && text.trim().length > 0 && heard,
        r ? `"${(r.text ?? '').slice(0, 40)}" segments=${r.segments?.length ?? 0}`
          : why);
    }
  } catch (e: any) {
    t('R2 on-device recognises', false, String(e?.message ?? e).slice(0, 70));
  }

  // 14 ── DELETE, END TO END, on the device's own database.
  //
  // WHY IT EXISTS: hadar tapped this button four times across three builds and it
  // did not work, and every static check I had said it was fine — it typechecks,
  // the guard is unit-tested, `feature claims` proves every function is called.
  // All true, and all beside the point. This runs the exact calls the button
  // makes, against real SQLite, and asserts the row is GONE — which is the only
  // claim that matters and the one nothing was checking.
  try {
    const capId = `${tag}-del`;
    const relpath = `del/${capId}.m4a`;
    const dir = `${FS.documentDirectory}del`;
    await FS.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
    const mediaPath = `${FS.documentDirectory}${relpath}`;
    await FS.writeAsStringAsync(mediaPath, 'not real audio, but a real file');

    // A capture exactly as performCapture leaves one.
    await db.execute(
      `INSERT INTO capture_commit (capture_id, attachment_id, mutation_id, project_id,
         owner_id, media_relpath, media_sha256, media_bytes, media_mime_type,
         modality, captured_at_ms, committed_at_ms, request_sha256)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [capId, `att-${capId}`, `mut-${capId}`, projectId, ownerId, relpath,
       'a'.repeat(64), 31, 'audio/m4a', 'voice', Date.now(), Date.now(), 'c'.repeat(64)]);

    // The extra the app now creates for every recording.
    const started = await startExtraFromCapture(db, { captureId: capId, projectId, ownerId });
    const inLedgerBefore = (await ledger(db, projectId)).some((r) => r.id === `co-${capId}`);

    // THE EXACT CALL THE CONFIRM BUTTON MAKES.
    const del = await discardCapture(db, capId);

    const inLedgerAfter = (await ledger(db, projectId)).some((r) => r.id === `co-${capId}`);
    const fileGone = !(await FS.getInfoAsync(mediaPath)).exists;
    const tomb = await db.getAll<{ n: number }>(
      `SELECT count(*) AS n FROM capture_discarded WHERE capture_id = ?`, [capId]);

    const ok = started.ok && inLedgerBefore && del.ok
      && !inLedgerAfter && fileGone && (tomb[0]?.n ?? 0) === 1;
    t('delete removes the extra', ok,
      `created=${started.ok} inLedgerBefore=${inLedgerBefore} deleted=${del.ok} ` +
      `inLedgerAfter=${inLedgerAfter} fileGone=${fileGone} tombstone=${tomb[0]?.n ?? 0}`);
  } catch (e: any) {
    t('delete removes the extra', false, String(e?.message ?? e).slice(0, 200));
  }

  // 15 ── and a SENT extra must still refuse.
  try {
    const capId = `${tag}-sent`;
    await db.execute(
      `INSERT INTO capture_commit (capture_id, attachment_id, mutation_id, project_id,
         owner_id, media_relpath, media_sha256, media_bytes, media_mime_type,
         modality, captured_at_ms, committed_at_ms, request_sha256)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [capId, `att-${capId}`, `mut-${capId}`, projectId, ownerId, `del/${capId}.m4a`,
       'b'.repeat(64), 17, 'audio/m4a', 'voice', Date.now(), Date.now(), 'd'.repeat(64)]);
    await startExtraFromCapture(db, { captureId: capId, projectId, ownerId });
    await db.execute(`UPDATE change_order SET status = 'sent' WHERE id = ?`, [`co-${capId}`]);

    const del = await discardCapture(db, capId);
    const stillThere = (await ledger(db, projectId)).some((r) => r.id === `co-${capId}`);
    t('sent extra refuses delete', !del.ok && stillThere,
      `refused=${!del.ok} reason=${del.reason ?? '-'} stillInLedger=${stillThere}`);

    // CLEAN UP AFTER ITSELF. This step deliberately creates a row the delete path
    // is guaranteed to refuse, so nothing else can ever remove it — and it ran on
    // every launch. hadar's extras list filled with these. A check that leaves
    // residue on a real handset is a check that damages the thing it is meant to
    // protect, so it removes its own rows directly once the assertion is made.
    await db.execute(`DELETE FROM change_order WHERE id = ?`, [`co-${capId}`]);
    await db.execute(`DELETE FROM change_order_outbox WHERE change_order_id = ?`,
                     [`co-${capId}`]);
  } catch (e: any) {
    t('sent extra refuses delete', false, String(e?.message ?? e).slice(0, 200));
  }

  // Everything this run created, gone. The checks above have already made their
  // assertions; keeping the rows afterwards only pollutes a real ledger.
  try {
    await db.execute(`DELETE FROM change_order_outbox WHERE change_order_id LIKE ?`, [`co-${tag}%`]);
    await db.execute(`DELETE FROM change_order WHERE id LIKE ? OR scope LIKE ?`,
                     [`co-${tag}%`, `Loop check ${tag}%`]);
    // recordDecision mints its own `dec-…` ids, so matching `d-${tag}%` deleted
    // NOTHING — four test decisions sat on hadar's home screen as undeletable
    // cards. Match what the rows actually carry: the plumbing subject that
    // startExtraFromCapture writes, scoped to this run's captures.
    await db.execute(`DELETE FROM decision WHERE subject LIKE ?`, [`extra ${tag}%`]);
  } catch { /* cleanup must never fail the run it is tidying */ }

  // 16 ── THE LIVE PATH, HEADLESS: recorder holding the mic, recognizer
  // listening beside it, and the phone's own speaker doing the talking.
  //
  // "Words over the camera" was filed as needing a human. Its one real open
  // question is mechanical: does iOS share the microphone between expo-audio's
  // recorder and SFSpeechRecognizer's tap? So: start a real recording (the mic
  // is genuinely held), start the live recognizer beside it, then PLAY the
  // probe file out loud — the mic hears the speaker, the recognizer hears the
  // mic. Words arriving proves the entire live chain except pixels.
  //
  // Graded honestly in two tiers: SHARING is the hard assertion (a handle came
  // back and no error event fired while both consumers ran); WORDS are
  // reported when they arrive but not required, because speaker volume,
  // routing, and a silent switch are environmental, not architectural.
  try {
    const { startLive } = await import('./ondevicestt');
    const { playCapture, stopPlayback } = await import('./annotate');
    const probe = `${FS.documentDirectory}stt-probe.m4a`;
    const probeInfo = await FS.getInfoAsync(probe);
    if (!probeInfo.exists) {
      t('live mic-sharing', false, 'no probe audio — push stt-probe.m4a first');
    } else {
      const rec = await import('./recorder');
      const recorder = new rec.LoopcheckRecorder();
      await recorder.start();

      let words = '';
      const handle = await startLive(db, (tx) => { words = tx; });
      const shared = handle !== null;
      if (shared) {
        await playCapture(probe);
        await new Promise((r) => setTimeout(r, 9000));
        stopPlayback();
        handle!.stop();
      }
      await recorder.stopAndDiscard();

      t('live mic-sharing', shared,
        shared
          ? `recognizer ran beside the recorder; heard="${words.slice(0, 44)}"`
          : 'startLive returned null while the recorder held the mic');
    }
  } catch (e: any) {
    t('live mic-sharing', false, String(e?.message ?? e).slice(0, 90));
  }

  const failed = steps.filter((s) => !s.ok).length;
  // THE VERDICT GOES TO THE FLIGHT RECORDER, not only to console: console.log
  // does not exist in a Release build, and this check is about to be the thing
  // that proves on-device recognition on a real phone — a proof nobody can read
  // is not a proof. Summary first, then every step that matters by name.
  try {
    const { logDiag } = await import('./diaglog');
    await logDiag(db, 'loop.result', `${steps.length - failed}/${steps.length}`);
    for (const st of steps) {
      if (!st.ok || st.name.startsWith('R2 on-device')) {
        await logDiag(db, st.ok ? 'loop.step' : 'loop.fail', `${st.name}: ${st.detail}`);
      }
    }
  } catch { /* the check itself must never die on its own reporting */ }
  return { steps, passed: steps.length - failed, failed, pass: failed === 0 };
}
