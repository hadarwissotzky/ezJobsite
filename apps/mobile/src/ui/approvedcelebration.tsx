/**
 * "APPROVED." — the one screen in this app that exists purely to feel good.
 *
 * hadar, 2026-08-18: "the most important event that everything is leading to is approved
 * … when the app is opened after a CO was approved, a popup should show up (like an SMS
 * with an animation, the stars and fireworks) and with a link to the CO that was approved.
 * And description."
 *
 * ─── WHY IT EARNS THE INTERRUPTION ──────────────────────────────────────────────
 * This app interrupts a contractor almost never, on purpose: he is on a ladder, in a
 * truck, in a crawlspace. A modal that takes the whole screen has to be worth it. This
 * one is, and it is the only one that is: an approval is the end of the chain every other
 * surface serves. Capture, price, send, wait — all of it exists to reach this moment, and
 * a moment that arrives as one more grey row in a list is a moment the product failed to
 * mark.
 *
 * ─── NO NEW DEPENDENCY, DELIBERATELY ────────────────────────────────────────────
 * Built on RN's own `Animated`. A confetti library would mean a native rebuild and one
 * more thing that can fail to link on a phone in the field, for an effect that is
 * fifty lines of transforms. Every animation here runs on the NATIVE driver (transform +
 * opacity only), so it stays at 60fps while the JS thread is busy with the sync tick that
 * very likely just delivered this approval.
 *
 * ─── IT RESPECTS REDUCE MOTION ──────────────────────────────────────────────────
 * Not decoration: `AccessibilityInfo` is how someone who gets motion sick tells every app
 * on the phone to stop throwing things around. The news is identical either way — the
 * card, the headline, the description and the link all still appear. Only the fireworks
 * stop. A celebration that ignores that setting is a celebration at someone's expense.
 */
import React from 'react';
import {
  AccessibilityInfo, Animated, Easing, Modal, Pressable, ScrollView, Text, View,
} from 'react-native';
import { t } from '../i18n';
import { C, F } from './theme';

/** Warm, festive, and deliberately NOT the app's olive brand — this is a takeover, and
 *  the one moment where standing apart from every other surface is the point. */
const SPARK = ['#E8B33C', '#D9743F', '#4E6243', '#8C6BB1', '#3F8F9E', '#C9522F'];

/**
 * ONE FIREWORK: particles thrown outward from a point, fading as they slow.
 *
 * A single driver value per burst rather than one per particle — 12 Animated.Values that
 * always hold the same number is 12 native animations doing one animation's work, and
 * this fires three bursts on a phone that may be four years old.
 */
function Burst(props: { x: number; y: number; delay: number; size: number }) {
  const v = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    const run = Animated.sequence([
      Animated.delay(props.delay),
      Animated.timing(v, {
        toValue: 1, duration: 1100,
        // Fast out, slow to a stop: the shape of something thrown, not something driven.
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
    ]);
    // Twice, not forever. A looping firework stops reading as a celebration and starts
    // reading as a screen that is stuck.
    const loop = Animated.loop(
      Animated.sequence([run, Animated.delay(400), Animated.timing(v, {
        toValue: 0, duration: 0, useNativeDriver: true })]),
      { iterations: 2 });
    loop.start();
    return () => loop.stop();
  }, [props.delay, v]);

  const N = 12;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: props.x, top: props.y }}>
      {Array.from({ length: N }, (_, i) => {
        const angle = (i / N) * Math.PI * 2;
        const dist = props.size;
        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute', width: 7, height: 7, borderRadius: 4,
              backgroundColor: SPARK[i % SPARK.length],
              opacity: v.interpolate({
                // Bright almost immediately, then gone before it lands — a spark that
                // fades at the same rate it travels reads as a bubble, not a firework.
                inputRange: [0, 0.12, 0.72, 1], outputRange: [0, 1, 0.85, 0],
              }),
              transform: [
                { translateX: v.interpolate({
                    inputRange: [0, 1], outputRange: [0, Math.cos(angle) * dist] }) },
                { translateY: v.interpolate({
                    // Gravity: the arc sags at the end instead of running straight out.
                    inputRange: [0, 0.7, 1],
                    outputRange: [0, Math.sin(angle) * dist * 0.82, Math.sin(angle) * dist + 22] }) },
                { scale: v.interpolate({
                    inputRange: [0, 0.2, 1], outputRange: [0.4, 1, 0.35] }) },
              ],
            }} />
        );
      })}
    </View>
  );
}

/** A star that breathes. Each gets its own phase so they never pulse in unison, which
 *  is what makes a handful of them read as a sky rather than a progress indicator. */
function Star(props: { x: number; y: number; delay: number; size: number }) {
  const v = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.delay(props.delay),
      Animated.timing(v, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad),
        useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad),
        useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [props.delay, v]);
  return (
    <Animated.Text pointerEvents="none" style={{
      position: 'absolute', left: props.x, top: props.y, fontSize: props.size,
      opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }),
      transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.15] }) }],
    }}>✨</Animated.Text>
  );
}

export function ApprovedCelebration(props: {
  /** The job. Null when its row has not synced — the line is dropped, not faked. */
  projectName: string | null;
  /** What the client actually read and signed (391's scope_of_work, title as floor). */
  description: string;
  /** Pre-rendered by the caller from `celebrationLine` so this file holds no copy. */
  detail: string;
  /** How many more approvals are queued behind this one. */
  more: number;
  onOpen: () => void;
  onClose: () => void;
}) {
  const [reduce, setReduce] = React.useState(false);
  const pop = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    // Read once, and default to MOTION ON if the query fails: the setting is a request to
    // reduce, and an unanswered query is not that request.
    AccessibilityInfo.isReduceMotionEnabled().then(setReduce).catch(() => {});
    Animated.spring(pop, {
      toValue: 1, useNativeDriver: true, friction: 6, tension: 70,
    }).start();
  }, [pop]);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={props.onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(15,23,30,0.72)',
        alignItems: 'center', justifyContent: 'center', padding: 24 }}>

        {/* BEHIND the card, so the card never fights the confetti for legibility. */}
        {!reduce && (
          <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
            <Burst x={70}  y={150} delay={120} size={90} />
            <Burst x={290} y={220} delay={480} size={110} />
            <Burst x={170} y={560} delay={820} size={80} />
            <Star x={40}  y={230} delay={0}   size={22} />
            <Star x={320} y={140} delay={300} size={18} />
            <Star x={60}  y={620} delay={600} size={20} />
            <Star x={300} y={640} delay={150} size={16} />
          </View>
        )}

        <Animated.View style={{
          width: '100%', maxWidth: 400, backgroundColor: C.card, borderRadius: 22,
          paddingVertical: 26, paddingHorizontal: 22,
          transform: [
            { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }) },
          ],
          opacity: pop,
        }}>
          <Text style={{ fontSize: 52, textAlign: 'center' }}>🎉</Text>
          <Text style={{ fontFamily: F.disp, fontSize: 30, color: C.approve,
            textAlign: 'center', letterSpacing: 1.5, marginTop: 4 }}>
            {t('cel.title')}
          </Text>

          {/* WHICH JOB. Without it, a contractor running four jobs has been told
              something wonderful happened somewhere. */}
          {!!props.projectName && (
            <Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: C.muted,
              textAlign: 'center', marginTop: 10, letterSpacing: 0.3 }}>
              {props.projectName.toUpperCase()}
            </Text>
          )}

          {/* THE DESCRIPTION — hadar asked for it by name, and it is the signed body
              rather than the ledger's short title. Scrolls rather than truncates: this is
              the text a client just committed money to, and cutting it off with an
              ellipsis at the moment of celebration is the wrong place to save space. */}
          <ScrollView style={{ maxHeight: 132, marginTop: 12 }}
            contentContainerStyle={{ paddingVertical: 2 }}>
            <Text style={{ fontFamily: F.body, fontSize: 17, color: C.ink,
              textAlign: 'center', lineHeight: 24 }}>
              {props.description}
            </Text>
          </ScrollView>

          {/* Who signed and for how much. Built by the caller — see `celebrationLine`
              for why a null price never becomes "$0.00" here. */}
          <Text style={{ fontFamily: F.dispSemi, fontSize: 19, color: C.ink,
            textAlign: 'center', marginTop: 12 }}>
            {props.detail}
          </Text>

          {props.more > 0 && (
            <Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: C.caution,
              textAlign: 'center', marginTop: 14 }}>
              {t({ k: props.more === 1 ? 'cel.moreOne' : 'cel.moreN',
                   p: { n: String(props.more) } } as any)}
            </Text>
          )}

          <Pressable onPress={props.onOpen}
            style={({ pressed }) => [{
              marginTop: 22, minHeight: 52, borderRadius: 12, backgroundColor: C.approve,
              alignItems: 'center', justifyContent: 'center' },
              pressed && { opacity: 0.85 }]}>
            <Text style={{ fontFamily: F.dispSemi, fontSize: 16, color: '#fff',
              letterSpacing: 0.5 }}>
              {t('cel.view')}
            </Text>
          </Pressable>
          <Pressable onPress={props.onClose}
            style={{ marginTop: 8, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 15, color: C.steel }}>
              {t('cel.dismiss')}
            </Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}
