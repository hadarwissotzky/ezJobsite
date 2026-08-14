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
 * ─── TWO GROUNDS ON PURPOSE ─────────────────────────────────────────────────────
 * Page 1 is dark over a photograph — it is the cover, and it has to stop someone. Pages
 * 2-4 are the app's own cream, because they are showing the app and a dark chrome around
 * a light screenshot would read as a different product. The gold accent carries across
 * both, at two values: bright on the dark cover, and a deeper ochre on cream where the
 * bright one would not hold its weight against black type.
 *
 * ─── ASSETS ─────────────────────────────────────────────────────────────────────
 * `assets/onboard/*` are all cut from hadar's drops:
 *   * the nine step icons are circular crops with alpha, taken from `onboarding-Icons.png`
 *     (the second sheet, which carries the GOLD accents the first strips lacked — the
 *     sparkle's star, the plane, the chat bubble, the approve disc). Circles rather than
 *     squares because the source sits on black and a square shows its corners on cream.
 *   * the three cover icons are the same sheet's gold line art, recoloured flat with
 *     alpha from luminance: that column sits on a blurred screenshot, not clean black,
 *     so sampling colour directly would drag a grey haze onto the photograph.
 *   * the three phone mockups are border-flood-keyed off white, so the screenshots' own
 *     white areas survive the key.
 * `assets/onboard-hero.png` is the cover photograph.
 */
import React from 'react';
import {
  Dimensions, Image, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { Icon } from './icon';
import { t as T } from '../i18n';

const { width, height } = Dimensions.get('window');

/** Bright gold — the cover only, where it sits on near-black. */
const GOLD = '#EDB93F';
/** The cream pages' accent. The bright gold goes muddy beside black type on cream;
 *  this is the same hue carried down until it holds its own against the headline. */
const OCHRE = '#C08A2B';
const INK = '#0C0D0D';
const CREAM = '#F7F5F0';

/**
 * HOW MUCH OF THE SCREEN THE PHOTOGRAPH FILLS (hadar, 2026-08-12: "its size is too big
 * … he looks too zoomed in"). ONE NUMBER TO TUNE — 1 is edge-to-edge, lower pulls back.
 *
 * WHY IT IS NOT A CROP OR A resizeMode CHANGE. The file is 852x1846 and the screen is
 * 375x812 — aspect 0.4615 against 0.4618 — so `cover` already scales it 1:1 with no crop
 * at all. He is simply large IN THE FILE, and there are no pixels beyond its edges to
 * reveal. The only way to make him smaller is to draw the photograph into a smaller box
 * and let the ground show around it.
 *
 * ANCHORED TOP-RIGHT, which is the whole trick: he stands on the right and his head is
 * near the top, so anchoring there keeps him where the design puts him while the empty
 * strips fall on the LEFT and the BOTTOM — the two edges the scrim already darkens to
 * 0.88 and 0.92. The seam lands where it cannot be seen. Anchoring centre would have put
 * a visible hard edge across the top-right, which is the brightest part of the frame.
 */
const HERO_FILL = '86%';

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
 * The cover's scrim, as a real gradient rather than a flat overlay.
 *
 * A flat 60% black over a photograph dims the FACE as much as the background, which is
 * the one part worth keeping. Two gradients instead: dark from the left (where every
 * line of text sits) and dark from the bottom (under the buttons), both fading out
 * through the middle-right where the subject is. SVG because react-native-svg is already
 * a dependency and expo-linear-gradient is not — one less package for one rectangle.
 */
function Scrim() {
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
      <Defs>
        {/* THE TWO RECTS MULTIPLY (hadar, 2026-08-12: "I cannot see the image").
            I wrote these as if each were the whole scrim, then stacked them — so
            top-left was 1-(1-0.94)(1-0.45) = 0.97, i.e. effectively opaque, and the
            photograph the page is built around was invisible everywhere text sat.
            The numbers below are the COMBINED result I wanted, worked backwards:
              top-left    ~0.81  — white headline over a busy frame
              mid-right   ~0.31  — the subject, visible, which is the point
              bottom band ~0.95  — under the button, where nothing must compete */}
        {/* STOPS CHOSEN BY COMPUTING WHERE THEY LAND ON THE SUBJECT, not by eye — the
            first two passes were guesses and both left him murky. The two rects
            MULTIPLY, so what matters is the combined value at each point:

                              before   now
              his face         0.46    0.15
              his torso        0.36    0.10
              top-right wood   0.37    0.12
              headline         0.71    0.77
              lede             0.70    0.80
              under button     0.88    0.84

            The left gradient now falls off FAST between 28% and 52% of the width, which
            is the edge of the text column — everything right of it is nearly untouched,
            which is what makes him look lit rather than dimmed. The photo is naturally
            dark behind the headline (a shadowed doorway), so the text does not need the
            scrim to carry it there. */}
        <LinearGradient id="left" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={INK} stopOpacity="0.88" />
          <Stop offset="0.28" stopColor={INK} stopOpacity="0.74" />
          <Stop offset="0.52" stopColor={INK} stopOpacity="0.20" />
          <Stop offset="0.72" stopColor={INK} stopOpacity="0.04" />
          <Stop offset="1" stopColor={INK} stopOpacity="0" />
        </LinearGradient>
        <LinearGradient id="down" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={INK} stopOpacity="0.12" />
          <Stop offset="0.40" stopColor={INK} stopOpacity="0.02" />
          <Stop offset="0.78" stopColor={INK} stopOpacity="0.50" />
          <Stop offset="1" stopColor={INK} stopOpacity="0.92" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#left)" />
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#down)" />
    </Svg>
  );
}

/** The wordmark: a checked speech bubble, then EZChange bold and Order light. Drawn
 *  rather than imported — it is two shapes and a word, and an image of text cannot be
 *  read by a screen reader or re-coloured for the cream pages. */
function Wordmark({ dark }: { dark?: boolean }) {
  const c = dark ? '#131110' : '#fff';
  return (
    <View style={st.mark}>
      <View style={[st.markBox, { borderColor: c }]}>
        <Icon name="check" size={12} color={c} />
        <View style={[st.markTail, { backgroundColor: c }]} />
      </View>
      <Text style={[st.markT, { color: c }]}>
        EZChange<Text style={st.markTLight}>Orders</Text>
      </Text>
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
      {/* The cover art is the ROOT background and the cream pages paint over it, rather
          than each page owning its own — a page-sized image inside the pager would slide
          with the finger and the photograph would visibly track the swipe. */}
      <Image source={require('../../assets/onboard-hero.png')}
        style={st.hero} resizeMode="cover" />
      <Scrim />

      <ScrollView
        ref={ref}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setI(Math.round(e.nativeEvent.contentOffset.x / width))}
      >
        {/* ── PAGE 1 — the cover ── */}
        <ScrollView style={{ width }} contentContainerStyle={st.cover}
          showsVerticalScrollIndicator={false}>
          <Wordmark />
          <View style={st.headWrap}>
            <Text style={st.coverHead}>{T('ob.h1')}</Text>
            <Text style={st.coverHead}>{T('ob.h2')}</Text>
            <Text style={st.coverHead}>{T('ob.h3')}</Text>
            <Text style={[st.coverHead, { color: GOLD }]}>{T('ob.h4')}</Text>
          </View>
          <View style={[st.rule, { backgroundColor: GOLD }]} />
          <Text style={st.coverLede}>{T('ob.lede')}</Text>

          <View style={st.promises}>
            {COVER_PROMISES.map((p) => (
              <View key={p.title} style={st.promise}>
                <View style={st.promiseDisc}>
                  <Image source={p.src} style={st.promiseIcon} resizeMode="contain" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={st.promiseT}>{T(p.title)}</Text>
                  <Text style={st.promiseB}>{T(p.body)}</Text>
                </View>
              </View>
            ))}
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
        </ScrollView>

        {/* ── PAGES 2-4 — the three steps, on the app's own cream ── */}
        {SLIDES.map((sl) => (
          <View key={sl.body} style={[st.page, { width }]}>
            <ScrollView contentContainerStyle={st.pageBody} showsVerticalScrollIndicator={false}>
              <Wordmark dark />
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
                { backgroundColor: i > 0 ? 'rgba(19,17,16,0.18)' : 'rgba(255,255,255,0.32)' },
                d === i && { backgroundColor: i > 0 ? OCHRE : GOLD },
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
  c: { flex: 1, backgroundColor: INK },
  // Same aspect as the screen, so shrinking the box does not crop — it only pulls back.
  hero: { position: 'absolute', top: 0, right: 0, width: HERO_FILL, height: HERO_FILL },
  // paddingBottom clears the absolute bar (64) PLUS the home indicator. In the first
  // build it did not, and the dot rail landed on top of "Already have an account?".
  cover: { paddingHorizontal: 20, paddingTop: 38, paddingBottom: 96, minHeight: height },
  page: { backgroundColor: CREAM },
  pageBody: { paddingHorizontal: 32, paddingTop: 62, paddingBottom: 76 },

  // ── wordmark ──
  mark: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 30 },
  markBox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center' },
  // The bubble's tail, a rotated square tucked under the left corner — cheaper than an
  // SVG path and it scales with the box.
  markTail: { position: 'absolute', bottom: -3.5, left: 3, width: 7, height: 7,
    transform: [{ rotate: '45deg' }] },
  markT: { fontFamily: 'Inter_700Bold', fontSize: 16.5, letterSpacing: -0.3 },
  markTLight: { fontFamily: 'Inter_400Regular' },

  // ── headlines ──
  headWrap: { marginBottom: 4 },
  coverHead: { fontFamily: 'Oswald_700Bold', fontSize: 38, lineHeight: 40, color: '#fff',
    textTransform: 'uppercase', letterSpacing: -0.2 },
  pageHead: { fontFamily: 'Oswald_700Bold', fontSize: 38, lineHeight: 43, color: '#131110',
    textTransform: 'uppercase', letterSpacing: -0.2 },
  rule: { width: 42, height: 3, borderRadius: 2, marginTop: 12, marginBottom: 14 },
  // maxWidth is what makes it break where the design breaks it — three short lines
  // clear of the subject, not two that run across his chest.
  // maxWidth 155 is what breaks it into the design's THREE short lines, clear of the
  // subject — at any wider it runs across his chest as two.
  coverLede: { fontFamily: 'Inter_400Regular', fontSize: 13.5, lineHeight: 19.5,
    color: '#E4E1DB', maxWidth: 155 },
  // maxWidth 186 is measured, and it is what produces the design's line breaks:
  // "Snap photos and say what / changed. No forms. / No typing on the jobsite."
  pageLede: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 23,
    color: '#3B3733', marginBottom: 22 },

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
  promises: { marginTop: 'auto', paddingTop: 24, gap: 24 },
  promise: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  // A ring, not a filled puck: a solid gold disc three times down the page would
  // outweigh the button, which is the only gold thing meant to be pressed.
  promiseDisc: { width: 42, height: 42, borderRadius: 21, borderWidth: 1.2,
    borderColor: 'rgba(237,185,63,0.42)', backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center', justifyContent: 'center' },
  promiseIcon: { width: 19, height: 19 },
  promiseT: { fontFamily: 'Inter_700Bold', fontSize: 12.5, color: '#fff',
    textTransform: 'uppercase', letterSpacing: 0.4 },
  // maxWidth so the body wraps to the design's two short lines instead of one long one
  // that would run under the subject.
  promiseB: { fontFamily: 'Inter_400Regular', fontSize: 11.5, lineHeight: 17,
    color: '#B9B5AE', marginTop: 2, maxWidth: 128 },

  // ── the ask ──
  coverFoot: { marginTop: 30 },
  cta: { flexDirection: 'row', gap: 11, minHeight: 55, borderRadius: 11,
    backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center' },
  // DARK text on gold. White on this yellow fails contrast at any size, and this is the
  // one control the whole screen exists to get pressed.
  ctaT: { fontFamily: 'Inter_700Bold', fontSize: 15.5, color: '#141210' },
  ctaArrow: { fontSize: 17, color: '#141210', marginTop: -2 },
  login: { alignItems: 'center', paddingVertical: 15 },
  loginT: { fontFamily: 'Inter_400Regular', fontSize: 12.5, color: '#CFCBC4' },
  // Underlined, as drawn. On a dark page a gold word without a rule under it reads as
  // emphasis, not as a link — and this is the door a returning user is looking for.
  loginLink: { fontFamily: 'Inter_700Bold', color: GOLD, textDecorationLine: 'underline' },

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
