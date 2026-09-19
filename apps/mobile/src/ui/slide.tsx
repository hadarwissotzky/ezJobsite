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
import type { StyleProp, ViewStyle } from 'react-native';

/** Durations from the platform's own push/pop, which is what a phone user's eye
 *  is calibrated to. Out is shorter than in: leaving should feel immediate. */
const IN_MS = 280;
const OUT_MS = 220;

export type Slide = {
  /** Spread onto the Animated.View wrapping the screen. */
  style: { flex: 1; transform: { translateX: Animated.Value }[] };
  /** Slide the screen off to the right, THEN run the real back handler. */
  back: (done: () => void) => void;
  /**
   * PUT THE SCREEN BACK AT REST. Called by `SlideView` when it MOUNTS, which is
   * the event the top-level hook cannot see.
   *
   * A screen in this ladder unmounts whenever a child screen covers it, and comes
   * back when the child closes — without its `activeKey` ever changing, so the
   * entrance effect does not re-run. The Animated.Value survives that gap, but
   * `useNativeDriver` means the value JS knows about is NOT the one the UI thread
   * is showing: a native animation never writes its frames back to JS, so after an
   * entrance the JS copy still reads `width` — off-stage. React Native restores it
   * asynchronously when the node detaches, and if that restore has not landed by
   * the time the view re-attaches, the screen re-mounts a full width to the right
   * of the phone and the user is looking at an empty page with no way back.
   *
   * So the wrapper says "I am on screen" and we park it, but ONLY when this key's
   * entrance has already played — on a genuine open the entrance effect owns the
   * position and parking here first would flash the screen at its destination for
   * a frame before it slid in.
   */
  rest: () => void;
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
  /** The key whose entrance has already run. Null means "nothing is on stage". */
  const played = React.useRef<string | null>(null);
  const keyRef = React.useRef(activeKey);
  keyRef.current = activeKey;

  React.useEffect(() => {
    // Closing clears the record of what played, so re-opening the SAME screen gets
    // its entrance back instead of being parked at rest by `rest()` below.
    if (activeKey === null) { played.current = null; return; }
    played.current = activeKey;
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

  const rest = React.useCallback(() => {
    if (keyRef.current !== null && played.current === keyRef.current) x.setValue(0);
  }, [x]);

  const back = React.useCallback((done: () => void) => {
    /**
     * `done()` RUNS EXACTLY ONCE, AND IT RUNS EVEN IF NOTHING CALLS US BACK.
     *
     * The completion callback of a native-driven animation comes back across the
     * bridge, and the screen it is closing has already slid off the phone by then:
     * if that message is lost or arrives late, the user is left staring at an empty
     * page. A stuck screen is a far worse bug than a skipped transition, so the
     * timer is the floor — whichever arrives first wins, and the other is dropped.
     */
    let fired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (fired) return;
      fired = true;
      if (timer !== undefined) clearTimeout(timer);
      done();
    };
    timer = setTimeout(finish, OUT_MS + 400);
    Animated.timing(x, {
      toValue: width,
      duration: OUT_MS,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
      // See the header: fire regardless of `finished`.
    }).start(finish);
  }, [x, width]);

  return { style: { flex: 1, transform: [{ translateX: x }] }, back, rest };
}

/**
 * The wrapper every sliding screen returns. It exists as a component rather than a
 * bare `Animated.View` for one reason: something has to notice the MOUNT, which is
 * what `rest()` above is for.
 */
export function SlideView({ slide, style, children }: {
  slide: Slide;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const restRef = React.useRef(slide.rest);
  restRef.current = slide.rest;
  React.useLayoutEffect(() => { restRef.current(); }, []);
  return <Animated.View style={[style, slide.style]}>{children}</Animated.View>;
}
