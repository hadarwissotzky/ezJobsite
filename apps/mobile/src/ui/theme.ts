/**
 * Design tokens — the EZjobsite visual language, lifted from the UI prototype.
 *
 * Why a condensed display face and an orange: this is a tool used in gloves, in
 * sunlight, by someone who is not going to read a paragraph. Big condensed uppercase
 * for anything that must be *recognised* (labels, actions, money); a normal humanist
 * face for anything that must be *read* (scope text, questions). One loud accent so
 * "the thing to tap" is never ambiguous.
 *
 * Use these instead of ad-hoc hex values so the app reads as one product.
 */
import { StyleSheet, TextStyle } from 'react-native';

export const C = {
  ink: '#0D0F12',          // near-black: primary text + primary buttons
  paper: '#FAFAF8',        // app background (warm off-white, not clinical)
  card: '#FFFFFF',
  orange: '#FF5A00',       // THE accent. Capture, send, anything that moves money.
  orangePress: '#E04E00',
  steel: '#5C6570',        // secondary text
  line: '#E4E5E1',         // hairlines/borders
  approve: '#0E8A4C',      // approved / confirmed
  caution: '#F5B000',      // waiting / pending
  danger: '#C6281C',       // recording, declined, destructive
  inkSoft: '#2A2E33',
  onDark: '#AEB4BD',       // secondary text on ink backgrounds
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
    borderRadius: 16, padding: 14, marginBottom: 10,
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
    case 'pending':  return { bg: C.caution, fg: C.ink };
    case 'discuss':  return { bg: C.ink, fg: '#fff' };
    case 'ewa':      return { bg: C.orange, fg: '#fff' };
    case 'declined': return { bg: C.danger, fg: '#fff' };
  }
}
