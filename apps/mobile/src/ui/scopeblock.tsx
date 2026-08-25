/**
 * THE SCOPE OF WORK, rendered the same way at every stage of the extra's life.
 *
 * ONE COMPONENT FOR ALL THREE SCREENS, and that is the requirement rather than a
 * tidiness preference (hadar, 2026-08-05, after reviewing the detail page draft →
 * approved). The product's entire promise is that the contractor, the owner and the
 * record agree about what was bought. That is only believable if the reader can SEE
 * the text not changing — so draft, negotiation and locked must render the same
 * prose, in the same place, in the same type. Three separate renderings is how they
 * drift, and two of the three had already drifted into a one-line truncated row.
 *
 * WHAT THE REVIEW FOUND, and what this fixes:
 *   · Draft — the scope sat 620px down, below the price and the raw capture rows,
 *     clipped at five lines behind "Show more".
 *   · Sent — a single truncated row ("Description / Scope · Install new 200A…") on
 *     the very screen where the contractor is answering questions about it.
 *   · Approved — the same truncated row, on the screen a dispute is settled with.
 *
 * NEVER TRUNCATED. A scope you have to tap to read is a scope nobody proofreads
 * before it goes to a client, and the whole failure this fixes is a client signing
 * something nobody read. Long scopes scroll inside their own box rather than being
 * hidden behind a control — the fireplace example runs 2,651 characters and that is
 * a NORMAL length for a job with steps, assumptions and exclusions.
 *
 * THE CAPTION IS THE POINT OF THE STAGE. "This is what the owner reads and signs"
 * on a draft is the sentence that makes a contractor write two paragraphs instead of
 * three words; "exactly as sent" and "exactly as signed" are the claims the frozen
 * instrument lets us make truthfully. They are not decoration — they are the reason
 * the same block reads differently at each stage without the TEXT changing.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { t } from '../i18n';
import { C, F } from './theme';
import { Icon } from './icon';
import { Section } from './kit';

export type ScopeStage = 'draft' | 'sent' | 'signed';

export function ScopeBlock({ text, stage, onEdit, missing, pending, pendingLabel, pendingIsWait = true, footer }: {
  /** The scope of work. Empty renders the gap, never a blank box. */
  text: string | null | undefined;
  stage: ScopeStage;
  /** Draft only. Absent = not editable from here (a frozen extra). */
  onEdit?: () => void;
  /** True when readiness counts this as a blocker — the caller owns that verdict. */
  missing?: boolean;
  /**
   * The write-up has not been produced YET — the recording is still going up, or up
   * and being read (hadar 2026-08-06: "if scope of work was not yet processed, a
   * better message needs to be told").
   *
   * It outranks `missing` on purpose. Both can be true at once — an unwritten scope
   * is of course too short — but they are different facts with different audiences.
   * "Too short to send. Describe the work the way you would explain it on site." is
   * an instruction to a man who has not done his part; printing it while the app is
   * still transcribing his recording blames him for our wait, on the exact screen
   * where he is waiting for us.
   */
  pending?: boolean;
  /** The words for that wait, already translated — the caller owns which stage of the
   *  pipeline it is in, since only it knows. */
  pendingLabel?: string;
  /** Is the pending state a WAIT (something is coming) or a GAP that will stay a gap
   *  until a person fills it? Only the wait gets the hourglass; drawing one over a
   *  recording that is not on this device promises an arrival that cannot happen. */
  pendingIsWait?: boolean;
  /**
   * Rendered INSIDE this block, under the box, when the caller has something to say
   * about why the scope is missing and what to do about it.
   *
   * A prop rather than a sibling because the two are one object on screen: a card that
   * says "no write-up came back" belongs against the empty scope it is describing, not
   * below the price with a dollar figure in between (hadar 2026-08-06). ScopeBlock
   * stays dumb about WHAT the fix is — it owns the frame, the caller owns the words.
   */
  footer?: React.ReactNode;
}) {
  const body = (text ?? '').trim();
  const frozen = stage !== 'draft';
  const waiting = !!pending && !body;

  return (
    /**
     * ONE CARD, LIKE EVERY OTHER SECTION (hadar, 2026-08-24: "scope of work is outside
     * of the section -- it is different [from] the whole design -- we should put that
     * title inside the section ... like price and raw collection [information]
     * sections").
     *
     * It used to draw its own: a heading sitting on the cream page, and under it a
     * separate bordered box. Two problems, and the second is the one that mattered.
     * Cosmetically it was the only section on the screen whose title was not on its
     * card, so the most important block read as though it belonged to nothing.
     * Structurally it was a SECOND implementation of a section — which is how it came
     * to differ at all, and how it would have differed again.
     *
     * `Section` now carries the Edit control in its `action` slot, so this block asks
     * for the standard furniture instead of imitating it, and the body sits directly
     * on the card rather than in a box inside a box.
     */
    <Section
      title={t('scope.heading')}
      style={frozen ? st.cardFrozen : undefined}
      action={stage === 'draft' && onEdit ? (
        <Pressable onPress={onEdit} hitSlop={8} style={st.editHit}
          accessibilityRole="button" accessibilityLabel={t('scope.edit')}>
          <Text style={st.edit}>{t('scope.edit')}</Text>
        </Pressable>
      ) : undefined}
    >

      {body ? (
        // A SECTION THAT GROWS, not a window that scrolls (hadar 2026-08-07: "the scope
        // should not be a scrollable section").
        //
        // It was a nested ScrollView capped at 320pt. That made sense when the scope was
        // a paragraph; since 393 it is a structured document — WHY THIS IS NEEDED, the
        // numbered steps, what is and is not included, the conditions — and a 320pt
        // window over it shows about a third at a time. The reader most likely to be
        // hurt is the one who matters: someone checking the exclusions before a client
        // signs, who cannot see them without discovering that this particular grey box
        // scrolls independently of the page.
        //
        // A scroll view inside a scroll view is also a gesture fight — a drag that
        // starts here moves the inner box while the page stands still, which reads as a
        // stuck screen. The page scrolls; the document is simply all there.
        <View style={st.box}>
          {/* HEADINGS BOLD, IN THE RENDER ONLY (hadar 2026-08-07).
              The stored string stays plain text and MUST: `scope_of_work` is frozen
              into `shown_content`, which is the binding instrument, and the same string
              is rendered into an approval web page, a PDF and an SMS-length preview.
              Markdown in the stored text would either leak asterisks into a document
              somebody signs or oblige four renderers to agree on a parser. The document
              stays plain; only this view knows how to weight it.
              A heading is a line `renderScope` wrote in caps — the test is deliberately
              narrow (caps, spaces and & only) so a shouted sentence in a contractor's
              own scope is not silently promoted to a section title. */}
          {body.split('\n').map((line, i) => (
            <Text key={i}
              style={[st.body, /^[A-Z][A-Z '&]{2,}$/.test(line.trim()) && st.bodyHead]}
              selectable>
              {line || ' '}
            </Text>
          ))}

          {/* THE CAPTION LIVES INSIDE THE CARD (hadar 2026-08-14: "put it inside the
              scope card").
              It used to sit under the box, on the cream page, between this card and the
              price card — so "The client signs this." read as a line floating in the gap
              belonging to neither, the same complaint the price section had just been
              fixed for. It is a footnote ABOUT this document, so it belongs on the same
              sheet of paper, separated by a rule rather than by empty space. */}
          <View style={st.capRule} />
          <Text style={[st.caption, missing && st.captionWarn]}>
            {missing
              ? t('scope.tooShort')
              : t(stage === 'draft' ? 'scope.capDraft'
                : stage === 'sent' ? 'scope.capSent' : 'scope.capSigned')}
          </Text>
        </View>
      ) : (
        // THE GAP, DRAWN AS AN EMPTY STATE (hadar 2026-08-06, with a competitor's
        // "Client details / Add client information to keep track of who you're working
        // with / [Add client]" card as the reference: "needs to be clear").
        //
        // It used to be one red line in a grey box — the shape of a validation error,
        // which is what it read as: something you did wrong, in a place you cannot see
        // what is missing. An absence is not an error. Three parts, the way the whole
        // industry draws them and for the reason they do: a MARK so the eye stops, a
        // HEADING that names the state in three words, and ONE sentence saying what
        // goes here and why it matters. No button — the act lives once, in the bottom
        // bar (Generate, or Edit above), and this screen has already been through one
        // round of the same offer appearing three times.
        // Tappable unless something really is on its way: a gap nobody is going to fill
        // for him must stay one tap from the editor, or the screen states a problem and
        // then withholds the only fix.
        <Pressable onPress={onEdit} disabled={!onEdit || (waiting && pendingIsWait)}
          style={[st.box, st.empty]}
          accessibilityRole={onEdit && !(waiting && pendingIsWait) ? 'button' : undefined}
          accessibilityLabel={waiting ? t('scope.workingTitle') : t('scope.emptyTitle')}>
          <Icon name={waiting && pendingIsWait ? 'waiting' : 'doc'} size={26} color={C.muted} />
          <Text style={st.emptyTitle}>
            {waiting && pendingIsWait ? t('scope.workingTitle') : t('scope.emptyTitle')}
          </Text>
          {/* Suppressed when a footer is present: the footer says the same thing with
              more precision AND offers the fix, so printing both is the "one fact, two
              sentences" this screen has already been trimmed for twice. */}
          {!footer && (
            <Text style={st.emptyBody}>
              {waiting ? (pendingLabel ?? t('scope.working')) : t('scope.emptyBody')}
            </Text>
          )}
        </Pressable>
      )}

      {/* No caption under the empty state: it just said all of this, at full size and
          in the middle of the box. A second, smaller copy underneath is the "one fact,
          two sentences" the draft banner was already trimmed for. */}
      {!!footer && <View style={{ marginTop: 10 }}>{footer}</View>}

    </Section>
  );
}

const st = StyleSheet.create({
  editHit: { minHeight: 32, justifyContent: 'center' },
  edit: { fontFamily: F.bodySemi, fontSize: 14.5, color: C.ink },
  // The document sits DIRECTLY ON THE CARD. It used to be a bordered, differently
  // tinted box nested inside — a card within a card, which is the thing that made this
  // section look unlike the others. `Section` owns the frame now; this owns spacing.
  box: { paddingTop: 10, paddingBottom: 2 },
  // Frozen text sits on the muted surface — the same signal the app uses everywhere for
  // "this is a record, not a field". It moves to the CARD, so the whole section reads
  // as a record instead of one tinted panel inside a cream one.
  cardFrozen: { backgroundColor: C.surfaceMuted },
  /**
   * THE DOCUMENT ITSELF, 10% up (hadar, 2026-08-25): 15 -> 16.5, line height 22 -> 24.
   *
   * The proportion is kept because this is prose, not a label: at ~1.45 the lines stay
   * far enough apart to track across a paragraph of numbered steps and bullet lists,
   * which is what this block actually holds since 393. Raising the size alone would
   * tighten the leading and make a long scope harder to read, not easier.
   *
   * `bodyHead` deliberately sets no size of its own, so the ALL-CAPS section headings
   * inside the document scale with the body and the hierarchy holds.
   *
   * NOT TRUNCATED AND NOT SCROLLED — see the header. Bigger text simply makes the block
   * taller, which is the intended trade: the page scrolls, and a scope nobody proofreads
   * is the failure this component exists to prevent.
   */
  body: { fontFamily: F.body, fontSize: 16.5, lineHeight: 24, color: C.ink },
  // Bold + a little air above, so the sections read as sections rather than as a wall
  // of sentences that happens to contain capitals.
  bodyHead: { fontFamily: F.bodyBold, marginTop: 10 },
  // Centred, with room to breathe — an empty state is a small poster, not a row.
  // An INSET WELL, not a card: muted fill and no border, so it reads as a hollow in
  // the section rather than as a second card competing with the one around it.
  empty: {
    minHeight: 132, alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingHorizontal: 22, paddingVertical: 20,
    marginTop: 10, marginBottom: 2, borderRadius: 10,
    backgroundColor: C.surfaceMuted,
  },
  emptyTitle: { fontFamily: F.bodyBold, fontSize: 15.5, color: C.ink, textAlign: 'center' },
  // NOT `C.danger`. Red said "you broke something" about a field nobody has filled in
  // yet — and while the pipeline is running it is not even his to fill.
  emptyBody: { fontFamily: F.body, fontSize: 13.5, lineHeight: 19, color: C.muted, textAlign: 'center' },
  // A hairline, full-bleed inside the box's padding, so the footnote is separated from
  // the document without being pushed off it.
  // Full-bleed against the CARD's 14pt gutter (it was -12, for the old inner box's
  // padding). A rule that stops short of the edge reads as a broken underline.
  capRule: { height: 1, backgroundColor: C.line, marginTop: 12, marginHorizontal: -14 },
  caption: { fontFamily: F.body, fontSize: 12.5, color: C.muted, marginTop: 8 },
  captionWarn: { color: C.danger, fontFamily: F.bodySemi },
});
