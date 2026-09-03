/**
 * STEP 5 OF 5 — the screen a contractor reads before his change order goes out.
 *
 * WHY THIS EXISTS AS ITS OWN SCREEN (hadar, 2026-09-02, after three failed passes and a
 * mockup shown four times: "the design is not the design I showed you by any stretch").
 *
 * I had been subtracting from `ExtraDraftScreen` — hiding a card here, moving a section
 * there — and it never converged, because that screen answers a DIFFERENT QUESTION. It
 * is the record of an extra: what it is, what state it is in, what is still owed, every
 * affordance for changing any of it. Opened from the records list that is exactly right.
 * Thirty seconds after speaking, the only question is "did the app hear me correctly,
 * and who is it going to". Ten sections cannot be trimmed into four; the screens differ
 * in subject, not in density.
 *
 * WHAT IT DELIBERATELY DOES NOT DO IS RE-DECIDE ANYTHING. The three send gates
 * (`canSend` on the stage, `sendReadiness` on the content, `canSendExtra` on the
 * pipeline) are composed HERE from the same inputs and the same `sendGate` the draft
 * screen uses. A second screen that re-derived them would be the "two spellings that
 * drift apart" failure this codebase keeps hitting — and the thing that would drift
 * decides whether a priced document reaches a client. It renders; it does not judge.
 *
 * IT SHARES ITS PROPS WITH THE DRAFT SCREEN for the same reason: one contract, so a
 * field cannot mean one thing here and another there.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { t } from '../i18n';
import { canSend } from '../extralifecycle';
import { sendGate } from '../sendreadiness';
import { Button, Card, ChecklistRow } from './kit';
import { Icon } from './icon';
import { FlowRail } from './flowrail';
import { SendPreview } from './sendpreview';
import { C, F } from './theme';
import { touchTargets } from './tokens';
import type { ExtraDraftProps } from './extradraft';

export function FlowReviewScreen(p: ExtraDraftProps) {
  const gate = sendGate(p.readiness, p.proc);
  const canSendNow = canSend(p.rec.status) && gate.ok;
  // The one authority on whether a scope exists — the same blocker the draft screen and
  // the send gate read. Never `!scopeOfWork`: the column is seeded with a copy of the
  // title at birth, so it is never empty and every extra would look written.
  const scopeWritten = !p.readiness.blockers.includes('no_description');

  const schedule = p.scheduleEffect === 'adds_days'
    ? (p.scheduleDays != null
        ? t({ k: 'draft.vSchedDays', p: { n: String(p.scheduleDays) } } as any)
        : t('co.schedAdds'))
    : p.scheduleEffect === 'no_change' ? t('co.schedNo')
    : p.scheduleEffect === 'not_sure' ? t('co.schedUnsure') : null;

  /**
   * FOUR ROWS, AND ONLY FOUR. The draft screen's checklist carries eight, because it is
   * tracking everything still owed. This is a READ-BACK of what was heard, and mandate
   * #6 asks for exactly that on the fields a transcript can get wrong: the price, its
   * type, the schedule, and who asked. Payment timing and exclusions are not things the
   * app mishears — they are things nobody said — so they belong on the record, not here.
   */
  const rows = [
    { key: 'price_mode', label: t('draft.vPriceType'), onPress: p.onEditCost,
      value: p.priceMode === 'nte' ? t('draft.vNte') : t('erec.fixed'),
      state: 'done' as const },
    { key: 'price', label: t('draft.cost'), onPress: p.onEditCost,
      value: p.rec.priced ? p.rec.amount : null,
      state: p.readiness.recommended.includes('no_cost') ? 'missing' as const : 'done' as const },
    { key: 'schedule', label: t('draft.ckSchedule'), onPress: p.onEditSchedule,
      value: schedule,
      state: p.readiness.recommended.includes('no_schedule_effect') ? 'missing' as const : 'done' as const },
    { key: 'requested_by', label: t('draft.vRequestedBy'), onPress: p.onEditDetails,
      value: p.requestedBy, state: 'done' as const },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <ScrollView contentContainerStyle={{
        paddingHorizontal: 18,
        // The status bar's clearance belongs to the SCREEN. The draft screen kept it
        // inside ScreenHeader, which is how the rail ended up under the notch the first
        // time this was tried.
        paddingTop: 54,
        paddingBottom: touchTargets.camera + touchTargets.spacing + 24,
      }}>
        <FlowRail step={5} />

        <Text style={st.title}>{t('draft.reviewTitle')}</Text>
        {/* THE SUBTITLE IS A CLAIM, so it only gets made when it is true. "We pulled
            this from your recording" over a scope that was never written is the same
            defect as the old "we wrote up what you said" popup — a sentence that
            outruns its evidence, which CLAUDE.md names as this project's recurring one. */}
        <Text style={st.sub}>
          {scopeWritten ? t('draft.reviewSub') : t('draft.nothingHeardHere')}
        </Text>

        {/* ── NOTHING WAS HEARD, SAID ON THE SCREEN THAT CAN FIX IT ─────────────────
            hadar, 2026-09-02: "why is this section doesn't show up as part of the
            review screen."

            It was a popup and only a popup. He tapped OK and the reason vanished,
            leaving a review screen whose scope card said a quiet "Not written up yet"
            — and the two buttons that solve it, Edit text and Record change, sat
            underneath with nothing connecting them to what had gone wrong.

            A modal is for something you acknowledge; this is a STATE the screen is in
            until he does something about it, so the screen carries it. It disappears
            the moment a scope exists, because then it is no longer true. */}
        {!scopeWritten && (
          <View style={st.heard}>
            <Icon name="ntAttention" size={19} />
            <Text style={st.heardT}>{t('draft.notWrittenUp')}</Text>
          </View>
        )}

        {/* ── WHO IT GOES TO ──────────────────────────────────────────────────────
            hadar's artboard, 2026-09-03, put the recipient at the TOP of this screen,
            and that is the correction. Step 3 asked who this was for; four screens
            later, on the one where a priced document becomes real, this screen never
            said the answer back. "Send" with no name above it is a button asking for
            trust it has not earned.

            It shows the name and the role and nothing else, because that is what the
            record holds. The artboard also draws an email and a phone; those are not
            on this screen's props, and printing a channel we have not verified next to
            "Send" would tell him a text is going somewhere it may not. The pencil opens
            the client drawer, where the real contact details live and can be fixed. */}
        {!!p.requestedBy && (
          <Pressable onPress={p.onEditClient ?? p.onEditDetails}
            accessibilityRole="button"
            style={({ pressed }) => [st.who, pressed && { opacity: 0.65 }]}>
            <View style={st.avatar}>
              <Text style={st.avatarT}>{initials(p.requestedBy)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={st.whoLabel}>{t('r5c.recipient')}</Text>
              <Text style={st.whoName} numberOfLines={1}>{p.requestedBy}</Text>
              {!!p.clientTypeLabel && (
                <Text style={st.whoRole} numberOfLines={1}>{p.clientTypeLabel}</Text>
              )}
            </View>
            <Icon name="edit" size={19} />
          </Pressable>
        )}

        {/* ── EXACTLY WHAT THE CLIENT WILL SEE ────────────────────────────────────
            The price, the LINE ITEMS behind it, the photos, the scope, the exclusions
            and the schedule effect — the document, on the screen where he decides to
            send it. This screen used to show four read-back rows and a scope, so the
            figure a client would be asked to approve was never actually displayed to
            the contractor approving it. Mandate #2 does not say confirm the recipient;
            it says anything carrying a PRICE takes a human confirmation.

            hadar, 2026-09-03: "the breakdown is not by labor and materials but more
            reflecting the different line items we have" — so the breakdown is
            `rec.costLines`, parsed once in record.ts, never two buckets. */}
        {/* RENDERED EVEN WHEN THE SCOPE IS MISSING. It used to be gated on
            `scopeWritten`, which was fine while a separate card carried the empty case
            — but that card is gone, and gating it now would leave a man with nothing to
            tap on the one screen where he needs to write the thing. The preview shows
            the document as it stands, missing scope included; that IS the state, and
            hiding it would not change it. */}
        {(
          <View style={{ marginTop: 18 }}>
            <SendPreview
              amount={p.rec.amount}
              priced={p.rec.priced}
              nte={p.rec.nte}
              isNte={p.priceMode === 'nte'}
              // ONE answer to "is there a scope", shared with the banner above it.
              scopeWritten={scopeWritten}
              scopeOfWork={p.rec.scopeOfWork}
              lines={p.rec.costLines}
              photos={p.rec.photos}
              exclusions={p.exclusions}
              scheduleEffect={p.scheduleEffect}
              scheduleDays={p.scheduleDays}
              onPhoto={p.onPressPhoto}
              onEditScope={p.onEditDescription}
            />
          </View>
        )}

        {/* THE DESCRIPTION CARD IS GONE (hadar, 2026-09-03: "remove edit description
            and record change from the review stage — the description section should not
            be there. the user should be able to edit the scope of work not the
            description at this point").

            It was one field said three ways. The card was headed "Description"; its
            "Edit text" button opened the SCOPE editor (`onOpenDetail('scope')`), so the
            label and the control already disagreed; and the preview above printed the
            same scope a third time. On the screen where that text becomes the binding
            instrument, three spellings of one field is the drift this project keeps
            paying for.

            Nothing is lost. Editing moved INTO the preview, on the words themselves,
            where the man is already reading them — including when there is no scope yet,
            which is the state that most needs a way in. "Record change" is unchanged and
            still in the footer, where every step of this sequence keeps its actions; it
            was only ever duplicated here. */}

        {/* THE READ-BACK STAYS, even though the preview above now shows the price and
            the schedule. It is not a duplicate: the preview is the DOCUMENT and the
            checklist is where a wrong number gets fixed. Mandate #6 asks for read-back
            plus on-screen tap-to-correct on exactly these fields, and the artboard —
            which offers no way to change a figure at all — cannot override that. */}
        <Card style={{ marginTop: 14 }}>
          <Text style={st.cardLabel}>{t('draft.extracted')}</Text>
          <View style={{ marginTop: 2 }}>
            {rows.map((r) => (
              <ChecklistRow key={r.key} state={r.state} label={r.label}
                value={r.value} onPress={r.onPress} />
            ))}
          </View>
        </Card>

        {/* MANDATE #2, PRINTED WHERE IT IS BEING KEPT. Nothing carrying a price commits
            or sends without a human confirming it — and this is the one moment a person
            wonders whether the app has already sent it on their behalf. */}
        <View style={st.assure}>
          <Icon name="shield" size={19} />
          <Text style={st.assureT}>{t('draft.nothingSentYet')}</Text>
        </View>
      </ScrollView>

      {/* THE FOOTER IS PINNED. Send is the point of the screen and must not require a
          scroll to reach — a change order that is one gesture away from going out is the
          entire product. */}
      <View style={st.foot}>
        <Button label={t('draft.recordChanges')} icon="microphone" variant="secondary"
          onPress={p.onAddPhotos} />
        <View style={{ height: 10 }} />
        {/* REFUSAL RIDES INSIDE THE BUTTON, as its second line. A dead Send with a
            separate red sentence above it is a control explaining somebody else's job;
            the button that cannot be pressed should be the thing that says why. */}
        {/* `refused` DIMS BUT DOES NOT BLOCK — and I did not read the kit before using
            it (Codex, 2026-09-03).

            `Button`'s `refused` prop deliberately leaves `onPress` live: the kit's rule
            is that a refused control must SAY why rather than swallow the touch
            (kit.tsx:812-825). Only `disabled` blocks. I wrote `refused={!canSendNow}`
            with `onPress={p.onSend}` believing it behaved like the draft screen's Send,
            which is a raw Pressable with a real `disabled` (extradraft.tsx:1742).

            So on THIS screen a refused Send still ran `p.onSend` → `openSendPrep`, and
            that function gathers recipients WITHOUT re-checking readiness (App.tsx:2673)
            — its sheet gates on recipient and SMS consent only. A change order with no
            scope of work, no photos, or still mid-pipeline could be sent to a client in
            two taps, straight past the gate this screen exists to enforce.

            That is mandate #2 — anything carrying a price takes a human confirmation
            before it commits or sends — defeated by the screen built to hold it.

            The guard goes on the handler, not the prop: the button must keep looking
            pressable and the reason must stay printed beneath it (the kit's rule is
            right), but a refused tap must not reach the send path. */}
        <Button label={t('erec.send')} icon="send"
          onPress={() => { if (canSendNow) p.onSend(); }}
          refused={!canSendNow} />
        {!canSendNow && !!refusalLine(p, gate) && (
          <Text style={st.refused}>{refusalLine(p, gate)}</Text>
        )}

        {/* THE WAY OUT, AND THE LOOP NEEDS ONE (hadar, 2026-09-02: "until he chooses to
            send or closes for now").

            Recording a correction returns here, which is right — but a loop with only
            one exit is a trap, and the exit it had was the one act that cannot be undone.
            A man who realises he needs a photo from the roof, or the client's number, or
            simply his lunch, must be able to put this down.

            NOTHING IS LOST BY LEAVING. The change order is a saved draft; it sits under
            "Needs you first" on Home and reopens as the record, with everything he has
            said so far. Quiet text rather than a button: it must be findable, never
            competitive with Send. */}
        <Pressable onPress={p.onBack} accessibilityRole="button" style={st.close}>
          <Text style={st.closeT}>{t('draft.closeForNow')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Up to two initials for the avatar. Purely decorative — the name is printed beside it,
 * so a name this cannot reduce (one word, a symbol) costs nothing.
 */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '';
  return (first + last).toUpperCase();
}

/** Why Send is refused, in the language of whichever gate refused it. */
function refusalLine(p: ExtraDraftProps, gate: ReturnType<typeof sendGate>): string | undefined {
  if (gate.ok) return undefined;
  // A CONTENT refusal is something he can fix standing here; a PIPELINE refusal is
  // something he can only wait out. Telling a man his recording is still uploading when
  // his real problem is that he never said a price sends him to stand by a window.
  if (gate.kind === 'pipeline') return t(gate.whyKey as any);
  const n = gate.readiness.blockers.length;
  return t(n === 1 ? 'draft.addOneToSend' : ({ k: 'draft.addNToSend', p: { n } } as any));
}

const st = StyleSheet.create({
  title: { fontFamily: F.bodyBold, fontSize: 30, lineHeight: 34, color: C.ink,
    letterSpacing: -0.4, marginTop: 16 },
  sub: { fontFamily: F.body, fontSize: 15.5, lineHeight: 21, color: C.steel, marginTop: 7 },
  cardLabel: { fontFamily: F.dispSemi, fontSize: 12, letterSpacing: 0.8, color: C.muted,
    textTransform: 'uppercase', marginBottom: 10 },
  // `caution` from the tint table, not an amber mixed here: "A screen never mixes its
  // own amber" (theme.ts). Peach and a hairline, which is what "say it again" looks
  // like — this is not a failure to be afraid of. The recording is saved.
  heard: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, marginTop: 16,
    paddingHorizontal: 15, paddingVertical: 14, borderRadius: 12,
    backgroundColor: '#FFF3EA', borderWidth: 1, borderColor: '#FFD9C2' },
  heardT: { flex: 1, fontFamily: F.bodySemi, fontSize: 14.5, lineHeight: 20, color: '#7A3A12' },
  who: { flexDirection: 'row', alignItems: 'center', gap: 13, marginTop: 18,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 14,
    paddingHorizontal: 15, paddingVertical: 14, minHeight: 82 },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: C.brandSoft,
    alignItems: 'center', justifyContent: 'center' },
  avatarT: { fontFamily: F.bodyBold, fontSize: 18, color: C.brandDark },
  whoLabel: { fontFamily: F.dispSemi, fontSize: 11, letterSpacing: 0.9, color: C.muted,
    textTransform: 'uppercase' },
  whoName: { fontFamily: F.bodyBold, fontSize: 19, color: C.ink, marginTop: 2 },
  whoRole: { fontFamily: F.body, fontSize: 14.5, color: C.steel, marginTop: 1 },
  assure: { flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 18,
    paddingHorizontal: 15, paddingVertical: 14, borderRadius: 12, backgroundColor: C.brandSoft },
  assureT: { flex: 1, fontFamily: F.body, fontSize: 14.5, color: C.ink, lineHeight: 19 },
  refused: { fontFamily: F.body, fontSize: 13.5, lineHeight: 18, color: C.steel,
    textAlign: 'center', marginTop: 8 },
  // 44pt minimum (mandate #3) even though it is a text link: gloves do not care that
  // something is styled quietly.
  close: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  closeT: { fontFamily: F.bodySemi, fontSize: 15, color: C.steel },
  foot: { borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.card,
    paddingHorizontal: 18, paddingTop: 12, paddingBottom: 22 },
});
