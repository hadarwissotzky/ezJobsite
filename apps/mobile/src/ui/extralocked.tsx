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
import { chipKey } from '../extrastatus';
import { t } from '../i18n';
import { Icon, type IconName } from './icon';
import {
  Button, Card, Chip, PersonRow, PhotoGrid, ScreenHeader, Section, StatusBanner,
  type PhotoTile,
} from './kit';
import { RecordApproval } from './recordapproval';
import { C, F, T, label as labelStyle, money as moneyStyle, tint, type Tone } from './theme';
import { radii, touchTargets } from './tokens';

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
  /** What the approver typed back with their answer, when they typed anything. */
  approverNote?: string | null;
  onBack: () => void;
  /** Open the signed approval document — the server's copy, which is the one that
   *  outranks anything this device holds. */
  onViewSignedApproval: () => void;
  onViewFullHistory: () => void;
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
    key: p.captureId, uri: p.uri, present: p.present, caption: p.at,
  }));

  const schedule = scheduleTerm(agreed);
  const billing = billingTerm(agreed);
  const excluded = agreed.exclusions?.trim() ?? '';

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingTop: 0, paddingBottom: 48 }}>
        {/* The job rides in the back control rather than as a kicker line above the
            title: `ScreenHeader` owns the 54pt status-bar clearance and has no slot
            above its title, and re-deriving that clearance here is the exact bug it
            exists to prevent (a back control under the iPhone clock, shipped once). */}
        <ScreenHeader
          title={rec.title}
          onBack={props.onBack}
          backLabel={rec.jobName ?? t('erec.back')}
          right={<Chip kind="approved" label={t(chipKey('approved'))} />}
        />

        {rec.priced ? (
          <View style={st.moneyRow}>
            <Text style={st.money}>{rec.amount}</Text>
            <Text style={T.bodySteel}>
              {rec.nte ? t({ k: 'erec.nte', p: { amount: rec.nte } }) : t('erec.fixed')}
              {rec.isMini ? ` · ${t('erec.mini')}` : ''}
            </Text>
          </View>
        ) : (
          // Never "—" and never "no cost change": one is a dash posing as an amount, the
          // other tells the reader the work was free. What is true is narrower than both.
          <Text style={st.noAmount}>{t('elock.noAmount')}</Text>
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

        <StatusBanner kind="approved" title={t('elock.signedApproved')} detail={detail} />

        <Notice tone="neutral" icon="lock"
          title={t('elock.lockedTitle')} body={t('elock.lockedBody')} />

        <Section title={t('elock.agreedTitle')}>
          {/* `scope` is the frozen column, so it is both the screen's title and the
              document's first term, and it is written twice on purpose: the title is
              chrome, this is the clause. The mockup's separate "included" row has no
              second frozen column behind it — the only candidates are `summary` (not
              frozen, ruled outside the instrument by REQ-LC43) and this same text — so
              rather than print one of them twice under two headings, or promote a
              mutable sentence to an agreed term, there is one scope row. */}
          <Term title={t('elock.rowScope')}>
            <TermText text={rec.title} stated />
          </Term>

          <Term title={t('elock.rowExclusions')}>
            <TermText text={excluded || t('elock.exclNone')} stated={!!excluded} />
          </Term>

          <Term title={t('elock.rowPhotos')}>
            {photos.length === 0 ? (
              <TermText text={t('elock.photosNone')} stated={false} />
            ) : (
              <>
                {/* No `onAddMore`: a frozen record's evidence cannot grow. A file the
                    row promises but the phone no longer holds renders as a NAMED
                    missing tile, never a blank square (mandate #1). */}
                <PhotoGrid
                  photos={photos}
                  missingLabel={t('erec.evidenceMissing')}
                  onPressPhoto={props.onPressPhoto
                    ? (photo) => props.onPressPhoto?.(photo.uri) : undefined}
                />
                {rec.photosTruncated > 0 && (
                  <Text style={st.truncated}>
                    {t({ k: 'erec.evidenceMore', p: { n: rec.photosTruncated } })}
                  </Text>
                )}
              </>
            )}
          </Term>

          <Term title={t('elock.rowSchedule')}>
            <TermText text={schedule.text} stated={schedule.stated} />
          </Term>

          <Term title={t('elock.rowBilling')}>
            <TermText text={billing.text} stated={billing.stated} />
          </Term>
        </Section>

        <Section title={t('elock.recordTitle')}>
          {props.approver && (
            <PersonRow
              name={props.approver.name}
              role={props.approver.role ?? t('erec.approverRole')}
              photoUri={props.approver.photoUri}
              kind="approver"
            />
          )}
          {/* Newest first, and the approval is always the newest thing that happened. */}
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

        {/* The frozen instrument, quoted verbatim by the component that already owns that
            rendering. Outside the Section because it draws its own card. */}
        <RecordApproval approval={props.approval ?? null} />

        <View style={st.actions}>
          <Button label={t('elock.viewApproval')} icon="approval"
            onPress={props.onViewSignedApproval} />
          <Button label={t('elock.viewHistory')} icon="history" variant="ghost"
            onPress={props.onViewFullHistory} />
        </View>

        {/* D6 stated where the person tapping will read it. "Create another extra" on its
            own is exactly the phrasing someone reads as "amend this one", which is the
            single misunderstanding this whole stage exists to prevent — so the sentence
            above the button says what the tap does and, just as importantly, what it does
            not do to the agreement they are looking at. */}
        <Card style={{ marginTop: 18 }}>
          <Text style={st.followTitle}>{t('elock.anotherTitle')}</Text>
          <Text style={st.followBody}>{t('elock.anotherBody')}</Text>
          <Button label={t('elock.another')} icon="extra" variant="secondary"
            onPress={props.onCreateLinkedExtra} style={{ marginTop: 12 }} />
        </Card>
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

function Term({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={st.term}>
      <Text style={labelStyle}>{title}</Text>
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
      <Text selectable style={T.body} numberOfLines={long && !open ? COLLAPSED_LINES : undefined}>
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
      <Icon name="approved" size={20} color={C.approve} />
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
    fontFamily: F.dispSemi, fontSize: 15, textTransform: 'uppercase', letterSpacing: 1.3,
  },
  noticeBody: { fontFamily: F.body, fontSize: 14.5, lineHeight: 20, marginTop: 4 },

  term: { marginBottom: 16 },
  silent: { fontFamily: F.body, fontSize: 15, color: C.steel, lineHeight: 21 },
  truncated: { ...T.bodySteel, fontSize: 12, marginTop: 8 },
  more: {
    minHeight: touchTargets.minimum, justifyContent: 'center',
    alignSelf: 'flex-start', paddingRight: 24,
  },
  moreT: { fontFamily: F.bodySemi, fontSize: 15, color: C.brand },

  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 8 },
  stepWhat: { fontFamily: F.bodySemi, fontSize: 15.5, color: C.ink, lineHeight: 21 },
  stepAt: {
    fontFamily: F.dispSemi, fontSize: 11.5, letterSpacing: 1,
    textTransform: 'uppercase', color: C.steel, marginTop: 2,
  },
  stepNote: {
    fontFamily: F.body, fontSize: 14.5, color: C.inkSoft, lineHeight: 21, marginTop: 6,
  },

  actions: { marginTop: 18, gap: 10 },
  followTitle: { fontFamily: F.bodyBold, fontSize: 17, color: C.ink, letterSpacing: -0.2 },
  followBody: { fontFamily: F.body, fontSize: 14.5, color: C.steel, lineHeight: 20, marginTop: 6 },
});
