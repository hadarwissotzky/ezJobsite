/**
 * Step 2 — "Just tell us what happened."
 *
 * hadar's storyboard, 2026-08-12. This is the screen the whole guided flow exists for.
 *
 * ─── THE PROBLEM IT SOLVES ──────────────────────────────────────────────────────
 * Ask a contractor who has never used a voice app to "record a change order" and the
 * failure is not technical. He presses the button, freezes, and says nine words that
 * cannot be priced — because nobody told him what the recording is FOR or how much is
 * enough. That silence is the single biggest reason a first capture never becomes a
 * change order, and no amount of pipeline quality fixes it.
 *
 * So the screen does three things, in this order:
 *   1. REFRAMES THE TASK as something he does twenty times a day — "talk like you're
 *      explaining it to someone back at the office". Not "record a change order".
 *   2. LISTS THE FOUR THINGS worth saying, numbered, each one a question he can already
 *      answer. Numbered rather than bulleted on purpose: a list of four numbered items
 *      is a thing you can finish, and finishing is what he needs to believe.
 *   3. SHOWS A WORKED EXAMPLE, in quotes, in a real contractor's voice, with a real
 *      figure in it — and offers to PLAY it. Someone who does not read screens will
 *      press the play button, and hearing the length ("that's all? I can do that")
 *      does more than the four prompts above it.
 *
 * ─── WHAT IT DOES NOT DO ────────────────────────────────────────────────────────
 * It does not require any of the four. `guidedflow.ts` lets an unanswered price or
 * schedule through to the gaps step, where they are asked as questions with the
 * recording already safe. Making the prompts mandatory here would put a form in front of
 * a man holding a phone on a jobsite, which is the thing this product exists not to do.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from './icon';
import { COACH_PROMPTS } from '../guidedflow';
import { t as T } from '../i18n';

const GOLD = '#D9A02B';
const INK = '#131110';
const CREAM = '#F7F5F0';
const SAND = '#EFE7D9';

/** One glyph per prompt, in the storyboard's order. Kept here rather than in
 *  `guidedflow.ts` — that module is pure and testable and must not import the icon kit
 *  to stay that way. */
const PROMPT_ICONS: IconName[] = ['micLine', 'checklist', 'cost', 'calendar'];

export function GuidedCoach({ onStart, onBack, onHearExample, playing }: {
  onStart: () => void;
  onBack: () => void;
  /** Play the worked example aloud. Omit and the row is not offered — better than a
   *  play button that does nothing, which is this codebase's most repeated bug. */
  onHearExample?: () => void;
  playing?: boolean;
}) {
  return (
    <View style={st.c}>
      <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
        <Pressable style={st.back} onPress={onBack} hitSlop={12} accessibilityRole="button">
          <Icon name="chevLeft" size={20} color="#5E5852" />
        </Pressable>

        <Text style={st.head}>{T('gf.h1')}</Text>
        <Text style={[st.head, { color: GOLD }]}>{T('gf.h2')}</Text>
        {/* The reframe. It is the most important sentence on the screen. */}
        <Text style={st.lede}>{T('gf.lede')}</Text>

        <View style={st.list}>
          {COACH_PROMPTS.map((p, n) => (
            <View key={p.key} style={st.item}>
              <View style={st.itemIcon}>
                <Icon name={PROMPT_ICONS[n]} size={17} color={INK} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={st.itemT}>
                  <Text style={st.itemN}>{n + 1}  </Text>{T(p.title)}
                </Text>
                <Text style={st.itemB}>{T(p.body)}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* THE EXAMPLE. In quotes and in his register — "we opened the wall", not
            "the scope was expanded". It carries a real number because the thing most
            people leave out is the number. */}
        <View style={st.example}>
          <Text style={st.exampleLab}>{T('gf.exampleLab')}</Text>
          <Text style={st.exampleT}>{T('gf.example')}</Text>
        </View>

        {onHearExample && (
          <Pressable style={st.hear} onPress={onHearExample} accessibilityRole="button">
            <Icon name={playing ? 'pause' : 'play'} size={18} color={INK} />
            <Text style={st.hearT}>{T(playing ? 'gf.hearStop' : 'gf.hear')}</Text>
          </Pressable>
        )}

        <Pressable style={st.cta} accessibilityRole="button" onPress={onStart}>
          <Icon name="micLine" size={19} color="#141210" />
          <Text style={st.ctaT}>{T('fx.start')}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  c: { flex: 1, backgroundColor: CREAM },
  scroll: { paddingHorizontal: 24, paddingTop: 58, paddingBottom: 34 },
  back: { width: 40, height: 40, justifyContent: 'center', marginLeft: -8, marginBottom: 6 },

  head: { fontFamily: 'Oswald_700Bold', fontSize: 30, lineHeight: 33, color: INK,
    textTransform: 'uppercase', letterSpacing: -0.2 },
  lede: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 21, color: '#3B3733',
    marginTop: 12, marginBottom: 18 },

  // ── the four prompts ──
  // One card each, hairline-separated, so the list reads as four things rather than a
  // paragraph. A numbered list of four is a thing you can finish.
  list: { gap: 10 },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: '#FFFDF9',
    borderWidth: 1, borderColor: '#ECE5DC', borderRadius: 12, padding: 13 },
  itemIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: SAND,
    alignItems: 'center', justifyContent: 'center' },
  itemT: { fontFamily: 'Inter_700Bold', fontSize: 14.5, color: INK },
  itemN: { fontFamily: 'Oswald_700Bold', color: GOLD },
  itemB: { fontFamily: 'Inter_400Regular', fontSize: 13.5, lineHeight: 19, color: '#5E5852',
    marginTop: 3 },

  // ── the worked example ──
  example: { backgroundColor: SAND, borderRadius: 12, padding: 15, marginTop: 18 },
  exampleLab: { fontFamily: 'Inter_700Bold', fontSize: 11, color: '#7A736B',
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 7 },
  exampleT: { fontFamily: 'Inter_400Regular', fontSize: 14.5, lineHeight: 21, color: '#2C2A27',
    fontStyle: 'italic' },
  hear: { flexDirection: 'row', alignItems: 'center', gap: 9, alignSelf: 'flex-start',
    paddingVertical: 14, paddingHorizontal: 2 },
  hearT: { fontFamily: 'Inter_600SemiBold', fontSize: 14.5, color: INK },

  cta: { flexDirection: 'row', gap: 10, minHeight: 56, borderRadius: 10,
    backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  ctaT: { fontFamily: 'Inter_700Bold', fontSize: 17, color: '#141210' },
});
