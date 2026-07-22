/**
 * PRD R6c — the decision summary section of the extra record screen.
 *
 * Sits at position 6 in R6b's ordered list: after the photos, BEFORE the full
 * history. R6b is explicit that "the summary and the history are never
 * alternatives: the summary is the fast read, the history is the evidence" — so
 * this component never collapses, never replaces and never links away to the
 * timeline. It is a card above it.
 *
 * ─── TWO THINGS THIS COMPONENT IS REQUIRED TO SHOW ───────────────────────────
 *
 * 1. THAT IT IS DERIVED. R6c: the summary "is labeled as derived". Not a subtle
 *    styling cue — a sentence, always rendered, saying the words below were
 *    assembled from the events and are not part of what anyone signed. The card is
 *    deliberately the only dashed-border block on the screen so it does not read as
 *    another piece of evidence.
 * 2. HOW MANY LOGGED FACTS IT RESTS ON. `traced` is printed next to that label, so
 *    a five-clause narrative over a two-line history is a contradiction the reader
 *    can SEE. A guardrail nobody can check is a promise, not a guardrail.
 *
 * ─── WHY IT TAKES `summary` AND NOT `db` ─────────────────────────────────────
 * The record screen owns loading. Passing null is the whole of R6c's second AC: the
 * caller renders `<DecisionSummaryCard summary={null}/>` and gets nothing, with
 * every other section untouched. A component that fetched its own data could throw
 * inside the record screen's tree and take the legal artifact down with it.
 *
 * Every string goes through t() (mandate #5). recordscreen.tsx's header records
 * what happened the last time English was baked into this screen.
 */
import React from 'react';
import { Text, View } from 'react-native';
import type { DecisionSummary } from '../decisionsummary';
import { t } from '../i18n';
import { C, F, T, label } from './theme';

export function DecisionSummaryCard({ summary }: { summary: DecisionSummary | null }) {
  // R6c AC2, in one line: no summary, no section. Nothing else on the record moves.
  if (!summary) return null;

  return (
    <View style={[T.card, {
      borderStyle: 'dashed', borderWidth: 1, borderColor: C.line, backgroundColor: 'transparent',
    }]}>
      <Text style={label}>{t('r6c.title')}</Text>

      <Text style={{ ...T.bodySteel, fontSize: 11.5, marginTop: 4, lineHeight: 16 }}>
        {t({ k: 'r6c.derived', p: { n: summary.traced } } as any)}
      </Text>

      <View style={{ marginTop: 10, gap: 5 }}>
        {summary.clauses.map((c, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 7 }}>
            <Text style={{ ...T.bodySteel, fontSize: 14.5 }}>·</Text>
            <Text style={[T.body, { fontSize: 14.5, flex: 1 }]}>
              {t({ k: c.k, p: c.p } as any)}
            </Text>
          </View>
        ))}
      </View>

      {/* The owed line, always last and always present — R6c: the summary "ends on
          what is owed". Given its own weight because it is the only line here that
          is an instruction rather than an account. `urgent` is R5b's 48h flag; it
          changes colour only, never the words, so the sentence still reads the same
          to someone who cannot see the difference. */}
      <View style={{
        marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.line,
        flexDirection: 'row', gap: 7,
      }}>
        <Text style={{
          fontFamily: F.dispSemi, fontSize: 11.5, letterSpacing: 1,
          textTransform: 'uppercase', color: summary.owed.urgent ? C.danger : C.steel,
          paddingTop: 2,
        }}>
          {t('r6c.owedLabel')}
        </Text>
        <Text style={{
          fontFamily: F.bodySemi, fontSize: 14.5, lineHeight: 20, flex: 1,
          color: summary.owed.urgent ? C.danger : C.ink,
        }}>
          {t({ k: summary.owed.k, p: summary.owed.p } as any)}
        </Text>
      </View>
    </View>
  );
}
