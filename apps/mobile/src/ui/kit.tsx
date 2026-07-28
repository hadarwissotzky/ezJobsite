/**
 * The shared UI kit — the primitives every screen was re-hand-rolling.
 *
 * WHY THIS FILE EXISTS. `theme.ts` shipped STYLES (`T.card`, `T.btn`) but no
 * COMPONENTS, so every screen rebuilt the same Pressable/Text/View tree by hand and
 * each one drifted a little: three different ambers for "needs attention", four
 * different button heights, two different secondary buttons, a back control invented
 * per screen. Three sibling screens are about to be written independently for the
 * three lifecycle stages (SPEC-extra-lifecycle-v1 §2/§3/§4); without one set of
 * primitives they would ship as three products that happen to share a database.
 *
 * THE RULES THIS FILE ENFORCES SO THE SCREENS DO NOT HAVE TO REMEMBER THEM:
 *  - Touch targets. 48pt minimum for anything tappable, 58pt for a button
 *    (`touchTargets`, mandate #3 — gloves on, on a ladder). A component here cannot
 *    be made smaller than its floor by a caller; there is no size prop.
 *  - Weight goes through `fontFamily`, NEVER `fontWeight`. `fontWeight` on a named
 *    family silently no-ops on Android, so a mis-weighted label looks correct on the
 *    reviewer's iPhone and wrong on half the field devices (voicepricecard.tsx:107).
 *  - Colour comes from `C` / `tint()` / `palette` only. No hex literal below this
 *    header. A tone that had no token got one (`statusTints` in tokens.ts).
 *  - Colour never carries meaning alone (kit rule): `StatusBanner` and `ChecklistRow`
 *    always draw an icon or a mark beside the words.
 *
 * THIS FILE OWNS NO STRINGS. Every text prop is an ALREADY-TRANSLATED string; the kit
 * does not import `i18n`. A primitive that reached for a key would decide the wording
 * of a legal record from inside a layout component, and mandate #5 puts that decision
 * on the screen that knows what it is saying.
 */
import React from 'react';
import {
  Image, Pressable, StyleSheet, Text, View,
  type StyleProp, type ViewStyle,
} from 'react-native';
// The app's ONE audio player (annotate.ts). `VoiceClip` below is the only primitive
// here that talks to a device capability, and it does so through the same module the
// rest of the app does — a second player would let two clips sound at once.
import { playCapture, playbackState, stopPlayback } from '../annotate';
import { Icon, type IconName } from './icon';
import { C, F, T, chipStyle, display, label as labelStyle, tint } from './theme';
import { radii, touchTargets } from './tokens';

/* ---------------------------------------------------------------- surfaces -- */

/** The standard surface. `style` is the escape hatch for layout only (margins,
 *  flex) — a caller that recolours it has forked the card, which is the drift this
 *  file exists to stop. */
export function Card({ children, style }: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[T.card, style]}>{children}</View>;
}

/** An uppercase label heading over a grouped card — "RAW COLLECTED INFORMATION",
 *  "SCOPE OF WORK (SENT TO CLIENT)", "APPROVAL RECORD". The heading sits OUTSIDE the
 *  card on purpose: it names the group, it is not a row inside it. */
export function Section({ title, children, style }: {
  title: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={style}>
      <Text style={[labelStyle, st.sectionTitle]}>{title}</Text>
      <View style={T.card}>{children}</View>
    </View>
  );
}

/* -------------------------------------------------------------------- rows -- */

/** How a Row's right-hand value reads. `warn` is the D3 recommended-but-missing
 *  case ("Payment timing — Not set"): it must look unfinished without looking
 *  broken, because nothing in that list may block Send. */
export type RowTone = 'default' | 'warn' | 'danger';

/**
 * Icon + label + optional right-hand value + optional chevron, tappable or static.
 * The single most repeated element in the three screens.
 *
 * A pressable row is 56pt and a static one 48pt — both above the `touchTargets`
 * floor, so a row that later grows an `onPress` does not need re-measuring.
 */
export function Row({
  icon, label, sub, value, tone = 'default', chevron, onPress, accessibilityLabel,
}: {
  icon?: IconName;
  label: string;
  sub?: string;
  /** Right-hand value, already formatted (money by `money()`, dates by the caller). */
  value?: string;
  tone?: RowTone;
  chevron?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const valueColor = tone === 'warn' ? tint('caution').ink
    : tone === 'danger' ? C.danger : C.ink;
  const body = (
    <>
      {icon && <View style={st.rowIcon}><Icon name={icon} size={22} color={C.brand} /></View>}
      <View style={{ flex: 1 }}>
        <Text style={st.rowLabel}>{label}</Text>
        {sub != null && <Text style={st.rowSub}>{sub}</Text>}
      </View>
      {value != null && (
        <Text style={[st.rowValue, { color: valueColor }]} numberOfLines={2}>{value}</Text>
      )}
      {chevron && <Text style={st.chev}>›</Text>}
    </>
  );
  if (!onPress) return <View style={[st.row, st.rowStatic]}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => [st.row, pressed && st.pressed]}
    >
      {body}
    </Pressable>
  );
}

/**
 * The ready-to-send checklist mark (D3). Three states, and the difference between
 * two of them is the whole of D3: `blocking` is DESCRIPTION or COST, the only things
 * that may disable Send; `missing` is a recommended item, which warns and is sent
 * anyway. They are drawn differently so nobody reads a recommendation as a wall.
 */
export type ChecklistState = 'done' | 'missing' | 'blocking';

export function ChecklistRow({ state, label, hint, onPress }: {
  state: ChecklistState;
  label: string;
  /** The plain-language consequence ("client won't see photos"). Coloured by state. */
  hint?: string;
  /** Jump to the field that fixes it. Omit for a static checklist. */
  onPress?: () => void;
}) {
  const tone = state === 'done' ? 'approved' : state === 'blocking' ? 'danger' : 'caution';
  const hintColor = state === 'done' ? C.steel : tint(tone).ink;
  const body = (
    <>
      {/* The mark, never colour alone: a filled check for done, a hollow ring for
          anything still owed — legible to a colour-blind reader in sunlight. */}
      {state === 'done'
        ? <Icon name="approved" size={22} color={C.approve} />
        : <View style={[st.ring, { borderColor: tint(tone).line }]} />}
      <View style={{ flex: 1 }}>
        <Text style={st.rowLabel}>{label}</Text>
        {hint != null && <Text style={[st.rowSub, { color: hintColor }]}>{hint}</Text>}
      </View>
      {onPress && <Text style={st.chev}>›</Text>}
    </>
  );
  if (!onPress) return <View style={[st.row, st.rowStatic]}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [st.row, pressed && st.pressed]}
    >
      {body}
    </Pressable>
  );
}

/**
 * Avatar disc + name + role. `photoUri` wins when present; otherwise initials, so a
 * person always has a mark and a roster never shows an empty grey circle.
 *
 * NAME COLLISION, read before importing: `recordpeople.ts` already exports a TYPE
 * called `PersonRow` (the assembled actor fact), and `recordfacts.tsx` imports it. A
 * screen that needs both must alias one — `import { PersonRow as PersonRowView }` —
 * or TypeScript merges them into one symbol and the error points at the import, not
 * at the cause.
 */
export function PersonRow({ name, role, photoUri, kind = 'other' }: {
  name: string;
  /** "Approver", "Crew" — the already-translated role word, not a slug. */
  role?: string;
  photoUri?: string | null;
  /** Disc colour. `approver` is the one that carries authority (D4), so it is the
   *  one that reads differently. */
  kind?: 'approver' | 'crew' | 'other';
}) {
  const bg = kind === 'approver' ? C.approve : kind === 'crew' ? C.brand : C.ink;
  return (
    <View style={st.person}>
      {photoUri
        ? <Image source={{ uri: photoUri }} style={st.avatar} />
        : (
          <View style={[st.avatar, { backgroundColor: bg }]}>
            <Text style={st.avatarT}>{initials(name)}</Text>
          </View>
        )}
      <View style={{ flex: 1 }}>
        <Text style={st.rowLabel}>{name}</Text>
        {role != null && <Text style={st.rowSub}>{role}</Text>}
      </View>
    </View>
  );
}

/** Initials for the avatar — the same rule recordfacts.tsx already uses, so one
 *  person does not get two different marks on two screens. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** One event on the history / approval-record timeline. Draws its own dot and
 *  connector so it can sit directly inside a Section with no wrapper — the rail on
 *  the container was the thing every screen re-invented at a different inset. */
export function TimelineRow({ at, what, hot, last }: {
  /** Already formatted by the caller. A time that was never recorded is SAID by the
   *  caller, never invented here (record.ts's rule). */
  at: string;
  what: string;
  /** The event that matters right now — the timestamp takes the accent. */
  hot?: boolean;
  /** Suppresses the trailing connector on the final row. */
  last?: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row' }}>
      <View style={st.rail}>
        <View style={[st.dot, { backgroundColor: hot ? C.orange : C.line }]} />
        {!last && <View style={st.railLine} />}
      </View>
      <View style={{ flex: 1, paddingLeft: 10, paddingBottom: last ? 0 : 16 }}>
        <Text style={[st.stamp, { color: hot ? C.orange : C.steel }]}>{at}</Text>
        <Text style={st.timelineWhat}>{what}</Text>
      </View>
    </View>
  );
}

/* ----------------------------------------------------------------- banners -- */

/**
 * The coloured state box at the top of each stage — amber "DRAFT · NOT SENT",
 * neutral "WAITING ON SARAH", green "SIGNED & APPROVED".
 *
 * `kind` is `displayStatus`'s OWN vocabulary (REQ-LC5), not a tone, so a screen
 * writes `<StatusBanner kind={shown} …/>` and the state→colour mapping lives in
 * exactly one place — the same rule `chipStyle` follows. `draft` and `discussing`
 * deliberately share the amber: both mean "you owe the next move", and the title
 * says which, because colour never carries status alone.
 */
const BANNER = {
  draft:      { tone: 'caution',  icon: 'edit' },
  sent:       { tone: 'neutral',  icon: 'waiting' },
  discussing: { tone: 'caution',  icon: 'reply' },
  approved:   { tone: 'approved', icon: 'approved' },
  declined:   { tone: 'danger',   icon: 'failed' },
  superseded: { tone: 'neutral',  icon: 'history' },
} as const;

export type BannerKind = keyof typeof BANNER;

export function StatusBanner({ kind, title, detail }: {
  kind: BannerKind;
  /** The loud line — "SIGNED & APPROVED". Rendered uppercase. */
  title: string;
  /** The plain-language line under it — what is true now and what is owed next
   *  (REQ-LC24). Omit only when the title already says both. */
  detail?: string;
}) {
  const { tone, icon } = BANNER[kind];
  const c = tint(tone);
  return (
    <View style={[st.banner, { backgroundColor: c.soft, borderColor: c.line }]}>
      <Icon name={icon} size={22} color={c.ink} />
      <View style={{ flex: 1 }}>
        <Text style={[st.bannerTitle, { color: c.ink }]}>{title}</Text>
        {detail != null && (
          <Text style={[st.bannerDetail, { color: c.ink }]}>{detail}</Text>
        )}
      </View>
    </View>
  );
}

/** The status chip, as a component. `chipStyle` already owned the colours; every
 *  screen still rebuilt the two-element tree around it. */
export function Chip({ kind, label }: {
  kind: Parameters<typeof chipStyle>[0];
  label: string;
}) {
  const c = chipStyle(kind);
  return (
    <View style={[T.chip, { backgroundColor: c.bg }]}>
      <Text style={[T.chipText, { color: c.fg }]}>{label}</Text>
    </View>
  );
}

/* ----------------------------------------------------------------- actions -- */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

/**
 * The one button. Every variant is 58pt tall — `T.btn`'s gloves floor, mandate #3 —
 * including `ghost`, because a quiet action is not a smaller target than a loud one.
 * There is no size prop; a caller that needs a button to be shorter needs a Row.
 *
 * `style` exists for layout only, and in practice for exactly one thing: `{flex:1}`
 * when two buttons share a bar.
 */
export function Button({
  label, onPress, variant = 'primary', icon, disabled, style, accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const fg = variant === 'primary' ? C.card
    : variant === 'secondary' ? C.brand
    : variant === 'danger' ? C.danger
    : C.steel;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => [
        T.btn, st.btn, st[variant], disabled && T.btnOff,
        pressed && !disabled && st.pressed, style,
      ]}
    >
      {icon && <Icon name={icon} size={20} color={fg} />}
      <Text style={[st.btnText, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

/** Back control + title, with the status-bar clearance this app has re-derived on
 *  every screen (54pt — without it the back control renders under the iPhone clock,
 *  which shipped once already and left a screen with no way out). */
export function ScreenHeader({ title, onBack, backLabel, right }: {
  title: string;
  onBack: () => void;
  /** Already translated ("Back"). Used as the accessibility label too. */
  backLabel: string;
  /** A Chip, usually. Sits opposite the title. */
  right?: React.ReactNode;
}) {
  return (
    <View style={st.header}>
      <Pressable
        onPress={onBack}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel={backLabel}
        style={st.back}
      >
        <Text style={st.backT}>‹ {backLabel}</Text>
      </Pressable>
      <View style={st.headerRow}>
        <Text style={[display(22), { flex: 1 }]} numberOfLines={3}>{title}</Text>
        {right}
      </View>
    </View>
  );
}

/* -------------------------------------------------------------------- media -- */

/** One tile in the evidence grid. `present` is mandate #1's honesty flag: a file the
 *  row promises but the device does not have is SHOWN as missing, never as a blank
 *  square, because a blank square is silent loss. */
export type PhotoTile = {
  key: string;
  uri: string;
  present: boolean;
  /** The stamp under the tile — time/place, already formatted. */
  caption?: string;
};

/** The 86pt tile grid, with the dashed "+ Add more" tile at the end. */
export function PhotoGrid({
  photos, missingLabel, onPressPhoto, onAddMore, addLabel,
}: {
  photos: readonly PhotoTile[];
  /** Already translated. REQUIRED, not optional: a grid that could not name a
   *  missing file would render it as an empty tile, which is the one failure
   *  mandate #1 calls unforgivable. */
  missingLabel: string;
  onPressPhoto?: (photo: PhotoTile) => void;
  /** Omit to render no add-tile — a frozen record's evidence cannot grow. */
  onAddMore?: () => void;
  addLabel?: string;
}) {
  return (
    <View style={st.grid}>
      {photos.map((p) => (
        <View key={p.key}>
          <PhotoTileView photo={p} missingLabel={missingLabel} onPress={onPressPhoto} />
          {p.caption != null && <Text style={st.tileCaption}>{p.caption}</Text>}
        </View>
      ))}
      {onAddMore && (
        <Pressable
          onPress={onAddMore}
          accessibilityRole="button"
          accessibilityLabel={addLabel ?? '+'}
          style={({ pressed }) => [st.tile, st.addTile, pressed && st.pressed]}
        >
          <Icon name="camera" size={22} color={C.steel} />
          {addLabel != null && <Text style={st.addT}>{addLabel}</Text>}
        </Pressable>
      )}
    </View>
  );
}

/** A tile that admits when it cannot be decoded. The file existed when the row was
 *  read; decode can still fail (truncated write, codec), and a grey square would
 *  quietly claim the evidence is fine. */
function PhotoTileView({ photo, missingLabel, onPress }: {
  photo: PhotoTile;
  missingLabel: string;
  onPress?: (photo: PhotoTile) => void;
}) {
  const [failed, setFailed] = React.useState(false);
  if (!photo.present || failed) {
    return (
      <View style={[st.tile, st.tileMissing]}>
        <Text style={st.tileMissingT}>{missingLabel}</Text>
      </View>
    );
  }
  const img = (
    <Image
      source={{ uri: photo.uri }}
      onError={() => setFailed(true)}
      style={st.tile}
      resizeMode="cover"
    />
  );
  if (!onPress) return img;
  return (
    <Pressable onPress={() => onPress(photo)} accessibilityRole="imagebutton">
      {img}
    </Pressable>
  );
}

/* --------------------------------------------------------------------- voice -- */

/**
 * Play one voice capture.
 *
 * WHY IT EXISTS AGAIN. The redesign dropped playback from the whole app: HEAD's
 * record screen rendered a player per clip, the four screens that replaced it render
 * the TRANSCRIPT ONLY, and the only other player left in the codebase sits behind a
 * `viewer` state nothing ever sets. On a voice-led, offline-forward product that
 * means a contractor who records forty seconds in a basement — where `transcript` is
 * null because there is no signal for STT — has no way at all to hear the capture
 * that is sitting on the phone in his hand. The transcript is DERIVED; the audio is
 * the record (mandate #7, and record.ts's own note on `RecordVoice`).
 *
 * ONE SHARED PLAYER, and the polling is what enforces it: `annotate.ts` is
 * single-player by design, so a second clip stops the first, and each mounted clip
 * compares `playbackState().uri` to its own to know whether it is the one sounding.
 * Without that comparison every clip on a multi-note record mirrors whichever one is
 * playing.
 *
 * NO i18n IN HERE — the file header's rule. Words arrive as props from the screen
 * that knows what it is saying.
 */
export function VoiceClip({ uri, present, playLabel, missingLabel }: {
  uri: string;
  present: boolean;
  /** Accessible name for the play control, and the placeholder before a duration is
   *  known. */
  playLabel: string;
  /** Mandate #1: audio that is gone SAYS it is gone, and is never a dead button. */
  missingLabel: string;
}) {
  const [playing, setPlaying] = React.useState(false);
  const [pos, setPos] = React.useState(0);
  const [dur, setDur] = React.useState(0);

  // Leaving the screen stops the sound. Without this the clip keeps playing over
  // whatever the contractor navigated to.
  React.useEffect(() => () => { stopPlayback(); }, []);

  React.useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const s = playbackState();
      if (s.uri !== uri) { setPlaying(false); setPos(0); return; }
      if (s.durationSec > 0) setDur(s.durationSec);
      setPos(s.positionSec);
      // expo-audio flips `playing` false at the tail; treat that as ended.
      if (!s.playing && s.positionSec > 0) { stopPlayback(); setPlaying(false); setPos(0); }
    }, 250);
    return () => clearInterval(id);
  }, [playing, uri]);

  if (!present) {
    return <Text style={[T.body, { fontSize: 13.5, color: C.danger, marginTop: 6 }]}>{missingLabel}</Text>;
  }

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const pct = dur > 0 ? Math.min(100, (pos / dur) * 100) : 0;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 12 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={playLabel}
        onPress={async () => {
          if (playing) { stopPlayback(); setPlaying(false); setPos(0); return; }
          const r = await playCapture(uri);
          if (r.ok) { setDur(r.durationSec || dur); setPlaying(true); }
        }}
        style={{
          width: touchTargets.minimum, height: touchTargets.minimum,
          borderRadius: touchTargets.minimum / 2, backgroundColor: C.ink,
          alignItems: 'center', justifyContent: 'center',
        }}>
        <Text style={{ color: '#fff', fontSize: 19 }}>{playing ? '❚❚' : '▶'}</Text>
      </Pressable>
      <View style={{ flex: 1 }}>
        <View style={{ height: 6, borderRadius: 3, backgroundColor: C.line, overflow: 'hidden' }}>
          <View style={{ width: `${pct}%`, height: 6, backgroundColor: C.orange }} />
        </View>
        <Text style={[T.bodySteel, { fontSize: 12, marginTop: 6, fontVariant: ['tabular-nums'] }]}>
          {(playing || pos > 0) ? `${fmt(pos)} / ${fmt(dur)}` : (dur > 0 ? fmt(dur) : playLabel)}
        </Text>
      </View>
    </View>
  );
}

/* -------------------------------------------------------------------- styles -- */

const TILE = 86;

const st = StyleSheet.create({
  sectionTitle: { marginTop: 18, marginBottom: 8 },

  // 56 pressable / 48 static — both clear `touchTargets.minimum`, so adding an
  // onPress to a row later never silently drops it under the gloves floor.
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    minHeight: touchTargets.minimum + 8, paddingVertical: 6,
  },
  rowStatic: { minHeight: touchTargets.minimum },
  rowIcon: { width: 26, alignItems: 'center' },
  rowLabel: { fontFamily: F.bodySemi, fontSize: 16, color: C.ink },
  rowSub: { fontFamily: F.body, fontSize: 13, color: C.steel, marginTop: 1, lineHeight: 18 },
  rowValue: { fontFamily: F.bodySemi, fontSize: 15, textAlign: 'right', maxWidth: '46%' },
  chev: { fontFamily: F.body, fontSize: 24, color: C.steel, marginLeft: 2 },
  pressed: { opacity: 0.6 },

  ring: { width: 22, height: 22, borderRadius: 11, borderWidth: 2.5 },

  person: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: touchTargets.minimum },
  avatar: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center', backgroundColor: C.surfaceMuted,
  },
  avatarT: { fontFamily: F.disp, fontSize: 14, color: C.card },

  rail: { width: 16, alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
  railLine: { flex: 1, width: 2, backgroundColor: C.line, marginTop: 3 },
  stamp: {
    fontFamily: F.dispSemi, fontSize: 11.5, letterSpacing: 1, textTransform: 'uppercase',
  },
  timelineWhat: { fontFamily: F.body, fontSize: 15, color: C.ink, lineHeight: 21, marginTop: 1 },

  banner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    borderRadius: radii.md, borderWidth: 1, padding: 14, marginBottom: 10,
  },
  bannerTitle: {
    fontFamily: F.dispSemi, fontSize: 15, textTransform: 'uppercase', letterSpacing: 1.3,
  },
  bannerDetail: { fontFamily: F.body, fontSize: 14.5, lineHeight: 20, marginTop: 4 },

  btn: { gap: 8, paddingHorizontal: 16 },
  btnText: { fontFamily: F.bodyBold, fontSize: 17, letterSpacing: 0.2 },
  primary: { backgroundColor: C.ink },
  secondary: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: C.brand },
  ghost: { backgroundColor: 'transparent' },
  danger: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: C.danger },

  header: { paddingTop: 54 },
  back: {
    minHeight: touchTargets.minimum, justifyContent: 'center',
    alignSelf: 'flex-start', paddingRight: 24,
  },
  backT: { ...labelStyle, fontSize: 15, color: C.orange },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 3 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: {
    width: TILE, height: TILE, borderRadius: radii.sm,
    backgroundColor: C.surfaceMuted, borderWidth: 1, borderColor: C.line,
  },
  tileMissing: {
    backgroundColor: tint('danger').soft, borderColor: C.danger,
    alignItems: 'center', justifyContent: 'center', padding: 4,
  },
  tileMissingT: { fontFamily: F.dispSemi, fontSize: 9.5, color: C.danger, textAlign: 'center' },
  tileCaption: { fontFamily: F.body, fontSize: 10.5, color: C.steel, marginTop: 3 },
  addTile: {
    borderWidth: 1.5, borderColor: C.line, borderStyle: 'dashed',
    backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center', gap: 4,
  },
  addT: { fontFamily: F.body, fontSize: 10.5, color: C.steel },
});
