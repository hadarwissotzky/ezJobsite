/**
 * STAGE 1 — the pre-sent draft. SPEC-extra-lifecycle-v1 §2, D1's first stage.
 *
 * THE GOAL OF THIS SCREEN, in one sentence: make the gap between what has been
 * collected and what will get the owner to say yes completely obvious, and make
 * closing that gap one tap each. Everything below is that sentence rendered.
 *
 * D3 IS THE SHAPE OF THE SCREEN AND THE REASON IT CANNOT BE HONEST BY ACCIDENT.
 * Only DESCRIPTION and COST may disable Send. Photos, payment timing, schedule
 * impact and exclusions warn, render as incomplete, and are sent anyway if the
 * contractor chooses. So no wording here may call a recommendation "required":
 * this is a product for someone whose alternative is a text message, and a
 * checklist that lies about what is mandatory sends him back to the text message —
 * the exact failure the product exists to prevent. Blocking copy and recommended
 * copy are drawn from two different sources (`blockers` vs `recommended`) and are
 * given two different marks (`blocking` brick ring vs `missing` ochre ring), so a
 * future edit cannot quietly merge them into one scolding list.
 *
 * IT DECIDES NOTHING IT COULD ASK. Three orthogonal gates stand between a draft and
 * a client's inbox (REQ-LC13), and this screen composes all three rather than
 * re-deriving any of them:
 *   stage    `canSend(status)`      — is sending legal from this row's stage at all
 *   content  `sendReadiness(...)`   — has he said enough (the caller computes it)
 *   pipeline `canSendExtra(proc)`   — has the evidence left the phone
 * `sendGate` is called HERE, from `readiness` + `proc`, rather than taken as a
 * prop: a caller that passed a pre-composed gate could pass one that disagrees
 * with the readiness driving the checklist, and the screen would show six green
 * ticks over a dead Send button.
 *
 * TWO DIFFERENT REFUSALS, TWO DIFFERENT SENTENCES. A content refusal is something
 * he can fix standing where he is; a pipeline refusal is something he can only
 * wait out. Printing "waiting for signal" at a man whose real problem is that he
 * never said a price sends him to stand by a window for a fault that is on the
 * screen in front of him.
 *
 * NO DATA FETCHING. Everything arrives as props (`ExtraDraftProps`), so the screen
 * is a pure function of the record and can be reasoned about — and so the wiring
 * that assembles it stays in one place instead of growing a second query here.
 */
import React from 'react';
import { ActionSheetIOS, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ExtraRecord } from '../record';
import type { ProcState } from '../status';
import {
  blockerKey, recommendationKey, sendGate,
  type SendBlocker, type SendGate, type SendReadiness, type SendRecommendation,
} from '../sendreadiness';
import { canDelete, canSend, chipKey, displayStatus, stageOf } from '../extralifecycle';
import { canSendExtra } from '../extraprocstate';
import { t } from '../i18n';
import {
  APP_NAME, Button, Card, MoneyBlock, ChecklistRow, PhotoGrid, Row, ScreenHeader, Section,
  StatusBanner, SyncedPill, VoiceClip, type ChecklistState, type PhotoTile, type RowTone,
} from './kit';
import { C, F, T, label as labelStyle, money as moneyStyle, tint } from './theme';
import { shadows, touchTargets } from './tokens';
import { Icon } from './icon';
import { PeopleInvolved, rosterOf } from './peopleinvolved';
import { ScopeBlock } from './scopeblock';
import type { CaptureDelivery } from '../uploader';

const CAUTION = tint('caution');

/** The owner-gap card's amber. Warmer and yellower than `CAUTION` (the peach used for
 *  a draft's incompleteness) on purpose: the two appear on the same screen and mean
 *  different things — peach is "unfinished", this is "nobody can sign this". */
const OWNER_SOFT = '#FCF4E2';
const OWNER_LINE = '#E9D5A6';
const OWNER_MARK = '#C8901E';

const st = StyleSheet.create({
  // Full-bleed (the page pads 18 and this cancels it), closed by a hairline and a
  // shadow so the form below reads as UNDER the header rather than next in a list.
  // Same values as the negotiation and locked screens' — one header, three stages.
  headerSlab: {
    backgroundColor: C.card,
    marginHorizontal: -18, paddingHorizontal: 18, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: C.line,
    ...shadows.card,
  },
  // The draft banner, as the design draws it: a filled ochre disc + the state, then
  // the count and why, then the gaps as tappable "+ Add …" buttons.
  draftBanner: {
    backgroundColor: CAUTION.soft, borderWidth: 1, borderColor: CAUTION.line,
    borderRadius: 12, padding: 13,
  },
  draftHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  draftDisc: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: CAUTION.ink,
    alignItems: 'center', justifyContent: 'center',
  },
  draftTitle: {
    flex: 1, fontFamily: F.disp, fontSize: 19, color: CAUTION.ink,
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  draftCount: { fontFamily: F.bodySemi, fontSize: 14, color: C.ink, marginTop: 10 },
  draftWhy: { fontFamily: F.body, fontSize: 13, color: C.steel, marginTop: 2 },
  // Send, with its reason as a second line inside the button.
  sendBtn: {
    backgroundColor: C.ink, borderRadius: 14, minHeight: 58,
    alignItems: 'center', justifyContent: 'center', paddingVertical: 10,
  },
  // Not merely faded: a paler FILL, so it reads as "not yet" rather than as the same
  // button rendered badly. Text stays legible — the reason is the point.
  sendBtnOff: { backgroundColor: C.steel, opacity: 0.55 },
  heard: { marginTop: 10, gap: 8 },
  heardSaid: { fontFamily: F.body, fontSize: 14, color: C.steel, fontStyle: 'italic' },
  sendTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  // The closing timestamp line. Quiet on purpose: it is provenance, not an action.
  stamp: { marginTop: 22, alignItems: 'center', gap: 2 },
  stampT: { fontFamily: F.body, fontSize: 12.5, color: C.muted, textAlign: 'center' },
  sendLabel: { fontFamily: F.bodyBold, fontSize: 17, color: C.card, letterSpacing: 0.2 },
  sendSub: { fontFamily: F.body, fontSize: 12.5, color: C.card, opacity: 0.72, marginTop: 2, textAlign: 'center' },
  // No fill and no border: Send owns the weight in this bar. 44pt of height is the
  // touch budget (mandate #3), not the ink.
  deleteBtn: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  // Muted until touched: findable without turning a list of people into a row of
  // delete buttons.
  removeX: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  removeXT: { fontFamily: F.body, fontSize: 17, color: C.muted },
  deleteLabel: { fontFamily: F.bodySemi, fontSize: 15, color: C.danger },
  // ── the no-owner card ──
  ownerGap: {
    backgroundColor: OWNER_SOFT, borderWidth: 1, borderColor: OWNER_LINE,
    borderRadius: 14, padding: 14, marginVertical: 4,
  },
  ownerGapDisc: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: '#F7E6BD',
    alignItems: 'center', justifyContent: 'center',
  },
  ownerGapH: { fontFamily: F.bodyBold, fontSize: 19, color: C.ink, letterSpacing: -0.2 },
  ownerGapB: { fontFamily: F.body, fontSize: 15, lineHeight: 21, color: C.steel, marginTop: 2 },
  // White inside the amber, so the ACT is the brightest thing in the card.
  ownerGapBtn: {
    flexDirection: 'row', alignItems: 'center', minHeight: 54, marginTop: 12,
    borderRadius: 10, backgroundColor: C.raised, borderWidth: 1, borderColor: '#EFE3C8',
    paddingHorizontal: 14,
  },
  ownerGapBtnT: { fontFamily: F.bodyBold, fontSize: 18, color: C.brandDark },
  ownerGapChev: { fontFamily: F.body, fontSize: 22, color: C.ink },
  // ── the three pricing modes (design c3) ──
  // Equal thirds, so no mode looks like the default by being wider. The selected one
  // takes the ink border and the darker type; the other two stay quiet. Above the
  // touch-target floor because this is a gloved thumb changing what a client signs.
  modes: { flexDirection: 'row', gap: 8, marginTop: 12 },
  mode: { flex: 1, minHeight: touchTargets.minimum, borderWidth: 1, borderColor: C.line,
    borderRadius: 12, backgroundColor: C.card, paddingVertical: 9,
    paddingHorizontal: 8, justifyContent: 'center' },
  modeOn: { borderColor: C.ink, borderWidth: 1.5, backgroundColor: C.surfaceMuted },
  modeT: { fontFamily: F.bodyBold, fontSize: 14, color: C.steel },
  modeTOn: { color: C.ink },
  modeS: { fontFamily: F.body, fontSize: 11.5, lineHeight: 15, color: C.muted, marginTop: 1 },
  modeSOn: { color: C.steel },
  ownerGapFoot: { fontFamily: F.body, fontSize: 13.5, color: C.muted, marginTop: 10 },
});

export type ExtraDraftProps = {
  /** The assembled record (`extraRecord()`). Its `status` must be 'draft'; when it
   *  is not, the screen says so loudly rather than offering a send it knows the
   *  database will refuse. */
  rec: ExtraRecord;
  /**
   * 'extra' or 'decision', and it changes two things only (REQ-LC12): a Decision
   * shows NO price anywhere (R6b AC2) and has no cost item in the checklist,
   * because a Decision carries no price by definition.
   *
   * EWA IS DELIBERATELY NOT IN THIS UNION. An EWA's blockers are its own terms —
   * `proceed_term`, and `hourly_rate_cents` + `cap_cents` for `tm_capped` — owned
   * by `ewa.ts:validateEwaTerms`, which nothing yet composes into `sendReadiness`.
   * Accepting 'ewa' here would render an authorization whose real blockers this
   * screen cannot see and whose Send button would therefore lie. A compile error
   * at the call site is the loud version of that gap.
   */
  kind: 'extra' | 'decision';
  /** The extra's number within its job, for the kicker ("Extra #4"). Null when the
   *  job does not number them — the kicker then carries kind + job only. */
  extraNo: number | null;
  /** REQ-LC11's single readiness authority, computed by the caller from the same
   *  row this screen renders. Never recomputed here, and never second-guessed. */
  readiness: SendReadiness;
  /** The weakest pipeline state across the extra's captures (`extraProcState`). */
  proc: ProcState;
  /** 'nte' adds the not-to-exceed cap to the money line. R3: T&M always carries one. */
  priceMode: 'fixed' | 'nte';
  /**
   * Tapping one of the three pricing modes under the price. NEVER writes a figure by
   * itself — it opens the cost editor set to that mode, because every mode change
   * moves money and money goes through the read-back (mandate #6). See `PriceModes`.
   */
  onPickPriceMode?: (mode: PriceMode) => void;
  /** The stored flow values, raw (`next_invoice` · `adds_days` · …). Raw and not
   *  pre-formatted so that NULL keeps its one meaning — nobody has answered — which
   *  is the fact the recommended list is counting. */
  billingTiming: string | null;
  scheduleEffect: string | null;
  scheduleDays: number | null;
  exclusions: string | null;
  /** `who_directed` — who asked for the work (REQ-VAL4, recorded at capture). */
  requestedBy: string | null;
  /** How this extra was captured, already formatted ("Voice note · Jul 20, 2:14 pm").
   *  Null when nothing was recorded about the source: a stored fact that is absent is
   *  OMITTED, never shown as "Not set" — "Not set" is an invitation to fill a field,
   *  and this one is evidence, not a field (record.ts's rule). */
  capturedWith: string | null;
  onBack: () => void;
  /** One target per gap. Each opens the editor for exactly that field, because the
   *  screen's promise is that closing a gap is one tap — not one tap into a form
   *  where he then has to find the row again. */
  /** Rename the extra from the header, in place (Stage 1 only — a sent extra is
   *  frozen, REQ-LC15). Omit and the title is not tappable. */
  onRetitle?: (next: string) => void;
  /** Open the client drawer. Falls back to the details editor when unwired. */
  onEditClient?: () => void;
  /** Add another person on the chain, once a client exists. */
  onAddContact?: () => void;
  /** What the client IS on this job — "Homeowner", "General contractor" — already
   *  translated. Null until somebody has answered; the row then falls back to the
   *  generic "Approver" rather than inventing a position nobody chose. */
  clientTypeLabel?: string | null;
  onEditDescription: () => void;
  onEditCost: () => void;
  onEditBilling: () => void;
  onEditSchedule: () => void;
  onEditExclusions: () => void;
  /** The whole details composer — the secondary action, and where "Requested by"
   *  is answered (`co.qWho`). */
  onEditDetails: () => void;
  onAddPhotos: () => void;
  /** Opens the existing lightbox. Omitted = tiles are not tappable; the grid never
   *  grows its own modal, so there is one lightbox in the app, not three. */
  onPressPhoto?: (uri: string) => void;
  onSend: () => void;
  /**
   * Run the write-up again — the button that REPLACES Send while the extra is still
   * in the pipeline (hadar 2026-08-06). Offering a disabled "Send for approval" there
   * asks a man to press the thing he cannot have; this offers the thing he actually
   * wants, which is for the app to get on with reading his recording.
   *
   * Optional: without it the pipeline state still swaps the button, and it renders
   * disabled rather than lying about what a tap would do.
   */
  onGenerate?: () => void;
  /** 396 — the spoken cost, its parsed figure, and the tap that accepts it. Null when
   *  he said no price, or when one is already set. The screen never parses: the caller
   *  owns `parseMoney` so there is one parser in the app, not one per screen. */
  priceHeard?: { words: string; label: string; onUse: () => void } | null;
  /**
   * THE STUCK-EXTRA WORKFLOW (hadar 2026-08-06). Files on the phone but no scope means
   * exactly one of two things, and the user must be able to act on either:
   *   1. the files never got up      → retry, or permit cellular, and it resolves
   *   2. they got up but nothing came back → nothing on this phone can force the
   *      server pass, so the honest out is to write the scope himself
   * `delivery` is the evidence for which one it is; null while it is being read.
   */
  delivery?: CaptureDelivery | null;
  /** Turn on cellular uploading, from the one screen where it is blocking something
   *  the user is looking at. Absent = the setting is only reachable in Settings. */
  onAllowCellular?: () => void;
  /**
   * The OTHER people already on this job (the roster, minus whoever is shown above
   * as "Requested by"). Labels arrive translated — this screen does no t() over
   * role slugs.
   *
   * WHY IT EXISTS (hadar, 2026-08-05: "the section works but the record is not
   * updated upon selection"). "Add someone else" writes a project_approver row and
   * deliberately touches neither `who_directed` nor the extra's actor facts — an
   * inspector does not become the approver. That is right, but it meant the act had
   * NO visible result anywhere: the person went into a list the draft never showed,
   * so adding one read as a no-op. Showing the job's people here is what makes the
   * add land somewhere the eye can find it.
   *
   * DISPLAY ONLY, and that is deliberate. These are not actors on this extra and no
   * evidence row is written for them; extra_actor stays the record of who captured,
   * priced, sent and approved. This is the JOB's contact list, rendered where it is
   * useful.
   */
  jobPeople?: readonly { id: string; name: string; role: string }[];
  /**
   * Take somebody off the job (hadar, 2026-08-05: "i need to be able to remove
   * people from the job"). Swipe-left on their row, same gesture as deleting an
   * extra on Home — the app now has one vocabulary for "get this off my list"
   * rather than a second control invented for the second place.
   *
   * NOT a delete, and the wording says so: `retireApprover` flips status to
   * 'removed' and keeps the row, because an extra already sent to that person
   * still has to resolve their name. Omit and the rows do not move.
   */
  onRemovePerson?: (id: string, name: string) => void;
  /** REQ-LC14 / T5: legal in this stage only. Rendered only when the caller offers
   *  it AND `canDelete` agrees — `planDiscard` remains the arbiter of the act. */
  onDelete?: () => void;
  /** DEV ONLY (__fixturedraft). Scrolls the content to this Y after mount so the
   *  simulator can be screenshotted below the fold without tap access. Never passed
   *  by production; removed with the fixture. */
  _fixtureScrollY?: number;
};

export function ExtraDraftScreen(props: ExtraDraftProps) {
  const { rec, readiness } = props;
  const isDraft = stageOf(rec.status) === 'draft';
  const gate = sendGate(readiness, props.proc);
  // All three gates, and the stage one first: a row that is not a draft is a
  // routing bug, and offering Send there would be the app promising a transition
  // the database has already decided to refuse (REQ-LC7).
  const canSendNow = canSend(rec.status) && gate.ok;
  // STILL IN THE PIPELINE. Not a content gap and not the contractor's to fix — the
  // recording is on its way up, or up and being read. Every "we are not finished
  // yet" on this screen keys off this one value so they cannot disagree.
  const notProcessed = isDraft && props.proc !== 'processed';
  /**
   * HAS ANYONE ACTUALLY WRITTEN THIS UP YET? ASK THE ONE AUTHORITY.
   *
   * `sendReadiness` already decides this — `no_description` fires when the scope is
   * empty, is the machine placeholder (`UNTITLED_SCOPE`), or is under
   * `MIN_SCOPE_OF_WORK_CHARS`. Reading it here means the caption, the empty state, the
   * banner and the Send gate cannot disagree about whether a scope exists.
   *
   * I GOT THIS WRONG TWICE, AND BOTH WRONG VERSIONS ARE WHY (hadar, on device):
   *   1. `!scopeOfWork` — but the column is seeded with a copy of the title at birth,
   *      so it is never empty and every extra looked written.
   *   2. `scopeOfWork !== title` — but the AI RETITLES a draft the moment it is
   *      confident ("Fireplace facing replacement and staining") while leaving
   *      `scope_of_work` as the placeholder. The two then differ, and the check called
   *      an unwritten scope written. That is the exact row this screen was failing on.
   * Both were me re-deriving a rule that already existed twenty lines away.
   */
  const scopeWritten = !props.readiness.blockers.includes('no_description');
  /** The write-up is owed — either still coming, or it ran and produced nothing. Both
   *  are "the app has not done its part", and both offer Generate rather than Send. */
  const needsGenerate = isDraft && (notProcessed || !scopeWritten);
  /**
   * IS THE EVIDENCE EVEN ON THIS PHONE?
   *
   * It is not always. A change order syncs down from the server; the captures behind it
   * do not — they are local-first by design (mandate #7) and live in this app's own
   * storage. Reinstall the app, or open an extra a crew-mate recorded on their handset,
   * and you get the row without its recording.
   *
   * That state must not be dressed as a wait. "Still being written up" promises
   * something is coming; with nothing to read, nothing is coming, ever, and a Generate
   * button that no-ops is the same lie with a tap in it (hadar 2026-08-06: "clicked on
   * generate and it returned in less than a second but didn't process").
   */
  const hasEvidence = rec.voices.length > 0 || rec.photos.length > 0;
  const items = checklist(props);

  const scrollRef = React.useRef<ScrollView>(null);
  // DEV ONLY — drive this screen's scroll from the inspector, so a section can be
  // reviewed without a thumb.
  React.useEffect(() => {
    if (__DEV__) {
      (globalThis as any).__draftScroll =
        (y: number) => scrollRef.current?.scrollTo({ y, animated: false });
    }
  }, []);
  React.useEffect(() => {
    if (props._fixtureScrollY != null) {
      scrollRef.current?.scrollTo({ y: props._fixtureScrollY, animated: false });
    }
  }, [props._fixtureScrollY]);

  // The ⋯ overflow. One destructive action today — Delete — so a native action
  // sheet (iOS) / alert (Android) is the whole menu; it does not need a custom
  // popover. Delete is legal only in this stage (REQ-LC14), which is why the header
  // hides ⋯ entirely when `canDelete` is false.
  const openOverflow = () => {
    const onDelete = props.onDelete;
    if (!onDelete) return;
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [t('discard.action'), t('common.cancel')],
          destructiveButtonIndex: 0,
          cancelButtonIndex: 1,
        },
        (i) => { if (i === 0) onDelete(); },
      );
    } else {
      Alert.alert(rec.title, undefined, [
        { text: t('discard.action'), style: 'destructive', onPress: onDelete },
        { text: t('common.cancel'), style: 'cancel' },
      ]);
    }
  };

  return (
    <View style={T.screen}>
      {/* paddingBottom clears the CAPTURE FAB, which is pinned to the screen and
          floats over the bottom of this scroll viewport. The bar below is in normal
          flow so nothing hides behind IT — but the FAB is 72pt plus its 12pt gap,
          and at 28 the last ~84pt of content could never be scrolled out from under
          it. That is why the FAB sat on top of a voice note and on top of the row
          naming the approver. Derived from the token so it cannot drift if the
          camera target changes. */}
      <ScrollView ref={scrollRef} contentContainerStyle={{
        paddingHorizontal: 18,
        paddingBottom: touchTargets.camera + touchTargets.spacing + 24,
      }}>
        {/* ScreenHeader owns the 54pt status-bar clearance AND the kicker, which
            now sits above the title where the design puts it. It used to be a
            hand-rolled line underneath, which read as a caption and spent a line
            of a 375pt screen doing it. */}
        {/* THE HEADER SLAB — the same header region as the other two stages
            (hadar, 2026-08-14). What this is and where it stands are one surface,
            closed by a rule and a shadow; everything you can act on sits under it in
            plain cards. The slab ends at the state banner and not lower, because on a
            draft the price is BELOW the scope (391) — the scope is content here, not
            header. */}
        <View style={st.headerSlab}>
        <ScreenHeader
          title={rec.title}
          kicker={kicker(props)}
          kickerRight={rec.synced ? <SyncedPill label={t('neg.synced')} /> : undefined}
          onTitleChange={isDraft ? props.onRetitle : undefined}
          navTitle={t('erec.navTitle')}
          onBack={props.onBack}
          backLabel={t('erec.back')}
          onOverflow={canDelete(rec.status) && props.onDelete ? openOverflow : undefined}
          overflowLabel={t('erec.moreActions')}
        />

        {/* WHERE IT STANDS, FIRST (hadar 2026-08-06: "the draft not sent notice needs
            to move above the scope of work"). It used to sit three blocks down, under
            the scope and the price, so the first thing on screen was a document that
            looked finished. The state is the frame you read the rest through: a scope
            you are proofreading and a scope that has already gone to a client are the
            same words meaning different things. */}
        <View style={{ marginTop: 14 }}>
          {isDraft
            ? (
              // The design's draft banner: a FILLED ochre disc with the hourglass, the
              // state beside it, and the count. It SAYS where the extra stands; it is
              // no longer a place to act.
              //
              // The "+ Cost › / + Payment timing ›" buttons were removed here (hadar
              // 2026-08-06). They were a third copy of the same list: the count above
              // them names how many gaps there are, the checklist below names each one
              // and opens it, and Send at the bottom names the count again. Four
              // buttons in a warning-coloured card also read as the thing to press on
              // a screen whose actual next step is Edit or Send — which is how a
              // status banner turned into the busiest control on the page.
              <View style={st.draftBanner}>
                <View style={st.draftHead}>
                  <View style={st.draftDisc}>
                    <Icon name="waiting" size={17} color={C.card} />
                  </View>
                  <Text style={st.draftTitle}>{t('draft.bannerTitle')}</Text>
                </View>
                {/* While the pipeline is still running, the gap count is not the
                    honest headline — nothing is owed by the contractor yet, the app
                    simply has not finished reading his recording. Say THAT instead of
                    "4 things left", which blames him for a wait that is ours. */}
                <Text style={st.draftCount}>
                  {!hasEvidence && !scopeWritten ? t('draft.noEvidenceHere')
                    : notProcessed ? t(procWhyKey(props.proc))
                    : !scopeWritten ? t('draft.notWrittenUp')
                    : bannerDetail(readiness)}
                </Text>
                {/* The banner's second line is gone (hadar, 2026-08-05: "overwhelming — there are
                    a lot of things and text here"). "These are required for approval"
                    restated the line above it, which already says "N things left before
                    you can send it". Two sentences, one fact. */}
              </View>
            )
            : (
              // Never the draft banner over a row that is not a draft: the state
              // line is the one thing on this screen a contractor acts on.
              <StatusBanner
                kind={displayStatus(rec.status)}
                title={t(chipKey(displayStatus(rec.status)))}
                detail={t('draft.notADraft')}
              />
            )}
        </View>

        </View>

        {/* WHO IS ON THIS, DIRECTLY UNDER THE STATE — the same slot the negotiation and
            sealed screens give it (hadar, 2026-08-14: "same location"). It sat below
            the scope AND the price here, so the same section appeared in a different
            place on each of the three stages of one record.
            It reads correctly in this slot as well as consistently: on a draft the
            client is the gap that decides whether any of the work below can be sent at
            all, and it used to be found only by scrolling past it. */}
        <PeopleSection {...props} />

        {/* 391 — THE SCOPE OF WORK LEADS, above the price.
            It rendered 620px down the screen, below the money, the blocker banner and
            the raw-capture card, clipped at five lines behind "Show more" — measured
            on a real screenshot, not guessed. A scope you have to scroll to and then
            tap to read is a scope nobody proofreads before it goes to a client, which
            is exactly how 15 change orders reached an average scope length of 27
            characters. And a price above the work reads as a bill rather than a
            request: the owner cannot judge $2,400 until he knows what it buys.
            Same component and same position on all three lifecycle screens. */}
        <ScopeBlock
          // THE PLACEHOLDER IS NOT A SCOPE. Passing it through rendered "Untitled extra
          // — still being written up" in the box as if a person had written it there,
          // under a caption telling him it was too short. Null hands ScopeBlock the
          // honest input and lets it draw the waiting state.
          text={scopeWritten ? rec.scopeOfWork : null}
          stage="draft"
          onEdit={props.onEditDescription}
          missing={props.readiness.blockers.includes('no_description')}
          // NOT YET WRITTEN vs WRITTEN BADLY are different facts and now read
          // differently: "Too short to send" over a scope the AI has not produced yet
          // is the app blaming the contractor for its own unfinished work.
          pending={needsGenerate}
          pendingLabel={!hasEvidence ? t('draft.noEvidenceHere')
            : notProcessed ? t(procWhyKey(props.proc))
            : t('draft.notWrittenUp')}
          // Nothing is coming, so do not draw the hourglass: this is a gap to type
          // into, not a wait to sit out.
          pendingIsWait={hasEvidence}
          // THE WAY OUT LIVES INSIDE THE BLOCK IT IS ABOUT (hadar 2026-08-06: "it just
          // needs to be an integral part of the scope section"). It was a second card
          // further down the page, under the price — so the screen stated the problem
          // in one place and offered the fix in another, with a dollar figure between
          // them. One object: the heading, the state, the reason, the buttons.
          footer={isDraft && hasEvidence && !scopeWritten ? <StuckBlock {...props} /> : null}
        />

        {props.kind === 'extra'
          ? (
            /* A SECTION, NOT A FIGURE ON THE PAGE (hadar 2026-08-14: "the price section
               still doesn't look like a section — it is a grey background, it looks like
               a gap with a floating number on it").
               He was right, and literally: everything around it — the scope, the terms,
               the raw capture — is a card on the cream page, and the price was the one
               block with nothing under it. So the eye read the cream as a GAP between
               two sections and the number as something that had come loose into it.
               The money that the whole document turns on looked like a layout mistake.
               Same card, same heading treatment as its neighbours, with the mode
               selector inside it because the mode is part of what the price MEANS. */
            <Section title={t('draft.priceSection')}>
              <DraftMoney rec={rec} priceMode={props.priceMode} heard={props.priceHeard ?? null} />
              {/* The mode reads off the RECORD, not off a separate flag: an extra with
                  no figure IS the authorize case, whatever `priceMode` happens to say. */}
              {props.onPickPriceMode && (
                <PriceModes
                  mode={!rec.priced ? 'authorize' : priceModeOf(props.priceMode)}
                  onPick={props.onPickPriceMode} />
              )}
            </Section>
          )
          : (
            // R6b AC2: a Decision shows no figure anywhere on the screen.
            <Text style={[moneyStyle, { fontSize: 24, color: C.ink, marginTop: 8 }]}>
              {t('erec.noCostChange')}
            </Text>
          )}

        {!rec.synced && (
          <Text style={[T.bodySteel, { fontSize: 12, marginTop: 8 }]}>{t('erec.onPhone')}</Text>
        )}

        <RawSection {...props} />
        <ScopeSection {...props} />

        {/* THE CHECKLIST IS A GRID, TWO ACROSS, and the count sits on the heading
            row opposite the title — the design's shape, and the reason for it is
            that six full-width rows with a hint sentence under each ran taller than
            the whole rest of the screen. Six short labels in two columns is one
            glance. The hints move to the row that opens the field; the pills in the
            banner already name what is missing.
            The count keeps `items.length` (6, or 5 for a Decision), NOT
            `completeness.of` (4) — this heading is counting the things on this list,
            and the four-item fraction is a different number for a different place. */}
        {/* A Card, not a Section: the heading and its count share one line INSIDE
            the card here, where every other section puts its heading outside and
            above. That is the design, and it is right for this one — the count is
            part of the checklist, not a label on it. Using Section would have drawn
            the title twice. */}
        <View style={{ marginTop: 22 }}>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
              <Text style={[labelStyle, { flex: 1 }]}>{t('draft.checklist')}</Text>
              <Text style={[T.bodySteel, { fontSize: 13 }]}>
                {t({ k: 'draft.checklistCount', p: { have: doneCount(items), of: items.length } })}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {items.map((it) => (
                <View key={it.key} style={{ width: '50%' }}>
                  <ChecklistRow state={it.state} label={it.label} onPress={it.onPress} />
                </View>
              ))}
            </View>
          </Card>
        </View>

        {/* Delete moved into the header ⋯ menu (hadar, 2026-07-28) — the design ends
            the scroll at the checklist, and a destructive red button beneath it was
            not in the mockup. It is still legal in this stage only (REQ-LC14); the
            overflow handler above gates it on `canDelete`. */}

        {/* WHEN, at the bottom (hadar 2026-08-06). Every other fact on this screen is
            about the work; this one is about the document, so it closes the page
            rather than competing above. Two different moments when both are known:
            when the WORK was captured on site, and when this change order was
            created. They are usually minutes apart and occasionally days — an extra
            written up from a recording made last Tuesday — and on a record that
            settles disputes, "which day are we talking about" is the whole question.
            Each is omitted when absent (record.ts's rule) rather than shown empty. */}
        <View style={st.stamp}>
          {!!rec.capturedAt && (
            <Text style={st.stampT}>{t({ k: 'erec.capturedWhen', p: { when: rec.capturedAt } })}</Text>
          )}
          <Text style={st.stampT}>{t({ k: 'erec.created', p: { when: rec.created } })}</Text>
        </View>
      </ScrollView>

      <BottomBar {...props} gate={gate} canSendNow={canSendNow} isDraft={isDraft}
        notProcessed={needsGenerate} stillRunning={notProcessed} hasEvidence={hasEvidence} />
    </View>
  );
}

/**
 * "THERE ARE FILES BUT NO WRITE-UP" — the diagnosis, and the buttons that end it.
 *
 * The whole point is that the two causes get DIFFERENT remedies (hadar 2026-08-06):
 *
 *   files not up yet        → Upload now. If the block is the cellular setting, the
 *                             fix is a permission this screen can grant, so it does —
 *                             sending him to Settings to find a toggle he has never
 *                             heard of is how a stuck extra stays stuck.
 *   files up, nothing back  → no button on this phone can make the server pass run
 *                             again, so it says so and offers the out that always
 *                             works: write the scope yourself. Try again is still
 *                             there, because a pass that failed once may not fail
 *                             twice, but it is not dressed up as the answer.
 *
 * WRITE IT MYSELF IS ALWAYS PRESENT. Every branch above can fail permanently — a
 * parked upload, a model that will not produce prose for a 4-second recording, an
 * extra whose audio is gone. A screen that explains a problem and offers only fixes
 * that might not work has still trapped him. The scope is his to type at any time,
 * and that is the door that is never locked.
 */
function StuckBlock(p: ExtraDraftProps) {
  const d = p.delivery;
  // Not read yet: say nothing. A diagnosis invented from missing data is worse than
  // waiting a tick for the real one.
  if (!d) return null;
  const waitingToUpload = d.pending > 0 || d.parked > 0;
  const cellBlocked = d.gate?.upload === false && d.gate.blockedBy === 'needs_cell_consent';
  const offline = d.gate?.upload === false && d.gate.blockedBy === 'no_connection';

  // NOTHING WAS SAID, and that is a different sentence from "our side produced
  // nothing" (hadar 2026-08-07). A recording with no speech in it is a valid thing to
  // have made — he may have been adding photos and never meant to talk — so the screen
  // must not imply a fault, ours or his. It states what happened and offers the two
  // things that actually help: say it again, or write it himself.
  const heardNothing = !waitingToUpload
    && p.rec.voices.length > 0
    && p.rec.voices.every((v) => !(v.transcript ?? '').trim());

  const title = waitingToUpload ? t('stuck.filesTitle')
    : heardNothing ? t('stuck.silentTitle')
    : t('stuck.analysisTitle');
  const why = heardNothing ? t('stuck.silent')
    : d.parked > 0 ? t('stuck.parked')
    : cellBlocked ? t('stuck.needsCell')
    : offline ? t('stuck.offline')
    : waitingToUpload ? t({ k: 'stuck.uploading', p: { n: d.pending } })
    : t('stuck.noAnalysis');

  return (
    <View style={st.draftBanner}>
      <View style={st.draftHead}>
        <View style={st.draftDisc}>
          <Icon name="failed" size={17} color={C.card} />
        </View>
        <Text style={st.draftTitle}>{title}</Text>
      </View>
      <Text style={st.draftCount}>{why}</Text>
      {/* The queue's own words, when it has any. Small and last: it is the detail a
          second person needs to help, not the sentence he acts on. */}
      {!!d.lastError && d.parked > 0 && (
        <Text style={st.draftWhy} numberOfLines={3}>{d.lastError}</Text>
      )}
      <View style={{ gap: 8, marginTop: 12 }}>
        {cellBlocked && p.onAllowCellular && (
          <Button label={t('stuck.allowCell')} icon="offline" onPress={p.onAllowCellular} />
        )}
        {p.onGenerate && (
          <Button
            label={waitingToUpload ? t('stuck.uploadNow')
              : heardNothing ? t('stuck.recordAgain') : t('stuck.tryAgain')}
            icon="waiting"
            variant={cellBlocked ? 'secondary' : 'primary'}
            onPress={heardNothing ? p.onAddPhotos : p.onGenerate}
          />
        )}
        <Button label={t('stuck.writeItMyself')} icon="edit" variant="secondary"
          onPress={p.onEditDescription} />
      </View>
    </View>
  );
}

/** The plain sentence for a pipeline state — deliberately the SAME words the Send
 *  gate already refuses with (`canSendExtra`), so the banner, the scope caption and
 *  the button cannot describe one wait three different ways. */
function procWhyKey(p: ProcState): string {
  return canSendExtra(p).whyKey ?? 'send.notReady.processing';
}

/* ------------------------------------------------------------------ header -- */

/** "Extra #4 · Miller — Hall Bath". Each segment is dropped when its fact is
 *  missing rather than replaced with a placeholder; the kicker answers "where am
 *  I", and a made-up job name is a worse answer than a shorter one. */
function kicker({ kind, extraNo, rec }: ExtraDraftProps): string {
  const word = t(kind === 'decision' ? 'erec.kindDecision' : 'erec.kindExtra');
  const head = extraNo == null ? word : t({ k: 'draft.itemNo', p: { kind: word, n: extraNo } });
  return rec.jobName ? `${head} · ${rec.jobName}` : head;
}

/** The money line. Mandate #6: this figure is the CONTRACTOR'S, read back and
 *  confirmed by a human — the label says so, and the system never authors one.
 *  An unpriced extra says "No price given yet" at full size, never a dash: a dash
 *  reads as a rendering fault, and "no cost change" would tell an owner it is free. */
export type PriceMode = 'fixed' | 'nte' | 'authorize';

/** Widen the stored two-value mode to the selector's three. */
const priceModeOf = (m: 'fixed' | 'nte'): PriceMode => m;

/**
 * HOW THIS IS PRICED — the design's three modes, under the figure (c3 in the demo;
 * hadar 2026-08-13: "the process does not follow the rest of the design, it is missing
 * a section").
 *
 * All three are states this app already supports, which is why this is a selector and
 * not a new feature:
 *   · Fixed      — an amount, no cap. The price is the price.
 *   · Cap (NTE)  — `nte_cents` set. `sendReadiness` BLOCKS on a cap with no ceiling,
 *                  because a not-to-exceed clause with no number in it is not a softer
 *                  promise, it is a promise that says nothing while looking like a limit.
 *   · Authorize  — no amount at all. Sendable: `no_cost` is only a RECOMMENDED gap for
 *                  an extra, never a blocker. The owner authorises the work and the
 *                  price follows.
 *
 * TAPPING A MODE OPENS THE COST EDITOR; it never sets a price here. Two of the three
 * modes need a number, the third means dropping one, and a figure that reaches a
 * document without passing a human read-back is the failure mandate #6 exists for.
 */
function PriceModes({ mode, onPick }: { mode: PriceMode; onPick: (m: PriceMode) => void }) {
  const modes: { key: PriceMode; title: string; sub: string }[] = [
    { key: 'fixed',     title: t('price.modeFixed'), sub: t('price.modeFixedSub') },
    { key: 'nte',       title: t('price.modeCap'),   sub: t('price.modeCapSub') },
    { key: 'authorize', title: t('price.modeAuth'),  sub: t('price.modeAuthSub') },
  ];
  return (
    <View style={st.modes}>
      {modes.map((m) => {
        const on = m.key === mode;
        return (
          <Pressable key={m.key} style={[st.mode, on && st.modeOn]}
            onPress={() => onPick(m.key)}
            accessibilityRole="button" accessibilityState={{ selected: on }}
            accessibilityLabel={`${m.title} — ${m.sub}`}>
            <Text style={[st.modeT, on && st.modeTOn]} numberOfLines={1}>{m.title}</Text>
            <Text style={[st.modeS, on && st.modeSOn]} numberOfLines={2}>{m.sub}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function DraftMoney({ rec, priceMode, heard }: {
  rec: ExtraRecord; priceMode: 'fixed' | 'nte';
  heard?: { words: string; label: string; onUse: () => void } | null;
}) {
  if (!rec.priced) {
    return (
      <>
        <MoneyBlock amount={t('erec.priceToCome')} muted />
        {/* THE READ-BACK (396, mandate #6). He said "probably $1,800" into the phone and
            the pipeline kept those words verbatim — and until now nothing ever showed
            them to him, so the extra sat priceless and Send refused on a hard blocker
            with the answer two tables away.
            HIS WORDS FIRST, THEN THE FIGURE, THEN A TAP. Never the figure alone: the
            parse is ours and it can be wrong ("fourteen fifty" is two readings), so the
            quote has to be visible for him to judge it against. Nothing is written
            until he presses — a model given "four fifty" invented $450 at high
            confidence, and this is the machinery that exists so that can never reach a
            document unread. */}
        {heard && (
          <View style={st.heard}>
            <Text style={st.heardSaid}>{t({ k: 'price.youSaid', p: { words: heard.words } })}</Text>
            <Button label={t({ k: 'price.useIt', p: { amount: heard.label } })}
              icon="approved" onPress={heard.onUse} />
          </View>
        )}
      </>
    );
  }
  const mode = priceMode === 'nte' && rec.nte
    ? t({ k: 'erec.nte', p: { amount: rec.nte } })
    : t('erec.fixed');
  return (
    <MoneyBlock
      amount={rec.amount}
      subtitle={`${mode}${rec.isMini ? ` · ${t('erec.mini')}` : ''} · ${t('erec.yourPrice')}`}
    />
  );
}

/** The banner's second line — what is true now and what is owed next (REQ-LC24),
 *  and the one place D3 is most likely to be broken by a well-meaning edit. A
 *  recommended item is NEVER described as required here; the two counts come from
 *  the two separate lists and are worded as a wall and as help. */
/**
 * The blockers the BANNER should speak for.
 *
 * `no_description` is deliberately not among them (391). The ScopeBlock states that
 * gap inline — "Too short to send. Describe the work the way you would explain it on
 * site." — directly under the scope it is about, roughly 200pt above the banner. Once
 * the scope moved to the top of the screen, listing "Description" again as one of "5
 * things left" reported one gap twice, in two vocabularies, on one screenful. A
 * contractor counting his remaining work should get one number and each item once.
 *
 * The GATE is untouched: sendReadiness still blocks on no_description and Send still
 * refuses. This only decides who SAYS it.
 */
function bannerBlockers(r: SendReadiness): readonly SendBlocker[] {
  return r.blockers.filter((b) => b !== 'no_description');
}

function bannerDetail(r: SendReadiness): string {
  // Singular and plural are SEPARATE KEYS, not one string carrying "thing(s)".
  // `t()` interpolates and does not decline, so a single string has to hedge — and
  // "1 required thing(s) still missing" is what shipped. A contractor reading that
  // learns the app was written by someone who was not picturing him.
  const blocking = bannerBlockers(r);
  if (blocking.length > 0) {
    return t(blocking.length === 1
      ? 'draft.bannerBlocked1'
      : { k: 'draft.bannerBlockedN', p: { n: blocking.length } });
  }
  if (r.recommended.length > 0) {
    return t(r.recommended.length === 1
      ? 'draft.bannerReadyGaps1'
      : { k: 'draft.bannerReadyGaps', p: { n: r.recommended.length } });
  }
  return t('draft.bannerReady');
}


/** The names behind the count. Blockers when there are any — they are what Send is
 *  waiting on — otherwise the recommended gaps, which are what a yes is waiting on.
 *  Never both at once: mixing them into one row of identical pills is exactly the
 *  merge D3 says this screen must not make.
 *
 *  Read off the CHECKLIST rather than off `blockers`/`recommended` directly, so the
 *  pill and the checklist row for one gap are the same short words. The readiness
 *  keys are full sentences ("Nobody has written up what the work is yet — that is
 *  the part the owner reads"), which are right under a checklist row and impossible
 *  in a pill. */
function bannerPills(r: SendReadiness, items: readonly ChecklistItem[]): readonly string[] {
  // Driven off `r.blockers` — THE SAME ARRAY the count above is length-of. Reading
  // the checklist's `state` instead let the two disagree: since 2026-07-28 all six
  // items gate Send, but the checklist still marks the four widened ones 'missing'
  // (that is what draws their softer ring), so filtering on 'blocking' returned two
  // pills under a headline that said four. A count with the wrong things named under
  // it is worse than a count alone.
  const label = new Map(items.map((i) => [i.key as string, i.label]));
  const blocking = bannerBlockers(r);
  const src: readonly string[] = blocking.length > 0 ? blocking : r.recommended;
  return src.map((k) => label.get(k) ?? k);
}

/* -------------------------------------------------------------------- raw -- */

/**
 * WHO IS ON THIS EXTRA — the SHARED section (hadar, 2026-08-14: "the people section
 * needs to be the same in all 3 stages, same location, looks the same").
 *
 * This screen used to draw its own: a vertical list of labelled rows ("Requested by",
 * "Source", "Also on this job") under a heading reading "Who is on this", while the
 * negotiation screen drew a horizontal who's-who strip headed "People involved" and the
 * sealed record drew nothing. Three answers to one question, and the person who pays
 * for that is the one CLAUDE.md §1 names — someone for whom software is not second
 * nature, re-learning where the people live every time the extra changes stage.
 *
 * The rows are gone; `PeopleInvolved` renders all of it. What stays here is the only
 * part that is genuinely about THIS stage: a draft may have nobody yet, and that gap is
 * what blocks sending.
 */
function PeopleSection(p: ExtraDraftProps) {
  const { rec } = p;
  // The crew person who stood in front of it, if the record names one.
  const source = rec.people.find((pp) => pp.kind === 'crew') ?? null;
  const owner = !!p.requestedBy;
  // ONE list, built once and de-duplicated in one pass by `rosterOf`: the client, the
  // on-site source, then everybody else on the job.
  //
  // EVERYONE ELSE IS HIDDEN UNTIL THERE IS A CLIENT (hadar, 2026-08-08: "we need first
  // to select an owner before we choose additional people to send to"). An extra with
  // no signer that still lists three names reads as "somebody will get this" — and
  // nobody will.
  const people = rosterOf(
    p.requestedBy
      ? {
          name: p.requestedBy,
          role: p.clientTypeLabel || t('erec.approverRole'),
          // The client column opens the client editor: on a draft the signer is still
          // a choice, and this is the one place on the screen that says who it is.
          onPress: p.onEditClient ?? p.onEditDetails,
        }
      : null,
    [
      ...(source ? [{ name: source.name, role: t('draft.sourceRole') }] : []),
      ...(owner
        ? (p.jobPeople ?? []).map((m) => ({
            name: m.name,
            role: m.role,
            onRemove: p.onRemovePerson ? () => p.onRemovePerson?.(m.id, m.name) : undefined,
          }))
        : []),
    ]
  );
  return (
    <PeopleInvolved
      people={people}
      onAddContact={owner ? p.onAddContact : undefined}
      empty={
        // THE NEGATIVE STATE IS A CARD, NOT A ROW (hadar's design, 2026-08-08). It was
        // one warn-toned row among eight others — the same size and shape as "Payment
        // timing" — so the one gap that decides whether this extra can be signed read
        // as the eighth-most-important thing on the screen. It is not: nobody can
        // approve an extra addressed to nobody.
        <View style={st.ownerGap}>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={st.ownerGapDisc}>
              <Icon name="person" size={22} color={OWNER_MARK} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={st.ownerGapH}>{t('client.noOwnerH')}</Text>
              <Text style={st.ownerGapB}>{t('client.noOwnerB')}</Text>
            </View>
          </View>
          <Pressable
            onPress={p.onEditClient ?? p.onEditDetails}
            accessibilityRole="button"
            accessibilityLabel={t('client.chooseOwner')}
            style={({ pressed }) => [st.ownerGapBtn, pressed && { opacity: 0.75 }]}
          >
            <Text style={[st.ownerGapBtnT, { flex: 1 }]}>{t('client.chooseOwner')}</Text>
            <Text style={st.ownerGapChev}>›</Text>
          </Pressable>
          {/* The promise that makes the hiding above honest: the other people are not
              gone, they are next. */}
          <Text style={st.ownerGapFoot}>{t('client.othersLater')}</Text>
        </View>
      }
    />
  );
}

/**
 * The evidence, kept visibly apart from the client-facing scope below.
 *
 * The separation is the point of the two headings: this is what was captured on
 * site and the owner never reads it; the next section is the document. Merging
 * them is how a raw transcript ends up in front of the person whose trust the
 * document is asking for.
 */
function RawSection(p: ExtraDraftProps) {
  const { rec } = p;
  // Starts OPEN when no recording produced a transcript: the collapsed row's job is
  // to stand in for words you can already read, and with none of them it would be
  // hiding the only copy of what was said behind a control nobody knows to tap.
  //
  // 2026-08-06 (hadar: "I don't see the transcription of the text in the draft
  // details"): it now starts open whenever there IS a recording, not only when
  // transcription failed. On a voice-led product the words the contractor spoke are
  // the source the scope was written from — the one thing to check when the write-up
  // reads wrong — and hiding them behind a row he has to know to tap made the draft
  // look as though the app had thrown the recording away. Space was the argument for
  // collapsing it; being able to see what you said outranks it on this screen.
  const [notesOpen, setNotesOpen] = React.useState(rec.voices.length > 0);
  // No per-tile captions on the draft. The mockup's raw card shows clean thumbnails
  // and the timestamp lives on the "Captured notes" row above — captions widened
  // each cell to fit "Jan 18 · 8:33 am", which is why the "+ Add" tile wrapped to a
  // second line instead of sitting fourth in the row. The locked/detail screens,
  // which exist to prove evidence, still pass captions.
  const tiles: PhotoTile[] = rec.photos.map((ph) => ({
    key: ph.captureId, uri: ph.uri, present: ph.present,
  }));
  // The on-site source is a PERSON (the crew member who captured it), the same
  // shape as "Requested by" — the mockup draws Marco R. with an avatar, not the
  // capture method. `capturedWith` (the "voice note · time" string) is the fallback
  // only when no crew person is on the record.
  const source = rec.people.find((pp) => pp.kind === 'crew') ?? null;
  // THE ONE PREDICATE for "does this extra have somebody to send to". Every branch
  // below reads it — the owner block, the roster list, and "Add someone else" — so
  // they cannot disagree about whether an owner exists.
  const owner = !!p.requestedBy;
  return (
    <Section title={t('draft.raw')}>
      {/* The standalone write-up block was removed 2026-07-28 to match the mockup,
          whose raw card is rows only (Captured notes · Photos · Requested by ·
          Source). The client-facing prose now lives once, under SCOPE → Description
          of work; the REQ-LC43 concern it used to carry — that an AI summary is not
          the frozen instrument — is handled there. */}
      {/* WHAT PRODUCED THIS, beside what it produced. It used to sit between the
          client and the rest of the people, splitting the one group on the screen
          that is a list of people. */}
      {p.capturedWith != null && (
          <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48,
            paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.line }}>
            <View style={{ flex: 1 }}>
              <Text style={labelStyle}>{t('draft.source')}</Text>
              <Text style={[T.bodySteel, { fontSize: 14, marginTop: 3 }]}>{p.capturedWith}</Text>
            </View>
          </View>
      )}

      {rec.voices.length === 0 && (
        <Text style={[T.bodySteel, { fontSize: 13.5 }]}>{t('draft.noNotes')}</Text>
      )}

      {/* COLLAPSED BY DEFAULT, one tap from open. Two recordings rendered as two
          full players ran ~220pt on a 375pt screen, which pushed the scope of work
          and the ready-to-send checklist — the two things this stage exists to get
          filled — off the bottom. The design shows this as a single row for the
          same reason.
          It is a DISCLOSURE, never a removal: the audio IS the record on a
          voice-led product, and a transcript that failed to arrive (offline, no
          STT) leaves the recording as the only copy of what was said. It stays
          expanded once opened, and it starts expanded when nothing was
          transcribed — in that case the row above it has nothing to show. */}
      {rec.voices.length > 0 && (
        <Row
          icon="doc"
          label={t('draft.notesRow')}
          // WHEN it was captured, which is what the design shows and what a
          // contractor recognises the recording by. No count sub-line — the design
          // keeps this row to one line, and the count is visible the moment the row
          // opens. The count still reaches assistive tech via the row's label.
          value={rec.voices[0]?.at ?? undefined}
          chevron
          expanded={notesOpen}
          divider
          onPress={() => setNotesOpen((o) => !o)}
          accessibilityLabel={notesOpen ? t('draft.notesHide') : t('draft.notesShow')}
        />
      )}

      {notesOpen && rec.voices.map((v, i) => (
        <View key={v.captureId} style={{ marginBottom: 12 }}>
          {rec.voices.length > 1 && (
            <Text style={labelStyle}>{t({ k: 'erec.voiceN', p: { n: i + 1 } })}</Text>
          )}
          {/* THE AUDIO, not only the words about it. The redesign dropped playback
              from every screen, and a null transcript (offline, no STT) then left the
              contractor with no way to hear a recording that is on the phone in his
              hand — on a voice-led product where the audio IS the record. */}
          <VoiceClip
            uri={v.uri}
            present={v.present}
            playLabel={t('erec.voicePlay')}
            missingLabel={t('erec.voiceMissing')}
          />
          {/* Three different facts, said as three different sentences. "Not
              transcribed yet" is a wait; "the audio is gone" is mandate #1's
              loss and is never dressed up as a wait. */}
          {v.transcript
            ? <Text style={[T.body, { fontSize: 15, marginTop: 4 }]} selectable>{v.transcript}</Text>
            : v.present
              ? <Text style={[T.bodySteel, { fontSize: 13.5, marginTop: 4 }]}>{t('erec.transcriptPending')}</Text>
              // The loss is stated by `VoiceClip` above rather than twice: one
              // missing file, one sentence.
              : null}
        </View>
      ))}

      {/* A ROW, then the grid under it — the design's shape. It was an uppercase
          "EVIDENCE · 8" micro-label, which named the group but was not the same
          object as the rows above and below it, so the card read as two unrelated
          halves. As a row it lines up with Captured notes and carries the count in
          the same place every other count on this screen sits. */}
      <Row
        icon="photocam"
        label={t('draft.photos')}
        value={t({ k: 'draft.photosN', p: { n: rec.photos.length } })}
        tone={rec.photos.length > 0 ? 'default' : 'warn'}
        chevron
        onPress={p.onAddPhotos}
      />
      {/* Indented to the ROW'S TEXT COLUMN (24pt icon + 12pt gap), so the first
          thumbnail starts under the word "Photos", not under its glyph — the
          design's alignment. 62pt tiles are what makes three photos plus the add
          tile fit one line inside this indent on a 375pt screen:
          card inner 309 − 36 indent − 3×8 gaps = 249 → 62 each. At the old 86
          only three cells fit and the grid wrapped immediately. */}
      <View style={{ marginLeft: 36, marginTop: 10 }}>
        <PhotoGrid
          photos={tiles}
          missingLabel={t('erec.evidenceMissing')}
          onPressPhoto={p.onPressPhoto ? (photo) => p.onPressPhoto?.(photo.uri) : undefined}
          onAddMore={p.onAddPhotos}
          addLabel={t('draft.addMore')}
          tileSize={62}
        />
      </View>
      {rec.photosTruncated > 0 && (
        <Text style={[T.bodySteel, { fontSize: 12, marginTop: 8 }]}>
          {t({ k: 'erec.evidenceMore', p: { n: rec.photosTruncated } })}
        </Text>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------ scope -- */

/** What the owner actually reads. Every row opens the editor for its own field. */
function ScopeSection(p: ExtraDraftProps) {
  const { rec, readiness } = p;
  const blocked = (b: SendBlocker) => readiness.blockers.includes(b);
  // A recommended-but-missing value is `warn` and a blocking one is `danger`, and
  // the difference is D3: one is unfinished, the other is a wall. They must not
  // read as the same severity anywhere on this screen.
  const softTone = (r: SendRecommendation): RowTone =>
    readiness.recommended.includes(r) ? 'warn' : 'default';

  return (
    <Section title={t('draft.scope')}>
      {/* The "(SENT TO CLIENT)" in the section title already says whose eyes this is
          for; the extra "This is exactly what the owner reads." line was a second
          disclaimer over the same thing and the design does not carry it. Removed
          2026-07-28 per hadar. */}

      {/* `rec.title` — `change_order.scope` — and NOT `rec.description`. Three
          things have to agree here and only one string makes them agree: it is what
          `renderCard` freezes into `shown_content` (App.tsx passes `c.scope` as both
          subject and value), it is what `sendReadiness`'s `no_description` blocker
          is computed from, and it is what the editor this row opens actually edits
          (`openDetail` seeds `scope: c.scope`; `saveScope` writes `co.scope`).
          Rendering the summary here made all three disagree: the contractor read one
          paragraph, tapped it, was shown a different sentence, saved his edit and
          watched the block not change — while the owner signed the sentence he had
          never been shown. */}
      {/* The client-facing prose — the long "Description of work" the mockup shows
          under this heading. NOTE for production wiring: this must be the editable
          client-facing SCOPE, not the AI summary (`rec.description` stands in here
          for the fixture). REQ-LC43's rule still holds — the frozen instrument is
          `co.scope` — but the row the owner reads shows the full scope prose, not a
          one-line title. Open item for hadar: confirm which column feeds this. */}
      {/* The scope of work itself now sits at the TOP of the screen, above the money —
          see the ScopeBlock rendered under the header. What stays here are the terms
          it is priced on. */}

      {p.kind === 'extra' && (
        <Row
          icon="cost"
          divider
          label={t('draft.cost')}
          sub={p.priceMode === 'nte' && rec.nte ? t({ k: 'erec.nte', p: { amount: rec.nte } }) : undefined}
          value={blocked('no_cost') ? t('draft.notSet') : rec.amount}
          tone={blocked('no_cost') ? 'danger' : 'default'}
          chevron
          onPress={p.onEditCost}
        />
      )}
      <Row
        icon="calendar"
        divider
        label={t('draft.schedule')}
        value={scheduleLabel(p.scheduleEffect, p.scheduleDays) ?? t('draft.notSet')}
        tone={softTone('no_schedule_effect')}
        chevron
        onPress={p.onEditSchedule}
      />
      <Row
        icon="payment"
        divider
        label={t('draft.billing')}
        value={billingLabel(p.billingTiming) ?? t('draft.notSet')}
        tone={softTone('no_billing_timing')}
        chevron
        onPress={p.onEditBilling}
      />
      <Row
        icon="excluded"
        label={t('draft.exclusions')}
        value={p.exclusions?.trim() || t('draft.notSet')}
        tone={softTone('no_exclusions')}
        chevron
        onPress={p.onEditExclusions}
      />
    </Section>
  );
}

/**
 * The description, clamped with a Show more affordance.
 *
 * The clamp is decided by text LENGTH, not by measuring the rendered lines. RN
 * reports the truncated line count once `numberOfLines` is set, so the honest
 * measurement needs a second invisible render — and the cost of the heuristic is
 * a "Show more" that occasionally expands nothing, which is a cosmetic miss, not a
 * hidden one. A description that is silently cut with no affordance would be the
 * hidden one.
 */
const CLAMP_CHARS = 140; // ~4 lines at card width — aligns the Show-more button with where numberOfLines actually truncates

function DescriptionBlock({ text, blocked, onPress }: {
  text: string;
  blocked: boolean;
  onPress: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const long = text.length > CLAMP_CHARS;
  return (
    <View style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.line }}>
      {/* The row's chevron reflects the block's state: right while the prose is
          clamped, DOWN once it is open (hadar, 2026-07-30 — "when the section is open
          the arrow needs to drop down"). Tapping the row still opens the editor; the
          mark reports whether this section is expanded. */}
      <Row
        icon="doc"
        label={t('draft.description')}
        chevron
        expanded={long ? open : undefined}
        onPress={onPress}
      />
      <Text style={[T.body, { marginTop: 2 }]} numberOfLines={open ? undefined : 4} selectable>
        {text}
      </Text>
      {/* A Pressable with the 48pt floor, not a bare <Text onPress>. At fontSize 14
          with 10pt of vertical padding the tap target was ~37pt — under
          `touchTargets.minimum`, which mandate #3 makes a bug and not a preference,
          on a screen designed for gloves. `extralocked.tsx` renders the identical
          control correctly; this was the only sub-48pt target in the new kit. */}
      {long && (
        <Pressable
          onPress={() => setOpen((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={open ? t('draft.showLess') : t('draft.showMore')}
          // Right-aligned with a caret, in brand green — the design puts "Show more ⌄"
          // at the end of the truncated prose, not left under it.
          style={{ minHeight: touchTargets.minimum, flexDirection: 'row',
            alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}
        >
          <Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: C.ink }}>
            {open ? t('draft.showLess') : t('draft.showMore')}
          </Text>
          <Text style={{ fontFamily: F.body, fontSize: 13, color: C.ink }}>
            {open ? '⌃' : '⌄'}
          </Text>
        </Pressable>
      )}
      {blocked && (
        <Text style={[T.body, { fontSize: 13.5, color: C.danger, marginTop: 4 }]}>
          {t(blockerKey('no_description'))}
        </Text>
      )}
    </View>
  );
}

/** The stored enum → the word for it, in the reader's language. An unrecognised
 *  value renders ITSELF rather than a guess or a blank: flowterms.ts's rule, for
 *  its reason — a wrong term is worse than a visibly odd one, and claiming "Not
 *  set" over a value that exists would be the same lie in the other direction. */
function billingLabel(v: string | null): string | null {
  if (!v) return null;
  if (v === 'next_invoice') return t('co.billNext');
  if (v === 'when_completed') return t('co.billDone');
  if (v === 'other') return t('co.billOther');
  return v;
}

function scheduleLabel(v: string | null, days: number | null): string | null {
  if (!v) return null;
  if (v === 'no_change') return t('co.schedNo');
  // 'not_sure' IS a complete answer (FLOW decision 3) and reads to the owner as
  // "to be confirmed" — so it is shown as an answer here, never as a gap.
  if (v === 'not_sure') return t('co.schedUnsure');
  if (v === 'adds_days') {
    return days != null && days > 0
      ? t({ k: 'draft.schedDays', p: { n: days } })
      : t('co.schedAdds');
  }
  return v;
}

/* -------------------------------------------------------------- checklist -- */

type ChecklistItem = {
  key: string;
  state: ChecklistState;
  label: string;
  hint?: string;
  onPress: () => void;
};

/**
 * The six items, built from the readiness result and from nothing else.
 *
 * Each row's state comes straight out of `blockers` / `recommended`, so this
 * function knows WHICH list an item belongs to but never re-decides whether it is
 * missing. That is the whole reason the checklist cannot drift from the Send
 * button: they read the same value.
 *
 * A Decision has five items, not six — it carries no price, so a "Cost ✓" row
 * would be a tick against a question nobody asked.
 */
function checklist(p: ExtraDraftProps): ChecklistItem[] {
  const { readiness: r } = p;
  const hard = (b: SendBlocker, lbl: string, onPress: () => void): ChecklistItem => {
    const missing = r.blockers.includes(b);
    return {
      key: b, label: lbl, onPress,
      state: missing ? 'blocking' : 'done',
      hint: missing ? t(blockerKey(b)) : undefined,
    };
  };
  const soft = (s: SendRecommendation, lbl: string, onPress: () => void): ChecklistItem => {
    const missing = r.recommended.includes(s);
    return {
      key: s, label: lbl, onPress,
      state: missing ? 'missing' : 'done',
      hint: missing ? t(recommendationKey(s)) : undefined,
    };
  };
  return [
    // SHORT labels here, not the scope-row labels. The checklist is a two-across
    // grid; "Description of work" / "Impact on schedule" / "What is NOT included"
    // each wrapped to two lines and broke the grid's rhythm. The design uses the
    // short forms in the checklist (and the banner pills, which read these same
    // labels), while the SCOPE rows keep the long forms.
    hard('no_description', t('draft.ckDescription'), p.onEditDescription),
    // 2026-08-07: photos moved to HARD and cost to SOFT — the checklist's marks follow
    // `sendReadiness`, which is the one authority, so the two cannot disagree about
    // which ring a row wears.
    hard('no_photos', t('draft.photos'), p.onAddPhotos),
    ...(p.kind === 'extra' ? [soft('no_cost', t('draft.cost'), p.onEditCost)] : []),
    soft('no_billing_timing', t('draft.billing'), p.onEditBilling),
    soft('no_schedule_effect', t('draft.ckSchedule'), p.onEditSchedule),
    soft('no_exclusions', t('draft.ckExclusions'), p.onEditExclusions),
  ];
}

function doneCount(items: readonly ChecklistItem[]): number {
  return items.filter((i) => i.state === 'done').length;
}

/* ------------------------------------------------------------------- send -- */

/**
 * The pinned bar: the reason first, then the two moves.
 *
 * THE REASON IS ABOVE THE BUTTON, ALWAYS, whenever Send is refused. A disabled
 * primary with no sentence beside it is what makes a man on a ladder tap it eleven
 * times and decide the app lost his extra.
 */
function BottomBar(p: ExtraDraftProps & {
  gate: SendGate;
  canSendNow: boolean;
  isDraft: boolean;
  /** Generate is the offer: the write-up is still coming, or never arrived. */
  notProcessed: boolean;
  /** …and specifically, is the pipeline still running? Decides the second line: a
   *  wait to sit out reads differently from a job that produced nothing. */
  stillRunning: boolean;
  /** Is there anything on THIS phone to generate from? No → the button refuses up
   *  front and says why, instead of running a job with an empty input list. */
  hasEvidence: boolean;
}) {
  return (
    <View style={{
      borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.card,
      padding: 12, paddingBottom: 22, gap: 10,
    }}>
      {/* ONE BUTTON, AND IT OPENS THE CAMERA (hadar 2026-08-07, replacing the 70/30
          split introduced minutes earlier). The split gave the bar two controls where
          the product only has one answer at this point: say more. A contractor who
          wants to change his extra does it the way he made it — by talking and
          snapping — not by finding a form.

          THE ICON IS THE MIC, NOT A PEN, and that is the honest label: this opens the
          fused capture screen (photos + voice), the same one the FAB opens, so there is
          one capture flow in the app. A pen would promise a text editor.

          The details composer is still reachable — every checklist row opens its own
          field and the scope has its own Edit link — it simply no longer owns the bar. */}
      <Button label={t('draft.editDetails')} icon="microphone" variant="secondary"
        onPress={p.onAddPhotos} />

      {/* WHILE THE PIPELINE IS STILL RUNNING, SEND IS NOT THE OFFER (hadar 2026-08-06:
          "if the draft was not processed, the send for approval button needs to be
          hidden and a different button asking to generate the change order").
          A greyed-out Send with "It reached the cloud, your words are being written
          down" under it is a dead control explaining someone else's job. The one act
          that makes sense here is to get the write-up made, so that is the button.
          It cannot become a send by accident: `canSendNow` still gates the real one,
          and this branch never calls `onSend`. */}
      {p.notProcessed ? (
        <Pressable
          onPress={p.onGenerate}
          // REFUSES UP FRONT when the recording is not on this phone. A button that
          // runs, finds an empty input list and returns in under a second is
          // indistinguishable from a broken one — and the user is the one left
          // guessing which it was.
          disabled={!p.onGenerate || !p.hasEvidence}
          accessibilityRole="button"
          accessibilityState={{ disabled: !p.onGenerate || !p.hasEvidence }}
          accessibilityLabel={t('draft.generate')}
          style={({ pressed }) => [st.sendBtn, !p.hasEvidence && { opacity: 0.55 },
            pressed && p.onGenerate && p.hasEvidence && { opacity: 0.85 }]}
        >
          <View style={st.sendTop}>
            <Icon name="waiting" size={19} color={C.card} />
            <Text style={st.sendLabel}>{t('draft.generate')}</Text>
          </View>
          <Text style={st.sendSub}>
            {!p.hasEvidence ? t('draft.noEvidenceHere')
              : p.stillRunning ? t(procWhyKey(p.proc))
              : t('draft.generateSub')}
          </Text>
        </Pressable>
      ) : (
      /* The refusal rides INSIDE the button as its second line — the design puts
          "Add 2 missing details to send" under "Send for approval" rather than as a
          separate red sentence above. The rule that a refused Send must always SAY
          why is kept; it just says it where the tap happens. */
      <Pressable
        onPress={p.onSend}
        disabled={!p.canSendNow}
        accessibilityRole="button"
        accessibilityState={{ disabled: !p.canSendNow }}
        accessibilityLabel={t('erec.send')}
        // A REFUSED SEND MUST LOOK REFUSED (hadar 2026-08-07: "when I click on send for
        // approval nothing happens").
        //
        // It was `disabled` with NO visual difference: the same full-strength black
        // button, tapping it did nothing, and the only signal was a grey line of
        // subtitle text under a control that looked live. So the honest reading of the
        // screen was "this app is broken" — and mandate #3's touch budget makes that
        // worse, because a man in gloves taps it three more times to be sure.
        //
        // The subtitle already says WHY (`SendSubtitle`: "Add 2 missing details to
        // send"). This makes the button agree with it.
        style={({ pressed }) => [st.sendBtn, !p.canSendNow && st.sendBtnOff,
          pressed && p.canSendNow && { opacity: 0.85 }]}
      >
        <View style={st.sendTop}>
          <Icon name="send" size={19} color={C.card} />
          <Text style={st.sendLabel}>{t('erec.send')}</Text>
        </View>
        <SendSubtitle {...p} />
      </Pressable>
      )}

      {/* DELETE, AT THE BOTTOM OF THE EXTRA (hadar, 2026-08-05). This reverses the
          2026-07-28 decision that moved Delete into the header ⋯ because the mockup
          had no red button under the checklist — the ⋯ is kept, so this ADDS a route
          rather than replacing one. Asked for because a destructive action hidden
          behind a glyph is not discoverable by someone who does not think in
          software (CLAUDE.md §1), and the overflow menu was where it went to be
          tidy, not to be found.

          Gated on `canDelete` — the SAME predicate as the ⋯ — so the two entry
          points cannot disagree about legality; an approved or sent extra shows
          neither. Deliberately a quiet text link rather than a filled red button:
          it must be findable, not competitive with Send, and nothing is destroyed
          by tapping it — `onDelete` opens the confirmation that names what goes
          (mandate #2). 44pt minimum per mandate #3. */}
      {canDelete(p.rec.status) && p.onDelete && (
        <Pressable
          onPress={p.onDelete}
          accessibilityRole="button"
          accessibilityLabel={t('discard.action')}
          style={({ pressed }) => [st.deleteBtn, pressed && { opacity: 0.6 }]}
        >
          <Text style={st.deleteLabel}>{t('discard.action')}</Text>
        </Pressable>
      )}
    </View>
  );
}

/** The second line inside Send — the same facts `SendReason` states, in the button. */
function SendSubtitle(p: ExtraDraftProps & { gate: SendGate; isDraft: boolean }) {
  const sub = (() => {
    if (!p.isDraft) return t('draft.notADraft');
    if (!p.gate.ok && p.gate.kind === 'content') {
      const n = p.gate.readiness.blockers.length;
      return t(n === 1 ? 'draft.addOneToSend' : { k: 'draft.addNToSend', p: { n } });
    }
    if (!p.gate.ok && p.gate.kind === 'pipeline') return t(p.gate.whyKey);
    if (p.readiness.recommended.length > 0) {
      return t(p.readiness.recommended.length === 1
        ? 'draft.sendAnyway1'
        : { k: 'draft.sendAnyway', p: { n: p.readiness.recommended.length } });
    }
    return null;
  })();
  if (!sub) return null;
  return <Text style={st.sendSub} numberOfLines={2}>{sub}</Text>;
}

/**
 * Why Send is refused, or — when it is not — what is still missing anyway.
 *
 * The order is the spec's: stage, then content, then pipeline. Content outranks
 * pipeline because it is the refusal he can act on right now; pipeline is the one
 * he can only wait out, and showing it first would send him looking for signal
 * over a price he never said.
 */
function SendReason(p: ExtraDraftProps & {
  gate: SendGate;
  isDraft: boolean;
}) {
  if (!p.isDraft) {
    return <Text style={[T.body, { fontSize: 13.5, color: C.danger }]}>{t('draft.notADraft')}</Text>;
  }
  if (!p.gate.ok && p.gate.kind === 'content') {
    // ONE sentence, not one per blocker. Every blocker already has its own pill in
    // the banner and its own row in the checklist, each a tap from the field that
    // fixes it — so a stack of four red lines above the button was the third telling
    // of the same list, and it pushed the primary action off a 375pt screen. The bar
    // still refuses to show a dead button with no reason (that is the rule this
    // function exists for); it just says the FIRST thing to go fix, and the count
    // says how many follow.
    const first = p.gate.readiness.blockers[0];
    const n = p.gate.readiness.blockers.length;
    return (
      <Text style={[T.body, { fontSize: 13.5, color: C.danger }]}>
        {t(blockerKey(first))}
        {n > 1 ? ` ${t({ k: 'draft.andNMore', p: { n: n - 1 } })}` : ''}
      </Text>
    );
  }
  if (!p.gate.ok && p.gate.kind === 'pipeline') {
    // A wait, not a fault, and worded as one: nothing here is his to fix.
    return <Text style={[T.bodySteel, { fontSize: 13.5 }]}>{t(p.gate.whyKey)}</Text>;
  }
  // Send is live. The recommended gaps are still stated — honestly, as a number he
  // may choose to ignore, because D3 says the choice is his.
  if (p.readiness.recommended.length > 0) {
    return (
      <Text style={[T.bodySteel, { fontSize: 13.5 }]}>
        {t(p.readiness.recommended.length === 1
          ? 'draft.sendAnyway1'
          : { k: 'draft.sendAnyway', p: { n: p.readiness.recommended.length } })}
      </Text>
    );
  }
  return null;
}
