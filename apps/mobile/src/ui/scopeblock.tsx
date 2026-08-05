/**
 * THE SCOPE OF WORK, rendered the same way at every stage of the extra's life.
 *
 * ONE COMPONENT FOR ALL THREE SCREENS, and that is the requirement rather than a
 * tidiness preference (hadar, 2026-08-05, after reviewing the detail page draft →
 * approved). The product's entire promise is that the contractor, the owner and the
 * record agree about what was bought. That is only believable if the reader can SEE
 * the text not changing — so draft, negotiation and locked must render the same
 * prose, in the same place, in the same type. Three separate renderings is how they
 * drift, and two of the three had already drifted into a one-line truncated row.
 *
 * WHAT THE REVIEW FOUND, and what this fixes:
 *   · Draft — the scope sat 620px down, below the price and the raw capture rows,
 *     clipped at five lines behind "Show more".
 *   · Sent — a single truncated row ("Description / Scope · Install new 200A…") on
 *     the very screen where the contractor is answering questions about it.
 *   · Approved — the same truncated row, on the screen a dispute is settled with.
 *
 * NEVER TRUNCATED. A scope you have to tap to read is a scope nobody proofreads
 * before it goes to a client, and the whole failure this fixes is a client signing
 * something nobody read. Long scopes scroll inside their own box rather than being
 * hidden behind a control — the fireplace example runs 2,651 characters and that is
 * a NORMAL length for a job with steps, assumptions and exclusions.
 *
 * THE CAPTION IS THE POINT OF THE STAGE. "This is what the owner reads and signs"
 * on a draft is the sentence that makes a contractor write two paragraphs instead of
 * three words; "exactly as sent" and "exactly as signed" are the claims the frozen
 * instrument lets us make truthfully. They are not decoration — they are the reason
 * the same block reads differently at each stage without the TEXT changing.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { t } from '../i18n';
import { C, F, label as labelStyle } from './theme';

export type ScopeStage = 'draft' | 'sent' | 'signed';

export function ScopeBlock({ text, stage, onEdit, missing }: {
  /** The scope of work. Empty renders the gap, never a blank box. */
  text: string | null | undefined;
  stage: ScopeStage;
  /** Draft only. Absent = not editable from here (a frozen extra). */
  onEdit?: () => void;
  /** True when readiness counts this as a blocker — the caller owns that verdict. */
  missing?: boolean;
}) {
  const body = (text ?? '').trim();
  const frozen = stage !== 'draft';

  return (
    <View style={st.wrap}>
      <View style={st.head}>
        <Text style={labelStyle}>{t('scope.heading')}</Text>
        {stage === 'draft' && onEdit && (
          <Pressable onPress={onEdit} hitSlop={8} style={st.editHit}
            accessibilityRole="button" accessibilityLabel={t('scope.edit')}>
            <Text style={st.edit}>{t('scope.edit')}</Text>
          </Pressable>
        )}
      </View>

      {body ? (
        // A BOX THAT SCROLLS, not a paragraph that clips. `nestedScrollEnabled` so a
        // long scope can be read inside the screen's own ScrollView on Android; iOS
        // handles it natively.
        <ScrollView
          style={[st.box, frozen && st.boxFrozen]}
          nestedScrollEnabled
          showsVerticalScrollIndicator
        >
          <Text style={st.body} selectable>{body}</Text>
        </ScrollView>
      ) : (
        // THE GAP, NAMED. An empty scope is the single most consequential thing
        // missing from an extra, so it says what to do rather than showing nothing.
        <Pressable onPress={onEdit} disabled={!onEdit} style={[st.box, st.empty]}
          accessibilityRole={onEdit ? 'button' : undefined}>
          <Text style={st.emptyT}>{t('scope.empty')}</Text>
        </Pressable>
      )}

      <Text style={[st.caption, missing && st.captionWarn]}>
        {missing
          ? t('scope.tooShort')
          : t(stage === 'draft' ? 'scope.capDraft'
            : stage === 'sent' ? 'scope.capSent' : 'scope.capSigned')}
      </Text>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { marginTop: 14 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  editHit: { minHeight: 32, justifyContent: 'center' },
  edit: { fontFamily: F.bodySemi, fontSize: 14.5, color: C.brand },
  box: {
    marginTop: 7,
    // Tall enough that a real scope reads as prose rather than a preview, capped so
    // it cannot push the price and the terms off the screen entirely.
    maxHeight: 320,
    backgroundColor: C.raised,
    borderWidth: 1, borderColor: C.line, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  // Frozen text sits on the muted surface — the same signal the app uses everywhere
  // for "this is a record, not a field".
  boxFrozen: { backgroundColor: C.surfaceMuted },
  body: { fontFamily: F.body, fontSize: 15, lineHeight: 22, color: C.ink },
  empty: { minHeight: 64, justifyContent: 'center', backgroundColor: C.surfaceMuted },
  emptyT: { fontFamily: F.bodySemi, fontSize: 14.5, color: C.danger },
  caption: { fontFamily: F.body, fontSize: 12.5, color: C.muted, marginTop: 7 },
  captionWarn: { color: C.danger, fontFamily: F.bodySemi },
});
