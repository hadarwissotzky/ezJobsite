/**
 * PUSH / POP TRANSITIONS, ON A PILE OF `if` STATEMENTS.
 *
 * hadar, 2026-09-18: "when the user clicks on details, the screens should slide
 * from the right and the back buttons should have the animation to slide back."
 *
 * THERE IS NO NAVIGATOR HERE. This app ships no react-navigation, no expo-router,
 * no react-native-screens and no reanimated: App.tsx presents nineteen top-level
 * screens as an early-return ladder (`if (record) return <RecordScreen/>`). That
 * is a deliberate, working choice and this does not change it — adopting a
 * navigator to get one animation would be a native dependency, a store build, and
 * a rewrite of the screen that matters most.
 *
 * THE HARD HALF IS LEAVING, and it is why this is a hook rather than a wrapper
 * component. An early return unmounts the moment its flag flips, so by the time
 * a "slide out" could start there is nothing left on screen to slide. The usual
 * fix — keep the outgoing tree mounted and animate it — means holding a copy of
 * a screen whose props have already gone stale, which on THIS screen would mean
 * rendering a change order from a record the app has stopped tracking.
 *
 * So we invert it: ANIMATE FIRST, THEN FLIP THE STATE. The screen is still fully
 * mounted and live during the slide because nothing has changed yet; the state
 * change lands after, when the pixels are already off-screen. The caller gives us
 * its real back handler and we run it on completion.
 *
 * `done()` RUNS EVEN IF THE ANIMATION DOES NOT FINISH. An interrupted animation
 * (navigating during the slide, a JS stall) must never eat the back button and
 * strand somebody on a screen they asked to leave — a stuck detail screen is a
 * much worse bug than a skipped transition. `start()`'s callback fires on
 * interruption too, so the exit is unconditional and the `finished` flag is
 * deliberately ignored.
 *
 * useNativeDriver: the whole point. `translateX` is driven on the UI thread, so
 * the slide holds its frame rate while JS is busy doing the work that opening a
 * record actually costs.
 */
import React from 'react';
import { Animated, Dimensions, Easing } from 'react-native';

/** Durations from the platform's own push/pop, which is what a phone user's eye
 *  is calibrated to. Out is shorter than in: leaving should feel immediate. */
const IN_MS = 280;
const OUT_MS = 220;

export type Slide = {
  /** Spread onto the Animated.View wrapping the screen. */
  style: { flex: 1; transform: { translateX: Animated.Value }[] };
  /** Slide the screen off to the right, THEN run the real back handler. */
  back: (done: () => void) => void;
};

/**
 * CALLED UNCONDITIONALLY, KEYED ON WHAT IS OPEN — not inside the `if`.
 *
 * Every screen in App.tsx lives in ONE component behind early returns, so a hook
 * called inside `if (record) { … }` would run on some renders and not others:
 * React counts hooks per render and throws when the count moves. It would also
 * animate at App mount rather than when the screen opens, which is the wrong
 * moment entirely.
 *
 * So the hook sits with the other top-level hooks and takes a KEY: null when the
 * screen is closed, a stable id when it is open. Each transition to a non-null
 * key snaps the screen off-stage and slides it in — which also gives the right
 * behaviour when one detail replaces another (a record opened from inside a
 * record), where a mount-only effect would sit still.
 */
export function useSlide(activeKey: string | null): Slide {
  // Read per-call rather than at module scope: a fold or a rotation changes this,
  // and a stale width leaves the screen parked short of the edge.
  const width = Dimensions.get('window').width;
  const x = React.useRef(new Animated.Value(activeKey === null ? width : 0)).current;

  React.useEffect(() => {
    if (activeKey === null) return;          // closed: nothing to bring on stage
    x.setValue(width);                       // start off the right edge, every time
    const a = Animated.timing(x, {
      toValue: 0,
      duration: IN_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    a.start();
    return () => a.stop();
  }, [activeKey, x, width]);

  const back = React.useCallback((done: () => void) => {
    Animated.timing(x, {
      toValue: width,
      duration: OUT_MS,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
      // See the header: fire regardless of `finished`.
    }).start(() => done());
  }, [x, width]);

  return { style: { flex: 1, transform: [{ translateX: x }] }, back };
}

/** Re-exported so a screen branch needs one import, not two. */
export const SlideView = Animated.View;
