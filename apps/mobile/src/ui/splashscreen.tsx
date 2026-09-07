/**
 * The opening screen (hadar mockup, 2026-07-27).
 *
 * WHAT THIS REPLACES: `<View><Text>EZChangeOrders</Text></View>` — a cream screen with
 * the product name in the top-left corner, shown for as long as the database takes to
 * open and the fonts take to load. It read as an unfinished screen, because it was one.
 *
 * TWO SCREENS, ONE OF THEM BLANK. iOS draws the native launch storyboard first
 * (before any JS exists), then this. The storyboard —
 * `ios/EZjobsite/SplashScreen.storyboard` — is DELIBERATELY JUST CREAM, NO IMAGE: it
 * drew the artwork once, rendered it top-left at native pixel size, and iOS cached the
 * stale launch snapshot so edits appeared to do nothing. Its own header tells that
 * story.
 *
 * SO THIS FILE IS THE ONLY THING THAT DRAWS THE ARTWORK, and that has a consequence
 * worth stating (hadar, 2026-08-26: "is a new build required? because it is not part
 * of the OTA"): the splash IS part of the OTA. Nothing native has to be rebuilt to
 * change it. Replace `assets/splash-screen.png`, publish an update, done.
 *
 * The cream underneath is the same cream on both sides of the handover, so the artwork
 * fades in a beat after launch rather than being the literal first frame — an even
 * trade for a launch screen that cannot misrender.
 *
 * CONTAIN, not cover (hadar, 2026-07-27: "it removed the wrong image ... flip it").
 * The artwork is a whole COMPOSITION — framed wordmark, centred hat, blueprint — with
 * its own generous cream margins. `cover` scaled it up until it filled the screen and
 * cropped the overflow, which on a tall phone blew the wordmark up and cut the sides
 * off. `contain` fits the entire image; the letterbox is cream on a cream screen, so
 * it is invisible. The storyboard's matching mode is scaleAspectFit.
 *
 * STATIC, on purpose (hadar, 2026-07-27). An animated version existed briefly — dots
 * chasing around the hat, a breathing ring — and was removed. If it comes back, note
 * that the artwork's circle sits at (0.4953, 0.5837) of the image with a radius of
 * 0.2065 of its width, measured from the file; anything drawn over it has to reproduce
 * resizeMode="cover"'s scaling to land on the circle rather than near it.
 *
 * NO TEXT, DELIBERATELY. This renders while `fontsLoaded` is still false, so anything
 * typeset here would flash in a fallback face and then snap to Barlow. The wordmark is
 * part of the artwork for exactly that reason.
 */
import React from 'react';
import { Animated, Image, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { C } from './theme';
import { t } from '../i18n';

/**
 * THE ONE EXCEPTION TO "NO TEXT" (hadar, 2026-09-07: "display a progress bar and
 * notification letting them know the app is currently being updated"). The no-text
 * rule exists because custom fonts are not loaded yet — so this line deliberately
 * uses the SYSTEM face and never switches: no flash, no snap. An update banner that
 * says nothing is exactly the silent wait it exists to replace.
 */
function UpdateNote({ phase }: { phase: 'checking' | 'updating' }) {
  const x = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(x, { toValue: 1, duration: 900, useNativeDriver: true }),
      Animated.timing(x, { toValue: 0, duration: 900, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [x]);
  const slide = x.interpolate({ inputRange: [0, 1], outputRange: [-60, 160] });
  return (
    <View style={st.note} accessibilityRole="progressbar"
      accessibilityLabel={t(phase === 'updating' ? 'ota.updating' : 'ota.checking')}>
      <Text style={st.noteT}>
        {t(phase === 'updating' ? 'ota.updating' : 'ota.checking')}
      </Text>
      <View style={st.track}>
        <Animated.View style={[st.fill, { transform: [{ translateX: slide }] }]} />
      </View>
      {phase === 'updating' && <Text style={st.noteSub}>{t('ota.updatingSub')}</Text>}
    </View>
  );
}

export function SplashScreen({ ota }: { ota?: 'checking' | 'updating' | null } = {}) {
  // Explicit width/height from the window, not StyleSheet.absoluteFill: a concrete
  // frame is the one thing that guarantees resizeMode has bounds to fit WITHIN. It
  // removes any question of the Image falling back to the source's intrinsic pixel
  // size — which is precisely the top-left-anchored native-size render we chased.
  const { width, height } = useWindowDimensions();
  return (
    <View style={st.screen}>
      <Image source={require('../../assets/splash-screen.png')}
        style={{ width, height }} resizeMode="contain" />
      {!!ota && <UpdateNote phase={ota} />}
    </View>
  );
}

const st = StyleSheet.create({
  // Centred, and cream — the cream is what shows for the frame before the asset
  // decodes and in the contain letterbox, and it is the native storyboard's colour
  // too, so the native→JS handover is seamless.
  screen: { flex: 1, backgroundColor: C.paper, alignItems: 'center', justifyContent: 'center' },
  // Pinned low so it never sits over the artwork's composition. System font — see
  // UpdateNote's header.
  note: { position: 'absolute', bottom: 76, left: 40, right: 40, alignItems: 'center' },
  noteT: { fontSize: 15, fontWeight: '600', color: '#555B57' },
  noteSub: { fontSize: 12.5, color: '#777C78', marginTop: 8 },
  track: {
    marginTop: 10, width: 160, height: 4, borderRadius: 2,
    backgroundColor: '#E3DDD1', overflow: 'hidden',
  },
  fill: { width: 60, height: 4, borderRadius: 2, backgroundColor: '#506A45' },
});
