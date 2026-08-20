/**
 * FIRST RUN — the three screens a contractor sees before the app is his.
 *
 * hadar, 2026-08-19 then again 2026-08-20 with a second, simpler set of mockups:
 * "here are the updated forms". This file follows the SECOND set.
 *
 * ─── WHAT THIS REPLACES ─────────────────────────────────────────────────────────
 * A two-step form living inline in `App.tsx`: language folded into the top of a
 * profile card, then a trade grid. It worked and it looked like a different product —
 * a bright #dafbe1 card on a #2da44e border, left over from an early build. Restyling
 * it fixed the colour and left the SHAPE wrong: one dense card asking for language,
 * name and working-arrangement at once, with no sense of how long it would take.
 *
 * Three screens, each asking ONE thing, each saying where you are. For the person this
 * app exists to serve — someone for whom software is not second nature — a visible,
 * finite path is the difference between filling in a form and being led somewhere.
 *
 * ─── WHAT CHANGED IN THE SECOND PASS, AND WHY IT IS BETTER ──────────────────────
 * The first mockups wrapped each screen's controls in a bordered panel and gave
 * screen 3 a numbered how-it-works list plus two reassurance boxes. The second set
 * strips all of it: no panels, options are full-width rows with an icon and a
 * chevron, and screen 3 is one illustration and one button.
 *
 * That is the right call and worth stating so it is not "improved" back: screen 3 is
 * not a manual. It is the moment someone decides to start. A numbered list there asks
 * them to READ three paragraphs about a thing they have not done yet, and every line
 * is a chance to put the phone down. The illustration says snap-talk-send faster than
 * the words did.
 *
 * ─── THE PROGRESS SPINE IS NUMBERED, NOT DOTS ───────────────────────────────────
 * ①—②—③ with the current one filled. Dots say "there are three of these"; numbers say
 * "you are on the second of three", which is the question actually being asked. The
 * connector lines matter too — they make it one journey rather than three unrelated
 * markers.
 *
 * ─── OLIVE, FROM TOKENS ─────────────────────────────────────────────────────────
 * hadar, 2026-08-20: "if they don't follow the rest of the design, adjust them to fit
 * the template — colour wise". Every accented surface reads `ACCENT`, and it resolves
 * to `C.brand`. It must stay a token: pasting a hex back in is exactly how this screen
 * drifted off-theme the first time.
 *
 * ─── THE ART IS REQUIRED AT BUNDLE TIME, OPTIONAL AT RUNTIME ────────────────────
 * `require` resolves when the bundle is built, so a missing PNG is a build error, not
 * a crash — which is why placeholders exist for any not yet delivered. Each screen
 * still renders if `art` is null: the decorative layer is the most droppable thing in
 * the app, and it must never be why someone cannot finish setup.
 */
import React from 'react';
import {
  Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View,
} from 'react-native';
import { t } from '../i18n';
import { Icon, type IconName } from './icon';
import { C, F } from './theme';

/**
 * The accent for all three screens — olive, from the token, never a hex.
 * See the header: this is the one line that answers "make them match".
 */
const ACCENT = C.brand;
const ACCENT_SOFT = C.brandSoft;

/**
 * Illustrations, resolved once and named for their screen. Dropping a real PNG over
 * one of these filenames is the only step needed to finish the design — no code moves.
 */
export const SETUP_ART = {
  lang: require('../../assets/onboard/obLang.png'),
  setup: require('../../assets/onboard/obSetup.png'),
  capture: require('../../assets/onboard/obCapture.png'),
} as const;

type ArtSource = number | null;

/* ─────────────────────────────── shared chrome ──────────────────────────────── */

/** ①—②—③. See the header for why this is numbers and not dots. */
function Steps({ step }: { step: 0 | 1 | 2 }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      marginTop: 16 }}>
      {[0, 1, 2].map((d) => (
        <React.Fragment key={d}>
          {d > 0 && (
            <View style={{ width: 34, height: 1.5, backgroundColor: C.line }} />
          )}
          <View style={{
            width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center',
            backgroundColor: d === step ? ACCENT : 'transparent',
            borderColor: d === step ? ACCENT : C.line, borderWidth: 1.5,
          }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 16,
              color: d === step ? '#fff' : C.steel }}>
              {d + 1}
            </Text>
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}

function Chrome(props: {
  step: 0 | 1 | 2;
  art: ArtSource;
  title: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.paper }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ paddingTop: 60, paddingHorizontal: 20, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled">
        <Text style={{ fontFamily: F.bodyBold, fontSize: 29, color: C.ink,
          textAlign: 'center', letterSpacing: -0.4 }}>
          EZChangeOrders
        </Text>

        <Steps step={props.step} />

        <Text style={{ fontFamily: F.bodyBold, fontSize: 32, color: C.ink,
          textAlign: 'center', marginTop: 26, letterSpacing: -0.6, lineHeight: 38 }}>
          {props.title}
        </Text>
        <Text style={{ fontFamily: F.body, fontSize: 17, color: C.steel,
          textAlign: 'center', marginTop: 8, lineHeight: 24 }}>
          {props.sub}
        </Text>

        {props.art && (
          <Image source={props.art} resizeMode="contain"
            style={{ width: '100%', height: 240, marginTop: 18 }}
            accessible={false} />
        )}

        {props.children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** The one full-width action at the bottom of every screen. */
function Cta(props: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={props.onPress} disabled={props.disabled}
      accessibilityRole="button" accessibilityState={{ disabled: !!props.disabled }}
      style={{
        marginTop: 26, minHeight: 60, borderRadius: 14, alignItems: 'center',
        justifyContent: 'center', backgroundColor: props.disabled ? C.line : ACCENT,
      }}>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 19, color: '#fff' }}>{props.label}</Text>
    </Pressable>
  );
}

/**
 * A full-width choice: icon, label, chevron. The shape both option screens use.
 *
 * The CHEVRON is doing real work — it says this row is a thing you press, on a screen
 * where the other bordered rectangle is a text field you type into. Without it the two
 * look alike, and the first thing someone does is tap the name box expecting it to go
 * somewhere.
 */
function ChoiceRow(props: {
  icon: IconName;
  label: string;
  selected: boolean;
  onPress: () => void;
  /** Filled-accent when chosen (the language rows) vs a soft icon badge (the work
   *  rows). Two looks because one screen picks a setting and the other picks an
   *  identity — and the language row must be legible to someone who cannot read the
   *  word on it, so it commits the whole row to colour. */
  fill: 'solid' | 'badge';
}) {
  const on = props.selected;
  const solid = props.fill === 'solid' && on;
  return (
    <Pressable onPress={props.onPress}
      accessibilityRole="radio" accessibilityState={{ selected: on }}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 72,
        paddingHorizontal: 16, borderRadius: 14, marginBottom: 12,
        backgroundColor: solid ? ACCENT : C.raised,
        borderColor: solid ? ACCENT : on ? ACCENT : C.line,
        borderWidth: solid ? 1.5 : on ? 2 : 1,
      }}>
      {props.fill === 'badge' ? (
        <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: ACCENT_SOFT,
          alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={props.icon} size={24} color={ACCENT} />
        </View>
      ) : (
        <Icon name={props.icon} size={26} color={solid ? '#fff' : ACCENT} />
      )}
      <Text style={{ fontFamily: F.bodyBold, fontSize: 19, flex: 1,
        color: solid ? '#fff' : C.ink }}>
        {props.label}
      </Text>
      <Icon name="chevRight" size={20} color={solid ? '#fff' : C.steel} />
    </Pressable>
  );
}

/* ──────────────────────────── 1. choose your language ───────────────────────── */

export function StepLanguage(props: {
  lang: 'en' | 'es';
  onLang: (l: 'en' | 'es') => void;
  onContinue: () => void;
  art?: ArtSource;
}) {
  return (
    <Chrome step={0} art={props.art ?? null}
      title={t('su.langTitle')} sub={t('su.langSub')}>
      <View style={{ marginTop: 24 }}>
        {/* Each option in its OWN language. The one control in the whole app that has
            to work for someone who cannot read the other line. */}
        <ChoiceRow icon="globe" label="English" fill="solid"
          selected={props.lang === 'en'} onPress={() => props.onLang('en')} />
        <ChoiceRow icon="globe" label="Español" fill="solid"
          selected={props.lang === 'es'} onPress={() => props.onLang('es')} />
      </View>
      <Cta label={t('fr.continue')} onPress={props.onContinue} />
    </Chrome>
  );
}

/* ─────────────────────────────── 2. how you work ────────────────────────────── */

export function StepProfile(props: {
  name: string;
  onName: (v: string) => void;
  isSolo: boolean | null;
  onSolo: (v: boolean) => void;
  company: string;
  onCompany: (v: string) => void;
  onContinue: () => void;
  art?: ArtSource;
}) {
  // Company NAME stays optional (hadar 2026-07-20): picking Company and leaving the
  // name blank must not block setup. Only the name and the arrangement gate.
  const canGo = props.name.trim().length > 0 && props.isSolo !== null;

  return (
    <Chrome step={1} art={props.art ?? null}
      title={t('su.setupTitle')} sub={t('su.setupSub')}>
      <View style={{ marginTop: 24 }}>
        {/* The icon sits INSIDE the field, as drawn. It is what tells you the box
            wants a person's name before you have read the placeholder — and the
            placeholder disappears the moment you start typing, which is exactly when
            people forget what a field was for. */}
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.raised,
          borderColor: C.line, borderWidth: 1, borderRadius: 14, minHeight: 64,
          paddingHorizontal: 16, marginBottom: 12,
        }}>
          <Icon name="person" size={24} color={ACCENT} />
          {/* Left-aligned, body font. The old form reused the centred money input,
              and a name centred in a box reads as a label rather than something to
              type into. */}
          <TextInput value={props.name} onChangeText={props.onName}
            placeholder={t('fr.yourName')} placeholderTextColor={C.steel}
            autoCapitalize="words" textContentType="name"
            style={{ flex: 1, fontFamily: F.body, fontSize: 18, color: C.ink,
              paddingVertical: 14 }} />
        </View>

        <ChoiceRow icon="person" label={t('fr.solo')} fill="badge"
          selected={props.isSolo === true} onPress={() => props.onSolo(true)} />
        <ChoiceRow icon="people" label={t('fr.company')} fill="badge"
          selected={props.isSolo === false} onPress={() => props.onSolo(false)} />

        {props.isSolo === false && (
          <TextInput value={props.company} onChangeText={props.onCompany}
            placeholder={t('fr.companyName')} placeholderTextColor={C.steel}
            autoCapitalize="words" textContentType="organizationName"
            style={{
              backgroundColor: C.raised, borderColor: C.line, borderWidth: 1,
              borderRadius: 14, minHeight: 64, paddingHorizontal: 16,
              fontFamily: F.body, fontSize: 18, color: C.ink,
            }} />
        )}
      </View>
      <Cta label={t('fr.continue')} disabled={!canGo} onPress={props.onContinue} />
    </Chrome>
  );
}

/* ────────────────────────────── 3. snap. talk. send. ────────────────────────── */

export function StepHowItWorks(props: {
  onCreateFirst: () => void;
  art?: ArtSource;
}) {
  return (
    <Chrome step={2} art={props.art ?? null}
      title={t('su.captureTitle')} sub={t('su.captureSub')}>
      {/* One button, nothing else. See the header: this screen is the moment someone
          decides to start, not a manual. There is no "Maybe later" here because the
          screen this hands off to — `FirstExtra` — already offers one, and two escape
          hatches one tap apart is just a second chance to leave. */}
      <Cta label={t('su.createFirst')} onPress={props.onCreateFirst} />
    </Chrome>
  );
}
