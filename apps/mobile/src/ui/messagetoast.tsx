/**
 * A CLIENT SAID SOMETHING WHILE YOU WERE LOOKING AT SOMETHING ELSE.
 *
 * hadar, 2026-08-18: "if the specific CO is not currently open then display a top form
 * notification (that disappears) with the message and a link to the CO so user can open
 * it and respond."
 *
 * ─── WHY AN IN-APP BANNER AT ALL, GIVEN PUSH EXISTS ─────────────────────────────
 * Because iOS suppresses its own banner when the app is in the foreground. The remote
 * push (379 + 414) covers "the app is closed"; this covers "the app is open, and he is on
 * a different screen" — which is the more common case during a working day and the one
 * where the OS deliberately shows nothing. Without it, the single event this product
 * exists to surface arrives silently.
 *
 * ─── IT NEVER APPEARS OVER THE THING IT IS ABOUT ────────────────────────────────
 * The caller suppresses it when that change order is already open: the thread on screen
 * updates in place, so a banner announcing what he is currently reading is pure noise.
 * That rule is hadar's ("if the specific CO is not currently open") and it lives at the
 * call site, where the open record id is known.
 *
 * ─── IT CARRIES THE MESSAGE, NOT THE FACT OF ONE ────────────────────────────────
 * "You have a message" makes him stop and open the app to find out whether it was "go
 * ahead" or "stop work" — on a jobsite that is the difference between carrying on and
 * downing tools. So the words are here, and the tap is for replying rather than for
 * reading.
 *
 * ─── IT LEAVES ON ITS OWN, AND THAT IS NOT A DISMISSAL ──────────────────────────
 * Auto-dismiss is safe here for one specific reason: the message is not consumed by being
 * shown. It is in the thread, the bell, and the record, all of which still say so
 * afterwards. A banner that timed out over something with no other home would be a lost
 * message, which is mandate #1's sin.
 */
import React from 'react';
import { Animated, Easing, Platform, Pressable, Text, View } from 'react-native';
import { t } from '../i18n';
import { Icon, type IconName } from './icon';
import { C, F } from './theme';

/** Long enough to read two lines and decide, short enough not to sit over the screen.
 *  Six seconds is the upper end of the usual banner range because the reader is outdoors
 *  and may be wearing gloves. */
const DWELL_MS = 6000;

export function MessageToast(props: {
  /** Who asked. Null when the roster never captured a name — the line degrades rather
   *  than inventing one. */
  from: string | null;
  /** Which change order, so he knows what it is about before he taps. */
  scope: string;
  /** What they actually said. */
  body: string;
  /** Opens the change order's thread. */
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const y = React.useRef(new Animated.Value(-1)).current;

  React.useEffect(() => {
    let gone = false;
    const leave = () => {
      if (gone) return;
      gone = true;
      Animated.timing(y, { toValue: -1, duration: 220, easing: Easing.in(Easing.quad),
        useNativeDriver: true }).start(({ finished }) => { if (finished) props.onDismiss(); });
    };
    Animated.timing(y, { toValue: 0, duration: 320, easing: Easing.out(Easing.cubic),
      useNativeDriver: true }).start();
    const tm = setTimeout(leave, DWELL_MS);
    return () => clearTimeout(tm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View pointerEvents="box-none" style={{
      position: 'absolute', top: 0, left: 0, right: 0, zIndex: 900,
      // Clear of the status bar and the notch. A banner under the clock is a banner with
      // its first line unreadable.
      paddingTop: Platform.OS === 'ios' ? 58 : 16, paddingHorizontal: 12,
    }}>
      <Animated.View style={{
        transform: [{ translateY: y.interpolate({ inputRange: [-1, 0], outputRange: [-160, 0] }) }],
        opacity: y.interpolate({ inputRange: [-1, 0], outputRange: [0, 1] }),
      }}>
        <Pressable onPress={props.onOpen} accessibilityRole="button"
          accessibilityLabel={`${props.from ?? t('client.unnamed')}: ${props.body}`}
          style={({ pressed }) => [{
            flexDirection: 'row', alignItems: 'flex-start', gap: 10,
            backgroundColor: C.ink, borderRadius: 16, padding: 14,
            // A real shadow: this floats over content and needs to read as a layer
            // above it rather than a card inside it.
            shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 14,
            shadowOffset: { width: 0, height: 6 }, elevation: 8,
          }, pressed && { opacity: 0.92 }]}>
          <View style={{ paddingTop: 1 }}>
            <Icon name={'message' as IconName} size={20} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ fontFamily: F.bodyBold, fontSize: 15, color: '#fff' }}>
              {props.from
                ? t({ k: 'toast.asked', p: { name: props.from } } as any)
                : t('toast.askedUnknown')}
            </Text>
            {/* THE MESSAGE. Two lines — enough to know whether to stop work. */}
            <Text numberOfLines={2} style={{ fontFamily: F.body, fontSize: 14.5,
              color: '#fff', lineHeight: 20, marginTop: 2 }}>
              {props.body}
            </Text>
            <Text numberOfLines={1} style={{ fontFamily: F.body, fontSize: 12.5,
              color: C.onDark, marginTop: 5 }}>
              {props.scope} · {t('toast.tapToReply')}
            </Text>
          </View>
          {/* An explicit way out, because a timed banner he wants gone NOW should not
              require waiting for it. Generous hit area — gloves. */}
          <Pressable onPress={props.onDismiss} hitSlop={14}
            accessibilityRole="button" accessibilityLabel={t('toast.dismiss')}
            style={{ padding: 2 }}>
            <Icon name={'close' as IconName} size={17} color={C.onDark} />
          </Pressable>
        </Pressable>
      </Animated.View>
    </View>
  );
}
