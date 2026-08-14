/**
 * STAGE 2 — the post-sent negotiation screen (SPEC-extra-lifecycle-v1 §3, D1).
 *
 * The extra is out, the link is live, and the document is FROZEN (REQ-LC15). So the
 * only thing left that can move it is a conversation, and this screen is ordered
 * around that: the state, the nudge and the thread sit ABOVE the document, because
 * the document is the one thing on this screen nobody can change. A screen that led
 * with the paperwork would bury the three moves REQ-LC20 says are the whole stage:
 * Reply · Remind · Revise & Resend. There is no fourth move — no edit, no cancel,
 * no "mark approved by hand", no delete.
 *
 * THE ONE DISTINCTION THIS SCREEN EXISTS TO MAKE, and the reason the mechanism is
 * written next to the button instead of in a help page:
 *
 *   REMIND reuses the LIVE link and mints nothing (REQ-LC21). Same text, same URL,
 *   still valid.
 *   REVISE & RESEND mints a NEW instrument and RETIRES the old one (REQ-LC22, D2).
 *   The link already sitting in the client's messages stops working the moment the
 *   new price is confirmed.
 *
 * The doc set used one word — "resend" — for both (C6). A contractor who believes a
 * reminder reissued the document, or who taps Revise thinking it is a nudge, has
 * been lied to by this screen. Both lines are rendered, always, unconditionally.
 *
 * NEVER-OPENED AND OPENED-BUT-SILENT ARE DRAWN DIFFERENTLY. They are two different
 * next actions — one says the link may never have arrived, the other says they read
 * it and did not answer — and that difference is the stated reason the open log
 * exists at all (sql/366_event_timeline.sql:8-11). Collapsing them into "waiting"
 * throws away the only signal this screen has.
 *
 * DEF-4 / REQ-LC23: the server closes the thread the instant a terminal answer
 * exists (`confirmation_reply_thread_open`, 308:94, errcode 23514 — a PERMANENT
 * failure in discussionstore.ts). A composer offered after that does not produce a
 * late message, it produces a reply PARKED FOREVER while the UI shows it as sent.
 * So `thread.canReply` gates the composer, and its absence is explained in words
 * with the legal action offered in its place.
 *
 * NO DATA FETCHING. Everything arrives as props, already read and already
 * formatted, so this file cannot be the reason a record renders differently in a
 * basement than it does on wifi (mandate #7). Every string goes through t() —
 * mandate #5, and the record screen shipped English baked into the component once
 * already.
 */
import React from 'react';
import { ScopeBlock } from './scopeblock';
import { ActionSheetIOS, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ExtraRecord } from '../record';
import { truncate, type ThreadState } from '../discussion';
import type { RemindVerdict } from '../remind';
import { chipKey, displayStatus, type LedgerStatus } from '../extrastatus';
import { t } from '../i18n';
import { DiscussionLog } from './threadscreen';
import { RecordingsCard } from './recordings';
import { Icon, type IconName } from './icon';
import {
  APP_NAME, Button, MoneyBlock, Card, Chip, PersonRow as PersonRowView, Row, ScreenHeader,
  PhotoGrid, StatusBanner, TimelineRow, type PhotoTile,
} from './kit';
import { C, F, T, label as labelStyle, money as moneyStyle, tint } from './theme';
import { radii, touchTargets } from './tokens';

/** One person on the record. `role` is the already-translated word, never a slug —
 *  the same rule kit.tsx states, for the same reason: a layout component must not
 *  decide what a role is called. */
export type NegotiationPerson = {
  name: string;
  role?: string;
  photoUri?: string | null;
};

/** Which collapsed document row was tapped. ONE keyed callback rather than six
 *  props: the caller switches once, and a row added here without a matching arm
 *  fails to compile instead of silently doing nothing. */
export type ExtraDetailField =
  | 'scope' | 'photos' | 'cost' | 'schedule' | 'billing' | 'exclusions';

/**
 * The three flow fields as SENTENCES a person reads ("Payment is due when the work
 * is completed"), formatted by the caller.
 *
 * They are not slugs on purpose: `flowterms.ts:flowTermLines` already turns these
 * columns into owner-facing wording for the frozen instrument (REQ-LC41), and a
 * second mapping here is how the app and the document a client is reading start
 * saying different things about the same deal. `null` means the contractor never
 * answered — rendered "Not set", never filled in with a plausible default.
 *
 * DO NOT WIRE `flowTermLines` STRAIGHT INTO THIS. That function is deliberately
 * English — it composes the English-canonical INSTRUMENT (mandate #5) — while this
 * screen is read by the contractor in HIS language. The caller owes a per-slug t()
 * lookup here, or a Spanish-reading contractor reads his own extra in English.
 */
export type ExtraTerms = {
  billingTiming: string | null;
  scheduleEffect: string | null;
  exclusions: string | null;
};

export type ExtraNegotiationProps = {
  /** The record, assembled by `extraRecord()`. Its `status` must be `sent` — this
   *  screen is D1's Stage 2. A terminal status still renders truthfully (a stale
   *  device row is a real state, mandate #7) but the moves close down. */
  rec: ExtraRecord;
  /** "Extra · Miller — Hall Bath", already assembled. Passed in rather than derived
   *  because the kind/type facts need a database read and this screen does none. */
  kicker: string;
  terms: ExtraTerms;
  /** D4: exactly ONE approver. Null when no approver row reached this device — the
   *  headline then says "the client", never an invented name (record.ts's rule). */
  approver: NegotiationPerson | null;
  /** Everyone else on the record. They may read and ask; they cannot approve (D4). */
  contributors?: readonly NegotiationPerson[];
  /** REQ-LC3's derived open signal: `openCount(events)` from eventtimeline.ts, and
   *  `ApprovalPanel.lastOpenedMs` from eventlog.ts. Both are DERIVED from
   *  `confirmation_open` evidence and never stored as a status. */
  openCount: number;
  lastOpenedAtMs: number | null;
  /** Open client questions on THIS version, from the ledger — not counted off
   *  `thread`, which deliberately carries prior versions' messages. */
  openQuestions: number;
  /** `threadState(...)` — the owner of open/canReply/canRevise/awaitingReply. Passed
   *  whole so this screen re-derives none of it (REQ-LC23 lives in one place). */
  thread: ThreadState;
  /** Reply ids still in the outbox. Mandate #1: an undelivered message says so. */
  undelivered?: ReadonlySet<string>;
  /** `canRemind(status, state, now)` from remind.ts. A refusal carries its reason,
   *  and this screen SHOWS the reason rather than a button that does nothing. */
  remind: RemindVerdict;
  /** ms → human. Injected (the same choice ThreadScreen and DiscussionLog make) so
   *  this component holds no clock and one formatter serves the whole record. */
  formatAt: (ms: number) => string;
  onBack: () => void;
  onReply: (text: string, captureIds: readonly string[]) => Promise<void>;
  /** Take one photo FOR THIS MESSAGE, commit it, and return its capture id (null on
   *  cancel/refusal). Distinct from `onCapture`, which files evidence onto the
   *  change order — see ReplyComposer for why they must not be the same act. */
  onSnapPhoto?: () => Promise<string | null>;
  /** Resolves with the verdict at press time — a reminder refused by the rate limit,
   *  or one the transport could not deliver (D5's loud failure), is SAID here. `why`
   *  arrives already translated. */
  onRemind: () => Promise<{ ok: boolean; why?: string }>;
  /** Hands off to the priced read-back composer. This screen never issues a price
   *  itself (mandate #2). */
  onRevise: () => void;
  onOpenDetail: (field: ExtraDetailField) => void;
  /** Which version this row is (1 = the original), derived from the supersession
   *  lineage. Shown here for the same reason it is shown on the sealed screen: the
   *  negotiation stage is where versions are MADE — every Change & resend retires this
   *  instrument and mints the next (REQ-LC22 / D2) — so the reader has to be able to
   *  see which one they are looking at. */
  version?: number;
  /** Open the list of previous versions. Falls back to the full history. */
  onViewVersions?: () => void;
  /** Open one photo full-screen. Looking at evidence is not editing it — legal on a
   *  frozen record, same as the locked screen. */
  onPressPhoto?: (uri: string) => void;
  /** Record a voice note onto this extra — distinct from `onCapture` (the camera). */
  onAddVoice?: () => void;
  /** Add another person on the chain. The record is frozen, but WHO IS REACHABLE on
   *  the job is not part of the instrument — adding an inspector mid-negotiation
   *  changes nothing the client signed. */
  onAddContact?: () => void;
  onViewHistory: () => void;
  /** REQ-LC31 / D6 — where a conversation goes once the thread is closed: a NEW
   *  independent extra linked by origin. Optional because only the caller knows
   *  whether that is legal for this row; the button is absent rather than dead. */
  onNewLinkedExtra?: () => void;
  /** Append evidence to a SENT extra. It sits under the conversation, where the
   *  design puts it, because adding a photo mid-negotiation is a thing you do while
   *  answering a question. Appending evidence never touches `shown_content`, so it
   *  is legal on a sent record and is NOT a fourth move (REQ-LC20). */
  onCapture?: () => void;
  /** DEV ONLY (__fixturenegotiation): scroll to Y after mount for screenshots. */
  _fixtureScrollY?: number;
};

/**
 * What the contractor is waiting on, and it is deliberately four states rather than
 * one "waiting" — each one has a different next action:
 *
 *   question    they asked, he owes an answer, and a nudge here is an insult (R8).
 *   silent      they read it and said nothing. Nudge.
 *   unopened    nobody has opened the link. Nudge — or check the number it went to.
 *   settled     the row already carries a terminal answer (a stale device row, or a
 *               hydrate that landed while this screen was open). Nothing is owed.
 */
type Waiting = 'question' | 'silent' | 'unopened' | 'settled';

/** The banner speaks in first names — "Waiting on Sarah", "Remind Sarah" — which is
 *  how the design writes it and what keeps the title on one line. */
function firstName(full: string): string { return full.trim().split(/\s+/)[0]; }

function waitingOf(shown: LedgerStatus, openCount: number): Waiting {
  if (shown === 'approved' || shown === 'declined' || shown === 'superseded') return 'settled';
  if (shown === 'discussing') return 'question';
  return openCount > 0 ? 'silent' : 'unopened';
}

export function ExtraNegotiationScreen(props: ExtraNegotiationProps) {
  const { rec, thread, approver } = props;
  const shown = displayStatus(rec.status, { openQuestions: props.openQuestions });
  const waiting = waitingOf(shown, props.openCount);

  const scroll = React.useRef<ScrollView>(null);
  React.useEffect(() => {
    if (props._fixtureScrollY != null) scroll.current?.scrollTo({ y: props._fixtureScrollY, animated: false });
  }, [props._fixtureScrollY]);
  const composerInput = React.useRef<TextInput>(null);
  // Where the discussion block starts in the scroll content. Reply focuses the
  // composer, and focusing a field that is off-screen pops the keyboard over
  // nothing — the user taps Reply and watches the screen do apparently nothing.
  const [discussionY, setDiscussionY] = React.useState(0);
  // A refused or failed action's reason. This screen has no other status surface,
  // and a button that silently does nothing is the failure this repo names most.
  const [actionNote, setActionNote] = React.useState<string | null>(null);
  // The active pane under the waiting card (Info / Messages / Activity).
  const [tab, setTab] = React.useState<NegTab>('info');

  // The ⋯ nav overflow — the design carries it on this screen. It offers the two acts
  // that are not one-tap on the page itself: revise & resend, and the full history.
  const showOverflow = React.useCallback(() => {
    ActionSheetIOS.showActionSheetWithOptions(
      { options: [t('neg.reviseShort'), t('neg.viewHistory'), t('common.cancel')], cancelButtonIndex: 2 },
      (i) => { if (i === 0) props.onRevise(); else if (i === 1) props.onViewHistory(); },
    );
  }, [props]);

  const who = approver?.name ?? null;

  const remind = async () => {
    const r = await props.onRemind();
    setActionNote(!r.ok && r.why ? r.why : null);
  };

  const toReply = () => {
    scroll.current?.scrollTo({ y: Math.max(0, discussionY - 12), animated: true });
    composerInput.current?.focus();
  };

  return (
    <View style={T.screen}>
      <ScrollView ref={scroll} style={st.scroll} contentContainerStyle={st.page}>
        {/* ScreenHeader owns the 54pt status-bar clearance AND the kicker. The
            kicker used to be hand-rolled UNDER the title here, because the header
            had no slot above its own — the draft screen worked around the same gap
            the same way and the locked screen worked around it differently again,
            by hiding the job in the back control. Three screens, three answers to
            one missing prop. The prop exists now; they all use it. */}
        <ScreenHeader
          title={rec.title}
          kicker={props.kicker}
          kickerRight={rec.synced ? <SyncedPill /> : undefined}
          navTitle={t('erec.navTitle')}
          onBack={props.onBack}
          backLabel={t('erec.back')}
          onOverflow={showOverflow}
          overflowLabel={t('erec.more')}
        />
        <MoneyLine rec={rec} />
        {!rec.synced && (
          <Text style={[T.bodySteel, st.onPhone]}>{t('erec.onPhone')}</Text>
        )}

        {/* The state and the moves are ONE block on purpose. The nudge is the act
            this state calls for, so it sits against the sentence that explains why —
            and rendering Remind twice (once "prominently in the banner", once in an
            action row) would be two controls for one act. */}
        <WaitingBlock
          shown={shown}
          waiting={waiting}
          who={who}
          openCount={props.openCount}
          lastOpenedAtMs={props.lastOpenedAtMs}
          awaitingReply={thread.awaitingReply}
          stateLineKey={rec.stateLineKey}
          stateLineParams={rec.stateLineParams}
          formatAt={props.formatAt}
          remind={props.remind}
          canReply={thread.canReply}
          canRevise={thread.canRevise}
          onRemind={() => { void remind(); }}
          onReply={toReply}
          onRevise={props.onRevise}
          note={actionNote}
        />

        <TabBar active={tab} onChange={setTab} />

        {/* INFO — who is on the record and what the record says. Recent activity is NOT
            here (hadar): it lives under the Activity tab, not on the Info page. */}
        {tab === 'info' && (
          <>
            <PeopleSection approver={approver} contributors={props.contributors}
              onAddContact={props.onAddContact} />
            <DocumentSection
              rec={rec}
              terms={props.terms}
              onOpenDetail={props.onOpenDetail}
              onPressPhoto={props.onPressPhoto}
            />
            {/* THE ORIGINAL RECORDINGS. Reachable on a sent extra again — the scope
                editor's Raw tab used to be the only door and it no longer exists. */}
            <RecordingsCard voices={rec.voices} />
            {/* VERSION — the same card the sealed screen carries. LAST on this tab
                (hadar, 2026-08-09), moved down from the top. It led the Info tab,
                which put "Version 1 · No previous versions" — a line that says
                nothing has happened — above the people, the document and the
                recordings while the contractor is waiting on an answer. It is
                provenance, not the state of the thing, so it reads after everything
                the client is actually looking at. */}
            <Card style={st.cardTight}>
              <Row
                icon="layers"
                label={t({ k: 'elock.currentVersion', p: { n: props.version ?? 1 } })}
                value={(props.version ?? 1) > 1 ? t('elock.viewPrevious') : t('elock.noPrevious')}
                chevron={(props.version ?? 1) > 1}
                onPress={(props.version ?? 1) > 1
                  ? (props.onViewVersions ?? props.onViewHistory) : undefined}
              />
            </Card>
          </>
        )}

        {/* MESSAGES — the conversation. Its own onLayout carries the scroll target
            for Reply; it must stay a DIRECT child of the scroll content or `y` stops
            being content-relative and Reply scrolls to the wrong place. */}
        {tab === 'messages' && (
          <View onLayout={(e) => setDiscussionY(e.nativeEvent.layout.y)}>
            {thread.messages.length > 0 ? (
              <DiscussionLog
                messages={thread.messages}
                formatAt={props.formatAt}
                undelivered={props.undelivered}
                clientName={approver?.name ?? null}
                clientAvatar={approver?.photoUri ?? null}
                onPressPhoto={props.onPressPhoto}
              />
            ) : (
              <Card>
                <Text style={labelStyle}>{t('r5b.logHeading')}</Text>
                <Text style={[T.bodySteel, st.empty]}>{t('r5b.noMessages')}</Text>
              </Card>
            )}
            {thread.canReply
              ? <ReplyComposer inputRef={composerInput} onReply={props.onReply} who={who ? firstName(who) : null} onSnapPhoto={props.onSnapPhoto} onAddVoice={props.onAddVoice} />
              : <ClosedThread onNewLinkedExtra={props.onNewLinkedExtra} />}
          </View>
        )}

        {/* ACTIVITY — the record's history. */}
        {tab === 'activity' && (
          <ActivitySection
            history={rec.history}
            onViewHistory={props.onViewHistory}
          />
        )}
      </ScrollView>

      {/* Change & resend · Add photo or voice note — ANCHORED at the bottom of the
          screen on every tab (Info/Messages/Activity), outside the scroll content. */}
      <View style={st.bottomBar}>
        {thread.canRevise && (
          <Button
            label={t('neg.changeResend')}
            icon="edit"
            variant="secondary"
            onPress={props.onRevise}
            compact
            style={st.afterBtnRevise}
          />
        )}
        {props.onCapture && (
          <Button
            label={t('neg.addEvidence')}
            icon="photocam"
            variant="secondary"
            onPress={props.onCapture}
            compact
            style={st.afterBtnAdd}
          />
        )}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ heading -- */

/** Mandate #6: the amount is the CONTRACTOR'S price, read back and confirmed by a
 *  human. An extra with no price still says so in words at price size — never a
 *  dash posing as an amount, and never "no cost", which would tell an owner the
 *  work is free (record.ts's `priced` flag exists for exactly this). */
function MoneyLine({ rec }: { rec: ExtraRecord }) {
  if (!rec.priced) {
    return <MoneyBlock amount={t('erec.priceToCome')} muted />;
  }
  const mode = rec.nte ? t({ k: 'erec.nte', p: { amount: rec.nte } }) : t('erec.fixed');
  return (
    <MoneyBlock
      amount={rec.amount}
      green
      subtitle={`${mode}${rec.isMini ? ` · ${t('erec.mini')}` : ''} · ${t('erec.yourPrice')}`}
    />
  );
}

/* ------------------------------------------------------- state + the moves -- */

function WaitingBlock(props: {
  shown: LedgerStatus;
  waiting: Waiting;
  who: string | null;
  openCount: number;
  lastOpenedAtMs: number | null;
  awaitingReply: boolean;
  stateLineKey: string;
  stateLineParams?: Record<string, string>;
  formatAt: (ms: number) => string;
  remind: RemindVerdict;
  canReply: boolean;
  canRevise: boolean;
  onRemind: () => void;
  onReply: () => void;
  onRevise: () => void;
  note: string | null;
}) {
  const { waiting, who } = props;

  const title = waiting === 'question'
    ? (who ? t({ k: 'neg.waitingOnYou', p: { name: firstName(who) } }) : t('neg.waitingOnYouPlain'))
    : waiting === 'settled'
      ? t(chipKey(props.shown))
      : (who ? t({ k: 'neg.waitingOn', p: { name: firstName(who) } }) : t('neg.waitingOnPlain'));

  const detail = detailLines(props).join('\n');
  // Resolved to a SENTENCE here, not carried as a flag: remind.ts already owns which
  // refusal applies and returns its key, and the button's disabled state and its
  // explanation must come from the same value or they can disagree.
  const refusal = props.remind.ok ? null : t(props.remind.reasonKey);

  // Which of the three moves exist here at all. A move whose precondition has failed
  // is ABSENT, not greyed out — except Remind, whose refusal carries a reason worth
  // reading. With none of them left there is no card: an empty bordered box under the
  // banner reads as something that failed to load.
  const anyMove = waiting !== 'settled' || props.canReply || props.canRevise;
  if (!anyMove && props.note === null) {
    return (
      <View style={st.block}>
        <StatusBanner kind={props.shown} title={title} detail={detail} />
      </View>
    );
  }

  return (
    <View style={st.block}>
      {/* ONE card holds the whole waiting state — the read receipt AND the prominent
          Remind button live inside the same box (the design does not float the button
          below the card). The disc sits left; the title, "no response" qualifier and
          the read-receipt lines share the indented column beside it. */}
      <View style={st.waitCard}>
        <View style={st.waitTop}>
          <View style={st.waitDisc}>
            <Icon name="waiting" size={16} color={C.raised} />
          </View>
          <View style={st.waitBody}>
            {/* Title with the "no response" pill pinned TOP-RIGHT beside it. */}
            <View style={st.waitTitleRow}>
              <Text style={st.waitTitle}>{title}</Text>
              {(waiting === 'unopened' || waiting === 'silent') && (
                <Chip kind="pending" label={t('neg.noResponsePill')} outline />
              )}
            </View>
            {detail !== '' && <Text style={st.waitDetail}>{detail}</Text>}
          </View>
        </View>

        {/* Full-width "Remind Sarah" button at the bottom (no icon). */}
        {props.waiting !== 'settled' && (
          <Button
            label={props.who ? t({ k: 'neg.remindName', p: { name: firstName(props.who) } }) : t('neg.remindPlain')}
            variant="green"
            onPress={props.onRemind}
            disabled={refusal !== null}
            style={st.remindInCard}
          />
        )}
        {refusal !== null && (
          <Text style={[st.mechanism, st.mechanismWarn]}>{refusal}</Text>
        )}
      </View>

      {props.note !== null && <Text style={st.failure}>{props.note}</Text>}
    </View>
  );
}

/** The Info / Messages / Activity segmented control the design puts under the waiting
 *  card — the "screen limitation" accommodation that folds People+details, the
 *  conversation, and the history into three panes instead of stacking them all. */
/** The header "Synced" pill (top-right, on the kicker row) — the design's at-a-glance
 *  reassurance that this priced record is safely on the server. */
function SyncedPill() {
  return (
    <View style={st.syncedPill}>
      <Icon name="cloud" size={15} color={C.brand} />
      <Text style={st.syncedT}>{t('neg.synced')}</Text>
    </View>
  );
}

type NegTab = 'info' | 'messages' | 'activity';
function TabBar({ active, onChange }: { active: NegTab; onChange: (t: NegTab) => void }) {
  // Text-only tabs — the design's segmented control carries no icons.
  const tabs: { key: NegTab; label: string }[] = [
    { key: 'info', label: t('neg.tabInfo') },
    { key: 'messages', label: t('neg.tabMessages') },
    { key: 'activity', label: t('neg.tabActivity') },
  ];
  return (
    <View style={st.tabBar}>
      {tabs.map((tb) => {
        const on = tb.key === active;
        return (
          <Pressable
            key={tb.key}
            style={[st.tab, on && st.tabOn]}
            onPress={() => onChange(tb.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
          >
            <Text style={[st.tabT, on && st.tabTOn]}>{tb.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * The banner's second line — "what is true now and what is owed next" (REQ-LC24).
 *
 * The read receipt is built from `openCount` directly rather than from
 * `openSignal()`, which additionally requires a `sent` SERVER event to have reached
 * the device. On this screen the row is `sent` by definition of the stage, so
 * gating the most important line on a hydrate would blank it exactly when there is
 * no signal — mandate #7. The counts themselves are the same three sentences.
 */
function detailLines(o: {
  waiting: Waiting;
  openCount: number;
  lastOpenedAtMs: number | null;
  awaitingReply: boolean;
  stateLineKey: string;
  stateLineParams?: Record<string, string>;
  formatAt: (ms: number) => string;
}): string[] {
  if (o.waiting === 'settled') {
    return [t({ k: o.stateLineKey, p: o.stateLineParams })];
  }
  if (o.waiting === 'question') {
    const lines = [t('erec.stQuestion')];
    if (o.awaitingReply) lines.push(t('r5b.awaitingReply'));
    return lines;
  }
  if (o.waiting === 'unopened') {
    return [t('erec.notOpenedYet'), t('neg.nextIfUnopened')];
  }
  // Two lines, matching the design: the open count, then the last-opened stamp.
  // The "no answer yet" fact lives in the pill above, not repeated here (the shared
  // `erec.openedTimes` carries that suffix for the record screen, so this uses its
  // own clean string), and the "a nudge is the next move" instruction is dropped —
  // the prominent Remind button IS that instruction.
  const lines = [
    o.openCount === 1 ? t('neg.openedOnce') : t({ k: 'neg.openedTimes', p: { n: o.openCount } }),
  ];
  if (o.lastOpenedAtMs !== null) {
    lines.push(t({ k: 'erec.lastOpened', p: { at: openedStamp(o.lastOpenedAtMs, o.formatAt) } }));
  }
  return lines;
}

/** The last-opened stamp reads "today at 8:40 AM" when the client opened it today —
 *  a read receipt is about recency, and "today" carries that faster than a date the
 *  contractor has to compare against the calendar. Older opens fall back to the app's
 *  standard month-day stamp. Scoped to this line on purpose: the record timeline and
 *  feed keep their absolute dates. */
function openedStamp(ms: number, fallback: (ms: number) => string): string {
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return t({ k: 'neg.openedTodayAt', p: { time } });
  }
  return fallback(ms);
}

/* ----------------------------------------------------------------- people -- */

/** D4: exactly ONE approver, named first, with the rule stated in words. Anyone
 *  else on the record may read and ask; nobody else can approve, and a roster that
 *  did not say so would leave a contractor expecting an answer from the wrong
 *  person. Nothing is rendered for a person we hold no name for (record.ts's rule). */
function PeopleSection({ approver, contributors, onAddContact }: {
  approver: NegotiationPerson | null;
  contributors?: readonly NegotiationPerson[];
  onAddContact?: () => void;
}) {
  // ONE HUMAN, ONE ROW. The approver is also, routinely, the person who captured or
  // sent the extra — a solo operator is every role at once, which CLAUDE.md says is
  // the case the product must work for. Listing them under both headings printed the
  // same name twice, and because the two sources are stored separately (the roster's
  // typed name vs the profile's) the casing differed between them, so it read as two
  // different people rather than one duplicate. Matched case- and space-insensitively
  // for that reason: the strings are entered by hand in two places and will not
  // agree on capitalisation.
  const key = (n: string) => n.trim().toLowerCase().replace(/\s+/g, ' ');
  const seen = new Set(approver ? [key(approver.name)] : []);
  const others = (contributors ?? []).filter((p) => {
    const k = key(p.name);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (!approver && !others.length) return null;
  // HORIZONTAL avatar row, not a vertical list — the design shows the people as a
  // compact who's-who strip (avatar over name over role), with the approver first.
  const roster = [
    ...(approver ? [{ p: approver, kind: 'approver' as const, role: approver.role ?? t('erec.approverRole') }] : []),
    ...others.map((p) => ({ p, kind: 'crew' as const, role: p.role ?? t('erec.crewRole') })),
  ];
  return (
    <View>
      <Card style={st.cardTight}>
        <Text style={[labelStyle, st.peopleCardTitle]}>{t('neg.people')}</Text>
        <View style={st.peopleRow}>
          {roster.map(({ p, kind, role }, i) => (
            <View key={`${p.name}-${i}`} style={[st.personCol, i > 0 && st.personDivider]}>
              <Avatar name={p.name} kind={kind} photoUri={p.photoUri} />
              <Text style={st.personName} numberOfLines={1}>{p.name}</Text>
              <Text style={st.personRole} numberOfLines={2}>{role}</Text>
            </View>
          ))}
        </View>
        {/* Another person on the chain. Legal on a sent extra: the roster is who is
            REACHABLE, not a term of the frozen instrument. */}
        {onAddContact && (
          <Pressable style={st.addPerson} onPress={onAddContact} accessibilityRole="button">
            <Icon name="people" size={16} color={C.brand} />
            <Text style={st.addPersonT}>{t('client.addContact')}</Text>
          </Pressable>
        )}
      </Card>
    </View>
  );
}

/** The circular avatar for the people strip — initials on a coloured disc; the
 *  approver's disc reads differently (D4: only one person can approve). */
function Avatar({ name, kind, photoUri }: {
  name: string; kind: 'approver' | 'crew'; photoUri?: string | null;
}) {
  // A real photo wins; initials are the fallback so a person always has a mark.
  if (photoUri) return <Image source={{ uri: photoUri }} style={st.avatar} />;
  const initials = name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <View style={[st.avatar, { backgroundColor: kind === 'approver' ? C.approve : C.brand }]}>
      <Text style={st.avatarT}>{initials}</Text>
    </View>
  );
}

/* ------------------------------------------------------------- discussion -- */

/**
 * The inline composer. Same three rules as ThreadScreen, because losing them is how
 * a message disappears: the field is cleared only AFTER the write resolves, a failed
 * write keeps the words, and the failure is shown rather than swallowed.
 *
 * The note under it is not decoration. The contractor is one tap from typing "ok,
 * $1,500" and treating it as settled; mandate #2 and R5b say a price moves only
 * through revision plus a fresh approval, and the rule is stated where it could be
 * broken.
 */
function ReplyComposer({ inputRef, onReply, who, onSnapPhoto, onAddVoice }: {
  inputRef: React.RefObject<TextInput | null>;
  /** Send the message. `captureIds` are photos already COMMITTED by the caller —
   *  the composer never holds undurable bytes. */
  onReply: (text: string, captureIds: readonly string[]) => Promise<void>;
  who: string | null;
  /**
   * Take ONE photo for this message and commit it, returning its capture id.
   *
   * NOT `onCapture` (hadar, 2026-08-09: "it should be a simple image(s) from the
   * camera not the change order special addition"). That prop opened the fused
   * change-order capture screen — photo + voice + review — and filed the result as
   * EVIDENCE ON THE INSTRUMENT. In a conversation that is the wrong act twice over:
   * it is four screens to send a picture, and the picture silently joined the
   * document the client is being asked to sign.
   *
   * This is the one-touch camera (`snapPhoto`, mandate #3) and the photo belongs to
   * the message. Returns null when the shutter was cancelled or permission refused.
   */
  onSnapPhoto?: () => Promise<string | null>;
  /** Record a voice note. Its own act, not the camera's. */
  onAddVoice?: () => void;
}) {
  const [draft, setDraft] = React.useState('');
  const [shots, setShots] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [snapping, setSnapping] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const send = async () => {
    const text = draft.trim();
    // A PHOTO ALONE IS A MESSAGE. Requiring words would mean typing a caption on a
    // ladder to send the picture that is the whole point.
    if ((!text && !shots.length) || busy) return;
    setBusy(true);
    try {
      await onReply(text, shots);
      setDraft(''); setShots([]); setError(null);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally { setBusy(false); }
  };

  const snap = async () => {
    if (!onSnapPhoto || snapping) return;
    setSnapping(true);
    try {
      const id = await onSnapPhoto();
      // Cancelled or refused: nothing to say. The camera closing IS the feedback.
      if (id) { setShots((s) => [...s, id]); setError(null); }
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally { setSnapping(false); }
  };

  // INLINE composer, matching the design: the field, a camera shortcut, and a round
  // green send — one row — rather than a stacked field over a full-width button.
  return (
    <Card>
      {/* ATTACHED PHOTOS SIT ABOVE THE FIELD, where he can see what he is about to
          send and take one off before he sends it. Removal is local-only and legal:
          nothing here has been sent, and the capture itself stays committed on the
          phone — this drops it from the message, it does not destroy evidence. */}
      {shots.length > 0 && (
        <View style={st.attachRow}>
          {shots.map((id, i) => (
            <View key={id} style={st.attachChip}>
              <Icon name="image" size={16} color={C.brand} />
              <Text style={st.attachChipT}>{i + 1}</Text>
              <Pressable
                onPress={() => setShots((s) => s.filter((x) => x !== id))}
                accessibilityRole="button"
                accessibilityLabel={t('neg.removePhoto')}
                hitSlop={10}
              >
                <Text style={st.attachX}>✕</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}
      <View style={st.composerRow}>
        <TextInput
          ref={inputRef}
          value={draft}
          onChangeText={setDraft}
          multiline
          placeholder={who ? t({ k: 'neg.replyTo', p: { name: who } }) : t('r5b.replyPlaceholder')}
          placeholderTextColor={C.muted}
          accessibilityLabel={t('r5b.replyPlaceholder')}
          style={st.composerInput}
        />
        {onSnapPhoto && (
          <Pressable onPress={() => { void snap(); }} accessibilityRole="button"
            disabled={snapping}
            accessibilityLabel={t('neg.photoInMessage')}
            style={[st.iconBox, snapping && { opacity: 0.5 }]}>
            <Icon name="photocam" size={20} color={C.ink} />
          </Pressable>
        )}
        {onAddVoice && (
          // WIRED TO ITS OWN ACT. This was a copy of the camera button — same handler,
          // same accessibility label — so a control drawn as a microphone opened the
          // camera. Absent when the caller has no voice path, rather than lying.
          <Pressable onPress={onAddVoice} accessibilityRole="button"
            accessibilityLabel={t('neg.addVoice')} style={st.iconBox}>
            <Icon name="micLine" size={22} color={C.ink} />
          </Pressable>
        )}
        <Pressable onPress={() => { void send(); }} accessibilityRole="button"
          accessibilityLabel={busy ? t('r5b.sending') : t('r5b.send')}
          disabled={(!draft.trim() && !shots.length) || busy}
          style={st.sendRound}>
          <Icon name="send" size={20} color="#fff" />
        </Pressable>
      </View>
      {error !== null && <Text style={st.failure}>{error}</Text>}
    </Card>
  );
}

/**
 * DEF-4 / REQ-LC23. The server rejects a reply once a terminal answer exists, and
 * that rejection is PERMANENT — the message would sit in the outbox forever while
 * the screen showed it as sent. So there is no composer here, there is an
 * explanation, and the legal move is offered in its place: a change after approval
 * is a NEW INDEPENDENT EXTRA linked by origin (REQ-LC31, D6), never a reopening.
 */
function ClosedThread({ onNewLinkedExtra }: { onNewLinkedExtra?: () => void }) {
  return (
    <Card>
      <Text style={labelStyle}>{t('neg.closedTitle')}</Text>
      <Text style={[T.bodySteel, st.empty]}>{t('r5b.threadClosed')}</Text>
      {onNewLinkedExtra && (
        <Button
          label={t('neg.newLinkedExtra')}
          icon="extra"
          variant="secondary"
          onPress={onNewLinkedExtra}
          style={st.stacked}
        />
      )}
    </Card>
  );
}

/* --------------------------------------------------------------- document -- */

/**
 * The document, collapsed. Each row opens its own detail.
 *
 * A recommended field the contractor never answered still shows "Not set" rather
 * than vanishing (D3: those four warn, they never block) — but the note says the
 * consequence plainly, because the extra is FROZEN at send (REQ-LC15): filling one
 * in now goes to the client as a NEW VERSION, it does not quietly improve the
 * document they are already reading.
 *
 * No icons on these rows. There is no money glyph and no schedule glyph in the kit,
 * and inventing a mapping — a clipboard for a price — would put a decorative symbol
 * on a line about a dollar figure.
 */
function DocumentSection({ rec, terms, onOpenDetail, onPressPhoto }: {
  rec: ExtraRecord;
  terms: ExtraTerms;
  onOpenDetail: (field: ExtraDetailField) => void;
  onPressPhoto?: (uri: string) => void;
}) {
  const notSet = t('neg.notSet');
  const photoCount = rec.photos.length + rec.photosTruncated;
  const tiles: PhotoTile[] = rec.photos.map((ph) => ({
    key: ph.captureId, uri: ph.uri, present: ph.present,
  }));
  const term = (v: string | null) => v === null ? notSet : truncate(v, 42);
  const tone = (v: string | null) => v === null ? 'warn' as const : 'default' as const;

  // ONE grouped card with divider rows (no "what you sent them" header, no Photos row),
  // real values on the right. Only "Recent activity" is a separate card (ActivitySection).
  return (
    <Card style={st.cardTight}>
      {/* 391 — THE SCOPE IS NOT A ROW. It was `truncate(rec.description, 90)` with a
            chevron: on the one screen where the client is deciding and the contractor
            is answering questions, the thing under negotiation was 90 characters and an
            arrow. Same ScopeBlock as the draft and locked screens, frozen styling, so
            the reader can see the text has not moved since it was sent. */}
        <ScopeBlock text={rec.scopeOfWork} stage="sent" />
      <Row
        icon="cost"
        label={t('neg.rowCost')}
        value={rec.priced
          ? `${rec.amount.replace(/\.00\b/, '')} · ${rec.nte ? t({ k: 'erec.nte', p: { amount: rec.nte } }) : t('erec.fixed')}`
          : t('erec.priceToCome')}
        tone={rec.priced ? 'default' : 'warn'}
        chevron
        divider
        onPress={() => onOpenDetail('cost')}
      />
      {/* PHOTOS — restored (they were dropped in a card restructure, which left a sent
          extra's evidence unreachable from this screen). Tapping a tile opens it
          FULL-SCREEN: looking at evidence is not editing it, so it is legal on a
          frozen record — the same rule the locked screen follows. */}
      <Row
        icon="image"
        label={t('neg.rowPhotos')}
        value={photoCount > 0
          ? t({ k: 'neg.photosN', p: { n: photoCount } })
          : t('neg.notSet')}
        tone={photoCount > 0 ? 'default' : 'warn'}
        chevron
        divider
        onPress={() => onOpenDetail('photos')}
      />
      {tiles.length > 0 && (
        <View style={{ marginLeft: 36, marginTop: 10, marginBottom: 12 }}>
          <PhotoGrid
            photos={tiles}
            missingLabel={t('erec.evidenceMissing')}
            onPressPhoto={onPressPhoto ? (photo) => onPressPhoto(photo.uri) : undefined}
            tileSize={62}
          />
        </View>
      )}
      <Row
        icon="calendar"
        label={t('neg.rowSchedule')}
        value={term(terms.scheduleEffect)}
        tone={tone(terms.scheduleEffect)}
        chevron
        divider
        onPress={() => onOpenDetail('schedule')}
      />
      <Row
        icon="payment"
        label={t('neg.rowBilling')}
        value={term(terms.billingTiming)}
        tone={tone(terms.billingTiming)}
        chevron
        divider
        onPress={() => onOpenDetail('billing')}
      />
      <Row
        icon="excluded"
        label={t('neg.rowExclusions')}
        value={term(terms.exclusions)}
        tone={tone(terms.exclusions)}
        chevron
        onPress={() => onOpenDetail('exclusions')}
      />
    </Card>
  );
}

/* --------------------------------------------------------------- activity -- */

const RECENT = 4;

/**
 * The tail of the history, in the order record.ts built it.
 *
 * IT IS NOT RE-SORTED. record.ts deliberately appends events it holds NO TIME for
 * after the timestamped ones, marked "time not recorded", rather than inventing a
 * position for them — and re-sorting here would either fabricate that position or
 * drop them. Taking the tail preserves both the order and the marker.
 */
function ActivitySection({ history, onViewHistory }: {
  history: ExtraRecord['history'];
  onViewHistory: () => void;
}) {
  const recent = history.slice(-RECENT);
  // A header + "View full history ›" link, matching the design's compact Recent
  // activity — the same shape as People Involved. Recent items render under it only
  // when there are any; an empty log collapses to just the header and the link
  // rather than a card announcing there is nothing to see.
  return (
    <View>
      <Pressable style={st.peopleHead} onPress={onViewHistory} accessibilityRole="button">
        <Text style={[labelStyle, st.sectionLabel]}>{t('neg.recentActivity')}</Text>
        <Text style={st.viewAll}>{t('neg.viewHistory')} ›</Text>
      </Pressable>
      {recent.length > 0 && (
        <Card>
          {recent.map((h, i) => (
            <TimelineRow
              key={`${h.at}-${i}`}
              at={h.at}
              what={h.what}
              hot={h.hot}
              last={i === recent.length - 1}
            />
          ))}
        </Card>
      )}
    </View>
  );
}

/* ----------------------------------------------------------------- styles -- */

const st = StyleSheet.create({
  // paddingBottom clears the pinned CAPTURE FAB (72pt + its gap), which floats over
  // the bottom of this viewport. At 60 it covered the approver's row — the one line
  // on this screen that says who the contractor is waiting on.
  // ScrollView fills the space ABOVE the anchored bottom bar.
  scroll: { flex: 1 },
  page: {
    padding: 18,
    paddingTop: 0,
    paddingBottom: 20,
  },
  // The anchored bottom action bar — sits below the scroll on every tab.
  bottomBar: {
    flexDirection: 'row', gap: 8,
    paddingHorizontal: 18, paddingTop: 10, paddingBottom: 28,
    borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.paper,
  },
  moneyRow: { flexDirection: 'row', alignItems: 'baseline', gap: 9, marginTop: 6 },
  money: { fontSize: 30, color: C.ink },
  priceToCome: { fontSize: 24, color: C.steel, marginTop: 6 },
  onPhone: { fontSize: 12, marginTop: 6 },

  block: { marginTop: 12 },
  remindPrimary: { marginTop: 12 },
  // Screen-scoped card override: less-rounded corners + a SINGLE consistent gap above
  // each card (10) so every section is evenly spaced — the global T.card is 18/10 and
  // its marginBottom made the tab→People gap differ from People→detail.
  cardTight: { borderRadius: 12, marginTop: 10, marginBottom: 0 },

  // The single waiting card (green-tinted), holding disc + title + read-receipt + the
  // Remind button — the design keeps them in one box.
  waitCard: {
    backgroundColor: C.brandSoft, borderWidth: 1, borderColor: C.brandLine,
    borderRadius: 12, padding: 11,
  },
  waitTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  waitDisc: {
    // Full CIRCLE (borderRadius = 50% of the size).
    width: 36, height: 36, borderRadius: 18, backgroundColor: C.brand,
    alignItems: 'center', justifyContent: 'center',
  },
  waitBody: { flex: 1 },
  // Title + top-right pill share one row; the pill hugs the right edge.
  waitTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 30 },
  waitTitle: {
    // Bold (Barlow Condensed 700, was 600) and ~20% larger (17→20).
    flex: 1, fontFamily: F.disp, fontSize: 20, color: C.brand,
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  waitDetail: { fontFamily: F.body, fontSize: 14, color: C.ink, lineHeight: 21, marginTop: 4 },
  // The full-width Remind button. Height trimmed ~20% (46→37); corners ~20% less round (12→10).
  remindInCard: { marginTop: 12, minHeight: 37, borderRadius: 10 },

  // The Info / Messages / Activity segmented control. One track; the active segment is
  // filled brand-green with light text, the rest are quiet. Tight padding so the active
  // pill fills the track height (the design's selection is a full-height segment).
  tabBar: {
    flexDirection: 'row', gap: 4, marginTop: 10, padding: 3,
    borderWidth: 1, borderColor: C.line, borderRadius: 12, backgroundColor: C.card,
  },
  tab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, minHeight: 40, borderRadius: 9,
  },
  tabOn: { backgroundColor: C.brand },
  tabT: { fontFamily: F.bodySemi, fontSize: 14.5, color: C.ink },
  tabTOn: { color: C.raised },

  // The header "Synced" pill (green check on a brand-soft chip).
  syncedPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: C.brandSoft, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
  },
  syncedT: { fontFamily: F.bodySemi, fontSize: 12.5, color: C.brand },

  // Each Info detail is its OWN card (the design's separate-card list), so the row
  // padding is trimmed — the Card already supplies the inset.
  detailCard: { paddingVertical: 6, paddingHorizontal: 14, marginBottom: 8 },

  // Three equal action buttons under the card: white fill, hairline border, dark
  // icon + label (not the green outline of the kit's `secondary`).
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, minHeight: 44, borderWidth: 1, borderColor: C.line, borderRadius: 12,
    backgroundColor: C.card, paddingHorizontal: 8,
  },
  actionLabel: { flexShrink: 1, fontFamily: F.bodySemi, fontSize: 12.5, color: C.ink, textAlign: 'center' },
  peopleHead: { flexDirection: 'row', alignItems: 'center', marginTop: 12, marginBottom: 6 },
  sectionLabel: { flex: 1, fontSize: 11.5, letterSpacing: 1.4, color: C.muted },
  viewAll: { fontFamily: F.bodySemi, fontSize: 13, color: C.brand },
  // "PEOPLE INVOLVED" sits INSIDE the card, top-left, above the strip (the design puts
  // the heading in the card, not floating above it).
  peopleCardTitle: { fontSize: 11.5, letterSpacing: 1.4, color: C.muted, marginBottom: 14 },
  addPerson: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    minHeight: 44, marginTop: 10, borderTopWidth: 1, borderTopColor: C.line,
  },
  addPersonT: { fontFamily: F.bodySemi, fontSize: 14, color: C.brand },
  peopleRow: { flexDirection: 'row' },
  personCol: { flex: 1, alignItems: 'center', paddingHorizontal: 6 },
  // Thin rule between people, as in the design's who's-who strip.
  personDivider: { borderLeftWidth: 1, borderLeftColor: C.line },
  avatar: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  avatarT: { fontFamily: F.dispSemi, fontSize: 15, color: '#fff' },
  personName: { fontFamily: F.bodySemi, fontSize: 13.5, color: C.ink, marginTop: 7, textAlign: 'center' },
  personRole: { fontFamily: F.body, fontSize: 12, color: C.muted, marginTop: 1, textAlign: 'center', lineHeight: 15 },
  // Photos staged on the message, before it is sent.
  attachRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  attachChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.brandSoft, borderWidth: 1, borderColor: C.brandLine,
    borderRadius: 999, paddingLeft: 10, paddingRight: 8, paddingVertical: 6,
  },
  attachChipT: { fontFamily: F.bodySemi, fontSize: 13, color: C.brandDark },
  attachX: { fontFamily: F.body, fontSize: 15, color: C.steel, paddingHorizontal: 2 },
  composerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  composerInput: {
    flex: 1, fontFamily: F.body, fontSize: 15.5, color: C.ink,
    minHeight: touchTargets.minimum, maxHeight: 120,
    // Rounded RECTANGLE, not a full pill — matching the design's input.
    borderWidth: 1, borderColor: C.line, borderRadius: 14,
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, backgroundColor: C.card,
  },
  // Camera + mic each sit in an outlined box that shares the input's corner radius.
  iconBox: {
    width: 46, height: 46, borderWidth: 1, borderColor: C.line, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  sendRound: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: C.brand,
    alignItems: 'center', justifyContent: 'center',
  },
  // The three moves across one row. `flex: 1` with a shared gap rather than fixed
  // widths: "Revise" is the longest label in EN and not the longest in ES, and a
  // width tuned to one language clips the other.
  moves: { flexDirection: 'row', gap: 8, marginTop: 10 },
  move: { flexShrink: 1 },
  stacked: { marginTop: 8 },
  afterThread: { flexDirection: 'row', gap: 8, marginTop: 10 },
  afterBtnRevise: { flexShrink: 0 },
  afterBtnAdd: { flex: 1 },
  // The mechanism line under Remind and under Revise. It is body copy, not a
  // caption: it is the sentence that stops a contractor confusing the two acts.
  mechanism: {
    fontFamily: F.body, fontSize: 13, color: C.steel, lineHeight: 18, marginTop: 6,
  },
  // Ochre, from the one caution token — the tone that means "read this before you
  // tap", never the brick that means something broke.
  mechanismWarn: { color: tint('caution').ink },
  failure: { fontFamily: F.body, fontSize: 13, color: C.danger, marginTop: 8 },
  footnote: { fontSize: 12, marginTop: 10 },
  empty: { marginTop: 6 },

  input: {
    fontFamily: F.body, fontSize: 16, color: C.ink,
    minHeight: touchTargets.primary, borderWidth: 1.5, borderColor: C.line,
    borderRadius: radii.md, paddingHorizontal: 14, paddingVertical: 12,
    backgroundColor: C.card,
  },
});
