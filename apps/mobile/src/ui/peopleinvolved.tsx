/**
 * PEOPLE INVOLVED — ONE section, the same on all three stages of an extra.
 *
 * hadar, 2026-08-14: "there is a flaw in the design between pre-approved and approved
 * screens — the sequence of the information needs to be the same. The people section
 * needs to be the same in all 3 stages, same location, looks the same."
 *
 * He was describing three different answers to one question. Draft drew a vertical
 * list of labelled rows ("Requested by" / "Source" / "Also on this job") under a
 * heading reading "Who is on this"; negotiation drew a horizontal who's-who strip of
 * avatars headed "People involved"; and the sealed record — the one screen that exists
 * to settle a dispute — drew NOTHING AT ALL, so the question "who agreed to this" was
 * answerable on the two stages where it is still changing and unanswerable on the one
 * where it is final.
 *
 * It is a VERTICAL LIST, one person per row (hadar, 2026-08-14: "the invited people
 * should not be horizontal, but vertical"). The strip was tried first and could not
 * survive real names — see `st.personRow`.
 *
 * That is not three designs. It is one design implemented three times and drifted, and
 * the cost lands on the person CLAUDE.md §1 names: someone for whom software is not
 * second nature, who has to re-learn where the people live every time the extra moves
 * a stage. So there is now one component, and the stage screens choose only WHO is in
 * it — never how it looks or where it sits.
 *
 * WHAT EACH STAGE STILL OWNS, because these are facts about the record and not styling:
 *   · draft       — may have NOBODY yet, which is the gap that blocks sending. It
 *                   passes `empty`, and that card is the whole section.
 *   · draft       — may REMOVE somebody it added by mistake (`onRemove` per person).
 *   · negotiation — may add a contact; the roster is who is reachable, not a term of
 *                   the frozen instrument.
 *   · locked      — passes neither. A sealed record's people are read, never edited
 *                   (REQ-LC30), so no add row and no ✕ is offered at all.
 *
 * THE APPROVER IS FIRST AND IS DRAWN DIFFERENTLY (D4). Exactly one person can sign;
 * everyone else may read and ask. A list that made them all look alike would leave a
 * contractor waiting for an answer from somebody who cannot give one.
 */
import React from 'react';
import { Pressable, Text, View } from 'react-native';

import { t } from '../i18n';
import { Icon } from './icon';
import { Card, PersonRow } from './kit';
import { C, F, label as labelStyle } from './theme';

/** One person on the record. `role` is the already-translated word, never a slug —
 *  a layout component must not decide what a role is called. */
export type RecordPerson = {
  /** Stable key. The name is NOT safe as one: two crew can share a first name. */
  key: string;
  name: string;
  /** The line under the name — "Homeowner / Approver", "Captured & Priced & sent". */
  role: string;
  /** Only the signer is 'approver' (D4). */
  kind: 'approver' | 'crew';
  photoUri?: string | null;
  /** Open the editor for this person. Draft only: the client is the one name on an
   *  unsent extra that is still a CHOICE. Once it is sent the name is copied into the
   *  instrument, so no stage past draft passes this. */
  onPress?: () => void;
  /** Take them off the record. Draft only — omitted everywhere else. */
  onRemove?: () => void;
};

export function PeopleInvolved({ people, empty, onAddContact, style }: {
  /** Already ordered and de-duplicated by the caller, approver first. */
  people: readonly RecordPerson[];
  /** Drawn INSTEAD of the list when nobody is on the record yet. Draft's
   *  choose-a-client card. Without it, an empty section renders nothing at all —
   *  which is right for a sealed record with no stored approver (record.ts's rule:
   *  never a placeholder person). */
  empty?: React.ReactNode;
  /** Add somebody to the record. Omitted where the record may not grow. */
  onAddContact?: () => void;
  style?: any;
}) {
  if (!people.length && !empty) return null;
  /**
   * TWO GROUPS, NAMED, NOT ONE LIST (hadar, 2026-08-14: "need to make client distinct
   * from team — right now it's not").
   *
   * He was right and the cause was colour. The only thing separating the two was the
   * avatar disc — `C.approve` #536B49 for the signer against `C.brand` #4E6243 for
   * everyone else. Two muted forest greens eight points apart, on a 46pt circle, in
   * daylight, read as one colour. So the person who can commit the client's money
   * looked exactly like the labourer who took the photo.
   *
   * A difference that matters this much is not carried by a hue AT ALL — that is the
   * lesson of the first fix, which reached for a green tint and made the screen worse
   * by adding a third green. It is carried by the same device the send sheet already
   * uses and hadar already approved: two headed groups, in the same words — CLIENT and
   * YOUR TEAM — with the signer in a neutral inset and an ink disc.
   */
  const client = people.filter((p) => p.kind === 'approver');
  const team = people.filter((p) => p.kind !== 'approver');
  return (
    <Card style={[st.card, style]}>
      <Text style={[labelStyle, st.title]}>{t('neg.people')}</Text>

      {/* THE CLIENT — headed even when they are the only person on the record. The
          heading is what says WHICH of the two this is; dropping it when the team is
          empty would make the one row on screen ambiguous again the moment somebody
          is added. */}
      {client.length > 0 && (
        <View style={st.group}>
          <Text style={st.groupLab}>{t('r5c.secClient')}</Text>
          {client.map((p) => <PersonLine key={p.key} p={p} accent prominent />)}
        </View>
      )}

      {!people.length && empty}

      {team.length > 0 && (
        <View style={[st.group, client.length > 0 && st.groupGap]}>
          <Text style={st.groupLab}>{t('r5c.secTeam')}</Text>
          {team.map((p, i) => (
            <PersonLine key={p.key} p={p} divider={i > 0} />
          ))}
        </View>
      )}

      {onAddContact && (
        <Pressable style={st.addPerson} onPress={onAddContact} accessibilityRole="button">
          <Icon name="people" size={16} color={C.steel} />
          <Text style={st.addPersonT}>{t('client.addContact')}</Text>
        </Pressable>
      )}
    </Card>
  );
}

/** One person, one row. `accent` is the client's tinted block — the one thing on this
 *  card that is not a plain row, because exactly one person here can sign (D4). */
function PersonLine({ p, accent, divider, prominent }: {
  p: RecordPerson; accent?: boolean; divider?: boolean; prominent?: boolean;
}) {
  // Tappable only where there is something to change. A row that opened nothing but
  // still looked pressable would suggest the sealed record's signer can be swapped.
  const RowEl: any = p.onPress ? Pressable : View;
  return (
    <RowEl
      onPress={p.onPress}
      accessibilityRole={p.onPress ? 'button' : undefined}
      style={[st.personRow, accent && st.clientRow, prominent && st.clientRowBig,
              divider && st.rowDivider]}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        {/* The kit's row, not a local copy: one avatar rule and one initials rule for
            the whole app, so a person does not get two different marks on two
            screens. */}
        <PersonRow name={p.name} role={p.role} kind={p.kind} photoUri={p.photoUri}
          prominent={prominent} />
      </View>
      {/* A VISIBLE ✕, not a swipe (hadar, 2026-08-05): a hidden gesture is what
          CLAUDE.md §1 rules out — someone who does not think in software has no reason
          to believe a row can be swiped. Nothing is removed by the tap itself; it
          opens the confirmation. */}
      {p.onRemove && (
        <Pressable
          onPress={p.onRemove}
          accessibilityRole="button"
          accessibilityLabel={t({ k: 'client.removePerson', p: { name: p.name } } as any)}
          hitSlop={8}
          style={({ pressed }) => [st.removeX, pressed && { opacity: 0.5 }]}
        >
          <Text style={st.removeXT}>✕</Text>
        </Pressable>
      )}
      {p.onPress && <Text style={st.chev}>›</Text>}
    </RowEl>
  );
}

/**
 * Fold an approver and the rest into ONE ordered, de-duplicated list.
 *
 * ONE HUMAN, ONE ROW. The approver is also, routinely, the person who captured or
 * priced the extra — a solo operator is every role at once, which CLAUDE.md says is
 * the case the product must work for. Listing them under both headings printed the
 * same name twice, and because the two sources are stored separately (the roster's
 * typed name vs the profile's) the casing differed between them, so it read as two
 * different people rather than one duplicate. Matched case- and space-insensitively
 * for exactly that reason.
 */
export type PersonInput = {
  name: string;
  role?: string;
  photoUri?: string | null;
  /** Carried through to the rendered row. Draft only. */
  onPress?: () => void;
  onRemove?: () => void;
};

export function rosterOf(
  approver: PersonInput | null,
  others: readonly PersonInput[] = []
): RecordPerson[] {
  const key = (n: string) => n.trim().toLowerCase().replace(/\s+/g, ' ');
  const seen = new Set<string>();
  const out: RecordPerson[] = [];
  if (approver?.name.trim()) {
    seen.add(key(approver.name));
    out.push({ key: `a:${key(approver.name)}`, name: approver.name, kind: 'approver',
               // "Approver" names a role; it does not answer "why is this person here".
               // The default now says what they actually do with this document. An
               // explicit role passed by the caller (a client TYPE, say "General
               // contractor") still wins — that is more specific, not less.
               role: approver.role ?? t('erec.approverWhy'), photoUri: approver.photoUri,
               onPress: approver.onPress, onRemove: approver.onRemove });
  }
  for (const p of others) {
    const k = key(p.name);
    // ONE PASS OVER EVERYBODY, not one pass per source. The draft feeds this three
    // lists — the client, the on-site source, and the rest of the job — and a crew
    // member who is also the client would otherwise appear twice, because each list
    // was only ever de-duplicated against itself.
    if (!p.name.trim() || seen.has(k)) continue;
    seen.add(k);
    out.push({ key: `c:${k}`, name: p.name, kind: 'crew',
               role: p.role ?? t('erec.crewRole'), photoUri: p.photoUri,
               onPress: p.onPress, onRemove: p.onRemove });
  }
  return out;
}

const st = {
  card: { borderRadius: 12, marginTop: 10, marginBottom: 0 },
  /**
   * REBALANCED (hadar, 2026-08-23, second pass: "the people involved section title is so
   * small the name of the selected owner is so big it looks confusing").
   *
   * My first pass fixed one half and broke the other. Raising the client's name to 18pt
   * answered "who is it for", but it left an 11.5pt muted label above a bold 18pt name,
   * which inverts the hierarchy: the card looked like it was ABOUT the person rather
   * than a section that lists people. The label now carries enough weight to be read as
   * the heading it is, and the name comes back down to meet it.
   */
  /**
   * A HEADING AGAIN, AND LARGER (hadar, 2026-08-24: "make the title even larger").
   *
   * The type has moved twice for reasons worth keeping straight. It began as an 11.5pt
   * spaced small-caps label. On 2026-08-23 the text became a full sentence and the
   * treatment followed it — sentence case, no tracking, 13.5pt, steel — because
   * uppercase tracking turns a readable line into a wall.
   *
   * The text is two words again, so the sentence reasoning no longer applies, and 13.5pt
   * steel left it QUIETER than the 16pt ink name sitting under it. That inverts the
   * hierarchy in exactly the way he objected to the first time: the card reads as though
   * it is about the person rather than as a section that lists people.
   *
   * 18pt ink outranks the name it introduces, which is what a section title is for.
   * Sentence case stays — the small-caps treatment belongs to the app's quiet field
   * labels, and this is no longer one of those.
   */
  /**
   * THE RULE UNDER THE TITLE (hadar, 2026-08-24: "every section should have a title and
   * a line under it to divide the title from the content").
   *
   * The TYPE is deliberately left alone. He set this title to 13.5pt, sentence case, on
   * 2026-08-23 — "the people involved section title is so small the name of the selected
   * owner is so big it looks confusing" — so adopting `Section`'s 11.5pt uppercase label
   * here would undo a decision he made about this exact line. What was missing was the
   * divider, not the styling, so only the divider is added.
   *
   * Full-bleed against T.card's 14pt padding, the same way `sectionTitleIn` runs to the
   * card edges: a rule that stops short reads as an underlined word.
   */
  title: { fontFamily: F.dispSemi, fontSize: 18, letterSpacing: -0.1,
           textTransform: 'none' as const, color: C.ink,
           paddingBottom: 10, marginBottom: 12,
           borderBottomWidth: 1, borderBottomColor: C.line,
           marginHorizontal: -14, paddingHorizontal: 14 },
  group: {},
  groupGap: { marginTop: 14, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 12 },
  // The group heading. Quieter than the people under it and louder than the card's
  // own label — it is a divider that happens to be a word.
  groupLab: {
    fontFamily: F.dispSemi, fontSize: 12.5, letterSpacing: 1.1, color: C.steel,
    textTransform: 'uppercase', marginBottom: 5,
  },
  /**
   * A VERTICAL LIST, ONE PERSON PER ROW (hadar, 2026-08-14: "the invited people
   * should not be horizontal, but vertical").
   *
   * The horizontal who's-who strip could not survive real names. Each person had to
   * fit a column that got narrower as people were added, so "hadar wissotzky"
   * truncated and the role wrapped onto three lines — on the one section whose entire
   * job is to say WHO is on this record. A row gives every person the full width of
   * the card, reads top-to-bottom like everything else on these screens, and does not
   * change shape when a fourth person joins.
   */
  personRow: { flexDirection: 'row', alignItems: 'center', minHeight: 56 },
  // THE CLIENT'S BLOCK. Tinted and inset, so the one person who can agree to the
  // price is the one thing on the card that is not a plain row — visible at arm's
  // length in sun, which two greens eight hex points apart were not.
  clientRow: {
    // A NEUTRAL INSET, NOT A GREEN ONE (hadar, 2026-08-14: "if you want the message
    // section to be distinct you can't use the same colour palette for anything
    // else"). This was `tint('approved')` — the same soft green as the state band
    // twelve points above it, which is precisely the dilution he is describing: two
    // green blocks on one screen and neither of them means anything by being green.
    // The client is distinguished by POSITION and a HEADING instead, which survive
    // sunlight, colour-blindness and a screenshot.
    backgroundColor: C.surfaceMuted,
    /**
     * FULL-BLEED, UNBORDERED, SQUARE (hadar, 2026-08-24: "the selected people should
     * be gray as it is now but the full width of the section without border and
     * rounded [borders]").
     *
     * It was an inset pill: a rounded, outlined chip floating inside the card with a
     * 14pt margin of cream around it. Three edges saying the same thing -- the fill,
     * the border and the radius -- when the fill alone already says it, and the pill
     * repeated the card-inside-a-card shape the scope block was just fixed for.
     *
     * The negative margin cancels T.card's 14pt gutter so the grey runs to the card's
     * own edges; the matching padding puts the CONTENT back on the gutter, so only the
     * fill moves outward and the text still lines up with every other row.
     */
    marginHorizontal: -14, paddingHorizontal: 14,
    marginBottom: 2,
  },
  /**
   * The client's block, at the size the one person the extra is FOR deserves (hadar,
   * 2026-08-23). Only the padding lives here; the row inside scales itself — see
   * `PersonRow`'s `prominent`.
   *
   * 10% SHORTER (hadar, same note: "the selected items height should be 10% shorter").
   *
   * The arithmetic, because the number is not arbitrary and the next person will want
   * to know where it came from: the height is driven by kit's `personBig` minHeight of
   * 60 plus this padding top and bottom. It was 6 + 60 + 6 = 72. 72 x 0.9 = 64.8, so
   * the padding becomes 2.5 a side: 2.5 + 60 + 2.5 = 65.
   *
   * The padding is what moves, NOT `personBig`. That minHeight is the shared avatar
   * row used across the app, and shrinking it here would shrink every person on every
   * screen to fix one block. The horizontal padding is gone entirely -- `clientRow`
   * now owns the gutter, since it is the thing that bleeds.
   */
  clientRowBig: { paddingVertical: 2.5 },
  rowDivider: { borderTopWidth: 1, borderTopColor: C.line },
  // 44pt (mandate #3) — this is tapped with gloves on.
  removeX: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  removeXT: { fontFamily: F.body, fontSize: 15, color: C.muted },
  chev: { fontFamily: F.body, fontSize: 22, color: C.muted, paddingLeft: 4 },
  addPerson: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    minHeight: 44, marginTop: 8, borderTopWidth: 1, borderTopColor: C.line,
  },
  addPersonT: { fontFamily: F.bodySemi, fontSize: 14, color: C.ink },
} as const;
