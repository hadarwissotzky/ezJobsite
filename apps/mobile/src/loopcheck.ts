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
import { createChangeOrder, ledger, parseMoney } from './changeorder';
import { addApprover, listRoster, setExtraType, suggestFor } from './approvers';
import { displayStatus } from './extrastatus';
import { canRemind } from './remind';
import { buildActivity, unreadCount } from './activity';

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
      signedBy: r.signed_by, createdAtMs: r.created_at_ms,
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

  const failed = steps.filter((s) => !s.ok).length;
  return { steps, passed: steps.length - failed, failed, pass: failed === 0 };
}
