/**
 * "Let's create your first change order" — the guided start.
 *
 * hadar's design, 2026-08-12: shown the first time a registered user opens the app with
 * NO jobs and NO change orders, ahead of the guided capture journey.
 *
 * ─── WHY THIS AND NOT THE EMPTY HOME ────────────────────────────────────────────
 * Home already has an empty state, and it is the right screen for "you have nothing
 * yet" — it is a place with a capture button on it. THIS screen answers a different
 * question, once: WHAT IS ABOUT TO HAPPEN TO ME. The ICP is explicitly someone for whom
 * software is not second nature (CLAUDE.md §1), and the thing that stops that person
 * pressing a record button is not knowing what the recording will be used for or who
 * will see it. So the screen spends its whole body on that: three sentences of what the
 * app will do, a rail showing how many steps there are, and one promise —
 *
 *     NOTHING IS SENT UNTIL YOU SAY SO
 *
 * which is mandate #2 (confirm, don't automate) said out loud to the person it protects,
 * at the only moment they are deciding whether to trust it.
 *
 * ─── IT IS DECLINABLE ───────────────────────────────────────────────────────────
 * "Do this later" is not a courtesy. A contractor who opened the app to look around, or
 * who is standing somewhere he cannot talk, must be able to leave — and the footer tells
 * him where the door will be afterwards, so declining costs him nothing he cannot get
 * back. Once dismissed it never returns (`markFirstExtraSeen`).
 */
import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from './icon';
import { t as T } from '../i18n';

const GOLD = '#D9A02B';
const INK = '#131110';
const CREAM = '#F7F5F0';
/** The pale disc behind the body glyphs and the reassurance strip. */
const SAND = '#EFE7D9';

/** A body line, split so the emphasised half can carry the accent colour. Written as
 *  two strings rather than parsed out of one: a marker syntax inside a translated
 *  sentence is a thing translators break, and Spanish does not emphasise the same
 *  words in the same order. */
type Promise3 = { icon: IconName; lead: string; strong: string; tail?: string };

const BODY: Promise3[] = [
  { icon: 'micLine', lead: 'fx.r1a', strong: 'fx.r1b', tail: 'fx.r1c' },
  { icon: 'doc', lead: 'fx.r2a', strong: 'fx.r2b' },
  { icon: 'person', lead: 'fx.r3a', strong: 'fx.r3b' },
];

/** The four steps, in order. Only the first is live — the rail is a MAP, not a control:
 *  it says how far away the end is, which is the question someone asks before starting
 *  something they have never done. */
const RAIL: { icon: IconName; label: string }[] = [
  { icon: 'micLine', label: 'fx.s1' },
  { icon: 'doc', label: 'fx.s2' },
  { icon: 'person', label: 'fx.s3' },
  { icon: 'send', label: 'fx.s4' },
];

export function FirstExtra({ onCoach, onStart, onLater }: {
  /** "Show me what to say" — the coached route, step 2. */
  onCoach: () => void;
  /** "I know what to do" — straight to the recorder, skipping the coaching. */
  onStart: () => void;
  /** Dismiss for good. The caller marks it seen; this only reports the tap. */
  onLater: () => void;
}) {
  return (
    <View style={st.c}>
      <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
        {/* The wordmark, as the onboarding draws it — the same two shapes and word, so
            the screen after sign-up is visibly the same product as the one before it. */}
        <View style={st.mark}>
          <View style={st.markBox}>
            <Icon name="check" size={13} color={INK} />
            <View style={st.markTail} />
          </View>
          <Text style={st.markT}>EZChange<Text style={st.markTLight}>Orders</Text></Text>
        </View>

        {/* CENTRED, unlike the onboarding's left-ranged headlines. This one is an
            invitation rather than a claim, and it sits over a centred body. */}
        <Text style={st.head}>{T('fx.h1')}</Text>
        <Text style={[st.head, { color: GOLD }]}>{T('fx.h2')}</Text>
        <View style={st.rule} />

        <View style={st.rows}>
          {BODY.map((b) => (
            <View key={b.lead} style={st.row}>
              <View style={st.rowDisc}>
                <Icon name={b.icon} size={20} color={INK} />
              </View>
              <Text style={st.rowT}>
                {T(b.lead)}<Text style={st.rowStrong}>{T(b.strong)}</Text>
                {b.tail ? T(b.tail) : ''}
              </Text>
            </View>
          ))}
        </View>

        {/* MANDATE #2, in his words. Its own surface because it is the one sentence that
            answers "what happens if I get it wrong" — the question that decides whether
            a first recording ever happens. */}
        <View style={st.promise}>
          <Image source={require('../../assets/onboard/obShieldInk.png')}
            style={st.promiseIcon} resizeMode="contain" />
          <Text style={st.promiseT}>{T('fx.safe')}</Text>
        </View>

        {/* The map. Outlined circles, the live one ringed and lettered in gold. */}
        <View style={st.rail}>
          {RAIL.map((r, n) => (
            <React.Fragment key={r.label}>
              {n > 0 && <Text style={st.railArrow}>→</Text>}
              <View style={st.railStep}>
                <View style={[st.railDisc, n === 0 && st.railDiscOn]}>
                  <Icon name={r.icon} size={22} color={n === 0 ? GOLD : INK} />
                </View>
                {/* No numberOfLines: clipping "Choose owner" to "Choose ow…" loses the
                    word that says what the step IS. If a translation ever outgrows the
                    column it wraps, which costs a line and keeps the meaning. */}
                <Text style={[st.railT, n === 0 && st.railTOn]}>{T(r.label)}</Text>
              </View>
            </React.Fragment>
          ))}
        </View>

        {/* TWO WAYS IN, and the order is the point. The coached route is the primary
            button because this screen only exists for someone who has never done this;
            the confident route is offered plainly beside it so that nobody who knows
            what they are doing is marched through a tutorial. */}
        <Pressable style={st.cta} accessibilityRole="button" onPress={onCoach}>
          <Text style={st.ctaT}>{T('fx.coach')}</Text>
          <Text style={st.ctaArrow}>→</Text>
        </Pressable>
        <Pressable style={st.later} accessibilityRole="button" onPress={onStart}>
          <Text style={st.laterT}>{T('fx.knowHow')}</Text>
        </Pressable>
        {/* NOT IN THE STORYBOARD, kept deliberately. The reference draws a happy path;
            without a way out this screen is a wall for a man who opened the app to look
            around, or who is standing somewhere he cannot talk. Quiet, third, and it
            says where the door will be afterwards. */}
        <Pressable style={st.skip} accessibilityRole="button" onPress={onLater}>
          <Text style={st.skipT}>{T('fx.later')}</Text>
        </Pressable>
        {/* Says where the door is, so declining costs nothing he cannot get back. */}
        <Text style={st.foot}>{T('fx.footNote')}</Text>
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  c: { flex: 1, backgroundColor: CREAM },
  scroll: { paddingHorizontal: 24, paddingTop: 62, paddingBottom: 34, alignItems: 'center' },

  mark: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 26 },
  markBox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2.2, borderColor: INK,
    alignItems: 'center', justifyContent: 'center' },
  markTail: { position: 'absolute', bottom: -3.5, left: 3, width: 7, height: 7,
    backgroundColor: INK, transform: [{ rotate: '45deg' }] },
  markT: { fontFamily: 'Inter_700Bold', fontSize: 17, color: INK, letterSpacing: -0.3 },
  markTLight: { fontFamily: 'Inter_400Regular' },

  head: { fontFamily: 'Oswald_700Bold', fontSize: 33, lineHeight: 36, color: INK,
    textTransform: 'uppercase', textAlign: 'center', letterSpacing: -0.2 },
  rule: { width: 52, height: 3, borderRadius: 2, backgroundColor: GOLD,
    marginTop: 14, marginBottom: 22 },

  // ── the three sentences ──
  rows: { alignSelf: 'stretch', gap: 14, paddingHorizontal: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  rowDisc: { width: 40, height: 40, borderRadius: 20, backgroundColor: SAND,
    alignItems: 'center', justifyContent: 'center' },
  rowT: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 15.5, lineHeight: 22,
    color: '#2C2A27' },
  rowStrong: { fontFamily: 'Inter_700Bold', color: GOLD },

  // ── the promise ──
  promise: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: SAND,
    borderRadius: 12, paddingVertical: 14, paddingHorizontal: 18, marginTop: 22 },
  promiseIcon: { width: 26, height: 26 },
  promiseT: { fontFamily: 'Inter_600SemiBold', fontSize: 15.5, lineHeight: 21, color: INK },

  // ── the rail ──
  // Breaks OUT of the page's 24pt padding. Four columns plus three arrows inside 327pt
  // left ~68pt each, and "Choose owner" needs more than that at a legible size; the rail
  // is the one row on this screen with nothing beside it, so it can have the full width.
  rail: { alignSelf: 'stretch', marginHorizontal: -16, flexDirection: 'row',
    alignItems: 'flex-start', justifyContent: 'center', marginTop: 30, marginBottom: 26 },
  // flex, not a fixed width: at 68pt "Choose owner" was one point too wide and wrapped
  // to two lines, which pushed that column's label out of line with the other three.
  // Sharing the row equally gives every label the same box and the widest one sets the
  // size that has to fit.
  railStep: { flex: 1, alignItems: 'center' },
  // Outlined, not filled: these are places he has not been yet. The live one is the
  // only thing on the rail with weight.
  railDisc: { width: 48, height: 48, borderRadius: 24, borderWidth: 1.5,
    borderColor: '#DDD6CC', backgroundColor: '#FFFDF9',
    alignItems: 'center', justifyContent: 'center' },
  railDiscOn: { borderColor: GOLD, borderWidth: 2 },
  railT: { fontFamily: 'Inter_400Regular', fontSize: 10.5, color: '#5E5852', marginTop: 8,
    textAlign: 'center' },
  railTOn: { fontFamily: 'Inter_700Bold', color: GOLD },
  railArrow: { fontSize: 14, color: '#9A938B', marginTop: 16, width: 18,
    textAlign: 'center' },

  // ── the two doors ──
  cta: { alignSelf: 'stretch', flexDirection: 'row', gap: 12, minHeight: 56,
    borderRadius: 10, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center' },
  ctaT: { fontFamily: 'Inter_700Bold', fontSize: 17, color: '#141210' },
  ctaArrow: { fontSize: 18, color: '#141210', marginTop: -2 },
  later: { alignSelf: 'stretch', minHeight: 54, borderRadius: 10, borderWidth: 1.4,
    borderColor: '#D5CEC4', alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  laterT: { fontFamily: 'Inter_600SemiBold', fontSize: 16.5, color: '#2C2A27' },
  skip: { alignSelf: 'stretch', alignItems: 'center', paddingVertical: 14, marginTop: 2 },
  skipT: { fontFamily: 'Inter_600SemiBold', fontSize: 14.5, color: '#7A736B' },
  foot: { fontFamily: 'Inter_400Regular', fontSize: 12.5, lineHeight: 18, color: '#7A736B',
    textAlign: 'center', marginTop: 4 },
});
