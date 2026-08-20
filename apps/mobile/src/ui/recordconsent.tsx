/**
 * "One quick thing before you record" — the one-time terms acceptance.
 *
 * hadar's design, 2026-08-20, delivered alongside the FirstExtra and GuidedCoach
 * mockups: these three are one journey and had stopped looking like it. The other two
 * were already drawn to this language (Oswald headline over cream, gold second line, a
 * short rule); THIS screen was still the old inline `s.card` in App.tsx — the bright
 * #dafbe1 panel on a #2da44e border left over from an early build. It sat in the
 * middle of the guided flow looking like a different application.
 *
 * ─── WHY IT IS A SCREEN AND NOT A DIALOG ────────────────────────────────────────
 * It is asking someone to accept legal terms and to take personal responsibility for
 * recording lawfully. That is not an "OK/Cancel" moment, and a system alert would give
 * it neither the room to explain nor a decline that reads as legitimate. It shows once,
 * ever, at the first record tap (`consent.ts`), and never again.
 *
 * ─── THE JURISDICTION LINE IS INFORMATIONAL, AND MUST STAY THAT WAY ─────────────
 * In an all-party state the screen adds a reminder that everyone in a conversation has
 * to be told. It NEVER blocks acceptance, and the app never asserts third-party
 * consent on the user's behalf — that is the personal-use model this consent design is
 * built on (App.tsx, 2026-07-17), and quietly turning this line into a gate would
 * change what the product is claiming about who is responsible.
 *
 * It is drawn in gold rather than red for the same reason: it is a thing to KNOW, not
 * a thing that is wrong. A warning colour here would read as "you cannot do this".
 *
 * ─── "NOT NOW" IS A REAL EXIT ───────────────────────────────────────────────────
 * Declining returns to where he was with nothing recorded and nothing accepted. A man
 * standing somewhere he cannot talk, or who wants to read the terms first, has to be
 * able to leave — and because this screen is reached from the record tap rather than
 * shown at launch, leaving costs him nothing he cannot come back to.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon } from './icon';
import { t as T } from '../i18n';

// Local constants, matching `firstextra.tsx` and `guidedcoach.tsx` rather than the C/F
// tokens. Those two screens are this one's immediate neighbours in the flow and share
// a type scale the rest of the app does not use; matching them is what makes the three
// read as one journey. If this trio is ever folded into the theme, all three move
// together or none do.
const GOLD = '#D9A02B';
const GREEN = '#506A45';
const INK = '#131110';
const CREAM = '#F7F5F0';
const SAND = '#EFE7D9';

export function RecordConsent({ jurisdiction, allParty, detecting, onAccept, onLater }: {
  /** Two-letter state, when known. Null while detecting or when location is refused. */
  jurisdiction: string | null;
  /** Does this jurisdiction require every party to be told? Drives the reminder only. */
  allParty: boolean;
  /** Still working out where we are. Says so rather than silently showing nothing. */
  detecting: boolean;
  onAccept: () => void;
  onLater: () => void;
}) {
  return (
    <View style={st.c}>
      <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
        {/* The same wordmark the other two screens draw, so this reads as the middle
            of a journey rather than an interruption from somewhere else. */}
        <View style={st.mark}>
          <View style={st.markBox}>
            <Icon name="check" size={13} color={INK} />
            <View style={st.markTail} />
          </View>
          <Text style={st.markT}>EZChange<Text style={st.markTLight}>Orders</Text></Text>
        </View>

        <View style={st.card}>
          <View style={st.disc}>
            <Icon name="micLine" size={26} color={INK} />
          </View>
          <View style={st.rule} />

          <Text style={st.head}>{T('terms.h1')}</Text>
          <Text style={[st.head, { color: GOLD }]}>{T('terms.h2')}</Text>

          <Text style={st.body}>{T('terms.body')}</Text>

          {detecting ? (
            <Text style={st.detecting}>{T('terms.detecting')}</Text>
          ) : allParty && jurisdiction ? (
            /* A generic pin, not the state's outline. The mockup draws California
               because California is what the mockup drew; there is no set of fifty
               outlines in the icon kit and inventing one for the state we happen to
               detect is a rabbit hole with no bottom. The pin says "where you are",
               which is the whole job of the glyph. */
            <View style={st.juris}>
              <Icon name="mapPin" size={22} color={GOLD} />
              <Text style={st.jurisT}>
                {T({ k: 'terms.reminder', p: { state: jurisdiction } } as any)}
              </Text>
            </View>
          ) : null}

          <View style={st.hr} />

          {/* INK, not green: this is the one commitment on the screen and it takes the
              app's heaviest button. The other two screens in this flow reserve green
              for "go on to the next thing"; accepting terms is a different act. */}
          <Pressable style={st.accept} accessibilityRole="button" onPress={onAccept}>
            <Text style={st.acceptT}>{T('terms.accept')}</Text>
          </Pressable>
          <Pressable style={st.later} accessibilityRole="button" onPress={onLater}>
            <Text style={st.laterT}>{T('terms.later')}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  c: { flex: 1, backgroundColor: CREAM },
  scroll: { paddingHorizontal: 22, paddingTop: 62, paddingBottom: 34 },

  mark: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
    marginBottom: 26 },
  markBox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2.2, borderColor: INK,
    alignItems: 'center', justifyContent: 'center' },
  markTail: { position: 'absolute', bottom: -3.5, left: 3, width: 7, height: 7,
    backgroundColor: INK, transform: [{ rotate: '45deg' }] },
  markT: { fontFamily: 'Inter_700Bold', fontSize: 17, color: INK, letterSpacing: -0.3 },
  markTLight: { fontFamily: 'Inter_400Regular' },

  card: { backgroundColor: '#FFFDF9', borderColor: '#ECE5DC', borderWidth: 1,
    borderRadius: 24, paddingHorizontal: 22, paddingTop: 30, paddingBottom: 24,
    alignItems: 'center' },
  disc: { width: 74, height: 74, borderRadius: 37, backgroundColor: SAND,
    alignItems: 'center', justifyContent: 'center' },
  rule: { width: 52, height: 3, borderRadius: 2, backgroundColor: GOLD,
    marginTop: 22, marginBottom: 20 },

  head: { fontFamily: 'Oswald_700Bold', fontSize: 27, lineHeight: 31, color: INK,
    textTransform: 'uppercase', textAlign: 'center', letterSpacing: -0.2 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 22, color: '#3B3733',
    textAlign: 'center', marginTop: 20 },
  detecting: { fontFamily: 'Inter_400Regular', fontSize: 14, color: '#7A736B',
    textAlign: 'center', marginTop: 18 },

  juris: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: 20,
    alignSelf: 'stretch' },
  jurisT: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 14.5, lineHeight: 21,
    color: '#A97C1E' },

  hr: { alignSelf: 'stretch', height: 1, backgroundColor: '#ECE5DC', marginTop: 24,
    marginBottom: 20 },

  accept: { alignSelf: 'stretch', minHeight: 58, borderRadius: 12, backgroundColor: INK,
    alignItems: 'center', justifyContent: 'center' },
  acceptT: { fontFamily: 'Inter_700Bold', fontSize: 17, color: '#fff' },
  later: { alignSelf: 'stretch', minHeight: 50, alignItems: 'center',
    justifyContent: 'center', marginTop: 10 },
  laterT: { fontFamily: 'Inter_600SemiBold', fontSize: 16, color: GREEN },
});
