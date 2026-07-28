/**
 * The opening screen (hadar mockup, 2026-07-27).
 *
 * WHAT THIS REPLACES: `<View><Text>EZchangeorder</Text></View>` — a cream screen with
 * the product name in the top-left corner, shown for as long as the database takes to
 * open and the fonts take to load. It read as an unfinished screen, because it was one.
 *
 * TWO SCREENS, ONE PICTURE. iOS draws the native launch storyboard first (before any
 * JS exists), then this. Both draw `assets/splash-screen.png` the same way, so the
 * handover is invisible — the artwork does not move at all. The storyboard is
 * `ios/EZjobsite/SplashScreen.storyboard`; if you change one, change the other, or the
 * app will visibly jump at launch.
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
import { Image, StyleSheet, View, useWindowDimensions } from 'react-native';
import { C } from './theme';

export function SplashScreen() {
  // Explicit width/height from the window, not StyleSheet.absoluteFill: a concrete
  // frame is the one thing that guarantees resizeMode has bounds to fit WITHIN. It
  // removes any question of the Image falling back to the source's intrinsic pixel
  // size — which is precisely the top-left-anchored native-size render we chased.
  const { width, height } = useWindowDimensions();
  return (
    <View style={st.screen}>
      <Image source={require('../../assets/splash-screen.png')}
        style={{ width, height }} resizeMode="contain" />
    </View>
  );
}

const st = StyleSheet.create({
  // Centred, and cream — the cream is what shows for the frame before the asset
  // decodes and in the contain letterbox, and it is the native storyboard's colour
  // too, so the native→JS handover is seamless.
  screen: { flex: 1, backgroundColor: C.paper, alignItems: 'center', justifyContent: 'center' },
});
