/**
 * WHAT THE CLIENT WILL SEE — shown to the contractor before he sends it.
 *
 * WHY THIS EXISTS (hadar, 2026-09-03, with the step-6 artboard: "here is what the
 * preview needs to aspire for").
 *
 * The send step showed WHO it was going to and never WHAT was going. Recipients, a
 * team list, a Send button — and not one word of the document. That is a real hole in
 * mandate #2, which does not say "confirm the recipient": it says anything carrying a
 * PRICE takes a human confirmation before it commits or sends. A confirmation screen
 * that hides the price is a tap, not a confirmation.
 *
 * THE BREAKDOWN IS THE LINE ITEMS, NOT TWO BUCKETS (his one concrete correction —
 * the artboard's "Labor / Materials" is placeholder art). `parseLineItems` returns what
 * he actually priced: description, quantity, unit, total. `CostBreakdown` has always
 * been generic and renders nothing at all when there are no lines, so an extra priced
 * as one figure shows one figure rather than an empty table pretending to be a quote.
 *
 * IT ASSERTS NOTHING THE ROW DOES NOT HOLD. The artboard also shows "WHY THIS IS
 * NEEDED", "WHAT WILL BE DONE" and "WHAT THIS INCLUDES" as separate headed sections.
 * Those are not columns and not fields — they would have to be authored by the model
 * and stored, which is a server change (the prompt, `apply_proposal_v1`, and a
 * migration), not a layout. Inventing the headings over one blob of `scope_of_work`
 * would make the document claim a structure it does not have, on the screen where it
 * becomes binding. So the sections rendered here are the ones that exist:
 * `scope_of_work`, `exclusions`, and the schedule effect.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { t } from '../i18n';
import { CostBreakdown, MoneyBlock, PhotoGrid } from './kit';
import { Icon } from './icon';
import { C, F } from './theme';

export function SendPreview(p: {
  amount: string;
  nte: string | null;
  scopeOfWork: string | null;
  /**
   * ALREADY PARSED, by `record.ts`. This does NOT re-read `line_items` — that column is
   * parsed in exactly one place and every screen shows the same lines from it, including
   * the "1 ×" suppression rule. A second parser here would be a second set of rounding
   * and formatting decisions on a document that becomes binding.
   */
  lines: { title: string; detail?: string | null; amount: string }[];
  photos: readonly { captureId: string; uri: string; present: boolean }[];
  exclusions: string | null;
  scheduleEffect: string | null;
  scheduleDays: number | null;
  onPhoto?: (uri: string) => void;
}) {
  const lines = p.lines;

  const schedule = p.scheduleEffect === 'adds_days'
    ? (p.scheduleDays != null
        ? t({ k: 'draft.vSchedDays', p: { n: String(p.scheduleDays) } } as any)
        : t('co.schedAdds'))
    : p.scheduleEffect === 'no_change' ? t('co.schedNo')
    : null;

  const excl = (p.exclusions ?? '').trim();
  const sow = (p.scopeOfWork ?? '').trim();

  return (
    <View style={st.wrap}>
      {/* The eyebrow is the whole point of the block: everything under it is the
          COUNTERPARTY'S view, not his working copy. */}
      <View style={st.eyebrow}>
        <Icon name="eye" size={16} color={C.brandDark} />
        <Text style={st.eyebrowT}>{t('r5c.clientSees')}</Text>
      </View>

      <MoneyBlock
        amount={p.amount}
        subtitle={p.nte ? t({ k: 'erec.nte', p: { amount: p.nte } } as any) : t('erec.fixed')}
      />

      <CostBreakdown
        lines={lines}
        total={p.amount}
        label={t('cost.breakdown')}
        totalLabel={t('cost.total')}
      />

      {/* THE EVIDENCE, WHERE THE CLIENT WILL MEET IT. This product's claim is that a
          change order carries proof; the screen where he decides to send one is the last
          place that claim can still be checked. */}
      {!!p.photos.length && (
        <View style={st.sec}>
          <Text style={st.secH}>{t('r5c.previewPhotos')}</Text>
          <PhotoGrid
            photos={p.photos.map((ph) => ({ key: ph.captureId, uri: ph.uri, present: ph.present }))}
            missingLabel={t('erec.evidenceMissing')}
            onPressPhoto={p.onPhoto ? (photo) => p.onPhoto?.(photo.uri) : undefined}
          />
        </View>
      )}

      {!!sow && (
        <View style={st.sec}>
          <Text style={st.secH}>{t('draft.ckDescription')}</Text>
          <Text style={st.body}>{sow}</Text>
        </View>
      )}

      {!!excl && (
        <View style={st.sec}>
          <Text style={st.secH}>{t('draft.exclusions')}</Text>
          <Text style={st.body}>{excl}</Text>
        </View>
      )}

      {/* SILENCE IS NOT "NO CHANGE". An unanswered schedule question renders nothing
          rather than a reassuring "No change" the contractor never said — the same rule
          the read-back rows follow (mandate #6). */}
      {!!schedule && (
        <View style={st.sec}>
          <Text style={st.secH}>{t('draft.ckSchedule')}</Text>
          <Text style={st.body}>{schedule}</Text>
        </View>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { borderWidth: 1, borderColor: C.line, borderRadius: 14, backgroundColor: C.card,
    paddingHorizontal: 14, paddingBottom: 14, marginBottom: 18, overflow: 'hidden' },
  eyebrow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: -14,
    paddingHorizontal: 14, paddingVertical: 11, backgroundColor: C.brandSoft,
    marginBottom: 4 },
  eyebrowT: { fontFamily: F.dispSemi, fontSize: 12, letterSpacing: 1, color: C.brandDark,
    textTransform: 'uppercase' },
  sec: { marginTop: 14 },
  secH: { fontFamily: F.dispSemi, fontSize: 11.5, letterSpacing: 0.9, color: C.muted,
    textTransform: 'uppercase', marginBottom: 5 },
  body: { fontFamily: F.body, fontSize: 15.5, lineHeight: 22, color: C.ink },
});
