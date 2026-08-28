/**
 * WHO IS THIS FOR — asked once, right after the job, on a NEW extra.
 *
 * hadar, 2026-08-23, stating the intended flow of a new change order: "... select
 * location (choose) -> popup to select owner -> preview CO". This is that popup, and it
 * was the one step of the sequence that did not exist.
 *
 * ─── WHY IT EARNS AN INTERRUPTION ───────────────────────────────────────────────
 * The client was previously asked for at SEND time, and on a device whose account has no
 * roster that is the worst possible moment to discover it: the contractor has written the
 * scope, set the price, answered the flow questions, tapped Send — and only then is told
 * there is nobody to send it to. On the live database right now the phone account owns
 * the job and ZERO approvers, while all 30 roster rows belong to the other account, so
 * this is not a hypothetical. Asking here turns a dead end at the finish line into one
 * tap at the start, and the extra carries its recipient from birth.
 *
 * ─── IT IS SKIPPABLE, AND THAT IS DELIBERATE ────────────────────────────────────
 * Mandate #3: this is a man on a ladder who has just finished talking. A modal he cannot
 * get out of, between the capture and the receipt, is exactly the friction that sends him
 * back to a text message. Skipping costs nothing — the send sheet still asks, as it
 * always has — so this is an EARLY chance to answer, never a new gate.
 *
 * ─── IT NEVER PRE-SELECTS ───────────────────────────────────────────────────────
 * Mandate #2 and the rule `openSendPrep` already follows: a router's suggestion arrives
 * as ordering, never as a decision. Every row here needs a tap. The list is simply the
 * roster, most-recently-used first, because the man who used a client an hour ago is
 * overwhelmingly likely to want them again.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { t } from '../i18n';
import { FlowRail } from './flowrail';
import { Button } from './kit';
import { C, F } from './theme';

export type ClientChoice = { id: string; name: string };

export function ClientPickScreen(props: {
  /** The extra's title, so he knows WHICH one — he may have made three today. */
  scope: string;
  /** Active clients on this job, most recently used first. May be empty. */
  roster: readonly ClientChoice[];
  /** Tapped an existing client. */
  onPick: (c: ClientChoice) => void;
  /** Typed a new one. This screen never writes; the caller owns both saves. */
  onAdd: (name: string, phone: string) => void;
  /** Open the device contact picker and fill the form from it. */
  onPickContact?: () => Promise<{ name: string; phone: string } | null>;
  /** Answer later. The send sheet asks again — see the header. */
  onSkip: () => void;
  busy?: boolean;
}) {
  const [adding, setAdding] = React.useState(props.roster.length === 0);
  const [name, setName] = React.useState('');
  const [phone, setPhone] = React.useState('');

  const canAdd = name.trim().length > 1;

  /**
   * A FULL SCREEN, NOT A SHEET (hadar, 2026-08-27: "During the co create sequence none
   * of these forms can be bottom popups — the sequence have to be the same (forms)").
   *
   * This was the only one of the four steps that arrived as a bottom sheet: record,
   * job and write-up are pages, and this slid up over a greyed-out copy of the last
   * one. A sheet says "a small aside you can flick away"; a page says "the next thing".
   * Halfway through a sequence the wrong one of those is actively misleading — and it
   * made the rail sit on a different-shaped screen each time, which is the opposite of
   * what the rail is for.
   *
   * The X is gone with it. Dismissing a step by flicking it away is a gesture a sheet
   * offers and a page does not; "Do it later" is the same escape, said in words, where
   * every other step keeps its escape.
   */
  return (
    <View style={st.screen}>
      <ScrollView
        contentContainerStyle={st.scroll}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets>
      <View style={{ paddingBottom: 4 }}>
        {/* Third of four. The rail replaced a one-line label here and my edit left it
            wrapped in that label's <Text> — a <View> inside a <Text>, which React
            Native lays out as inline text rather than as a row of bars. */}
        <View style={{ marginBottom: 20 }}><FlowRail step={3} /></View>
        {/* The question was the sheet's header bar; on a page it is the page's title.
            Matched to the job picker's `jpTitle` — same face, same size, same place —
            because "the sequence has to be the same" is the whole point of the move. */}
        <Text style={st.title}>{t('clientpick.title')}</Text>
        <Text style={{ fontFamily: F.bodySemi, fontSize: 15, color: C.ink }} numberOfLines={2}>
          {props.scope}
        </Text>
        <Text style={{ fontFamily: F.body, fontSize: 15, color: C.steel,
          lineHeight: 22, marginTop: 8 }}>
          {t('clientpick.why')}
        </Text>

        {!adding && props.roster.map((r) => (
          <Pressable
            key={r.id}
            onPress={() => props.onPick(r)}
            disabled={!!props.busy}
            style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14,
              borderBottomWidth: 1, borderBottomColor: C.line }}
          >
            <Text style={{ flex: 1, fontFamily: F.bodySemi, fontSize: 16, color: C.ink }}
              numberOfLines={1}>
              {r.name}
            </Text>
            <Text style={{ fontFamily: F.body, fontSize: 20, color: C.steel }}>›</Text>
          </Pressable>
        ))}

        {!adding && (
          <Pressable onPress={() => setAdding(true)} style={{ paddingVertical: 14 }}>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 16, color: C.brand }}>
              {t('clientpick.addNew')}
            </Text>
          </Pressable>
        )}

        {adding && (
          <View style={{ marginTop: 12 }}>
            {props.onPickContact && (
              <Pressable
                onPress={async () => {
                  const c = await props.onPickContact!();
                  if (!c) return;
                  setName(c.name); setPhone(c.phone);
                }}
                style={{ paddingVertical: 12 }}
              >
                <Text style={{ fontFamily: F.bodySemi, fontSize: 16, color: C.brand }}>
                  {t('clientpick.fromContacts')}
                </Text>
              </Pressable>
            )}
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder={t('clientpick.namePh')}
              placeholderTextColor={C.steel}
              style={{ fontFamily: F.body, fontSize: 16, color: C.ink, paddingVertical: 12,
                borderBottomWidth: 1, borderBottomColor: C.line }}
            />
            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder={t('clientpick.phonePh')}
              placeholderTextColor={C.steel}
              keyboardType="phone-pad"
              style={{ fontFamily: F.body, fontSize: 16, color: C.ink, paddingVertical: 12,
                borderBottomWidth: 1, borderBottomColor: C.line }}
            />
            {/* THE PHONE IS OPTIONAL HERE AND SAYS SO. A client with no number cannot be
                texted, and the send sheet will refuse to send to them — but refusing to
                RECORD the name until a number is typed loses the one fact he has while
                he is standing there. Named, not hidden. */}
            <Text style={{ fontFamily: F.body, fontSize: 13, color: C.steel, marginTop: 8 }}>
              {t('clientpick.phoneWhy')}
            </Text>
            {props.roster.length > 0 && (
              <Pressable onPress={() => setAdding(false)} style={{ paddingVertical: 14 }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 15, color: C.steel }}>
                  {t('clientpick.backToList')}
                </Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
      </ScrollView>
      {/* The footer sits ON the page, in the same place step 2 and step 4 put theirs. */}
      <View style={st.foot}>
        {adding
          ? <Button
              label={t('clientpick.save')}
              onPress={() => props.onAdd(name.trim(), phone.trim())}
              disabled={!canAdd || !!props.busy}
            />
          : <Button label={t('clientpick.later')} variant="neutral" onPress={props.onSkip} />}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  // Matched to the job picker's `jpC` so steps 2 and 3 are the same shape of screen.
  screen: { flex: 1, backgroundColor: '#faf7f3', paddingTop: 54 },
  scroll: { paddingHorizontal: 18, paddingBottom: 24 },
  // Step 2's `jpTitle`, verbatim: Inter 29.5/34. Not the theme's Barlow — this whole
  // sequence is drawn in the 2026-08-07 Inter treatment, and matching the theme here
  // would make step 3 the odd screen again for a different reason.
  title: { fontFamily: 'Inter_700Bold', fontSize: 29.5, lineHeight: 34, color: '#131110',
           marginBottom: 14 },
  foot: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 28 },
});
