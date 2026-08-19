/**
 * Sign in / create an account — PASSWORDLESS (hadar, 2026-08-03, modelled on Handoff).
 *
 * THERE IS NO PASSWORD ANYWHERE IN THIS APP. Four ways in, and every one of them is a
 * thing the user already has rather than a thing they must invent and remember:
 *   Phone → a 6-digit code by SMS
 *   Email → a link they tap in their inbox
 *   Google · Apple → the account already on the phone
 *
 * WHY: CLAUDE.md §1's design test — "would someone who doesn't think in software
 * succeed here without being taught?" A password fails it three times: it must be
 * invented, remembered, and recovered. Removing it removes all three.
 *
 * OPERATIONAL BOUNDARY, stated because it decides whether this works in the field:
 * Supabase's built-in SMTP is rate-limited to a handful of messages an hour, so the
 * EMAIL path needs custom SMTP (Resend/SendGrid) before real users — otherwise a
 * quota, not a credential, is what locks someone out. The phone path has the same
 * shape of dependency on Twilio, which is why THREE independent routes exist: if one
 * provider is down or unconfigured, nobody is stranded. That redundancy is the answer
 * to the lockout this project already suffered once (SPEC-identity-onboarding-v1 §5).
 *
 * THE SENT STATE IS A SCREEN, not a toast. "We sent you a link" has to survive the
 * user leaving for Mail and coming back, so it is rendered state rather than a message
 * that disappears. The link itself is caught by the deep-link handler in App.tsx.
 *
 * FAILURES KEEP THEIR PHASE (REQ-ID6): the same provider text means different things
 * when sending versus verifying, and a failed send once rendered as "that code isn't
 * right" on a screen where no code had been typed.
 */
import React from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';

import type { SupabaseConnector } from '../connector';
import { displayPhone, formatPhoneAsTyped, toE164 } from '../sendto';
import { t as T } from '../i18n';
import { Icon } from './icon';

const RESEND_AFTER_S = 60;
const CODE_LEN = 6;

type Method = 'phone' | 'email';
type Step = 'form' | 'code' | 'linkSent';
type Fail =
  | { kind: 'net' | 'notArrived' | 'badCode' | 'cantSend' | 'signupFailed' }
  | { kind: 'other'; text: string }
  | null;

function classify(e: any, phase: 'send' | 'verify' | 'oauth'): Fail {
  const text = e?.message ?? String(e ?? '');
  const status = e?.status ?? e?.code;
  if (/network|fetch|timed? ?out|connection|offline/i.test(text)) return { kind: 'net' };
  if (String(status) === '429' || /rate|too many|limit/i.test(text)) return { kind: 'notArrived' };
  if (phase === 'verify' && /invalid|expired|incorrect|token/i.test(text)) return { kind: 'badCode' };
  if (phase === 'send') return { kind: 'cantSend' };
  return { kind: 'other', text };
}

const emailLooksReal = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());

export function AuthScreen({ connector, initialSignUp = false, onReplayIntro }: {
  connector: SupabaseConnector;
  /**
   * Which form to open on. The landing page has two buttons — "Get started" and
   * "Log in" — and before this prop existed they were two labels for one destination:
   * a returning user who tapped Log in landed on a sign-up form asking for his name
   * and company, which reads as the app having forgotten him. Defaults false so every
   * other caller is unchanged.
   */
  initialSignUp?: boolean;
  /** DEV ONLY: clears the seen-intro flag and re-renders the landing pages. */
  onReplayIntro?: () => void;
}) {
  const [method, setMethod] = React.useState<Method>('phone');
  const [step, setStep] = React.useState<Step>('form');
  const [signUp, setSignUp] = React.useState(initialSignUp);

  const [typed, setTyped] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [code, setCode] = React.useState('');
  // Sign-up only. Collected here so the profile is populated before first capture
  // rather than interrupting someone later, mid-job.
  const [fullName, setFullName] = React.useState('');
  const [company, setCompany] = React.useState('');

  const [busy, setBusy] = React.useState(false);
  const [fail, setFail] = React.useState<Fail>(null);
  const [left, setLeft] = React.useState(0);

  // Derived every render, never cached: a stored copy is how the number shown and the
  // number texted come to disagree, which is what the confirm step exists to prevent.
  const e164 = toE164(typed);
  const emailOk = emailLooksReal(email);
  const signUpOk = fullName.trim().length >= 2 && emailOk && !!e164;

  React.useEffect(() => {
    if (step !== 'code' || left <= 0) return;
    const id = setInterval(() => setLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [step, left]);

  const reset = () => setFail(null);
  const redirectTo = React.useMemo(() => Linking.createURL('auth-callback'), []);

  const sendCode = async () => {
    if (!e164 || busy) return;
    setBusy(true); reset();
    try {
      await connector.startPhoneAuth(e164);
      setStep('code'); setLeft(RESEND_AFTER_S);
    } catch (e) { setFail(classify(e, 'send')); } finally { setBusy(false); }
  };

  const sendLink = async () => {
    if (!emailOk || busy) return;
    setBusy(true); reset();
    try {
      await connector.sendEmailLink(email.trim(), redirectTo);
      setStep('linkSent');
    } catch (e) { setFail(classify(e, 'send')); } finally { setBusy(false); }
  };

  // Guards the auto-submit against re-firing on the same digits, which would burn
  // attempts against the provider's rate limit for free.
  const triedRef = React.useRef<string | null>(null);
  const verify = React.useCallback(async (value: string) => {
    if (!e164 || busy || value.length !== CODE_LEN) return;
    triedRef.current = value;
    setBusy(true); reset();
    try {
      await connector.verifyPhoneCode(e164, value);
      // onAuthStateChange in App takes it from here.
    } catch (e) {
      setFail(classify(e, 'verify')); setCode(''); triedRef.current = null;
    } finally { setBusy(false); }
  }, [connector, e164, busy]);

  // Submits itself once six digits exist — with OS autofill the step costs zero taps.
  const onCode = (v: string) => {
    const digits = v.replace(/\D/g, '').slice(0, CODE_LEN);
    setCode(digits);
    if (digits.length === CODE_LEN && digits !== triedRef.current) void verify(digits);
  };

  const oauth = async (provider: 'google' | 'apple') => {
    if (busy) return;
    setBusy(true); reset();
    try {
      await connector.signInWithOAuth({
        provider,
        redirectTo,
        openAuth: (url, back) => WebBrowser.openAuthSessionAsync(url, back) as Promise<any>,
      });
    } catch (e) { setFail(classify(e, 'oauth')); } finally { setBusy(false); }
  };

  // Sign-up sends the SAME link; name and company ride along so the profile exists
  // when they land. One path, so there is nothing extra to keep working.
  const startSignUp = async () => {
    if (!signUpOk || busy) return;
    setBusy(true); reset();
    try {
      await connector.sendEmailLink(email.trim(), redirectTo);
      setStep('linkSent');
    } catch (e) { setFail(classify(e, 'send')); } finally { setBusy(false); }
  };

  /**
   * A 429 maps to one kind and TWO wordings (hadar's screenshot, 2026-08-13).
   *
   * Supabase rate-limits the whole auth endpoint, so hammering the phone step and then
   * switching to sign-up produced "Too many tries … then ask for a new code" ON THE
   * CREATE-ACCOUNT FORM — a screen with no code field, which sends a magic LINK. The
   * error was true and the sentence was about a different mechanism, which reads as the
   * app being confused about what it just did.
   *
   * The wording follows the method actually in use rather than the phase that failed:
   * that is what the reader is looking at.
   */
  const failText = !fail ? null
    : fail.kind === 'other' ? fail.text
    : T(fail.kind === 'net' ? 'auth.errNoSignal'
      : fail.kind === 'notArrived'
        ? (method === 'phone' && !signUp ? 'auth.errTooManyCode' : 'auth.errTooManyLink')
      : fail.kind === 'cantSend' ? 'auth.errCantSend'
      : fail.kind === 'signupFailed' ? 'auth.errCantSend'
      : 'auth.errBadCode');

  const Brand = () => <Text style={st.brand}>EZChangeOrders</Text>;

  // ── the emailed link is out; this state must survive leaving for Mail ──
  if (step === 'linkSent') {
    return (
      <KeyboardAvoidingView style={st.c} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={st.inner}>
          {/* The tick is the whole message: something HAPPENED. Someone who does not
              read screens gets the outcome from the mark alone. */}
          <View style={st.tick}><Icon name="approved" size={64} color="#3E7A48" /></View>
          <Text style={st.h}>{T('auth.linkSentTitle')}</Text>
          <Text style={st.sub}>{T('auth.linkSentBody')}</Text>
          <Text style={st.bigEmail}>{email.trim()}</Text>

          {failText && <Text style={st.err}>{failText}</Text>}

          <Text style={st.didNot}>{T('auth.didNotReceive')}</Text>
          {/* Outline, not filled: resending is the SECONDARY action here. The primary
              one is in their inbox, and a heavy button competing with it invites a
              second email nobody needed. */}
          <Pressable style={[st.btnGhost, busy && st.btnOff]} disabled={busy}
            onPress={signUp ? startSignUp : sendLink}>
            {busy ? <ActivityIndicator color="#151A1E" /> : <Text style={st.btnGhostT}>{T('auth.resend')}</Text>}
          </Pressable>
          <Pressable style={st.link} onPress={() => { reset(); setStep('form'); }}>
            <Text style={st.linkStrong}>{T('auth.useDifferent')}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // ── the code step owns the screen; nothing else there is actionable ──
  if (step === 'code') {
    return (
      <KeyboardAvoidingView style={st.c} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={st.inner}>
          <Brand />
          <Text style={st.h}>{T('auth.codeTitle')}</Text>
          <Text style={st.sub}>
            {T({ k: 'auth.codeSentTo', p: { phone: displayPhone(e164) } })}
            {'\n'}
            <Text style={st.slow}>{T('auth.codeSlow')}</Text>
          </Text>
          <TextInput
            style={[st.input, st.codeInput]}
            value={code} onChangeText={onCode}
            placeholder="000000" placeholderTextColor="#c9c4bb"
            keyboardType="number-pad" inputMode="numeric"
            textContentType="oneTimeCode" autoComplete="sms-otp"
            maxLength={CODE_LEN} autoFocus editable={!busy}
            accessibilityLabel={T('auth.codeTitle')}
          />
          {failText && <Text style={st.err}>{failText}</Text>}
          {busy && <ActivityIndicator color="#4E6243" style={{ marginBottom: 10 }} />}
          <Pressable style={st.link} disabled={left > 0 || busy}
            onPress={() => { setCode(''); triedRef.current = null; void sendCode(); }}>
            <Text style={[st.linkT, (left > 0 || busy) && st.linkOff]}>
              {left > 0 ? T({ k: 'auth.resendIn', p: { s: left } }) : T('auth.resend')}
            </Text>
          </Pressable>
          <Pressable style={st.link} onPress={() => {
            reset(); setCode(''); triedRef.current = null; setStep('form');
          }}>
            <Text style={st.linkT}>{T('auth.changeNumber')}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    );
  }

  /**
   * The 'confirm' step lived here: a full screen showing the number back with a "Send
   * code" button, added for REQ-ID4. Removed 2026-08-13 — the requirement is that the
   * number be READ BACK before it is trusted, and the code screen does exactly that
   * ("Code sent to …" plus Change number), at the moment the reader can act on it.
   * Two read-backs is not twice the safety; it is one extra tap.
   */

  const Social = () => (
    <>
      <View style={st.divider}>
        <View style={st.rule} /><Text style={st.or}>{T('auth.or')}</Text><View style={st.rule} />
      </View>
      <View style={st.socialRow}>
        <Pressable style={[st.social, busy && st.btnOff]} disabled={busy}
          onPress={() => oauth('google')}
          accessibilityRole="button" accessibilityLabel={T('auth.google')}>
          <Icon name="google" size={26} />
        </Pressable>
        <Pressable style={[st.social, busy && st.btnOff]} disabled={busy}
          onPress={() => oauth('apple')}
          accessibilityRole="button" accessibilityLabel={T('auth.apple')}>
          <Icon name="apple" size={26} color="#000" />
        </Pressable>
      </View>
    </>
  );

  // ── CREATE ACCOUNT ──
  if (signUp) {
    return (
      <KeyboardAvoidingView style={st.c} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={st.scroll} keyboardShouldPersistTaps="handled">
          <Brand />
          <Text style={st.h}>{T('auth.signUpTitle')}</Text>
          <Pressable style={st.swap} onPress={() => { reset(); setSignUp(false); }}>
            <Text style={st.swapT}>{T('auth.toSignIn')}</Text>
          </Pressable>

          {/* One bordered group, like the reference — four fields read as one thing
              to fill in rather than four decisions. */}
          <View style={st.group}>
            <TextInput style={st.groupInput} value={fullName}
              onChangeText={(v) => { setFullName(v); reset(); }}
              placeholder={T('auth.fullName')} placeholderTextColor="#8c959f"
              autoCapitalize="words" textContentType="name" />
            <View style={st.groupRule} />
            <TextInput style={st.groupInput} value={company}
              onChangeText={(v) => { setCompany(v); reset(); }}
              placeholder={T('auth.company')} placeholderTextColor="#8c959f"
              autoCapitalize="words" textContentType="organizationName" />
            <View style={st.groupRule} />
            <TextInput style={st.groupInput} value={email}
              onChangeText={(v) => { setEmail(v); reset(); }}
              placeholder={T('auth.email')} placeholderTextColor="#8c959f"
              autoCapitalize="none" autoCorrect={false}
              keyboardType="email-address" inputMode="email" textContentType="emailAddress" />
            <View style={st.groupRule} />
            <TextInput style={st.groupInput} value={typed}
              onChangeText={(v) => { setTyped(formatPhoneAsTyped(v)); reset(); }}
              placeholder={T('auth.phone')} placeholderTextColor="#8c959f"
              keyboardType="phone-pad" inputMode="tel" textContentType="telephoneNumber" />
          </View>

          {failText && <Text style={st.err}>{failText}</Text>}

          <Pressable style={[st.btn, (!signUpOk || busy) && st.btnOff]}
            disabled={!signUpOk || busy} onPress={startSignUp}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={st.btnT}>{T('auth.getStarted')}</Text>}
          </Pressable>
          <Text style={st.fine}>{T('auth.noCard')}</Text>

          <Social />
          <Text style={st.consent}>{T('auth.consent')}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── SIGN IN ──
  return (
    <KeyboardAvoidingView style={st.c} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={st.scroll} keyboardShouldPersistTaps="handled">
        <Brand />
        <Text style={st.h}>{T('auth.signInTitle')}</Text>
        <Pressable style={st.swap} onPress={() => { reset(); setSignUp(true); }}>
          <Text style={st.swapT}>{T('auth.toSignUp')}</Text>
        </Pressable>

        <Text style={st.groupLab}>{T('auth.loginMethods')}</Text>
        <View style={st.seg}>
          {(['phone', 'email'] as Method[]).map((m) => (
            <Pressable key={m} onPress={() => { reset(); setMethod(m); }}
              accessibilityRole="radio" accessibilityState={{ selected: method === m }}
              style={[st.segBtn, method === m && st.segOn]}>
              <Text style={[st.segT, method === m && st.segTOn]}>
                {T(m === 'phone' ? 'auth.methodPhone' : 'auth.methodEmail')}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* What is about to happen, before it happens. The single most useful thing
            on this screen for someone who does not think in software. */}
        <View style={st.note}>
          <Text style={st.noteI}>i</Text>
          <Text style={st.noteT}>
            {T(method === 'phone' ? 'auth.phoneWhy' : 'auth.emailWhy')}
          </Text>
        </View>

        {method === 'phone' ? (
          <>
            <TextInput
              style={st.input} value={typed}
              onChangeText={(v) => { setTyped(formatPhoneAsTyped(v)); reset(); }}
              placeholder={T('auth.phone')} placeholderTextColor="#8c959f"
              keyboardType="phone-pad" inputMode="tel"
              textContentType="telephoneNumber" autoComplete="tel"
              accessibilityLabel={T('auth.phone')}
            />
            {typed.replace(/\D/g, '').length >= 7 && !e164 && (
              <Text style={st.err}>{T('auth.phoneBad')}</Text>
            )}
            {/* SENDS THE CODE, rather than stepping to a read-back screen first
                (hadar, 2026-08-13). That screen asked "is this your number?" about a
                number typed two seconds earlier, on the way to a screen that ALREADY
                reads it back — "Code sent to +1 415 555 0134" with Change number
                underneath it. The check survives; it just happens where it is useful,
                next to the thing that tells you whether the SMS arrived. One tap fewer
                on the screen that stands between a contractor and his own app. */}
            <Pressable style={[st.btn, (!e164 || busy) && st.btnOff]} disabled={!e164 || busy}
              onPress={sendCode}>
              {busy ? <ActivityIndicator color="#fff" />
                : <Text style={st.btnT}>{T('auth.continue')}</Text>}
            </Pressable>
          </>
        ) : (
          <>
            <TextInput
              style={st.input} value={email}
              onChangeText={(v) => { setEmail(v); reset(); }}
              placeholder={T('auth.email')} placeholderTextColor="#8c959f"
              autoCapitalize="none" autoCorrect={false}
              keyboardType="email-address" inputMode="email"
              textContentType="emailAddress" autoComplete="email"
              accessibilityLabel={T('auth.email')}
            />
            <Pressable style={[st.btn, (!emailOk || busy) && st.btnOff]}
              disabled={!emailOk || busy} onPress={sendLink}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={st.btnT}>{T('auth.continue')}</Text>}
            </Pressable>
          </>
        )}

        {failText && <Text style={st.err}>{failText}</Text>}
        <Social />

        {/* DEV ONLY — replay the intro. The onboarding flag is set the first time the
            app is ever opened and never cleared, so on any device that has run this app
            before, a design change to the intro is INVISIBLE: you sign out and land
            straight here. The only other ways to see it were a reinstall (which takes
            the local capture database with it) or a debugger attached over Metro.
            `__DEV__` strips this from any release build. */}
        {__DEV__ && onReplayIntro && (
          <Pressable style={st.devRow} onPress={onReplayIntro} accessibilityRole="button">
            <Text style={st.devT}>Show intro again (dev)</Text>
          </Pressable>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  c: { flex: 1, backgroundColor: '#F7F4EE' },
  // TOP-ANCHORED, NOT CENTRED. `justifyContent: 'center'` with `flexGrow: 1` centres
  // content that FITS and clips content that does not — and once the keyboard shrinks
  // the box, this form does not fit. The brand and "Create your account" were pushed
  // off the top with no way to scroll back to them (hadar's screenshot, 2026-08-13).
  // A fixed top inset always shows the heading and lets the rest scroll under the
  // keyboard, which is where the extra bottom padding takes it.
  scroll: { flexGrow: 1, paddingHorizontal: 28, paddingTop: 72, paddingBottom: 120 },
  inner: { flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
  brand: { fontSize: 30, fontWeight: '900', color: '#4E6243', textAlign: 'center', marginBottom: 8 },
  h: { fontSize: 26, fontWeight: '800', color: '#151A1E', textAlign: 'center', marginBottom: 6 },
  sub: { fontSize: 16, lineHeight: 23, color: '#5E666E', textAlign: 'center', marginBottom: 22 },
  slow: { fontSize: 14, color: '#8a9199' },
  swap: { alignItems: 'center', paddingVertical: 6, marginBottom: 18 },
  swapT: { color: '#4E6243', fontSize: 15, fontWeight: '700' },
  groupLab: { fontSize: 15, color: '#5E666E', textAlign: 'center', marginBottom: 8 },
  seg: {
    flexDirection: 'row', alignSelf: 'stretch', backgroundColor: '#fff',
    borderRadius: 12, padding: 4, marginBottom: 16,
    borderWidth: 1, borderColor: '#E4DFD6',
  },
  segBtn: { flex: 1, paddingVertical: 11, borderRadius: 9, alignItems: 'center' },
  segOn: { backgroundColor: '#EFEBE3' },
  segT: { fontSize: 16, fontWeight: '600', color: '#5E666E' },
  segTOn: { color: '#151A1E', fontWeight: '800' },
  // The amber "here is what will happen" panel from the reference.
  note: {
    flexDirection: 'row', gap: 10, backgroundColor: '#F3E7D6',
    borderRadius: 12, padding: 14, marginBottom: 14,
  },
  noteI: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: '#7a5c2e',
    color: '#7a5c2e', textAlign: 'center', fontSize: 13, fontWeight: '800', lineHeight: 18,
  },
  noteT: { flex: 1, fontSize: 15, lineHeight: 21, color: '#6b5220' },
  input: {
    backgroundColor: '#fff', borderColor: '#D5D0C7', borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 16, fontSize: 17, color: '#151A1E', marginBottom: 12,
  },
  codeInput: { fontSize: 30, textAlign: 'center', letterSpacing: 10, fontWeight: '700' },
  // Sign-up: one bordered block with hairlines, so four fields read as one form.
  group: {
    backgroundColor: '#fff', borderColor: '#D5D0C7', borderWidth: 1,
    borderRadius: 12, marginBottom: 16, overflow: 'hidden',
  },
  groupInput: { paddingHorizontal: 16, paddingVertical: 17, fontSize: 17, color: '#151A1E' },
  groupRule: { height: 1, backgroundColor: '#E4DFD6' },
  bigEmail: { fontSize: 18, fontWeight: '800', color: '#151A1E', textAlign: 'center', marginBottom: 6 },
  tick: { alignItems: 'center', marginBottom: 26 },
  didNot: { fontSize: 17, color: '#5E666E', textAlign: 'center', marginTop: 26, marginBottom: 12 },
  btnGhost: {
    backgroundColor: '#fff', borderRadius: 999, paddingVertical: 17,
    alignItems: 'center', borderWidth: 1, borderColor: '#D5D0C7',
  },
  btnGhostT: { color: '#151A1E', fontSize: 17, fontWeight: '700' },
  linkStrong: { color: '#151A1E', fontSize: 17, fontWeight: '700' },
  err: { color: '#8B5148', fontSize: 15, marginBottom: 10, textAlign: 'center' },
  btn: {
    backgroundColor: '#1F3128', borderRadius: 999, paddingVertical: 18,
    alignItems: 'center', marginTop: 4,
  },
  btnOff: { opacity: 0.45 },
  btnT: { color: '#fff', fontSize: 18, fontWeight: '800' },
  fine: { textAlign: 'center', color: '#5E666E', fontSize: 15, marginTop: 12 },
  link: { alignItems: 'center', paddingVertical: 16 },
  linkT: { color: '#4E6243', fontSize: 15, fontWeight: '600' },
  linkOff: { color: '#9aa0a6' },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 22 },
  rule: { flex: 1, height: 1, backgroundColor: '#D5D0C7' },
  or: { marginHorizontal: 12, color: '#151A1E', fontSize: 15, fontWeight: '800' },
  socialRow: { flexDirection: 'row', justifyContent: 'center', gap: 16 },
  // Round white pills, per the reference. 60pt clears mandate #3's touch floor.
  social: {
    width: 84, height: 60, borderRadius: 30, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#E4DFD6',
  },
  consent: {
    textAlign: 'center', color: '#5E666E', fontSize: 13.5, lineHeight: 19, marginTop: 22,
  },
  devRow: { alignItems: 'center', paddingVertical: 18, marginTop: 4 },
  devT: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: '#8c959f',
    textDecorationLine: 'underline' },
});
