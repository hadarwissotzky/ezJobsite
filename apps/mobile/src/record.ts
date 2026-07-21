/**
 * The extra record — PRD R6b.
 *
 * One screen that answers "what is this, who touched it, and where does it stand".
 * R6 already made the event timeline first-class; R6b is everything else the record
 * has to carry, because a timeline alone never answered *who recorded this* or
 * *what is owed next*.
 *
 * THE RULE THIS FILE OBEYS: every field here is read from a stored row. Nothing is
 * inferred, nothing is guessed, and where a fact is not stored we return null and the
 * screen omits the line — an empty slot is honest, an invented timestamp is not.
 * (Mandate #1's evidence chain is only worth anything if the reader can trust that
 * what is displayed is what was recorded.)
 *
 * KNOWN GAP, stated rather than papered over: `sent`, `delivered`, `opened` and the
 * signature *time* are not in local SQLite — they are produced server-side and today
 * only reach the device through the evidence bundle (`bundle.ts`, remote). So the
 * local history below covers capture → price-confirm → version chain → signed-by
 * (name, no time). Merging the remote delivery events into this history is the next
 * slice of R6, not something to fake here.
 */
import { AbstractPowerSyncDatabase } from '@powersync/react-native';
import * as FS from 'expo-file-system/legacy';
import { createdLabel, money } from './changeorder';

export type RecordPerson = {
  /** "Approver", "Captured by", "Priced by" — the role, not the name. */
  role: string;
  name: string;
  /** Rendered timestamp, or null when we do not store one for this role. */
  when: string | null;
  /** Colour intent for the avatar: who the person is to this record. */
  kind: 'approver' | 'crew' | 'me';
};

export type RecordEvent = { at: string; what: string; hot?: boolean };

export type RecordPhoto = {
  captureId: string;
  modality: string;
  at: string;
  /** On-device file URI, ready for <Image source={{uri}}>. */
  uri: string;
};

export type ExtraRecord = {
  id: string;
  title: string;
  status: string;
  /**
   * Always present: `change_order.amount_cents` is NOT NULL by schema, so every row
   * that reaches this screen is a priced Extra.
   *
   * NOT to be confused with R10's price-less **Decision** — that is a different
   * entity (the `decision` table) and never arrives through `ledger()`. `is_mini`
   * below is a *small* change order, and it still carries money; treating it as a
   * Decision would hide a real price from the person owed it.
   */
  amount: string;
  nte: string | null;
  isMini: boolean;
  created: string;
  createdAtMs: number;
  /** R6b item 2 — plain language: what is true now AND what is owed next. */
  stateLine: string;
  people: RecordPerson[];
  description: string;
  photos: RecordPhoto[];
  history: RecordEvent[];
  synced: boolean;
};

/**
 * R6b item 2. A chip is a label; this is the instruction. Every branch names the
 * next owed action, because "Sent" alone does not tell a contractor to go nudge.
 */
function stateLine(status: string, signedBy: string | null, synced: boolean): string {
  switch (status) {
    case 'draft':
      return synced
        ? 'Draft — not sent yet. Send it for approval.'
        : 'Draft, on this phone only — not sent yet. Send it for approval.';
    case 'sent':
      return 'Sent — waiting on approval. Remind them if it goes quiet.';
    case 'approved':
      return signedBy
        ? `Approved and signed by ${signedBy}. Nothing owed — you can bill it.`
        : 'Approved. Nothing owed — you can bill it.';
    case 'declined':
      return 'Declined — do not proceed with this work.';
    case 'superseded':
      return 'Superseded by a newer version. This one is history.';
    default:
      return status;
  }
}

/** A stored ms timestamp → the record's rendering, or null when absent. */
function at(ms: number | null | undefined): string | null {
  return ms == null || ms <= 0 ? null : createdLabel(ms);
}

/**
 * Assemble the record for one change order. `meName` is the signed-in user's own
 * name (profile) so "priced by" reads as a person rather than a UUID; when we have
 * no profile it degrades to "You", which is still true.
 */
export async function extraRecord(
  db: AbstractPowerSyncDatabase, changeOrderId: string, meName?: string | null
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

  // The append-only decision chain: the value history and who directed each change.
  const versions = await db.getAll<{
    value: string; capture_id: string | null; directed_by: string | null; created_at_ms: number;
  }>(
    `SELECT value, capture_id, directed_by, created_at_ms
       FROM decision_version WHERE decision_id = ? ORDER BY created_at_ms`,
    [co.decision_id]);

  // Evidence attached to this item.
  //
  // The linkage is NOT decision_version.capture_id alone. A fused capture session
  // writes each photo as its OWN capture_commit row and ties them to the narration
  // through `capture_pair` (pair_id, role='photo'|'voice'). So the chain's capture is
  // typically the VOICE one, and querying only it returns no pictures — which is
  // exactly why the record showed none. Walk the pair to reach the siblings.
  const captureIds = versions.map((v) => v.capture_id).filter((x): x is string => !!x);
  let photos: RecordPhoto[] = [];
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
    photos = caps
      .filter((c) => c.modality === 'photo' || c.modality === 'video')
      .map((c) => ({
        captureId: c.capture_id, modality: c.modality ?? 'photo',
        at: createdLabel(c.captured_at_ms),
        // The same path readCapture() resolves. We deliberately do NOT call
        // readCapture() here: it reads the whole file to recompute a sha256, which is
        // an integrity check, not a render path — doing it per tile would stall the
        // screen on a job with a dozen photos.
        uri: FS.documentDirectory + c.media_relpath,
      }));
  }

  // ---- People (R6b item 3) -------------------------------------------------
  // Only roles we actually store. `who_directed` is REQ-VAL4: recorded explicitly at
  // capture, never inferred from the audio — which is exactly why it is safe to name
  // someone here.
  const people: RecordPerson[] = [];
  if (co.who_directed) {
    people.push({ role: 'Approver — directed this extra', name: co.who_directed, when: null, kind: 'approver' });
  }
  if (co.signed_by && co.signed_by !== co.who_directed) {
    // Signature time is not stored locally (see the header note) — name only.
    people.push({ role: 'Signed by', name: co.signed_by, when: null, kind: 'approver' });
  }
  const firstDirected = versions.find((v) => v.directed_by)?.directed_by ?? null;
  const firstCapture = versions.find((v) => v.capture_id);
  if (firstCapture) {
    people.push({
      role: 'Captured on site',
      name: firstDirected && firstDirected !== co.who_directed ? firstDirected : (meName || 'You'),
      when: at(firstCapture.created_at_ms), kind: 'crew',
    });
  }
  people.push({
    role: 'Reviewed & priced',
    name: meName || 'You',
    // Mandate #6: the price was confirmed by a human at a known moment. That moment
    // is stored (numbers_confirmed_at_ms is NOT NULL by schema), so it is shown.
    when: at(co.numbers_confirmed_at_ms), kind: 'me',
  });

  // ---- History (R6b item 7) ------------------------------------------------
  const history: RecordEvent[] = [];
  const created = at(co.created_at_ms);
  if (created) history.push({ at: created, what: 'Extra created from the capture' });
  for (const v of versions) {
    const when = at(v.created_at_ms);
    if (!when) continue;
    history.push({
      at: when,
      what: v.directed_by ? `“${v.value}” — directed by ${v.directed_by}` : `“${v.value}”`,
    });
  }
  const confirmed = at(co.numbers_confirmed_at_ms);
  if (confirmed) {
    history.push({ at: confirmed, what: `Price confirmed by ${meName || 'you'} — ${money(co.amount_cents)}` });
  }
  if (co.status === 'sent') history.push({ at: '—', what: 'Sent for approval', hot: true });
  if (co.signed_by) history.push({ at: '—', what: `Signed by ${co.signed_by}`, hot: true });
  if (co.status === 'declined') history.push({ at: '—', what: 'Declined', hot: true });

  return {
    id: co.id,
    title: co.scope,
    status: co.status,
    amount: money(co.amount_cents),
    nte: co.nte_cents == null ? null : money(co.nte_cents),
    isMini: co.is_mini === 1,
    created: createdLabel(co.created_at_ms),
    createdAtMs: co.created_at_ms,
    stateLine: stateLine(co.status, co.signed_by, synced),
    people,
    description: co.scope,
    photos,
    history,
    synced,
  };
}
