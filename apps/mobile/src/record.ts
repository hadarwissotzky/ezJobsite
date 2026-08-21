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
 * KNOWN GAP, NARROWED (REQ-LC4): `delivered` is still not a column on the local
 * change_order — the confirmation row carries channel/delivery_state server-side.
 * The four state-change moments are: `sent_at_ms` / `approved_at_ms` /
 * `declined_at_ms` / `superseded_at_ms` are stamped write-once by the same guarded
 * UPDATE that moves the status, and this file READS them. It still renders the
 * "time not recorded" marker, because rows that moved before those columns existed
 * — and rows whose status arrived through `hydrateChangeOrders`, which deliberately
 * refuses to date a move it only learned about — genuinely have no time. Events we
 * hold without a timestamp are marked and sorted last, never given an invented
 * position.
 */
import { AbstractPowerSyncDatabase } from '@powersync/react-native';
import * as FS from 'expo-file-system/legacy';
import { createdLabel, money } from './changeorder';
import { augmentEventsFor } from './augmentlog';
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
export type RecordEvent = {
  atMs: number | null; at: string; what: string; hot?: boolean;
  /** WHICH state change this line is, as a stable marker rather than its words.
   *  Set only where a caller must be able to identify an event without matching a
   *  translated string — the sealed screen renders the signature from the FROZEN
   *  snapshot and must drop the timeline's copy of it, or the approval record shows
   *  two signature times for one signature. */
  kind?: 'signed';
};

export type RecordPhoto = {
  captureId: string;
  modality: string;
  at: string;
  uri: string;
  /** False when the file the row promises is not on this device. Never hidden. */
  present: boolean;
  /**
   * Mandate #9's other half — WHERE this was taken, as "37.77490, -122.41940", or
   * null when the phone had no fix.
   *
   * IT IS HERE BECAUSE ITS ABSENCE WAS A FALSE STATEMENT, not because the screen
   * wanted a nicer row. `capture_commit` has stored `gps_lat`/`gps_lng` all along
   * and this query did not select them, so `PhotosAndProof` was passed `null` for
   * every photo and printed "Where: No location was recorded" plus "N photos here
   * have no location saved" — under a heading that says the stamp is what makes the
   * photo proof. On the one screen whose job is proving the evidence, that told a
   * contractor in a dispute his own case was weaker than it is.
   *
   * Raw coordinates, not `describeStamp()`: that helper's no-fix branches return
   * baked English sentences, and this string goes on a bilingual screen. Numbers are
   * the same in both languages; the ABSENCE of numbers is rendered by the screen's
   * own localized key.
   */
  place: string | null;
};

/** The voice narration behind an extra — what the contractor said as it was
 *  captured. Displayed with its own metadata and played back on the record screen;
 *  the transcript is a derived convenience, this is the source. */
export type RecordVoice = {
  captureId: string;
  uri: string;
  /** Human "Jul 20 · 2:14 pm". */
  at: string;
  capturedAtMs: number;
  /** False when the audio file the row promises is not on this device (mandate #1). */
  present: boolean;
  /** The full spoken transcript for THIS clip, from voice_transcript_cache. Null when
   *  it has not been written down yet (offline, no STT, still processing). */
  transcript: string | null;
};

export type ExtraRecord = {
  id: string;
  title: string;
  status: string;
  /** `money()` renders '—' when no price was ever given: R2 takes the price from
   *  what the contractor SAID, and he may not have said one. That is a different
   *  fact from R10's price-less Decision (a distinct entity that never arrives
   *  through ledger()) and from a genuine zero. The comment here used to assert
   *  "always present: amount_cents is NOT NULL", which stopped being true in 370
   *  — left uncorrected it is the kind of doc that sends the next person to build
   *  on a guarantee that no longer exists. A `mini` change order is a SMALL one
   *  and still carries money. */
  amount: string;
  /** False when amount_cents is null — no price was ever given. The formatted
   *  `amount` renders '—' in that case, and a dash is a STRING: moneyBlock's
   *  null-check can never see it. This flag is what lets the screen say
   *  "No price given yet" instead of showing a dash posing as an amount
   *  (hadar, on device 2026-07-22). */
  priced: boolean;
  /**
   * 396 — WHAT HE SAID ABOUT COST, verbatim ("probably $1,800"), when no price has been
   * set yet. Null once `priced` is true: a quote under a confirmed figure is noise, and
   * worse, it invites a second reading of a number that is already decided.
   *
   * It is NOT a price and must never be rendered as one. Its only job is the read-back
   * mandate #6 requires: show the man his own words, show him the figure they parse to,
   * and let him tap. Nothing writes an amount without that tap.
   */
  priceHeard: string | null;
  nte: string | null;
  isMini: boolean;
  /** THIS EXTRA'S NUMBER ON ITS JOB — "Extra #4". Null on a row that predates the
   *  column and has not been backfilled yet; the kicker then omits the number rather
   *  than inventing one. */
  extraNo: number | null;
  /** The job this extra belongs to, for the header kicker (c5: "Extra · Miller —
   *  Hall Bath"). Null when the project row is not on this device. */
  jobName: string | null;
  /** When the change order was created = when the price was confirmed. */
  created: string;
  createdAtMs: number;
  /** The real capture moment, when a capture is linked. Null otherwise. */
  capturedAt: string | null;
  /** Where the earliest capture behind this extra was taken ("37.77490, -122.41940"),
   *  or null when the phone had no fix. Mandate #9's stamp, surfaced. */
  capturedPlace: string | null;
  stateLineKey: string;
  stateLineParams?: Record<string, string>;
  people: RecordPerson[];
  description: string;
  /**
   * 391 — the detailed client-facing SCOPE OF WORK, on its own.
   *
   * `title` is the short name; `description` is this plus any appended voice
   * augments. This field is the one the editor writes and the one `renderCard`
   * freezes into the instrument, so a screen that wants to show "what the client
   * signs" must render THIS and not `description`.
   */
  scopeOfWork: string;
  photos: RecordPhoto[];
  /** True when photos were dropped by the render cap. */
  photosTruncated: number;
  /** The voice narrations behind the extra, playable on the record screen, oldest
   *  first. The first is the original; the rest are voice notes ADDED later (hadar,
   *  2026-07-25 — "multiple voice notes"). Empty when the extra has no voice. */
  voices: RecordVoice[];
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

/** The GPS stamp as text, or null when the phone had no fix. Null is the SCREEN's
 *  cue to say so in the reader's language — this function never says it. */
function placeOf(c: { gps_lat: number | null; gps_lng: number | null }): string | null {
  return c.gps_lat != null && c.gps_lng != null
    ? `${c.gps_lat.toFixed(5)}, ${c.gps_lng.toFixed(5)}`
    : null;
}

export async function extraRecord(
  db: AbstractPowerSyncDatabase, changeOrderId: string
): Promise<ExtraRecord | null> {
  const co = (await db.getAll<{
    id: string; decision_id: string; scope: string; scope_of_work: string | null;
    summary: string | null;
    amount_cents: number | null;
    price_heard?: string | null;
    job_name: string | null;
    nte_cents: number | null; is_mini: number; who_directed: string;
    numbers_confirmed_at_ms: number; status: string; signed_by: string | null;
    created_at_ms: number; pending: number;
    sent_at_ms: number | null; approved_at_ms: number | null;
    declined_at_ms: number | null; superseded_at_ms: number | null;
    co_number: number | null;
  }>(
    `SELECT co.id, co.decision_id, co.scope, co.scope_of_work, co.summary,
            co.amount_cents, co.nte_cents, co.is_mini, co.price_heard,
            co.who_directed, co.numbers_confirmed_at_ms, co.status, co.signed_by,
            co.created_at_ms,
            co.sent_at_ms, co.approved_at_ms, co.declined_at_ms, co.superseded_at_ms,
            co.co_number,
            (SELECT p.name FROM project p WHERE p.id = co.project_id) AS job_name,
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
  let voices: RecordVoice[] = [];
  let capturedAtMs: number | null = null;
  let capturedPlace: string | null = null;

  if (captureIds.length) {
    const marks = captureIds.map(() => '?').join(',');
    /**
     * THIS DEVICE'S OWN CAPTURES, THEN THE ACCOUNT'S (hadar, 2026-08-21: "images not
     * displaying in the records" on a freshly signed-in phone).
     *
     * `capture_commit` holds only what THIS handset captured, so on a second phone, a
     * reinstall, or after a device handover the whole record rendered with no photos —
     * while they sat in Storage untouched. The second leg reads `capture_mirror`, the
     * account's captures pulled by `hydrateEvidence`, restricted to rows whose bytes
     * have actually been downloaded.
     *
     * `mirrored` rides along so the caller can tell the two apart. It matters for one
     * specific honesty reason, below at `present`.
     *
     * The mirror leg has no `capture_pair` hop because `capture_pair` is device-local
     * and has no server table at all — paired walkthrough siblings cannot be recovered
     * yet. Named in evidencemirror.ts rather than hidden here.
     */
    const caps = await db.getAll<{
      capture_id: string; modality: string | null; captured_at_ms: number; media_relpath: string;
      gps_lat: number | null; gps_lng: number | null; mirrored: number;
    }>(
      `SELECT capture_id, modality, captured_at_ms, media_relpath, gps_lat, gps_lng, mirrored
         FROM (
           SELECT DISTINCT cc.capture_id AS capture_id, cc.modality AS modality,
                  cc.captured_at_ms AS captured_at_ms, cc.media_relpath AS media_relpath,
                  cc.gps_lat AS gps_lat, cc.gps_lng AS gps_lng, 0 AS mirrored
             FROM capture_commit cc
            WHERE cc.capture_id IN (${marks})
               OR cc.capture_id IN (
                    SELECT p2.capture_id FROM capture_pair p2
                     WHERE p2.pair_id IN (
                       SELECT p1.pair_id FROM capture_pair p1 WHERE p1.capture_id IN (${marks})
                     )
                  )
           UNION ALL
           SELECT cm.capture_id, cm.modality, cm.captured_at_ms, cm.local_relpath,
                  cm.gps_lat, cm.gps_lng, 1
             FROM capture_mirror cm
            WHERE cm.local_relpath IS NOT NULL
              AND cm.capture_id IN (${marks})
              AND cm.capture_id NOT IN (SELECT capture_id FROM capture_commit)
         )
        ORDER BY captured_at_ms`,
      [...captureIds, ...captureIds, ...captureIds]);

    // The real capture moment — the earliest committed capture behind this extra.
    if (caps.length) {
      capturedAtMs = caps[0].captured_at_ms;
      capturedPlace = placeOf(caps[0]);
    }

    const visual = caps.filter((c) => c.modality === 'photo');
    photosTruncated = Math.max(0, visual.length - MAX_PHOTOS_RENDERED);

    photos = await Promise.all(
      visual.slice(0, MAX_PHOTOS_RENDERED).map(async (c) => {
        const uri = FS.documentDirectory + c.media_relpath;
        // Mandate #1: evidence that is gone must SAY it is gone. A blank tile is
        // silent loss. We check existence only (not the sha256) — integrity is
        // readCapture()'s job and reading every file here would stall the screen.
        //
        // A MIRRORED ROW IS ONLY EVER LISTED ONCE ITS BYTES ARE DOWNLOADED
        // (`local_relpath IS NOT NULL`), so a missing file here means the same thing
        // for both legs: it was on this phone and is not any more. That is why the
        // mirror is a separate table rather than rows in `capture_commit` — a cloud
        // capture this device has simply not fetched yet must NEVER be reported as
        // lost evidence, and here it is not reported at all until it is real.
        let present = false;
        try {
          const info = await FS.getInfoAsync(uri);
          present = !!info.exists;
        } catch { present = false; }
        return {
          captureId: c.capture_id, modality: c.modality ?? 'photo',
          at: createdLabel(c.captured_at_ms), uri, present, place: placeOf(c),
        };
      })
    );

    // EVERY voice behind the extra — the original plus any added later — each its
    // own playable clip (hadar, 2026-07-25). The voice IS the record (the transcript
    // is derived), so a voice note added to the extra gets a real player, not a
    // dead tile. Oldest first; `caps` is already ordered by captured_at_ms.
    const voiceCaps = caps.filter((c) => c.modality === 'voice');
    voices = await Promise.all(voiceCaps.map(async (vc) => {
      const uri = FS.documentDirectory + vc.media_relpath;
      let present = false;
      try { present = !!(await FS.getInfoAsync(uri)).exists; } catch { present = false; }
      // The full transcript for this clip. Read here so the detail can show WHAT WAS
      // SAID in full, not just the AI-condensed description. Missing = not written down
      // yet; the screen says so rather than showing an empty card.
      let transcript: string | null = null;
      try {
        const tr = (await db.getAll<{ text: string }>(
          `SELECT text FROM voice_transcript_cache WHERE capture_id = ?`, [vc.capture_id]))[0];
        transcript = tr?.text?.trim() || null;
      } catch { transcript = null; }
      return {
        captureId: vc.capture_id, uri, at: createdLabel(vc.captured_at_ms),
        capturedAtMs: vc.captured_at_ms, present, transcript,
      };
    }));
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
  // Additions made after the fact — "Added 2 photos", "Added a voice note" — the
  // explicit note the augment feature records (hadar, 2026-07-25). Timestamped, so
  // they sort into place with the rest. A hint, never load-bearing: its absence
  // never breaks the record. Fetched once and reused for the Description below.
  let augEvents: Awaited<ReturnType<typeof augmentEventsFor>> = [];
  try { augEvents = await augmentEventsFor(db, changeOrderId); }
  catch { augEvents = []; }
  for (const ev of augEvents) {
    stamped.push({
      atMs: ev.atMs, at: createdLabel(ev.atMs),
      what: ev.kind === 'photo'
        ? t({ k: 'erec.evAddedPhotos', p: { n: ev.n } } as any)
        : t('erec.evAddedVoice'),
    });
  }
  stamped.sort((a, b) => (a.atMs ?? 0) - (b.atMs ?? 0));

  // The state changes. Derived from STATUS, and status is a current state, not a
  // history. That distinction cost the record its most important line:
  // `co.status === 'sent'` was the only thing emitting "sent", so the moment a client
  // approved, status became 'approved' and the send DISAPPEARED from the timeline.
  // Every successfully approved extra -- the ones that end up in a dispute -- showed
  // created, priced, captured and signed, with no record that it was ever put in
  // front of the client at all.
  //
  // A terminal status is proof the thing was sent: nothing can be approved or declined
  // that was never delivered. So sent is inferred from the whole set, not from being
  // the current state. This is inference, which this file otherwise refuses to do, so
  // it is bounded to what the status ACTUALLY entails and no further.
  //
  // WHEN IS NOW A COLUMN, AND THE KNOWN GAP IN THE HEADER IS CLOSED FOR THESE FOUR.
  // REQ-LC4 added `sent_at_ms` / `approved_at_ms` / `declined_at_ms` /
  // `superseded_at_ms`, stamped write-once by the same guarded UPDATE that moves the
  // status (changeorder.ts, ledgerstatus.ts). They were being written and read by
  // nothing, so a sealed record still printed "TIME NOT RECORDED" under a signature
  // whose exact millisecond was sitting in the row beside it. A stamped event sorts
  // into the chronology with everything else; an UNSTAMPED one — a row that moved
  // before those columns existed, or that learned its status from a hydrate, which
  // deliberately refuses to invent a time — keeps the honest marker and sorts last.
  // Both cases still exist, so both are still rendered.
  const unstamped: RecordEvent[] = [];
  const noTime = t('erec.noTime');
  const push = (atMs: number | null | undefined, what: string, kind?: RecordEvent['kind']) => {
    const when = at(atMs);
    if (when) stamped.push({ atMs: atMs as number, at: when, what, hot: true, kind });
    else unstamped.push({ atMs: null, at: noTime, what, hot: true, kind });
  };
  const wasSent = co.status === 'sent' || co.status === 'approved'
    || co.status === 'declined' || co.status === 'superseded';
  if (wasSent) push(co.sent_at_ms, t('erec.evSent'));
  if (co.signed_by) {
    push(co.approved_at_ms, t({ k: 'erec.evSigned', p: { name: co.signed_by } } as any), 'signed');
  }
  if (co.status === 'declined') push(co.declined_at_ms, t('erec.evDeclined'));
  // The retirement was the one state change with no line at all on this screen — a
  // superseded extra showed "Sent" and then nothing, so the record could not say when
  // (or that) it stopped being the live version.
  if (co.status === 'superseded') push(co.superseded_at_ms, t('erec.evSuperseded'));
  // Re-sorted because `push` can add to `stamped` after the sort above.
  stamped.sort((a, b) => (a.atMs ?? 0) - (b.atMs ?? 0));

  const line = stateLine(co.status, co.signed_by, synced);

  // The "Summary of the change" the client reads (hadar, 2026-07-27): the AI's
  // owner-facing prose (`co.summary`, structure.ts `value`), grown append-only by each
  // voice added later. The title stays `co.scope`; the RAW transcript is shown
  // separately, in full, in the voice player — summary and transcript are both kept,
  // never one instead of the other.
  //
  // FALLS BACK TO THE TITLE when there is no summary yet — an extra recorded offline,
  // one the AI wasn't confident about, or an older extra from before this field — so
  // the section is never blank. The base is untouched after send (co.summary is
  // written draft-only); the addenda are append-only, which is how a SENT extra's
  // summary can still grow without editing the frozen instrument (mandate #5).
  const addenda = augEvents
    .filter((e) => e.kind === 'voice' && e.descText)
    .map((e) => e.descText as string);
  // 391 — THE SCOPE OF WORK IS THE SOURCE, not the summary. `description` is what the
  // draft screen renders under "SCOPE OF WORK (SENT TO CLIENT)", and that label was a
  // promise the code did not keep: it showed the AI summary while the client signed
  // `co.scope`, the title. Now the field displayed, edited, gated on and frozen is one
  // and the same. Falls back through summary then title so a pre-391 row reads as it did.
  const scopeOfWork = co.scope_of_work?.trim() || co.summary?.trim() || co.scope;
  const description = [scopeOfWork, ...addenda].join('\n\n');

  return {
    id: co.id,
    /** 391 — the detailed client-facing scope, WITHOUT the appended augments that
     *  `description` carries. The editor writes this; the instrument freezes it. */
    scopeOfWork,
    title: co.scope,
    status: co.status,
    amount: money(co.amount_cents),
    priced: co.amount_cents != null,
    priceHeard: co.amount_cents == null
      ? ((co as { price_heard?: string | null }).price_heard ?? null) : null,
    extraNo: co.co_number ?? null,
    jobName: co.job_name ?? null,
    nte: co.nte_cents == null ? null : money(co.nte_cents),
    isMini: co.is_mini === 1,
    created: createdLabel(co.created_at_ms),
    createdAtMs: co.created_at_ms,
    capturedAt: capturedLabel,
    capturedPlace,
    stateLineKey: line.key,
    stateLineParams: line.params,
    people,
    description,
    photos,
    photosTruncated,
    voices,
    history: [...stamped, ...unstamped],
    synced,
  };
}

/** Re-export so the screen renders in the reader's language without importing i18n
 *  twice. Mandate #5. */
export { getLang };
