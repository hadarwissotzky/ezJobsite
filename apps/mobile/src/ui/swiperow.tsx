/**
 * Swipe left on a row to reveal Delete (hadar 2026-08-05).
 *
 * BUILT ON PanResponder, NOT react-native-gesture-handler. The library is the usual
 * answer and it is not installed here — adding it means a native dependency, which
 * means a cable rebuild, which means this change could not reach the phone over the
 * air. PanResponder ships in React Native itself, so this is a JS-only change and
 * lands like every other update tonight. If gesture-handler arrives later for other
 * reasons, this is a small file to replace.
 *
 * IT ONLY EVER REVEALS. There is no swipe-all-the-way-to-delete, and that is
 * deliberate: this app destroys evidence on the other side of the button, and a
 * gesture that can complete by momentum is a gesture that can complete by accident in
 * a truck on a bad road. The swipe uncovers an affordance; a deliberate tap on it
 * opens the confirmation that names what will be destroyed (mandate #2).
 *
 * ROWS THAT CANNOT BE DELETED DO NOT MOVE. `enabled={false}` makes the row inert
 * rather than revealing a button that then refuses — an extra that has been sent is
 * not the owner's alone to destroy (discard.ts), and offering the action anyway
 * teaches that the app's buttons are suggestions.
 *
 * VERTICAL SCROLL STILL WINS. The responder only claims the gesture once horizontal
 * travel clearly exceeds vertical, so a fast flick down a list never snags a row.
 */
import React from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';

import { t } from '../i18n';
import { C, F } from './theme';

/** How far the row slides to expose the button. Matches the button's width. */
const REVEAL = 92;
/** Past this, letting go opens rather than springs back. Half the reveal: a swipe
 *  that was clearly intended completes, a brush does not. */
const COMMIT = REVEAL * 0.45;
/** Horizontal travel must beat vertical by this much before we take the gesture. */
const AXIS_BIAS = 1.6;

export function SwipeRow({ children, onDelete, enabled = true, deleteLabel }: {
  children: React.ReactNode;
  onDelete: () => void;
  /** False for rows the lifecycle forbids deleting — the row simply will not move. */
  enabled?: boolean;
  deleteLabel?: string;
}) {
  const x = React.useRef(new Animated.Value(0)).current;
  // The committed resting offset, kept outside Animated so the responder can reason
  // about where the row already is without reading animated state mid-gesture.
  const open = React.useRef(false);
  /**
   * IS THE BUTTON EVEN MOUNTED (hadar 2026-08-06: "I can still see the delete button
   * bleeding under the record").
   *
   * It used to be mounted always, and merely COVERED by the row on top of it. That is
   * one accidental pixel away from visible — any gap, margin, rounding or clip the row
   * does not fill lets red through, and on the dashboard it did. Covering something
   * red with something white is not the same as it not being there.
   *
   * So: nothing is rendered until a swipe actually begins, and it unmounts again when
   * the row settles closed. At rest the subtree is EMPTY, which makes the bleed
   * impossible rather than merely unlikely — the same reasoning as `enabled`, which
   * already refuses to mount a button for a row that cannot be deleted.
   */
  const [armed, setArmed] = React.useState(false);

  const settle = React.useCallback((toOpen: boolean) => {
    open.current = toOpen;
    Animated.spring(x, {
      toValue: toOpen ? -REVEAL : 0,
      useNativeDriver: true, bounciness: 0, speed: 18,
      // Unmount only AFTER the row has finished sliding back, or the button would
      // vanish out from under the animation and flash the page behind it.
    }).start(({ finished }) => { if (finished && !toOpen) setArmed(false); });
  }, [x]);

  const pan = React.useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => {
      if (!enabled) return false;
      // Claim ONLY a clear horizontal drag. A list is scrolled far more often than a
      // row is deleted, so the ambiguous case must belong to the scroll view.
      return Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy) * AXIS_BIAS;
    },
    // The gesture is ours — NOW there is something to reveal.
    onPanResponderGrant: () => setArmed(true),
    onPanResponderMove: (_e, g) => {
      const base = open.current ? -REVEAL : 0;
      // Clamped: never past the button, never right of closed. Rubber-banding here
      // would suggest a second action further left that does not exist.
      x.setValue(Math.min(0, Math.max(-REVEAL, base + g.dx)));
    },
    onPanResponderRelease: (_e, g) => {
      const base = open.current ? -REVEAL : 0;
      const at = base + g.dx;
      // Velocity counts as intent: a short fast flick opens, a long slow drag that
      // stopped short does not.
      settle(at < -COMMIT || g.vx < -0.5);
    },
    onPanResponderTerminate: () => settle(false),
  }), [enabled, settle, x]);

  return (
    <View style={st.wrap}>
      {/* Behind the row. Rendered only when the row can actually move AND a swipe is
          under way — at rest there is nothing behind the row at all. */}
      {enabled && armed && (
        <View style={st.behind}>
          <Pressable
            onPress={() => { settle(false); onDelete(); }}
            style={st.del}
            accessibilityRole="button"
            // The button says "Delete"; the CONFIRMATION says what will be
            // destroyed. A 92pt control cannot hold "Delete this extra" — it wrapped
            // and clipped — and the swipe is not the place to explain consequences
            // anyway, because nothing is destroyed by revealing it.
            accessibilityLabel={deleteLabel ?? t('discard.action')}
          >
            <Text style={st.delT} numberOfLines={1}>{deleteLabel ?? t('discard.swipeDelete')}</Text>
          </Pressable>
        </View>
      )}

      <Animated.View style={{ transform: [{ translateX: x }] }} {...pan.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { position: 'relative', overflow: 'hidden' },
  behind: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'flex-end', justifyContent: 'center',
  },
  del: {
    width: REVEAL, height: '100%',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.danger,
  },
  delT: { fontFamily: F.bodySemi, fontSize: 14.5, color: '#fff' },
});
