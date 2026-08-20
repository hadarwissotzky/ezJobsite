/**
 * FIRST RUN — the three screens a contractor sees before the app is his.
 *
 * hadar, third pass 2026-08-20 ("i have the 3 images"), which is the one this file
 * follows. The earlier two passes are worth one line each because the differences are
 * instructive: pass 1 was tan with bordered panels, pass 2 stripped the panels and
 * gutted screen 3 to a single button, pass 3 puts the artwork on top, gives every
 * option row a subtitle and a check, and brings screen 3's numbered list back with
 * shorter copy.
 *
 * ─── WHAT THIS REPLACES ─────────────────────────────────────────────────────────
 * A two-step form living inline in `App.tsx`: language folded into the top of a
 * profile card, then a trade grid. It worked and looked like a different product — a
 * bright #dafbe1 card on a #2da44e border from an early build. Restyling fixed the
 * colour and left the SHAPE wrong: one dense card asking for language, name and
 * working-arrangement at once, with no sense of how long it would take.
 *
 * ─── THE ARTWORK LEADS ──────────────────────────────────────────────────────────
 * It sits above the progress marker, before any words. That ordering is the design's
 * strongest idea and the reason it suits this audience: the picture says what the
 * screen is about to someone who has not read a line of it yet, and for a reader in
 * their second language it does the work the headline cannot.
 *
 * ─── EVERY CHOICE ROW SAYS WHAT IT MEANS ────────────────────────────────────────
 * "I work solo / Just me" and "I have a company / 2 or more people". The subtitle is
 * not decoration — "company" is a word people hesitate over (am I a company if it is
 * me and my brother?), and "2 or more people" answers that without them having to
 * ask. Same instinct as putting each language in its own language.
 *
 * ─── SELECTION IS A TICK, NOT A BORDER ──────────────────────────────────────────
 * Selected rows fill soft green AND show a filled check; unselected show an empty
 * ring. The ring matters: it advertises that the row is selectable BEFORE anything is
 * chosen. A border-only state is invisible in daylight through a gloved tap, which is
 * the condition this app is designed for.
 *
 * ─── OLIVE, FROM TOKENS ─────────────────────────────────────────────────────────
 * hadar, 2026-08-20: "adjust them to fit the template — colour wise". Every accented
 * surface reads `ACCENT`, resolving to `C.brand`. It must stay a token: pasting a hex
 * back in is exactly how this screen drifted off-theme the first time.
 *
 * ─── THE ART IS REQUIRED AT BUNDLE TIME, OPTIONAL AT RUNTIME ────────────────────
 * `require` resolves when the bundle is built, so a missing PNG is a build error, not
 * a crash — which is why placeholders exist for any not yet delivered. Each screen
 * still renders if `art` is null: the decorative layer is the most droppable thing in
 * the app and must never be why someone cannot finish setup.
 */
import React from 'react';
import {
  Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View,
} from 'react-native';
import { t } from '../i18n';
import { Icon, type IconName } from './icon';
import { C, F } from './theme';

/** Olive, from the token, never a hex. See the header. */
const ACCENT = C.brand;
const ACCENT_SOFT = C.brandSoft;

/**
 * Illustrations, named for their screen. Dropping a real PNG over one of these
 * filenames is the only step needed to finish the design — no code moves.
 */
export const SETUP_ART = {
  lang: require('../../assets/onboard/obLang.png'),
  setup: require('../../assets/onboard/obSetup.png'),
  capture: require('../../assets/onboard/obCapture.png'),
} as const;

type ArtSource = number | null;

/* ─────────────────────────────── shared chrome ──────────────────────────────── */

/**
 * ●●○ plus "Step 2 of 3", on one line.
 *
 * The dots FILL CUMULATIVELY rather than marking only the current one: three lit dots
 * on the last screen reads as progress completed, which is the feeling that screen is
 * for. The words carry the precision; the dots carry the glance.
 */
function Steps({ step }: { step: 0 | 1 | 2 }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      gap: 8, marginTop: 22 }}>
      {[0, 1, 2].map((d) => (
        <View key={d} style={{
          width: 9, height: 9, borderRadius: 5,
          backgroundColor: d <= step ? ACCENT : C.line,
        }} />
      ))}
      <Text style={{ fontFamily: F.body, fontSize: 15, color: C.steel, marginLeft: 6 }}>
        {t({ k: 'su.stepOf', p: { n: String(step + 1) } } as any)}
      </Text>
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
      {/* paddingTop 64 clears the notch. There is no `react-native-safe-area-context`
          in this project, so every top-level screen carries its inset by hand — see
          `s.c` in App.tsx, which uses 72 for a screen whose first element is text.
          This one leads with a small brand line, so it sits marginally tighter. */}
      <ScrollView contentContainerStyle={{ paddingTop: 64, paddingHorizontal: 20, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled">
        {/*
          THE HEADER BLOCK — brand, step, headline, rule — with the cutout bleeding
          off the right edge behind it (hadar, fourth pass: "here are the cutouts").

          WHY THIS BEATS THE BOXED VERSION, and it is not only taste: a framed image
          across the top is a band the eye must cross before reaching anything it can
          act on, which is what "the image is huge!! too big" was really about.
          Layered to the right, the same artwork costs almost no vertical space — the
          headline, the options and the button all sit above the fold on a 13 mini. It
          decorates the screen instead of gating it.

          THE BLEED IS DELIBERATE: `right: -20` cancels the screen's own padding so the
          cutout runs to the physical edge. A cutout that stops short with a margin
          reads as a mistake rather than a composition.

          TEXT IS WIDTH-CAPPED, NOT POSITIONED. The headline and subtitle carry
          `maxWidth` instead of being pushed around, so on a narrow phone they wrap
          away from the art rather than colliding with it.
        */}
        <View style={{ position: 'relative' }}>
          {/* The wrapper carries `pointerEvents="none"`, not the Image — RN does not
              accept that prop on Image. It matters either way: this sits ABOVE the
              layout in z-order and must never swallow a tap meant for a control
              beneath it. */}
          {props.art && (
            <View pointerEvents="none"
              style={{ position: 'absolute', right: -20, top: 30, width: '66%', height: 252 }}>
              <Image source={props.art} resizeMode="contain"
                style={{ width: '100%', height: '100%' }} accessible={false} />
            </View>
          )}

          <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: ACCENT,
            letterSpacing: -0.2 }}>
            EZChangeOrders
          </Text>

          <Steps step={props.step} />

          {/* CONDENSED, UPPERCASE, LEFT. `textTransform` rather than shouting in the
              string itself: the Spanish copy has to uppercase correctly too, and a
              string stored in caps is one a translator cannot case properly. */}
          <Text style={{ fontFamily: F.disp, fontSize: 42, color: C.ink,
            textTransform: 'uppercase', lineHeight: 44, letterSpacing: -0.5,
            marginTop: 14, maxWidth: '62%' }}>
            {props.title}
          </Text>

          {/* The short rule under the headline — the one flourish on the screen. */}
          <View style={{ width: 46, height: 4, borderRadius: 2, backgroundColor: ACCENT,
            marginTop: 16 }} />

          <Text style={{ fontFamily: F.body, fontSize: 15.5, color: C.steel,
            lineHeight: 21, marginTop: 14, maxWidth: '52%' }}>
            {props.sub}
          </Text>

          {/* Reserves the height the absolutely-positioned art needs, so the controls
              below start beneath it rather than under it. Without this the cutout
              overlaps the first option row, which is a tap target. */}
          <View style={{ height: 86 }} />
        </View>

        {props.children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** The one full-width action at the bottom of every screen. */
function Cta(props: {
  label: string; onPress: () => void; disabled?: boolean;
  /** Screen 1's button is ink; the other two are brand. Straight from the mockups. */
  tone: 'ink' | 'accent';
}) {
  const bg = props.disabled ? C.line : props.tone === 'ink' ? C.ink : ACCENT;
  return (
    <Pressable onPress={props.onPress} disabled={props.disabled}
      accessibilityRole="button" accessibilityState={{ disabled: !!props.disabled }}
      style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
        marginTop: 26, minHeight: 60, borderRadius: 14, backgroundColor: bg,
      }}>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 19, color: '#fff' }}>{props.label}</Text>
      <Icon name="arrowRight" size={20} color="#fff" />
    </Pressable>
  );
}

/** The tick on the right of a choice row — filled when chosen, an empty ring when not. */
function Tick({ on }: { on: boolean }) {
  return on ? (
    <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: ACCENT,
      alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="check" size={15} color="#fff" />
    </View>
  ) : (
    <View style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 1.5,
      borderColor: C.line }} />
  );
}

/**
 * A full-width choice: icon badge, label (+ optional subtitle), tick.
 *
 * The subtitle is load-bearing on the work screen — see the header. It is optional
 * because the language rows do not need one: "Español" explains itself.
 */
function ChoiceRow(props: {
  icon: IconName;
  label: string;
  sub?: string;
  selected: boolean;
  onPress: () => void;
}) {
  const on = props.selected;
  return (
    <Pressable onPress={props.onPress}
      accessibilityRole="radio" accessibilityState={{ selected: on }}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 76,
        paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, marginBottom: 12,
        backgroundColor: on ? ACCENT_SOFT : C.raised,
        borderColor: on ? ACCENT : C.line, borderWidth: on ? 1.5 : 1,
      }}>
      <View style={{ width: 46, height: 46, borderRadius: 23,
        backgroundColor: on ? C.raised : ACCENT_SOFT,
        alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={props.icon} size={24} color={ACCENT} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: F.bodyBold, fontSize: 18, color: C.ink }}>{props.label}</Text>
        {!!props.sub && (
          <Text style={{ fontFamily: F.body, fontSize: 14.5, color: C.steel, marginTop: 2 }}>
            {props.sub}
          </Text>
        )}
      </View>
      <Tick on={on} />
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
      <View style={{ marginTop: 22 }}>
        {/* Each option in its OWN language. The one control in the app that has to
            work for someone who cannot read the other line. */}
        <ChoiceRow icon="globe" label="English"
          selected={props.lang === 'en'} onPress={() => props.onLang('en')} />
        <ChoiceRow icon="globe" label="Español"
          selected={props.lang === 'es'} onPress={() => props.onLang('es')} />
      </View>
      <Cta label={t('fr.continue')} tone="ink" onPress={props.onContinue} />
    </Chrome>
  );
}

/* ────────────────────────────── 2. tell us about you ────────────────────────── */

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
      <View style={{ marginTop: 20 }}>
        {/* A QUESTION, not a field label. "What should we call you?" is answerable;
            "Your name" is a form. The difference is the whole tone of this screen. */}
        <Text style={{ fontFamily: F.bodyBold, fontSize: 16.5, color: C.ink,
          marginBottom: 8 }}>
          {t('su.nameLabel')}
        </Text>
        {/* The icon sits INSIDE the field, as drawn. It still says what the box wants
            after the placeholder disappears — which is exactly when people forget. */}
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.raised,
          borderColor: C.line, borderWidth: 1, borderRadius: 14, minHeight: 62,
          paddingHorizontal: 14, marginBottom: 14,
        }}>
          <Icon name="person" size={22} color={C.steel} />
          {/* Left-aligned, body font. The old form reused the centred money input,
              and a name centred in a box reads as a label rather than a thing to
              type into. */}
          <TextInput value={props.name} onChangeText={props.onName}
            placeholder={t('fr.yourName')} placeholderTextColor={C.steel}
            autoCapitalize="words" textContentType="name"
            style={{ flex: 1, fontFamily: F.body, fontSize: 18, color: C.ink,
              paddingVertical: 13 }} />
        </View>

        <ChoiceRow icon="person" label={t('fr.solo')} sub={t('su.soloSub')}
          selected={props.isSolo === true} onPress={() => props.onSolo(true)} />
        <ChoiceRow icon="people" label={t('fr.company')} sub={t('su.companySub')}
          selected={props.isSolo === false} onPress={() => props.onSolo(false)} />

        {props.isSolo === false && (
          <TextInput value={props.company} onChangeText={props.onCompany}
            placeholder={t('fr.companyName')} placeholderTextColor={C.steel}
            autoCapitalize="words" textContentType="organizationName"
            style={{
              backgroundColor: C.raised, borderColor: C.line, borderWidth: 1,
              borderRadius: 14, minHeight: 62, paddingHorizontal: 14,
              fontFamily: F.body, fontSize: 18, color: C.ink,
            }} />
        )}
      </View>
      <Cta label={t('fr.continue')} tone="accent" disabled={!canGo} onPress={props.onContinue} />
    </Chrome>
  );
}

/* ───────────────────────────────── 3. you're all set ────────────────────────── */

const HOW: Array<{ icon: IconName; title: string; body: string }> = [
  { icon: 'microphone', title: 'su.h1t', body: 'su.h1b' },
  { icon: 'checklist', title: 'su.h2t', body: 'su.h2b' },
  { icon: 'send', title: 'su.h3t', body: 'su.h3b' },
];

export function StepHowItWorks(props: {
  onCreateFirst: () => void;
  art?: ArtSource;
}) {
  return (
    <Chrome step={2} art={props.art ?? null}
      title={t('su.captureTitle')} sub={t('su.captureSub')}>
      <View style={{ marginTop: 18 }}>
        {HOW.map((h, i) => (
          <View key={h.title} style={{
            flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14,
            borderBottomColor: C.line, borderBottomWidth: i === HOW.length - 1 ? 0 : 1,
          }}>
            <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: ACCENT,
              alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={h.icon} size={23} color="#fff" />
            </View>
            {/* The NUMBER is separate from the icon on purpose: the icon says WHAT the
                step is, the number says it is the second of three. One glyph doing
                both jobs does neither well. */}
            <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: C.surfaceMuted,
              alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: C.steel }}>{i + 1}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 18, color: C.ink }}>
                {t(h.title as any)}
              </Text>
              <Text style={{ fontFamily: F.body, fontSize: 15, color: C.steel,
                lineHeight: 20, marginTop: 1 }}>
                {t(h.body as any)}
              </Text>
            </View>
          </View>
        ))}
      </View>
      {/* No "Maybe later" — `FirstExtra`, which this hands off to, already offers one,
          and two escape hatches a tap apart is a second chance to leave. */}
      <Cta label={t('su.createFirst')} tone="accent" onPress={props.onCreateFirst} />
    </Chrome>
  );
}
