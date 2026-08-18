/**
 * WHAT AN EMPTY LIST SAYS.
 *
 * hadar, 2026-08-18: "add an illustration and a message to the negative lists (when the
 * lists are empty)", with RevenueCat's own empty state as the reference — a drawing, a
 * bold line saying what is missing, and a quieter line saying what will fill it.
 *
 * Before this, four screens each rendered one grey sentence floating 40px below a header.
 * That is indistinguishable from a screen that failed to load, which is the worst reading
 * available to a user who does not think in software (CLAUDE.md's core design test): he
 * does not conclude "nothing here yet", he concludes "it's broken" and stops opening it.
 *
 * ─── TRUE EMPTY ONLY. NOT FILTERED, NOT SEARCHED ────────────────────────────────
 * This component is for "nothing exists yet". It must NOT be used when a filter or a
 * search produced no rows: the drawing plus "no change orders yet" over a list that is
 * merely filtered is a false statement about the account, and it hides the fact that
 * clearing the filter brings everything back. Those keep their one quiet line, which is
 * the correct weight for "no results" — see the call sites in App.tsx, where the
 * distinction is enforced by which branch renders which.
 *
 * ─── ONE MASCOT, EVERY EMPTY STATE ──────────────────────────────────────────────
 * The same character on every empty list, deliberately — that is the convention the
 * reference uses and the reason it works: seeing the same friendly figure in four
 * different places teaches, in a way no sentence does, that this screen is FINE and
 * simply has nothing on it yet. Four bespoke illustrations would each have to earn that
 * recognition separately.
 *
 * It is hard-wired rather than passed in. A prop would be flexibility nobody asked for,
 * and the one thing worth protecting here is that the four states cannot drift apart.
 */
import React from 'react';
import { Image, Text, View } from 'react-native';
import { C, F } from './theme';

/** The clipboard character (hadar's artwork, 2026-08-18). Transparent PNG, so it sits on
 *  the app's cream background with no plate behind it. */
const MASCOT = require('../../assets/mascot-empty.png');

export function EmptyState(props: {
  /** What is missing. One short line, bold — this is the sentence he actually reads. */
  title: string;
  /** What will fill it. The part that turns "broken" into "not yet". */
  body?: string | null;
  /** Rendered under the text — a way out, when there is one worth offering. */
  action?: React.ReactNode;
  /** Tightens the block for a list that sits inside a card rather than on a screen. */
  compact?: boolean;
}) {
  const art = props.compact ? 116 : 168;
  return (
    <View
      // ONE accessibility node, not three. A screen reader announcing an image, then a
      // heading, then a paragraph makes an empty list sound like content.
      accessible
      accessibilityRole="text"
      accessibilityLabel={[props.title, props.body].filter(Boolean).join('. ')}
      style={{ alignItems: 'center',
        paddingVertical: props.compact ? 20 : 36, paddingHorizontal: 28 }}>

      {/* DECORATIVE, and marked as such: the sentences below say everything the drawing
          says. A screen reader that announced it would read out a filename. */}
      <Image source={MASCOT} resizeMode="contain" accessibilityRole="image"
        accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
        style={{ width: art, height: art, marginBottom: props.compact ? 6 : 12 }} />

      <Text style={{ fontFamily: F.bodyBold, fontSize: props.compact ? 16 : 18,
        color: C.ink, textAlign: 'center' }}>
        {props.title}
      </Text>
      {!!props.body && (
        <Text style={{ fontFamily: F.body, fontSize: 14.5, color: C.steel,
          textAlign: 'center', lineHeight: 21, marginTop: 6, maxWidth: 320 }}>
          {props.body}
        </Text>
      )}
      {!!props.action && <View style={{ marginTop: 16 }}>{props.action}</View>}
    </View>
  );
}
