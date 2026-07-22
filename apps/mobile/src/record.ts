/**
 * The extra record — PRD R6b.
 *
 * One screen that answers "what is this, who touched it, and where does it stand".
 *
 * THE RULE THIS FILE OBEYS: every actor and every timestamp here is read from a
 * stored column. Nothing is inferred. Where a fact is not stored, the line is
 * OMITTED — never filled in with a plausible substitute.
 *
 * That rule is written twice because the first version of this file broke it while
 * claiming to follow it (Codex challenge, 2026-07-21): it labelled `who_directed`
 * as "the approver", fell back to the signed-in user's profile name for "captured
 * by", and always attributed pricing to whoever is logged in now — so editing your
 * profile silently rewrote who priced a two-week-old record. None of those actor
 * facts are stored on the change order. They are gone; only real columns remain.
 *
 * TIME SEMANTICS, stated exactly because the first version got this wrong too:
 *   change_order.created_at_ms       = when the CHANGE ORDER was created, which is
 *                                      the moment the price was confirmed. It is
 *                                      NOT the capture moment.
 *   capture_commit.captured_at_ms    = the actual capture moment.
 * The record shows both, separately labelled. The ledger sorts by the former and
 * says "Created", which is now true.
 *
 * KNOWN GAP: `sent`, `delivered` and the signature TIME are not columns on the
 * local change_order — the confirmation row carries channel/delivery_state
 * server-side. Events we hold without a timestamp are rendered with an explicit
 * "time not recorded" marker and sorted last, never with an invented position.
 */
import { AbstractPowerSyncDatabase } from '@powersync/react-native';
import * as FS from 'expo-file-system/legacy';
import { createdLabel, money } from './changeorder';
import { getLang, t } from './i18n';

/** Hard caps. A ten-year job must not be able to hang the screen or blow SQLite's
 *  variable limit (SQLITE_MAX_VARIABLE_NUMBER, commonly 999). */
const MAX_CAPTURE_IDS = 200;
const MAX_PHOTOS_RENDERED = 24;

export type RecordPerson = {
  /** i18n key for the role. The role is what we stored, never a guess. */
  roleKey: string;
  name: string;
  when: string | null;
  kind: 'approver' | 'crew' | 'me';
};

/** `atMs` is null when the event is real but its time was never recorded. */
export type RecordEvent = { atMs: number | null; at: string; what: string; hot?: boolean };

export type RecordPhoto = {
  captureId: string;
  modality: string;
  at: string;
  uri: string;
  /** False when the file the row promises is not on this device. Never hidden. */
  present: boolean;
};

export type ExtraRecord = {
  id: string;
  title: string;
  status: string;
  /** Always present: change_order.amount_cents is NOT NULL. A `mini` change order
   *  is a SMALL one and still carries money — it is not R10's price-less Decision,
   *  which is a different entity that never arrives through ledger(). */
  amount: string;
  nte: string | null;
  isMini: boolean;
  /** When the change order was created = when the price was confirmed. */
  created: string;
  createdAtMs: number;
  /** The real capture moment, when a capture is linked. Null otherwise. */
  capturedAt: string | null;
  stateLineKey: string;
  stateLineParams?: Record<string, string>;
  people: RecordPerson[];
  description: string;
  photos: RecordPhoto[];
  /** True when photos were dropped by the render cap. */
  photosTruncated: number;
  history: RecordEvent[];
  synced: boolean;
};

function stateLine(status: string, signedBy: string | null, synced: boolean):
  { key: string; params?: Record<string, string> } {
  switch (status) {
    case 'draft':   return { key: synced ? 'erec.stDraft' : 'erec.stDraftLocal' };
    case 'sent':    return { key: 'erec.stSent' };
    case 'approved':
      return signedBy
        ? { key: 'erec.stApprovedBy', params: { name: signedBy } }
        : { key: 'erec.stApproved' };
    case 'declined':    return { key: 'erec.stDeclined' };
    case 'superseded':  return { key: 'erec.stSuperseded' };
    default:            return { key: 'erec.stSent' };
  }
}

function at(ms: number | null | undefined): string | null {
  return ms == null || ms <= 0 ? null : createdLabel(ms);
}

export async function extraRecord(
  db: AbstractPowerSyncDatabase, changeOrderId: string
): Promise<ExtraRecord | null> {
  const co = (await db.getAll<{
    id: string; decision_id: string; scope: string; amount_cents: number;
    nte_cents: number | null; is_mini: number; who_directed: string;
    numbers_confirmed_at_ms: number; status: string; signed_by: string | null;
    created_at_ms: number; pending: number;
  }>(
    `SELECT co.id, co.decision_id, co.scope, co.amount_cents, co.nte_cents, co.is_mini,
            co.who_directed, co.numbers_confirmed_at_ms, co.status, co.signed_by,
            co.created_at_ms,
            EXISTS (SELECT 1 FROM change_order_outbox o WHERE o.change_order_id = co.id) AS pending
       FROM change_order co WHERE co.id = ?`, [changeOrderId]))[0];
  if (!co) return null;

  const synced = !co.pending;

  const versions = await db.getAll<{
    value: string; capture_id: string | null; directed_by: string | null; created_at_ms: number;
  }>(
    `SELECT value, capture_id, directed_by, created_at_ms
       FROM decision_version WHERE decision_id = ? ORDER BY created_at_ms LIMIT ?`,
    [co.decision_id, MAX_CAPTURE_IDS]);

  // Evidence. The linkage is NOT decision_version.capture_id alone: a fused session
  // writes each photo as its own capture_commit row and ties them to the narration
  // through capture_pair. Walk the pair to reach the siblings.
  const captureIds = Array.from(
    new Set(versions.map((v) => v.capture_id).filter((x): x is string => !!x))
  ).slice(0, MAX_CAPTURE_IDS);

  let photos: RecordPhoto[] = [];
  let photosTruncated = 0;
  let capturedAtMs: number | null = null;

  if (captureIds.length) {
    const marks = captureIds.map(() => '?').join(',');
    const caps = await db.getAll<{
      capture_id: string; modality: string | null; captured_at_ms: number; media_relpath: string;
    }>(
      `SELECT DISTINCT cc.capture_id, cc.modality, cc.captured_at_ms, cc.media_relpath
         FROM capture_commit cc
        WHERE cc.capture_id IN (${marks})
           OR cc.capture_id IN (
                SELECT p2.capture_id FROM capture_pair p2
                 WHERE p2.pair_id IN (
                   SELECT p1.pair_id FROM capture_pair p1 WHERE p1.capture_id IN (${marks})
                 )
              )
        ORDER BY cc.captured_at_ms`,
      [...captureIds, ...captureIds]);

    // The real capture moment — the earliest committed capture behind this extra.
    if (caps.length) capturedAtMs = caps[0].captured_at_ms;

    const visual = caps.filter((c) => c.modality === 'photo' || c.modality === 'video');
    photosTruncated = Math.max(0, visual.length - MAX_PHOTOS_RENDERED);

    photos = await Promise.all(
      visual.slice(0, MAX_PHOTOS_RENDERED).map(async (c) => {
        const uri = FS.documentDirectory + c.media_relpath;
        // Mandate #1: evidence that is gone must SAY it is gone. A blank tile is
        // silent loss. We check existence only (not the sha256) — integrity is
        // readCapture()'s job and reading every file here would stall the screen.
        let present = false;
        try {
          const info = await FS.getInfoAsync(uri);
          present = !!info.exists;
        } catch { present = false; }
        return {
          captureId: c.capture_id, modality: c.modality ?? 'photo',
          at: createdLabel(c.captured_at_ms), uri, present,
        };
      })
    );
  }

  // ---- People: only roles we actually store -------------------------------
  const people: RecordPerson[] = [];
  // who_directed is REQ-VAL4 — recorded explicitly at capture, never inferred from
  // audio. It is who ASKED for the extra; calling them "the approver" was a guess.
  if (co.who_directed) {
    people.push({ roleKey: 'erec.directedBy', name: co.who_directed, when: null, kind: 'approver' });
  }
  if (co.signed_by) {
    people.push({ roleKey: 'erec.signedBy', name: co.signed_by, when: null, kind: 'approver' });
  }
  // No name is stored for who captured or who priced, so NOTHING is added to `people`
  // for them. Both events already appear in `history` below with their real
  // timestamps, which is where an event belongs.
  //
  // They used to be pushed here with the formatted timestamp in the `name` field
  // (2026-07-21, caught in review). The screen renders `people` as a roster: a bold
  // name line over an initials avatar. So an extra captured on the 20th listed, under
  // the heading "People", a person named "Jul 20 · 2:14 pm" with the initials "J2".
  // That is this file's own rule broken by the render — the header says these events
  // are attributed to nobody, and the roster put a nobody-shaped person on screen.
  // A field named `name` holding a date is the tell.
  const capturedLabel = at(capturedAtMs);

  // ---- History: chronological, with unstamped events last ------------------
  const stamped: RecordEvent[] = [];
  for (const v of versions) {
    const when = at(v.created_at_ms);
    if (!when) continue;
    stamped.push({
      atMs: v.created_at_ms, at: when,
      what: v.directed_by ? `“${v.value}” — ${v.directed_by}` : `“${v.value}”`,
    });
  }
  if (capturedAtMs) {
    stamped.push({ atMs: capturedAtMs, at: createdLabel(capturedAtMs), what: t('erec.capturedAt') });
  }
  if (co.created_at_ms > 0) {
    stamped.push({ atMs: co.created_at_ms, at: createdLabel(co.created_at_ms), what: t('erec.evCreated') });
  }
  if (co.numbers_confirmed_at_ms > 0) {
    stamped.push({
      atMs: co.numbers_confirmed_at_ms, at: createdLabel(co.numbers_confirmed_at_ms),
      what: t({ k: 'erec.evPriced', p: { amount: money(co.amount_cents) } } as any),
    });
  }
  stamped.sort((a, b) => (a.atMs ?? 0) - (b.atMs ?? 0));

  // Events we know happened but hold no time for. Marked, never given a fake slot.
  const unstamped: RecordEvent[] = [];
  const noTime = t('erec.noTime');
  if (co.status === 'sent') unstamped.push({ atMs: null, at: noTime, what: t('erec.evSent'), hot: true });
  if (co.signed_by) {
    unstamped.push({
      atMs: null, at: noTime,
      what: t({ k: 'erec.evSigned', p: { name: co.signed_by } } as any), hot: true,
    });
  }
  if (co.status === 'declined') unstamped.push({ atMs: null, at: noTime, what: t('erec.evDeclined'), hot: true });

  const line = stateLine(co.status, co.signed_by, synced);

  return {
    id: co.id,
    title: co.scope,
    status: co.status,
    amount: money(co.amount_cents),
    nte: co.nte_cents == null ? null : money(co.nte_cents),
    isMini: co.is_mini === 1,
    created: createdLabel(co.created_at_ms),
    createdAtMs: co.created_at_ms,
    capturedAt: capturedLabel,
    stateLineKey: line.key,
    stateLineParams: line.params,
    people,
    description: co.scope,
    photos,
    photosTruncated,
    history: [...stamped, ...unstamped],
    synced,
  };
}

/** Re-export so the screen renders in the reader's language without importing i18n
 *  twice. Mandate #5. */
export { getLang };
