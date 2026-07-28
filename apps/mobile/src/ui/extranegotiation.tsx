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
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ExtraRecord } from '../record';
import { truncate, type ThreadState } from '../discussion';
import type { RemindVerdict } from '../remind';
import { chipKey, displayStatus, type LedgerStatus } from '../extrastatus';
import { t } from '../i18n';
import { DiscussionLog } from './threadscreen';
import {
  Button, Card, Chip, PersonRow as PersonRowView, Row, ScreenHeader, Section,
  StatusBanner, TimelineRow,
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
  onReply: (text: string) => Promise<void>;
  /** Resolves with the verdict at press time — a reminder refused by the rate limit,
   *  or one the transport could not deliver (D5's loud failure), is SAID here. `why`
   *  arrives already translated. */
  onRemind: () => Promise<{ ok: boolean; why?: string }>;
  /** Hands off to the priced read-back composer. This screen never issues a price
   *  itself (mandate #2). */
  onRevise: () => void;
  onOpenDetail: (field: ExtraDetailField) => void;
  onViewHistory: () => void;
  /** REQ-LC31 / D6 — where a conversation goes once the thread is closed: a NEW
   *  independent extra linked by origin. Optional because only the caller knows
   *  whether that is legal for this row; the button is absent rather than dead. */
  onNewLinkedExtra?: () => void;
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

function waitingOf(shown: LedgerStatus, openCount: number): Waiting {
  if (shown === 'approved' || shown === 'declined' || shown === 'superseded') return 'settled';
  if (shown === 'discussing') return 'question';
  return openCount > 0 ? 'silent' : 'unopened';
}

/** Mirrors the ledger's colour semantics (recordscreen.tsx's own chipKind): a
 *  question takes the accent because it means the ball is in the CONTRACTOR's court.
 *  Terminal kinds are handled even though this screen is Stage 2 — a stale row must
 *  not be labelled "Sent" once the client has answered. */
function chipKind(s: LedgerStatus) {
  if (s === 'approved') return 'approved' as const;
  if (s === 'declined') return 'declined' as const;
  if (s === 'sent') return 'pending' as const;
  if (s === 'discussing') return 'ewa' as const;
  return 'discuss' as const;
}

export function ExtraNegotiationScreen(props: ExtraNegotiationProps) {
  const { rec, thread, approver } = props;
  const shown = displayStatus(rec.status, { openQuestions: props.openQuestions });
  const waiting = waitingOf(shown, props.openCount);

  const scroll = React.useRef<ScrollView>(null);
  const composerInput = React.useRef<TextInput>(null);
  // Where the discussion block starts in the scroll content. Reply focuses the
  // composer, and focusing a field that is off-screen pops the keyboard over
  // nothing — the user taps Reply and watches the screen do apparently nothing.
  const [discussionY, setDiscussionY] = React.useState(0);
  // A refused or failed action's reason. This screen has no other status surface,
  // and a button that silently does nothing is the failure this repo names most.
  const [actionNote, setActionNote] = React.useState<string | null>(null);

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
      <ScrollView ref={scroll} contentContainerStyle={st.page}>
        {/* ScreenHeader owns the 54pt status-bar clearance. Hand-rolling it here is
            how a screen ends up with its back control under the iPhone clock, which
            shipped once already (kit.tsx). The kicker sits under the title rather
            than over it because the header has no slot above its own title. */}
        <ScreenHeader
          title={rec.title}
          onBack={props.onBack}
          backLabel={t('erec.back')}
          right={<Chip kind={chipKind(shown)} label={t(chipKey(shown))} />}
        />
        <Text style={[labelStyle, st.kicker]}>{props.kicker}</Text>
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

        <PeopleSection approver={approver} contributors={props.contributors} />

        {/* The conversation. Its own onLayout carries the scroll target for Reply;
            it must stay a DIRECT child of the scroll content or `y` stops being
            content-relative and Reply scrolls to the wrong place. */}
        <View onLayout={(e) => setDiscussionY(e.nativeEvent.layout.y)}>
          {thread.messages.length > 0 ? (
            <DiscussionLog
              messages={thread.messages}
              formatAt={props.formatAt}
              undelivered={props.undelivered}
            />
          ) : (
            <Card>
              <Text style={labelStyle}>{t('r5b.logHeading')}</Text>
              <Text style={[T.bodySteel, st.empty]}>{t('r5b.noMessages')}</Text>
            </Card>
          )}
          {thread.canReply
            ? <ReplyComposer inputRef={composerInput} onReply={props.onReply} />
            : <ClosedThread onNewLinkedExtra={props.onNewLinkedExtra} />}
        </View>

        <DocumentSection
          rec={rec}
          terms={props.terms}
          onOpenDetail={props.onOpenDetail}
        />

        <ActivitySection
          history={rec.history}
          onViewHistory={props.onViewHistory}
        />
      </ScrollView>
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
    return <Text style={[moneyStyle, st.priceToCome]}>{t('erec.priceToCome')}</Text>;
  }
  return (
    <View style={st.moneyRow}>
      <Text style={[moneyStyle, st.money]}>{rec.amount}</Text>
      <Text style={T.bodySteel}>
        {rec.nte ? t({ k: 'erec.nte', p: { amount: rec.nte } }) : t('erec.fixed')}
        {rec.isMini ? ` · ${t('erec.mini')}` : ''}
      </Text>
    </View>
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
    ? (who ? t({ k: 'neg.waitingOnYou', p: { name: who } }) : t('neg.waitingOnYouPlain'))
    : waiting === 'settled'
      ? t(chipKey(props.shown))
      : (who ? t({ k: 'neg.waitingOn', p: { name: who } }) : t('neg.waitingOnPlain'));

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
      <StatusBanner kind={props.shown} title={title} detail={detail} />
      <Card>
        {/* The honest pill. "No response yet" is a different claim from "opened and
            ignored", and the contractor acts on it differently — so it is stated as
            a fact of its own, not left implied by a missing line. */}
        {waiting === 'unopened' && (
          <View style={st.pillRow}>
            <Chip kind="pending" label={t('neg.noResponsePill')} />
          </View>
        )}

        {/* REMIND — the same link, always (REQ-LC21). It is the primary because it
            is the act this state calls for; it is never the act that reissues the
            document, and the line under it says so. */}
        {props.waiting !== 'settled' && (
          <>
            <Button
              label={who ? t({ k: 'neg.remindName', p: { name: who } }) : t('neg.remindPlain')}
              icon="remind"
              onPress={props.onRemind}
              disabled={refusal !== null}
            />
            {/* A refusal SAYS WHY. remind.ts already returns the reason (rate limit,
                or R8's refusal to nag while the client is waiting on an answer); a
                button greyed out with no sentence is the dead button this replaces. */}
            <Text style={[st.mechanism, refusal !== null && st.mechanismWarn]}>
              {refusal ?? t('neg.sameLink')}
            </Text>
          </>
        )}

        {/* REPLY — jumps to the composer below rather than opening another screen:
            the conversation is on this page, and a move that navigates away from the
            thread it is answering is a move nobody makes twice. Absent when the
            thread is closed; `ClosedThread` below says why and offers what is legal
            instead (REQ-LC23). */}
        {props.canReply && (
          <Button
            label={t('neg.reply')}
            icon="reply"
            variant="secondary"
            onPress={props.onReply}
            style={st.stacked}
          />
        )}

        {/* REVISE & RESEND — a NEW instrument, and the old link dies (REQ-LC22, D2).
            Quiet on purpose: it issues a priced commitment, and nothing that issues a
            price should be the easy tap (mandate #2). The warning is not a tooltip;
            a contractor must not be able to tap this believing it is a nudge. */}
        {props.canRevise && (
          <>
            <Button
              label={t('r5b.revise')}
              icon="send"
              variant="ghost"
              onPress={props.onRevise}
              style={st.stacked}
            />
            <Text style={[st.mechanism, st.mechanismWarn]}>{t('neg.newLink')}</Text>
          </>
        )}

        {props.note !== null && <Text style={st.failure}>{props.note}</Text>}
      </Card>
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
  const lines = [
    o.openCount === 1 ? t('erec.openedOnce') : t({ k: 'erec.openedTimes', p: { n: o.openCount } }),
  ];
  // The caller's formatter, never a second one: the last-opened stamp and the
  // timestamps in the thread and the history are the same kind of fact, and two
  // formatters on one screen is how the same moment reads two different ways.
  if (o.lastOpenedAtMs !== null) {
    lines.push(t({ k: 'erec.lastOpened', p: { at: o.formatAt(o.lastOpenedAtMs) } }));
  }
  lines.push(t('neg.nextIfOpened'));
  return lines;
}

/* ----------------------------------------------------------------- people -- */

/** D4: exactly ONE approver, named first, with the rule stated in words. Anyone
 *  else on the record may read and ask; nobody else can approve, and a roster that
 *  did not say so would leave a contractor expecting an answer from the wrong
 *  person. Nothing is rendered for a person we hold no name for (record.ts's rule). */
function PeopleSection({ approver, contributors }: {
  approver: NegotiationPerson | null;
  contributors?: readonly NegotiationPerson[];
}) {
  const others = contributors ?? [];
  if (!approver && !others.length) return null;
  return (
    <Section title={t('neg.people')}>
      {approver && (
        <PersonRowView
          name={approver.name}
          role={approver.role ?? t('erec.approverRole')}
          photoUri={approver.photoUri}
          kind="approver"
        />
      )}
      {others.map((p, i) => (
        <PersonRowView
          key={`${p.name}-${i}`}
          name={p.name}
          role={p.role}
          photoUri={p.photoUri}
          kind="crew"
        />
      ))}
      <Text style={[T.bodySteel, st.footnote]}>
        {approver
          ? t({ k: 'neg.approverOnly', p: { name: approver.name } })
          : t('neg.approverOnlyPlain')}
      </Text>
    </Section>
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
function ReplyComposer({ inputRef, onReply }: {
  inputRef: React.RefObject<TextInput | null>;
  onReply: (text: string) => Promise<void>;
}) {
  const [draft, setDraft] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await onReply(text);
      setDraft(''); setError(null);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally { setBusy(false); }
  };

  return (
    <Card>
      <TextInput
        ref={inputRef}
        value={draft}
        onChangeText={setDraft}
        multiline
        placeholder={t('r5b.replyPlaceholder')}
        placeholderTextColor={C.steel}
        accessibilityLabel={t('r5b.replyPlaceholder')}
        style={st.input}
      />
      <Button
        label={busy ? t('r5b.sending') : t('r5b.send')}
        icon="send"
        onPress={() => { void send(); }}
        disabled={!draft.trim() || busy}
        style={st.stacked}
      />
      {error !== null && <Text style={st.failure}>{error}</Text>}
      <Text style={[T.bodySteel, st.footnote]}>{t('r5b.priceNeedsRevision')}</Text>
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
function DocumentSection({ rec, terms, onOpenDetail }: {
  rec: ExtraRecord;
  terms: ExtraTerms;
  onOpenDetail: (field: ExtraDetailField) => void;
}) {
  const notSet = t('neg.notSet');
  const term = (v: string | null) => v === null ? notSet : truncate(v, 42);
  const tone = (v: string | null) => v === null ? 'warn' as const : 'default' as const;
  const photos = rec.photos.length + rec.photosTruncated;

  return (
    <Section title={t('neg.document')}>
      {/* `rec.title` (= the frozen `change_order.scope`), never `rec.description`.
          This section's own footnote promises "This is frozen — it is what they are
          reading right now", and `rec.description` is neither: it is built from
          `change_order.summary`, which REQ-LC43 rules outside the instrument, which
          `shown_content` has never carried, and which an appended voice note GROWS
          after send (record.ts folds the augment log into it). So the row under the
          frozen heading used to show text that was not sent and did not exist when
          the client was asked. */}
      <Row
        label={t('neg.rowScope')}
        sub={truncate(rec.title, 96)}
        chevron
        onPress={() => onOpenDetail('scope')}
      />
      <Row
        label={t('neg.rowPhotos')}
        value={photos > 0 ? t({ k: 'neg.photosN', p: { n: photos } }) : notSet}
        tone={photos > 0 ? 'default' : 'warn'}
        chevron
        onPress={() => onOpenDetail('photos')}
      />
      <Row
        label={t('neg.rowCost')}
        value={rec.priced ? rec.amount : t('erec.priceToCome')}
        tone={rec.priced ? 'default' : 'warn'}
        chevron
        onPress={() => onOpenDetail('cost')}
      />
      <Row
        label={t('neg.rowSchedule')}
        value={term(terms.scheduleEffect)}
        tone={tone(terms.scheduleEffect)}
        chevron
        onPress={() => onOpenDetail('schedule')}
      />
      <Row
        label={t('neg.rowBilling')}
        value={term(terms.billingTiming)}
        tone={tone(terms.billingTiming)}
        chevron
        onPress={() => onOpenDetail('billing')}
      />
      <Row
        label={t('neg.rowExclusions')}
        value={term(terms.exclusions)}
        tone={tone(terms.exclusions)}
        chevron
        onPress={() => onOpenDetail('exclusions')}
      />
      <Text style={[T.bodySteel, st.footnote]}>{t('neg.docFrozen')}</Text>
    </Section>
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
  return (
    <Section title={t('neg.recentActivity')}>
      {recent.length === 0 && (
        <Text style={[T.bodySteel, st.empty]}>{t('neg.nothingYet')}</Text>
      )}
      {recent.map((h, i) => (
        <TimelineRow
          key={`${h.at}-${i}`}
          at={h.at}
          what={h.what}
          hot={h.hot}
          last={i === recent.length - 1}
        />
      ))}
      <Row
        icon="history"
        label={t('neg.viewHistory')}
        chevron
        onPress={onViewHistory}
      />
    </Section>
  );
}

/* ----------------------------------------------------------------- styles -- */

const st = StyleSheet.create({
  page: { padding: 18, paddingTop: 0, paddingBottom: 60 },
  kicker: { marginTop: 8 },
  moneyRow: { flexDirection: 'row', alignItems: 'baseline', gap: 9, marginTop: 6 },
  money: { fontSize: 30, color: C.ink },
  priceToCome: { fontSize: 24, color: C.steel, marginTop: 6 },
  onPhone: { fontSize: 12, marginTop: 6 },

  block: { marginTop: 14 },
  pillRow: { flexDirection: 'row', marginBottom: 10 },
  stacked: { marginTop: 8 },
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
