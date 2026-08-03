/**
 * The five detail sub-screens the three lifecycle stages navigate into.
 *
 * ONE FILE ON PURPOSE. These are five small screens that share one frame (header ·
 * scrolling body · a footer that says what the record's state is), one editability
 * rule and one read-only notice. Split five ways, the frame gets copied five times
 * and the fifth copy is the one that forgets the frozen banner — which is the
 * failure this file's whole editability section exists to prevent.
 *
 * EDITABILITY IS DERIVED FROM STATUS, NEVER PASSED AS A FLAG. Every screen here
 * takes the STORED `change_order.status` and asks `canEdit()` (REQ-LC14: stage 1
 * only). A `readOnly` boolean prop would let a caller hand a sent extra an editable
 * price field, and the freeze that stops it would then be a database error surfacing
 * after the contractor had already retyped a number. The three stages also fail
 * DIFFERENTLY and are said differently: a draft is editable, a sent extra is frozen
 * because the client is reading it right now (REQ-LC15), an approved one is sealed
 * forever (REQ-LC30). "You can't edit this" without which of those is true is the
 * kind of dead end that sends someone back to a text message.
 *
 * THE AI NEVER REPLACES WHAT A PERSON WROTE. `ScopeOfWorkEditor` treats both
 * "Improve wording" and "Use captured notes" as PROPOSALS: the suggested text is
 * shown beside its source and nothing is written until the contractor taps "Use this
 * wording". Mandate #10 puts a human editor in the loop on every bilingual/ambient
 * precedent that works, and mandate #2's reasoning applies here even though this
 * text carries no figure — the scope IS the commitment the price attaches to, and an
 * LLM silently rewording it is the same class of act as an LLM silently pricing it.
 *
 * NOTHING HERE FETCHES. Every screen is a pure function of its props, so the wiring
 * that assembles them stays in one place instead of growing a second query per
 * sub-screen — and so the editors can be reasoned about without a database.
 *
 * KIT GAPS THIS FILE WORKS AROUND, reported rather than smuggled (two of the three
 * were already reported by the Stage 3 screen and are restated, not rediscovered):
 *   1. no non-lifecycle `Notice` primitive — the frozen/locked boxes are properties
 *      of the RECORD, not of `displayStatus`, so borrowing a StatusBanner kind would
 *      print a false status. Local `Notice`, same `tint()` tokens, no fork.
 *   2. `TimelineRow` draws a dot on an open rail; a completed history wants a check.
 *      Local `Step`, same shape `extralocked.tsx` had to write for the same reason.
 *   3. `PhotoGrid` has no badge or selection slot, so the best-photo mark is drawn
 *      OVER a kit tile rather than inside a forked one — the missing/undecodable
 *      honesty (mandate #1) stays in exactly one component.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { ApprovalPanel } from '../eventlog';
import type { MergedEvent } from '../eventtimeline';
import { canEdit, chipKey, displayStatus, stageOf } from '../extralifecycle';
import { t } from '../i18n';
import type { SendBlocker } from '../sendreadiness';
import { nteClause, type PriceMode, type VoicePriceReading } from '../voiceprice';
import { Icon, type IconName } from './icon';
import {
  Button, Card, PhotoGrid, PersonRow, Row, ScreenHeader, Section, VoiceClip,
  type PhotoTile,
} from './kit';
import { RecordApproval } from './recordapproval';
import { C, F, T, label as labelStyle, money as moneyStyle, tint, type Tone } from './theme';
import { radii, touchTargets } from './tokens';

/* ================================================================ editability == */

/**
 * May this screen's fields be changed, and if not, WHY not — in the words the
 * contractor needs, which are different per stage.
 *
 * `canEdit` is the single authority (`extralifecycle.ts`, REQ-LC14). This function
 * adds no rule of its own; it only picks the sentence.
 */
function editability(status: string): { editable: boolean; noticeKeys: [string, string] | null } {
  if (canEdit(status)) return { editable: true, noticeKeys: null };
  return stageOf(status) === 'negotiation'
    ? { editable: false, noticeKeys: ['det.frozenSentTitle', 'det.frozenSentBody'] }
    : { editable: false, noticeKeys: ['det.frozenLockedTitle', 'det.frozenLockedBody'] };
}

/** The footer line every sub-screen ends on: what state the record is in. The
 *  mockup's "Draft – not sent"; for anything past draft it is the chip word, so a
 *  frozen editor never carries a footer claiming the record is still a draft. */
function stateFooter(status: string): string {
  return stageOf(status) === 'draft'
    ? t('draft.bannerTitle')
    : t(chipKey(displayStatus(status)));
}

/* =============================================================== 1. scope ===== */

/** One captured note, exactly as `record.ts` holds it: the verbatim transcript, or
 *  the honest reason there isn't one. The three states are three different facts
 *  and are said as three different sentences (the same three `extradraft.tsx`
 *  uses, from the same keys — one wording for one fact). */
export type RawNote = {
  key: string;
  /** "Voice note 2 · Jul 20 · 2:14 pm", already assembled by the caller. */
  heading: string;
  /** The full spoken words. Null when nothing has been written down yet. */
  text: string | null;
  /** False when the audio the row promises is not on this device (mandate #1). */
  present: boolean;
  /** The audio file itself, so this tab can PLAY it and not only quote it. Optional
   *  because a note may exist with no clip behind it; when it is absent there is
   *  simply no player, never a dead button. */
  uri?: string;
};

/**
 * The state of a caller-owned rewrite. It is a STATE MACHINE rather than a
 * `Promise<string>` callback because a rewrite crosses the network: it can be in
 * flight when the screen re-renders, and it can fail, and a failure that is not
 * representable becomes a spinner that never stops.
 */
export type RewriteState =
  | { phase: 'idle' }
  | { phase: 'working' }
  /** The machine's suggestion. NOT written anywhere until the contractor accepts. */
  | { phase: 'proposed'; text: string }
  /** `whyKey` is an already-existing i18n key from the caller — this screen does not
   *  invent a reason for a failure it did not observe. */
  | { phase: 'failed'; whyKey: string };

export type ScopeOfWorkEditorProps = {
  /** The STORED `change_order.status`. Drives editability; never a display status. */
  status: string;
  /** The raw side of the toggle — read-only in every stage, including draft. These
   *  are evidence: they are what was said, and what was said cannot be edited. */
  notes: readonly RawNote[];
  /** The client-facing scope of work, as stored. */
  value: string;
  onChange: (next: string) => void;
  /** The counter's denominator. 1500 unless the caller knows better. */
  maxChars?: number;
  rewrite: RewriteState;
  onRewrite: () => void;
  /** Put `rewrite` back to `idle`. Called once the screen has finished with a
   *  proposal, whether it was accepted or thrown away — without it a dismissed
   *  suggestion would reappear on the next render. */
  onRewriteDone: () => void;
  onBack: () => void;
  onSave: () => void;
};

const DEFAULT_MAX_CHARS = 1500;

type Tab = 'raw' | 'client';

export function ScopeOfWorkEditor(props: ScopeOfWorkEditorProps) {
  const { editable, noticeKeys } = editability(props.status);
  const [tab, setTab] = React.useState<Tab>('client');
  const max = props.maxChars ?? DEFAULT_MAX_CHARS;

  // "Use captured notes" is proposed, not applied — the same path the AI's
  // suggestion takes, so there is exactly ONE way text can replace what a person
  // wrote and it always passes under their thumb first.
  const [notesProposed, setNotesProposed] = React.useState(false);
  const notesText = joinNotes(props.notes);
  const proposal: { fromAi: boolean; text: string } | null =
    notesProposed && notesText ? { fromAi: false, text: notesText }
    : props.rewrite.phase === 'proposed' ? { fromAi: true, text: props.rewrite.text }
    : null;

  const finish = (accept: boolean) => {
    if (accept && proposal) props.onChange(proposal.text);
    if (proposal?.fromAi) props.onRewriteDone();
    setNotesProposed(false);
  };

  return (
    <Frame
      title={t('draft.description')}
      status={props.status}
      onBack={props.onBack}
      footer={editable
        ? <Button label={t('det.saveScope')} icon="approved" onPress={props.onSave} />
        : null}
    >
      {noticeKeys && <Notice tone="neutral" icon="lock" keys={noticeKeys} />}

      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { key: 'raw', label: t('det.tabRaw') },
          { key: 'client', label: t('det.tabClient') },
        ]}
      />

      {tab === 'raw' ? <RawNotes notes={props.notes} /> : (
        <>
          <Card>
            <Text style={[T.bodySteel, st.hint]}>{t('draft.scopeNote')}</Text>
            {editable ? (
              <TextInput
                value={props.value}
                onChangeText={props.onChange}
                multiline
                maxLength={max}
                style={st.input}
                placeholder={t('det.sowPlaceholder')}
                placeholderTextColor={C.steel}
                accessibilityLabel={t('det.tabClient')}
              />
            ) : (
              <Text selectable style={[T.body, { marginTop: 8 }]}>
                {props.value.trim() || t('det.sowEmpty')}
              </Text>
            )}
            <Counter n={props.value.length} of={max} />
            {editable && !props.value.trim() && (
              <Text style={st.warnLine}>{t('det.sowEmpty')}</Text>
            )}
          </Card>

          {editable && (
            <RewriteActions
              rewrite={props.rewrite}
              canUseNotes={!!notesText}
              onUseNotes={() => setNotesProposed(true)}
              onRewrite={props.onRewrite}
            />
          )}

          {proposal && (
            <ProposalCard
              fromAi={proposal.fromAi}
              text={proposal.text}
              onAccept={() => finish(true)}
              onDismiss={() => finish(false)}
            />
          )}
        </>
      )}
    </Frame>
  );
}

/** The notes, joined, as the "start over" source. Derived from the SAME array the
 *  Raw tab renders so the two can never disagree about what the notes say. */
function joinNotes(notes: readonly RawNote[]): string {
  return notes.map((n) => n.text?.trim()).filter((s): s is string => !!s).join('\n\n');
}

function RawNotes({ notes }: { notes: readonly RawNote[] }) {
  return (
    <Card>
      <Text style={[T.bodySteel, st.hint]}>{t('draft.rawNote')}</Text>
      {notes.length === 0 && <Text style={st.silent}>{t('draft.noNotes')}</Text>}
      {notes.map((n) => (
        <View key={n.key} style={{ marginTop: 12 }}>
          <Text style={labelStyle}>{n.heading}</Text>
          {/* The recording, playable. This tab is the only place a SENT or APPROVED
              extra's audio is reachable at all — the three stage screens render the
              transcript alone — and a transcript that has not landed yet (offline, no
              STT) would otherwise leave the capture unreadable on the device holding
              it. */}
          {n.uri && (
            <VoiceClip
              uri={n.uri}
              present={n.present}
              playLabel={t('erec.voicePlay')}
              missingLabel={t('erec.voiceMissing')}
            />
          )}
          {n.text
            ? <Text selectable style={[T.body, { marginTop: 4 }]}>{n.text}</Text>
            : n.present
              ? <Text style={[st.silent, { marginTop: 4 }]}>{t('erec.transcriptPending')}</Text>
              // Mandate #1: audio that is gone SAYS it is gone, and is never dressed
              // up as "still processing" — one is a wait, the other is a loss. Said
              // once: when there is a clip, `VoiceClip` above has already said it.
              : n.uri ? null
              : <Text style={[st.dangerLine, { marginTop: 4 }]}>{t('erec.voiceMissing')}</Text>}
        </View>
      ))}
    </Card>
  );
}

/** "368/1500". Turns red only when the text is at the cap, because the cap is the
 *  only condition the writer can do anything about. */
export function Counter({ n, of }: { n: number; of: number }) {
  const full = n >= of;
  return (
    <Text style={[st.counter, full && { color: C.danger }]}>
      {t({ k: 'det.charCount', p: { n, of } })}
      {full ? ` · ${t('det.charFull')}` : ''}
    </Text>
  );
}

export function RewriteActions({ rewrite, canUseNotes, onUseNotes, onRewrite }: {
  rewrite: RewriteState;
  canUseNotes: boolean;
  onUseNotes: () => void;
  onRewrite: () => void;
}) {
  const working = rewrite.phase === 'working';
  return (
    <>
      <Row
        icon="microphone"
        label={t('det.useNotes')}
        sub={canUseNotes ? t('det.useNotesSub') : t('det.useNotesNone')}
        chevron={canUseNotes}
        onPress={canUseNotes ? onUseNotes : undefined}
      />
      <Row
        icon="edit"
        label={working ? t('det.improveWorking') : t('det.improve')}
        sub={t('det.improveSub')}
        chevron={!working}
        onPress={working ? undefined : onRewrite}
      />
      {rewrite.phase === 'failed' && (
        <Text style={st.dangerLine}>
          {t('det.improveFailed')} {t(rewrite.whyKey)}
        </Text>
      )}
    </>
  );
}

/**
 * A suggestion, shown as a suggestion.
 *
 * The two sources say different things about themselves and it matters: the notes
 * are the contractor's own words verbatim, and the machine's version is a guess he
 * is being asked to check. Labelling both "suggested wording" would put the app's
 * invention and the man's own sentence on the same footing.
 */
export function ProposalCard({ fromAi, text, onAccept, onDismiss }: {
  fromAi: boolean;
  text: string;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const c = tint('caution');
  return (
    <View style={[st.proposal, { backgroundColor: c.soft, borderColor: c.line }]}>
      <Text style={[st.noticeTitle, { color: c.ink }]}>
        {t(fromAi ? 'det.proposedAiTitle' : 'det.proposedNotesTitle')}
      </Text>
      <Text style={[st.noticeBody, { color: c.ink }]}>
        {t(fromAi ? 'det.proposedAiBody' : 'det.proposedNotesBody')}
      </Text>
      <View style={st.proposalText}>
        <Text selectable style={T.body}>{text}</Text>
      </View>
      <View style={{ gap: 10, marginTop: 12 }}>
        <Button label={t('det.useThis')} onPress={onAccept} />
        <Button label={t('det.keepMine')} variant="ghost" onPress={onDismiss} />
      </View>
    </View>
  );
}

/* ========================================================= 2. price/schedule == */

export type PriceScheduleEditorProps = {
  status: string;
  /** A Decision carries no price by definition (R10 / REQ-LC12), so it gets no price
   *  block at all — not a hidden one. */
  kind: 'extra' | 'decision';
  priceMode: PriceMode;
  onPriceModeChange: (m: PriceMode) => void;
  /** RAW TEXT, owned by the caller. The screen never parses money: there is one
   *  money parser in this product (`changeorder.ts`) and a second one on a device
   *  means the phone and the server can disagree about what a man typed. */
  amountText: string;
  onAmountChange: (s: string) => void;
  nteText: string;
  onNteChange: (s: string) => void;
  /** Mandate #6's read-back: what the app believes the typed text MEANS, formatted
   *  by the one `money()`. Null when the text resolves to no number — which is a
   *  different fact from zero and is said differently. */
  amountReadback: string | null;
  nteReadback: string | null;
  /** What the recording said about money (`voiceprice.ts`). Null when this device
   *  has no transcript yet. Shown for every outcome including "nothing heard":
   *  silence about a missing price reads as a price that is fine. */
  reading: VoicePriceReading | null;
  scheduleEffect: string | null;
  onScheduleEffectChange: (v: string) => void;
  /** Raw text again, for the same reason the amount is. */
  scheduleDaysText: string;
  onScheduleDaysChange: (s: string) => void;
  billingTiming: string | null;
  onBillingTimingChange: (v: string) => void;
  exclusions: string;
  onExclusionsChange: (s: string) => void;
  /** From `sendReadiness`. Used ONLY to mark the cost row — never re-derived here,
   *  so the editor and the send button can never disagree about what is missing. */
  blockers: readonly SendBlocker[];
  onBack: () => void;
  onSave: () => void;
};

export function PriceScheduleEditor(props: PriceScheduleEditorProps) {
  const { editable, noticeKeys } = editability(props.status);
  const costBlocked = props.blockers.includes('no_cost');

  return (
    <Frame
      title={t('det.priceTitle')}
      status={props.status}
      onBack={props.onBack}
      footer={editable
        ? <Button label={t('det.savePrice')} icon="approved" onPress={props.onSave} />
        : null}
    >
      {noticeKeys && <Notice tone="neutral" icon="lock" keys={noticeKeys} />}

      {props.kind === 'decision' ? (
        // R6b AC2: no figure anywhere on a Decision, not even an empty field.
        <Card><Text style={T.body}>{t('erec.noCostChange')}</Text></Card>
      ) : (
        <>
          <Section title={t('r2.modeLabel')}>
            {/* R3's closed pair. Never a free-text box and never a bare range —
                "range approvals reproduce the dispute at billing time". */}
            <Choice
              value={props.priceMode}
              disabled={!editable}
              onChange={(m) => props.onPriceModeChange(m)}
              options={[
                { key: 'fixed' as PriceMode, label: t('r2.modeFixed') },
                { key: 'nte' as PriceMode, label: t('r2.modeNte'), sub: t('det.modeNteSub') },
              ]}
            />
            <Text style={[T.bodySteel, { marginTop: 8 }]}>
              {props.reading?.modeHeard && props.reading.mode === props.priceMode
                ? t('r2.modeFromVoice')
                : t('r2.modeYours')}
            </Text>
          </Section>

          <HeardBlock reading={props.reading} />

          <Section title={t('draft.cost')}>
            <MoneyField
              label={t('det.total')}
              value={props.amountText}
              onChange={props.onAmountChange}
              editable={editable}
              readback={props.amountReadback
                ? t({ k: 'det.readback', p: { amount: props.amountReadback } })
                : t('det.readbackNone')}
              alarm={costBlocked && !props.amountReadback}
            />
            {props.priceMode === 'nte' && (
              <MoneyField
                label={t('det.cap')}
                value={props.nteText}
                onChange={props.onNteChange}
                editable={editable}
                readback={props.nteReadback
                  ? t({ k: 'det.capReadback', p: { amount: props.nteReadback } })
                  : t('det.capRequired')}
                alarm={!props.nteReadback}
              />
            )}
            {/* R3 makes this sentence mandatory on an NTE, and it is previewed next
                to the cap that obliges it so the two can never be set apart. The
                clause is built by `nteClause()` — the module that owns the mode owns
                the promise about the mode. */}
            <NteClause mode={props.priceMode} cap={props.nteReadback} />
          </Section>

          {costBlocked && <Text style={st.dangerLine}>{t('send.blocked.noCost')}</Text>}
        </>
      )}

      <Section title={t('draft.schedule')}>
        {/* "not sure yet" is a COMPLETE answer (FLOW decision 3): it renders to the
            owner as "to be confirmed", which is honest and revisable. Hiding it would
            let a client read silence as "this does not delay my job". */}
        <Choice
          value={props.scheduleEffect}
          disabled={!editable}
          onChange={props.onScheduleEffectChange}
          options={[
            { key: 'no_change', label: t('co.schedNo') },
            { key: 'adds_days', label: t('co.schedAdds') },
            { key: 'not_sure', label: t('co.schedUnsure'), sub: t('det.schedUnsureSub') },
          ]}
        />
        {props.scheduleEffect === 'adds_days' && (
          <View style={{ marginTop: 12 }}>
            <Text style={labelStyle}>{t('det.schedDaysLabel')}</Text>
            <TextInput
              value={props.scheduleDaysText}
              onChangeText={props.onScheduleDaysChange}
              editable={editable}
              keyboardType="number-pad"
              style={[st.input, st.inputShort]}
              accessibilityLabel={t('det.schedDaysLabel')}
            />
          </View>
        )}
      </Section>

      <Section title={t('draft.billing')}>
        <Choice
          value={props.billingTiming}
          disabled={!editable}
          onChange={props.onBillingTimingChange}
          options={[
            { key: 'next_invoice', label: t('co.billNext') },
            { key: 'when_completed', label: t('co.billDone') },
            { key: 'other', label: t('co.billOther') },
          ]}
        />
      </Section>

      <Section title={t('draft.exclusions')}>
        <Text style={[T.bodySteel, st.hint]}>{t('det.exclusionsHint')}</Text>
        {editable ? (
          <TextInput
            value={props.exclusions}
            onChangeText={props.onExclusionsChange}
            multiline
            style={st.input}
            placeholder={t('det.exclusionsPlaceholder')}
            placeholderTextColor={C.steel}
            accessibilityLabel={t('draft.exclusions')}
          />
        ) : (
          <Text selectable style={[T.body, { marginTop: 8 }]}>
            {props.exclusions.trim() || t('det.exclusionsNone')}
          </Text>
        )}
      </Section>
    </Frame>
  );
}

/**
 * The tap-to-correct field with its read-back underneath.
 *
 * The read-back is the point of the whole control (mandate #6): the number is
 * ALWAYS shown back as the app understood it, so the difference between "1850" and
 * "$18.50" is visible before it is under a signature rather than after. It renders
 * even when the field is read-only, because on a frozen record the question "what
 * exactly did I send?" is the one being asked.
 */
export function MoneyField({ label, value, onChange, editable, readback, alarm }: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  editable: boolean;
  readback: string;
  alarm?: boolean;
}) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={labelStyle}>{label}</Text>
      {editable ? (
        <TextInput
          value={value}
          onChangeText={onChange}
          keyboardType="decimal-pad"
          style={[st.input, st.money]}
          placeholder="0.00"
          placeholderTextColor={C.steel}
          accessibilityLabel={label}
        />
      ) : (
        <Text style={[st.money, { marginTop: 6 }]}>{value || '—'}</Text>
      )}
      <Text style={[st.readback, alarm && { color: C.danger }]}>{readback}</Text>
    </View>
  );
}

/** R3's mandatory clause, from the module that owns the mode. Rendered with a
 *  placeholder until the cap resolves — a clause reading "$0.00" would be a lie on
 *  a record someone signs. */
export function NteClause({ mode, cap }: { mode: PriceMode; cap: string | null }) {
  const clause = nteClause(mode, cap ?? t('r2.nteAmountPending'));
  if (!clause) return null;
  return (
    <View style={st.clause}>
      <Text style={T.body}>{t({ k: clause.k, p: clause.p })}</Text>
    </View>
  );
}

/** What the recording said about money — the sentence the number came from, quoted.
 *  Same keys `voicepricecard.tsx` uses, so there is one wording for one finding
 *  even though the two cards are drawn differently. */
export function HeardBlock({ reading }: { reading: VoicePriceReading | null }) {
  if (!reading) return null;
  return (
    <Card>
      <Text style={labelStyle}>{t('r2.heardLabel')}</Text>
      <Text style={[T.body, { marginTop: 4 }]}>
        {t({ k: reading.reasonKey, p: reading.reasonParams })}
      </Text>
      {reading.heard && (
        <Text style={[T.bodySteel, { marginTop: 6, fontStyle: 'italic' }]}>
          “{reading.heard}”
        </Text>
      )}
      {reading.prefill && (
        <Text style={[T.bodySteel, { marginTop: 6 }]}>{t('r2.checkNumber')}</Text>
      )}
    </Card>
  );
}

/* ========================================================== 3. photos/proof === */

/** One piece of visual evidence, with the stamp that makes it evidence (mandate #9).
 *  `place` is null when there was no fix — which is SAID, never filled in from a
 *  last-known position (`stamp.ts` rule 2: a stale fix from another jobsite is worse
 *  than nothing, because nothing is honest). */
export type ProofPhoto = {
  key: string;
  uri: string;
  present: boolean;
  /** Already formatted capture time. */
  at: string;
  /** Already formatted place, or null when none was recorded. */
  place: string | null;
};

export type PhotosAndProofProps = {
  status: string;
  photos: readonly ProofPhoto[];
  /** How many the render cap dropped (`ExtraRecord.photosTruncated`). */
  truncated?: number;
  /** The extra's own stamp, for the header. Null values are stated, not hidden. */
  capturedAt: string | null;
  capturedPlace: string | null;
  /** The photo the owner should see first. Null when nobody has chosen one.
   *  SEE THE HANDOFF: no column stores this yet — the caller owns it. */
  bestKey: string | null;
  /** Omit on a record whose evidence is frozen, or when there is nowhere to store
   *  the choice. `null` clears it. */
  onMarkBest?: (key: string | null) => void;
  onPressPhoto?: (p: ProofPhoto) => void;
  onAddPhoto?: () => void;
  onAddVoiceNote?: () => void;
  onBack: () => void;
};

export function PhotosAndProof(props: PhotosAndProofProps) {
  const { editable, noticeKeys } = editability(props.status);
  // "Choosing" is a mode rather than an always-on selection because a tile has two
  // jobs — open me, and pick me — and a tile that silently changes which one it does
  // is how someone marks the wrong photo without noticing.
  const [choosing, setChoosing] = React.useState(false);
  const canChoose = editable && !!props.onMarkBest && props.photos.length > 0;
  const unstamped = props.photos.filter((p) => !p.place).length;

  return (
    <Frame title={t('det.photosTitle')} status={props.status} onBack={props.onBack}>
      {noticeKeys && <Notice tone="neutral" icon="lock" keys={noticeKeys} />}

      {/* Mandate #9's header: where and when. An absent fix is named, so nobody
          reads a blank line as "no location was needed". */}
      <Section title={t('det.stampTitle')}>
        <Row
          icon="clock"
          label={t('det.stampWhen')}
          value={props.capturedAt ?? t('erec.noTime')}
          tone={props.capturedAt ? 'default' : 'warn'}
        />
        <Row
          icon="mapPin"
          label={t('det.stampWhere')}
          value={props.capturedPlace ?? t('det.noPlace')}
          tone={props.capturedPlace ? 'default' : 'warn'}
        />
        <Text style={[T.bodySteel, { marginTop: 8 }]}>{t('det.stampWhy')}</Text>
      </Section>

      <Section title={t({ k: 'erec.evidence', p: { n: props.photos.length } })}>
        {props.photos.length === 0 && <Text style={st.silent}>{t('det.noPhotos')}</Text>}

        <ProofGrid
          photos={props.photos}
          bestKey={props.bestKey}
          choosing={choosing}
          onPick={(p) => { props.onMarkBest?.(p.key); setChoosing(false); }}
          onOpen={props.onPressPhoto}
          onAdd={editable ? props.onAddPhoto : undefined}
        />

        {(props.truncated ?? 0) > 0 && (
          <Text style={[T.bodySteel, { fontSize: 12, marginTop: 8 }]}>
            {t({ k: 'erec.evidenceMore', p: { n: props.truncated ?? 0 } })}
          </Text>
        )}

        {/* Stated rather than left to be noticed: a photo with no location is still
            a photo, but it is weaker evidence and the person relying on it should
            know which ones they are. */}
        {unstamped > 0 && (
          <Text style={[T.bodySteel, { marginTop: 8 }]}>
            {t({ k: 'det.someNoPlace', p: { n: unstamped } })}
          </Text>
        )}
      </Section>

      {canChoose && (
        <Section title={t('det.bestTitle')}>
          <Text style={[T.bodySteel, st.hint]}>
            {choosing ? t('det.pickBestOn') : t('det.pickBestWhy')}
          </Text>
          <Button
            label={choosing ? t('det.pickBestCancel') : t('det.pickBest')}
            variant={choosing ? 'ghost' : 'secondary'}
            onPress={() => setChoosing((v) => !v)}
          />
          {props.bestKey != null && !choosing && (
            <Button
              label={t('det.clearBest')}
              variant="ghost"
              onPress={() => props.onMarkBest?.(null)}
              style={{ marginTop: 8 }}
            />
          )}
        </Section>
      )}

      {editable && props.onAddVoiceNote && (
        <Button
          label={t('det.addVoice')}
          icon="microphone"
          variant="secondary"
          onPress={props.onAddVoiceNote}
          style={{ marginTop: 14 }}
        />
      )}
    </Frame>
  );
}

/**
 * The grid, with the best-photo mark drawn OVER a kit tile.
 *
 * Each tile is a one-item `PhotoGrid` so that "the file is missing" and "the file
 * will not decode" stay in exactly one component (mandate #1) — a second tile
 * implementation here is a second chance to render silent loss as a grey square.
 * Everything this function adds is an overlay: a badge and a ring, neither of which
 * can hide the honesty underneath.
 */
function ProofGrid({ photos, bestKey, choosing, onPick, onOpen, onAdd }: {
  photos: readonly ProofPhoto[];
  bestKey: string | null;
  choosing: boolean;
  onPick: (p: ProofPhoto) => void;
  onOpen?: (p: ProofPhoto) => void;
  onAdd?: () => void;
}) {
  const tileOf = (p: ProofPhoto): PhotoTile => ({
    key: p.key, uri: p.uri, present: p.present, caption: p.at,
  });
  return (
    <View style={st.grid}>
      {photos.map((p) => (
        <View key={p.key}>
          <PhotoGrid
            photos={[tileOf(p)]}
            missingLabel={t('erec.evidenceMissing')}
            onPressPhoto={choosing ? () => onPick(p) : onOpen ? () => onOpen(p) : undefined}
          />
          {/* A text star, the same way the kit draws its chevron as a text '›' —
              there is no star in the icon set and inventing one as artwork would
              put a drawing in a file that owns no drawings. */}
          {bestKey === p.key && (
            <View style={st.badge} pointerEvents="none">
              <Text style={st.badgeT}>★ {t('det.bestBadge')}</Text>
            </View>
          )}
          {choosing && <View style={st.pickRing} pointerEvents="none" />}
        </View>
      ))}
      {onAdd && (
        <PhotoGrid
          photos={[]}
          missingLabel={t('erec.evidenceMissing')}
          onAddMore={onAdd}
          addLabel={t('erec.addPhoto')}
        />
      )}
    </View>
  );
}

/* ============================================================== 4. people ===== */

/** Someone on the record, with the contact details this device actually holds.
 *  A missing number is shown as missing — a person you cannot reach is a fact the
 *  contractor needs before he wonders why nobody answered. */
export type InvolvedPerson = {
  key: string;
  name: string;
  /** The already-translated role word, not a slug. */
  role: string | null;
  photoUri?: string | null;
  /** Already display-formatted (`sendto.ts:displayPhone`). */
  phone: string | null;
  email: string | null;
  /** D4: exactly ONE person on an extra may approve it. */
  canApprove: boolean;
};

export type PeopleInvolvedProps = {
  status: string;
  people: readonly InvolvedPerson[];
  onPressPhone?: (p: InvolvedPerson) => void;
  onPressEmail?: (p: InvolvedPerson) => void;
  onAddPerson?: () => void;
  onBack: () => void;
};

export function PeopleInvolved(props: PeopleInvolvedProps) {
  const { editable } = editability(props.status);
  const approvers = props.people.filter((p) => p.canApprove);
  const others = props.people.filter((p) => !p.canApprove);

  return (
    <Frame title={t('neg.people')} status={props.status} onBack={props.onBack}>
      {props.people.length === 0 && (
        <Card><Text style={st.silent}>{t('det.noPeople')}</Text></Card>
      )}

      {props.people.map((p) => (
        <Card key={p.key}>
          <PersonRow
            name={p.name}
            role={p.role ?? undefined}
            photoUri={p.photoUri}
            kind={p.canApprove ? 'approver' : 'crew'}
          />
          {p.phone == null && p.email == null && (
            <Text style={[st.silent, { marginTop: 6 }]}>{t('det.noContact')}</Text>
          )}
          {p.phone != null && (
            <Row
              icon="send"
              label={t('det.phone')}
              value={p.phone}
              chevron={!!props.onPressPhone}
              onPress={props.onPressPhone ? () => props.onPressPhone?.(p) : undefined}
            />
          )}
          {p.email != null && (
            <Row
              icon="send"
              label={t('det.email')}
              value={p.email}
              chevron={!!props.onPressEmail}
              onPress={props.onPressEmail ? () => props.onPressEmail?.(p) : undefined}
            />
          )}
        </Card>
      ))}

      {editable && props.onAddPerson && (
        <Button
          label={t('det.addPerson')}
          icon="people"
          variant="secondary"
          onPress={props.onAddPerson}
          style={{ marginTop: 6 }}
        />
      )}

      {/*
        D4, said plainly rather than implied by an avatar colour. The three cases are
        three different sentences because two of them are DEFECTS the contractor has
        to fix, and a footer that renders the same reassuring line over a record with
        no approver — or with two — would hide exactly the state that makes a send
        fail. Nothing here picks a winner when the data disagrees with D4; it says the
        data disagrees.
      */}
      <Notice
        tone={approvers.length === 1 ? 'approved' : 'caution'}
        icon={approvers.length === 1 ? 'approved' : 'failed'}
        title={t('det.authority')}
        body={
          approvers.length === 1
            ? t({ k: 'det.authorityOne', p: { name: approvers[0].name } })
              + (others.length ? ` ${t('det.authorityOthers')}` : '')
            : approvers.length === 0
              ? t('det.authorityNone')
              : t({ k: 'det.authorityMany', p: { n: approvers.length } })
        }
      />
    </Frame>
  );
}

/* ============================================================= 5. history ===== */

export type FullHistoryProps = {
  status: string;
  /**
   * `mergeTimeline(local, server)` — the merged timeline, PASSED WHOLE and rendered
   * in the order it arrives. This screen re-sorts nothing: `mergeTimeline` puts
   * stamped events in time order and events whose time was never recorded LAST, on
   * purpose, and a second sort here would either invent a position for them or drop
   * them (record.ts's rule, and the reason `parseTimeline` throws a row away rather
   * than defaulting it to now()).
   */
  events: readonly MergedEvent[];
  /** ms → human. Injected so this file holds no clock and no locale, the same
   *  choice `ThreadScreen` and the negotiation screen make. */
  formatAt: (ms: number) => string;
  /** The frozen instrument + whether THIS device's copy still hashes to it. */
  approval: ApprovalPanel | null;
  /** The approved total, already formatted. Null when nothing was priced. */
  total: string | null;
  /** The schedule effect as an owner-facing sentence in the reader's language, or
   *  null when the document is silent on it. Not derived here: `extralocked.tsx`
   *  already owns that mapping for the sealed record. */
  scheduleLine: string | null;
  onBack: () => void;
};

export function FullHistory(props: FullHistoryProps) {
  const sealed = stageOf(props.status) === 'locked';
  const unstamped = props.events.filter((e) => e.atMs === null).length;

  return (
    <Frame title={t('det.historyTitle')} status={props.status} onBack={props.onBack}>
      <Text style={[T.bodySteel, st.hint]}>{t('det.historyNote')}</Text>

      <Section title={t('det.historyTitle')}>
        {props.events.length === 0 && <Text style={st.silent}>{t('neg.nothingYet')}</Text>}
        {props.events.map((e, i) => (
          <Step
            key={`${e.atMs ?? 'x'}-${i}`}
            what={eventText(e)}
            at={e.atMs == null ? t('erec.noTime') : props.formatAt(e.atMs)}
            hot={e.hot}
          />
        ))}
        {unstamped > 0 && (
          <Text style={[T.bodySteel, { marginTop: 10 }]}>
            {t({ k: 'det.unstampedNote', p: { n: unstamped } })}
          </Text>
        )}
      </Section>

      {/* The signed approval, with the two figures a dispute asks for first. The
          instrument itself is quoted by the component that already owns that
          rendering — two renderings of a binding text is two wordings waiting to
          drift, which is the reason `flowterms.ts` exists at all. */}
      {(props.approval || props.total || props.scheduleLine) && (
        <Section title={t('det.signedTitle')}>
          <Row
            icon="approval"
            label={t('det.totalLabel')}
            value={props.total ?? t('elock.noAmount')}
            tone={props.total ? 'default' : 'warn'}
          />
          <Row
            icon="clock"
            label={t('elock.rowSchedule')}
            value={props.scheduleLine ?? t('elock.schedNone')}
            tone={props.scheduleLine ? 'default' : 'warn'}
          />
        </Section>
      )}
      <RecordApproval approval={props.approval ?? null} />

      {sealed && (
        <Notice tone="neutral" icon="lock" keys={['elock.lockedTitle', 'elock.lockedBody']} />
      )}
    </Frame>
  );
}

/** A merged line's words. Exactly one of `k` / `text` is set by construction
 *  (`eventtimeline.ts`); an event carrying neither renders nothing rather than a
 *  placeholder, because a placeholder on this screen is a fabricated event. */
function eventText(e: MergedEvent): string {
  if (e.text != null) return e.text;
  return e.k ? t({ k: e.k, p: e.p }) : '';
}

/**
 * One finished step, marked with a check.
 *
 * Deliberately not the kit's `TimelineRow`: that draws a dot on a rail, which reads
 * as an open chronology, and everything on this screen has already happened. This is
 * the same local component `extralocked.tsx` had to write for the same reason — if a
 * `done` variant ever lands in `kit.tsx`, both should become it.
 */
function Step({ what, at, hot }: { what: string; at: string; hot?: boolean }) {
  return (
    <View style={st.step}>
      <Icon name="approved" size={20} color={hot ? C.orange : C.approve} />
      <View style={{ flex: 1 }}>
        <Text style={st.stepWhat}>{what}</Text>
        <Text style={[st.stepAt, hot && { color: C.orange }]}>{at}</Text>
      </View>
    </View>
  );
}

/* ========================================================== shared frame ====== */

/**
 * Header · body · optional pinned footer, plus the state line every sub-screen ends
 * on. Written once so the fifth screen cannot be the one that forgets the 54pt
 * status-bar clearance (`ScreenHeader` owns it) or the line saying what state the
 * record is in.
 */
function Frame({ title, status, onBack, children, footer }: {
  title: string;
  status: string;
  onBack: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <View style={T.screen}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* A detail screen names itself in the NAV ROW, not as a display title
            underneath — the design does this, and it is right: these screens are
            one job each, and a 22pt heading repeating the bar directly above it
            spends the top of a 375pt phone saying the same thing twice. */}
        <ScreenHeader navTitle={title} onBack={onBack} backLabel={t('erec.back')} />
        <View style={{ marginTop: 10 }}>{children}</View>
        <Text style={st.footerState}>{stateFooter(status)}</Text>
      </ScrollView>
      {footer && <View style={st.bar}>{footer}</View>}
    </View>
  );
}

/**
 * A tinted box that is NOT a lifecycle state.
 *
 * `StatusBanner` maps `displayStatus` to a colour, which is right for a status —
 * but "frozen because it is sent", "sealed", and "approval authority" are properties
 * of the RECORD, and borrowing a banner kind to get its colour would print a status
 * the record does not have on the screens whose job is being accurate. Same `tint()`
 * tokens, no fork. (Kit gap already reported by the Stage 3 screen; restated, not
 * rediscovered.)
 */
function Notice({ tone, icon, title, body, keys }: {
  tone: Tone;
  icon: IconName;
  title?: string;
  body?: string;
  /** `[titleKey, bodyKey]` — the common case, so a caller cannot pass one and forget
   *  the other. */
  keys?: [string, string];
}) {
  const c = tint(tone);
  const head = title ?? (keys ? t(keys[0]) : '');
  const text = body ?? (keys ? t(keys[1]) : '');
  return (
    <View style={[st.notice, { backgroundColor: c.soft, borderColor: c.line }]}>
      <Icon name={icon} size={22} color={c.ink} />
      <View style={{ flex: 1 }}>
        <Text style={[st.noticeTitle, { color: c.ink }]}>{head}</Text>
        <Text style={[st.noticeBody, { color: c.ink }]}>{text}</Text>
      </View>
    </View>
  );
}

/** The two-tab toggle. Full-width halves, 58pt — a tab is not a smaller decision
 *  than a button just because it is drawn as a segment (mandate #3). */
function Tabs<K extends string>({ value, onChange, options }: {
  value: K;
  onChange: (k: K) => void;
  options: readonly { key: K; label: string }[];
}) {
  return (
    <View style={st.tabs}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.label}
            style={[st.tab, on && st.tabOn]}
          >
            <Text style={[st.tabT, on && st.tabTOn]} numberOfLines={2}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * A closed set of answers, stacked full width.
 *
 * Stacked rather than side-by-side because the labels are sentences ("Payment is due
 * when the work is completed") and a three-across segmented control turns them into
 * two-word abbreviations of a term someone signs. The selected row carries a CHECK as
 * well as the fill — colour never carries meaning alone.
 */
export function Choice<K extends string>({ value, onChange, options, disabled }: {
  value: K | null;
  onChange: (k: K) => void;
  options: readonly { key: K; label: string; sub?: string }[];
  disabled?: boolean;
}) {
  return (
    <View style={{ gap: 8 }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, disabled: !!disabled }}
            accessibilityLabel={o.label}
            style={[st.choice, on && st.choiceOn, disabled && T.btnOff]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[st.choiceT, on && { fontFamily: F.bodySemi }]}>{o.label}</Text>
              {o.sub != null && <Text style={st.choiceSub}>{o.sub}</Text>}
            </View>
            {on && <Icon name="approved" size={20} color={C.brand} />}
          </Pressable>
        );
      })}
    </View>
  );
}

/* ================================================================== styles ==== */

const st = StyleSheet.create({
  hint: { fontSize: 12.5, marginBottom: 8 },
  silent: { fontFamily: F.body, fontSize: 15, color: C.steel, lineHeight: 21 },
  warnLine: {
    fontFamily: F.body, fontSize: 13.5, color: tint('caution').ink, lineHeight: 19, marginTop: 6,
  },
  dangerLine: {
    fontFamily: F.body, fontSize: 13.5, color: C.danger, lineHeight: 19, marginTop: 6,
  },

  input: {
    fontFamily: F.body, fontSize: 16, color: C.ink, lineHeight: 23,
    backgroundColor: C.surfaceMuted, borderRadius: radii.sm, borderWidth: 1, borderColor: C.line,
    padding: 12, marginTop: 8, minHeight: touchTargets.minimum + 8, textAlignVertical: 'top',
  },
  inputShort: { minHeight: touchTargets.minimum, width: 120 },
  money: { ...moneyStyle, fontSize: 26, color: C.ink },
  readback: { fontFamily: F.bodySemi, fontSize: 13.5, color: C.steel, marginTop: 6, lineHeight: 19 },
  clause: {
    borderLeftWidth: 3, borderLeftColor: C.brand, paddingLeft: 10, marginTop: 4, marginBottom: 4,
  },
  counter: {
    fontFamily: F.dispSemi, fontSize: 12, letterSpacing: 1, color: C.steel,
    textAlign: 'right', marginTop: 6,
  },

  notice: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    borderRadius: radii.md, borderWidth: 1, padding: 14, marginBottom: 10,
  },
  noticeTitle: {
    fontFamily: F.dispSemi, fontSize: 15, textTransform: 'uppercase', letterSpacing: 1.3,
  },
  noticeBody: { fontFamily: F.body, fontSize: 14.5, lineHeight: 20, marginTop: 4 },

  proposal: { borderRadius: radii.md, borderWidth: 1, padding: 14, marginBottom: 10 },
  proposalText: {
    backgroundColor: C.card, borderRadius: radii.sm, borderWidth: 1, borderColor: C.line,
    padding: 12, marginTop: 10,
  },

  tabs: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  tab: {
    flex: 1, minHeight: 58, alignItems: 'center', justifyContent: 'center',
    borderRadius: radii.sm, borderWidth: 1, borderColor: C.line, paddingHorizontal: 10,
  },
  tabOn: { borderWidth: 1.5, borderColor: C.brand, backgroundColor: C.brandSoft },
  tabT: { fontFamily: F.body, fontSize: 14.5, color: C.steel, textAlign: 'center' },
  tabTOn: { fontFamily: F.bodySemi, color: C.brandDark },

  choice: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    minHeight: 58, paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: radii.sm, borderWidth: 1, borderColor: C.line,
  },
  choiceOn: { borderWidth: 1.5, borderColor: C.brand, backgroundColor: C.brandSoft },
  choiceT: { fontFamily: F.body, fontSize: 15.5, color: C.ink, lineHeight: 21 },
  choiceSub: { fontFamily: F.body, fontSize: 13, color: C.steel, marginTop: 2, lineHeight: 18 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  badge: {
    position: 'absolute', left: 4, top: 4,
    backgroundColor: C.approve, borderRadius: radii.sm, paddingHorizontal: 5, paddingVertical: 2,
  },
  badgeT: { fontFamily: F.dispSemi, fontSize: 10, letterSpacing: 0.8, color: C.card },
  // 86 is the kit's tile size, and it is COPIED here because `kit.tsx` keeps `TILE`
  // private. The overlay is the only thing in this file that has to know it; if the
  // kit's tile ever changes size this ring is what stops fitting, so the number is
  // written down rather than derived from a guess. Worth exporting `TILE` if a second
  // overlay ever appears.
  pickRing: {
    position: 'absolute', left: 0, top: 0, width: 86, height: 86,
    borderRadius: radii.sm, borderWidth: 3, borderColor: C.brand,
  },

  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 8 },
  stepWhat: { fontFamily: F.bodySemi, fontSize: 15.5, color: C.ink, lineHeight: 21 },
  stepAt: {
    fontFamily: F.dispSemi, fontSize: 11.5, letterSpacing: 1,
    textTransform: 'uppercase', color: C.steel, marginTop: 2,
  },

  footerState: {
    fontFamily: F.dispSemi, fontSize: 12, letterSpacing: 1.6, textTransform: 'uppercase',
    color: C.steel, marginTop: 24, textAlign: 'center',
  },
  bar: {
    borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.card,
    padding: 12, paddingBottom: 22,
  },
});
