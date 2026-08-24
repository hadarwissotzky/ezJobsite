/**
 * ONE SHEET PER FIELD (hadar, 2026-07-31).
 *
 * These replace `PriceScheduleEditor`, the catch-all form that held price, schedule,
 * billing and exclusions on one full screen. Tapping "Impact on schedule" now opens a
 * drawer about the schedule and nothing else.
 *
 * WHY THAT IS NOT ONLY COSMETIC: the catch-all had ONE Save for four unrelated
 * fields, so a contractor who opened it to answer "does this move the schedule?" was
 * also holding an editable price. On a screen whose whole subject is a priced
 * commitment (mandate #2), the smaller the thing under the thumb the better.
 *
 * Each sheet owns DRAFT state and commits on Save. Cancel/dismiss discards — nothing
 * here writes as you type, so a sheet closed by a mis-tap changes nothing.
 *
 * Editability is the caller's: a sheet is only opened for a record that may be
 * edited, and `editable` renders the read-only shape for anything else rather than a
 * form that silently refuses.
 */
import React from 'react';
import { Pressable, Text, TextInput, View, StyleSheet } from 'react-native';
import type { PriceMode, VoicePriceReading } from '../voiceprice';
import type { SendBlocker } from '../sendreadiness';
import { CLIENT_TYPES, type ClientType } from '../approverrouting';
import { t } from '../i18n';
import { BottomSheet, Button, Section } from './kit';
import { Icon } from './icon';
import {
  Choice, Counter, HeardBlock, MoneyField, NteClause, ProposalCard, RewriteActions,
  type RewriteState,
} from './extradetails';
import { C, F, T, label as labelStyle } from './theme';

/* ----------------------------------------------------------------- client -- */

/**
 * WHO THIS EXTRA IS FOR — two taps, no typing (hadar, 2026-07-31: "our users are not
 * computer savvy and they don't want to learn").
 *
 *   Step 1  PICK    the people already on this job, then the phone's contacts.
 *   Step 2  TYPE    "Who is Sarah?" — one tap, and it saves. No Save button, because
 *                   the tap IS the answer and a second confirm is a step to learn.
 *
 * WHAT THIS REPLACED, and why: the first cut was one form with Name, Mobile number and
 * a homeowner/sub toggle — three fields and a keyboard for a man on a ladder whose
 * client is already in his phone. Typing is the thing to remove, so the roster and the
 * contact list come first and the keyboard only appears if neither has the person.
 *
 * Bringing someone in from the phone ADDS THEM TO THE JOB'S LIST, so the second extra
 * for the same client is one tap with no contact picker at all.
 */
/** One tappable person. Extracted only because it is now rendered from two lists —
 *  a copy per section is how the two would drift apart. */
function PickRow({ p, onPick }: {
  p: { id: string; name: string; phone: string | null; clientType: ClientType | null };
  onPick: (v: { name: string; phone: string | null }) => void;
}) {
  return (
    <Pressable
      style={st.pickRow}
      onPress={() => onPick({ name: p.name, phone: p.phone })}
      accessibilityRole="button"
      accessibilityLabel={p.name}
    >
      <View style={st.pickAvatar}>
        <Text style={st.pickAvatarT}>{initial(p.name)}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={st.pickName} numberOfLines={1}>{p.name}</Text>
        <Text style={st.pickSub} numberOfLines={1}>
          {p.clientType ? t(`client.type.${p.clientType}`) : (p.phone ?? t('client.noNumber'))}
        </Text>
      </View>
      <Text style={st.pickChev}>›</Text>
    </Pressable>
  );
}

export function ClientSheet(props: {
  visible: boolean;
  editable: boolean;
  /** The client already on this extra, if any. */
  name: string | null;
  clientType: ClientType | null;
  /** People already known on this job — shown first, because they cost no typing. */
  known: readonly { id: string; name: string; phone: string | null; clientType: ClientType | null }[];
  /**
   * Everyone else this account has named, on any other job (`listKnownPeople`).
   * Second, not first: the person you want is far more often already on the job in
   * front of you, and a long global list above the short relevant one would bury it.
   * Still ahead of the contact picker, because these cost one tap and the picker
   * costs a permission prompt, a system sheet and a search.
   */
  everyone?: readonly { id: string; name: string; phone: string | null; clientType: ClientType | null }[];
  /**
   * WHICH QUESTION THIS SHEET IS ASKING (hadar, 2026-08-05: "when I click on add
   * someone else it opens up the window to edit the existing record").
   *
   *   'client'  — who is this extra FOR. One per extra; re-opening jumps straight
   *               to the type question about the person already named, because
   *               that is the thing they came back to change.
   *   'contact' — ADD ANOTHER person on the chain. There is no person yet, so it
   *               must start on the picker. Prefilling `chosen` here is what made
   *               "Add someone else" open as "How is Sarah involved?" — the same
   *               sheet, asking about the wrong human, with no way to reach the
   *               list underneath.
   *
   * The two modes always differed in what SAVING them meant (App.tsx passes the
   * mode to saveClient); only the UI failed to know.
   */
  mode: 'client' | 'contact';
  onPickContact: () => Promise<{ name: string; phone: string } | null>;
  onClose: () => void;
  /** Called once, with everything, when the type is tapped. */
  onSave: (v: { name: string; phone: string | null; clientType: ClientType }) => void;
}) {
  // Who we are asking ABOUT. Null = still on step 1.
  const [chosen, setChosen] = React.useState<{ name: string; phone: string | null } | null>(null);
  const [query, setQuery] = React.useState('');
  React.useEffect(() => {
    if (props.visible) {
      setQuery('');
      // Re-opening on an extra that already names someone jumps straight to the
      // question that can still change — which is what they came to change. ONLY in
      // 'client' mode: adding someone else is a new person every time, so it always
      // starts at the list.
      setChosen(props.mode === 'client' && props.name
        ? { name: props.name, phone: null } : null);
      setAdding(false); setNewName(''); setNewPhone('');
    }
  }, [props.visible, props.name, props.mode]);

  /** The type-a-new-person form. Closed by default: the list is the common case. */
  const [adding, setAdding] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const [newPhone, setNewPhone] = React.useState('');

  const q = query.trim().toLowerCase();
  const matches = q
    ? props.known.filter((k) => k.name.toLowerCase().includes(q))
    : props.known;
  // The wider list is filtered by the SAME query — a search that only looked at
  // this job would answer "no such person" about someone the app knows, which is
  // the exact failure this section exists to fix. Anyone already shown above is
  // dropped so nobody appears twice in one list.
  const onJob = new Set(props.known.map((k) => k.name.trim().toLowerCase()));
  const others = (props.everyone ?? []).filter((e) =>
    !onJob.has(e.name.trim().toLowerCase())
    && (!q || e.name.toLowerCase().includes(q)));

  const fromPhone = async () => {
    const picked = await props.onPickContact();
    if (!picked?.name) return;
    setChosen({ name: picked.name, phone: picked.phone || null });
  };

  return (
    <BottomSheet
      visible={props.visible}
      // The question IS the title, and on step 2 it names the person — a bare
      // "What are they?" over a list of trades reads as a non-sequitur (hadar).
      title={chosen
        ? t({ k: 'client.howInvolved', p: { name: firstName(chosen.name) } })
        : t(props.mode === 'contact' ? 'client.addContact' : 'client.title')}
      onClose={props.onClose}
      // CHOOSING wants the screen; answering does not. A short drawer over a list of
      // people hides most of them behind a scroll nobody knows is there.
      tall={!chosen}
    >
      {!chosen ? (
        <>
          {/* Search is OPTIONAL — the list is right underneath. It earns its place
              only once a job has more people than fit on a screen. */}
          <TextInput
            value={query}
            onChangeText={setQuery}
            style={st.search}
            placeholder={t('client.searchPlaceholder')}
            placeholderTextColor={C.steel}
            accessibilityLabel={t('client.searchPlaceholder')}
          />

          {/* Only labelled once there is a second section to tell it apart from —
              a lone "On this job" header over the only list is a word to read for
              nothing. */}
          {matches.length > 0 && others.length > 0 && (
            <Text style={st.sectionH}>{t('client.onThisJob')}</Text>
          )}
          {matches.map((k) => (
            <PickRow key={k.id} p={k} onPick={setChosen} />
          ))}

          {others.length > 0 && (
            <>
              <Text style={st.sectionH}>{t('client.fromOtherJobs')}</Text>
              {others.map((k) => (
                <PickRow key={k.id} p={k} onPick={setChosen} />
              ))}
            </>
          )}

          {props.known.length === 0 && others.length === 0 && (
            <Text style={st.emptyBody}>{t('client.emptyBody')}</Text>
          )}

          {/**
            * TWO WAYS IN, BOTH VISIBLE (hadar, 2026-08-23: "it only let me add existing
            * people in the app's contact list. This is the opportunity to add other
            * people (from contact or new)").
            *
            * The sheet could only ever offer people it already knew, plus a phone-book
            * import buried in a button under the list. Someone standing on a jobsite
            * with a name and a number and no contact card had nowhere to put them —
            * which is most of the people on a job.
            *
            * ROWS, not a button at the bottom: they read as two more entries in the
            * list of ways to name a person, which is what they are, and they sit where
            * the eye already is instead of after the fold.
            */}
          {props.editable && !adding && (
            <>
              <Pressable style={st.addRow} onPress={() => { void fromPhone(); }}
                accessibilityRole="button">
                <Icon name="people" size={18} color={C.brand} />
                <Text style={st.addRowT}>{t('client.fromContacts')}</Text>
              </Pressable>
              <Pressable style={st.addRow} onPress={() => setAdding(true)}
                accessibilityRole="button">
                <Icon name="personAdd" size={18} color={C.brand} />
                <Text style={st.addRowT}>{t('client.addNewPerson')}</Text>
              </Pressable>
            </>
          )}

          {props.editable && adding && (
            <View style={{ marginTop: 8 }}>
              <TextInput
                value={newName}
                onChangeText={setNewName}
                style={st.search}
                placeholder={t('clientpick.namePh')}
                placeholderTextColor={C.steel}
                autoFocus
              />
              <TextInput
                value={newPhone}
                onChangeText={setNewPhone}
                style={[st.search, { marginTop: 8 }]}
                placeholder={t('clientpick.phonePh')}
                placeholderTextColor={C.steel}
                keyboardType="phone-pad"
              />
              {/* The number is what the approval text is sent to, so its absence is
                  stated rather than discovered at send time. Not a blocker: a name
                  written down beats a person forgotten. */}
              <Text style={st.addHint}>{t('clientpick.phoneWhy')}</Text>
              <Button
                label={t('client.continueWith')}
                disabled={newName.trim().length < 2}
                onPress={() => setChosen({ name: newName.trim(), phone: newPhone.trim() || null })}
                style={{ marginTop: 12 }}
              />
            </View>
          )}
        </>
      ) : (
        <>
          {/* WHO we are asking about, shown as the person — not a bare word. The
              options underneath mean nothing without this line above them. */}
          <View style={st.whoCard}>
            <View style={st.pickAvatar}>
              <Text style={st.pickAvatarT}>{initial(chosen.name)}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={st.whoName} numberOfLines={1}>{chosen.name}</Text>
              {!!chosen.phone && (
                <Text style={st.pickSub} numberOfLines={1}>{chosen.phone}</Text>
              )}
            </View>
          </View>
          {/* WHY it is being asked. Without it the list is a quiz. */}
          <Text style={st.whyLine}>{t('client.whyType')}</Text>
          {/* One tap answers and saves. Plain words, no slugs, no jargon. */}
          {CLIENT_TYPES.map((ct) => {
            // Never in 'contact' mode: that is a DIFFERENT person, and showing the
            // client's answer already ticked invites a tap that agrees with it.
            const on = props.mode === 'client' && props.clientType === ct;
            return (
              <Pressable
                key={ct}
                style={[st.typeRow, on && st.typeRowOn]}
                disabled={!props.editable}
                onPress={() => props.onSave({ name: chosen.name, phone: chosen.phone, clientType: ct })}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <Text style={[st.typeT, on && st.typeTOn]}>{t(`client.type.${ct}`)}</Text>
                {on && <Icon name="check" size={17} color={C.brand} />}
              </Pressable>
            );
          })}
          {props.editable && (
            <Button label={t('client.pickSomeoneElse')} variant="ghost"
              onPress={() => setChosen(null)} style={{ marginTop: 6 }} />
          )}
        </>
      )}
    </BottomSheet>
  );
}

/** First name only, for a question that should sound like speech. */
function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name.trim();
}

/** First letter, for the avatar. Never more — two initials read as a code. */
function initial(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}

/**
 * WHY THIS DRAWER HAS NO CONTROLS.
 *
 * A sent extra is FROZEN (REQ-LC15), so these sheets render their value read-only —
 * which is right, but on its own it looks broken: a title, a line of text, and nothing
 * to do. Silence about a disabled thing reads as a bug, and a contractor who thinks
 * the app is broken goes back to the text message this product exists to replace.
 *
 * So the frozen state SAYS it is frozen and names the one legal way to change it.
 */
function FrozenNote() {
  return (
    <View style={st.frozen}>
      <Icon name="lock" size={17} color={C.steel} />
      <Text style={st.frozenT}>{t('sheet.frozen')}</Text>
    </View>
  );
}

/* ------------------------------------------------------------ description -- */

/**
 * The client-facing scope, in a drawer.
 *
 * The full-screen editor carried a RAW/CLIENT tab pair; this does not. The raw notes
 * are still one tap away on the record ("Captured notes"), and the one thing they were
 * needed for while writing — starting from what was said — is what "Use captured
 * notes" does, as a PROPOSAL. That path is kept exactly: neither the notes nor the AI
 * ever replace what a person wrote without passing under their thumb first.
 */
export function DescriptionSheet(props: {
  visible: boolean;
  editable: boolean;
  value: string;
  maxChars?: number;
  /** Joined captured notes, or '' when nothing was transcribed. */
  notesText: string;
  rewrite: RewriteState;
  onRewrite: () => void;
  onRewriteDone: () => void;
  onClose: () => void;
  onSave: (next: string) => void;
}) {
  const max = props.maxChars ?? 1500;
  const [text, setText] = React.useState(props.value);
  const [notesProposed, setNotesProposed] = React.useState(false);
  React.useEffect(() => {
    if (props.visible) { setText(props.value); setNotesProposed(false); }
  }, [props.visible, props.value]);

  const proposal: { fromAi: boolean; text: string } | null =
    notesProposed && props.notesText ? { fromAi: false, text: props.notesText }
    : props.rewrite.phase === 'proposed' ? { fromAi: true, text: props.rewrite.text }
    : null;

  const finish = (accept: boolean) => {
    if (accept && proposal) setText(proposal.text);
    if (proposal?.fromAi) props.onRewriteDone();
    setNotesProposed(false);
  };

  return (
    <BottomSheet
      visible={props.visible}
      title={t('draft.description')}
      onClose={props.onClose}
      footer={props.editable
        ? <Button label={t('det.saveScope')} onPress={() => props.onSave(text)} />
        : null}
    >
      <Text style={[T.bodySteel, { marginBottom: 10 }]}>{t('draft.scopeNote')}</Text>
      {props.editable ? (
        <>
          <TextInput
            value={text}
            onChangeText={setText}
            multiline
            maxLength={max}
            style={st.input}
            placeholder={t('det.sowPlaceholder')}
            placeholderTextColor={C.steel}
            accessibilityLabel={t('det.tabClient')}
          />
          <Counter n={text.length} of={max} />
          {!text.trim() && <Text style={st.danger}>{t('det.sowEmpty')}</Text>}
          <RewriteActions
            rewrite={props.rewrite}
            canUseNotes={!!props.notesText}
            onUseNotes={() => setNotesProposed(true)}
            onRewrite={props.onRewrite}
          />
          {proposal && (
            <ProposalCard
              fromAi={proposal.fromAi}
              text={proposal.text}
              onAccept={() => finish(true)}
              onDismiss={() => finish(false)}
            />
          )}
        </>
      ) : (
        <>
          <Text selectable style={T.body}>{text.trim() || t('det.sowEmpty')}</Text>
          <FrozenNote />
        </>
      )}
    </BottomSheet>
  );
}

/* ------------------------------------------------------------------- cost -- */

export function CostSheet(props: {
  visible: boolean;
  editable: boolean;
  priceMode: PriceMode;
  amountText: string;
  nteText: string;
  amountReadback: string | null;
  nteReadback: string | null;
  reading: VoicePriceReading | null;
  blockers: readonly SendBlocker[];
  onClose: () => void;
  onSave: (v: { priceMode: PriceMode; amountText: string; nteText: string }) => void;
}) {
  const [mode, setMode] = React.useState<PriceMode>(props.priceMode);
  const [amount, setAmount] = React.useState(props.amountText);
  const [nte, setNte] = React.useState(props.nteText);
  // Re-seed each time the sheet opens, so it always starts from what is stored.
  React.useEffect(() => {
    if (props.visible) {
      setMode(props.priceMode); setAmount(props.amountText); setNte(props.nteText);
    }
  }, [props.visible, props.priceMode, props.amountText, props.nteText]);

  const costBlocked = props.blockers.includes('no_cost');

  return (
    <BottomSheet
      visible={props.visible}
      title={t('draft.cost')}
      onClose={props.onClose}
      footer={props.editable
        ? <Button label={t('det.savePrice')} onPress={() => props.onSave({ priceMode: mode, amountText: amount, nteText: nte })} />
        : null}
    >
      {/* R3's closed pair — never a free-text range. */}
      <Section title={t('r2.modeLabel')}>
        <Choice
          value={mode}
          disabled={!props.editable}
          onChange={(m) => setMode(m)}
          options={[
            { key: 'fixed' as PriceMode, label: t('r2.modeFixed') },
            { key: 'nte' as PriceMode, label: t('r2.modeNte'), sub: t('det.modeNteSub') },
          ]}
        />
      </Section>

      <HeardBlock reading={props.reading} />

      <Section title={t('det.total')}>
        <MoneyField
          label={t('det.total')}
          value={amount}
          onChange={setAmount}
          editable={props.editable}
          readback={props.amountReadback
            ? t({ k: 'det.readback', p: { amount: props.amountReadback } })
            : t('det.readbackNone')}
          alarm={costBlocked && !props.amountReadback}
        />
        {mode === 'nte' && (
          <MoneyField
            label={t('det.cap')}
            value={nte}
            onChange={setNte}
            editable={props.editable}
            readback={props.nteReadback
              ? t({ k: 'det.capReadback', p: { amount: props.nteReadback } })
              : t('det.capRequired')}
            alarm={!props.nteReadback}
          />
        )}
        <NteClause mode={mode} cap={props.nteReadback} />
      </Section>

      {costBlocked && <Text style={st.danger}>{t('send.blocked.noCost')}</Text>}
      {!props.editable && <FrozenNote />}
    </BottomSheet>
  );
}

/* --------------------------------------------------------------- schedule -- */

export function ScheduleSheet(props: {
  visible: boolean;
  editable: boolean;
  scheduleEffect: string | null;
  scheduleDaysText: string;
  onClose: () => void;
  onSave: (v: { scheduleEffect: string | null; scheduleDaysText: string }) => void;
}) {
  const [effect, setEffect] = React.useState<string | null>(props.scheduleEffect);
  const [days, setDays] = React.useState(props.scheduleDaysText);
  React.useEffect(() => {
    if (props.visible) { setEffect(props.scheduleEffect); setDays(props.scheduleDaysText); }
  }, [props.visible, props.scheduleEffect, props.scheduleDaysText]);

  return (
    <BottomSheet
      visible={props.visible}
      title={t('draft.schedule')}
      onClose={props.onClose}
      footer={props.editable
        ? <Button label={t('det.saveField')} onPress={() => props.onSave({ scheduleEffect: effect, scheduleDaysText: days })} />
        : null}
    >
      {/* "not sure yet" is a COMPLETE answer (FLOW decision 3) — it renders to the
          owner as "to be confirmed". Hiding it would let silence read as "no delay". */}
      <Choice
        value={effect}
        disabled={!props.editable}
        onChange={setEffect}
        options={[
          { key: 'no_change', label: t('co.schedNo') },
          { key: 'adds_days', label: t('co.schedAdds') },
          { key: 'not_sure', label: t('co.schedUnsure'), sub: t('det.schedUnsureSub') },
        ]}
      />
      {!props.editable && <FrozenNote />}
      {effect === 'adds_days' && (
        <View style={{ marginTop: 14 }}>
          <Text style={labelStyle}>{t('det.schedDaysLabel')}</Text>
          <TextInput
            value={days}
            onChangeText={setDays}
            editable={props.editable}
            keyboardType="number-pad"
            style={st.shortInput}
            accessibilityLabel={t('det.schedDaysLabel')}
          />
        </View>
      )}
    </BottomSheet>
  );
}

/* ---------------------------------------------------------------- billing -- */

export function BillingSheet(props: {
  visible: boolean;
  editable: boolean;
  billingTiming: string | null;
  onClose: () => void;
  onSave: (v: { billingTiming: string | null }) => void;
}) {
  const [timing, setTiming] = React.useState<string | null>(props.billingTiming);
  React.useEffect(() => {
    if (props.visible) setTiming(props.billingTiming);
  }, [props.visible, props.billingTiming]);

  return (
    <BottomSheet
      visible={props.visible}
      title={t('draft.billing')}
      onClose={props.onClose}
      footer={props.editable
        ? <Button label={t('det.saveField')} onPress={() => props.onSave({ billingTiming: timing })} />
        : null}
    >
      <Choice
        value={timing}
        disabled={!props.editable}
        onChange={setTiming}
        options={[
          { key: 'next_invoice', label: t('co.billNext') },
          { key: 'when_completed', label: t('co.billDone') },
          { key: 'other', label: t('co.billOther') },
        ]}
      />
      {!props.editable && <FrozenNote />}
    </BottomSheet>
  );
}

/* ------------------------------------------------------------- exclusions -- */

export function ExclusionsSheet(props: {
  visible: boolean;
  editable: boolean;
  exclusions: string;
  onClose: () => void;
  onSave: (v: { exclusions: string }) => void;
}) {
  const [text, setText] = React.useState(props.exclusions);
  React.useEffect(() => {
    if (props.visible) setText(props.exclusions);
  }, [props.visible, props.exclusions]);

  return (
    <BottomSheet
      visible={props.visible}
      title={t('draft.exclusions')}
      onClose={props.onClose}
      footer={props.editable
        ? <Button label={t('det.saveField')} onPress={() => props.onSave({ exclusions: text })} />
        : null}
    >
      <Text style={[T.bodySteel, { marginBottom: 10 }]}>{t('det.exclusionsHint')}</Text>
      {props.editable ? (
        <TextInput
          value={text}
          onChangeText={setText}
          multiline
          style={st.input}
          placeholderTextColor={C.steel}
          accessibilityLabel={t('draft.exclusions')}
        />
      ) : (
        <>
          <Text selectable style={T.body}>{text.trim() || t('elock.exclNone')}</Text>
          <FrozenNote />
        </>
      )}
    </BottomSheet>
  );
}

const st = StyleSheet.create({
  input: {
    fontFamily: F.body, fontSize: 15.5, color: C.ink, minHeight: 110,
    borderWidth: 1, borderColor: C.line, borderRadius: 12,
    padding: 12, backgroundColor: C.card, textAlignVertical: 'top',
  },
  shortInput: {
    fontFamily: F.body, fontSize: 15.5, color: C.ink, width: 110, minHeight: 48,
    borderWidth: 1, borderColor: C.line, borderRadius: 12,
    paddingHorizontal: 12, backgroundColor: C.card, marginTop: 6,
  },
  danger: { fontFamily: F.body, fontSize: 13.5, color: C.danger, marginTop: 10 },
  frozen: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: C.surfaceMuted, borderWidth: 1, borderColor: C.line,
    borderRadius: 12, padding: 12, marginTop: 14,
  },
  frozenT: { flex: 1, fontFamily: F.body, fontSize: 13.5, color: C.steel, lineHeight: 19 },
  // The teaching empty state.
  emptyWrap: { alignItems: 'center', paddingVertical: 18, paddingHorizontal: 4 },
  emptyIcon: {
    width: 58, height: 58, borderRadius: 29, backgroundColor: C.brandSoft,
    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
  },
  emptyTitle: { fontFamily: F.bodyBold, fontSize: 16.5, color: C.ink, textAlign: 'center' },
  emptyBody: {
    fontFamily: F.body, fontSize: 14, color: C.steel, lineHeight: 20,
    textAlign: 'center', marginTop: 6,
  },
  // A quiet divider-by-typography. Loud enough to separate two lists, quiet enough
  // that the NAMES stay the thing being read.
  sectionH: {
    fontFamily: F.bodySemi, fontSize: 12, color: C.steel,
    letterSpacing: 0.6, marginTop: 14, marginBottom: 4,
  },
  addRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    minHeight: 52, borderTopWidth: 1, borderTopColor: C.line,
  },
  addRowT: { fontFamily: F.bodySemi, fontSize: 16, color: C.brand },
  addHint: { fontFamily: F.body, fontSize: 13, color: C.steel, marginTop: 8 },
  search: {
    fontFamily: F.body, fontSize: 15.5, color: C.ink, minHeight: 48,
    borderWidth: 1, borderColor: C.line, borderRadius: 12,
    paddingHorizontal: 14, backgroundColor: C.card, marginBottom: 8,
  },
  pickRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 62,
    borderBottomWidth: 1, borderBottomColor: C.line,
  },
  pickAvatar: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: C.brand,
    alignItems: 'center', justifyContent: 'center',
  },
  pickAvatarT: { fontFamily: F.dispSemi, fontSize: 17, color: '#fff' },
  pickName: { fontFamily: F.bodyBold, fontSize: 16, color: C.ink },
  pickSub: { fontFamily: F.body, fontSize: 13, color: C.steel, marginTop: 1 },
  pickChev: { fontFamily: F.body, fontSize: 20, color: C.muted },
  whoCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.line,
    borderRadius: 12, padding: 12,
  },
  whoName: { fontFamily: F.bodyBold, fontSize: 17, color: C.ink },
  whyLine: {
    fontFamily: F.body, fontSize: 13.5, color: C.steel, lineHeight: 19,
    marginTop: 10, marginBottom: 12,
  },
  // Big, plain, one-tap answers.
  typeRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    minHeight: 56, borderWidth: 1, borderColor: C.line, borderRadius: 12,
    backgroundColor: C.card, paddingHorizontal: 16, marginBottom: 8,
  },
  typeRowOn: { borderColor: C.brand, borderWidth: 2, backgroundColor: C.brandSoft },
  typeT: { fontFamily: F.bodySemi, fontSize: 16, color: C.ink },
  typeTOn: { color: C.brand },
  shortWide: {
    fontFamily: F.body, fontSize: 15.5, color: C.ink, minHeight: 48,
    borderWidth: 1, borderColor: C.line, borderRadius: 12,
    paddingHorizontal: 12, backgroundColor: C.card, marginTop: 6,
  },
});
