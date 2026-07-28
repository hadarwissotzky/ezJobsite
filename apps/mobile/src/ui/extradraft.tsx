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
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { ExtraRecord } from '../record';
import type { ProcState } from '../status';
import {
  blockerKey, recommendationKey, sendGate,
  type SendBlocker, type SendGate, type SendReadiness, type SendRecommendation,
} from '../sendreadiness';
import { canDelete, canSend, chipKey, displayStatus, stageOf } from '../extralifecycle';
import { t } from '../i18n';
import {
  Button, ChecklistRow, PhotoGrid, Row, ScreenHeader, Section,
  StatusBanner, VoiceClip, type ChecklistState, type PhotoTile, type RowTone,
} from './kit';
import { C, F, T, label as labelStyle, money as moneyStyle } from './theme';
import { touchTargets } from './tokens';

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
  /** REQ-LC14 / T5: legal in this stage only. Rendered only when the caller offers
   *  it AND `canDelete` agrees — `planDiscard` remains the arbiter of the act. */
  onDelete?: () => void;
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

  return (
    <View style={T.screen}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 28 }}>
        {/* ScreenHeader owns the 54pt status-bar clearance. The kicker sits UNDER
            the title rather than above it (the record screen's order) because the
            header draws back + title as one unit and reordering two lines is not
            worth forking the one component that knows where the iPhone clock is. */}
        <ScreenHeader title={rec.title} onBack={props.onBack} backLabel={t('erec.back')} />
        <Text style={[labelStyle, { marginTop: 6 }]}>{kicker(props)}</Text>

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
              <StatusBanner
                kind="draft"
                title={t('draft.bannerTitle')}
                detail={bannerDetail(readiness)}
              />
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

        <Section title={t('draft.checklist')}>
          <Text style={[T.bodySteel, { fontSize: 13 }]}>
            {t({ k: 'draft.checklistCount', p: { have: doneCount(items), of: items.length } })}
          </Text>
          {/* The wall, counted separately from the fraction. `completeness` is the
              four recommended items only (REQ-LC11) — a blocker is not 25% of
              anything — so the blocking count is said in its own sentence. */}
          {readiness.blockers.length > 0 && (
            <Text style={[T.body, { fontSize: 13.5, color: C.danger, marginTop: 4 }]}>
              {t({ k: 'draft.mustFill', p: { n: readiness.blockers.length } })}
            </Text>
          )}
          {readiness.blockers.length === 0 && readiness.recommended.length > 0 && (
            <Text style={[T.bodySteel, { fontSize: 13, marginTop: 4 }]}>
              {t('send.recommended.note')}
            </Text>
          )}
          <View style={{ marginTop: 6 }}>
            {items.map((it) => (
              <ChecklistRow
                key={it.key}
                state={it.state}
                label={it.label}
                hint={it.hint}
                onPress={it.onPress}
              />
            ))}
          </View>
        </Section>

        {/* Delete sits last in the scroll, reachable but never adjacent to the
            thumb that is aiming at Send. Legal in this stage only (REQ-LC14). */}
        {props.onDelete && canDelete(rec.status) && (
          <Button
            label={t('discard.action')}
            variant="danger"
            onPress={props.onDelete}
            style={{ marginTop: 26 }}
          />
        )}
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
    return (
      <Text style={[moneyStyle, { fontSize: 24, color: C.steel, marginTop: 8 }]}>
        {t('erec.priceToCome')}
      </Text>
    );
  }
  const mode = priceMode === 'nte' && rec.nte
    ? t({ k: 'erec.nte', p: { amount: rec.nte } })
    : t('erec.fixed');
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 9, marginTop: 8 }}>
      <Text style={[moneyStyle, { fontSize: 30, color: C.ink }]}>{rec.amount}</Text>
      <Text style={T.bodySteel}>
        {mode}{rec.isMini ? ` · ${t('erec.mini')}` : ''} · {t('erec.yourPrice')}
      </Text>
    </View>
  );
}

/** The banner's second line — what is true now and what is owed next (REQ-LC24),
 *  and the one place D3 is most likely to be broken by a well-meaning edit. A
 *  recommended item is NEVER described as required here; the two counts come from
 *  the two separate lists and are worded as a wall and as help. */
function bannerDetail(r: SendReadiness): string {
  if (r.blockers.length > 0) {
    return t({ k: 'draft.bannerBlocked', p: { n: r.blockers.length } });
  }
  if (r.recommended.length > 0) {
    return t({ k: 'draft.bannerReadyGaps', p: { n: r.recommended.length } });
  }
  return t('draft.bannerReady');
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
  const tiles: PhotoTile[] = rec.photos.map((ph) => ({
    key: ph.captureId, uri: ph.uri, present: ph.present, caption: ph.at,
  }));
  return (
    <Section title={t('draft.raw')}>
      <Text style={[T.bodySteel, { fontSize: 12.5, marginBottom: 10 }]}>{t('draft.rawNote')}</Text>

      {/* THE APP'S WRITE-UP LIVES HERE, NOT IN THE DOCUMENT SECTION, and the move
          is REQ-LC43 applied rather than quoted. `rec.description` is built from
          `change_order.summary`, which the spec rules "a derived reading aid, never
          the binding instrument": it is not in `change_order_frozen`'s column list,
          it is not what `sendForConfirmation` puts in `shown_content` (that is
          `co.scope`, twice), and an appended voice note can still rewrite it after
          send. It was rendered under "This is exactly what the owner reads", which
          was false about every extra whose AI summary differed from its title —
          i.e. every extra the pipeline processed with confidence. `extralocked.tsx`
          refuses to render this same string for exactly this reason. Under THIS
          heading, whose note already says the owner does not see it, it is honest
          and still useful. */}
      {rec.description.trim() && rec.description.trim() !== rec.title.trim() && (
        <View style={{ marginBottom: 12 }}>
          <Text style={labelStyle}>{t('draft.writeUp')}</Text>
          <Text style={[T.body, { fontSize: 15, marginTop: 4 }]} selectable>
            {rec.description}
          </Text>
        </View>
      )}

      {rec.voices.length === 0 && (
        <Text style={[T.bodySteel, { fontSize: 13.5 }]}>{t('draft.noNotes')}</Text>
      )}
      {rec.voices.map((v, i) => (
        <View key={v.captureId} style={{ marginBottom: 12 }}>
          <Text style={labelStyle}>
            {rec.voices.length > 1 ? t({ k: 'erec.voiceN', p: { n: i + 1 } }) : t('erec.voice')}
          </Text>
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

      <Text style={[labelStyle, { marginTop: 4, marginBottom: 8 }]}>
        {t({ k: 'erec.evidence', p: { n: rec.photos.length } })}
      </Text>
      <PhotoGrid
        photos={tiles}
        missingLabel={t('erec.evidenceMissing')}
        onPressPhoto={p.onPressPhoto ? (photo) => p.onPressPhoto?.(photo.uri) : undefined}
        onAddMore={p.onAddPhotos}
        addLabel={t('erec.addPhoto')}
      />
      {rec.photosTruncated > 0 && (
        <Text style={[T.bodySteel, { fontSize: 12, marginTop: 8 }]}>
          {t({ k: 'erec.evidenceMore', p: { n: rec.photosTruncated } })}
        </Text>
      )}

      <View style={{ marginTop: 6 }}>
        {/* Requested-by is a FIELD (the composer asks it), so an unanswered one is
            offered to be filled. The capture source is a stored FACT, so an absent
            one is omitted — showing "Not set" beside it would invite him to fix
            something that is not his to fix. */}
        <Row
          icon="person"
          label={t('draft.requestedBy')}
          value={p.requestedBy ?? t('draft.notSet')}
          tone={p.requestedBy ? 'default' : 'warn'}
          chevron
          onPress={p.onEditDetails}
        />
        {p.capturedWith != null && (
          <Row icon="microphone" label={t('draft.capturedWith')} value={p.capturedWith} />
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
      <Text style={[T.bodySteel, { fontSize: 12.5, marginBottom: 10 }]}>{t('draft.scopeNote')}</Text>

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
      <DescriptionBlock
        text={rec.title}
        blocked={blocked('no_description')}
        onPress={p.onEditDescription}
      />

      {p.kind === 'extra' && (
        <Row
          icon="approval"
          label={t('draft.cost')}
          sub={p.priceMode === 'nte' && rec.nte ? t({ k: 'erec.nte', p: { amount: rec.nte } }) : undefined}
          value={blocked('no_cost') ? t('draft.notSet') : rec.amount}
          tone={blocked('no_cost') ? 'danger' : 'default'}
          chevron
          onPress={p.onEditCost}
        />
      )}
      <Row
        icon="clock"
        label={t('draft.schedule')}
        value={scheduleLabel(p.scheduleEffect, p.scheduleDays) ?? t('draft.notSet')}
        tone={softTone('no_schedule_effect')}
        chevron
        onPress={p.onEditSchedule}
      />
      <Row
        icon="job"
        label={t('draft.billing')}
        value={billingLabel(p.billingTiming) ?? t('draft.notSet')}
        tone={softTone('no_billing_timing')}
        chevron
        onPress={p.onEditBilling}
      />
      <Row
        icon="close"
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
const CLAMP_CHARS = 220;

function DescriptionBlock({ text, blocked, onPress }: {
  text: string;
  blocked: boolean;
  onPress: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const long = text.length > CLAMP_CHARS;
  return (
    <View style={{ paddingVertical: 8 }}>
      <Row label={t('draft.description')} chevron onPress={onPress} />
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
          style={{ minHeight: touchTargets.minimum, justifyContent: 'center' }}
        >
          <Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: C.brand }}>
            {open ? t('draft.showLess') : t('draft.showMore')}
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
    hard('no_description', t('draft.description'), p.onEditDescription),
    ...(p.kind === 'extra' ? [hard('no_cost', t('draft.cost'), p.onEditCost)] : []),
    soft('no_photos', t('draft.photos'), p.onAddPhotos),
    soft('no_billing_timing', t('draft.billing'), p.onEditBilling),
    soft('no_schedule_effect', t('draft.schedule'), p.onEditSchedule),
    soft('no_exclusions', t('draft.exclusions'), p.onEditExclusions),
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
      <SendReason {...p} />
      <Button label={t('draft.editDetails')} variant="secondary" onPress={p.onEditDetails} />
      <Button
        label={t('erec.send')}
        icon="send"
        onPress={p.onSend}
        disabled={!p.canSendNow}
      />
    </View>
  );
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
    return (
      <View style={{ gap: 4 }}>
        {p.gate.readiness.blockers.map((b) => (
          <Text key={b} style={[T.body, { fontSize: 13.5, color: C.danger }]}>{t(blockerKey(b))}</Text>
        ))}
      </View>
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
        {t({ k: 'draft.sendAnyway', p: { n: p.readiness.recommended.length } })}
      </Text>
    );
  }
  return null;
}
