/**
 * The console's visual language — the SAME one the phone uses.
 *
 * Every value here is copied from `apps/mobile/src/ui/tokens.ts`, which that file
 * calls "the SINGLE SOURCE for colour, spacing, radius, type, motion, and touch-target
 * values". This is a second surface reading the same design, not a second design: a
 * manager who opens the console after using the app should recognise it instantly, and
 * a status colour that means "waiting" on the phone must not mean anything else here.
 *
 * NOT vendored-and-diffed like `shared/extrastatus.ts`. That file is a RULE and two
 * copies of a rule can silently disagree about what a record means. This is a palette:
 * the web needs values the React Native file cannot express (hover states, focus rings,
 * a cursor) and does not need the ones it does (elevation, touch targets at 58px). A
 * byte comparison would fail on the first legitimate difference and teach everyone to
 * ignore it.
 *
 * WHAT MOVED, AND WHY, coming from the phone:
 *   · Controls are 40px, not the phone's 58px gloves floor. The floor exists because
 *     the app is used one-handed on a ladder with gloves on; a mouse at a desk has
 *     none of those problems and a 58px row wastes a third of the screen.
 *   · The page is denser: 15px body against the phone's 17px, because a desk screen is
 *     read at 60cm and a phone at 30.
 *   · Everything else — the warm cream, the olive brand, the muted status colours — is
 *     identical, deliberately.
 */

/** Raw palette. Copied from tokens.ts's `palette`; see that file for the reasoning. */
export const C = {
  /** Warm cream app background. The page should feel WARM CREAM, NOT PURE WHITE. */
  paper: '#F5F1E8',
  /** Cards / sheets — cream, never white. */
  card: '#FBF8F1',
  /** A surface above a card. What separates a card from the page. */
  raised: '#FFFDF8',
  /** Insets, pressed states, neutral chips. */
  surfaceMuted: '#EFEBE3',
  /** Primary text + primary (dark) action. */
  ink: '#161918',
  /** Secondary text. Green-grey, NOT blue-grey — that drift is called out in tokens.ts. */
  steel: '#555B57',
  /** Metadata — timestamps, counts, section headings. */
  muted: '#777C78',
  /** Disabled labels. NEVER for information a user needs. */
  disabled: '#A4A7A3',
  /** Dividers / hairlines / card borders. */
  line: '#D8D1C4',
  /** A hairline INSIDE a card, one step lighter than `line`. Web-only. */
  lineSoft: '#E6E0D4',
  /** The brand accent. */
  brand: '#506A45',
  brandDark: '#354B31',
  brandSoft: '#E8EEE2',
  brandLine: '#B9C6AF',
  /** Status. Muted on purpose, and ALWAYS paired with an icon or a word: colour never
   *  carries status alone (tokens.ts). */
  approve: '#536B49',
  caution: '#A47A3F',
  danger: '#8B5148',
  noSignal: '#4F565D',
  savedLocal: '#6D7F89',
  syncing: '#718796',
  /** Focus ring. The one thing the phone has no equivalent for. */
  focus: '#1F2933',
} as const;

/**
 * Status TINTS — the soft fill · hairline · text triple for a coloured state box.
 * From tokens.ts's `statusTints`, for the same reason it gives: the same "something
 * needs attention" box was hand-mixed four different ways and the SAME state read as a
 * different severity on each screen.
 */
export const tint = {
  caution: { soft: '#FFF3EA', line: '#FFD9C2', ink: '#7A3A12' },
  approved: { soft: C.brandSoft, line: '#C3D0B4', ink: C.brandDark },
  danger: { soft: '#F6E5E1', line: '#DDBAB2', ink: '#6B372F' },
  neutral: { soft: C.surfaceMuted, line: C.line, ink: C.ink },
} as const;

export type Tone = keyof typeof tint;

export const radii = { sm: 8, md: 12, lg: 18, xl: 24, pill: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const F = {
  /** What a person actually reads. */
  body: "Barlow, system-ui, -apple-system, sans-serif",
  /** Labels, actions, numbers. Condensed. */
  disp: "'Barlow Condensed', 'Arial Narrow', system-ui, sans-serif",
} as const;

/** The one card shadow — soft, warm, low. */
export const shadow = { card: '0 4px 12px rgba(0, 0, 0, 0.06)' } as const;

/**
 * Chip colour by state — one place, so a status never means two things.
 *
 * Mirrors `theme.ts`'s `chipStyle` on the phone and adds the two the ledger can show
 * that the phone's five-case switch never had a colour for. `pending` keeps dark ink
 * on the muted ochre: white on #A47A3F is 2.6:1 and unreadable in sunlight, which is
 * the note the mobile file leaves beside the same line.
 */
export function chipStyle(kind: string): { bg: string; fg: string; line?: string } {
  switch (kind) {
    case 'approved': return { bg: C.approve, fg: '#fff' };
    case 'sent': return { bg: C.caution, fg: C.ink };
    case 'discussing': return { bg: C.ink, fg: '#fff' };
    case 'declined': return { bg: C.danger, fg: '#fff' };
    // Retired states read as retired: no fill, so they recede beside a live row
    // instead of competing with it for the same attention.
    case 'superseded':
    case 'cancelled': return { bg: C.surfaceMuted, fg: C.steel, line: C.line };
    case 'draft':
    default: return { bg: C.surfaceMuted, fg: C.ink, line: C.line };
  }
}

/**
 * What a chip SAYS. The phone returns an i18n key (`co.chip.<status>`) because it
 * renders in the reader's language; the console is English-only for now and says so
 * here rather than pulling the 227KB mobile i18n bundle into a web build for seven
 * strings.
 *
 * The words are the mobile ones, not new inventions — "Waiting on client" rather than
 * "Sent" because that is what the state means to the person reading it.
 */
export const CHIP_LABEL: Record<string, string> = {
  draft: 'Draft',
  sent: 'Waiting on client',
  discussing: 'In discussion',
  approved: 'Approved',
  declined: 'Declined',
  superseded: 'Replaced',
  cancelled: 'Withdrawn',
};
