/**
 * ONE ROW FOR ONE EXTRA — the card the Job screen, Home and the Company feed all use.
 *
 * hadar 2026-08-13: "make sure that the Home screen record and the company feed record
 * look the same as jobs records."
 *
 * ─── WHY THIS IS A COMPONENT AND NOT THREE COPIES ───────────────────────────────
 * The same object was drawn three different ways. The Job screen had the designed card
 * — thumbnail, number, one-line title, meta, schedule, price. Home and the feed shared a
 * second, older shape: no thumbnail, no number, a two-line title, and the price as a
 * small grey line under the meta rather than the second-loudest thing on the row.
 *
 * Reading the same extra on two screens and seeing two different objects is the exact
 * confusion this card was designed to end. And a fix applied to one copy — the
 * truncating number, the clock in the date, the price a line too low — silently did not
 * reach the other two. Three copies is three chances to be wrong and one chance to be
 * consistent.
 *
 * ─── WHAT THE CALLER DECIDES, AND WHAT IT DOES NOT ──────────────────────────────
 * Layout, type and spacing are FIXED here. That is the whole point.
 *
 * The META LINES are the caller's, because the three screens genuinely answer different
 * questions. Inside one job, every row shares the address, so the meta says when it was
 * raised and who asked. On Home and the feed, rows span jobs, so the job name is the
 * first thing that has to be said. Forcing one meta on all three would make two of them
 * lie by omission.
 */
import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from './icon';
// The waiting palette. `savedLocal` is the app's steel-blue for "on the phone, not yet
// off it" — deliberately not the amber that means somebody must act.
import { C } from './theme';

/** Outline colours per state. `approved` is the one with a tint. */
export type ExtraChip = { color: string; bg: string; line: string; label: string };

export type ExtraCardProps = {
  /** The green kicker above the title. "Change Order #18", or the fallback when the
   *  extra has no number yet. */
  kicker: string;
  chip: ExtraChip;
  /** The scope. Rendered on ONE line — see the note at `name`. */
  title: string;
  /** Absolute path to a cover photo, or null for the microphone placeholder. */
  photoUri?: string | null;
  /** One per line, in order. Nulls are dropped. The caller decides what these say. */
  meta: Array<string | null | undefined>;
  /**
   * THE ONE PERSON THIS ROW LEADS WITH — drawn with a glyph, in ink, directly under
   * the title, rather than as another grey fact in the meta stack.
   *
   * hadar, 2026-08-14: "company feed record — the person who raised it needs to be more
   * prominent, maybe using an icon? Bold?" He is describing what the meta array does to
   * a human being: on the feed the author was the third of three identical 13pt grey
   * lines, between the job name and the date, so the answer to "whose extra is this"
   * looked exactly like the answer to "what day was it". On a company-wide stream that
   * is the question an owner opens the screen to ask.
   *
   * WHICH person differs by screen and the label says so — the feed's is who RAISED it,
   * a job's is who ASKED for it. They are not the same human and must never be drawn as
   * if they were interchangeable; the label is required for that reason.
   */
  person?: { label?: string | null; name: string } | null;
  /**
   * The WHEN, right-aligned on the same closing line as the person (hadar,
   * 2026-08-14: "place it as the last line and align the date to the right").
   *
   * Who and when belong together — they are one fact about the record's origin, and
   * pairing them on the closing line takes a whole grey line out of the middle of the
   * card without losing anything. Left in the `meta` stack it was a third fact
   * competing with the two that identify the row.
   */
  personRight?: string | null;
  /** Already-translated "In conversation" line, shown with the conversation glyph when
   *  the client has asked something. Null/omitted hides the row — no placeholder. */
  conversation?: string | null;
  /**
   * NOT YET OFF THIS PHONE (hadar, 2026-08-19: "when the change order is in the list it
   * should indicate to the user in the record with colour that it is not yet processed").
   *
   * Already translated. Rendered in the app's WAITING colour — the steel-blue that
   * `status.ts` assigns to `savedLocal`, not the amber that means somebody must act and
   * not the red that means something broke. Mandate #7: no signal is the expected
   * condition on a jobsite, so this line reports a state, it does not raise an alarm.
   */
  pending?: string | null;
  /**
   * Already formatted and already whole ("$1,450").
   *
   * NO PRICING-TYPE LABEL UNDER IT (hadar 2026-08-13: "remove the payment type field
   * and schedule change field"). "Fixed price" / "Not to exceed" and "Adds 7 working
   * days" both used to sit on this card. They are terms of the deal — they belong on
   * the record, where they are read once and carefully, not on a row that is skimmed.
   * On a list they cost two lines per card to answer a question nobody asks while
   * scanning, which is what a list is for.
   */
  amount?: string | null;
  onPress: () => void;
  accessibilityLabel?: string;
};

export function ExtraCard({
  kicker, chip, title, photoUri, meta, person, personRight, conversation, pending, amount,
  onPress, accessibilityLabel,
}: ExtraCardProps) {
  const metaLines = meta.filter((m): m is string => !!m);
  return (
    <Pressable style={st.card} onPress={onPress}
      accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? title}>
      {photoUri
        ? <Image source={{ uri: photoUri }} style={st.thumb} resizeMode="cover" />
        : <View style={[st.thumb, st.thumbEmpty]}>
            <Icon name={'microphone' as IconName} size={22} color="#8A93A0" /></View>}

      {/* ONE FLEXIBLE COLUMN, NOT THREE SIDE-BY-SIDE.
          An earlier version was thumb | text | price, and a price block does not shrink
          (RN defaults flexShrink to 0), so on a 393pt screen the text column was left
          ~10pt and "Change Order #16" rendered one character per line straight down the
          card. Everything below stacks inside one column instead. */}
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={st.top}>
          {/* THE NUMBER HOLDS ITS WIDTH; THE CHIP IS WHAT GIVES. It was the other way
              round, and the first row of a job read "Change Order #..." while the one
              under it read "#17". The number is the IDENTIFIER — the only thing
              separating two extras raised the same week on the same job. The chip can
              afford a character: its meaning is carried by its colour, its outline, and
              the filter the reader just tapped. */}
          <Text style={st.kicker} numberOfLines={1}>{kicker}</Text>
          <View style={[st.chip, { backgroundColor: chip.bg, borderColor: chip.line }]}>
            <Text style={[st.chipT, { color: chip.color }]} numberOfLines={1}>{chip.label}</Text>
          </View>
        </View>

        {/* ONE LINE. The rows are all the same height, and that is what makes the
            column scannable — a two-line title on one card and a one-line title on the
            next breaks the rhythm the eye is skimming with. The full scope is one tap
            away, and the number above it is the identifier, so nothing is lost. */}
        <Text style={st.name} numberOfLines={1}>{title}</Text>

        {/* THE PRICE SITS LEVEL WITH THE FIRST META LINE — `alignItems: flex-start` is
            what levels it with the first rather than the last. */}
        <View style={st.bottom}>
          <View style={{ flex: 1, minWidth: 0, paddingRight: 10 }}>
            {/* ONE FACT PER LINE, never joined by a separator. Sharing the row with the
                price leaves this column ~135pt; a joined run broke as "Initiated Aug 7 •"
                with the bullet dangling and then ellipsised the name away. */}
            {metaLines.map((m, i) => (
              <Text key={i} style={st.meta} numberOfLines={2}>{m}</Text>
            ))}
            {!!conversation && (
              <View style={st.sched}>
                <Icon name={'updated' as IconName} size={15} />
                <Text style={[st.schedT, { color: '#B26A00' }]} numberOfLines={1}>
                  {conversation}
                </Text>
              </View>
            )}
            {!!pending && (
              <View style={st.sched}>
                <Icon name={'savedLocal' as IconName} size={15} color={C.savedLocal} />
                <Text style={[st.schedT, { color: C.savedLocal }]} numberOfLines={1}>
                  {pending}
                </Text>
              </View>
            )}
          </View>
          {!!amount && (
            <View style={st.price}>
              <Text style={st.amt} numberOfLines={1}>{amount}</Text>
            </View>
          )}
          <Icon name={'chevRight' as IconName} size={16} color="#8A93A0" />
        </View>

        {/* THE CLOSING LINE — who raised it, and when. Last, not under the title
            (hadar, 2026-08-14).
            The label stays quiet and the NAME carries the weight: "Raised by" is the
            same two words on every row of the feed, so bolding it would emphasise the
            one part that never varies. The date sits hard right, which gives the two
            facts their own ends of the row and lets a long name run without pushing
            the date off the card. */}
        {(!!person?.name || !!personRight) && (
          <View style={st.person}>
            {!!person?.name && (
              <>
                <Icon name={'person' as IconName} size={14} color="#4a4a46" />
                <Text style={st.personT} numberOfLines={1}>
                  {!!person.label && <Text style={st.personLab}>{person.label} </Text>}
                  {person.name}
                </Text>
              </>
            )}
            {!!personRight && (
              <Text style={st.personWhen} numberOfLines={1}>{personRight}</Text>
            )}
          </View>
        )}
      </View>
    </Pressable>
  );
}

const st = StyleSheet.create({
  // WIDTH RECLAIMED FROM THE FURNITURE, NOT FROM THE TYPE. The widest pair this row can
  // hold — "Change Order #18" beside "Waiting on owner" — overran a 375pt screen and
  // clipped the chip. The thumbnail gives up 4pt and the gaps 3pt between them, which
  // buys the top row its margin and widens the meta and schedule lines for free.
  card: { flexDirection: 'row', gap: 9, backgroundColor: '#FFFFFF', borderWidth: 1,
    borderColor: '#E4E1D9', borderRadius: 8, padding: 12, marginBottom: 8 },
  thumb: { width: 72, height: 72, borderRadius: 6, backgroundColor: '#EFEBE3' },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },

  top: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kicker: { flexShrink: 0, fontFamily: 'Inter_600SemiBold', fontSize: 13.5, color: '#2F5233' },
  chip: { flexShrink: 1, marginLeft: 'auto', borderRadius: 999, borderWidth: 1,
    paddingHorizontal: 7, paddingVertical: 3 },
  chipT: { fontFamily: 'Inter_600SemiBold', fontSize: 11, letterSpacing: 0.1 },

  // The supporting lines carry the facts somebody actually scans for — which extra,
  // when, how long, how much. They were 10.5-12pt against an 18pt title, which read as
  // a headline with fine print under it.
  name: { fontFamily: 'Inter_700Bold', fontSize: 18, lineHeight: 23, color: '#131110',
    marginTop: 5, letterSpacing: -0.3 },
  meta: { fontFamily: 'Inter_400Regular', fontSize: 13, color: '#6b625b', marginTop: 2 },
  // The closing line. A hairline above it so it reads as the row's footer rather than
  // as one more fact that happened to end up last.
  person: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 9,
    paddingTop: 8, borderTopWidth: 1, borderTopColor: '#EFEBE3' },
  personT: { fontFamily: 'Inter_600SemiBold', fontSize: 13.5, color: '#131110', flexShrink: 1 },
  personLab: { fontFamily: 'Inter_400Regular', fontSize: 13, color: '#6b625b' },
  // `marginLeft: auto` and not a spacer View: with no person on the row the date still
  // lands hard right instead of at the left edge.
  personWhen: { marginLeft: 'auto', paddingLeft: 8, flexShrink: 0,
    fontFamily: 'Inter_400Regular', fontSize: 13, color: '#6b625b' },
  sched: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  schedT: { fontFamily: 'Inter_400Regular', fontSize: 13, color: '#6b625b', flexShrink: 1 },

  bottom: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 6 },
  price: { flexShrink: 0, alignItems: 'flex-end' },
  // 18, not 20: the price was LARGER than the title, which the design does not do and
  // which cost the schedule line its width.
  amt: { fontFamily: 'Inter_700Bold', fontSize: 18, color: '#2F5233', letterSpacing: -0.5 },
});
