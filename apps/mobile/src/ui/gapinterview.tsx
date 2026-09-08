/**
 * THE GAP INTERVIEW — at most three questions between a one-breath capture and a
 * client-winning send (SPEC-single-line-co-v1 D2/D6, hadar 2026-09-06).
 *
 * Rendered ONLY when `evaluateSignability` found gaps — the complete one-liner never
 * sees this card (the balance rule). Every control writes the CONTRACTOR'S choice
 * into real columns via the caller; nothing here invents content, parses money, or
 * decides anything — the screen is deliberately dumb so the rules stay in
 * signability.ts and the one money parser stays in the caller (mandate #6).
 *
 * A tap answers and the row leaves; when the last row leaves the card leaves. The
 * ballpark input hands its RAW TEXT up — the caller runs parseMoney and refuses a
 * figure it cannot read, exactly as the cost editor does.
 */
import React from 'react';
import { Text, TextInput, View, StyleSheet, Pressable } from 'react-native';
import type { SignabilityGap } from '../signability';
import { t } from '../i18n';
import { C, F } from './theme';

export type GapAnswers = {
  /** no_total: opens the COST EDITOR — a price is born in the read-back, never in a
   *  chip (mandate #6). This card only points at the door. */
  onSetPrice: () => void;
  /** no_total's explicit opt-out — his choice, said out loud, session-scoped. */
  onSendUnpriced: () => void;
  /** 'inside' amends the exclusion sentence; 'on_top' moves the fee out of the total. */
  onFeeConflict: (about: string, sentence: string, resolution: 'inside' | 'on_top') => void;
  /** Raw text from the input — the caller parses. Empty/labelled leave-open = keep as is. */
  onBallpark: (about: string, rawText: string | null) => void;
  onBilling: (v: 'when_completed' | 'next_invoice') => void;
  onSchedule: (v: 'no_change' | 'not_sure') => void;
  /** "Adds days…" needs a number — that is the schedule editor's job, not a chip's. */
  onScheduleAddsDays: () => void;
};

function Chip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [st.chip, pressed && { opacity: 0.6 }]}
    >
      <Text style={st.chipT}>{label}</Text>
    </Pressable>
  );
}

export function GapInterview(props: { gaps: readonly SignabilityGap[]; total: string;
                                      answers: GapAnswers }) {
  // Keyed by item (code review 2026-09-08, finding 2): one shared string meant two
  // open-cost rows mirrored each other's typing, and grout's Add could submit
  // tile's figure — a wrong dollar amount on a priced instrument.
  const [ballparks, setBallparks] = React.useState<Record<string, string>>({});
  if (props.gaps.length === 0) return null;
  const { answers } = props;

  return (
    <View style={st.card}>
      <Text style={st.head}>{t('gap.head')}</Text>
      <Text style={st.why}>{t('gap.why')}</Text>

      {props.gaps.map((g, i) => {
        if (g.kind === 'no_total') {
          return (
            <View key="nt" style={st.row}>
              <Text style={st.q}>{t('gap.priceQ')}</Text>
              <View style={st.chips}>
                <Chip label={t('gap.priceSet')} onPress={answers.onSetPrice} />
              </View>
              <Pressable onPress={answers.onSendUnpriced} hitSlop={8}>
                <Text style={st.leave}>{t('gap.priceWithout')}</Text>
              </Pressable>
            </View>
          );
        }
        if (g.kind === 'fee_conflict') {
          return (
            <View key={`fc${i}`} style={st.row}>
              <Text style={st.q}>{t({ k: 'gap.feeQ', p: { fee: g.about, total: props.total } })}</Text>
              <View style={st.chips}>
                <Chip label={t('gap.feeInside')}
                  onPress={() => answers.onFeeConflict(g.about, g.sentence, 'inside')} />
                <Chip label={t('gap.feeOnTop')}
                  onPress={() => answers.onFeeConflict(g.about, g.sentence, 'on_top')} />
              </View>
            </View>
          );
        }
        if (g.kind === 'open_cost') {
          return (
            <View key={`oc${i}`} style={st.row}>
              <Text style={st.q}>{t({ k: 'gap.openQ', p: { item: g.about } })}</Text>
              <View style={st.chips}>
                <TextInput
                  style={st.money}
                  value={ballparks[g.about] ?? ''}
                  onChangeText={(v) => setBallparks((b) => ({ ...b, [g.about]: v }))}
                  placeholder={t('gap.openPh')}
                  keyboardType="decimal-pad"
                  accessibilityLabel={t({ k: 'gap.openQ', p: { item: g.about } })}
                />
                <Chip label={t('gap.openAdd')}
                  onPress={() => answers.onBallpark(g.about, ballparks[g.about] ?? '')} />
              </View>
              <Pressable onPress={() => answers.onBallpark(g.about, null)} hitSlop={8}>
                <Text style={st.leave}>{t('gap.openLeave')}</Text>
              </Pressable>
            </View>
          );
        }
        if (g.kind === 'no_billing') {
          return (
            <View key="nb" style={st.row}>
              <Text style={st.q}>{t('gap.billQ')}</Text>
              <View style={st.chips}>
                <Chip label={t('gap.billDone')} onPress={() => answers.onBilling('when_completed')} />
                <Chip label={t('gap.billNext')} onPress={() => answers.onBilling('next_invoice')} />
              </View>
            </View>
          );
        }
        return (
          <View key="ns" style={st.row}>
            <Text style={st.q}>{t('gap.schedQ')}</Text>
            <View style={st.chips}>
              <Chip label={t('gap.schedNo')} onPress={() => answers.onSchedule('no_change')} />
              <Chip label={t('gap.schedAdd')} onPress={answers.onScheduleAddsDays} />
              <Chip label={t('gap.schedUnsure')} onPress={() => answers.onSchedule('not_sure')} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

const st = StyleSheet.create({
  // The waiting family's look (tokens statusTints.caution): this card is the app
  // asking for a decision, the same register as the negotiation card.
  card: {
    backgroundColor: '#FFF3EA', borderWidth: 1, borderColor: '#FFD9C2',
    borderRadius: 12, padding: 13, marginTop: 10,
  },
  head: { fontFamily: F.disp, fontSize: 19, color: '#7A3A12', textTransform: 'uppercase', letterSpacing: 0.6 },
  why: { fontFamily: F.body, fontSize: 14, color: C.steel, marginTop: 3, lineHeight: 19 },
  row: { marginTop: 12 },
  q: { fontFamily: F.body, fontSize: 16.5, fontWeight: '700', color: C.ink, lineHeight: 23 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8, alignItems: 'center' },
  chip: {
    minHeight: 40, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10,
    backgroundColor: C.raised, borderWidth: 1.5, borderColor: '#7A3A12',
  },
  chipT: { fontFamily: F.body, fontSize: 15.5, fontWeight: '700', color: '#7A3A12' },
  money: {
    minHeight: 40, minWidth: 92, paddingHorizontal: 12, borderRadius: 10,
    backgroundColor: C.raised, borderWidth: 1.5, borderColor: '#7A3A12',
    fontFamily: F.body, fontSize: 16.5, color: C.ink,
  },
  leave: { fontFamily: F.body, fontSize: 14.5, color: C.steel, marginTop: 8, textDecorationLine: 'underline' },
});
