/**
 * The EZChangeOrder icon set — the kit's 24 line icons (2026-07-26), rendered with
 * react-native-svg. Each is a `currentColor` stroke icon, so <Icon color> tints it.
 *
 * WHY SvgXml. The kit ships SVGs; SvgXml renders the raw markup and maps its `color`
 * prop onto `currentColor`, so one string per icon (verbatim from the kit) becomes a
 * sized, tintable RN component — no per-path transcription, no drift from the source.
 *
 * Pair every icon with a label (kit rule: colour never carries meaning alone). Sizes
 * are optically fine at 16/20/24; review at 32 before shipping large.
 */
import React from 'react';
import { Image } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { C } from './theme';

const ICONS = {
  video:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="13" height="14" rx="3"/><path d="M16 10l5-3v10l-5-3z"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/></svg>',
  waiting: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></svg>',
  approved: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12l2.5 2.5L16 9"/></svg>',
  approval: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3h12l4 4v14H4z"/><path d="M16 3v5h5"/><path d="M8 14l2.5 2.5L16 11"/></svg>',
  failed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg>',
  reply: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 7l-6 5 6 5v-3c5 0 8 1 12 5-1-7-5-10-12-10z"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L9 15"/><path d="M22 2l-7 20-4-9-9-4z"/></svg>',
  remind: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 00-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>',
  people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c0-4 2.5-6 6-6s6 2 6 6M14 15c3.5 0 6 1.5 7 5"/></svg>',
  person: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.4"/><path d="M5.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/></svg>',
  home:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10M9 20v-6h6v6"/></svg>',
  job: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M9 5V3h6v2M8 10h8M8 14h5"/></svg>',
  extra: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M3 12h18"/></svg>',
  offline: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8.8A15 15 0 0122 8.8M5 12.5a10 10 0 0114 0M8.5 16a5 5 0 017 0"/><path d="M3 3l18 18"/></svg>',
  savedLocal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h12l4 4v12H4z"/><path d="M8 4v6h8V4M8 16h8"/></svg>',
  sync: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7h-5V2"/><path d="M20 7a8 8 0 00-14-3M4 17h5v5"/><path d="M4 17a8 8 0 0014 3"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l4.5-1 10-10-3.5-3.5-10 10z"/><path d="M13.5 6.5l3.5 3.5"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
  history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 108-8"/><path d="M4 4v6h6"/><path d="M12 7v5l3 2"/></svg>',

  /** Resume. The ONE glyph with no kit artwork — hadar's set has pause but no play
   *  (the mockup never shows the resumed state). Traced to match the kit's weight;
   *  replace it if a real one ever ships. */
  play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4.5l12 7.5-12 7.5z"/></svg>',
  /** A gear, for the account/settings row. A generic primitive, not branded art. */
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.4 4.4l1.6 1.6M18 18l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.4 19.6l1.6-1.6M18 6l1.6-1.6"/></svg>',
  /** A stacked feed/list, for the Company Feed row. */
  feed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="5" rx="1.5"/><rect x="3.5" y="12.5" width="17" height="7" rx="1.5"/></svg>',
} as const;

/**
 * The kit artwork (hadar, 2026-07-27). These PNGs WIN over any same-named SVG above —
 * they are the approved drawings, the SVGs were only ever my transcriptions.
 *
 * They are pre-processed, not the raw drops in `assets/`: the originals are 1024×1536
 * with the glyph in a small centred island, so rendering one in a 22px slot put a ~10px
 * mark in the middle of a mostly-empty box. `assets/icons/*` are the same drawings
 * cropped to the glyph + 9% breathing room and downscaled to 128², with the background-
 * removal residue stripped (icon-flash.png in particular carried faint alpha across the
 * whole canvas). The raw drops are kept as the source of truth — regenerate, don't edit.
 */
const KIT = {
  camera: require('../../assets/icons/camera.png'),
  microphone: require('../../assets/icons/mic.png'),
  photo: require('../../assets/icons/photo.png'),
  mapPin: require('../../assets/icons/location.png'),
  flash: require('../../assets/icons/flash.png'),
  cameraFlip: require('../../assets/icons/flip.png'),
  close: require('../../assets/icons/close.png'),
  lock: require('../../assets/icons/lock.png'),
  pause: require('../../assets/icons/pause.png'),
  // The transition screen's set (hadar, 2026-07-27). PRE-COLOURED sage, unlike the
  // capture set — see NEVER_TINT below. `arrowCircle` draws its own ring, so it is
  // used bare rather than dropped inside a filled disc.
  hardhat: require('../../assets/icons/hardhat.png'),
  shield: require('../../assets/icons/shield.png'),
  arrowCircle: require('../../assets/icons/arrow.png'),
  checklist: require('../../assets/icons/checklist.png'),
} as const;

/**
 * Icons whose OWN colour is the artwork. `photo` is the only one: it is a painted
 * illustration (olive hills, ochre sun, cream frames), and running `tintColor` over it
 * flattens the whole thing to a single silhouette. Never tint it — pass it a `color`
 * and it is silently ignored rather than wrecked.
 */
const NEVER_TINT = new Set([
  'photo',
  // The transition set arrives already coloured in the kit's sage (#80917d–#a4af94),
  // lighter than C.brand on purpose. Tinting would both darken them and, in the hard
  // hat's case, flood its cream shell with the stroke colour — verified 2026-07-27,
  // the tinted hat renders as a solid blob. They are artwork, not glyphs.
  'hardhat', 'shield', 'arrowCircle', 'checklist',
]);

export type IconName = keyof typeof ICONS | keyof typeof KIT;

export function Icon({ name, size = 20, color = C.ink }: {
  name: IconName; size?: number; color?: string;
}) {
  const art = (KIT as Record<string, number | undefined>)[name];
  if (art != null) {
    return (
      <Image
        source={art}
        style={[{ width: size, height: size },
          NEVER_TINT.has(name as string) ? null : { tintColor: color }]}
        resizeMode="contain"
      />
    );
  }
  return <SvgXml xml={ICONS[name as keyof typeof ICONS]} width={size} height={size} color={color} />;
}
