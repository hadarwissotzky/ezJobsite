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
import { t } from '../i18n';
import {
  APP_NAME, Button, Card, MoneyBlock, ChecklistRow, PersonRow, PhotoGrid, Row, ScreenHeader, Section,
  StatusBanner, SyncedPill, VoiceClip, type ChecklistState, type PhotoTile, type RowTone,
} from './kit';
import { C, F, T, label as labelStyle, money as moneyStyle, tint } from './theme';
import { touchTargets } from './tokens';
import { Icon } from './icon';
import { ScopeBlock } from './scopeblock';

const CAUTION = tint('caution');

const st = StyleSheet.create({
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
  draftActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  draftAdd: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: CAUTION.line, borderRadius: 10,
    backgroundColor: C.card, paddingHorizontal: 12, minHeight: 42,
  },
  draftAddPlus: { fontFamily: F.bodySemi, fontSize: 16, color: CAUTION.ink },
  draftAddText: { fontFamily: F.bodySemi, fontSize: 13, color: CAUTION.ink },
  draftAddChev: { fontFamily: F.body, fontSize: 16, color: CAUTION.ink },
  // Send, with its reason as a second line inside the button.
  sendBtn: {
    backgroundColor: C.ink, borderRadius: 14, minHeight: 58,
    alignItems: 'center', justifyContent: 'center', paddingVertical: 10,
  },
  sendTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
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
  const items = checklist(props);

  const scrollRef = React.useRef<ScrollView>(null);
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
        <ScreenHeader
          title={rec.title}
          kicker={kicker(props)}
          kickerRight={rec.synced ? <SyncedPill label={t('neg.synced')} /> : undefined}
          onTitleChange={isDraft ? props.onRetitle : undefined}
          navTitle={APP_NAME}
          onBack={props.onBack}
          backLabel={t('erec.back')}
          onOverflow={canDelete(rec.status) && props.onDelete ? openOverflow : undefined}
          overflowLabel={t('erec.moreActions')}
        />

        {props.kind === 'extra'
          ? <DraftMoney rec={rec} priceMode={props.priceMode} />
          : (
            // R6b AC2: a Decision shows no figure anywhere on the screen.
            <Text style={[moneyStyle, { fontSize: 24, color: C.ink, marginTop: 8 }]}>
              {t('erec.noCostChange')}
            </Text>
          )}

        {!rec.synced && (
          <Text style={[T.bodySteel, { fontSize: 12, marginTop: 8 }]}>{t('erec.onPhone')}</Text>
        )}

        <View style={{ marginTop: 14 }}>
          {isDraft
            ? (
              // The design's draft banner: a FILLED ochre disc with the hourglass, the
              // state beside it, then the count/why, then each gap as a tappable
              // "+ Add …" button. The gaps are actions here, not labels — the whole
              // point of the banner is to get them filled.
              <View style={st.draftBanner}>
                <View style={st.draftHead}>
                  <View style={st.draftDisc}>
                    <Icon name="waiting" size={17} color={C.card} />
                  </View>
                  <Text style={st.draftTitle}>{t('draft.bannerTitle')}</Text>
                </View>
                <Text style={st.draftCount}>{bannerDetail(readiness)}</Text>
                {bannerNote(readiness) !== '' && (
                  <Text style={st.draftWhy}>{bannerNote(readiness)}</Text>
                )}
                <View style={st.draftActions}>
                  {bannerActions(readiness, items).map((a) => (
                    <Pressable key={a.key} style={st.draftAdd} onPress={a.onPress}
                      accessibilityRole="button" accessibilityLabel={a.label}>
                      <Text style={st.draftAddPlus}>+</Text>
                      <Text style={st.draftAddText} numberOfLines={1}>{a.label}</Text>
                      <Text style={st.draftAddChev}>›</Text>
                    </Pressable>
                  ))}
                </View>
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
      </ScrollView>

      <BottomBar {...props} gate={gate} canSendNow={canSendNow} isDraft={isDraft} />
    </View>
  );
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
function DraftMoney({ rec, priceMode }: { rec: ExtraRecord; priceMode: 'fixed' | 'nte' }) {
  if (!rec.priced) {
    return <MoneyBlock amount={t('erec.priceToCome')} muted />;
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
function bannerDetail(r: SendReadiness): string {
  // Singular and plural are SEPARATE KEYS, not one string carrying "thing(s)".
  // `t()` interpolates and does not decline, so a single string has to hedge — and
  // "1 required thing(s) still missing" is what shipped. A contractor reading that
  // learns the app was written by someone who was not picturing him.
  if (r.blockers.length > 0) {
    return t(r.blockers.length === 1
      ? 'draft.bannerBlocked1'
      : { k: 'draft.bannerBlockedN', p: { n: r.blockers.length } });
  }
  if (r.recommended.length > 0) {
    return t(r.recommended.length === 1
      ? 'draft.bannerReadyGaps1'
      : { k: 'draft.bannerReadyGaps', p: { n: r.recommended.length } });
  }
  return t('draft.bannerReady');
}

/** The banner's THIRD line — why the count matters. D3 is the whole reason this is a
 *  separate function from `bannerDetail`: a blocker is a wall and a recommendation is
 *  help, and the two must never be given the same sentence. Nothing is said at all
 *  once the extra is ready and complete — a banner that keeps talking when there is
 *  nothing owed teaches him to stop reading it. */
function bannerNote(r: SendReadiness): string | undefined {
  if (r.blockers.length > 0) return t('draft.bannerBlockedNote');
  if (r.recommended.length > 0) return t('draft.bannerGapsNote');
  return undefined;
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
/** The gaps as ACTIONS — each one tappable straight to the field that fills it, which
 *  is what the design draws ("+ Add schedule impact ›"). Same source array as the
 *  count above, so the headline and the buttons can never disagree. */
function bannerActions(
  r: SendReadiness, items: readonly ChecklistItem[]
): readonly { key: string; label: string; onPress: () => void }[] {
  const byKey = new Map(items.map((i) => [i.key as string, i]));
  const src: readonly string[] = r.blockers.length > 0 ? r.blockers : r.recommended;
  return src.map((k) => {
    const it = byKey.get(k);
    return { key: k, label: it?.label ?? k, onPress: it?.onPress ?? (() => {}) };
  });
}

function bannerPills(r: SendReadiness, items: readonly ChecklistItem[]): readonly string[] {
  // Driven off `r.blockers` — THE SAME ARRAY the count above is length-of. Reading
  // the checklist's `state` instead let the two disagree: since 2026-07-28 all six
  // items gate Send, but the checklist still marks the four widened ones 'missing'
  // (that is what draws their softer ring), so filtering on 'blocking' returned two
  // pills under a headline that said four. A count with the wrong things named under
  // it is worse than a count alone.
  const label = new Map(items.map((i) => [i.key as string, i.label]));
  const src: readonly string[] = r.blockers.length > 0 ? r.blockers : r.recommended;
  return src.map((k) => label.get(k) ?? k);
}

/* -------------------------------------------------------------------- raw -- */

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
  const noWords = rec.voices.length > 0 && rec.voices.every((v) => !v.transcript);
  const [notesOpen, setNotesOpen] = React.useState(noWords);
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
  return (
    <Section title={t('draft.raw')}>
      {/* The standalone write-up block was removed 2026-07-28 to match the mockup,
          whose raw card is rows only (Captured notes · Photos · Requested by ·
          Source). The client-facing prose now lives once, under SCOPE → Description
          of work; the REQ-LC43 concern it used to carry — that an AI summary is not
          the frozen instrument — is handled there. */}
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

      {/* Requested-by is a FIELD (the composer asks it), so an unanswered one is
          offered to be filled. The capture source is a stored FACT, so an absent one
          is omitted — showing "Not set" beside it would invite him to fix something
          that is not his to fix.
          Both are drawn as a LABEL ROW WITH A PERSON UNDER IT rather than as a
          name in the value column: the design gives each an avatar, and a name is
          the one value on this screen that belongs to somebody rather than
          describing the work. */}
      <View style={{ marginTop: 12, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 6 }}>
        {p.requestedBy ? (
          <Pressable
            onPress={p.onEditClient ?? p.onEditDetails}
            accessibilityRole="button"
            accessibilityLabel={t('draft.requestedBy')}
            style={{ flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingVertical: 6 }}
          >
            <View style={{ flex: 1 }}>
              <Text style={labelStyle}>{t('draft.requestedBy')}</Text>
              <PersonRow name={p.requestedBy}
                role={p.clientTypeLabel || t('erec.approverRole')} kind="approver" />
            </View>
            <Text style={{ fontFamily: F.body, fontSize: 22, color: C.muted }}>›</Text>
          </Pressable>
        ) : (
          // THE NEGATIVE STATE, not a dead label. "Client — Not set" named the gap
          // and offered nothing; this says what to do and opens the drawer that
          // does it (contacts or type-it-in).
          <Row
            icon="person"
            label={t('draft.requestedBy')}
            sub={t('client.rowEmptySub')}
            value={t('client.rowEmptyAction')}
            tone="warn"
            chevron
            onPress={p.onEditClient ?? p.onEditDetails}
          />
        )}

        {/* SOURCE = the on-site person, drawn like "Requested by": avatar + name +
            "On-site observation". The capture-method string is the fallback only. */}
        {source ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 56,
            paddingVertical: 6, borderTopWidth: 1, borderTopColor: C.line }}>
            <View style={{ flex: 1 }}>
              <Text style={labelStyle}>{t('draft.source')}</Text>
              <PersonRow name={source.name} role={t('draft.sourceRole')} kind="crew" />
            </View>
          </View>
        ) : p.capturedWith != null ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48,
            paddingVertical: 6, borderTopWidth: 1, borderTopColor: C.line }}>
            <View style={{ flex: 1 }}>
              <Text style={labelStyle}>{t('draft.source')}</Text>
              <Text style={[T.bodySteel, { fontSize: 14, marginTop: 3 }]}>{p.capturedWith}</Text>
            </View>
          </View>
        ) : null}

        {/* ADD ANOTHER PERSON, once a client exists. An extra rarely involves only the
            person who signs it — an architect, an inspector, or the GC above you may
            all need to be reachable on this job. Offered only after the client is
            named: before that, the thing to do is name the client, not collect
            bystanders. Adding here NEVER changes who approves (see `saveClient`). */}
        {/* Everyone else on the job. Rendered exactly like the two rows above so
            the section reads as one list of humans, not two features. Not tappable:
            there is nothing to change about them from here, and a chevron that
            opened an editor would suggest this extra owns them — it does not. */}
        {(p.jobPeople ?? []).length > 0 && (
          <View style={{ borderTopWidth: 1, borderTopColor: C.line, paddingTop: 6 }}>
            <Text style={labelStyle}>{t('draft.alsoOnJob')}</Text>
            {(p.jobPeople ?? []).map((m) => (
              <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <PersonRow name={m.name} role={m.role} kind="crew" />
                </View>
                {/* A VISIBLE ✕, not a swipe (hadar, 2026-08-05). The swipe this
                    replaces was never shipped, and it was the wrong instinct here: a
                    hidden gesture is what CLAUDE.md §1 rules out — someone who does
                    not think in software has no reason to believe a row can be
                    swiped, so the ability may as well not exist. On Home the swipe
                    earns its keep because those rows are already tappable and a
                    button would compete with the card; these rows do nothing at all,
                    so the ✕ has the space and is the only affordance it needs.
                    44pt (mandate #3). Nothing is removed by the tap itself — it
                    opens the confirmation. */}
                {p.onRemovePerson && (
                  <Pressable
                    onPress={() => p.onRemovePerson?.(m.id, m.name)}
                    accessibilityRole="button"
                    accessibilityLabel={t({ k: 'client.removePerson', p: { name: m.name } } as any)}
                    hitSlop={8}
                    style={({ pressed }) => [st.removeX, pressed && { opacity: 0.5 }]}
                  >
                    <Text style={st.removeXT}>✕</Text>
                  </Pressable>
                )}
              </View>
            ))}
          </View>
        )}

        {p.requestedBy && p.onAddContact && (
          <Row
            icon="people"
            label={t('client.addContact')}
            sub={t('client.addContactSub')}
            chevron
            onPress={p.onAddContact}
          />
        )}
      </View>
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
      {/* 391 — ONE ScopeBlock, shared with the negotiation and locked screens, so the
          three stages cannot render the agreed text three different ways. Reads
          `scopeOfWork` and NOT `description`: description appends the voice augments,
          and what the client signed is the scope alone. */}
      <ScopeBlock
        text={rec.scopeOfWork}
        stage="draft"
        onEdit={p.onEditDescription}
        missing={blocked('no_description')}
      />

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
          <Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: C.brand }}>
            {open ? t('draft.showLess') : t('draft.showMore')}
          </Text>
          <Text style={{ fontFamily: F.body, fontSize: 13, color: C.brand }}>
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
    ...(p.kind === 'extra' ? [hard('no_cost', t('draft.cost'), p.onEditCost)] : []),
    soft('no_photos', t('draft.photos'), p.onAddPhotos),
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
}) {
  return (
    <View style={{
      borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.card,
      padding: 12, paddingBottom: 22, gap: 10,
    }}>
      <Button label={t('draft.editDetails')} icon="edit" variant="secondary" onPress={p.onEditDetails} />
      {/* The refusal rides INSIDE the button as its second line — the design puts
          "Add 2 missing details to send" under "Send for approval" rather than as a
          separate red sentence above. The rule that a refused Send must always SAY
          why is kept; it just says it where the tap happens. */}
      <Pressable
        onPress={p.onSend}
        disabled={!p.canSendNow}
        accessibilityRole="button"
        accessibilityState={{ disabled: !p.canSendNow }}
        accessibilityLabel={t('erec.send')}
        style={({ pressed }) => [st.sendBtn, pressed && p.canSendNow && { opacity: 0.85 }]}
      >
        <View style={st.sendTop}>
          <Icon name="send" size={19} color={C.card} />
          <Text style={st.sendLabel}>{t('erec.send')}</Text>
        </View>
        <SendSubtitle {...p} />
      </Pressable>

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
