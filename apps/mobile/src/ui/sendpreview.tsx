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
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { t } from '../i18n';
import { CostBreakdown, MoneyBlock, PhotoGrid } from './kit';
import { Icon } from './icon';
import { C, F } from './theme';

export function SendPreview(p: {
  amount: string;
  /**
   * False when `amount_cents` is null. REQUIRED, because `amount` renders the literal
   * string '—' in that case (record.ts:143) and every other MoneyBlock caller in the app
   * branches on this. Without it the screen mandate #2 governs previewed a priceless
   * change order as "—  Fixed price": a dash posing as an amount, on the document a
   * client is being asked to approve.
   */
  priced: boolean;
  nte: string | null;
  /** True when the price is a not-to-exceed cap rather than a fixed figure. */
  isNte: boolean;
  /** The caller's `no_description` answer — the ONE scope predicate (`hasWrittenScope`).
   *  Never re-derived here from a non-empty string: that is the 40-character
   *  disagreement that put "Not written up yet" directly above a written scope. */
  scopeWritten: boolean;
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
  /**
   * Opens the SCOPE editor — `onOpenDetail('scope')`, which is what the review screen's
   * "Edit text" button already called despite being labelled for the description.
   */
  onEditScope?: () => void;
}) {
  const lines = p.lines;

  const schedule = p.scheduleEffect === 'adds_days'
    ? (p.scheduleDays != null
        ? t({ k: 'draft.vSchedDays', p: { n: String(p.scheduleDays) } } as any)
        : t('co.schedAdds'))
    : p.scheduleEffect === 'no_change' ? t('co.schedNo')
    // "NOT SURE" IS A TERM THE DOCUMENT CARRIES (Codex, 2026-09-03). `flowterms.ts:72`
    // prints "Schedule impact: to be confirmed." into the FROZEN instrument, and this
    // preview dropped it — so a contractor who answered "not sure" was shown a document
    // missing a line the client then received and signed. A preview that omits a term of
    // the thing being signed is worse than no preview: it is a wrong one.
    : p.scheduleEffect === 'not_sure' ? t('co.schedUnsure')
    : null;

  const excl = (p.exclusions ?? '').trim();
  // The words to print. Whether they COUNT as a scope is the caller's answer, above.
  const sow = p.scopeWritten ? (p.scopeOfWork ?? '').trim() : '';

  return (
    <View style={st.wrap}>
      {/* The eyebrow is the whole point of the block: everything under it is the
          COUNTERPARTY'S view, not his working copy. */}
      <View style={st.eyebrow}>
        <Icon name="eye" size={16} color={C.brandDark} />
        <Text style={st.eyebrowT}>{t('r5c.clientSees')}</Text>
      </View>

      {/* NO PRICE IS A STATE, NOT A DASH. The same branch `extradraft`, `extralocked`
          and `extranegotiation` all take — this was the only MoneyBlock in the app
          that did not, and it was the one on the send screen.
          The NTE label follows the VALUE, not the mode: an extra set to not-to-exceed
          whose cap has not been typed would otherwise be labelled "Fixed price". */}
      {p.priced ? (
        <MoneyBlock
          amount={p.amount}
          subtitle={p.isNte && p.nte
            ? t({ k: 'erec.nte', p: { amount: p.nte } } as any)
            : t('erec.fixed')}
        />
      ) : (
        <MoneyBlock amount={t('erec.priceToCome')} muted />
      )}

      <CostBreakdown
        lines={lines}
        total={p.priced ? p.amount : null}
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

      {/* ── THE SCOPE OF WORK, EDITED IN PLACE ─────────────────────────────────
          hadar, 2026-09-03: "remove edit description and record change from the review
          stage — the description section should not be there. the user should be able
          to edit the scope of work not the description at this point."

          The old screen carried a card headed "Description" with an "Edit text" button
          under it — and that button already opened the SCOPE editor. So the label said
          one thing, the control did another, and both sat beside a preview that showed
          the scope a third time. Three ways of saying one field, on the screen where
          that field becomes the binding instrument.

          One section now: the client-facing scope, headed as what it is, and the words
          themselves are the control. It is never truncated and never behind an expand —
          a scope you have to open to read is a scope nobody proofreads before sending.

          It renders when the scope is MISSING too, because that is the state a man most
          needs a way out of, and the way out is the same tap. */}
      <Pressable onPress={p.onEditScope} disabled={!p.onEditScope}
        accessibilityRole={p.onEditScope ? 'button' : undefined}
        style={({ pressed }) => [st.sec, pressed && { opacity: 0.6 }]}>
        <View style={st.secHRow}>
          <Text style={st.secH}>{t('r5c.scopeHead')}</Text>
          {!!p.onEditScope && <Text style={st.secEdit}>{t('r5c.editScope')}</Text>}
        </View>
        <Text style={[st.body, !p.scopeWritten && st.bodyEmpty]}>
          {p.scopeWritten ? sow : t('draft.notWrittenUp')}
        </Text>
      </Pressable>

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
  secHRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  secEdit: { fontFamily: F.bodySemi, fontSize: 13, color: C.brandDark },
  bodyEmpty: { color: C.steel, fontStyle: 'italic' },
  secH: { fontFamily: F.dispSemi, fontSize: 11.5, letterSpacing: 0.9, color: C.muted,
    textTransform: 'uppercase', marginBottom: 5 },
  body: { fontFamily: F.body, fontSize: 15.5, lineHeight: 22, color: C.ink },
});
