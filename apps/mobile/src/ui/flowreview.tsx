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
        <Text style={st.sub}>{t('draft.reviewSub')}</Text>

        {/* SCOPE OF WORK — the words themselves, never truncated and never behind a tap.
            A scope you have to expand to read is a scope nobody proofreads before it
            goes to a client. */}
        <Card style={{ marginTop: 18 }}>
          <Text style={st.cardLabel}>{t('draft.ckDescription')}</Text>
          <Text style={st.scope}>
            {scopeWritten ? p.rec.scopeOfWork : t('draft.notWrittenUp')}
          </Text>
          {/* THE TWO WAYS THIS PRODUCT TAKES INPUT, offered where the words are. The mic
              is not decoration: gloves on a ladder cannot type, and talking being the
              fast path is the whole premise (mandate #3). */}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
            <View style={{ flex: 1 }}>
              <Button label={t('draft.editText')} icon="edit" variant="secondary"
                onPress={p.onEditDescription} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label={t('draft.recordChange')} icon="microphone" variant="secondary"
                onPress={p.onAddPhotos} />
            </View>
          </View>
        </Card>

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
        {/* `refused` rather than `disabled`: it dims the button the same way but keeps
            it pressable-looking enough to be understood as blocked-for-a-reason, and the
            reason is printed directly beneath rather than as a separate red sentence
            somewhere above. A refused Send must always SAY why. */}
        <Button label={t('erec.send')} icon="send" onPress={p.onSend}
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
  // 17pt and 24 line-height: this is the paragraph a client will read, and it is the one
  // thing on the screen that must be comfortable rather than compact.
  scope: { fontFamily: F.body, fontSize: 17, lineHeight: 24, color: C.ink },
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
