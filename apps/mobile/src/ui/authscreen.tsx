/**
 * Sign in — Phone or Email, plus Google (hadar, 2026-08-03, modelled on Handoff).
 *
 * THREE WAYS IN, ONE SCREEN. A segmented toggle picks the method and the form below it
 * swaps. Google sits under a divider because it is a different KIND of choice — not a
 * third option to weigh, just a shortcut for people who already have the account.
 *
 * WHY EMAIL STILL USES A PASSWORD while phone uses a code. Handoff is passwordless on
 * both, and that is the tidier design, but Supabase's built-in SMTP is rate-limited to
 * a handful of messages an hour. As a LOGIN path that is a lockout waiting to happen,
 * and this project has already been burned once by making the only way in depend on a
 * message provider (SPEC-identity-onboarding-v1 §5 — a misconfigured Twilio locked the
 * account holder out of his own app for a day). Email+password needs no provider and
 * cannot rate-limit. Moving email to codes is a small change here once custom SMTP
 * (Resend/SendGrid) exists; until then the password is what guarantees nobody is ever
 * locked out of their own evidence.
 *
 * FAILURES KEEP THEIR PHASE (REQ-ID6). `classify()` takes the phase because the same
 * provider text means different things in each: a failed SEND once rendered as "that
 * code isn't right" on a screen where no code had been typed, and cost an evening.
 */
import React from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';

import type { SupabaseConnector } from '../connector';
import { displayPhone, toE164 } from '../sendto';
import { t as T } from '../i18n';

const RESEND_AFTER_S = 60;
const CODE_LEN = 6;

type Method = 'phone' | 'email';
type Step = 'form' | 'confirm' | 'code';
type Fail =
  | { kind: 'net' | 'notArrived' | 'badCode' | 'cantSend' | 'badLogin' }
  | { kind: 'other'; text: string }
  | null;

function classify(e: any, phase: 'send' | 'verify' | 'login'): Fail {
  const text = e?.message ?? String(e ?? '');
  const status = e?.status ?? e?.code;
  if (/network|fetch|timed? ?out|connection|offline/i.test(text)) return { kind: 'net' };
  if (String(status) === '429' || /rate|too many|limit/i.test(text)) return { kind: 'notArrived' };
  if (phase === 'login') return { kind: 'badLogin' };
  if (phase === 'verify' && /invalid|expired|incorrect|token/i.test(text)) return { kind: 'badCode' };
  if (phase === 'send') return { kind: 'cantSend' };
  return { kind: 'other', text };
}

export function AuthScreen({ connector }: { connector: SupabaseConnector }) {
  const [method, setMethod] = React.useState<Method>('phone');
  const [step, setStep] = React.useState<Step>('form');
  const [typed, setTyped] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [code, setCode] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [fail, setFail] = React.useState<Fail>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [left, setLeft] = React.useState(0);
  const [signUp, setSignUp] = React.useState(false);

  // Derived every render, never cached: a stored copy is how the number shown and the
  // number texted come to disagree, which is what the confirm step exists to prevent.
  const e164 = toE164(typed);
  const emailOk = email.includes('@') && email.length >= 5 && password.length >= 6;

  React.useEffect(() => {
    if (step !== 'code' || left <= 0) return;
    const id = setInterval(() => setLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [step, left]);

  const reset = () => { setFail(null); setNotice(null); };

  const sendCode = async () => {
    if (!e164 || busy) return;
    setBusy(true); reset();
    try {
      await connector.startPhoneAuth(e164);
      setStep('code'); setLeft(RESEND_AFTER_S);
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

  const submitEmail = async () => {
    if (!emailOk || busy) return;
    setBusy(true); reset();
    try {
      if (signUp) {
        const { needsEmailConfirm } = await connector.signUp(email.trim(), password);
        if (needsEmailConfirm) { setNotice(T('auth.checkEmail')); setSignUp(false); }
      } else {
        await connector.login(email.trim(), password);
      }
    } catch (e) { setFail(classify(e, 'login')); } finally { setBusy(false); }
  };

  const google = async () => {
    if (busy) return;
    setBusy(true); reset();
    try {
      await connector.signInWithGoogle({
        redirectTo: Linking.createURL('auth-callback'),
        openAuth: (url, redirectTo) =>
          WebBrowser.openAuthSessionAsync(url, redirectTo) as Promise<any>,
      });
    } catch (e) { setFail(classify(e, 'login')); } finally { setBusy(false); }
  };

  const failText = !fail ? null
    : fail.kind === 'other' ? fail.text
    : T(fail.kind === 'net' ? 'auth.errNoSignal'
      : fail.kind === 'notArrived' ? 'auth.errNotArrived'
      : fail.kind === 'cantSend' ? 'auth.errCantSend'
      : fail.kind === 'badLogin' ? 'auth.errBadLogin'
      : 'auth.errBadCode');

  // ── the code step owns the screen; nothing else there is actionable ──
  if (step === 'code') {
    return (
      <KeyboardAvoidingView style={st.c} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={st.inner}>
          <Text style={st.brand}>EZchangeorder</Text>
          <Text style={st.h}>{T('auth.codeTitle')}</Text>
          <Text style={st.sub}>
            {T({ k: 'auth.codeSentTo', p: { phone: displayPhone(e164) } })}
            {'\n'}
            {/* Observed 30s+ delivery. Without this line a slow text reads as a broken
                app, and the user backs out or hammers resend. */}
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

  // ── read the number back before any SMS goes out (REQ-ID4, mandate #6) ──
  if (step === 'confirm') {
    return (
      <KeyboardAvoidingView style={st.c} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={st.inner}>
          <Text style={st.brand}>EZchangeorder</Text>
          <Text style={st.h}>{T('auth.confirmTitle')}</Text>
          <Text style={st.bigNumber}>{displayPhone(e164)}</Text>
          <Text style={st.sub}>{T('auth.confirmWhy')}</Text>
          {failText && <Text style={st.err}>{failText}</Text>}
          <Pressable style={[st.btn, busy && st.btnOff]} disabled={busy} onPress={sendCode}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={st.btnT}>{T('auth.sendCode')}</Text>}
          </Pressable>
          <Pressable style={st.link} onPress={() => { reset(); setStep('form'); }}>
            <Text style={st.linkT}>{T('auth.changeNumber')}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView style={st.c} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={st.scroll} keyboardShouldPersistTaps="handled">
        <Text style={st.brand}>EZchangeorder</Text>
        <Text style={st.h}>{signUp ? T('auth.signUpTitle') : T('auth.signInTitle')}</Text>

        <Pressable style={st.swap} onPress={() => { reset(); setSignUp(!signUp); }}>
          <Text style={st.swapT}>{signUp ? T('auth.toSignIn') : T('auth.toSignUp')}</Text>
        </Pressable>

        {/* ── method toggle ── */}
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

        {method === 'phone' ? (
          <>
            <View style={st.note}><Text style={st.noteT}>{T('auth.phoneWhy')}</Text></View>
            <TextInput
              style={st.input} value={typed}
              onChangeText={(v) => { setTyped(v); reset(); }}
              placeholder={T('auth.phonePlaceholder')} placeholderTextColor="#8c959f"
              keyboardType="phone-pad" inputMode="tel"
              textContentType="telephoneNumber" autoComplete="tel"
              accessibilityLabel={T('auth.phoneTitle')}
            />
            {/* Only once they have typed enough to be wrong about — scolding a half-typed
                field is how a form teaches someone that it dislikes them. */}
            {typed.replace(/\D/g, '').length >= 7 && !e164 && (
              <Text style={st.err}>{T('auth.phoneBad')}</Text>
            )}
            <Pressable style={[st.btn, !e164 && st.btnOff]} disabled={!e164}
              onPress={() => { reset(); setStep('confirm'); }}>
              <Text style={st.btnT}>{T('auth.continue')}</Text>
            </Pressable>
          </>
        ) : (
          <>
            <TextInput
              style={st.input} value={email}
              onChangeText={(v) => { setEmail(v); reset(); }}
              placeholder={T('auth.email')} placeholderTextColor="#8c959f"
              autoCapitalize="none" autoCorrect={false}
              keyboardType="email-address" inputMode="email" textContentType="emailAddress"
            />
            <TextInput
              style={st.input} value={password}
              onChangeText={(v) => { setPassword(v); reset(); }}
              placeholder={T('auth.password')} placeholderTextColor="#8c959f"
              autoCapitalize="none" secureTextEntry
              textContentType={signUp ? 'newPassword' : 'password'}
            />
            <Pressable style={[st.btn, (!emailOk || busy) && st.btnOff]}
              disabled={!emailOk || busy} onPress={submitEmail}>
              {busy ? <ActivityIndicator color="#fff" /> : (
                <Text style={st.btnT}>{signUp ? T('auth.createAccount') : T('auth.signIn')}</Text>
              )}
            </Pressable>
          </>
        )}

        {failText && <Text style={st.err}>{failText}</Text>}
        {notice && <Text style={st.notice}>{notice}</Text>}

        {/* ── Google: a shortcut, not a third thing to weigh ── */}
        <View style={st.divider}>
          <View style={st.rule} /><Text style={st.or}>{T('auth.or')}</Text><View style={st.rule} />
        </View>
        <Pressable style={[st.gBtn, busy && st.btnOff]} disabled={busy} onPress={google}
          accessibilityRole="button" accessibilityLabel={T('auth.google')}>
          <Text style={st.gT}>{T('auth.google')}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  c: { flex: 1, backgroundColor: '#F7F4EE' },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 28, paddingVertical: 40 },
  inner: { flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
  brand: { fontSize: 30, fontWeight: '900', color: '#4E6243', textAlign: 'center', marginBottom: 8 },
  h: { fontSize: 22, fontWeight: '700', color: '#151A1E', textAlign: 'center', marginBottom: 6 },
  sub: { fontSize: 16, lineHeight: 23, color: '#5E666E', textAlign: 'center', marginBottom: 22 },
  slow: { fontSize: 14, color: '#8a9199' },
  swap: { alignItems: 'center', paddingVertical: 6, marginBottom: 18 },
  swapT: { color: '#4E6243', fontSize: 15, fontWeight: '700' },
  groupLab: { fontSize: 13, color: '#5E666E', textAlign: 'center', marginBottom: 8 },
  seg: {
    flexDirection: 'row', alignSelf: 'center', backgroundColor: '#EFEBE3',
    borderRadius: 10, padding: 3, marginBottom: 16,
  },
  segBtn: { paddingVertical: 9, paddingHorizontal: 26, borderRadius: 8 },
  segOn: { backgroundColor: '#fff' },
  segT: { fontSize: 15, fontWeight: '600', color: '#5E666E' },
  segTOn: { color: '#151A1E', fontWeight: '800' },
  note: { backgroundColor: '#FBF3E4', borderRadius: 10, padding: 12, marginBottom: 14 },
  noteT: { fontSize: 14, lineHeight: 20, color: '#6b5a3a' },
  input: {
    backgroundColor: '#fff', borderColor: '#D5D0C7', borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 15, fontSize: 18, color: '#151A1E', marginBottom: 12,
  },
  codeInput: { fontSize: 30, textAlign: 'center', letterSpacing: 10, fontWeight: '700' },
  bigNumber: { fontSize: 30, fontWeight: '800', color: '#151A1E', textAlign: 'center', marginBottom: 14 },
  err: { color: '#8B5148', fontSize: 15, marginBottom: 10, textAlign: 'center' },
  notice: { color: '#536B49', fontSize: 15, marginBottom: 10, textAlign: 'center' },
  btn: { backgroundColor: '#1F3128', borderRadius: 12, paddingVertical: 17, alignItems: 'center', marginTop: 4 },
  btnOff: { opacity: 0.45 },
  btnT: { color: '#fff', fontSize: 18, fontWeight: '800' },
  link: { alignItems: 'center', paddingVertical: 16 },
  linkT: { color: '#4E6243', fontSize: 15, fontWeight: '600' },
  linkOff: { color: '#9aa0a6' },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 22 },
  rule: { flex: 1, height: 1, backgroundColor: '#D5D0C7' },
  or: { marginHorizontal: 12, color: '#5E666E', fontSize: 14, fontWeight: '700' },
  gBtn: {
    backgroundColor: '#fff', borderColor: '#D5D0C7', borderWidth: 1, borderRadius: 12,
    paddingVertical: 15, alignItems: 'center',
  },
  gT: { color: '#151A1E', fontSize: 16, fontWeight: '700' },
});
