/**
 * THE FOUR-STEP RAIL — where you are in creating a change order.
 *
 * hadar, 2026-08-27: "well there is the functionality and there is the UX we were
 * missing a stronger progress bar."
 *
 * WHAT IT REPLACES, and why that was not enough. Each step drew one line of 12pt grey
 * caps — "STEP 2 OF 4" — and nothing else. That is a label you read once on your first
 * change order and never see again: it does not say what the steps ARE, it does not
 * show movement between them, and by the third screen a first-timer has no idea
 * whether he is nearly done or barely started. Four screens arrive after one Done tap,
 * and the app was answering "how much longer" in the quietest type on the page.
 *
 * NAMES, NOT JUST NUMBERS. Each segment carries its own word — Record · Job · Client ·
 * Write-up — so the rail tells you what is COMING, not only how many are left. "Step 3
 * of 4" and "next you pick who signs" are different amounts of help to somebody who has
 * never done this before, and CLAUDE.md §1's test is whether he succeeds without being
 * taught.
 *
 * THE PERCENTAGE STARTS AT STEP 2. Nothing is complete while he is still recording, and
 * opening a flow on "0% done" is a discouraging first thing to read — so step 1 shows
 * its position and no figure. (hadar: "when you get to the job section you already have
 * 25% done".)
 *
 * PURE AND PROP-DRIVEN. It reads nothing, fetches nothing and owns no state, so the one
 * rail cannot render differently on the three screens that draw it — which is exactly
 * how the old label drifted into two spellings (`flowStep` and `flowStepOnDark`) that
 * had to be kept in sync by hand.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { t } from '../i18n';
import { C, F } from './theme';

/** Which of the four screens is on. 1 = recording, 4 = the write-up. */
export type FlowStep = 1 | 2 | 3 | 4;

const SEGMENTS = ['flow.s1', 'flow.s2', 'flow.s3', 'flow.s4'] as const;

export function FlowRail({ step, tone = 'light' }: {
  step: FlowStep;
  /** `dark` only changes the UPCOMING track, which is invisible on a dark page. */
  tone?: 'light' | 'dark';
}) {
  // Completed steps only — arriving at step 2 means one of four is behind you.
  const pct = (step - 1) * 25;
  const upcoming = tone === 'dark' ? '#3A3F3B' : '#E0DACE';

  return (
    <View>
      <View style={st.head}>
        <Text style={st.headT}>
          {t({ k: 'flow.stepOf', p: { n: String(step), of: '4' } } as any)}
        </Text>
        {pct > 0 && (
          <Text style={st.headT}>{t({ k: 'flow.pctDone', p: { n: String(pct) } } as any)}</Text>
        )}
      </View>
      <View style={st.bars}>
        {SEGMENTS.map((key, i) => {
          const n = i + 1;
          const done = n < step;
          const now = n === step;
          return (
            <View key={key} style={st.seg}>
              <View style={[st.bar, { backgroundColor: done ? C.ink : now ? C.brand : upcoming }]} />
              <Text style={[st.label, { color: done ? C.steel : now ? C.brand : C.disabled }]}
                numberOfLines={1}>
                {t(key as any)}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
          marginBottom: 9 },
  headT: { fontFamily: F.dispSemi, fontSize: 12, letterSpacing: 1.1,
           textTransform: 'uppercase', color: C.brand },
  bars: { flexDirection: 'row', gap: 6, alignItems: 'flex-end' },
  seg: { flex: 1 },
  bar: { height: 4, borderRadius: 999 },
  label: { fontFamily: F.dispSemi, fontSize: 12, letterSpacing: 1.1,
           textTransform: 'uppercase', marginTop: 7 },
});
