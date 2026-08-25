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
  Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet,
  Text, TextInput, View,
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

/** An uppercase label heading for a grouped card — "RAW COLLECTED INFORMATION",
 *  "SCOPE OF WORK (SENT TO CLIENT)", "APPROVAL RECORD".
 *
 *  The heading sits INSIDE the card, as its first row above a hairline (hadar,
 *  2026-07-30). It used to float above the card; the design draws the card as one
 *  object whose first line names it, and an outside heading also cost a whole line
 *  of vertical space per section. */
export function Section({ title, children, style, action }: {
  title: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /**
   * An affordance pinned to the RIGHT of the title, on the same rule.
   *
   * Added 2026-08-24 so the scope of work could stop drawing its own furniture. It had
   * a title on the page background above a separate bordered box, because it needed an
   * Edit control beside the heading and this component had nowhere to put one — so it
   * copied the idea and diverged from it, which is what hadar saw: "scope of work is
   * outside of the section -- it is different [from] the whole design ... like price
   * and raw collection information sections".
   *
   * The fix is a slot here rather than a second card style there. One component draws
   * every section's title and rule, so they cannot drift again.
   */
  action?: React.ReactNode;
}) {
  return (
    <View style={[T.card, st.sectionCard, style]}>
      {action ? (
        <View style={st.sectionHeadRow}>
          {/* flex:1 so the title takes the room and the action keeps its size — the
              rule underneath must run the full width either way, which is why the
              border lives on the ROW here and on the text in the plain case. */}
          <Text style={[labelStyle, st.sectionTitleFlush]} numberOfLines={1}>{title}</Text>
          {action}
        </View>
      ) : (
        <Text style={[labelStyle, st.sectionTitleIn]}>{title}</Text>
      )}
      {children}
    </View>
  );
}

/**
 * A bottom drawer for ONE task (hadar, 2026-07-31).
 *
 * It replaces the catch-all editor: a contractor who taps "Impact on schedule" gets a
 * sheet about the schedule and nothing else, instead of a full-screen form holding
 * price, schedule, billing and exclusions at once. One field per sheet means the thing
 * he tapped is the thing in front of him, and Save writes the field he came to write.
 *
 * The dim behind it dismisses (a sheet must never trap someone), and the sheet itself
 * swallows taps so a press inside does not close it.
 *
 * THE KEYBOARD MUST NOT SIT ON THE FIELD (hadar, 2026-08-08: "if a text field is
 * edited by a keyboard the keyboard covers the whole text field — example: change
 * order, things not included").
 *
 * This sheet is anchored to the BOTTOM of the screen, which is exactly where the
 * keyboard opens. A ScrollView alone does not save it — the comment here used to
 * claim it did, and that was wrong: scrolling moves content INSIDE the sheet, and
 * the sheet itself was still underneath the keys. On a 13 mini the exclusions field
 * and the Save button were both completely covered, so the one act the sheet exists
 * for was unreachable while typing.
 *
 * `KeyboardAvoidingView` shrinks the container, and `sheetDim`'s `justifyContent:
 * 'flex-end'` then lands the sheet directly above the keyboard. `maxHeight: '88%'`
 * is a percentage of that shrunken box, so a tall sheet gives up height instead of
 * pushing its footer off-screen. Same `behavior` split as authscreen.tsx — one
 * keyboard strategy in the app, not two.
 */
export function BottomSheet({ visible, title, onClose, children, footer, tall, bottomAnchored,
                             stickToEnd }: {
  visible: boolean;
  /** Already translated. Names the ONE thing this sheet edits. */
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** The commit control, usually one Button. Pinned under the content. */
  footer?: React.ReactNode;
  /** Fill most of the screen. For sheets where CHOOSING is the task (a list of
   *  people): a short drawer shows three names and hides the rest behind a scroll
   *  nobody knows is there. A form sheet stays short — it should not grow to fit. */
  tall?: boolean;
  /**
   * Sit the content at the BOTTOM of the sheet, against the footer, instead of at the
   * top. For a conversation: three messages in a 90% sheet otherwise cling to the
   * header with a screenful of nothing under them, when the thing being read runs
   * upwards from the reply box. Content still scrolls once it outgrows the space.
   */
  bottomAnchored?: boolean;
  /**
   * Open on the END of the content and stay there as it grows — for a conversation,
   * where the newest message is the reason the sheet was opened at all.
   *
   * Added 2026-08-25 with the keyboard fix: the message sheet opened at the OLDEST
   * message, so a contractor tapping a client-question notification landed on the top
   * of a thread and had to scroll to find what he had been notified about. Opt-in,
   * because most sheets are a form and jumping them to the bottom would be wrong.
   */
  stickToEnd?: boolean;
}) {
  const sheetScroll = React.useRef<ScrollView>(null);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
      {/* THE DIM IS A SIBLING BEHIND THE PANEL, NOT ITS PARENT.
          (hadar, 2026-08-18 — reported twice, because my first fix was wrong.)

          The sheets did not scroll. First attempt removed an explicit
          `onStartShouldSetResponder={() => true}` from the panel and kept the panel as a
          Pressable, on the reasoning that its `onPress` was what stopped the dim closing.
          THAT DID NOT FIX IT: a <Pressable> claims the touch responder on touch START by
          design — that is how it detects a press at all — so the panel went on swallowing
          every drag before the ScrollView could see it. Removing the explicit claim while
          keeping the thing that makes the claim implicitly was no change at all.

          The real problem was the SHAPE: a dim that WRAPS the panel forces the panel to
          intercept, or every tap inside the sheet closes it. So the dim stops wrapping.
          It is now an absolutely-filled Pressable UNDER the panel, and the panel is a
          plain View that claims nothing. Tap outside -> the dim is what you hit -> close.
          Touch inside -> nothing above the ScrollView wants the gesture -> it scrolls. */}
      <View style={st.sheetDim}>
        {/* HIDDEN FROM VOICEOVER, not labelled: a full-screen unlabelled button is worse
            than none, and the sheet already has a titled ✕ that does the same thing. This
            file holds no copy of its own (every string arrives translated via props), so
            there is nothing here to label it WITH. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants" />
        <View style={[st.sheet, tall && st.sheetTall]}>
          <View style={st.sheetGrab} />
          <View style={st.sheetHead}>
            <Text style={st.sheetTitle}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" style={st.sheetX}>
              <Icon name="close" size={18} color={C.steel} />
            </Pressable>
          </View>
          <ScrollView
            ref={sheetScroll}
            onContentSizeChange={() => {
              // Covers both cases with one hook: the first layout when the sheet opens,
              // and every message appended while it is open.
              if (stickToEnd) sheetScroll.current?.scrollToEnd({ animated: false });
            }}
            style={st.sheetBody}
            contentContainerStyle={bottomAnchored
              ? { paddingBottom: 8, flexGrow: 1, justifyContent: 'flex-end' }
              : { paddingBottom: 8 }}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
          {footer && <View style={st.sheetFoot}>{footer}</View>}
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/**
 * A destructive confirmation, as a drawer (hadar, 2026-07-31).
 *
 * The shape is the design's: a close ✕ in the corner, a tinted badge holding the
 * alarm glyph, the act as a heading, one paragraph of CONSEQUENCE, then the
 * destructive button with Cancel under it.
 *
 * WHAT IT REPLACED: a full screen that scrolled. On a 13 mini the confirm button
 * had already once been pushed past the bottom edge — rendered, enabled, and
 * unreachable — and a destructive action nobody can reach is a worse failure than
 * an ugly one. A drawer is measured from the bottom, so the button is always where
 * the thumb already is.
 *
 * `body` is where the consequence goes, and it must be specific ("estimates go too,
 * invoices stay"): a warning that only says "are you sure?" teaches nothing and
 * trains people to tap through.
 */
export function ConfirmSheet({
  visible, title, body, confirmLabel, cancelLabel, onConfirm, onClose, busy,
}: {
  visible: boolean;
  /** Already translated. The ACT, named plainly ("Delete extra"). */
  title: string;
  /** What will actually happen. Specific, not "are you sure?". */
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  /** Disables both controls while the delete is in flight, so one tap is one delete. */
  busy?: boolean;
}) {
  // Built ON `BottomSheet` rather than beside it. A second hand-rolled Modal is a
  // second set of presentation bugs to find — and it found one immediately.
  return (
    <BottomSheet
      visible={visible}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button label={confirmLabel} variant="dangerFill" disabled={busy} onPress={onConfirm} />
          <Button label={cancelLabel} variant="secondary" disabled={busy}
            onPress={onClose} style={{ marginTop: 10 }} />
        </>
      }
    >
      <View style={st.confirmBody}>
        <View style={st.confirmBadge}>
          <Icon name="failed" size={30} color={C.danger} />
        </View>
        {/* The CONSEQUENCE, specific. A warning that only says "are you sure?"
            teaches nothing and trains people to tap through. */}
        <Text style={st.confirmText}>{body}</Text>
      </View>
    </BottomSheet>
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
  divider, expanded,
}: {
  icon?: IconName;
  label: string;
  sub?: string;
  /** Right-hand value, already formatted (money by `money()`, dates by the caller). */
  value?: string;
  tone?: RowTone;
  chevron?: boolean;
  /** For a row that OPENS IN PLACE: the chevron points right when collapsed and DOWN
   *  when open, so the mark says which way the tap goes. Leave undefined on a row that
   *  navigates away — that chevron always points right. */
  expanded?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  /** A hairline under the row. The design separates sibling rows inside one card;
   *  the LAST row omits it (a rule under the final row reads as the card's edge
   *  drawn twice). Opt-in per call site because only the caller knows which row
   *  is last. */
  divider?: boolean;
}) {
  const valueColor = tone === 'warn' ? tint('caution').ink
    : tone === 'danger' ? C.danger : C.ink;
  const body = (
    <>
      {icon && <View style={st.rowIcon}><Icon name={icon} size={18} color={C.brand} /></View>}
      {/* minWidth:0 lets this column actually shrink; without it a long label pushes
          past its share and RN breaks it MID-WORD ("Descriptio / n"). */}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={st.rowLabel} numberOfLines={2}>{label}</Text>
        {sub != null && <Text style={st.rowSub}>{sub}</Text>}
      </View>
      {value != null && (
        <Text style={[st.rowValue, { color: valueColor }]} numberOfLines={2}>{value}</Text>
      )}
      {/* The design flags an unfinished RECOMMENDED value with a small ochre dot after
          it — a "still owed" marker that is not an error. Only for `warn`. */}
      {tone === 'warn' && value != null && (
        <View style={[st.warnDot, { backgroundColor: tint('caution').ink }]} />
      )}
      {chevron && (
        // An expandable row turns its chevron DOWN while it is open. `expanded`
        // undefined = a navigating row, which always points right.
        <Text style={st.chev}>{expanded === true ? '⌄' : '›'}</Text>
      )}
    </>
  );
  if (!onPress) {
    return <View style={[st.row, st.rowStatic, divider && st.rowDivider]}>{body}</View>;
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => [st.row, divider && st.rowDivider, pressed && st.pressed]}
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
      {/* The mark, never colour alone: a FILLED green disc with a white check for
          done, a hollow ring for anything still owed. The done disc is filled (the
          design draws it solid, not an outline circle) so a completed item reads at
          a glance across a two-column grid. */}
      {state === 'done'
        ? (
          <View style={[st.mark, { backgroundColor: C.brand }]}>
            <Icon name="check" size={13} color="#fff" />
          </View>
        )
        : <View style={[st.mark, st.ring, { borderColor: tint(tone).line }]} />}
      <View style={{ flex: 1 }}>
        <Text style={st.rowLabel}>{label}</Text>
        {hint != null && <Text style={[st.rowSub, { color: hintColor }]}>{hint}</Text>}
      </View>
      {/* No chevron: the design's checklist is marks + labels only. The whole row is
          still tappable to jump to the field; the chevron in a two-column grid landed
          in the middle of the card and read as clutter. */}
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
export function PersonRow({ name, role, photoUri, kind = 'other', prominent }: {
  name: string;
  /** "Approver", "Crew" — the already-translated role word, not a slug. */
  role?: string;
  photoUri?: string | null;
  /** Disc colour. `approver` is the one that carries authority (D4), so it is the
   *  one that reads differently. */
  kind?: 'approver' | 'crew' | 'other';
  /**
   * BIGGER, for the one person the card is about (hadar, 2026-08-23: "the tile of
   * people involved is too small it's hard to tell who is it for and why").
   *
   * A 13.5pt name and a 12pt role under a 38pt disc is a list row — right for the
   * fourth labourer on the job, wrong for the person whose money this asks for. This
   * scales the SAME row rather than forking a second one, so the avatar rule and the
   * initials rule stay single for the whole app, which is why this component exists.
   */
  prominent?: boolean;
}) {
  // INK AND STEEL, NOT TWO GREENS. Green means "where this extra stands" and nothing
  // else (hadar, 2026-08-14); a person is not a status. The two discs were #536B49 and
  // #4E6243 — eight points apart, one colour to the eye — so this also gives the signer
  // a mark that actually differs from the crew's.
  const bg = kind === 'approver' ? C.ink : kind === 'crew' ? C.steel : C.muted;
  return (
    <View style={[st.person, prominent && st.personBig]}>
      {photoUri
        ? <Image source={{ uri: photoUri }} style={[st.avatar, prominent && st.avatarBig]} />
        : (
          <View style={[st.avatar, prominent && st.avatarBig, { backgroundColor: bg }]}>
            <Text style={[st.avatarT, prominent && st.avatarTBig]}>{initials(name)}</Text>
          </View>
        )}
      <View style={{ flex: 1 }}>
        <Text style={[st.rowLabel, prominent && st.rowLabelBig]}>{name}</Text>
        {role != null && <Text style={[st.rowSub, prominent && st.rowSubBig]}>{role}</Text>}
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
  sent:       { tone: 'neutral',  icon: 'clock' },
  discussing: { tone: 'caution',  icon: 'reply' },
  approved:   { tone: 'approved', icon: 'approved' },
  declined:   { tone: 'danger',   icon: 'failed' },
  superseded: { tone: 'neutral',  icon: 'history' },
  /**
   * Withdrawn by the contractor (421). NEUTRAL, not danger: `declined` is the client
   * saying no and is red because it is a refusal he has to reckon with. This is his own
   * decision, already carried out, and colouring his own act as an alarm would tell him
   * something went wrong when nothing did. Same reasoning as `superseded`, which is the
   * other "this version is over and nobody is at fault" state.
   */
  cancelled:  { tone: 'neutral',  icon: 'failed' },
} as const;

export type BannerKind = keyof typeof BANNER;

export function StatusBanner({ kind, title, detail, right, note, pills, detailIcon, badge }: {
  kind: BannerKind;
  /** The loud line — "SIGNED & APPROVED". Rendered uppercase. */
  title: string;
  /** The plain-language line under it — what is true now and what is owed next
   *  (REQ-LC24). Omit only when the title already says both. */
  detail?: string;
  /** A qualifier on the state itself — a Chip, usually ("No response yet"). It
   *  belongs IN the banner: given a row of its own it reads as a section, and a
   *  section between the state and the moves pushes the moves off a small screen. */
  right?: React.ReactNode;
  /** The quieter second line under `detail` — why the first line matters. Two tiers,
   *  because "2 things left before you can send" is the fact and "these are required
   *  for approval" is the reason, and running them together makes one long sentence
   *  a man on a ladder reads none of. */
  note?: string;
  /** The specific things the detail line is counting, as pills. A count without the
   *  names is a scolding; the names are what he taps next. */
  pills?: readonly string[];
  /** A glyph for the BODY block, distinct from the state glyph on the title row.
   *  The design carries two: the title's says what state this is, the body's says
   *  what the body is about — a countdown beside "2 things left". Omit and the body
   *  aligns flush under the title, which is right when the body is one plain line. */
  detailIcon?: IconName;
  /** Draw the state glyph inside a filled disc (the design does this for the
   *  negotiation "waiting" clock). Off by default — the draft's pen is bare. */
  badge?: boolean;
}) {
  const { tone, icon } = BANNER[kind];
  const c = tint(tone);
  const hasBody = detail != null || (note != null && note !== '')
    || (pills != null && pills.length > 0);
  return (
    <View style={[st.banner, { backgroundColor: c.soft, borderColor: c.line }]}>
      {/* Title row and body row are SIBLINGS in a column, not one icon beside one
          text stack. The design indents the body past its own glyph, and with a
          single leading icon the title would have been dragged into that indent
          with it — the state line has to stay at the card's left edge. */}
      <View style={st.bannerHead}>
        {badge
          ? <View style={[st.bannerBadge, { backgroundColor: C.brand }]}>
              <Icon name={icon} size={13} color={C.raised} />
            </View>
          : <Icon name={icon} size={20} color={c.ink} />}
        <Text style={[st.bannerTitle, { color: c.ink, flex: 1 }]}>{title}</Text>
        {right}
      </View>
      {hasBody && (
        <View style={[st.bannerBody, { borderTopColor: c.line }]}>
          {detailIcon && (
            <View style={st.bannerBodyIcon}>
              <Icon name={detailIcon} size={20} color={c.ink} />
            </View>
          )}
          <View style={{ flex: 1 }}>
            {/* THE BODY IS NEUTRAL TEXT, NOT TINTED TEXT (hadar, 2026-07-28). Only
                the title carries the state's colour; the sentences under it are
                ordinary dark grey, exactly as they would be anywhere else in the
                app. Tinting them brown made the whole card read as a warning label
                rather than as a card with a warning heading — and it put the most
                important sentence on the screen in the lowest-contrast colour on it. */}
            {detail != null && <Text style={st.bannerDetail}>{detail}</Text>}
            {note != null && note !== '' && <Text style={st.bannerNote}>{note}</Text>}
            {pills != null && pills.length > 0 && (
              <View style={st.pills}>
                {pills.map((p) => (
                  <View key={p} style={[st.pill, { borderColor: c.line }]}>
                    <View style={[st.pillDot, { backgroundColor: c.ink }]} />
                    <Text style={[st.pillT, { color: c.ink }]}>{p}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

/**
 * The amount, with its terms on the line BENEATH it — never beside it.
 *
 * All three stage screens drew this themselves, and all three drew it as one
 * baseline-aligned row: "$2,400  Fixed · the price you set". At 30pt against 15pt
 * that row is unbalanced, it wraps at the first long term, and the design puts the
 * terms underneath. One component so the three states cannot drift apart again —
 * this is the number a client approves, and it should look identical everywhere it
 * is shown.
 *
 * `amount` is already formatted (`money()`, exact cents — moneyWhole's docstring
 * forbids rounding anything confirmed, approved or sent). An unpriced extra passes
 * its sentence here and gets it at price size with `muted`: never a dash, which
 * reads as a rendering fault, and never "no cost", which tells an owner it is free.
 */
export function MoneyBlock({ amount, subtitle, muted, green }: {
  amount: string;
  /** The terms line — "Fixed price · Your quote". Composed by the caller, which is
   *  the only place that knows the price mode and whether it is a mini. */
  subtitle?: string;
  /** The amount is a sentence, not a figure ("No price given yet"). */
  muted?: boolean;
  /** Render the figure in the brand green (the negotiation design draws the confirmed
   *  price green). Opt-in so other screens keep the ink figure. */
  green?: boolean;
}) {
  // Drop a trailing ".00" from the HERO figure — the design shows "$2,400", not
  // "$2,400.00". This is lossless (whole dollars only) and display-only; the exact
  // cents still live on every row and in the frozen instrument. A non-whole amount
  // ("$2,412.50") keeps its cents.
  const shown = !muted ? amount.replace(/\.00\b/, '') : amount;
  return (
    <View style={st.moneyBlock}>
      {/* A SENTENCE is set smaller than a FIGURE. "No price given yet" at the full
          34pt amount size out-shouted the extra's own title and read as though the
          absence of a price were the headline. It still sits at money weight and in
          the money slot — mandate #6's point is that it is never a dash and never
          "no cost" — just not at the size reserved for an actual number. */}
      <Text
        style={[
          st.moneyAmount,
          green && !muted && { color: C.brand },
          muted && { color: C.steel, fontSize: 24, letterSpacing: -0.2 },
        ]}
        numberOfLines={2}
      >
        {shown}
      </Text>
      {subtitle != null && subtitle !== '' && (
        <Text style={st.moneySub}>{subtitle}</Text>
      )}
    </View>
  );
}

/**
 * THE COST GRID — what each part of the job costs, when the job was priced in parts.
 *
 * hadar, 2026-08-24: "what is missing is a grid if there were a separation of cost by
 * part (breakdown) this breakdown needs to be displayed clearly". The figure was on
 * screen and the parts behind it were not, on the extra and on the client's page
 * alike, so a total assembled from three quoted pieces looked exactly like a number
 * somebody typed. A homeowner asked to approve $2,400 can see what the $2,400 is.
 *
 * IT RENDERS, IT DOES NOT CALCULATE. `total` is the extra's own `amount_cents`,
 * passed in. This component never sums the rows: a line dropped by `parseLineItems`
 * would make a self-summed total quietly too small, and a wrong number shown
 * confidently beside a signature is the failure mandate #6 is written against. When
 * the rows do not add to the total that is a fact worth SEEING, not hiding — which
 * is why the two numbers come from different places and are both shown.
 *
 * ABSENT, NOT EMPTY. No rows means the screen renders nothing at all — not a heading
 * over blank space. Most extras carry one price for the whole job and have no parts;
 * a one-row grid restating the total is noise.
 */
export function CostBreakdown({ lines, total, label, totalLabel }: {
  lines: { title: string; detail?: string | null; amount: string }[];
  /** The extra's own total, formatted. Never computed here. */
  total?: string | null;
  /** The words come from the caller: this file holds no copy but the app's own name,
   *  so the screens keep i18n and the kit keeps layout. */
  label: string;
  totalLabel: string;
}) {
  if (!lines.length) return null;
  return (
    <View style={st.costGrid}>
      <Text style={st.costHead}>{label}</Text>
      {lines.map((l, i) => (
        <View key={`${l.title}-${i}`} style={st.costRow}>
          <View style={st.costLabelCol}>
            <Text style={st.costTitle}>{l.title}</Text>
            {!!l.detail && <Text style={st.costDetail}>{l.detail}</Text>}
          </View>
          <Text style={st.costAmount}>{l.amount}</Text>
        </View>
      ))}
      {total != null && total !== '' && (
        <View style={[st.costRow, st.costTotalRow]}>
          <Text style={st.costTotalLabel}>{totalLabel}</Text>
          <Text style={st.costTotalAmount}>{total}</Text>
        </View>
      )}
    </View>
  );
}

/** The status chip, as a component. `chipStyle` already owned the colours; every
 *  screen still rebuilt the two-element tree around it. */
export function Chip({ kind, label, outline }: {
  kind: Parameters<typeof chipStyle>[0];
  label: string;
  /** Ghost pill — transparent fill, hairline border, muted text. The negotiation
   *  "no response yet" qualifier is drawn this way in the design: it reports a fact
   *  about the wait, it is not itself a coloured status. */
  outline?: boolean;
}) {
  const c = chipStyle(kind);
  if (outline) {
    return (
      <View style={[T.chip, { backgroundColor: 'transparent', borderWidth: 1, borderColor: C.line }]}>
        <Text style={[T.chipText, { color: C.steel }]}>{label}</Text>
      </View>
    );
  }
  return (
    <View style={[T.chip, { backgroundColor: c.bg }]}>
      <Text style={[T.chipText, { color: c.fg }]}>{label}</Text>
    </View>
  );
}

/** The header "Synced" pill — a cloud-check on a brand-soft chip. Shared by the
 *  negotiation and locked stage screens (the design carries it on both). */
export function SyncedPill({ label }: { label: string }) {
  return (
    <View style={st.syncedPill}>
      <Icon name="cloud" size={15} color={C.brand} />
      <Text style={st.syncedPillText}>{label}</Text>
    </View>
  );
}

/* ----------------------------------------------------------------- actions -- */

/**
 * `neutral` is `secondary` with the ACCENT REMOVED — an ink outline, ink label.
 *
 * It exists because of one rule (hadar, 2026-08-14): "if you want the message section
 * to be distinct you can't use the same colour palette for anything else." On the three
 * record screens green now means ONE thing — the state band that says where the extra
 * stands — so the actions under it cannot be green too. `secondary` keeps its brand
 * outline for the rest of the app, which was not part of that review.
 */
export type ButtonVariant = 'primary' | 'green' | 'secondary' | 'neutral' | 'ghost' | 'danger' | 'dangerFill';

/**
 * The one button. Every variant is 58pt tall — `T.btn`'s gloves floor, mandate #3 —
 * including `ghost`, because a quiet action is not a smaller target than a loud one.
 * There is no size prop; a caller that needs a button to be shorter needs a Row.
 *
 * `style` exists for layout only, and in practice for exactly one thing: `{flex:1}`
 * when two buttons share a bar.
 */
export function Button({
  label, onPress, variant = 'primary', icon, disabled, refused, style, accessibilityLabel,
  compact,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  disabled?: boolean;
  /**
   * LOOKS REFUSED, STILL ANSWERS THE TAP.
   *
   * hadar, 2026-08-17: "now the remind button is not clickable." He was right, and it
   * was `disabled` doing exactly what `disabled` does — swallowing the touch. The
   * reason was on screen, as a 13pt caption under the button, and he never saw it.
   *
   * That is the dead control CLAUDE.md §1 rules out: someone for whom software is not
   * second nature has no way to tell "this button is refused, and here is why" from
   * "this app is broken". A tap that produces NOTHING is unreadable; a tap that
   * produces a reason is a working app with a rule.
   *
   * So `refused` dims it exactly like `disabled` — he can see before touching that it
   * will not go — but the press still fires, and the handler is expected to say why
   * somewhere he will actually read. Use `disabled` when a tap genuinely has nothing
   * to say; use `refused` whenever there is a reason worth hearing.
   */
  refused?: boolean;
  /** Tight text + padding for a row of several buttons (the negotiation moves). */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const fg = variant === 'primary' || variant === 'green' || variant === 'dangerFill' ? C.card
    : variant === 'secondary' ? C.brand
    : variant === 'neutral' ? C.ink
    : variant === 'danger' ? C.danger
    : C.steel;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      // Announced as disabled either way: a refused control IS unavailable, and a
      // screen reader must say so even though the tap is still answered.
      accessibilityState={{ disabled: !!disabled || !!refused }}
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => [
        T.btn, st.btn, compact && st.btnCompact, st[variant],
        // A disabled PRIMARY stays dark, not greyed to 40%. The design draws
        // "Send for approval" solid black whether or not the checklist is complete —
        // the reason it can't go is the red line above it, not a faded button. Only
        // outline/ghost variants use the old opacity dim.
        (disabled || refused)
          && (variant === 'primary' || variant === 'green' ? st.primaryOff : T.btnOff),
        pressed && !disabled && st.pressed, style,
      ]}
    >
      {icon && <Icon name={icon} size={compact ? 17 : 20} color={fg} />}
      <Text style={[st.btnText, compact && st.btnTextCompact, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

/** Back control + title, with the status-bar clearance this app has re-derived on
 *  every screen (54pt — without it the back control renders under the iPhone clock,
 *  which shipped once already and left a screen with no way out). */
/** The product name as it appears on the device. Centred in the nav bar of every
 *  stage screen — the one piece of chrome that says which app you are in. Detail
 *  screens pass their own name instead, which is what the design does. */
export const APP_NAME = 'EZChangeOrders';

export function ScreenHeader({ title, onBack, backLabel, right, kicker, kickerRight,
  kickerIcon, navTitle, onOverflow, overflowLabel, onTitleChange }: {
  /** The big display title. OPTIONAL: a detail screen names itself in the nav row
   *  and has nothing left to repeat underneath, which is what the design shows.
   *  Omit it there rather than passing '' — an empty display line still costs its
   *  line height. */
  title?: string;
  onBack: () => void;
  /** Already translated ("Back"). Used as the accessibility label too. */
  backLabel: string;
  /** A Chip, usually. Sits opposite the title. */
  right?: React.ReactNode;
  /** Centred in the nav row, above everything. TRUE-centred against the screen, not
   *  flex-centred between its neighbours: the back control's width varies with its
   *  label ("Job" vs "Atrás" vs a job name) and a flex-centred title would drift a
   *  few points per screen — which reads as a wobble when you navigate between them. */
  navTitle?: string;
  /** The ⋯ overflow action. Rendered only when set. */
  onOverflow?: () => void;
  overflowLabel?: string;
  /** Wire this and the title becomes EDITABLE IN PLACE — tap it, type, blur/Return
   *  commits. Omit on any screen whose record is frozen. */
  onTitleChange?: (next: string) => void;
  /** An element pinned to the RIGHT of the kicker row (e.g. a "Synced" pill). Distinct
   *  from `right`, which sits on the title row — the negotiation design puts the pill up
   *  on the kicker line and lets the big title own its full width. */
  kickerRight?: React.ReactNode;
  /** A small mark on the LEFT of the kicker line, for something true of the line — a
   *  sync tick, say. `kickerRight` is where the record's STATE goes. */
  kickerIcon?: React.ReactNode;
  /** The context line — "EXTRA · MILLER — HALL BATH". Renders ABOVE the title,
   *  where it reads as the address of the thing you are looking at. Below it, it
   *  reads as a caption on the title and cost a whole line of a 375pt screen to
   *  say so. Screens previously hand-rolled it underneath for want of this prop. */
  kicker?: string;
}) {
  return (
    <View style={st.header}>
      {/* The nav row. The back control sits in the flow; the title is absolutely
          positioned across the full row so it is centred on the SCREEN rather than
          on the space left over beside the back label. `pointerEvents: none` so the
          centred text can never swallow a tap meant for the control beneath it. */}
      <View style={st.navRow}>
        <Pressable
          onPress={onBack}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={backLabel}
          style={st.back}
        >
          <Text style={st.backT}>‹</Text>
        </Pressable>
        {navTitle != null && navTitle !== '' && (
          <View style={st.navTitleWrap} pointerEvents="none">
            <Text style={st.navTitle} numberOfLines={1}>{navTitle}</Text>
          </View>
        )}
        {/* The overflow control, right-aligned in the nav row — the ⋯ the design
            carries on every stage screen. Rendered only when the caller wires an
            action; a dead ⋯ is worse than none. */}
        {onOverflow && (
          <Pressable
            onPress={onOverflow}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={overflowLabel ?? '⋯'}
            style={st.overflow}
          >
            <Text style={st.overflowT}>⋯</Text>
          </Pressable>
        )}
      </View>
      {kicker != null && kicker !== '' && (
        kickerRight != null ? (
          <View style={st.kickerRow}>
            {/* An icon BEFORE the identity line, for a fact that is about the line
                itself — "this change order, on this job, backed up" (2026-08-24). It
                sits inside the flexed Text's row rather than in `kickerRight`, which is
                the slot the STATE occupies. */}
            {kickerIcon}
            <Text style={[labelStyle, { flex: 1 }]} numberOfLines={1}>{kicker}</Text>
            {kickerRight}
          </View>
        ) : (
          <Text style={[labelStyle, st.kicker]} numberOfLines={1}>{kicker}</Text>
        )
      )}
      {(title != null && title !== '') || right != null ? (
        <View style={st.headerRow}>
          {title != null && title !== '' && (
            // UPPERCASE (hadar, 2026-07-28) — the design sets the extra title in caps
            // on all three stage screens. This supersedes commit 637bafe's
            // "sentence-case titles" rule for the STAGE-SCREEN title specifically;
            // sentence case still governs body headings and buttons.
            //
            // EDIT IN PLACE (hadar, 2026-07-30): when `onTitleChange` is wired, tapping
            // the title turns it into a field right here — no detour to a detail
            // screen. Only Stage 1 wires it; a sent extra is frozen (REQ-LC15) and
            // simply does not pass the callback, so its title is not tappable.
            onTitleChange
              ? <EditableTitle title={title} onChange={onTitleChange} />
              : (
                <Text
                  style={[display(22), st.headerTitle, { flex: 1 }]}
                  numberOfLines={3}
                  adjustsFontSizeToFit
                  minimumFontScale={0.6}
                >{title}</Text>
              )
          )}
          {right}
        </View>
      ) : null}
    </View>
  );
}

/**
 * The stage title, editable in place. Tap → it becomes a field at the same size and
 * position; blur or Return commits, Escape-by-emptying is refused (an untitled extra
 * is what the placeholder is for, and blanking the field would silently discard the
 * words the pipeline wrote). The caller owns the write and its refusal.
 */
function EditableTitle({ title, onChange }: {
  title: string;
  onChange: (next: string) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(title);
  // Re-sync when the record's title changes underneath (pipeline retitle, another
  // device) — but never while the contractor is mid-edit.
  React.useEffect(() => { if (!editing) setDraft(title); }, [title, editing]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (!next || next === title) { setDraft(title); return; }
    onChange(next);
  };

  if (!editing) {
    return (
      <Pressable
        onPress={() => { setDraft(title); setEditing(true); }}
        accessibilityRole="button"
        accessibilityLabel={title}
        style={{ flex: 1 }}
      >
        <Text
          style={[display(22), st.headerTitle]}
          numberOfLines={3}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
        >{title}</Text>
      </Pressable>
    );
  }
  return (
    <TextInput
      value={draft}
      onChangeText={setDraft}
      onBlur={commit}
      onSubmitEditing={commit}
      returnKeyType="done"
      autoFocus
      selectTextOnFocus
      multiline={false}
      style={[display(22), st.headerTitle, st.headerTitleEdit, { flex: 1 }]}
    />
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
  photos, missingLabel, onPressPhoto, onAddMore, addLabel, tileSize,
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
  /** Tile side in points. Default 86 (the record screens); the draft passes the
   *  size that fits ITS indent — the design shows three photos plus the add tile
   *  in one line there, and a fixed 86 could only fit three total. */
  tileSize?: number;
}) {
  const dim = tileSize != null ? { width: tileSize, height: tileSize } : null;
  return (
    <View style={st.grid}>
      {photos.map((p) => (
        <View key={p.key}>
          <PhotoTileView photo={p} missingLabel={missingLabel} onPress={onPressPhoto} dim={dim} />
          {p.caption != null && <Text style={st.tileCaption}>{p.caption}</Text>}
        </View>
      ))}
      {onAddMore && (
        <Pressable
          onPress={onAddMore}
          accessibilityRole="button"
          accessibilityLabel={addLabel ?? '+'}
          style={({ pressed }) => [st.tile, dim, st.addTile, pressed && st.pressed]}
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
function PhotoTileView({ photo, missingLabel, onPress, dim }: {
  photo: PhotoTile;
  missingLabel: string;
  onPress?: (photo: PhotoTile) => void;
  dim?: { width: number; height: number } | null;
}) {
  const [failed, setFailed] = React.useState(false);
  if (!photo.present || failed) {
    return (
      <View style={[st.tile, dim, st.tileMissing]}>
        <Text style={st.tileMissingT}>{missingLabel}</Text>
      </View>
    );
  }
  const img = (
    <Image
      source={{ uri: photo.uri }}
      onError={() => setFailed(true)}
      style={[st.tile, dim]}
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
  // A section heading is a SIGNPOST, not a headline — it names the group and then
  // gets out of the way. The shared `label` style is tuned for inline micro-labels
  // ("FROM YOU · 8:32"), and at that size and weight over a card it competed with
  // the card's own content. Smaller, wider tracking, and a lighter grey than
  // `C.steel`, which is the body-secondary colour and too dark to recede.
  // NOT condensed. `labelStyle` is Barlow CONDENSED (F.dispSemi), which squeezes
  // "RAW COLLECTED INFORMATION" into a narrow band that reads as a different
  // typeface from the design's normal-width sans. This overrides the family to
  // Barlow proper — the mockup's section labels are the body font, uppercased and
  // tracked, not the display font. Muted grey, tight above the card it names.
  sectionTitle: {
    // Tighter than before: the title HUGS the card below it (small marginBottom) so
    // it reads as that card's label, and the gap above it (below the previous card)
    // is trimmed so the sections do not float apart. Was 20/8 — the 20 above stacked
    // on the previous card's 10 marginBottom for a 30pt canyon between sections.
    fontFamily: F.bodySemi, fontSize: 11.5, letterSpacing: 1.4, color: C.muted,
    marginTop: 12, marginBottom: 6,
  },
  // The heading INSIDE the card: same type, but it now sits on the card's first line
  // with a hairline under it, so the card reads as one labelled object.
  // ── the bottom drawer ──
  sheetDim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.38)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.paper, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingTop: 8, maxHeight: '88%',
  },
  sheetTall: { height: '90%' },
  confirmSheet: {
    backgroundColor: C.paper, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingTop: 8, maxHeight: '85%',
  },
  confirmX: {
    width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: C.line,
    alignItems: 'center', justifyContent: 'center', marginLeft: 18, marginTop: 10,
  },
  confirmBody: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 12, paddingBottom: 22 },
  confirmBadge: {
    width: 74, height: 74, borderRadius: 20, backgroundColor: tint('caution').soft,
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  confirmTitle: { fontFamily: F.disp, fontSize: 27, color: C.ink, textAlign: 'center' },
  confirmText: {
    fontFamily: F.body, fontSize: 15, color: C.steel, lineHeight: 22,
    textAlign: 'center', marginTop: 10,
  },
  confirmFoot: {
    paddingHorizontal: 18, paddingTop: 14, paddingBottom: 28,
    borderTopWidth: 1, borderTopColor: C.line,
  },
  sheetGrab: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: C.line, alignSelf: 'center',
  },
  sheetHead: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 18, paddingTop: 14, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: C.line,
  },
  sheetTitle: {
    flex: 1, fontFamily: F.disp, fontSize: 21, color: C.ink,
    textTransform: 'uppercase', letterSpacing: 0.6,
  },
  sheetX: { minHeight: 32, minWidth: 32, alignItems: 'center', justifyContent: 'center' },
  /**
   * `flexShrink: 1` IS WHAT MAKES A SHEET SCROLL (hadar 2026-08-14: "the bottom popup
   * activity needs to scroll — give us the ability to see all of the information").
   *
   * Without it this ScrollView had no flex at all, so inside a height-bounded sheet it
   * laid itself out to its CONTENT's height and simply overran the bottom edge. A
   * ScrollView whose frame is taller than the space it sits in has nothing to scroll:
   * it believes everything is already visible, and the rows past the edge are clipped
   * with no way to reach them. The full history was ten events and a signed panel; you
   * could see six.
   *
   * SHRINK, NOT GROW. `flex: 1` would fix the tall sheets and break every short one —
   * a five-row form sheet would stretch to fill 88% of the screen with white space
   * under it. Shrink only bites when the content is bigger than the room, which is
   * exactly and only when scrolling is wanted.
   */
  sheetBody: { flexShrink: 1, paddingHorizontal: 18, paddingTop: 12 },
  sheetFoot: {
    paddingHorizontal: 18, paddingTop: 10, paddingBottom: 28,
    borderTopWidth: 1, borderTopColor: C.line,
  },

  sectionCard: { borderRadius: 12, marginTop: 10, marginBottom: 0, paddingTop: 0 },
  sectionTitleIn: {
    fontFamily: F.bodySemi, fontSize: 11.5, letterSpacing: 1.4, color: C.muted,
    paddingTop: 12, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: C.line,
    marginBottom: 2, marginHorizontal: -14, paddingHorizontal: 14,
  },
  // The same title bar with something on its right. The rule and the full-bleed
  // negative margin move to the ROW so they still run edge to edge; the text keeps the
  // type and gives up the border.
  sectionHeadRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    paddingTop: 12, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: C.line,
    marginBottom: 2, marginHorizontal: -14, paddingHorizontal: 14,
  },
  sectionTitleFlush: {
    flex: 1, fontFamily: F.bodySemi, fontSize: 11.5, letterSpacing: 1.4, color: C.muted,
  },

  // 56 pressable / 48 static — both clear `touchTargets.minimum`, so adding an
  // onPress to a row later never silently drops it under the gloves floor.
  // Row typography, matched to the design 2026-07-28: the LABEL is medium, not
  // bold — bold made every row shout and the card read as eight headlines — and
  // the VALUE is body weight a step smaller, because it is an answer, not a peer
  // of the label. The row keeps the 48pt touch floor (mandate #3); only the
  // visual density changed.
  // 48, not the 56 touch floor: the design's list rows are denser, and at 56 a
  // six-row card ran a third taller than the mockup. Still above 44 (Apple's floor).
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    minHeight: 48, paddingVertical: 4,
  },
  rowStatic: { minHeight: 48 },
  rowIcon: { width: 24, alignItems: 'center' },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: C.line },
  // Scaled down one step (hadar, 2026-07-30): at 14.5/12.5 every list card ran a
  // third taller than the design and the locked screen needed two screens for what
  // the mockup fits in one. Shared with the negotiation rows on purpose — one scale.
  // BOLD (hadar, 2026-07-31): the row's label is the name of the thing — Description,
  // Cost, Payment timing — and it carries the row. Was medium (500), which read as
  // body copy beside its own value.
  /**
   * SECTION CONTENT, 15% up (hadar, 2026-08-25: "make all co detail section content
   * font size 15% larger"). 13.5 -> 15.5, 12 -> 14, 13 -> 15.
   *
   * These three are what a section card is MADE of — every "Cost / $1,200", "Impact on
   * schedule / No change", "Not included / …" row on the draft, sent and sealed screens
   * is a `Row`, so the label, its sub-line and its value are the section content.
   *
   * `rowSub`'s line height moves with it (16 -> 18) for the same reason the scope's did:
   * a sub-line that wraps is prose, and raising size without leading tightens it.
   */
  rowLabel: { fontFamily: F.bodyBold, fontSize: 15.5, color: C.ink },
  rowSub: { fontFamily: F.body, fontSize: 14, color: C.muted, marginTop: 1, lineHeight: 18 },
  // 58%, not 46%: at the tighter cap a normal value ("View previous versions") wrapped
  // its ROW to two lines, which is what made the locked screen twice as tall as the
  // design. The label side still wins the remaining space.
  // The value SHRINKS before the label does. At a fixed 58% cap the bolder label lost
  // its room and RN broke it mid-word ("Descriptio / n"); the value is the side that
  // can afford to wrap.
  rowValue: {
    fontFamily: F.body, fontSize: 15, textAlign: 'right',
    flexShrink: 1, maxWidth: '52%',
  },
  chev: { fontFamily: F.body, fontSize: 19, color: C.muted, marginLeft: 2 },
  warnDot: { width: 7, height: 7, borderRadius: 4, marginLeft: 8 },
  pressed: { opacity: 0.6 },

  mark: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  ring: { borderWidth: 2.5, backgroundColor: 'transparent' },

  person: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: touchTargets.minimum },
  avatar: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center', backgroundColor: C.surfaceMuted,
  },
  avatarT: { fontFamily: F.disp, fontSize: 14, color: C.card },
  // The prominent scale. One step up on every element so the row stays a row and does
  // not become a card: 52pt disc, a name at reading size, a legible reason under it.
  // Tuned down from the first pass (52/19/18): at that size the name overpowered the
  // section label above it and the card read as a profile rather than a list of people.
  // Still clearly the most important row on the card, no longer the loudest thing on
  // the screen. See `title` in peopleinvolved.tsx for the other half of the balance.
  personBig: { gap: 12, minHeight: 60 },
  avatarBig: { width: 44, height: 44, borderRadius: 22 },
  avatarTBig: { fontSize: 16 },
  rowLabelBig: { fontSize: 16, lineHeight: 21 },
  rowSubBig: { fontSize: 13, color: C.steel, marginTop: 2, lineHeight: 17 },

  rail: { width: 16, alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
  railLine: { flex: 1, width: 2, backgroundColor: C.line, marginTop: 3 },
  stamp: {
    fontFamily: F.dispSemi, fontSize: 11.5, letterSpacing: 1, textTransform: 'uppercase',
  },
  timelineWhat: { fontFamily: F.body, fontSize: 15, color: C.ink, lineHeight: 21, marginTop: 1 },

  banner: {
    borderRadius: radii.md, borderWidth: 1, padding: 12, marginBottom: 10,
  },
  bannerHead: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  bannerBadge: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  // The rule under the state line. It separates "what state is this" from "what is
  // owed", which are two different sentences the eye should not run together.
  bannerBody: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 9,
    borderTopWidth: 1, paddingTop: 9, marginTop: 9,
  },
  // The glyph sits on the detail line's optical centre, not its cap line — 20pt of
  // icon against a 20pt line box needs the nudge or it reads as riding high.
  bannerBodyIcon: { paddingTop: 1 },
  bannerTitle: {
    fontFamily: F.dispSemi, fontSize: 14, textTransform: 'uppercase', letterSpacing: 1.3,
  },
  bannerDetail: { fontFamily: F.bodyBold, fontSize: 13.5, lineHeight: 18, color: C.ink },
  bannerNote: { fontFamily: F.body, fontSize: 13.5, lineHeight: 18, marginTop: 3, color: C.steel },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    // A SOFT RECTANGLE, not a lozenge. `radii.pill` (999) made these fully round,
    // which reads as a status chip — a thing you are told. These are gaps you go
    // and fix, and the design draws them as tapping-shaped, not badge-shaped.
    borderWidth: 1, borderRadius: 9,
    paddingHorizontal: 11, paddingVertical: 6,
    // Solid card white, not a translucent veil over the banner. Against the paler
    // peach the 55%-white pill was barely a shade lighter than the card it sat on,
    // so the pills read as text with a faint outline instead of as objects.
    backgroundColor: C.card,
  },
  pillDot: { width: 7, height: 7, borderRadius: 4 },
  pillT: { fontFamily: F.bodySemi, fontSize: 13 },

  btn: { gap: 8, paddingHorizontal: 16 },
  btnText: { fontFamily: F.bodyBold, fontSize: 17, letterSpacing: 0.2 },
  btnCompact: { minHeight: 52, paddingHorizontal: 10, gap: 6 },
  btnTextCompact: { fontSize: 15 },
  primary: { backgroundColor: C.ink },
  // The negotiation "Remind <name>" primary — dark green, not ink. The design uses
  // green for the nudge and ink for the draft's Send; keeping them distinct.
  green: { backgroundColor: C.brandDark },
  // Disabled primary: still ink, barely softened, so it reads black like the design
  // rather than dropping to a light-grey pill.
  primaryOff: { opacity: 0.9 },
  secondary: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: C.brand },
  neutral: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: C.ink },
  ghost: { backgroundColor: 'transparent' },
  danger: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: C.danger },
  // FILLED danger — for the one tap that destroys something. The outline `danger`
  // is for a destructive option among others; this is for the confirm itself.
  dangerFill: { backgroundColor: C.danger },

  header: { paddingTop: 54 },
  back: {
    minHeight: touchTargets.minimum, justifyContent: 'center',
    alignSelf: 'flex-start', paddingRight: 24,
  },
  backT: { fontFamily: F.body, fontSize: 40, lineHeight: 42, color: C.ink },
  moneyBlock: { marginTop: 8 },
  moneyAmount: {
    fontFamily: F.disp, fontSize: 30, color: C.ink,
    fontVariant: ['tabular-nums'], letterSpacing: -0.5,
  },
  moneySub: { fontFamily: F.body, fontSize: 14, color: C.steel, marginTop: 3 },
  // The cost grid. A hairline-boxed table rather than free rows: the point is that
  // these numbers belong TO the figure above them, and an unbounded list of
  // label/amount pairs reads as unrelated facts about the extra.
  costGrid: {
    marginTop: 14, borderWidth: 1, borderColor: C.line,
    borderRadius: radii.md, paddingHorizontal: 14, paddingVertical: 4,
  },
  costHead: {
    fontFamily: F.body, fontSize: 11, fontWeight: '700', color: C.steel,
    letterSpacing: 0.7, textTransform: 'uppercase', marginTop: 10, marginBottom: 2,
  },
  costRow: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    paddingVertical: 10, gap: 16, borderTopWidth: 1, borderTopColor: C.line,
  },
  // The label column yields; the money column never wraps or shrinks — a truncated
  // price is worse than a truncated description.
  costLabelCol: { flex: 1, minWidth: 0 },
  costTitle: { fontFamily: F.body, fontSize: 15, color: C.ink, lineHeight: 20 },
  costDetail: { fontFamily: F.body, fontSize: 12.5, color: C.steel, marginTop: 2 },
  costAmount: {
    fontFamily: F.body, fontSize: 15, color: C.ink, fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  // The total is set apart by a heavier rule, the way a receipt sets it apart.
  costTotalRow: { borderTopWidth: 1.5, borderTopColor: C.line, marginTop: 2 },
  costTotalLabel: { fontFamily: F.body, fontSize: 14, fontWeight: '700', color: C.ink },
  costTotalAmount: {
    fontFamily: F.disp, fontSize: 17, color: C.ink,
    fontVariant: ['tabular-nums'], letterSpacing: -0.2,
  },
  // The nav bar carries a full-bleed hairline under it, the divider the design draws
  // below "EZChangeOrders". The negative horizontal margin + matching padding pushes
  // the border to the screen edges while the content stays on the 18pt gutter; the
  // parent ScrollView pads by 18, so -18 here cancels it for the line only.
  navRow: {
    justifyContent: 'center',
    marginHorizontal: -18, paddingHorizontal: 18, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: C.line,
  },
  overflow: {
    // right:18 (the gutter), not 0 — navRow now bleeds to the screen edge for its
    // divider, so 0 would shove ⋯ into the corner.
    position: 'absolute', right: 18, top: 0, bottom: 14,
    justifyContent: 'center', paddingHorizontal: 4, minHeight: touchTargets.minimum,
  },
  overflowT: { fontFamily: F.bodyBold, fontSize: 26, color: C.ink, marginTop: -8 },
  navTitleWrap: {
    // bottom:14 matches navRow's paddingBottom so the centred title lines up with the
    // back chevron rather than drifting into the divider gap.
    position: 'absolute', left: 0, right: 0, top: 0, bottom: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  navTitle: {
    fontFamily: F.bodyBold, fontSize: 20, color: C.ink,
    letterSpacing: 0.2, maxWidth: '62%',
  },
  kicker: { marginTop: 10 },
  syncedPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: C.brandSoft, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
  },
  syncedPillText: { fontFamily: F.bodySemi, fontSize: 12.5, color: C.brand },
  kickerRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  // The design sets the stage-screen title in a heavy CONDENSED face at display size,
  // filling the width (supersedes the earlier Barlow-Bold 22). fontFamily + fontSize
  // here win over the `display(22)` base because this style comes later in the array.
  /**
   * BIGGER (hadar, 2026-08-24: "the title needs to be much bigger" — the record detail
   * "is hard to tell right now").
   *
   * 34 -> 40. The title is the one thing on the screen that says WHICH change order
   * this is, and it was competing with a state pill, a sync pill and a readiness
   * sentence stacked around it. Two of those have moved into the header line and one is
   * gone, so the width they were taking goes back to the name of the thing.
   *
   * `lineHeight` tracks it at 1.05: this face is condensed and set in caps, and a wider
   * leading on a two-line title opens a gap that reads as two separate headings.
   */
  /**
   * THE EXTRA'S TITLE, 40% LARGER (hadar, 2026-08-24: "need to make the title of the CO
   * inside the details by 40%"). 40 -> 56, and the line height keeps its 1.05 ratio.
   *
   * THE SIZE ALONE WOULD HAVE MADE IT WORSE, which is why `numberOfLines` moved with it.
   * The title is drawn with `adjustsFontSizeToFit` and `minimumFontScale={0.6}` on ONE
   * line, so a real title — "Panel upgrade — code required", or the ~60-character
   * subjects the structuring step writes — was already shrinking to the 0.6 floor and
   * then truncating. Raising the base raises the floor (24 -> 33.6, the 40% he asked
   * for) but fits FEWER characters at that size, so on its own this change would have
   * bought a bigger word and lost the rest of the sentence.
   *
   * Two lines is what makes the larger type mean something. The shrink-to-fit stays as
   * the backstop for a title too long even for two.
   *
   * 56 -> 73 (hadar asked for a further 30%, 2026-08-25).
   *
   * THE NUMBER THAT DECIDES THE RENDERED SIZE IS base x minimumFontScale, NOT base.
   * `adjustsFontSizeToFit` shrinks until the text fits, so a long title lands on the
   * floor and stays there. Getting this wrong is not theoretical — I did it, and hadar
   * caught it the moment he opened the app:
   *
   *     40 x 0.6  = 24pt   1 line
   *     56 x 0.6  = 34pt   2 lines
   *     73 x 0.45 = 33pt   2 lines   <- the "+30%" that was actually -2%
   *
   * I had lowered the floor so a bigger base could not clip a long title. It could not
   * clip because it never got bigger; the two changes cancelled, and every real title
   * — the structuring step writes ~60-character subjects — rendered a hair SMALLER.
   *
   * TWO LINES WAS THE REAL CEILING. About 30 characters over two lines on a phone is
   * ~33pt of type however large the base is, so no base alone could move it. The third
   * line is what buys the room: the same title over three lines fits at ~44pt, which is
   * the 30% he asked for, and the floor goes back to 0.6 so it can be reached.
   *
   * 73 -> 51 (hadar asked for 30% smaller, 2026-08-25). Three lines and the 0.6 floor
   * both STAY: with the smaller base a long title needs about 31pt, which two lines
   * could have held, but leaving the third available costs nothing — `numberOfLines` is
   * a maximum, so a title that fits in one still uses one — and it is what keeps a very
   * long subject from hitting the floor and truncating.
   *
   * The full run, so the shape of it is visible at a glance:
   *
   *     40 x 0.6 = 24pt   1 line
   *     56 x 0.6 = 34pt   2 lines
   *     73 x 0.45= 33pt   2 lines   (asked +30%, delivered -2%)
   *     73 x 0.6 = 44pt   3 lines
   *     51 x 0.6 = 31pt   3 lines
   *     41 x 0.6 = 25pt   3 lines   <- here
   *
   * Which is, to within a point, where it started at 40 x 0.6 = 24pt — except on three
   * lines instead of one, so a long subject is now READ rather than cut off mid-word.
   * The size went round in a circle; the truncation is what actually got fixed.
   *
   * If this needs to change again, move POINTS to change the size and LINES to change
   * the ceiling. Moving both at once is what produced the -2%.
   */
  headerTitle: {
    fontFamily: F.disp, fontSize: 41, lineHeight: 43,
    textTransform: 'uppercase', letterSpacing: 0.2,
  },
  // While editing: a quiet underline so the field is visibly live without the title
  // jumping size or position.
  headerTitleEdit: { paddingVertical: 0, borderBottomWidth: 2, borderBottomColor: C.brand },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 2 },

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
