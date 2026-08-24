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
import { Pressable, Text, TextInput, View } from 'react-native';
import { t } from '../i18n';
import { BottomSheet, Button } from './kit';
import { C, F } from './theme';

export type ClientChoice = { id: string; name: string };

export function ClientPickSheet(props: {
  /** The extra's title, so he knows WHICH one — he may have made three today. */
  scope: string;
  /** Active clients on this job, most recently used first. May be empty. */
  roster: readonly ClientChoice[];
  /** Tapped an existing client. */
  onPick: (c: ClientChoice) => void;
  /** Typed a new one. The sheet never writes; the caller owns both saves. */
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

  return (
    <BottomSheet
      visible
      title={t('clientpick.title')}
      onClose={props.onSkip}
      tall={props.roster.length > 3}
      footer={
        adding
          ? <Button
              label={t('clientpick.save')}
              onPress={() => props.onAdd(name.trim(), phone.trim())}
              disabled={!canAdd || !!props.busy}
            />
          : <Button label={t('clientpick.later')} variant="neutral" onPress={props.onSkip} />
      }
    >
      <View style={{ paddingBottom: 4 }}>
        {/* Third of four — see the note on the job picker's step line. */}
        <Text style={{ fontFamily: F.dispSemi, fontSize: 12, letterSpacing: 1.1,
          color: C.steel, textTransform: 'uppercase', marginBottom: 6 }}>
          {t({ k: 'flow.stepOf', p: { n: '3', of: '4' } } as any)}
        </Text>
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
    </BottomSheet>
  );
}
