/**
 * The guided first change order — steps 5, 7, 9 and 10.
 *
 * hadar's storyboard, 2026-08-12. Four screens in one file because they are one design:
 * cream page, one question, one primary action, nothing else competing. Split across
 * four files they would share nothing but a copy of the same tokens, and the copies
 * would drift.
 *
 * Steps 3, 4, 6 and 8 are NOT here. Those are the recorder, the job form, the draft and
 * the roster — all of which already exist and work, and the guided flow reframes them
 * rather than replacing them. Building second versions of screens this app already ships
 * would mean two places to fix every bug in them.
 *
 * ─── WHAT THESE FOUR HAVE IN COMMON ─────────────────────────────────────────────
 * Each one shows the user something the SYSTEM did and asks him to agree with it. That
 * is the shape of the whole product (mandate #2 — confirm, don't automate) and it is why
 * every one of them leads with what was produced and puts the accept button last: he
 * reads, then agrees. A screen that leads with its button is asking for a reflex.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Icon } from './icon';
import { t as T } from '../i18n';

const GOLD = '#D9A02B';
const INK = '#131110';
const CREAM = '#F7F5F0';
const SAND = '#EFE7D9';

/** The shared page chrome: a small caps kicker with a rule under it, then the body. */
function Page({ kicker, children }: { kicker: string; children: React.ReactNode }) {
  return (
    <View style={st.c}>
      <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">
        <Text style={st.kicker}>{T(kicker)}</Text>
        <View style={st.kickerRule} />
        {children}
      </ScrollView>
    </View>
  );
}

/* ─────────────────────────────── 5 — what we heard ─────────────────────────── */

/**
 * The read-back. THE most important screen in the flow for trust.
 *
 * It shows the audio and the words side by side, and it says "you can edit if needed"
 * BEFORE he reads them — because the fear at this moment is that the machine has put
 * words in his mouth that he cannot take back. Mandate #6 lives here too: the number he
 * spoke is in this text, and this is the first chance to see it written down.
 */
export function StepTranscript({ transcript, at, duration, playing, onPlay, onEdit, onNext }: {
  /** Null while the pipeline is still working — the screen says so rather than showing
   *  an empty card, because "we are still reading it" is information. */
  transcript: string | null;
  /** "Today · 9:41 AM", already formatted by the caller. */
  at: string;
  /** "00:45", already formatted. */
  duration: string;
  playing: boolean;
  onPlay: () => void;
  onEdit: () => void;
  onNext: () => void;
}) {
  return (
    <Page kicker="gs.t.kicker">
      <Text style={st.lede}>{T('gs.t.lede')}</Text>
      <View style={st.card}>
        <Text style={st.cardMeta}>{at}</Text>
        <View style={st.playRow}>
          <Pressable style={st.playBtn} onPress={onPlay} accessibilityRole="button"
            accessibilityLabel={T(playing ? 'gs.t.pause' : 'gs.t.play')}>
            <Icon name={playing ? 'pause' : 'play'} size={18} color={INK} />
          </Pressable>
          {/* A drawn waveform would be a lie about THIS recording — we do not have its
              samples here. A plain rule plus the real duration says the same thing
              (there is audio, this long) without inventing a picture of it. */}
          <View style={st.wave} />
          <Text style={st.playTime}>{duration}</Text>
        </View>
        {transcript === null
          ? <Text style={st.waiting}>{T('gs.t.waiting')}</Text>
          : <Text style={st.transcript}>{transcript}</Text>}
      </View>
      <Pressable style={st.ghost} onPress={onEdit} accessibilityRole="button">
        <Icon name="edit" size={17} color={INK} />
        <Text style={st.ghostT}>{T('gs.t.edit')}</Text>
      </Pressable>
      <Pressable style={[st.cta, transcript === null && st.ctaOff]} onPress={onNext}
        disabled={transcript === null} accessibilityRole="button">
        <Text style={st.ctaT}>{T('gs.t.next')}</Text>
      </Pressable>
    </Page>
  );
}

/* ────────────────────────────────── 7 — the gaps ───────────────────────────── */

export type ScheduleChoice = 'none' | 'adds' | 'tbd';

/**
 * The gaps. Everything the recording did not say, asked as questions.
 *
 * WHY IT IS ONE SCREEN AND NOT THREE SHEETS. The app already has a sheet each for price
 * and schedule and they are right for editing an existing extra. Here they are not edits
 * — they are the last two facts standing between him and a sendable document, and
 * showing them together is what makes "a few details" true. Three sheets in a row is a
 * form, and a form is what this product exists not to put in front of him.
 *
 * NOTHING IS REQUIRED TO LEAVE. `guidedflow` holds him here until the price exists,
 * because an unpriced change order cannot be sent — but the SCREEN never refuses. It
 * disables the button and says why, which is a different thing from an error.
 */
export function StepGaps({
  amountText, onAmount, schedule, onSchedule, days, onDays, notes, onNotes, onNext,
  priceAlreadyKnown,
}: {
  amountText: string;
  onAmount: (v: string) => void;
  schedule: ScheduleChoice | null;
  onSchedule: (v: ScheduleChoice) => void;
  days: string;
  onDays: (v: string) => void;
  notes: string;
  onNotes: (v: string) => void;
  onNext: () => void;
  /** True when the recording already gave us a price — the field then says so rather
   *  than presenting an empty box he thinks he must fill again. */
  priceAlreadyKnown: boolean;
}) {
  const ready = amountText.trim().length > 0 && schedule !== null;
  return (
    <Page kicker="gs.g.kicker">
      <Text style={st.lede}>{T('gs.g.lede')}</Text>

      <Text style={st.label}>
        {T('gs.g.price')}
        <Text style={st.labelSoft}>{'  '}{T(priceAlreadyKnown ? 'gs.g.priceHave' : 'gs.g.priceIf')}</Text>
      </Text>
      <View style={st.money}>
        <Text style={st.moneySign}>$</Text>
        <TextInput style={st.moneyIn} value={amountText} onChangeText={onAmount}
          keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor="#A8A199"
          accessibilityLabel={T('gs.g.price')} />
      </View>

      <Text style={st.label}>{T('gs.g.schedule')}</Text>
      <View style={st.seg}>
        {(['none', 'adds', 'tbd'] as ScheduleChoice[]).map((k) => (
          <Pressable key={k} onPress={() => onSchedule(k)} accessibilityRole="radio"
            accessibilityState={{ selected: schedule === k }}
            style={[st.segBtn, schedule === k && st.segOn]}>
            <Text style={[st.segT, schedule === k && st.segTOn]}>{T(`gs.g.sch.${k}` as any)}</Text>
          </Pressable>
        ))}
      </View>
      {schedule === 'adds' && (
        <View style={{ marginTop: 12 }}>
          <Text style={st.label}>{T('gs.g.days')}</Text>
          <TextInput style={st.input} value={days} onChangeText={onDays}
            keyboardType="number-pad" placeholder="1" placeholderTextColor="#A8A199"
            accessibilityLabel={T('gs.g.days')} />
        </View>
      )}

      <Text style={st.label}>
        {T('gs.g.notes')}<Text style={st.labelSoft}>{'  '}{T('gs.g.optional')}</Text>
      </Text>
      <TextInput style={[st.input, st.notes]} value={notes} onChangeText={onNotes} multiline
        placeholder={T('gs.g.notesHint')} placeholderTextColor="#A8A199"
        accessibilityLabel={T('gs.g.notes')} />

      <Pressable style={[st.cta, !ready && st.ctaOff]} onPress={onNext} disabled={!ready}
        accessibilityRole="button">
        <Text style={st.ctaT}>{T('gs.g.next')}</Text>
        <Text style={st.ctaArrow}>→</Text>
      </Pressable>
      {/* Says WHY it is off. A disabled button with no reason is the same as a broken one. */}
      {!ready && <Text style={st.why}>{T('gs.g.why')}</Text>}
    </Page>
  );
}

/* ───────────────────────────────── 9 — review ──────────────────────────────── */

/**
 * The last screen before it leaves the phone.
 *
 * MANDATE #2 IS THIS SCREEN. Everything above the button is a restatement of what is
 * about to be sent and to whom; the only new information is the act itself. It carries
 * the price in full, because the price is the thing that binds, and it names the
 * recipient with their address so "who is about to read this" is never an assumption.
 */
export function StepReview({ toName, toAddr, jobName, scope, price, schedule, onBack, onSend, sending }: {
  toName: string;
  /** Phone or email, whichever the send will actually use. */
  toAddr: string | null;
  jobName: string;
  scope: string;
  price: string;
  schedule: string;
  onBack: () => void;
  onSend: () => void;
  sending: boolean;
}) {
  return (
    <Page kicker="gs.r.kicker">
      <Text style={st.lede}>{T('gs.r.lede')}</Text>
      <View style={st.card}>
        <Text style={st.rowLab}>{T('gs.r.to')}</Text>
        <Text style={st.rowVal}>{toName}</Text>
        {!!toAddr && <Text style={st.rowSub}>{toAddr}</Text>}
        <View style={st.hr} />
        <Text style={st.rowLab}>{T('gs.r.job')}</Text>
        <Text style={st.rowVal}>{jobName}</Text>
        <View style={st.hr} />
        <Text style={st.rowLab}>{T('gs.r.co')}</Text>
        <Text style={st.rowVal}>{scope}</Text>
        <View style={st.hr} />
        <View style={st.money2}>
          <View style={{ flex: 1 }}>
            <Text style={st.rowLab}>{T('gs.r.price')}</Text>
            <Text style={st.priceBig}>{price}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={st.rowLab}>{T('gs.r.sched')}</Text>
            <Text style={st.rowVal}>{schedule}</Text>
          </View>
        </View>
      </View>
      <View style={st.pair}>
        <Pressable style={st.backBtn} onPress={onBack} accessibilityRole="button">
          <Text style={st.backT}>{T('gs.r.back')}</Text>
        </Pressable>
        <Pressable style={[st.cta, st.ctaGrow, sending && st.ctaOff]} onPress={onSend}
          disabled={sending} accessibilityRole="button">
          <Text style={st.ctaT}>{T(sending ? 'gs.r.sending' : 'gs.r.send')}</Text>
          {!sending && <Icon name="send" size={17} color="#141210" />}
        </Pressable>
      </View>
    </Page>
  );
}

/* ────────────────────────────────── 10 — sent ──────────────────────────────── */

export function StepDone({ toName, onView, onAnother }: {
  toName: string;
  onView: () => void;
  onAnother: () => void;
}) {
  return (
    <View style={[st.c, st.doneC]}>
      <View style={st.tick}>
        <Icon name="check" size={44} color="#FFFFFF" />
      </View>
      <Text style={st.doneH}>{T('gs.d.title')}</Text>
      <Text style={st.doneSub}>{T('gs.d.sub')}</Text>
      {/* Names who was told. "It was sent" is a claim about the system; "ABC will be
          notified" is a claim about a person, and that is what he wanted to know. */}
      <Text style={st.doneWho}>{T({ k: 'gs.d.who', p: { name: toName } } as any)}</Text>
      <Pressable style={[st.cta, st.doneCta]} onPress={onView} accessibilityRole="button">
        <Icon name="doc" size={18} color="#141210" />
        <Text style={st.ctaT}>{T('gs.d.view')}</Text>
      </Pressable>
      <Pressable style={st.doneLater} onPress={onAnother} accessibilityRole="button">
        <Text style={st.doneLaterT}>{T('gs.d.another')}</Text>
      </Pressable>
    </View>
  );
}

const st = StyleSheet.create({
  c: { flex: 1, backgroundColor: CREAM },
  scroll: { paddingHorizontal: 24, paddingTop: 60, paddingBottom: 40 },

  kicker: { fontFamily: 'Oswald_700Bold', fontSize: 20, color: INK,
    textTransform: 'uppercase', letterSpacing: 0.3 },
  kickerRule: { height: 2.5, backgroundColor: GOLD, borderRadius: 2, marginTop: 8,
    marginBottom: 16, alignSelf: 'stretch' },
  lede: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 21, color: '#3B3733',
    marginBottom: 16 },

  card: { backgroundColor: '#FFFDF9', borderWidth: 1, borderColor: '#ECE5DC',
    borderRadius: 14, padding: 16 },
  cardMeta: { fontFamily: 'Inter_400Regular', fontSize: 12.5, color: '#7A736B' },

  // ── the read-back ──
  playRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12,
    marginBottom: 14 },
  playBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, borderColor: '#DDD6CC',
    alignItems: 'center', justifyContent: 'center' },
  wave: { flex: 1, height: 3, borderRadius: 2, backgroundColor: '#DDD6CC' },
  playTime: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: '#5E5852' },
  transcript: { fontFamily: 'Inter_400Regular', fontSize: 15.5, lineHeight: 23, color: '#2C2A27' },
  waiting: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 22, color: '#7A736B',
    fontStyle: 'italic' },

  ghost: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
    minHeight: 50, borderRadius: 10, borderWidth: 1.4, borderColor: '#D5CEC4', marginTop: 14 },
  ghostT: { fontFamily: 'Inter_600SemiBold', fontSize: 15.5, color: INK },

  // ── the gaps ──
  label: { fontFamily: 'Inter_700Bold', fontSize: 12.5, color: INK, textTransform: 'uppercase',
    letterSpacing: 0.6, marginTop: 18, marginBottom: 8 },
  labelSoft: { fontFamily: 'Inter_400Regular', textTransform: 'none', letterSpacing: 0,
    color: '#7A736B' },
  money: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFDF9',
    borderWidth: 1, borderColor: '#DDD6CC', borderRadius: 10, paddingHorizontal: 14 },
  moneySign: { fontFamily: 'Inter_600SemiBold', fontSize: 17, color: '#7A736B', marginRight: 6 },
  moneyIn: { flex: 1, fontFamily: 'Inter_600SemiBold', fontSize: 17, color: INK,
    paddingVertical: 14 },
  input: { backgroundColor: '#FFFDF9', borderWidth: 1, borderColor: '#DDD6CC', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 13, fontSize: 16, fontFamily: 'Inter_400Regular',
    color: INK },
  notes: { minHeight: 84, textAlignVertical: 'top' },
  seg: { flexDirection: 'row', gap: 8 },
  segBtn: { flex: 1, minHeight: 46, borderRadius: 10, borderWidth: 1.4, borderColor: '#DDD6CC',
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFDF9' },
  segOn: { backgroundColor: GOLD, borderColor: GOLD },
  segT: { fontFamily: 'Inter_600SemiBold', fontSize: 14.5, color: '#3B3733' },
  segTOn: { color: '#141210' },
  why: { fontFamily: 'Inter_400Regular', fontSize: 13, color: '#7A736B', textAlign: 'center',
    marginTop: 10 },

  // ── review ──
  rowLab: { fontFamily: 'Inter_700Bold', fontSize: 11, color: '#7A736B',
    textTransform: 'uppercase', letterSpacing: 0.7 },
  rowVal: { fontFamily: 'Inter_600SemiBold', fontSize: 16, color: INK, marginTop: 4 },
  rowSub: { fontFamily: 'Inter_400Regular', fontSize: 13.5, color: '#5E5852', marginTop: 2 },
  hr: { height: 1, backgroundColor: '#EFE9E1', marginVertical: 14 },
  money2: { flexDirection: 'row', gap: 14 },
  priceBig: { fontFamily: 'Oswald_700Bold', fontSize: 26, color: INK, marginTop: 2,
    letterSpacing: -0.4 },
  pair: { flexDirection: 'row', gap: 10, marginTop: 18 },
  backBtn: { minWidth: 96, minHeight: 54, borderRadius: 10, borderWidth: 1.4,
    borderColor: '#D5CEC4', alignItems: 'center', justifyContent: 'center' },
  backT: { fontFamily: 'Inter_600SemiBold', fontSize: 16, color: '#2C2A27' },

  // ── shared action ──
  cta: { flexDirection: 'row', gap: 10, minHeight: 54, borderRadius: 10,
    backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  ctaGrow: { flex: 1, marginTop: 0 },
  ctaOff: { opacity: 0.45 },
  ctaT: { fontFamily: 'Inter_700Bold', fontSize: 16.5, color: '#141210' },
  ctaArrow: { fontSize: 17, color: '#141210', marginTop: -2 },

  // ── done ──
  doneC: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  tick: { width: 108, height: 108, borderRadius: 54, backgroundColor: GOLD,
    alignItems: 'center', justifyContent: 'center', marginBottom: 26 },
  doneH: { fontFamily: 'Oswald_700Bold', fontSize: 30, color: INK, textTransform: 'uppercase',
    textAlign: 'center', letterSpacing: -0.2 },
  doneSub: { fontFamily: 'Inter_400Regular', fontSize: 17, color: '#3B3733', marginTop: 8 },
  doneWho: { fontFamily: 'Inter_400Regular', fontSize: 14.5, color: '#7A736B', marginTop: 6,
    textAlign: 'center' },
  doneCta: { alignSelf: 'stretch', marginTop: 30 },
  doneLater: { paddingVertical: 16 },
  doneLaterT: { fontFamily: 'Inter_600SemiBold', fontSize: 15.5, color: '#7A736B' },
});
