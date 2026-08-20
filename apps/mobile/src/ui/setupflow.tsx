/**
 * FIRST RUN — the three screens a contractor sees before the app is his.
 *
 * hadar, 2026-08-19, with three mockups and a screenshot of what shipped: "this is to
 * replace the onboarding form — the green ones".
 *
 * ─── WHAT THIS REPLACES ─────────────────────────────────────────────────────────
 * A two-step form living inline in `App.tsx`: language folded into the top of a
 * profile card, then a trade grid. It worked and it looked like a different product —
 * a bright #dafbe1 card on a #2da44e border, left over from an early build. Restyling
 * it earlier today fixed the colour and left the SHAPE wrong: one dense card asking
 * for language, name and working-arrangement at once, with no sense of how long it
 * would take.
 *
 * The design splits that into three screens that each ask ONE thing and say where you
 * are ("Step 2 of 3"). For the ICP this file exists to serve — someone for whom
 * software is not second nature — a visible, finite, three-step path is the whole
 * difference between filling in a form and being led somewhere.
 *
 * ─── TRADE IS GONE FROM FIRST RUN, DELIBERATELY ─────────────────────────────────
 * The old step 2 asked for a trade from a ten-cell grid. The design drops it and
 * nothing is lost: `settingsscreen.tsx` already renders the same trade chips
 * (`set.trade`), so it stays collectable at a moment when the answer costs nothing.
 * Asking a stranger to classify his own business before he has seen the app do
 * anything is a question posed at the worst possible time. `saveProfile` still takes
 * `trade` and still receives null here — the field is unchanged, only the moment.
 *
 * ─── ONE ACCENT CONSTANT ────────────────────────────────────────────────────────
 * The mockups are drawn in tan/gold; the app is olive. Every accented surface here
 * reads `ACCENT`, which is why answering "make them match" cost one edit rather than a
 * sweep through the file. It now resolves to `C.brand`, and it must stay a token —
 * pasting a hex back in is how this screen drifted off-theme the first time.
 *
 * ─── THE ART IS OPTIONAL AT RUNTIME ─────────────────────────────────────────────
 * Each screen carries an illustration. `art()` returns null when the asset is not in
 * the bundle, and the layout closes up rather than throwing — a missing PNG must
 * never be the reason a contractor cannot get past setup (mandate #1's spirit: the
 * decorative layer is the most droppable thing in the app).
 */
import React from 'react';
import {
  Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View,
} from 'react-native';
import { t } from '../i18n';
import { Icon, type IconName } from './icon';
import { C, F } from './theme';

/**
 * The accent for all three screens.
 *
 * OLIVE, not the mockups' gold (hadar, 2026-08-20: "if they don't follow the rest of
 * the design, adjust them to fit the template — colour wise"). The layout, spacing and
 * copy follow the mockups exactly; only the hue is pulled back to the app's own brand,
 * because setup that hands off to an olive app in a different colour is the same defect
 * the green card had — a first screen that looks like a different product.
 *
 * Reads the TOKENS rather than the hex behind them, so the next palette change reaches
 * these screens too. That is the whole reason the gold was centralised here.
 */
const ACCENT = C.brand;
const ACCENT_SOFT = C.brandSoft;

/**
 * Illustrations, resolved once. `require` throws at BUNDLE time for a missing file, so
 * these cannot be wrapped in a runtime try/catch — the guard is that the caller may
 * pass `art={null}` and each screen renders without it. Kept in one place so dropping
 * the three PNGs in is the only step needed to complete the design.
 */
export const SETUP_ART = {
  lang: require('../../assets/onboard/obLang.png'),
  setup: require('../../assets/onboard/obSetup.png'),
  capture: require('../../assets/onboard/obCapture.png'),
} as const;

type ArtSource = number | null;

/* ─────────────────────────────── shared chrome ──────────────────────────────── */

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
      <ScrollView contentContainerStyle={{ paddingTop: 64, paddingHorizontal: 20, paddingBottom: 48 }}
        keyboardShouldPersistTaps="handled">
        <Text style={{ fontFamily: F.bodyBold, fontSize: 30, color: C.ink,
          textAlign: 'center', letterSpacing: -0.4 }}>
          EZChangeOrders
        </Text>

        {/* WHERE YOU ARE, twice: dots for the glance, words for the reader. The count
            is the point — "Step 2 of 3" answers "how much more of this is there",
            which is the question a form with no end makes people abandon. */}
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 14 }}>
          {[0, 1, 2].map((d) => (
            <View key={d} style={{
              height: 8, borderRadius: 4, backgroundColor: d === props.step ? C.ink : C.line,
              width: d === props.step ? 26 : 8,
            }} />
          ))}
        </View>
        <Text style={{ fontFamily: F.body, fontSize: 14, color: C.steel,
          textAlign: 'center', marginTop: 10 }}>
          {t({ k: 'su.stepOf', p: { n: String(props.step + 1) } } as any)}
        </Text>

        {props.art && (
          <Image source={props.art} resizeMode="contain"
            style={{ width: '100%', height: 190, marginTop: 14 }}
            accessible={false} />
        )}

        <Text style={{ fontFamily: F.bodyBold, fontSize: 30, color: C.ink,
          textAlign: 'center', marginTop: 18, letterSpacing: -0.5, lineHeight: 36 }}>
          {props.title}
        </Text>
        <Text style={{ fontFamily: F.body, fontSize: 16.5, color: C.steel,
          textAlign: 'center', marginTop: 10, lineHeight: 23 }}>
          {props.sub}
        </Text>

        {props.children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** The one full-width action at the bottom of every screen. */
function Cta(props: { label: string; onPress: () => void; tone: 'ink' | 'accent'; disabled?: boolean }) {
  return (
    <Pressable onPress={props.onPress} disabled={props.disabled}
      accessibilityRole="button" accessibilityState={{ disabled: !!props.disabled }}
      style={{
        marginTop: 20, minHeight: 58, borderRadius: 12, alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: props.disabled ? C.line : props.tone === 'ink' ? C.ink : ACCENT,
      }}>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 18, color: '#fff' }}>{props.label}</Text>
    </Pressable>
  );
}

/** The cream panel the form controls sit on. */
function Panel(props: { children: React.ReactNode }) {
  return (
    <View style={{
      marginTop: 22, backgroundColor: C.card, borderColor: C.line, borderWidth: 1,
      borderRadius: 18, padding: 16,
    }}>
      {props.children}
    </View>
  );
}

function Label(props: { children: string }) {
  return (
    <Text style={{ fontFamily: F.dispSemi, fontSize: 13, color: C.steel,
      textTransform: 'uppercase', letterSpacing: 1.4, marginBottom: 8 }}>
      {props.children}
    </Text>
  );
}

/* ──────────────────────────── 1. choose your language ───────────────────────── */

export function StepLanguage(props: {
  lang: 'en' | 'es';
  onLang: (l: 'en' | 'es') => void;
  onContinue: () => void;
  art?: ArtSource;
}) {
  const chip = (l: 'en' | 'es', label: string) => {
    const on = props.lang === l;
    return (
      <Pressable onPress={() => props.onLang(l)} key={l}
        accessibilityRole="radio" accessibilityState={{ selected: on }}
        style={{
          flex: 1, minHeight: 62, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
          backgroundColor: on ? C.ink : C.raised,
          borderColor: on ? C.ink : C.line, borderWidth: 1,
        }}>
        {/* Each option in its OWN language, so choosing needs no reading — the one
            control on this screen that must work for someone who cannot read the
            other option. */}
        <Text style={{ fontFamily: F.bodyBold, fontSize: 19, color: on ? '#fff' : C.ink }}>
          {label}
        </Text>
      </Pressable>
    );
  };

  return (
    <Chrome step={0} art={props.art ?? null}
      title={t('su.langTitle')} sub={t('su.langSub')}>
      <Panel>
        <Label>{t('su.langLabel')}</Label>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          {chip('en', 'English')}
          {chip('es', 'Español')}
        </View>
        {/* Said out loud because the alternative is someone stalling on a decision
            that is not permanent. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 }}>
          <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: ACCENT_SOFT,
            alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="person" size={17} color={ACCENT} />
          </View>
          <Text style={{ fontFamily: F.body, fontSize: 15, color: C.steel, flex: 1 }}>
            {t('su.changeLater')}
          </Text>
        </View>
      </Panel>
      <Cta label={t('fr.continue')} tone="ink" onPress={props.onContinue} />
    </Chrome>
  );
}

/* ─────────────────────────────── 2. who you are ─────────────────────────────── */

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

  const row = (solo: boolean, icon: IconName, label: string) => {
    const on = props.isSolo === solo;
    return (
      <Pressable onPress={() => props.onSolo(solo)}
        accessibilityRole="radio" accessibilityState={{ selected: on }}
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 66,
          paddingHorizontal: 14, borderRadius: 12, marginBottom: 10,
          backgroundColor: on ? ACCENT_SOFT : C.raised,
          borderColor: on ? C.ink : C.line, borderWidth: on ? 2 : 1,
        }}>
        {/* The picture carries the meaning; the words are its caption. One person, or
            a building — legible to someone who does not read screens. */}
        <Icon name={icon} size={26} color={on ? ACCENT : C.steel} />
        <Text style={{ fontFamily: F.bodyBold, fontSize: 17.5, color: C.ink, flex: 1 }}>
          {label}
        </Text>
        {/* The tick is the confirmation. A border alone is not a state change a
            gloved hand notices in daylight. */}
        {on && (
          <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: ACCENT,
            alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="check" size={16} color="#fff" />
          </View>
        )}
      </Pressable>
    );
  };

  return (
    <Chrome step={1} art={props.art ?? null}
      title={t('su.setupTitle')} sub={t('fr.whoWhy')}>
      <Panel>
        <Label>{t('su.yourNameLabel')}</Label>
        {/* Left-aligned and in the body font: this is prose, not a figure. The old
            form reused the centred money input, and a name centred in a box reads as
            a label rather than something to type into. */}
        <TextInput value={props.name} onChangeText={props.onName}
          placeholder={t('fr.yourName')} placeholderTextColor={C.steel}
          autoCapitalize="words" textContentType="name"
          style={{
            backgroundColor: C.raised, borderColor: C.line, borderWidth: 1, borderRadius: 12,
            minHeight: 58, paddingHorizontal: 14, fontFamily: F.body, fontSize: 17, color: C.ink,
            marginBottom: 18,
          }} />

        <Label>{t('su.howWork')}</Label>
        {row(true, 'person', t('fr.solo'))}
        {row(false, 'ntCompany', t('fr.company'))}

        {props.isSolo === false && (
          <TextInput value={props.company} onChangeText={props.onCompany}
            placeholder={t('fr.companyName')} placeholderTextColor={C.steel}
            autoCapitalize="words" textContentType="organizationName"
            style={{
              backgroundColor: C.raised, borderColor: C.line, borderWidth: 1, borderRadius: 12,
              minHeight: 58, paddingHorizontal: 14, fontFamily: F.body, fontSize: 17, color: C.ink,
            }} />
        )}

        <Cta label={t('fr.continue')} tone="accent" disabled={!canGo} onPress={props.onContinue} />
      </Panel>
    </Chrome>
  );
}

/* ──────────────────────────── 3. what happens next ──────────────────────────── */

const HOW: Array<{ icon: IconName; title: string; body: string }> = [
  { icon: 'camera', title: 'su.h1t', body: 'su.h1b' },
  { icon: 'doc', title: 'su.h2t', body: 'su.h2b' },
  { icon: 'send', title: 'su.h3t', body: 'su.h3b' },
];

const PROMISES: Array<{ icon: IconName; text: string }> = [
  { icon: 'shield', text: 'su.p1' },
  { icon: 'approval', text: 'su.p2' },
];

export function StepHowItWorks(props: {
  onCreateFirst: () => void;
  onLater: () => void;
  art?: ArtSource;
}) {
  return (
    <Chrome step={2} art={props.art ?? null}
      title={t('su.captureTitle')} sub={t('su.captureSub')}>
      <View style={{ marginTop: 20, borderTopColor: C.line, borderTopWidth: 1 }}>
        {HOW.map((h, i) => (
          <View key={h.title} style={{
            flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 16,
            borderBottomColor: C.line, borderBottomWidth: 1,
          }}>
            {/* The NUMBER is the spine of this screen — it says these are ordered
                steps, not a feature list. */}
            <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: ACCENT,
              alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: '#fff' }}>{i + 1}</Text>
            </View>
            <View style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: ACCENT_SOFT,
              alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={h.icon} size={26} color={C.ink} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 19, color: C.ink }}>{t(h.title as any)}</Text>
              <Text style={{ fontFamily: F.body, fontSize: 15.5, color: C.steel,
                lineHeight: 21, marginTop: 2 }}>
                {t(h.body as any)}
              </Text>
            </View>
          </View>
        ))}
      </View>

      {/* The two objections a contractor actually has, answered before he asks:
          will this send something behind my back, and will my client need an app. */}
      <View style={{ marginTop: 16, gap: 10 }}>
        {PROMISES.map((p) => (
          <View key={p.text} style={{
            flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card,
            borderColor: C.line, borderWidth: 1, borderRadius: 12,
            paddingVertical: 14, paddingHorizontal: 14,
          }}>
            <Icon name={p.icon} size={22} color={ACCENT} />
            <Text style={{ fontFamily: F.body, fontSize: 15.5, color: C.ink, flex: 1 }}>
              {t(p.text as any)}
            </Text>
          </View>
        ))}
      </View>

      <Cta label={t('su.createFirst')} tone="accent" onPress={props.onCreateFirst} />
      {/* "Maybe later" is a real exit, not a dark pattern to squint at. Someone who
          opened the app to look around must be able to reach it. */}
      <Pressable onPress={props.onLater} style={{ minHeight: 48, alignItems: 'center',
        justifyContent: 'center', marginTop: 4 }}>
        <Text style={{ fontFamily: F.bodySemi, fontSize: 16.5, color: ACCENT }}>
          {t('su.maybeLater')}
        </Text>
      </Pressable>
    </Chrome>
  );
}
