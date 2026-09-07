/**
 * First open — the four-page landing a newcomer sees before any account exists.
 *
 * hadar's designs, 2026-08-12. It replaced four centred emoji-and-paragraph slides on a
 * white page. That version was an explainer; this one is a PITCH, and the difference is
 * not decoration:
 *
 *   * IT LEADS WITH THE FEAR, NOT THE FEATURE. "Get the yes before you do the extra
 *     work" is the contractor's actual problem in his own words. "Capture it in the
 *     moment" — the old first slide — describes a mechanism to a man who has not yet
 *     been told why he should care.
 *   * IT SHOWS HIM THE APP. Pages 2-4 each carry a real screen: the recorder, the draft
 *     it becomes, the approval his client signs. The ICP is explicitly someone for whom
 *     software is not second nature (CLAUDE.md §1) — he decides from a picture of the
 *     thing working, not from a paragraph promising it will.
 *   * THE THREE PAGES ARE THE THREE STEPS, in order, and they are the product: record
 *     on site → we turn it into a change order → get the yes before you do the work.
 *
 * ─── ONE GROUND (2026-08-26) ────────────────────────────────────────────────────
 * The cover used to be dark over a full-bleed photograph, on the argument that a cover
 * has to stop someone. It is cream now, because hadar's App Store artwork is — and the
 * artwork is the stronger argument: the same photograph reads as a jobsite rather than a
 * mood when it is not sitting under an 80% scrim, and the headline gets to be ink at
 * poster size instead of white at 38pt. It also ends the seam. Pages 2-4 were already
 * cream, and the two grounds meant the first swipe changed the whole world.
 *
 * Gold survives as the accent — the rule under the headline — but it is no longer the
 * primary: on cream the ink button is the loudest thing that can be pressed, and it is.
 *
 * ─── ASSETS ─────────────────────────────────────────────────────────────────────
 * `assets/onboard/*` are all cut from hadar's drops:
 *   * the nine step icons are circular crops with alpha, taken from `onboarding-Icons.png`
 *     (the second sheet, which carries the GOLD accents the first strips lacked — the
 *     sparkle's star, the plane, the chat bubble, the approve disc). Circles rather than
 *     squares because the source sits on black and a square shows its corners on cream.
 *   * the three cover icons are the same sheet's gold line art, recoloured flat with
 *     alpha from luminance. Flat-with-alpha is what lets the cover tint them WHITE for
 *     the forest discs it draws them in now; the gold is still what pages 2-4 use.
 *   * `onboard/coverHero.jpg` is the cover photograph, cut out of the App Store artwork
 *     itself (`assets/appstore/…_852x1846.png`) rather than shot separately, so the man
 *     and the framing are the ones hadar signed off. See the note in that folder's
 *     README: the file it came from is a downscaled copy, so this cut is roughly 2x and
 *     wants re-cutting from the 1290x2796 export when that lands.
 *   * the three phone mockups are border-flood-keyed off white, so the screenshots' own
 *     white areas survive the key.
 * `assets/onboard-hero.png` (2.1MB) was orphaned by this redesign and is DELETED with
 * it (code review 2026-09-07) — the cover photograph is `onboard/coverHero.jpg` above.
 */
import React from 'react';
import {
  Dimensions, Image, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { Icon } from './icon';
import { t as T } from '../i18n';

const { width, height } = Dimensions.get('window');

/**
 * THE ARTWORK'S RULER.
 *
 * hadar's cover file is 852pt wide (`assets/appstore/EZChangeOrder_DontDoExtraWork_B`).
 * Every measurement on page 1 is taken off that file and passed through here, so the
 * composition holds its proportions on a 375pt SE and a 430pt Max instead of being tuned
 * for one device and drifting on the rest. Read `A(100)` as "100 artwork points".
 */
const A = (n: number) => Math.round((n * width) / 852 * 10) / 10;

/** Bright gold — the cover only, where it sits on near-black. */
const GOLD = '#EDB93F';
/** The cream pages' accent. The bright gold goes muddy beside black type on cream;
 *  this is the same hue carried down until it holds its own against the headline. */
const OCHRE = '#C08A2B';
const INK = '#0C0D0D';
/** The artwork's forest green — the logo tile, the promise discs, the wordmark. */
const FOREST = '#1A4A2F';
const CREAM = '#F7F5F0';

/**
 * THE MOCKUP'S WIDTH (hadar, 2026-08-12: "the slides are misaligned").
 *
 * It was `width: '100%'` with `resizeMode="cover"`, so the phone was drawn 375pt wide,
 * bleeding to both edges — where the design insets it to roughly 71% of the screen with
 * clear margins either side. Measured off the sheet: the mockup spans ~300px inside a
 * ~420px phone frame. `cover` made it worse by scaling to FILL a 375-wide box, blowing
 * the device up to 696pt tall so the window showed only its top half.
 */
const PHONE_W = Math.round(width * 0.65);

/** A headline line and whether it is the accented one. Written as lines rather than
 *  wrapped, so the colour break lands on the phrase the design chose and not wherever
 *  the box happens to run out. */
type Line = { k: string; gold?: boolean };

type Slide = {
  head: Line[];
  body: string;
  /** The three glyphs under the body, with their captions. */
  steps: { src: any; label: string }[];
  /** Slide 2 draws arrows between the steps — it is a PIPELINE, not a list. */
  arrows?: boolean;
  phone: any;
  /** width/height of the mockup FILE. The three are not the same shape (their source
   *  crops differed), so a single ratio would squash one of them. */
  phoneAspect: number;
};

const SLIDES: Slide[] = [
  {
    head: [{ k: 'ob.s1h1' }, { k: 'ob.s1h2', gold: true }],
    body: 'ob.s1b',
    steps: [
      { src: require('../../assets/onboard/obPhotos.png'), label: 'ob.s1a' },
      { src: require('../../assets/onboard/obVoice.png'), label: 'ob.s1b2' },
      { src: require('../../assets/onboard/obLocation.png'), label: 'ob.s1c' },
    ],
    phone: require('../../assets/onboard/phone1.png'),
    phoneAspect: 760 / 1410,
  },
  {
    head: [{ k: 'ob.s2h1' }, { k: 'ob.s2h2', gold: true }, { k: 'ob.s2h3', gold: true }],
    body: 'ob.s2b',
    arrows: true,
    steps: [
      { src: require('../../assets/onboard/obRecord.png'), label: 'ob.s2a' },
      { src: require('../../assets/onboard/obBuild.png'), label: 'ob.s2b2' },
      { src: require('../../assets/onboard/obDocument.png'), label: 'ob.s2c' },
    ],
    phone: require('../../assets/onboard/phone2.png'),
    phoneAspect: 760 / 1563,
  },
  {
    head: [{ k: 'ob.s3h1' }, { k: 'ob.s3h2', gold: true }],
    body: 'ob.s3b',
    steps: [
      { src: require('../../assets/onboard/obSend.png'), label: 'ob.s3a' },
      { src: require('../../assets/onboard/obDiscuss.png'), label: 'ob.s3b2' },
      { src: require('../../assets/onboard/obApprove.png'), label: 'ob.s3c' },
    ],
    phone: require('../../assets/onboard/phone3.png'),
    phoneAspect: 760 / 1415,
  },
];

const PAGES = 1 + SLIDES.length;

/**
 * The cover's three promises. ART, not the kit's stroke glyphs (2026-08-12) — hadar's
 * icon sheet carries gold-drawn versions of exactly these three, and the drawn shield
 * has a check inside it that the kit's plain shield does not. The kit stays the right
 * answer for chrome that changes colour with state; this is a fixed marketing lockup,
 * so it uses the drawn art it was designed with.
 */
const COVER_PROMISES: { src: any; title: string; body: string }[] = [
  { src: require('../../assets/onboard/obShield.png'), title: 'ob.p1t', body: 'ob.p1b' },
  { src: require('../../assets/onboard/obClock.png'), title: 'ob.p2t', body: 'ob.p2b' },
  { src: require('../../assets/onboard/obDoc.png'), title: 'ob.p3t', body: 'ob.p3b' },
];

/**
 * The wordmark, as the artwork draws it: the app's own mark, white, in a forest tile.
 *
 * `android-icon-monochrome.png` is the white cut that already ships for the Android
 * adaptive icon — the same artwork as the store listing's tile, so this is the real mark
 * rather than a drawing of one. It replaces the hand-built speech bubble, which predates
 * the current logo and was the only place in the app still using it.
 *
 * ONE TREATMENT ON ALL FOUR PAGES. The old mark had a light and a dark variant because
 * the cover was dark; every page is cream now, so a variant would be a switch with one
 * position.
 */
function Wordmark() {
  return (
    <View style={st.mark}>
      <View style={st.markTile}>
        <Image source={require('../../assets/android-icon-monochrome.png')}
          style={st.markGlyph} resizeMode="contain" />
      </View>
      <Text style={st.markT}>EZChangeOrders</Text>
    </View>
  );
}

export function Onboarding({ onDone }: { onDone: (intent?: 'signup' | 'login') => void }) {
  const ref = React.useRef<ScrollView>(null);
  const [i, setI] = React.useState(0);
  const go = (n: number) => {
    ref.current?.scrollTo({ x: width * n, animated: true });
    setI(n);
  };
  // DEV ONLY — drive the pager from the Metro inspector, so reviewing all four pages
  // costs the user nothing. Paired with App.tsx's `__shot()`: jump, capture, repeat.
  React.useEffect(() => {
    if (__DEV__) (globalThis as any).__introPage = (n: number) => go(n);
  }, []);

  return (
    <View style={st.c}>
      {/* THE PHOTOGRAPH BELONGS TO PAGE 1 NOW, not to the root.

          It used to be the root background with the cream pages painted over it, because
          the cover was dark and full-bleed: a page-sized image inside the pager slides
          with the finger, and a backdrop that tracks the swipe reads as a bug. The cover
          is cream too since the 2026-08-26 artwork, and the photograph is no longer a
          backdrop — it is one element in the top-right corner of the first page. So it
          SHOULD travel with that page, and living inside it is what makes it do that. */}

      <ScrollView
        ref={ref}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setI(Math.round(e.nativeEvent.contentOffset.x / width))}
      >
        {/* ── PAGE 1 — the cover ──
             hadar's App Store artwork, 2026-08-26
             (`assets/appstore/EZChangeOrder_DontDoExtraWork_B_852x1846.png`), built as a
             screen rather than pasted in as one: the file is 852x1846, near enough a
             phone at 390pt, so the composition reproduces at 1:1 and only needs the
             controls a first-open page has to carry and a poster does not.

             THE TEXT STAYS TEXT. Shipping the artwork as an image would have been a
             two-line change and it would have broken Spanish outright — every word here
             is already an i18n key, and `ob.lede` and the three promises are the
             artwork's own copy, verbatim. Only the headline was rewritten, and it fits
             `ob.h1`..`ob.h4` one line per key. */}
        <ScrollView style={{ width }} contentContainerStyle={st.cover}
          showsVerticalScrollIndicator={false}>
          {/* The photograph, cut from the artwork, bleeding off the top and right. The
              two gradients are what let the headline cross it: one fading it into the
              cream on the LEFT where the type sits, one on the BOTTOM so it hands over
              to the page rather than stopping on an edge. SVG for the same reason the
              old scrim used it — react-native-svg is already here and
              expo-linear-gradient is not. */}
          <View style={st.coverArt} pointerEvents="none">
            <Image source={require('../../assets/onboard/coverHero.jpg')}
              style={st.coverPhoto} resizeMode="cover" />
            <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
              <Defs>
                <LinearGradient id="fadeL" x1="1" y1="0" x2="0" y2="0">
                  <Stop offset="0" stopColor={CREAM} stopOpacity="0" />
                  <Stop offset="0.76" stopColor={CREAM} stopOpacity="0" />
                  <Stop offset="0.91" stopColor={CREAM} stopOpacity="0.6" />
                  <Stop offset="1" stopColor={CREAM} stopOpacity="0.96" />
                </LinearGradient>
                <LinearGradient id="fadeD" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={CREAM} stopOpacity="0" />
                  <Stop offset="0.70" stopColor={CREAM} stopOpacity="0" />
                  <Stop offset="0.88" stopColor={CREAM} stopOpacity="0.86" />
                  <Stop offset="1" stopColor={CREAM} stopOpacity="1" />
                </LinearGradient>
              </Defs>
              <Rect x="0" y="0" width="100%" height="100%" fill="url(#fadeL)" />
              <Rect x="0" y="0" width="100%" height="100%" fill="url(#fadeD)" />
            </Svg>
          </View>

          {/* The device mockup — `onboard/phone1.png`, the same file page 2 uses. It is
              the artwork's own phone, so nothing here is a redraw of a screen. */}
          <Image source={require('../../assets/onboard/phone1.png')}
            style={st.coverPhone} resizeMode="contain" />

          {/* THE GUTTER LIVES HERE, NOT ON THE SCROLL CONTAINER.

              Whether an absolutely-positioned child is offset by its parent's padding is
              exactly the kind of thing that differs between Yoga versions, and the
              photograph and the device both depend on `right: 0` and `left:` meaning the
              SCREEN edge. Padding the flowing content instead makes that unambiguous:
              the two absolute elements measure against the full width, and nothing about
              the bleed rests on a layout detail that could change under us. */}
          <View style={st.coverBody}>
          <Wordmark />

          <View style={st.headWrap}>
            <Text style={st.coverHead}>{T('ob.h1')}</Text>
            <Text style={st.coverHead}>{T('ob.h2')}</Text>
            <Text style={st.coverHead}>{T('ob.h3')}</Text>
            <Text style={st.coverHead}>{T('ob.h4')}</Text>
          </View>
          <View style={[st.rule, { backgroundColor: GOLD }]} />
          <Text style={st.coverLede}>{T('ob.lede')}</Text>

          {/* THE TWO LANGUAGES THE APP ACTUALLY SHIPS (hadar, 2026-08-26). The later
              artwork carries seven flags; `Lang` is 'en' | 'es' and `DICT` has two
              dictionaries, so five of those would be a promise broken on the next
              screen. Words rather than flags because a flag is a country. */}
          <View style={st.langRow}>
            <View style={st.langChip}><Text style={st.langT}>English</Text></View>
            <View style={st.langChip}><Text style={st.langT}>Español</Text></View>
          </View>

          <View style={st.promises}>
            {COVER_PROMISES.map((p, n) => (
              <View key={p.title} style={[st.promise, n > 0 && st.promiseRule]}>
                <View style={st.promiseDisc}>
                  <Image source={p.src} style={st.promiseIcon} resizeMode="contain"
                    tintColor="#FFFFFF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={st.promiseT}>{T(p.title)}</Text>
                  <Text style={st.promiseB}>{T(p.body)}</Text>
                </View>
              </View>
            ))}
          </View>

          <View style={st.captureChip}>
            <Icon name="approved" size={17} color={FOREST} />
            <View style={{ flex: 1 }}>
              <Text style={st.captureT}>{T('ob.captureH')}</Text>
              <Text style={st.captureB}>{T('ob.captureB')}</Text>
            </View>
          </View>

          <View style={st.coverFoot}>
            <Pressable style={st.cta} accessibilityRole="button" onPress={() => onDone('signup')}>
              <Text style={st.ctaT}>{T('ob.start')}</Text>
              {/* The arrow is on the design's button and it earns its place: it says
                  FORWARD, which is the one thing a first-time user needs to know about
                  the only control on the screen. */}
              <Text style={st.ctaArrow}>→</Text>
            </Pressable>
            {/* TWO DIFFERENT DESTINATIONS, not two labels for one. A returning user who
                taps "Log in" and lands on a sign-up form has been told the app forgot
                him. `intent` is what keeps them apart. */}
            <Pressable style={st.login} accessibilityRole="button" onPress={() => onDone('login')}>
              <Text style={st.loginT}>
                {T('ob.haveAccount')} <Text style={st.loginLink}>{T('ob.login')}</Text>
              </Text>
            </Pressable>
          </View>
          </View>

          {/* The ridge and treeline the artwork closes on. Drawn, not imported: it is
              flat shapes, and an image would be one more file to keep in step with the
              page's cream. */}
          <Svg width={width} height={92} style={st.ridge}>
            <Path d={`M0 56 L${width * 0.12} 25 L${width * 0.22} 54 L${width * 0.31} 17
                      L${width * 0.45} 58 L${width * 0.54} 35 L${width * 0.67} 64
                      L${width * 0.79} 29 L${width * 0.90} 58 L${width} 38 L${width} 92 L0 92 Z`}
              fill="#E0DACE" />
            <Path d={`M0 72 L${width * 0.10} 50 L${width * 0.19} 70 L${width * 0.30} 44
                      L${width * 0.42} 72 L${width * 0.54} 52 L${width * 0.66} 76
                      L${width * 0.78} 50 L${width * 0.89} 74 L${width} 56 L${width} 92 L0 92 Z`}
              fill="#D2CBBC" />
          </Svg>
        </ScrollView>

        {/* ── PAGES 2-4 — the three steps, on the app's own cream ── */}
        {SLIDES.map((sl) => (
          <View key={sl.body} style={[st.page, { width }]}>
            <ScrollView contentContainerStyle={st.pageBody} showsVerticalScrollIndicator={false}>
              <Wordmark />
              <View style={st.headWrap}>
                {sl.head.map((ln) => (
                  <Text key={ln.k} style={[st.pageHead, ln.gold && { color: OCHRE }]}>
                    {T(ln.k)}
                  </Text>
                ))}
              </View>
              <Text style={st.pageLede}>{T(sl.body)}</Text>

              <View style={st.steps}>
                {sl.steps.map((s, n) => (
                  <React.Fragment key={s.label}>
                    {sl.arrows && n > 0 && <Text style={st.arrow}>→</Text>}
                    <View style={st.step}>
                      {/* THE CIRCLE IS DRAWN, NOT PART OF THE ART. The sliced icons
                          used to carry their own disc — the same cream as the page — so
                          on a cream slide the circle simply disappeared. The glyphs are
                          keyed to transparent now and this View is the disc, in a colour
                          the app controls. */}
                      <View style={st.stepDisc}>
                        <Image source={s.src} style={st.stepGlyph} resizeMode="contain" />
                      </View>
                      <Text style={st.stepT}>{T(s.label)}</Text>
                    </View>
                  </React.Fragment>
                ))}
              </View>

              {/* Anchored to the TOP and allowed to run off the bottom of the screen, as
                  drawn: the phone is a glimpse of the app, not a spec sheet, and showing
                  the whole device would shrink the screen inside it to nothing. */}
              <View style={st.phoneWrap}>
                {/* EXPLICIT WIDTH AND HEIGHT, not width + aspectRatio.
                    The aspectRatio version rendered the device at the full content
                    width and hugely magnified — the box ended up 311pt wide (the
                    container's width) instead of the 244 the style asked for, and with
                    `contain` filling that box the phone blew up until only its notch
                    and title fit the window. Two numbers, both computed, nothing left
                    for the layout to derive. */}
                <Image source={sl.phone} resizeMode="contain"
                  style={{ width: PHONE_W, height: Math.round(PHONE_W / sl.phoneAspect) }} />
              </View>
            </ScrollView>
          </View>
        ))}
      </ScrollView>

      {/* ── ONE BAR FOR ALL FOUR PAGES ──
          It sits OVER the pager so it does not slide with a page, and it is the ONLY
          place dots are drawn. Giving the cream pages their own footer would mean two
          dot rails that have to be kept in step — and the one that drifts is the one
          nobody notices. On the cover it is dots alone (its own Get started sits in the
          page); on the steps it grows Back and Next around them. */}
      <View style={[st.bar, i > 0 && st.barCream]}>
        {i > 0 ? (
          <Pressable onPress={() => go(i - 1)} hitSlop={12} accessibilityRole="button">
            <Text style={st.back}>{T('ob.back')}</Text>
          </Pressable>
        ) : <View style={st.barSpacer} />}

        {/* ABSOLUTELY CENTRED, so the labels either side can size themselves.
            They used to be pinned to 64pt each to keep the dots in the middle — and the
            last page's "Get started" is two words, so it wrapped. The dots own the
            centre of the bar outright now and nothing has to be measured against them. */}
        <View style={st.dotsWrap} pointerEvents="none">
          <View style={st.dots}>
            {Array.from({ length: PAGES }, (_, d) => (
              <View key={d} style={[
                st.dot,
                // One treatment for all four: the cover is cream now, and the white
                // dots it used to need were invisible the moment it stopped being dark.
                { backgroundColor: 'rgba(19,17,16,0.18)' },
                d === i && { backgroundColor: OCHRE },
              ]} />
            ))}
          </View>
        </View>

        {i > 0 ? (
          <Pressable
            onPress={() => (i === PAGES - 1 ? onDone('signup') : go(i + 1))}
            hitSlop={12} accessibilityRole="button">
            <Text style={st.next} numberOfLines={1}>
              {T(i === PAGES - 1 ? 'ob.start' : 'ob.next')}
            </Text>
          </Pressable>
        ) : <View style={st.barSpacer} />}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  c: { flex: 1, backgroundColor: CREAM },

  /**
   * THE COVER'S GEOMETRY, SCALED OFF THE ARTWORK.
   *
   * The file is 852 wide, the screen is `width`, so every number below is the artwork's
   * own measurement times `A`. That is the whole reason the page looks like the poster
   * rather than like an interpretation of it: the left column, the photograph and the
   * device all land where hadar put them, at any screen size.
   *
   * `paddingBottom` is NOT for the bar — the ridge is drawn inside the page and carries
   * the last 92pt itself. It clears the home indicator only.
   */
  cover: { paddingTop: A(96), paddingBottom: 8, minHeight: height },
  coverBody: { paddingHorizontal: A(50) },
  // Top-right, bleeding off both edges, exactly as the artwork crops it.
  coverArt: { position: 'absolute', top: 0, right: 0, width: A(382), height: A(830) },
  coverPhoto: { width: '100%', height: '100%' },
  /**
   * The device sits OVER the photograph and beside the left column — the artwork's one
   * piece of overlap, and what stops the page reading as two stacked halves.
   *
   * `left`, not `right`: the column's width is what it must clear, and pinning it to the
   * left edge of its own gap keeps that relationship on a narrow screen instead of
   * letting the two slide into each other.
   */
  coverPhone: { position: 'absolute', left: A(378), top: A(780),
    width: A(434), height: A(434) / (760 / 1410) },
  page: { backgroundColor: CREAM },
  pageBody: { paddingHorizontal: 32, paddingTop: 62, paddingBottom: 76 },

  // ── wordmark ──
  mark: { flexDirection: 'row', alignItems: 'center', gap: A(24), marginBottom: A(66) },
  markTile: { width: A(76), height: A(76), borderRadius: A(20), backgroundColor: FOREST,
    alignItems: 'center', justifyContent: 'center' },
  markGlyph: { width: A(54), height: A(54) },
  markT: { fontFamily: 'Oswald_700Bold', fontSize: A(54), color: FOREST, letterSpacing: -0.3 },

  // ── headlines ──
  headWrap: { marginBottom: 4 },
  // Ink, not white, and it runs across the photograph — the left fade is what carries
  // it. maxWidth is the artwork's column: the break after "EXTRA WORK" is a design
  // decision, not wherever the box happens to run out.
  coverHead: { fontFamily: 'Oswald_700Bold', fontSize: A(100), lineHeight: A(98),
    color: INK, textTransform: 'uppercase', letterSpacing: -0.6, maxWidth: A(430) },
  pageHead: { fontFamily: 'Oswald_700Bold', fontSize: 38, lineHeight: 43, color: '#131110',
    textTransform: 'uppercase', letterSpacing: -0.2 },
  rule: { width: A(135), height: A(9), borderRadius: 2, marginTop: A(48), marginBottom: A(36) },
  // maxWidth is what makes it break where the design breaks it — three short lines
  // clear of the subject, not two that run across his chest.
  // maxWidth 155 is what breaks it into the design's THREE short lines, clear of the
  // subject — at any wider it runs across his chest as two.
  coverLede: { fontFamily: 'Inter_400Regular', fontSize: A(35), lineHeight: A(50),
    color: '#3D3733', maxWidth: A(300) },
  // maxWidth 186 is measured, and it is what produces the design's line breaks:
  // "Snap photos and say what / changed. No forms. / No typing on the jobsite."
  pageLede: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 23,
    color: '#3B3733', marginBottom: 22 },

  // ── the two languages ──
  langRow: { flexDirection: 'row', gap: A(14), marginTop: A(44) },
  langChip: { borderWidth: 1, borderColor: '#D8D1C4', backgroundColor: '#FFFDF8',
    borderRadius: A(14), paddingHorizontal: A(22), paddingVertical: A(11) },
  langT: { fontFamily: 'Inter_600SemiBold', fontSize: A(26), color: '#3D3733' },

  // ── the three glyphs ──
  steps: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center',
    marginBottom: 16 },
  step: { alignItems: 'center', width: 85 },
  stepDisc: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#EFE7D9',
    alignItems: 'center', justifyContent: 'center' },
  stepGlyph: { width: 30, height: 30 },
  stepT: { fontFamily: 'Inter_400Regular', fontSize: 12, color: '#3B3733', marginTop: 10,
    textAlign: 'center' },
  // Vertically centred on the DISC, not on the whole item — the captions sit below and
  // an arrow aligned to the block would float under the circles.
  arrow: { fontSize: 16, color: '#8A827A', marginTop: 20 },

  // ── the phone ──
  // FIXED WINDOW, TOP-ALIGNED. The window height is constant so the page does not jump
  // between slides; the image draws at its true aspect and the window clips the BOTTOM
  // of the device, which is the crop the design uses. `contain`, not `cover`: with an
  // explicit width and aspect there is nothing left to fill, and `cover` would only
  // reintroduce the scaling that caused this.
  phoneWrap: { height: 342, overflow: 'hidden', alignItems: 'center',
    justifyContent: 'flex-start' },

  // ── the cover's promises ──
  // A NARROW COLUMN, RULED. The artwork stops this list well short of the device and
  // divides the three with hairlines rather than gaps; both are what keep it from
  // colliding with the phone on a 375pt screen.
  promises: { marginTop: A(48), width: A(300) },
  promise: { flexDirection: 'row', alignItems: 'flex-start', gap: A(18),
    paddingVertical: A(20) },
  promiseRule: { borderTopWidth: 1, borderTopColor: '#DFD9CF' },
  // A FILLED FOREST PUCK, not the old gold ring: on cream a ring reads as an empty
  // shape, and the artwork's discs are the one solid mark down the left column.
  promiseDisc: { width: A(62), height: A(62), borderRadius: A(31), backgroundColor: FOREST,
    alignItems: 'center', justifyContent: 'center' },
  promiseIcon: { width: A(32), height: A(32) },
  promiseT: { fontFamily: 'Inter_700Bold', fontSize: A(27), color: FOREST,
    textTransform: 'uppercase', letterSpacing: 0.4 },
  promiseB: { fontFamily: 'Inter_400Regular', fontSize: A(25), lineHeight: A(33),
    color: '#3D3733', marginTop: 2 },

  // ── "Capture it on site." ──
  captureChip: { flexDirection: 'row', alignItems: 'flex-start', gap: A(20),
    backgroundColor: '#EFE9DF', borderRadius: A(22), padding: A(26),
    marginTop: A(40), width: A(300) },
  captureT: { fontFamily: 'Inter_700Bold', fontSize: A(29), color: FOREST },
  captureB: { fontFamily: 'Inter_400Regular', fontSize: A(28), color: '#3D3733', marginTop: 1 },

  // ── the ask ──
  coverFoot: { marginTop: A(56) },
  // INK, NOT GOLD. On the dark cover gold was the only thing bright enough to be the
  // one control; on cream it is the quietest fill on the page. The artwork puts nothing
  // here at all — it is a poster — so this follows the app's own primary instead.
  cta: { flexDirection: 'row', gap: 11, minHeight: 55, borderRadius: 13,
    backgroundColor: INK, alignItems: 'center', justifyContent: 'center' },
  ctaT: { fontFamily: 'Inter_700Bold', fontSize: 16.5, color: '#FFFFFF' },
  ctaArrow: { fontSize: 17, color: '#FFFFFF', marginTop: -2 },
  login: { alignItems: 'center', paddingVertical: 13 },
  loginT: { fontFamily: 'Inter_400Regular', fontSize: 14.5, color: '#3D3733' },
  loginLink: { fontFamily: 'Inter_700Bold', color: FOREST },
  // The ridge closes the page. Negative margins cancel `cover`'s gutter so it runs edge
  // to edge, and it is the last child, so it also supplies the bottom padding.
  ridge: { marginTop: A(60), marginBottom: -8 },

  // ── the one bar ──
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 58,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20 },
  barCream: { backgroundColor: CREAM },
  barSpacer: { width: 1 },
  back: { fontFamily: 'Inter_400Regular', fontSize: 17, color: '#6B625B' },
  next: { fontFamily: 'Inter_700Bold', fontSize: 17, color: OCHRE },
  dotsWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center',
    justifyContent: 'center' },
  dots: { flexDirection: 'row', gap: 9 },
  dot: { width: 9, height: 9, borderRadius: 4.5 },
});
