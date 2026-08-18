/**
 * STAGE 3 — the approved & locked extra. SPEC-extra-lifecycle-v1 §4 (REQ-LC30..34), D1, D6.
 *
 * WHAT THIS SCREEN IS FOR. Nothing on it is a task. The extra is sealed: no edit, no
 * delete, no supersede, no decline, no new thread messages, no status movement of any
 * kind (REQ-LC30). What is left is one job — being the artifact somebody opens two
 * years later when the owner says "I never agreed to that". So every element answers a
 * question a dispute raises: what exactly was agreed, by whom, when, and what proves it.
 *
 * THE SEAL IS STRUCTURAL, NOT POLITE. `ExtraLockedProps` has no `onEdit`, `onDelete`,
 * `onRevise`, `onRemind` or `onReply`. The guarantee is that the props to offer them do
 * not exist, so a later wiring change cannot re-open a signed record by passing one more
 * callback — a screen whose promise depends on the caller remembering is not a guarantee.
 *
 * WHAT COUNTS AS "AGREED", AND WHAT DOES NOT. The document section reads ONLY columns the
 * device freezes at send — `scope`, `amount_cents`, `nte_cents`, `billing_timing`,
 * `schedule_effect`, `schedule_days`, `exclusions` (`change_order_frozen`,
 * changeorder.ts:113-122). `rec.description` is deliberately NOT rendered: it is built
 * from `change_order.summary`, which is not in the frozen set and which REQ-LC43 rules
 * explicitly outside the instrument ("a derived reading aid, never the binding
 * instrument"). Putting it under the heading "what was agreed" would show a mutable,
 * contractor-side sentence in the place a signed term belongs — and it can still be
 * rewritten by an appended voice note after the signature.
 *
 * SILENCE IS ITSELF A TERM. D3 lets all four recommended fields through the send gate, so
 * an approved extra can legitimately be silent about the schedule, the billing, or what is
 * excluded. Those rows never render "Not set": an empty slot reads as an unfinished form,
 * and this form can never be finished. They render the fact instead — *the signed document
 * does not say*. In a dispute "he didn't fill it in" and "the agreement is silent on it"
 * are different claims, and only the second one is true of a sealed record.
 *
 * THE INSTRUMENT IS QUOTED, NEVER RE-DERIVED. The frozen snapshot block is
 * `RecordApproval` itself, reused rather than re-styled, because two renderings of the
 * binding text is two wordings of a legal document waiting to drift (the same reasoning
 * flowterms.ts gives for existing at all). Its verification state drives the alarm at the
 * top of this screen: a copy that does not hash to the frozen value is the single most
 * important thing this screen can say, so it is said ABOVE the green banner, not beneath
 * three sections of agreement.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ApprovalPanel } from '../eventlog';
import type { ExtraRecord, RecordEvent } from '../record';
import type { FlowTerms } from '../flowterms';
import { t } from '../i18n';
import { Icon, type IconName } from './icon';
import {
  APP_NAME, Button, MoneyBlock, Card, PersonRow, PhotoGrid, Row, ScreenHeader, Section, StatusBanner, SyncedPill,
  type PhotoTile,
} from './kit';
import { PeopleInvolved, rosterOf } from './peopleinvolved';
import { RecordApproval } from './recordapproval';
import { RecordingsCard } from './recordings';
import { ScopeBlock } from './scopeblock';
import { C, F, T, label as labelStyle, money as moneyStyle, tint, type Tone } from './theme';
import { radii, shadows, touchTargets } from './tokens';

export type ExtraLockedProps = {
  /** The sealed record. Only its FROZEN fields are presented as agreed terms — see the
   *  header. `photos` fill the evidence grid; `description` is never shown here. */
  rec: ExtraRecord;
  /** The four flow terms, straight off the frozen columns (375_flow_fields). They are
   *  terms of the instrument (REQ-LC41) and they are not on `ExtraRecord`, so they come
   *  in explicitly rather than being re-derived from anything mutable. */
  agreed: FlowTerms;
  /** The frozen instrument and whether THIS device's copy still hashes to it
   *  (`snapshotVerifies`). Null when the timeline has never reached this phone — which
   *  the screen says out loud, because a locked record with no instrument on it is a
   *  fact the reader needs, not a section to quietly leave out. */
  approval: ApprovalPanel | null;
  /** The steps that LED to the approval — created, sent — as record.ts produced them
   *  (`atMs: null` means the time was never recorded and is said, never invented).
   *  Do NOT include the approval itself: this screen renders that step from the frozen
   *  snapshot, which is the only copy of it that carries a real signed time. The whole
   *  history is one button away and does not belong inside the approval record. */
  chain: readonly RecordEvent[];
  /** The single required approver (D4). Null when no approver is stored — then nothing
   *  is shown, never a placeholder person (record.ts's rule). */
  approver: { name: string; role?: string; photoUri?: string | null } | null;
  /** Everyone else on the record — who captured it, who priced it, who was added.
   *  Same prop and same source as the negotiation screen; this screen had no people
   *  section at all before 2026-08-14 and so never asked for them. Read-only here:
   *  a sealed record's roster is history, and nothing may be appended (REQ-LC30). */
  contributors?: readonly { name: string; role?: string; photoUri?: string | null }[];
  /** What the approver typed back with their answer, when they typed anything. */
  approverNote?: string | null;
  /** Which version this row is (1 = the original), derived from the lineage. */
  version?: number;
  /** The context line above the title — "Extra · Miller — Hall Bath". Same prop and
   *  same position as the other two stage screens; this screen used to smuggle it
   *  into the back control instead. */
  kicker: string;
  onBack: () => void;
  /** Open the signed approval document — the server's copy, which is the one that
   *  outranks anything this device holds. */
  onViewSignedApproval: () => void;
  onViewFullHistory: () => void;
  /** Open the version history ("Current version: V2 → View previous versions"). Optional;
   *  falls back to full history until a versions screen exists. */
  onViewVersions?: () => void;
  /** Open the conversation that led to approval. Optional; falls back to full history. */
  onViewConversation?: () => void;
  /** D6 / REQ-LC31: start a NEW INDEPENDENT extra linked to this one by origin. It must
   *  not edit, supersede or amend this record. The button says so on screen too — a rule
   *  that lives only in a comment is a rule the person tapping never learns. */
  onCreateLinkedExtra: () => void;
  /**
   * Open one photo full-screen. It is NOT an edit and it is not an exception to the
   * seal: the lightbox is read-only and `RecordScreen` owns the one instance.
   *
   * It is here because dropping it was a real loss on the one screen that exists for
   * a dispute — at HEAD every photo on every status was tappable, and this screen
   * shipped 86pt thumbnails you cannot enlarge. "What exactly was agreed" is not
   * answerable from a thumbnail. Optional, so a caller with no viewer renders plain
   * tiles rather than a control that does nothing.
   */
  onPressPhoto?: (uri: string) => void;
  /** DEV ONLY (__fixturelocked): scroll to Y after mount for screenshots. */
  _fixtureScrollY?: number;
};

export function ExtraLockedScreen(props: ExtraLockedProps) {
  const { rec, agreed } = props;
  const snap = props.approval?.snapshot ?? null;

  // The approval line is composed from the FROZEN snapshot only. The approver prop names
  // who was entitled to sign (D4); it is not evidence of who did, so it is never
  // substituted in here when the signed name is missing.
  const detail = snap?.signedName && snap.signedAt
    ? t({ k: 'elock.approvedOnBy', p: { when: snap.signedAt, name: snap.signedName } })
    : snap?.signedName ? t({ k: 'elock.approvedBy', p: { name: snap.signedName } })
    : snap?.signedAt ? t({ k: 'elock.approvedOn', p: { when: snap.signedAt } })
    : t('elock.approvedNoDetail');

  const photos: PhotoTile[] = rec.photos.map((p) => ({
    key: p.captureId, uri: p.uri, present: p.present,
  }));

  const schedule = scheduleTerm(agreed);
  const billing = billingTerm(agreed);
  const excluded = agreed.exclusions?.trim() ?? '';
  const lockScroll = React.useRef<ScrollView>(null);
  React.useEffect(() => {
    if (props._fixtureScrollY != null) lockScroll.current?.scrollTo({ y: props._fixtureScrollY, animated: false });
  }, [props._fixtureScrollY]);

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <ScrollView ref={lockScroll} contentContainerStyle={{ padding: 18, paddingTop: 0, paddingBottom: 48 }}>
        {/* The job used to ride INSIDE the back control here, because ScreenHeader
            had no kicker slot — so this screen's back button read "‹ 1151 Stanyan St"
            while the other two read "‹ Job". Same missing prop, a third workaround.
            The job belongs in the kicker, where it names the thing you are reading;
            the back control names where the tap goes. */}
        {/* THE HEADER SLAB — the same three surfaces as the negotiation screen
            (hadar, 2026-08-14). What this is, what it cost and where it stands are one
            region, closed by a rule and a shadow; the record below sits under it in
            plain cards. The seal and the lock strip belong INSIDE it: they are the
            state of the extra, not content about it. */}
        <View style={st.headerSlab}>
        <ScreenHeader
          title={rec.title}
          kicker={props.kicker}
          // GATED, like both sibling screens. It was unconditional: an approved record
          // that had never reached the server still displayed "Synced" — a specific
          // false claim about whether the signed record exists anywhere but this
          // handset, on the one screen built for a dispute (mandate #1).
          kickerRight={rec.synced ? <SyncedPill label={t('neg.synced')} /> : undefined}
          navTitle={t('erec.navTitle')}
          onBack={props.onBack}
          backLabel={t('erec.back')}
        />

        {!rec.synced && (
          <Text style={[T.bodySteel, { fontSize: 12, marginTop: 6 }]}>{t('erec.onPhone')}</Text>
        )}

        {rec.priced ? (
          <MoneyBlock
            amount={rec.amount}
            subtitle={`${rec.nte ? t({ k: 'erec.nte', p: { amount: rec.nte } }) : t('erec.fixed')}`
              + `${rec.isMini ? ` · ${t('erec.mini')}` : ''} · ${t('erec.yourPrice')}`}
          />
        ) : (
          // Never "—" and never "no cost change": one is a dash posing as an amount, the
          // other tells the reader the work was free. What is true is narrower than both.
          <MoneyBlock amount={t('elock.noAmount')} muted />
        )}

        {/* ABOVE the green banner on purpose. Both of these say the reader cannot trust
            the wording further down this screen, and a warning placed after three
            sections of agreement is a warning that arrives too late to stop the reading
            it exists to stop. */}
        {snap && !snap.verified && (
          <Notice tone="danger" icon="failed"
            title={t('elock.snapBadTitle')} body={t('elock.snapBadBody')} />
        )}
        {!snap && (
          <Notice tone="caution" icon="offline"
            title={t('elock.snapMissingTitle')} body={t('elock.snapMissingBody')} />
        )}

        {/* ONE solid block, not a divided card: a filled check disc on the left, the
            title beside it, and the approval lines tight underneath — the design's
            shape. The shared StatusBanner splits title/detail with a rule, which is
            right for the negotiation stage and wrong here. */}
        <View style={st.sealBanner}>
          <View style={st.sealDisc}>
            <Icon name="check" size={20} color={C.raised} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={st.sealTitle}>{t('elock.signedApproved')}</Text>
            <Text style={st.sealLine}>{detail}</Text>
          </View>
        </View>

        {/* Compact lock strip: icon + two quiet lines, no bold heading — the design
            states the fact, it does not shout it. */}
        <View style={st.lockStrip}>
          <Icon name="lock" size={20} color={C.ink} />
          <View style={{ flex: 1 }}>
            <Text style={st.lockLine}>{t('elock.lockedTitle')}</Text>
            <Text style={st.lockLine}>{t('elock.lockedBody')}</Text>
          </View>
        </View>

        </View>

        {/* The two "views" that led to the seal — conversation + signature. */}
        <Card style={st.navCard}>
          <Row
            icon="message"
            label={t('elock.convTitle')}
            sub={t('elock.convBody')}
            chevron
            divider
            onPress={props.onViewConversation ?? props.onViewFullHistory}
          />
          <Row
            icon="edit"
            label={t('elock.sigTitle')}
            sub={t('elock.sigBody')}
            chevron
            onPress={props.onViewSignedApproval}
          />
        </Card>

        {/* WHO IS ON THIS — the same section, in the same slot, as the other two stages
            (hadar, 2026-08-14: "the people section needs to be the same in all 3
            stages, same location, looks the same").
            It was ABSENT here. The sealed record — the one screen that exists to settle
            a dispute — was the only stage that could not answer "who agreed to this and
            who else is on it", while both stages where the answer can still change
            showed it plainly. The seal is a reason to make it READ-ONLY, which it is
            (no add row, no ✕ — REQ-LC30), not a reason to delete the question. */}
        <PeopleInvolved people={rosterOf(props.approver, props.contributors)} />

        {/* What was agreed — a plain card of rows (no section header). Scope/included/
            excluded open the signed document; the flow terms show their agreed value. */}
        <Card style={st.card12}>
          {/* 391 — THE AGREED SCOPE, ON THE SCREEN. This was a row reading "Show
                more" that opened the signed PDF: on the one screen built to settle a
                dispute, the agreed scope was the single thing you could not read
                without leaving it. Legitimate here now and not before — `scope_of_work`
                is in change_order_guard's frozen set on BOTH sides (391), so it meets
                this file's own rule that nothing outside the frozen columns may appear
                under "what was agreed". `description` is still excluded, for the reason
                the header gives: it is built from `summary`, which is mutable. */}
            <ScopeBlock text={props.rec.scopeOfWork} stage="signed" />
          {/* SAME ROWS, SAME ORDER, SAME WORDS AS THE NEGOTIATION SCREEN (hadar,
              2026-08-14: "the sequence of the information needs to be the same").
              Approving an extra used to reshuffle its own document: exclusions jumped
              from last to third, photos from third to fourth, and four of the five
              labels changed wording on the way ("Impact on schedule" → "Schedule
              impact", "What's not included" → "Not included"). Nothing about the
              record changed — only the screen — so a contractor comparing what he sent
              against what was signed was comparing two differently-ordered documents.
              The `neg.row*` keys are shared for exactly that reason: one vocabulary per
              thing, across all three stages. */}
          <Row
            icon="cost"
            label={t('neg.rowCost')}
            value={rec.priced
              ? `${rec.amount.replace(/\.00\b/, '')} · ${rec.nte ? t({ k: 'erec.nte', p: { amount: rec.nte } }) : t('erec.fixed')}`
              : t('elock.noAmount')}
            chevron
            divider
            onPress={props.onViewSignedApproval}
          />
          <Row
            icon="image"
            label={t('neg.rowPhotos')}
            value={photos.length > 0
              ? t({ k: 'neg.photosN', p: { n: photos.length } })
              : t('elock.photosNone')}
            chevron={photos.length > 0}
            divider
            onPress={photos.length > 0 && props.onPressPhoto
              ? () => props.onPressPhoto?.(photos[0].uri) : undefined}
          />
          {photos.length > 0 && (
            <View style={{ marginLeft: 36, marginTop: 10, marginBottom: 12 }}>
              <PhotoGrid
                photos={photos}
                missingLabel={t('erec.evidenceMissing')}
                onPressPhoto={props.onPressPhoto
                  ? (photo) => props.onPressPhoto?.(photo.uri) : undefined}
                tileSize={62}
              />
            </View>
          )}
          <Row
            icon="calendar"
            label={t('neg.rowSchedule')}
            value={schedule.text}
            divider
          />
          <Row
            icon="payment"
            label={t('neg.rowBilling')}
            value={billing.text}
            divider
          />
          {/* What is IN and what is OUT, adjacent — they are one question asked twice.
              "Included" has no counterpart on the negotiation screen because there is
              no signed document to open there; it sits beside Exclusions rather than
              displacing a row the other stage also has. */}
          <Row
            icon="checklist"
            label={t('elock.rowIncluded')}
            value={t('draft.showMore')}
            chevron
            divider
            onPress={props.onViewSignedApproval}
          />
          <Row
            icon="excluded"
            label={t('neg.rowExclusions')}
            value={excluded ? t('draft.showMore') : t('elock.exclNone')}
            chevron
            onPress={props.onViewSignedApproval}
          />
        </Card>

        {/* THE ORIGINAL RECORDINGS, on the one screen built for a dispute. Listening
            is not editing, so this is no exception to the seal — and "what exactly was
            agreed" is not answerable from a summary when the audio is the record. */}
        <RecordingsCard voices={rec.voices} />

        <Section title={t('elock.recordTitle')}>
          {/* No separate approver row: the design's record starts straight at
              "Approved by <name>". The first step names the approver; a person row
              above it repeated her. Newest first — approval is the newest event. */}
          <ApprovalStep
            what={snap?.signedName
              ? t({ k: 'elock.stepApproved', p: { name: snap.signedName } })
              : t('elock.stepApprovedUnknown')}
            at={snap?.signedAt ?? t('erec.noTime')}
            note={props.approverNote}
          />
          {newestFirst(props.chain).map((e, i) => (
            <ApprovalStep key={`${e.atMs ?? 'x'}-${i}`} what={e.what} at={e.at} />
          ))}
        </Section>

        {/* VERSION — LAST (hadar, 2026-08-12: "move the version section to the bottom,
            the same it is in negotiation"), moved down from directly under the lock
            strip.

            It used to be the third thing on a sealed record, so the first fact after
            "Signed and approved" was "Version 1 · Original" — a line that says NOTHING
            HAS HAPPENED, sitting above the terms that were agreed, the recordings, and
            the signature chain. Same misjudgement the negotiation screen already
            corrected on 2026-08-09, and it reads worse here: on the one screen built to
            settle a dispute, provenance is what you check AFTER you have read what was
            agreed and who signed it, not before.

            One section further down than negotiation's, because on a sealed record the
            approval chain IS the payload — the reason the screen was opened — and
            nothing should push it below the fold. */}
        <Card style={st.navCard}>
          {/* The REAL version, from the supersession lineage. A v1 record says
              "Original" and offers no link — a chevron to a list of previous versions
              that do not exist is a control that cannot work. */}
          <Row
            icon="layers"
            label={t({ k: 'elock.currentVersion', p: { n: props.version ?? 1 } })}
            value={(props.version ?? 1) > 1 ? t('elock.viewPrevious') : t('elock.noPrevious')}
            chevron={(props.version ?? 1) > 1}
            onPress={(props.version ?? 1) > 1
              ? (props.onViewVersions ?? props.onViewFullHistory) : undefined}
          />
        </Card>

        {/* The frozen instrument stays ONLY as the verification alarm when this
            device's copy does not hash to the signed value — that is load-bearing
            evidence and must never hide behind a tap. When it verifies, the full
            snapshot lives behind "View signed approval" (the design keeps the sealed
            screen to the record + the actions, not the instrument inline). */}
        {snap && !snap.verified && <RecordApproval approval={props.approval ?? null} />}

        {/* Three OUTLINE actions, stacked, matching the design. "Create another extra"
            is D6 — a NEW independent extra, not an amendment — and the copy under it
            says so; but it is one of the three buttons, not a boxed-off card. */}
        <View style={st.actions}>
          <Button label={t('elock.viewApproval')} icon="doc" variant="neutral"
            onPress={props.onViewSignedApproval} />
          <Button label={t('elock.viewConversation')} icon="message" variant="neutral"
            onPress={props.onViewConversation ?? props.onViewFullHistory} style={{ marginTop: 10 }} />
          <Button label={t('elock.viewHistory')} icon="clock" variant="neutral"
            onPress={props.onViewFullHistory} style={{ marginTop: 10 }} />
          <Button label={t('elock.another')} icon="extra" variant="neutral"
            onPress={props.onCreateLinkedExtra} style={{ marginTop: 10 }} />
        </View>
      </ScrollView>
    </View>
  );
}

/* ------------------------------------------------------------------ the terms -- */

/** A stated term, or the honest statement that the document is silent on it. */
type TermValue = { text: string; stated: boolean };

/**
 * The schedule term as the signer would read it. An UNRECOGNISED value falls through to
 * "not stated" — the same rule flowterms.ts applies when it renders the instrument: a
 * guessed sentence in a signed document is worse than an absent one, because the absent
 * one is visibly absent.
 */
function scheduleTerm(a: FlowTerms): TermValue {
  switch (a.scheduleEffect) {
    case 'no_change': return { text: t('elock.schedNoChange'), stated: true };
    case 'adds_days':
      return typeof a.scheduleDays === 'number' && a.scheduleDays > 0
        ? {
            text: t({
              k: a.scheduleDays === 1 ? 'elock.schedAddsDay' : 'elock.schedAddsDays',
              p: { n: a.scheduleDays },
            }),
            stated: true,
          }
        : { text: t('elock.schedAddsDaysUnknown'), stated: true };
    case 'not_sure': return { text: t('elock.schedNotSure'), stated: true };
    default: return { text: t('elock.schedNone'), stated: false };
  }
}

function billingTerm(a: FlowTerms): TermValue {
  switch (a.billingTiming) {
    case 'next_invoice': return { text: t('elock.billNextInvoice'), stated: true };
    case 'when_completed': return { text: t('elock.billWhenCompleted'), stated: true };
    case 'other': return { text: t('elock.billOther'), stated: true };
    default: return { text: t('elock.billNone'), stated: false };
  }
}

function Term({ title, icon, children }: {
  title: string;
  /** The same glyph the draft and negotiation screens give this term. A sealed
   *  record is the one place a reader arrives cold, months later — the icon is how
   *  "Payment timing" is found by eye rather than by reading five headings. */
  icon?: IconName;
  children: React.ReactNode;
}) {
  return (
    <View style={st.term}>
      <View style={st.termHead}>
        {icon && <Icon name={icon} size={16} color={C.steel} />}
        <Text style={labelStyle}>{title}</Text>
      </View>
      <View style={{ marginTop: 6 }}>{children}</View>
    </View>
  );
}

/**
 * `stated: false` is the document's silence, and it reads quieter than a term — steel,
 * not ink. It is deliberately NOT tinted with `caution`: an amber box would frame a
 * lawful outcome of D3 as an unfinished field, on a record where nothing can ever be
 * finished.
 */
function TermText({ text, stated }: { text: string; stated: boolean }) {
  if (!stated) return <Text style={st.silent}>{text}</Text>;
  return <LongText text={text} />;
}

/**
 * Collapsed body text with Show more.
 *
 * `numberOfLines` is applied ONLY once the text is long enough to be worth collapsing,
 * so the heuristic fails safe in the direction that matters: guess too low and the term
 * renders in full with a redundant toggle; guess too high and it would be TRUNCATED with
 * no way to open it, which on this screen means an agreed term hidden from the person
 * relying on it.
 */
const LONG_TEXT_CHARS = 240;
const COLLAPSED_LINES = 5;

function LongText({ text }: { text: string }) {
  const [open, setOpen] = React.useState(false);
  const long = text.length > LONG_TEXT_CHARS;
  return (
    <>
      {/* NOT `selectable` (hadar, 2026-08-18: "when I get into an approved change order
          I cannot scroll anymore in the page").

          On iOS a selectable <Text> becomes a first responder and swallows the pan that
          starts on it. On this screen that text IS the frozen scope of work — on a real
          record here it runs to fourteen hundred characters — so it fills the viewport,
          every drag begins on it, and the page simply stops scrolling. The draft and
          negotiation screens were unaffected because neither renders the whole
          instrument.

          Copy-to-clipboard mattered on the one screen that settles disputes, so it is
          not being dropped — it moves to the explicit button below, which is also the
          better control for a gloved hand than a long-press-and-drag selection. */}
      <Text style={T.body} numberOfLines={long && !open ? COLLAPSED_LINES : undefined}>
        {text}
      </Text>
      {long && (
        <Pressable
          onPress={() => setOpen((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={t(open ? 'elock.showLess' : 'elock.showMore')}
          style={st.more}
        >
          <Text style={st.moreT}>{t(open ? 'elock.showLess' : 'elock.showMore')}</Text>
          {/* The caret follows the state, like every other expandable on the record. */}
          <Text style={st.moreCaret}>{open ? '⌃' : '⌄'}</Text>
        </Pressable>
      )}
    </>
  );
}

/* --------------------------------------------------------- the approval record -- */

/**
 * One completed step of the evidence chain, marked with a check.
 *
 * Deliberately not `TimelineRow`: that primitive draws a dot on a rail, which reads as an
 * open chronology ("and then…"). Every step here is finished and evidenced, and the check
 * is the mockup's mark for exactly that. Flagged for the kit owner rather than smuggled —
 * if a `done` variant lands in `kit.tsx`, this should become it.
 */
function ApprovalStep({ what, at, note }: {
  what: string;
  /** Already formatted, or the caller's "time not recorded" marker. Never invented. */
  at: string;
  note?: string | null;
}) {
  return (
    <View style={st.step}>
      <Icon name="approved" size={20} color={C.steel} />
      <View style={{ flex: 1 }}>
        <Text style={st.stepWhat}>{what}</Text>
        <Text style={st.stepAt}>{at}</Text>
        {note?.trim() ? <Text style={st.stepNote} selectable>{`“${note.trim()}”`}</Text> : null}
      </View>
    </View>
  );
}

/**
 * Newest first — but events with no recorded time stay LAST.
 *
 * record.ts appends them last rather than inventing a position, and a plain `.reverse()`
 * would promote them to the top of a reverse-chronological list, where they would read as
 * the most recent thing that happened. The ordering rule survives the reversal.
 */
function newestFirst(events: readonly RecordEvent[]): RecordEvent[] {
  const stamped = events.filter((e) => e.atMs !== null);
  const unstamped = events.filter((e) => e.atMs === null);
  stamped.sort((a, b) => (b.atMs as number) - (a.atMs as number));
  return [...stamped, ...unstamped];
}

/* ----------------------------------------------------------------- the notices -- */

/**
 * A tinted notice that is NOT a lifecycle state.
 *
 * `StatusBanner` is the kit's state box and its tone and icon are fixed per
 * `displayStatus` value, which is right — but the three things this screen must say
 * ("locked", "the wording is not on this phone", "this copy does not match") are
 * properties of the EVIDENCE, not of the extra's status. Reaching for `kind="declined"`
 * to borrow its red would put a false status on a screen whose whole job is being
 * accurate about status. Same tokens, no fork of the banner. Kit gap, reported.
 */
function Notice({ tone, icon, title, body }: {
  tone: Tone; icon: IconName; title: string; body: string;
}) {
  const c = tint(tone);
  return (
    <View style={[st.notice, { backgroundColor: c.soft, borderColor: c.line }]}>
      <Icon name={icon} size={22} color={c.ink} />
      <View style={{ flex: 1 }}>
        <Text style={[st.noticeTitle, { color: c.ink }]}>{title}</Text>
        <Text style={[st.noticeBody, { color: c.ink }]}>{body}</Text>
      </View>
    </View>
  );
}

/* -------------------------------------------------------------------- styles -- */

const st = StyleSheet.create({
  // Full-bleed (the page pads 18 and this cancels it), closed by a hairline and a
  // shadow so the record below reads as UNDER the header rather than next in a list.
  // Same values as the negotiation screen's — one header, three stages.
  headerSlab: {
    backgroundColor: C.card,
    marginHorizontal: -18, paddingHorizontal: 18, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: C.line,
    ...shadows.card,
  },
  moneyRow: {
    flexDirection: 'row', alignItems: 'baseline',
    gap: 9, marginTop: 10, marginBottom: 14, flexWrap: 'wrap',
  },
  money: { ...moneyStyle, fontSize: 34, color: C.ink },
  noAmount: { ...moneyStyle, fontSize: 20, color: C.steel, marginTop: 10, marginBottom: 14 },

  notice: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    borderRadius: radii.md, borderWidth: 1, padding: 14, marginBottom: 10,
  },
  noticeTitle: {
    fontFamily: F.bodyBold, fontSize: 15.5, lineHeight: 20, letterSpacing: 0.1,
  },
  noticeBody: { fontFamily: F.body, fontSize: 14.5, lineHeight: 20, marginTop: 4 },

  termHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  term: { marginBottom: 16 },
  silent: { fontFamily: F.body, fontSize: 15, color: C.steel, lineHeight: 21 },
  truncated: { ...T.bodySteel, fontSize: 12, marginTop: 8 },
  more: {
    minHeight: touchTargets.minimum, justifyContent: 'center',
    alignSelf: 'flex-start', paddingRight: 24,
    flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  moreT: { fontFamily: F.bodySemi, fontSize: 15, color: C.ink },
  moreCaret: { fontFamily: F.body, fontSize: 13, color: C.ink },

  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 8 },
  stepWhat: { fontFamily: F.bodySemi, fontSize: 15.5, color: C.ink, lineHeight: 21 },
  stepAt: {
    fontFamily: F.dispSemi, fontSize: 11.5, letterSpacing: 1,
    textTransform: 'uppercase', color: C.steel, marginTop: 2,
  },
  stepNote: {
    fontFamily: F.body, fontSize: 14.5, color: C.inkSoft, lineHeight: 21, marginTop: 6,
  },

  // The sealed banner — one solid block, icon left, lines tight under the title.
  sealBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: C.brandSoft, borderWidth: 1, borderColor: C.brandLine,
    borderRadius: 12, padding: 13, marginTop: 12,
  },
  sealDisc: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: C.brand,
    alignItems: 'center', justifyContent: 'center',
  },
  sealTitle: {
    fontFamily: F.disp, fontSize: 21, color: C.brand,
    textTransform: 'uppercase', letterSpacing: 0.6,
  },
  sealLine: { fontFamily: F.body, fontSize: 13.5, color: C.ink, lineHeight: 19, marginTop: 2 },
  // The lock strip — quiet, two lines, no heading weight.
  lockStrip: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: C.surfaceMuted, borderWidth: 1, borderColor: C.line,
    borderRadius: 12, padding: 13, marginTop: 8,
  },
  lockLine: { fontFamily: F.body, fontSize: 13.5, color: C.ink, lineHeight: 19 },
  // The nav rows (version / conversation / signature) — squarer, tighter cards.
  navCard: { borderRadius: 12, marginTop: 8, marginBottom: 0, paddingVertical: 2 },
  // One consistent card radius across the screen (was 18 via T.card, more rounded than
  // the design's ~12).
  card12: { borderRadius: 12, marginTop: 8, marginBottom: 0 },
  recordLabel: { marginTop: 14, marginBottom: 6 },
  actions: { marginTop: 18, gap: 10 },
  followTitle: { fontFamily: F.bodyBold, fontSize: 17, color: C.ink, letterSpacing: -0.2 },
  followBody: { fontFamily: F.body, fontSize: 14.5, color: C.steel, lineHeight: 20, marginTop: 6 },
});
