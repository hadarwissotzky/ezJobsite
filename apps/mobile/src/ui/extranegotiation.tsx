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
import { ActionSheetIOS, Animated, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ExtraRecord } from '../record';
import { truncate, type ThreadState } from '../discussion';
import type { RemindVerdict } from '../remind';
import { chipKey, displayStatus, type LedgerStatus } from '../extrastatus';
import { currentLang, t } from '../i18n';
import { copyLink } from '../copylink';
import { mergeDictation, startDictation } from '../livedictation';
import { DiscussionLog } from './threadscreen';
import { PeopleInvolved, rosterOf } from './peopleinvolved';
import { RecordingsCard } from './recordings';
import { Icon, type IconName } from './icon';
import {
  APP_NAME, BottomSheet, Button, CostBreakdown, MoneyBlock, Card, Chip, Section, PersonRow as PersonRowView, Row,
  ScreenHeader, PhotoGrid, StatusBanner, TimelineRow, type PhotoTile,
} from './kit';
import { C, F, T, money as moneyStyle, tint } from './theme';
import { radii, shadows, touchTargets } from './tokens';

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
  /**
   * Send the reminder. Resolves with what actually happened, not just whether the app
   * was willing: `sent` is how many people were TEXTED and `of` how many the extra was
   * sent to (hadar, 2026-08-14 — a reminder resends to the same people).
   *
   * Both are reported because "reminded Sarah" and "reminded nobody, we have no number
   * for her" must not read the same on the one screen whose whole job is telling him
   * who he is waiting on.
   */
  onRemind: () => Promise<{ ok: boolean; why?: string; sent?: number; of?: number }>;
  /** Hands off to the priced read-back composer. This screen never issues a price
   *  itself (mandate #2). */
  onRevise: () => void;
  /** Withdraw a sent extra nobody has answered (421). Omitted where it is not
   *  available — an approved or declined extra is past withdrawing. */
  onWithdraw?: () => void;
  /**
   * HOW MANY MESSAGES HE HAS NOT SEEN on this record, for the badge on the Messages
   * tab (hadar, 2026-08-25: "the message tab should have an indicator with the number
   * of new messages like the notification icon on the top right"). 0 renders nothing.
   */
  unreadMessages?: number;
  /** Called the first time the conversation is actually opened, so the badge above can
   *  stop claiming something is waiting once he has seen it. */
  onMessagesSeen?: () => void;
  /**
   * OPEN ON THE CONVERSATION (2026-08-25). A counter bumped by App when the record was
   * reached by tapping a client-message push, so the sheet is already up rather than
   * one tap behind the thing the phone buzzed about. Undefined or 0 changes nothing.
   */
  openMessages?: number;
  /**
   * THE LIVE CLIENT LINK, so he can copy it and email it himself (hadar 2026-08-24).
   *
   * Read from `co_live_link`, which holds exactly one live token per extra — copying
   * hands over the SAME URL Remind texts and mints nothing. Null on an extra whose link
   * never minted; the row then says so instead of offering a Copy that does nothing.
   */
  linkUrl?: string | null;
  /** Why the client was never told, when the send itself succeeded. */
  deliverFailWhy?: string | null;
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
  /** Add another person on the chain. The record is frozen, but WHO IS REACHABLE on
   *  the job is not part of the instrument — adding an inspector mid-negotiation
   *  changes nothing the client signed. */
  onAddContact?: () => void;
  /** Pick a photo already in the roll, for a message. Committed by the caller, which
   *  returns its capture id — the composer never holds undurable bytes. */
  onPickPhoto?: () => Promise<string | null>;
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
  // A refused or failed action's reason. This screen has no other status surface,
  // and a button that silently does nothing is the failure this repo names most.
  const [actionNote, setActionNote] = React.useState<string | null>(null);
  // The active pane under the waiting card (Info / Activity). Messages is NOT one of
  // them any more — see `msgOpen`.
  const [tab, setTab] = React.useState<NegTab>('info');
  /**
   * MESSAGES IS A SHEET, NOT A PANE (hadar 2026-08-13: "messages should be full screen
   * once it is clicked on, or 90% of the visual screen — it needs to be a bottom popup
   * to maximise the screen view").
   *
   * As a tab it inherited everything above and below it: the header, the price, the
   * waiting banner with its Remind button, the tab bar itself, and the anchored
   * Change & resend / Add photo bar. On a 375pt screen that left the conversation about
   * a third of the height — a reply box and roughly two messages — while the rest of the
   * screen repeated facts the reader had already read on the way down.
   *
   * A conversation is the one thing on this record that grows without limit and is read
   * in sequence. It needs the height. The sheet takes 90%, puts the composer in the
   * footer where the keyboard pushes against it rather than over it, and leaves the
   * record underneath exactly as it was for when it closes.
   */
  const [msgOpen, setMsgOpen] = React.useState(false);
  // DEV ONLY — open the sheet from the inspector. Reviewing it otherwise needs a tap
  // on the Messages tab, and the review machinery has no fingers.
  React.useEffect(() => {
    if (__DEV__) {
      (globalThis as any).__msgSheet = (on?: boolean) => setMsgOpen(on !== false);
    }
  }, []);

  /**
   * ARRIVED FROM A MESSAGE NOTIFICATION — open the sheet.
   *
   * Compared against what this screen has ALREADY acted on, not against a boolean:
   * the record stays mounted while the props change, so a flag would either fire on
   * every open or refuse to fire twice for two consecutive questions. Starting the
   * ref at 0 and the counter at 0 is what keeps an ordinary open silent.
   */
  // Opening the conversation IS seeing it. Fires on the transition to open, not on
  // every render while it is open.
  const wasMsgOpen = React.useRef(false);
  React.useEffect(() => {
    if (msgOpen && !wasMsgOpen.current) props.onMessagesSeen?.();
    wasMsgOpen.current = msgOpen;
  }, [msgOpen, props]);

  const actedOnMsgNonce = React.useRef(0);
  React.useEffect(() => {
    const n = props.openMessages ?? 0;
    if (n === 0 || n === actedOnMsgNonce.current) return;
    actedOnMsgNonce.current = n;
    setMsgOpen(true);
  }, [props.openMessages]);

  // The ⋯ nav overflow — the design carries it on this screen. It offers the two acts
  // that are not one-tap on the page itself: revise & resend, and the full history.
  // The ⋯ nav overflow — the design carries it on this screen. It offers the two acts
  // that are not one-tap on the page itself: revise & resend, and the full history.
  //
  // WITHDRAW IS NOT HERE. It was, briefly; it now sits at the bottom of the page beside
  // where the draft screen puts its delete — see the note there. One entry point, not
  // two, so the two cannot disagree about when it is offered.
  const showOverflow = React.useCallback(() => {
    ActionSheetIOS.showActionSheetWithOptions(
      { options: [t('neg.reviseShort'), t('neg.viewHistory'), t('common.cancel')], cancelButtonIndex: 2 },
      (i) => { if (i === 0) props.onRevise(); else if (i === 1) props.onViewHistory(); },
    );
  }, [props]);

  const who = approver?.name ?? null;

  const remind = async () => {
    const r = await props.onRemind();
    // THE OUTCOME IS THE CALLER'S TO ANNOUNCE (hadar, 2026-08-15). It owns the ack
    // popup, which is a surface this screen cannot reach and — unlike this caption —
    // one he actually sees. Saying it in both places would be the same sentence
    // twice, in two type sizes, in two places on one screen.
    setActionNote(null);
  };

  /**
   * Reply now OPENS THE SHEET rather than scrolling to a block on the page.
   *
   * It used to scroll to `discussionY` and focus the composer, because focusing a field
   * that is off-screen pops the keyboard over nothing and the tap looks like it did
   * apparently nothing. The sheet removes that whole problem: there is nowhere to
   * scroll to, so there is nothing to get wrong. The focus is deferred one tick so the
   * composer exists to receive it — focusing through a Modal that has not mounted is
   * the same silent no-op in a different costume.
   */
  const toReply = () => {
    setMsgOpen(true);
    setTimeout(() => composerInput.current?.focus(), 350);
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
        {/* THE HEADER SLAB — three surfaces on this screen, not one (hadar, 2026-08-14:
            "there is a lack of distinction between the message section which is green
            and the menu below it and the people section... make a more distinctive
            difference between what is clearly a messaging area in the header and the
            actual functional part of the form").
            He is describing a flat rhythm. Everything below the nav row was a cream
            card on a cream page, separated by the same 10pt gap: the price, the green
            waiting block, the tab bar, People, Scope. Five equal beats, so nothing told
            the eye where the STATE of the extra stopped and the RECORD began — and the
            tab bar, which is navigation, wore exactly the same costume as the two cards
            it sits between.
            Three surfaces now do that work, and each one means one thing:
              · HEADER  — what this is, what it costs, where it stands. Card-coloured,
                          full-bleed, closed by a rule and a shadow. The green waiting
                          block lives INSIDE it, because it is status, not content.
              · CONTROL — the tab bar, on the muted track, on the cream page. No border,
                          no card: it is the boundary between the two regions.
              · CONTENT — bordered cards on cream, as before. */}
        <View style={st.headerSlab}>
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
          linkUrl={props.linkUrl ?? null}
          deliverFailWhy={props.deliverFailWhy ?? null}
          onReply={toReply}
          onRevise={props.onRevise}
          note={actionNote}
        />

        </View>

        <TabBar active={tab} unreadMessages={props.unreadMessages ?? 0}
          onChange={(k) => {
            if (k === 'messages') setMsgOpen(true);
            // ONE history popup, not two. This briefly had its own Activity sheet
            // showing `rec.history`, with a button opening the full history over the
            // top of it — a second sheet on a first, and two different renderings of
            // the same question. `onViewHistory` opens the richer one (the merged
            // local+server timeline plus the signed instrument), which is now itself a
            // bottom sheet, so the tab and the ⋯ and the version row all land in the
            // same place.
            else if (k === 'activity') props.onViewHistory();
            else setTab(k);
          }} />

        {/* INFO — who is on the record and what the record says. Recent activity is NOT
            here (hadar): it lives under the Activity tab, not on the Info page. */}
        {tab === 'info' && (
          <>
            {/* The SHARED section — same component, same look, same slot as the draft
                and sealed screens (hadar, 2026-08-14). */}
            <PeopleInvolved
              people={rosterOf(approver, props.contributors)}
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

        {/**
          * WITHDRAW, AT THE BOTTOM — the same place and the same shape as "Delete this
          * extra" on the draft screen (hadar, 2026-08-24: "lets keep consistant and
          * place it at the bottom of the co").
          *
          * It was in the ⋯ overflow. That is where the draft's delete used to live too,
          * and it was moved out for the reason CLAUDE.md §1 gives: a destructive action
          * hidden behind a glyph is not discoverable by someone who does not think in
          * software. The overflow is where a thing goes to be tidy, not to be found.
          *
          * A quiet text link, not a filled red button: it must be findable without
          * competing with Remind and Reply, which are what he is usually here to do.
          * Nothing is withdrawn by tapping it — `onWithdraw` opens the confirmation that
          * names both consequences first (mandate #2). 44pt, mandate #3.
          */}
        {props.onWithdraw && (
          <Pressable
            onPress={props.onWithdraw}
            accessibilityRole="button"
            accessibilityLabel={t('cancel.action')}
            style={({ pressed }) => [st.withdrawBtn, pressed && { opacity: 0.6 }]}
          >
            <Text style={st.withdrawLabel}>{t('cancel.action')}</Text>
          </Pressable>
        )}

      </ScrollView>

      {/* THE CONVERSATION, AT 90% OF THE SCREEN. Outside the ScrollView and outside
          the bottom bar: it is a sheet over the record, not a pane inside it.
          The composer goes in `footer`, which BottomSheet pins under the scrolling
          content and inside its KeyboardAvoidingView — so the keyboard pushes the
          reply box up instead of covering it. */}
      <BottomSheet visible={msgOpen} tall bottomAnchored stickToEnd title={t('neg.tabMessages')}
        onClose={() => setMsgOpen(false)}
        footer={thread.canReply
          ? <ReplyComposer inputRef={composerInput} onReply={props.onReply}
              who={who ? firstName(who) : null}
              onSnapPhoto={props.onSnapPhoto}
              onPickPhoto={props.onPickPhoto} onAddContact={props.onAddContact} />
          : <ClosedThread onNewLinkedExtra={props.onNewLinkedExtra} />}>
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
          <Text style={[T.bodySteel, st.empty]}>{t('r5b.noMessages')}</Text>
        )}
      </BottomSheet>

      {/* Change & resend · Add photo or voice note — ANCHORED at the bottom of the
          screen on every tab, outside the scroll content. */}
      <View style={st.bottomBar}>
        {thread.canRevise && (
          <Button
            label={t('neg.changeResend')}
            icon="edit"
            variant="neutral"
            onPress={props.onRevise}
            compact
            style={st.afterBtnRevise}
          />
        )}
        {props.onCapture && (
          <Button
            label={t('neg.addEvidence')}
            icon="photocam"
            variant="neutral"
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
    <>
      <MoneyBlock
        amount={rec.amount}
        subtitle={`${mode}${rec.isMini ? ` · ${t('erec.mini')}` : ''} · ${t('erec.yourPrice')}`}
      />
      <CostBreakdown
        lines={rec.costLines}
        total={rec.amount}
        label={t('cost.breakdown')}
        totalLabel={t('cost.total')}
      />
    </>
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
  /** The live client link, for the copy row. Absent on an extra whose link never
   *  minted — the row then says that rather than offering a dead Copy. */
  linkUrl?: string | null;
  /** Why the client was never told, when the send itself succeeded. */
  deliverFailWhy?: string | null;
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
            // REFUSED, NOT DEAD (hadar, 2026-08-17: "the remind button is not
            // clickable"). It still looks off, but the tap now reaches `remindExtra`,
            // which re-checks the same rule and returns the reason — and the caller
            // puts that in the bottom ack popup, which he sees. The caption below
            // stays for anyone reading before tapping.
            refused={refusal !== null}
            style={st.remindInCard}
          />
        )}
        {refusal !== null && (
          <Text style={[st.mechanism, st.mechanismWarn]}>{refusal}</Text>
        )}
        {/* THE SAME LINK, AS A LINK (hadar, 2026-08-24: "user should be able to have
            access and copy the client portal CO link in case they need to send it via
            email"). Remind composes a text message, which is the right default and is
            not the only way a link travels — an email address, an assistant, a lender.
            Inside this card and under Remind on purpose: this is what he reaches for
            when the text did not land, which is the state this whole card is about. */}
        {/* THE TEXT DID NOT LAND, SAID OUT LOUD (Codex, 2026-09-03).
            `sendPricedApproval` marks the extra sent, writes the 'sent' actor and
            returns success as soon as the INSTRUMENT exists — which is correct, it does
            exist and it is signable. The SMS is the last mile and it can fail on its
            own. When it did, one dismissible sheet said so and then nothing anywhere
            remembered: the record read "waiting on them", which quietly blames a client
            who was never told there was anything to look at.
            Above the copy row on purpose — that row is the fix, and this is the reason
            he needs it. */}
        {props.waiting !== 'settled' && !!props.deliverFailWhy && (
          <Text style={[st.mechanism, st.mechanismWarn]}>{t('r5c.notTold')}</Text>
        )}
        {props.waiting !== 'settled' && <CopyLinkRow url={props.linkUrl ?? null} />}
      </View>

      {props.note !== null && <Text style={st.failure}>{props.note}</Text>}
    </View>
  );
}

/**
 * The client's link, shown and copyable.
 *
 * IT SHOWS THE URL. A bare "Copy link" button asks a contractor to trust that something
 * invisible happened; seeing the address he is about to paste is what makes the button
 * believable, and it is the only place in the app the link is legible at all.
 *
 * THE CONFIRMATION IS THE BUTTON. It becomes "Copied" for a moment rather than raising a
 * toast over the screen — the hand is already on the button, so that is where the answer
 * belongs, and it costs no extra touch (mandate #3).
 *
 * A FAILURE IS SAID OUT LOUD. `copyLink` refuses a missing or relative URL and reports a
 * pasteboard that would not take it; showing "Copied" over an empty clipboard would send
 * him to an email with nothing to paste and no idea why.
 */
function CopyLinkRow({ url }: { url: string | null }) {
  const [state, setState] = React.useState<'idle' | 'copied'>('idle');
  const [failure, setFailure] = React.useState<string | null>(null);
  // Clear the "Copied" label without leaving a timer behind on a screen he navigated
  // away from.
  React.useEffect(() => {
    if (state !== 'copied') return;
    const h = setTimeout(() => setState('idle'), 2200);
    return () => clearTimeout(h);
  }, [state]);

  const press = async () => {
    setFailure(null);
    const r = await copyLink(url);
    if (r.ok) { setState('copied'); return; }
    // `r8.noLink` and `link.notConfigured` are message keys; anything else is the
    // pasteboard's own words, which are more useful than a generic sentence.
    setFailure(r.reason === 'r8.noLink' || r.reason === 'link.notConfigured'
      ? t(r.reason as 'r8.noLink') : r.reason);
  };

  return (
    <View style={st.linkRow}>
      <Text style={st.linkLabel}>{t('link.clientLink')}</Text>
      <View style={st.linkLine}>
        <Text style={st.linkUrl} numberOfLines={1} ellipsizeMode="middle">
          {url || t('link.none')}
        </Text>
        <Pressable
          onPress={() => { void press(); }}
          disabled={!url}
          hitSlop={8}
          style={({ pressed }) => [st.linkBtn, pressed && { opacity: 0.6 }, !url && { opacity: 0.4 }]}
        >
          <Icon name={state === 'copied' ? 'approved' : 'ntClipboard'} size={14} color={C.brand} />
          <Text style={st.linkBtnText}>
            {state === 'copied' ? t('link.copied') : t('link.copy')}
          </Text>
        </Pressable>
      </View>
      {/* Says what the link IS, because "copy" alone does not answer the question a
          contractor actually has: whether pasting this into an email makes a second,
          competing link. It does not — there is only ever one (250_one_live_link). */}
      <Text style={st.linkHint}>{failure ?? t('link.sameLinkHint')}</Text>
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
      <Icon name="cloud" size={15} color={C.steel} />
      <Text style={st.syncedT}>{t('neg.synced')}</Text>
    </View>
  );
}

type NegTab = 'info' | 'messages' | 'activity';
function TabBar({ active, onChange, unreadMessages = 0 }: {
  active: NegTab; onChange: (t: NegTab) => void; unreadMessages?: number;
}) {
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
            // The badge is a shape; VoiceOver needs the fact said.
            accessibilityLabel={tb.key === 'messages' && unreadMessages > 0
              ? `${tb.label}, ${unreadMessages} new` : tb.label}
          >
            <Text style={[st.tabT, on && st.tabTOn]}>{tb.label}</Text>
            {/* The count rides ON the tab, not beside it, so it moves with the label
                and cannot drift out of the segment when the tracking changes. */}
            {tb.key === 'messages' && unreadMessages > 0 && (
              <View style={st.tabBadge}>
                <Text style={st.tabBadgeT}>{unreadMessages > 99 ? '99+' : unreadMessages}</Text>
              </View>
            )}
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
function ReplyComposer({ inputRef, onReply, who, onSnapPhoto, onPickPhoto,
                         onAddContact }: {
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
  /** Pick an existing photo — the one taken before anyone opened this app. Returns its
   *  committed capture id, or null when the picker was cancelled. */
  onPickPhoto?: () => Promise<string | null>;
  /** Add somebody to this record. The third entry behind the plus. */
  onAddContact?: () => void;
}) {
  const [draft, setDraft] = React.useState('');
  const [shots, setShots] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [snapping, setSnapping] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  /**
   * THE COMPOSER SWAPS ITS RIGHT-HAND CONTROLS AS YOU TYPE (hadar 2026-08-13, with a
   * WhatsApp screenshot: "at the state of no text you see what I gave you; once you
   * start to type the buttons on the right are swiped to the right and hidden and the
   * send image is displayed — the goal is to maximise screen space").
   *
   * Empty: camera + voice, no send — there is nothing to send, and a permanently
   * greyed send button is a control that spends its life saying no.
   * Typing: those two slide right and collapse, send slides in, and the field takes
   * back the ~124pt they were holding. On a 375pt screen that is a third of the row.
   *
   * `useNativeDriver: false` because WIDTH is what animates. Width is not a transform
   * and cannot go to the native thread; opacity and translateX ride along on the same
   * value so the two halves move together rather than cross-fading in place.
   */
  // DEV ONLY — type into the composer from the inspector, to review the swap without
  // a keyboard. The draft is component state; there is no other way in.
  React.useEffect(() => {
    if (__DEV__) {
      (globalThis as any).__composerType = (v: string) => setDraft(v);
      (globalThis as any).__attachTray = (on?: boolean) => setAttachOpen(on !== false);
    }
  }, []);
  /**
   * THE PLUS, AND WHAT IT OPENS (hadar 2026-08-13).
   *
   * While typing, the two standalone shortcuts give way to ONE plus — their jobs move
   * behind it, alongside the two that had no door at all: a photo already in the roll,
   * and adding a person to this record. Tapping it opens the tray and turns the plus
   * into a close, which dismisses the tray and puts the keyboard back.
   *
   * THE ICON IS A ROTATED PLUS, NOT A KEYBOARD. hadar asked for a keyboard glyph and
   * the icon set has none — every icon here is a PNG asset, and inventing one is not
   * something this change can do honestly. A plus rotated 45° is the same affordance
   * stated with what exists: it says "close this", and closing it is what returns the
   * keyboard. Swap in a keyboard asset and this becomes a one-line change.
   */
  const [attachOpen, setAttachOpen] = React.useState(false);

  /**
   * DICTATION — the mic fills the field as you speak (hadar 2026-08-13).
   *
   * The mic used to call `augmentExtra`, which edits the CHANGE ORDER's description. In
   * a message composer that is the wrong act twice over: it is not a message, and a
   * control drawn as a microphone silently editing the document a client is being asked
   * to sign is the kind of surprise this app exists to remove. That door still exists —
   * "Add photo or note" in the record's own bottom bar — so nothing is lost.
   *
   * WHILE LISTENING THE RIGHT-HAND CONTROLS BECOME ONE STOP BUTTON. Without that the
   * mic would vanish the instant the first word landed (the shortcuts hide as soon as
   * there is text) and there would be no way to end what you started.
   *
   * NOTHING SENDS ITSELF. Dictation fills the field and stops there — the words are a
   * machine's reading of a voice, and a transcript that posted itself would be exactly
   * the unconfirmed claim mandate #2 forbids. He reads it, then he presses send.
   */
  const [listening, setListening] = React.useState(false);
  const dictation = React.useRef<{ stop: () => void } | null>(null);
  const dictBase = React.useRef('');

  const stopDictation = React.useCallback(() => {
    dictation.current?.stop();
    dictation.current = null;
    setListening(false);
  }, []);

  // A recogniser left running when this unmounts holds the microphone — and the sheet
  // closing is exactly when somebody stops thinking about it.
  React.useEffect(() => () => { dictation.current?.stop(); }, []);

  const startListening = async () => {
    if (listening) { stopDictation(); return; }
    setError(null);
    dictBase.current = draft;
    setListening(true);
    const r = await startDictation({
      lang: currentLang() === 'es' ? 'es-US' : 'en-US',
      onText: (heard) => setDraft(mergeDictation(dictBase.current, heard)),
      onEnd: (refusal) => {
        dictation.current = null;
        setListening(false);
        if (refusal) {
          setError(t(refusal === 'denied' ? 'neg.dictDenied'
            : refusal === 'unsupported' ? 'neg.dictUnsupported' : 'neg.dictFailed'));
        }
      },
    });
    if ('refused' in r) {
      setListening(false);
      setError(t(r.refused === 'denied' ? 'neg.dictDenied'
        : r.refused === 'unsupported' ? 'neg.dictUnsupported' : 'neg.dictFailed'));
      return;
    }
    dictation.current = r;
  };
  const toggleAttach = () => {
    setAttachOpen((o) => {
      if (o) setTimeout(() => inputRef.current?.focus(), 60);
      return !o;
    });
  };
  const pick = async () => {
    if (!onPickPhoto || snapping) return;
    setSnapping(true);
    try {
      const id = await onPickPhoto();
      if (id) { setShots((s) => [...s, id]); setError(null); setAttachOpen(false); }
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally { setSnapping(false); }
  };

  const hasText = draft.trim().length > 0 || shots.length > 0;
  // Listening pins the row in its EMPTY layout so the stop button can own the space —
  // otherwise the first dictated word would slide the controls out from under the
  // thumb that is about to press stop.
  const swapped = hasText && !listening;
  const swap = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    Animated.timing(swap, {
      toValue: swapped ? 1 : 0, duration: 160, useNativeDriver: false,
    }).start();
  }, [swapped, swap]);
  // Camera (when the caller has one) + the mic, which is always there because
  // dictation needs no wiring from above — it talks to the phone.
  const ICONS_W = (onSnapPhoto ? 46 + 8 : 0) + 46;
  // Typing swaps two shortcuts for a plus and a send — 100pt of controls for 100pt of
  // controls, so the field's gain comes from the gap between them, not from the count.
  const TYPING_W = 46 + 8 + 46;
  const iconsStyle = {
    width: swap.interpolate({ inputRange: [0, 1], outputRange: [ICONS_W, 0] }),
    opacity: swap.interpolate({ inputRange: [0, 0.6, 1], outputRange: [1, 0, 0] }),
  };
  const sendStyle = {
    width: swap.interpolate({ inputRange: [0, 1], outputRange: [0, TYPING_W] }),
    opacity: swap.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 0, 1] }),
  };

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

  // The field, a camera shortcut, a voice shortcut and send — ONE ROW, matching the
  // design's `.replybar`. No Card around it any more: the composer lives in the
  // Messages sheet's footer, which already draws its own top rule and padding, so the
  // card added a second border and a second background inside a bar that the design
  // draws bare.
  return (
    <View>
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
      {/* THE TRAY. Above the row, where the panel a plus opens belongs — not over the
          conversation, which is the thing the sheet exists to show. */}
      {attachOpen && (
        <View style={st.tray}>
          {onSnapPhoto && (
            <Pressable style={st.trayItem} onPress={() => { setAttachOpen(false); void snap(); }}
              accessibilityRole="button">
              <View style={st.trayDisc}><Icon name="photocam" size={22} color={C.ink} /></View>
              <Text style={st.trayT}>{t('neg.trayCamera')}</Text>
            </Pressable>
          )}
          {onPickPhoto && (
            <Pressable style={st.trayItem} onPress={() => { void pick(); }}
              accessibilityRole="button">
              <View style={st.trayDisc}><Icon name="image" size={22} color={C.ink} /></View>
              <Text style={st.trayT}>{t('neg.trayPhotos')}</Text>
            </Pressable>
          )}
          {onAddContact && (
            <Pressable style={st.trayItem} onPress={() => { setAttachOpen(false); onAddContact(); }}
              accessibilityRole="button">
              <View style={st.trayDisc}><Icon name="personAdd" size={22} color={C.ink} /></View>
              <Text style={st.trayT}>{t('neg.trayContact')}</Text>
            </Pressable>
          )}
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

        {/* The two shortcuts, in a container whose WIDTH is what collapses. `overflow:
            hidden` is what turns a shrinking box into a swipe-out — without it the
            buttons would simply overlap the field on their way past it. */}
        <Animated.View style={[st.swapBox, iconsStyle, listening && { width: 0 }]}>
          <View style={st.swapRow}>
            {onSnapPhoto && (
              <Pressable onPress={() => { void snap(); }} accessibilityRole="button"
                disabled={snapping}
                accessibilityLabel={t('neg.photoInMessage')}
                style={[st.iconBox, snapping && { opacity: 0.5 }]}>
                <Icon name="photocam" size={20} color={C.ink} />
              </Pressable>
            )}
            {/* THE MIC DICTATES. It does not record a voice note and it does not open
                the change order — see the note on `listening`. */}
            <Pressable onPress={() => { void startListening(); }} accessibilityRole="button"
              accessibilityLabel={t('neg.dictate')} style={st.iconBox}>
              <Icon name="micLine" size={22} color={C.ink} />
            </Pressable>
          </View>
        </Animated.View>

        {/* LISTENING: one stop button, holding the place the shortcuts had. */}
        {listening && (
          <Pressable onPress={stopDictation} accessibilityRole="button"
            accessibilityLabel={t('neg.dictStop')} style={st.stopBtn}>
            <Icon name="pause" size={20} color="#fff" />
          </Pressable>
        )}

        {/* The plus and send appear together, only when there is something to send. */}
        <Animated.View style={[st.swapBox, sendStyle, listening && { width: 0 }]}>
          <View style={st.swapRow}>
            <Pressable onPress={toggleAttach} accessibilityRole="button"
              accessibilityState={{ expanded: attachOpen }}
              accessibilityLabel={attachOpen ? t('neg.attachClose') : t('neg.attachOpen')}
              style={st.iconBox}>
              <View style={attachOpen ? { transform: [{ rotate: '45deg' }] } : undefined}>
                <Icon name="ntPlus" size={20} color={C.ink} />
              </View>
            </Pressable>
            <Pressable onPress={() => { void send(); }} accessibilityRole="button"
              accessibilityLabel={busy ? t('r5b.sending') : t('r5b.send')}
              disabled={!hasText || busy}
              style={st.sendBtn}>
              <Icon name="send" size={20} color="#fff" />
            </Pressable>
          </View>
        </Animated.View>
      </View>
      {error !== null && <Text style={st.failure}>{error}</Text>}
    </View>
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
    // A Card with a hand-drawn title and no rule under it — the same divergence the
    // scope block had, one screen over. `Section` draws both (hadar 2026-08-24).
    <Section title={t('neg.closedTitle')}>
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
    </Section>
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
  // real values on the right. Activity is no longer among them — it is a sheet.
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
  /** Deliberately identical to `deleteBtn`/`deleteLabel` on the draft screen: the same
   *  act at the same place on the next stage should not look like a different kind of
   *  thing. `marginTop` separates it from the last card so it reads as an action on the
   *  record rather than the tail of the version row above it. */
  withdrawBtn: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  withdrawLabel: { fontFamily: F.bodySemi, fontSize: 15, color: C.danger },

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

  // The copy-link row, inside the waiting card under Remind. Separated by a hairline
  // rather than its own box: it is a second way to do the same errand, not a second
  // subject.
  linkRow: { marginTop: 12, paddingTop: 11, borderTopWidth: 1, borderTopColor: C.brandLine },
  linkLabel: {
    fontFamily: F.body, fontSize: 11, fontWeight: '700', color: C.steel,
    letterSpacing: 0.6, textTransform: 'uppercase',
  },
  linkLine: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 5 },
  // The URL yields; the button never shrinks. A half-visible Copy is not a control.
  linkUrl: {
    flex: 1, minWidth: 0, fontFamily: F.body, fontSize: 12.5, color: C.ink,
  },
  linkBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingVertical: 7, paddingHorizontal: 11,
    borderRadius: 8, borderWidth: 1, borderColor: C.brandLine, backgroundColor: C.raised,
  },
  linkBtnText: { fontFamily: F.body, fontSize: 13, fontWeight: '700', color: C.brand },
  linkHint: { fontFamily: F.body, fontSize: 12, color: C.steel, marginTop: 6, lineHeight: 16 },

  // The Info / Messages / Activity segmented control. One track; the active segment is
  // filled brand-green with light text, the rest are quiet. Tight padding so the active
  // pill fills the track height (the design's selection is a full-height segment).
  /**
   * THE HEADER SLAB. Full-bleed (the page pads 18 and this cancels it) so it runs
   * edge to edge like a header and not like a wide card, closed by a hairline and a
   * shadow so the content below is visibly UNDER it rather than next in a list.
   *
   * `C.card` against the page's `C.paper` is a quiet warm shift, not a colour change —
   * enough to zone the region without competing with the green block inside it, which
   * has to stay the loudest thing on the screen.
   */
  headerSlab: {
    backgroundColor: C.card,
    marginHorizontal: -18, paddingHorizontal: 18, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: C.line,
    ...shadows.card,
  },
  /**
   * THE TAB BAR IS A CONTROL, NOT A CARD.
   *
   * It had a card's costume — `C.card` fill, a border, radius 12 — sitting between two
   * actual cards with the same fill, border and radius, at the same 10pt gap. Three
   * identical boxes in a row, one of which was navigation.
   * On the muted track it reads as a segmented control, which is what it is: iOS's own
   * pattern, and the one thing on the page a contractor is meant to recognise without
   * reading. The wider space above and below is the second half of the job — it is the
   * seam between the header region and the record, so it gets more air than the 10pt
   * rhythm the content cards share.
   */
  tabBar: {
    flexDirection: 'row', gap: 4, marginTop: 18, marginBottom: 6, padding: 3,
    borderRadius: 12, backgroundColor: C.surfaceMuted,
  },
  tab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, minHeight: 40, borderRadius: 9,
  },
  /**
   * THE UNREAD COUNT ON THE MESSAGES TAB. Same red as the header bell's badge and the
   * card's dot (#cf222e) — one colour for "something is waiting", wherever it is said.
   *
   * A count here and a dot on the card is not an inconsistency: a card answers "is
   * anything waiting on this record", and by the time he is looking at the tab he has
   * already chosen the record, so the useful question becomes "how many".
   */
  tabBadge: {
    minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5,
    backgroundColor: '#cf222e', alignItems: 'center', justifyContent: 'center',
  },
  tabBadgeT: { color: '#fff', fontSize: 11, fontFamily: F.bodyBold },
  // A RAISED PILL, NOT A GREEN ONE. The selected tab was filled `C.brand`, which put a
  // second solid green on a screen whose state band is already green (hadar,
  // 2026-08-14). A light pill lifted off the muted track is iOS's own segmented
  // control and needs no colour to say "you are here".
  tabOn: { backgroundColor: C.raised, borderWidth: 1, borderColor: C.line },
  tabT: { fontFamily: F.bodySemi, fontSize: 14.5, color: C.ink },
  tabTOn: { color: C.ink },

  // The header "Synced" pill (green check on a brand-soft chip).
  syncedPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: C.surfaceMuted, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
  },
  syncedT: { fontFamily: F.bodySemi, fontSize: 12.5, color: C.steel },

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
  viewAll: { fontFamily: F.bodySemi, fontSize: 13, color: C.ink },
  // "PEOPLE INVOLVED" sits INSIDE the card, top-left, above the strip (the design puts
  // the heading in the card, not floating above it).
  // The people strip's styles moved to `peopleinvolved.tsx` with the section itself.
  // Photos staged on the message, before it is sent.
  attachRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  attachChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.brandSoft, borderWidth: 1, borderColor: C.brandLine,
    borderRadius: 999, paddingLeft: 10, paddingRight: 8, paddingVertical: 6,
  },
  attachChipT: { fontFamily: F.bodySemi, fontSize: 13, color: C.brandDark },
  attachX: { fontFamily: F.body, fontSize: 15, color: C.steel, paddingHorizontal: 2 },
  // ── the reply bar, to the design's `.replybar` (applied 2026-08-13) ──
  // 54pt controls on a 12pt radius, a WHITE field, and an INK send. Ours was a 48pt
  // cream field with a round green send: the green read as a third status colour on a
  // screen that already uses green for approved and for money, and cream-on-cream gave
  // the one control you type into no edge of its own.
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  // WIDER AND THINNER (hadar 2026-08-13). It was a 54pt box on a 12pt radius; the
  // reference is a slim pill that grows only when the message does. The height it gives
  // up goes back to the conversation, and the width comes from the two buttons that now
  // collapse while you type.
  composerInput: {
    flex: 1, fontFamily: F.body, fontSize: 15.5, color: C.ink,
    minHeight: 44, maxHeight: 120,
    borderWidth: 1, borderColor: C.line, borderRadius: 22,
    paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11, backgroundColor: '#FFFFFF',
  },
  // Camera + mic each sit in an outlined box that shares the input's corner radius.
  iconBox: {
    width: 46, height: 46, borderWidth: 1, borderColor: C.line, borderRadius: 23,
    backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
  },
  // The animated slot whose WIDTH collapses. `overflow: hidden` is what makes a
  // shrinking box read as a swipe-out rather than as buttons sliding over the field.
  swapBox: { overflow: 'hidden', height: 46, justifyContent: 'center' },
  swapRow: { flexDirection: 'row', gap: 8 },
  // ── the attachment tray behind the plus ──
  // Three equal columns, not a list: they are siblings of the same rank, and a list
  // would rank them by accident of order. Discs match the composer's round controls so
  // the tray reads as an extension of the bar rather than a menu from somewhere else.
  tray: { flexDirection: 'row', paddingBottom: 12, paddingTop: 2 },
  trayItem: { flex: 1, alignItems: 'center', gap: 6, minHeight: touchTargets.minimum },
  trayDisc: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: '#FFFFFF',
    borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center',
  },
  trayT: { fontFamily: F.body, fontSize: 12.5, color: C.steel },
  // The design's send is a SQUARE ink button, not a green circle. Camera and voice are
  // ours — the mock's bar carries only a field and a send — so they take the same 54pt
  // box and sit quiet beside it; the one dark control on the row is the one that sends.
  // Round, like the reference's send. It only exists while there is something to send,
  // so it never needs a disabled state to sit in.
  sendBtn: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: C.ink,
    alignItems: 'center', justifyContent: 'center',
  },
  // Listening. Caution-toned rather than danger: stopping is not destructive, and a red
  // control beside a live microphone reads as "something is wrong".
  stopBtn: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: C.caution,
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
