/**
 * THE FIRST-RUN INTRO — four pages, shown once to a logged-out device.
 *
 * Rewritten 2026-09-18 from hadar's comps. The old version made its case with
 * three icon discs per page (camera / mic / pin, then mic / sparkle / doc, then
 * plane / bubble / check) over a small device photo: it NAMED what the app does
 * and showed almost none of it. The four pages now carry a single argument —
 * the moment, what he says, what he gets, what his client does — and each shows
 * the artefact instead of captioning it.
 *
 * ─── WHY THE PHONES ARE DRAWN, NOT PASTED ──────────────────────────────────────
 * The comps are rendered PNGs with their text baked in. Shipping them would have
 * been a morning's work instead of a day's, and it would have put an English
 * phone screen in front of a Spanish-speaking contractor — on the one screen
 * whose job is to prove the app speaks his language. Over half the workforce in
 * drywall, plaster, roofing, painting and flooring is foreign-born. So every word
 * inside every mockup is an i18n key and every frame is a View. The one image
 * that survives is the contractor himself (`heroCutout.png`), which carries no
 * text and therefore no language.
 *
 * ─── SCALED, NOT FIXED ─────────────────────────────────────────────────────────
 * The comps are drawn at 390pt. `S()` scales everything from that, so the
 * composition holds on a 375pt SE and a 430pt Max rather than being tuned for one
 * device and drifting on the rest. Read `S(20)` as "20 points at comp width".
 *
 * ─── THE PAGES STILL SCROLL ────────────────────────────────────────────────────
 * Each page is a ScrollView, as before. A short device cannot fit a full page and
 * the alternative — shrinking type until it fits — fails the person this app is
 * for. The footer (dots + action) is pinned outside the scroller so the way
 * forward is never the thing that scrolled away.
 */
import React from 'react';
import {
  Dimensions, Image, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, View,
} from 'react-native';

import { t as T, type Lang } from '../i18n';

const { width } = Dimensions.get('window');
/** The comps' ruler: every measurement is taken at 390pt and scaled from there. */
const S = (n: number) => Math.round((n * width) / 390 * 10) / 10;

/**
 * CLEARS THE STATUS BAR (hadar, 2026-09-18: "the top header is too high up and
 * being hidden under the time and wifi").
 *
 * There is no `react-native-safe-area-context` in this app — setupflow.tsx solves
 * the same problem with a flat `paddingTop: 64` and says so — so the inset is
 * computed rather than measured. It is NOT run through `S()`: a status bar is a
 * fixed physical strip, and scaling it by screen WIDTH would under-pad the narrow
 * phones that need it most. Android reports its own height; iOS has no such API
 * without the missing package, so 60 covers the Dynamic Island (~59) and is
 * generous on the older notch (~47).
 */
const TOP_INSET = Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) + 12 : 60;

const CREAM = '#F7F5F0';
const INK = '#161918';
/** The deep forest of the app icon — wordmark tile, document header, approve. */
const FOREST = '#2F5233';
/** The button green. Lighter than FOREST so a full-width bar does not read as a hole. */
const GREEN = '#3E5A38';
/** The accent on cream. The cover's bright gold goes muddy beside black type. */
const OCHRE = '#C08A2B';
const SAND = '#EFE7D9';
const MUTED = '#555B57';
const BODY = '#3A403C';

/* ------------------------------------------------------------------ chrome -- */

/**
 * THE HEADER IS ON EVERY PAGE, AND SO IS THE LANGUAGE SWITCH.
 *
 * It used to be two `View`s halfway down page one: the cover advertised "Español"
 * to a man who could not read the screen it sat on, and did nothing when he
 * tapped it. Language is resolved from the handset before any of this paints
 * (`devicelang.ts`), so this is the CORRECTION — for the bilingual case, a phone
 * set to English by someone who would rather work in Spanish — and it is present
 * on all four pages because the page he doubts is not necessarily the first one.
 */
function Chrome({ lang, onLang }: { lang?: Lang; onLang?: (l: Lang) => void }) {
  return (
    <View style={st.chrome}>
      <View style={st.mark}>
        <View style={st.markTile}>
          <Image source={require('../../assets/android-icon-monochrome.png')}
            style={st.markGlyph} resizeMode="contain" />
        </View>
        <Text style={st.markT}>EZChangeOrders</Text>
      </View>
      <View style={st.langRow}>
        {(['en', 'es'] as const).map((l) => (
          <Pressable key={l} onPress={() => onLang?.(l)}
            accessibilityRole="button"
            // The LANGUAGE, not the country: a screen reader must not announce
            // "Mexico" to somebody choosing Spanish.
            accessibilityLabel={l === 'en' ? 'English' : 'Español'}
            accessibilityState={{ selected: lang === l }}
            style={[st.langChip, lang === l && st.langChipOn]}>
            <Flag lang={l} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}


/**
 * THE TWO FLAGS, DRAWN AS VIEWS.
 *
 * NOT EMOJI. Regional-indicator flag emoji are absent from the system font on
 * most Android builds — the OS falls back to rendering the two letters, so the
 * flag switch would silently turn back into the "EN / ES" it replaced, on the
 * half of the fleet we can least afford to get wrong.
 *
 * WHICH FLAG IS A REAL COST, and it is worth stating where it is made. This
 * screen used to read "English / Español" on purpose (hadar, 2026-08-26: "words
 * rather than flags because a flag is a country"). Spanish is the language of
 * some twenty countries; Mexico stands in for all of them here because it is the
 * largest origin group in US residential construction, and a Salvadoran or
 * Guatemalan contractor is being asked to read past a flag that is not his. The
 * accessibility label says the LANGUAGE, not the country, so a screen reader
 * still announces "Español".
 */
function Flag({ lang }: { lang: Lang }) {
  if (lang === 'es') {
    // Mexico: three vertical bands. The arms in the white band are illegible at
    // this size, so they are left out rather than rendered as a smudge.
    return (
      <View style={[st.flag, st.flagRow]}>
        <View style={[st.flagBand, { backgroundColor: '#006847' }]} />
        <View style={[st.flagBand, { backgroundColor: '#FFFFFF' }]} />
        <View style={[st.flagBand, { backgroundColor: '#CE1126' }]} />
      </View>
    );
  }
  // United States: stripes with the canton. Thirteen stripes and fifty stars do
  // not survive 22pt, so it is seven stripes and a plain canton — read at a
  // glance, which is the whole job of a flag on a chip.
  return (
    <View style={st.flag}>
      {[0, 1, 2, 3, 4, 5, 6].map((n) => (
        <View key={n} style={[st.flagStripe,
          { backgroundColor: n % 2 === 0 ? '#B22234' : '#FFFFFF' }]} />
      ))}
      <View style={st.flagCanton} />
    </View>
  );
}

/** The dots + the one action. Pinned below the scroller on every page. */
function Foot({ i, label, onPress }: { i: number; label: string; onPress: () => void }) {
  return (
    <View style={st.foot}>
      <View style={st.dots}>
        {[0, 1, 2, 3].map((d) => (
          <View key={d} style={[st.dot, d === i && st.dotOn]} />
        ))}
      </View>
      <Pressable style={st.cta} accessibilityRole="button" onPress={onPress}>
        <Text style={st.ctaT}>{label}</Text>
        <Text style={st.ctaArrow}>→</Text>
      </Pressable>
    </View>
  );
}

/** A page's eyebrow + two-tone headline + body, shared by pages 2-4. */
function Head({ eyebrow, h1, h2, body }: {
  eyebrow: string; h1: string; h2: string; body: string;
}) {
  return (
    <>
      <Text style={st.eyebrow}>{T(eyebrow)}</Text>
      <Text style={st.head}>{T(h1)}</Text>
      <Text style={[st.head, { color: OCHRE }]}>{T(h2)}</Text>
      <Text style={st.lede}>{T(body)}</Text>
    </>
  );
}

/* ------------------------------------------------------------- the devices -- */

/**
 * THE PHONES ARE HADAR'S OWN RENDERS, NOT DRAWINGS (2026-09-18).
 *
 * I built these as Views first so every word inside them would translate, and
 * twice shipped something that did not look like the comps. hadar: "still not
 * right — I gave you images, can you stay true to the images I gave you." The
 * comps win. They are his artwork, they are what the product should look like,
 * and a hand-drawn approximation that misses is worth less than a picture that
 * lands.
 *
 * WHAT THIS COSTS, STATED PLAINLY: the text INSIDE these three phones is baked
 * into the pixels, so it stays English when the app is in Spanish. Everything
 * AROUND them still switches — headline, eyebrow, body, the prompt chips, the
 * sealed strip, the buttons. The fix is a Spanish render of these same three
 * images, dropped in beside the English ones and picked by `lang`; PHONES is
 * shaped so that is a one-line change rather than a rewrite.
 *
 * The outer white was flood-filled to transparent from the border, so interior
 * whites — the document body, the iMessage panel — survive and the phones sit
 * directly on the cream with no card behind them.
 */
const PHONES = {
  record: require('../../assets/onboard/obRecord.png'),
  draft: require('../../assets/onboard/obDraft.png'),
  approve: require('../../assets/onboard/obApprove.png'),
} as const;

/* ------------------------------------------------------------------ screen -- */

const PAGES = 4;

export function Onboarding({ onDone, lang, onLang }: {
  onDone: (intent?: 'signup' | 'login') => void;
  /** Which language is live, so the header chip shows which one is selected. */
  lang?: Lang;
  /** Picking a language applies it immediately and remembers it. */
  onLang?: (l: Lang) => void;
}) {
  const ref = React.useRef<ScrollView>(null);
  const [i, setI] = React.useState(0);
  const go = (n: number) => ref.current?.scrollTo({ x: n * width, animated: true });

  const page = (n: number, body: React.ReactNode, label: string) => (
    <View style={[st.page, { width }]}>
      <Chrome lang={lang} onLang={onLang} />
      <ScrollView style={st.scroll} contentContainerStyle={st.scrollBody}
        showsVerticalScrollIndicator={false}>
        {body}
      </ScrollView>
      <Foot i={n} label={T(label)}
        onPress={() => (n === PAGES - 1 ? onDone('signup') : go(n + 1))} />
    </View>
  );

  return (
    <View style={st.c}>
      <ScrollView ref={ref} horizontal pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) =>
          setI(Math.round(e.nativeEvent.contentOffset.x / width))}>

        {/* ── 1 · THE MOMENT ──────────────────────────────────────────────────
            The three things a client actually says, over the man they are said
            to. Recognition, not explanation: he knows this conversation, and the
            page's whole job is to say we have stood on that jobsite too. */}
        {page(0, (
          <>
            <Text style={st.coverHead}>{T('ob.h1')}</Text>
            <Text style={st.coverHead}>{T('ob.h2')}</Text>
            <Text style={[st.coverHead, { color: GREEN }]}>{T('ob.h3')}</Text>
            <View style={st.rule} />
            <Text style={st.lede}>{T('ob.lede')}</Text>
            <View style={st.heroWrap}>
              <Image source={require('../../assets/onboard/heroShot.jpg')}
                style={st.hero} resizeMode="cover" />
              <View style={st.bubbles}>
                {['ob.b1', 'ob.b2', 'ob.b3'].map((k, n) => (
                  <View key={k} style={[st.bubble, n === 1 && st.bubbleIndent]}>
                    <Text style={st.bubbleT}>{T(k)}</Text>
                  </View>
                ))}
              </View>
            </View>
            <Pressable accessibilityRole="button" onPress={() => onDone('login')}
              style={st.login}>
              <Text style={st.loginT}>
                {T('ob.haveAccount')} <Text style={st.loginLink}>{T('ob.login')}</Text>
              </Text>
            </Pressable>
          </>
        ), 'ob.showMe')}

        {/* ── 2 · WHAT HE DOES ───────────────────────────────────────────────── */}
        {page(1, (
          <>
            <Head eyebrow="ob.e1" h1="ob.n1h1" h2="ob.n1h2" body="ob.n1b" />
            <Image source={PHONES.record} style={st.shotRecord} resizeMode="contain" />
            <View style={st.stuckBox}>
              <Text style={st.stuckLabel}>{T('ob.stuck')}</Text>
              <View style={st.chips}>
                {['ob.q1', 'ob.q2', 'ob.q3'].map((k) => (
                  <View key={k} style={st.chip}><Text style={st.chipT}>{T(k)}</Text></View>
                ))}
              </View>
            </View>
          </>
        ), 'ob.next')}

        {/* ── 3 · WHAT HE GETS ───────────────────────────────────────────────── */}
        {page(2, (
          <>
            <Head eyebrow="ob.e2" h1="ob.n2h1" h2="ob.n2h2" body="ob.n2b" />
            <Image source={PHONES.draft} style={st.shotDraft} resizeMode="contain" />
          </>
        ), 'ob.next')}

        {/* ── 4 · WHAT THEY DO ───────────────────────────────────────────────── */}
        {page(3, (
          <>
            <Head eyebrow="ob.e3" h1="ob.n3h1" h2="ob.n3h2" body="ob.n3b" />
            <Image source={PHONES.approve} style={st.shotApprove} resizeMode="contain" />
            <View style={st.sealed}>
              <Text style={st.sealedH}>{T('ob.sealedH')}</Text>
              <Text style={st.sealedB}>{T('ob.sealedB')}</Text>
            </View>
          </>
        ), 'ob.writeFirst')}
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  c: { flex: 1, backgroundColor: CREAM },
  page: { flex: 1, backgroundColor: CREAM },
  scroll: { flex: 1 },
  scrollBody: { paddingHorizontal: S(22), paddingBottom: S(16) },

  // ── chrome ──
  chrome: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: S(22), paddingTop: TOP_INSET, paddingBottom: S(10),
  },
  mark: { flexDirection: 'row', alignItems: 'center', gap: S(9) },
  markTile: {
    width: S(26), height: S(26), borderRadius: S(7), backgroundColor: FOREST,
    alignItems: 'center', justifyContent: 'center',
  },
  markGlyph: { width: S(16), height: S(16) },
  markT: { fontFamily: 'Inter_700Bold', fontSize: S(17), color: FOREST, letterSpacing: -0.3 },
  langRow: { flexDirection: 'row', backgroundColor: SAND, borderRadius: S(9), padding: S(3), gap: S(2) },
  langChip: {
    // 44 is the floor for something tapped with a glove on.
    minHeight: 44, minWidth: S(44), paddingHorizontal: S(12), borderRadius: S(7),
    alignItems: 'center', justifyContent: 'center',
  },
  langChipOn: { backgroundColor: '#FFFDF9', borderWidth: 1.4, borderColor: GREEN },
  // The unselected flag is dimmed rather than greyed: desaturating a flag makes it
  // look broken, while opacity reads as "not the one you are on".
  flag: {
    width: S(26), height: S(18), borderRadius: S(3), overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(19,17,16,0.22)',
  },
  flagRow: { flexDirection: 'row' },
  flagBand: { flex: 1, height: '100%' },
  flagStripe: { flex: 1, width: '100%' },
  flagCanton: {
    position: 'absolute', top: 0, left: 0, width: '42%', height: '54%',
    backgroundColor: '#3C3B6E',
  },

  // ── type ──
  coverHead: {
    fontFamily: 'Oswald_700Bold', fontSize: S(37), lineHeight: S(39), color: INK,
    textTransform: 'uppercase', letterSpacing: -0.3,
  },
  eyebrow: {
    fontFamily: 'Inter_700Bold', fontSize: S(11), color: GREEN, letterSpacing: 1.1,
    textTransform: 'uppercase', marginTop: S(8),
  },
  head: {
    fontFamily: 'Oswald_700Bold', fontSize: S(34), lineHeight: S(37), color: INK,
    textTransform: 'uppercase', letterSpacing: -0.3, marginTop: S(2),
  },
  rule: { width: S(58), height: S(4), borderRadius: 2, backgroundColor: OCHRE, marginTop: S(15) },
  lede: { fontFamily: 'Inter_400Regular', fontSize: S(15.5), lineHeight: S(22), color: BODY, marginTop: S(12) },

  // ── cover ──
  // A FULL-BLEED PHOTO, not a cut-out (2026-09-18). The previous art was a figure
  // on transparency, so it stood on the cream; this is a whole jobsite scene, so
  // it runs edge to edge and the page hands over to it rather than floating it.
  // Mirrored in the asset itself rather than with a transform: scaleX(-1) flips
  // the bubbles' shadows and anything else that ever lands inside this wrapper.
  heroWrap: {
    height: S(300), marginTop: S(12), marginHorizontal: -S(22),
    justifyContent: 'center', overflow: 'hidden',
  },
  hero: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  bubbles: { alignItems: 'flex-end', gap: S(11), paddingRight: S(16), zIndex: 1 },
  bubble: {
    backgroundColor: '#FFFFFF', borderRadius: S(15), borderBottomRightRadius: S(4),
    paddingVertical: S(11), paddingHorizontal: S(15), maxWidth: S(182),
    shadowColor: '#141313', shadowOpacity: 0.16, shadowRadius: S(10),
    shadowOffset: { width: 0, height: S(4) }, elevation: 3,
  },
  bubbleIndent: { marginRight: S(16) },
  bubbleT: { fontFamily: 'Inter_400Regular', fontSize: S(14.5), lineHeight: S(19), color: '#2C2A27' },
  login: { alignItems: 'center', paddingVertical: S(14), marginTop: S(4) },
  loginT: { fontFamily: 'Inter_400Regular', fontSize: S(14.5), color: BODY },
  loginLink: { fontFamily: 'Inter_700Bold', color: GREEN },

  // ── device ──
  device: {
    // A HAIRLINE OF LIGHT ON THE RIM. Without it a dark bezel around a dark screen
    // is one black shape and the illustration stops reading as a phone at all —
    // which is exactly how the first attempt failed.
    alignSelf: 'center', width: S(272), backgroundColor: '#1B1B1B', borderRadius: S(34),
    borderWidth: S(1.2), borderColor: '#3A3A3A',
    padding: S(9), marginTop: S(16),
    shadowColor: '#141313', shadowOpacity: 0.22, shadowRadius: S(18),
    shadowOffset: { width: 0, height: S(10) }, elevation: 6,
  },
  screen: { backgroundColor: '#FFFFFF', borderRadius: S(26), overflow: 'hidden' },

  // ── the drawn phone's own chrome ──
  statusBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: S(18), paddingTop: S(11), paddingBottom: S(4),
  },
  statusTime: { fontFamily: 'Inter_700Bold', fontSize: S(12), letterSpacing: -0.2 },
  island: {
    position: 'absolute', top: S(7), alignSelf: 'center',
    width: S(74), height: S(21), borderRadius: S(11), backgroundColor: '#000000',
  },
  statusIcons: { flexDirection: 'row', alignItems: 'flex-end', gap: S(4) },
  sigBar: { width: S(2.5), borderRadius: 1 },
  // A SOLID FAN, not an arc. The usual trick — a circle showing only two borders,
  // rotated 45° — renders as a crescent at this size and reads as a broken moon.
  wifi: {
    width: 0, height: 0, marginLeft: S(3), marginBottom: S(1),
    borderLeftWidth: S(6), borderRightWidth: S(6), borderBottomWidth: S(8.5),
    borderLeftColor: 'transparent', borderRightColor: 'transparent',
  },
  battery: {
    width: S(18), height: S(9.5), borderRadius: S(2.6), borderWidth: S(1.2),
    padding: S(1.2), marginLeft: S(2),
  },
  batteryFill: { flex: 1, borderRadius: S(1) },

  // ── the camera glyph ──
  camBump: {
    position: 'absolute', top: S(12), width: S(8), height: S(3),
    borderTopLeftRadius: S(2), borderTopRightRadius: S(2), backgroundColor: '#EFE7D9',
  },
  camBody: {
    width: S(20), height: S(15), borderRadius: S(4), borderWidth: S(1.7),
    borderColor: '#EFE7D9', alignItems: 'center', justifyContent: 'center', marginTop: S(3),
  },
  camLens: {
    width: S(7), height: S(7), borderRadius: S(4), borderWidth: S(1.5), borderColor: '#EFE7D9',
  },
  // ── recorder ──
  recBody: { padding: S(16), gap: S(13) },
  recTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: S(8) },
  recDot: { width: S(9), height: S(9), borderRadius: S(5), backgroundColor: '#E0503A' },
  recLabel: { fontFamily: 'Inter_700Bold', fontSize: S(12.5), color: '#F2EFE8', letterSpacing: 0.5 },
  wave: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: S(1.6), height: S(56) },
  bar: { width: S(3), borderRadius: S(1.5), backgroundColor: '#6E6E6E' },
  recQuote: { fontFamily: 'Inter_400Regular', fontSize: S(13.5), lineHeight: S(19), color: CREAM, textAlign: 'center' },
  recCtrls: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', gap: S(24) },
  recCtrl: { alignItems: 'center', gap: S(6) },
  recSmall: {
    width: S(46), height: S(46), borderRadius: S(23), backgroundColor: '#2C2C2C',
    alignItems: 'center', justifyContent: 'center',
  },
  recBig: {
    width: S(64), height: S(64), borderRadius: S(32), backgroundColor: '#E8B32B',
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: S(6),
    // The pale ring the comp draws around the live button.
    borderWidth: S(2), borderColor: 'rgba(255,255,255,0.85)',
  },
  pauseBar: { width: S(5), height: S(20), borderRadius: 2, backgroundColor: '#131110' },
  glyphCam: { width: S(18), height: S(14), borderRadius: S(3), borderWidth: 1.8, borderColor: '#EFE7D9' },
  glyphStop: { width: S(15), height: S(15), borderRadius: S(3), backgroundColor: '#EFE7D9' },
  recCtrlT: { fontFamily: 'Inter_400Regular', fontSize: S(11.5), color: '#9A9F99' },

  stuckBox: { backgroundColor: SAND, borderRadius: S(12), padding: S(13), marginTop: S(14) },
  stuckLabel: {
    fontFamily: 'Inter_700Bold', fontSize: S(10.5), color: MUTED,
    letterSpacing: 0.8, textTransform: 'uppercase',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: S(7), marginTop: S(9) },
  chip: { backgroundColor: '#E7EDE3', borderRadius: S(8), paddingVertical: S(8), paddingHorizontal: S(12) },
  chipT: { fontFamily: 'Inter_600SemiBold', fontSize: S(13), color: BODY },

  // ── the draft ──
  docNav: { paddingVertical: S(11), borderBottomWidth: 1, borderBottomColor: '#EFECE6' },
  docNavT: {
    fontFamily: 'Inter_700Bold', fontSize: S(12), color: INK, textAlign: 'center',
    letterSpacing: 0.7, textTransform: 'uppercase',
  },
  docBody: { padding: S(12), gap: S(9) },
  docHead: { backgroundColor: FOREST, borderRadius: S(9), padding: S(10) },
  docCompany: {
    fontFamily: 'Oswald_700Bold', fontSize: S(15), color: '#FFFFFF',
    textTransform: 'uppercase', letterSpacing: 0.3,
  },
  docCo: { fontFamily: 'Inter_400Regular', fontSize: S(11), color: '#CBD8C8', marginTop: 1 },
  docLabel: {
    fontFamily: 'Inter_700Bold', fontSize: S(10), color: MUTED,
    letterSpacing: 0.9, textTransform: 'uppercase', marginTop: S(3),
  },
  scopeRow: { flexDirection: 'row', gap: S(8), alignItems: 'flex-start' },
  scopeNum: {
    width: S(16), height: S(16), borderRadius: S(4), backgroundColor: SAND,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  scopeNumT: { fontFamily: 'Inter_700Bold', fontSize: S(9.5), color: BODY },
  scopeT: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: S(12), lineHeight: S(16.5), color: INK },
  notRow: { flexDirection: 'row', gap: S(8), alignItems: 'flex-start' },
  dash: { width: S(10), height: 2, borderRadius: 1, backgroundColor: '#8A8F8B', marginTop: S(7) },
  notT: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: S(12), lineHeight: S(16.5), color: BODY },

  priceBox: { borderWidth: 1, borderColor: '#D8D1C4', borderRadius: S(10), paddingHorizontal: S(11), paddingBottom: S(3) },
  priceHead: {
    fontFamily: 'Inter_700Bold', fontSize: S(10), color: MUTED, letterSpacing: 0.9,
    textTransform: 'uppercase', marginTop: S(9), marginBottom: S(1),
  },
  priceRow: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    gap: S(10), paddingVertical: S(7), borderTopWidth: 1, borderTopColor: '#D8D1C4',
  },
  priceCol: { flex: 1, minWidth: 0 },
  priceT: { fontFamily: 'Inter_400Regular', fontSize: S(12.5), lineHeight: S(17), color: INK },
  priceQ: { fontFamily: 'Inter_400Regular', fontSize: S(11), color: MUTED, fontStyle: 'italic', marginTop: 1 },
  priceAmt: { fontFamily: 'Inter_600SemiBold', fontSize: S(13), color: INK, fontVariant: ['tabular-nums'] },
  // Set apart by a heavier rule, the way a receipt sets it apart.
  totalRow: { borderTopWidth: 1.5, alignItems: 'center' },
  totalT: { fontFamily: 'Inter_700Bold', fontSize: S(13), color: INK },
  totalAmt: { fontFamily: 'Oswald_700Bold', fontSize: S(18), color: INK, fontVariant: ['tabular-nums'] },

  // ── the client pair ──
  pair: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', marginTop: S(4) },
  smsWrap: { width: S(132), marginRight: -S(10), marginTop: S(22) },
  appWrap: { width: S(166), zIndex: 2 },
  smsBody: { padding: S(9), alignItems: 'center', gap: S(5) },
  smsAvatar: {
    width: S(24), height: S(24), borderRadius: S(12), backgroundColor: '#D8D1C4',
    alignItems: 'center', justifyContent: 'center',
  },
  smsAvatarT: { fontFamily: 'Inter_700Bold', fontSize: S(9), color: BODY },
  smsWho: { fontFamily: 'Inter_600SemiBold', fontSize: S(10), color: INK },
  bubbleIn: {
    backgroundColor: '#EFECE6', borderRadius: S(11), borderBottomLeftRadius: S(3),
    padding: S(8), marginTop: S(3), alignSelf: 'stretch',
  },
  smsT: { fontFamily: 'Inter_400Regular', fontSize: S(10.5), lineHeight: S(14.5), color: INK },
  smsLink: { fontFamily: 'Inter_600SemiBold', fontSize: S(10), color: GREEN, marginTop: S(4) },
  appBody: { padding: S(11), gap: S(7) },
  appCompany: { fontFamily: 'Inter_700Bold', fontSize: S(13), color: INK },
  appCo: { fontFamily: 'Inter_400Regular', fontSize: S(10.5), color: MUTED, marginTop: -S(4) },
  appLines: { gap: S(4) },
  appLine: { fontFamily: 'Inter_400Regular', fontSize: S(10), lineHeight: S(14), color: BODY },
  appTotalRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderTopWidth: 1.5, borderTopColor: '#D8D1C4', paddingTop: S(7),
  },
  approveBtn: {
    backgroundColor: FOREST, borderRadius: S(8), minHeight: S(38),
    alignItems: 'center', justifyContent: 'center',
  },
  approveT: { fontFamily: 'Inter_700Bold', fontSize: S(12), color: '#FFFFFF' },
  askQ: { fontFamily: 'Inter_600SemiBold', fontSize: S(10.5), color: MUTED, textAlign: 'center' },

  sealed: { backgroundColor: '#E7EDE3', borderRadius: S(12), padding: S(13), marginTop: S(14) },
  sealedH: { fontFamily: 'Inter_700Bold', fontSize: S(13), lineHeight: S(18), color: INK },
  sealedB: { fontFamily: 'Inter_400Regular', fontSize: S(13), lineHeight: S(18), color: INK },

  // Sized so each phone lands whole above the footer on a 390x844 comp; the page
  // scrolls, so a shorter handset reveals the rest rather than cropping it away.
  shotRecord: { alignSelf: 'center', width: S(258), height: S(430), marginTop: S(14) },
  shotDraft: { alignSelf: 'center', width: S(250), height: S(481), marginTop: S(10) },
  shotApprove: { alignSelf: 'center', width: S(340), height: S(303), marginTop: S(10) },

  // ── foot ──
  foot: { paddingHorizontal: S(22), paddingTop: S(10), paddingBottom: S(24), gap: S(14) },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: S(7) },
  dot: { width: S(7), height: S(7), borderRadius: S(4), backgroundColor: 'rgba(19,17,16,0.18)' },
  dotOn: { backgroundColor: OCHRE },
  cta: {
    flexDirection: 'row', gap: S(10), minHeight: 56, borderRadius: S(11),
    backgroundColor: GREEN, alignItems: 'center', justifyContent: 'center',
  },
  ctaT: { fontFamily: 'Inter_700Bold', fontSize: S(17), color: '#FFFFFF' },
  ctaArrow: { fontSize: S(18), color: '#FFFFFF', marginTop: -2 },
});
