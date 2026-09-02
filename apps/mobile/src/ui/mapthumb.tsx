/**
 * THE LITTLE FOLDED MAP IN THE CLOSEST-LOCATION HERO (hadar's artboard, 2026-09-02).
 *
 * IT IS DRAWN, NOT PHOTOGRAPHED, and that is the whole point. The obvious way to put a
 * map beside "1151 Stanyan St" is a real map tile — and a real tile is a NETWORK CALL on
 * the screen that mandate #7 says must work with no signal at all. It would be blank in
 * exactly the crawlspace where this app earns its keep, and blank in a way that reads as
 * broken rather than offline.
 *
 * So it is a GLYPH, not data. It says "this is a place" and claims nothing about which
 * place — the address above it does that, in words, from a fix the phone already has.
 * A drawing that cannot be wrong beats a tile that can be absent.
 *
 * Vector rather than a PNG so it stays crisp at any density and costs no asset in the
 * OTA bundle.
 */
import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

export function MapThumb({ size = 76 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      {/* The folded panels. Pale, low-contrast, and deliberately NOT a legible street
          grid: the moment it looks like a real map somebody reads it as one. */}
      <Path d="M17 30 L28 25 L44 40 L41 78 L18 71 Z" fill="#E7E9E4" />
      <Path d="M29 23 L52 15 L64 19 L62 39 L45 39 Z" fill="#E2E5DF" />
      <Path d="M53 15 L64 19 L65 39 L58 40 Z" fill="#DDE1D9" />
      <Path d="M67 21 L75 24 L69 33 Z" fill="#DEE3DA" />
      <Path d="M77 26 L86 28 L87 70 L64 55 L68 34 Z" fill="#E5E8E2" />
      <Path d="M42 54 L52 52 L52 80 L36 79 Z" fill="#E1E4DD" />
      <Path d="M43 82 L64 57 L82 72 L55 83 Z" fill="#E6E9E3" />
      {/* The pale dot the artboard puts in the top-right panel — the only mark that is
          not a fold, so the shape does not read as pure geometry. */}
      <Circle cx="80" cy="33" r="4.5" fill="#DBE6D6" />
      {/* THE PIN IS THE ONLY SATURATED THING ON IT, because it is the only thing being
          asserted: a point, here. Head plus a short stem — the same drop shape the row
          icons use, so a location reads the same everywhere on this screen. */}
      <Circle cx="50" cy="39" r="15.5" fill="#2F4F2A" />
      <Rect x="48.4" y="47" width="3.2" height="9" rx="1.6" fill="#2F4F2A" />
    </Svg>
  );
}
