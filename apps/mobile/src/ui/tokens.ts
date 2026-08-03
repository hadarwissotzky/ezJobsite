/**
 * EZChangeOrder design tokens — the canonical visual language, from the approved
 * design kit (EZChangeOrder_Design_System, 2026-07-26). This is the SINGLE SOURCE for
 * colour, spacing, radius, type, motion, and touch-target values; `theme.ts` builds
 * the semantic layer (C/F/T, buttons, chips) on top of these.
 *
 * The system: a warm, high-contrast FIELD light theme (no dark mode on site). Ink is
 * the primary action; olive is the brand; status colours are muted and always paired
 * with an icon + plain-language label (colour never carries status alone).
 */

/**
 * Raw palette — hadar's tokens, verbatim (2026-07-28).
 *
 * These REPLACE the previous set, which was close enough to look intentional and
 * wrong enough to never match the design. The drift ran one way: every neutral was
 * a shade BLUER than the spec. Secondary text was `#5E666E` against a specified
 * `#555B57` — blue-grey where the design is green-grey — and the card was `#FFFDFC`,
 * effectively white, against a specified `#FBF8F1` cream. On a warm-cream page a
 * blue-grey label reads as a different family of colour, which is why the screens
 * kept looking off after each individual fix.
 *
 * The page should feel WARM CREAM, NOT PURE WHITE. That is the whole rule.
 */
export const palette = {
  background: '#F5F1E8',   // warm cream app background
  surface: '#FBF8F1',      // cards / sheets — cream, never white
  surfaceRaised: '#FFFDF8',// raised surface above a card (sheets, popovers)
  surfaceMuted: '#EFEBE3', // insets, pressed states, neutral chips
  ink: '#161918',          // primary text + primary (dark) action
  textSecondary: '#555B57',// secondary text
  textMuted: '#777C78',    // metadata — timestamps, counts, section headings
  textDisabled: '#A4A7A3', // disabled labels. NEVER for information a user needs.
  border: '#D8D1C4',       // dividers / hairlines / card borders
  brand: '#506A45',        // green — the brand accent (selected, brand action)
  brandDark: '#354B31',    // pressed brand
  brandSoft: '#E8EEE2',    // brand-tinted fill (approved chip bg, selected chip bg)
  brandBorder: '#B9C6AF',  // hairline on a brand-tinted surface
  statusNoSignal: '#4F565D',   // charcoal — offline
  statusSavedLocal: '#6D7F89',  // blue-grey — saved on this phone
  statusSyncing: '#718796',     // steel — sending
  statusWaiting: '#A47A3F',     // muted ochre — waiting for a yes
  statusApproved: '#536B49',    // muted forest — approved
  statusFailed: '#8B5148',      // muted brick — could not send
  focus: '#1F2933',        // focus ring
} as const;

/**
 * Status TINTS — the soft fill · hairline · text triple for a coloured state box
 * (kit.tsx's StatusBanner and ChecklistRow, the missing-evidence tile).
 *
 * They exist because the same "something needs attention" box was hand-mixed four
 * different ways in the tree — `#FFF3EA/#FFD9C2/#7A3A12` on the record screen,
 * `#FFF7E0/#F0DE9E/#6B5300` on the voice-price card, `#FFF8C5/#D4A72C/#7D5E00` on the
 * thread, `#FBEAE7` for the broken photo — so the SAME state read as a different
 * severity on each screen it appeared on. One triple per family, warm enough to sit on
 * `background`, with `ink` dark enough to hold contrast against its own `soft` in
 * sunlight. `neutral` is not a new colour: it points at the existing greys so a plain
 * box and a tinted one are the same component with one lookup.
 */
export const statusTints = {
  // THE DESIGN'S PEACH (hadar, 2026-07-28). These three are the values the approved
  // mockup uses, and they were already in this repo — hardcoded into the old record
  // screen's state card, which is where they were verified against the design. The
  // tint table had a different, more olive tan (#F6EBD9/#E0C79B/#6E4E1F) mixed
  // independently, so the one screen that used the tokens looked wrong beside the
  // one that had not been migrated yet. Peach, not tan: it is warmer and much paler,
  // which is what lets the pills read as white on top of it.
  caution:  { soft: '#FFF3EA', line: '#FFD9C2', ink: '#7A3A12' },
  approved: { soft: palette.brandSoft, line: '#C3D0B4', ink: palette.brandDark },
  danger:   { soft: '#F6E5E1', line: '#DDBAB2', ink: '#6B372F' },
  neutral:  { soft: palette.surfaceMuted, line: palette.border, ink: palette.ink },
} as const;

/** Spacing scale (px). */
export const spacing = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 24, '2xl': 32, '3xl': 48,
} as const;

/** Corner radii (px). pill = fully rounded. */
export const radii = { sm: 8, md: 12, lg: 18, xl: 24, pill: 999 } as const;

/**
 * Type scale. Weight-based (not condensed): titles read in sentence case, only small
 * LABELS are uppercased (letterSpacing 1.1). Money is the loudest thing on a card.
 */
export const typography = {
  display: { fontSize: 34, lineHeight: 36, fontWeight: '800' },
  h1: { fontSize: 28, lineHeight: 32, fontWeight: '800' },
  h2: { fontSize: 22, lineHeight: 26, fontWeight: '700' },
  body: { fontSize: 17, lineHeight: 24, fontWeight: '400' },
  bodyStrong: { fontSize: 17, lineHeight: 24, fontWeight: '700' },
  label: { fontSize: 13, lineHeight: 16, fontWeight: '700', letterSpacing: 1.1 },
  money: { fontSize: 36, lineHeight: 40, fontWeight: '800' },
} as const;

/** Animation durations (ms). */
export const motion = { fast: 120, standard: 180, slow: 260 } as const;

/**
 * Touch targets (px). The whole design is gloves-first: primary actions are tall,
 * the capture control is the biggest thing on the screen.
 */
export const touchTargets = { minimum: 48, primary: 64, camera: 72, spacing: 12 } as const;

/** The one card shadow — soft, warm, low. */
export const shadows = {
  card: {
    shadowColor: '#000000', shadowOpacity: 0.06, shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 }, elevation: 2,
  },
} as const;
