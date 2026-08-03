/**
 * Design tokens — the EZChangeOrder visual language.
 *
 * ADOPTED 2026-07-26 from the approved EZChangeOrder Design System kit (see
 * `tokens.ts` for the raw values). A warm, high-contrast FIELD light theme: ink is
 * the primary dark action, OLIVE is the brand accent (the kit retires the old bright
 * orange), and status colours are MUTED and always paired with an icon + plain words
 * (colour never carries status alone). Gloves, sunlight, no signal — legibility first.
 *
 * The export NAMES are kept stable on purpose so every screen re-skins from these
 * tokens with no logic change; only the VALUES moved to the new system. `orange` now
 * holds the olive brand so the ~28 existing accent call-sites shift in one place.
 *
 * Use these instead of ad-hoc hex values so the app reads as one product.
 */
import { StyleSheet, TextStyle } from 'react-native';
import { palette, radii, shadows, statusTints } from './tokens';

export const C = {
  ink: palette.ink,             // #161918 — primary text + dark primary buttons
  paper: palette.background,    // #F5F1E8 — warm cream app background
  card: palette.surface,        // #FBF8F1 — cards / sheets (cream, never white)
  raised: palette.surfaceRaised,// #FFFDF8 — a surface above a card
  surfaceMuted: palette.surfaceMuted, // #EFEBE3 — insets, neutral chips, pressed
  // `orange` is the historical name for THE accent; it now carries the OLIVE BRAND.
  orange: palette.brand,        // #4E6243 — capture/send/money accent (was #FF5A00)
  orangePress: palette.brandDark,
  brand: palette.brand,
  brandDark: palette.brandDark,
  brandSoft: palette.brandSoft, // #E7ECDD — brand-tinted fill (approved/selected bg)
  steel: palette.textSecondary, // #555B57 — secondary text
  muted: palette.textMuted,     // #777C78 — metadata: timestamps, counts, headings
  disabled: palette.textDisabled,// #A4A7A3 — disabled labels only, never real info
  line: palette.border,         // #D8D1C4 — dividers / hairlines / borders
  brandLine: palette.brandBorder,// #B9C6AF — hairline on a brand-tinted surface
  approve: palette.statusApproved, // #536B49 — approved / confirmed (muted forest)
  caution: palette.statusWaiting,  // #A47A3F — waiting / pending (muted ochre)
  danger: palette.statusFailed,    // #8B5148 — failed / declined / destructive (muted brick)
  inkSoft: '#2A2E33',
  onDark: '#AEB4BD',            // secondary text on ink backgrounds
  // Sync/offline states (spec: charcoal → blue-grey → steel).
  noSignal: palette.statusNoSignal,   // #4F565D
  savedLocal: palette.statusSavedLocal, // #6D7F89
  syncing: palette.statusSyncing,     // #718796
} as const;

export const F = {
  /** Display: condensed, uppercase, letterspaced. Labels, actions, numbers. */
  disp: 'BarlowCondensed_700Bold',
  dispSemi: 'BarlowCondensed_600SemiBold',
  /** Body: what a person actually reads. */
  body: 'Barlow_400Regular',
  bodyMed: 'Barlow_500Medium',
  bodySemi: 'Barlow_600SemiBold',
  bodyBold: 'Barlow_700Bold',
} as const;

/**
 * Heading text: sentence-case, heavy, humanist (Barlow bold) — friendlier and more
 * readable for the ICP (a non-technical tradesperson, often reading in a second
 * language). ALL-CAPS is reserved for small labels (`label`) and the one hero capture
 * action, not titles. Expert type direction, 2026-07-26 — sentence-case beats caps
 * for approachability and comprehension when the reader scans, not reads paragraphs.
 */
export function display(size: number, color = C.ink): TextStyle {
  return {
    fontFamily: F.bodyBold, fontSize: size, color,
    letterSpacing: size > 24 ? -0.4 : -0.2,
  };
}

/** A small uppercase field label ("SEND TO", "PRICE"). */
export const label: TextStyle = {
  fontFamily: F.dispSemi, fontSize: 12, color: C.steel,
  textTransform: 'uppercase', letterSpacing: 1.6,
};

/** Money/numerals — tabular so digits don't jitter as they change. */
export const money: TextStyle = { fontFamily: F.disp, fontVariant: ['tabular-nums'] };

export const T = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.paper },
  card: {
    // The RAISED surface (#FFFDF8), not the flat card tone (#FBF8F1). Against the
    // cream page (#F5F1E8) the flat tone was one shade off the background and the
    // card boundary vanished, so RAW / SCOPE / READY-TO-SEND blurred into one field
    // instead of reading as three cards. The brighter surface is what separates them.
    backgroundColor: C.raised, borderColor: C.line, borderWidth: 1,
    borderRadius: radii.lg, padding: 14, marginBottom: 10, ...shadows.card,
  },
  body: { fontFamily: F.body, fontSize: 16, color: C.ink, lineHeight: 23 },
  bodySteel: { fontFamily: F.body, fontSize: 14, color: C.steel, lineHeight: 20 },
  // Buttons — 58px min height is the gloves floor (≥48dp, per the accessibility research).
  btn: { borderRadius: 14, minHeight: 58, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  btnOrange: { backgroundColor: C.orange },
  btnInk: { backgroundColor: C.ink },
  btnApprove: { backgroundColor: C.approve },
  btnGhost: { backgroundColor: 'transparent', minHeight: 50 },
  btnOff: { opacity: 0.4 },
  // Buttons read as a person wrote them ("Record extra work"), Barlow bold sentence-
  // case — the kit's own onboarding buttons do this. Caps stays for tiny labels only.
  btnText: { fontFamily: F.bodyBold, fontSize: 17, color: '#fff', letterSpacing: 0.2 },
  btnGhostText: { fontFamily: F.bodySemi, fontSize: 15.5, color: C.steel, letterSpacing: 0.2 },
  // Status chip — the angled cut is the prototype's signature (a cut ticket edge).
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4 },
  chipText: { fontFamily: F.dispSemi, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: '#fff' },
});

/**
 * Tint triple by tone — the same one-place rule as `chipStyle`, applied to the
 * coloured state BOXES instead of the chips. A screen never mixes its own amber.
 */
export type Tone = keyof typeof statusTints;
export function tint(tone: Tone) { return statusTints[tone]; }

/** Chip colour by state — one place, so a status never means two things. */
export function chipStyle(kind: 'approved' | 'pending' | 'discuss' | 'ewa' | 'declined') {
  switch (kind) {
    case 'approved': return { bg: C.approve, fg: '#fff' };
    case 'pending':  return { bg: C.caution, fg: C.ink };  // dark ink reads best on muted ochre
    case 'discuss':  return { bg: C.ink, fg: '#fff' };
    case 'ewa':      return { bg: C.orange, fg: '#fff' };
    case 'declined': return { bg: C.danger, fg: '#fff' };
  }
}
