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
import { palette, radii, shadows } from './tokens';

export const C = {
  ink: palette.ink,             // #151A1E — primary text + dark primary buttons
  paper: palette.background,    // #F7F4EE — warm off-white app background
  card: palette.surface,        // #FFFDFC — cards / sheets
  surfaceMuted: palette.surfaceMuted, // #EFEBE3 — insets, neutral chips, pressed
  // `orange` is the historical name for THE accent; it now carries the OLIVE BRAND.
  orange: palette.brand,        // #4E6243 — capture/send/money accent (was #FF5A00)
  orangePress: palette.brandDark,
  brand: palette.brand,
  brandDark: palette.brandDark,
  brandSoft: palette.brandSoft, // #E7ECDD — brand-tinted fill (approved/selected bg)
  steel: palette.textSecondary, // #5E666E — secondary text
  line: palette.border,         // #D5D0C7 — hairlines/borders
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

/** Display text: uppercase + letterspacing is the look; don't hand-roll it. */
export function display(size: number, color = C.ink): TextStyle {
  return {
    fontFamily: F.disp, fontSize: size, color,
    textTransform: 'uppercase', letterSpacing: size > 24 ? 0.5 : 1,
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
    backgroundColor: C.card, borderColor: C.line, borderWidth: 1,
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
  btnText: { fontFamily: F.disp, fontSize: 19, color: '#fff', textTransform: 'uppercase', letterSpacing: 1 },
  btnGhostText: { fontFamily: F.dispSemi, fontSize: 16, color: C.steel, textTransform: 'uppercase', letterSpacing: 1 },
  // Status chip — the angled cut is the prototype's signature (a cut ticket edge).
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4 },
  chipText: { fontFamily: F.dispSemi, fontSize: 12.5, textTransform: 'uppercase', letterSpacing: 1.2, color: '#fff' },
});

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
