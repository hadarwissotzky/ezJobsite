/**
 * Sign in with a phone number and a 6-digit code. There is no password anywhere in
 * this app, and no "create account" step (SPEC-identity-onboarding-v1, REQ-ID1/ID2).
 *
 * WHY THIS REPLACED EMAIL+PASSWORD (hadar, 2026-08-01). The previous version's own
 * header said email+password was "the only method that works without an SMS/email-
 * delivery provider we do not yet have" — a provider constraint, never a judgement
 * that email suits a contractor. A password must be invented, remembered, and
 * recovered, and recovery runs through an inbox this user may not have on the phone.
 * A phone number is the one credential they already know by heart.
 *
 * THREE STEPS, and the middle one is not padding:
 *   number  → they type it
 *   confirm → the PARSED number is read back before any SMS is sent (REQ-ID4)
 *   code    → 6 digits, auto-filled by the OS wherever possible (REQ-ID3)
 *
 * The confirm step exists because of mandate #6: a phone number IS a number, a
 * mistyped digit sends the code to a stranger, and `toE164` may have ADDED a "+1"
 * that the user never typed. sendto.ts states the rule this follows — "an assumption
 * shown is a different thing from an assumption made". This is where it gets shown.
 *
 * FAILURES ARE THREE DIFFERENT THINGS and are never collapsed into one message
 * (REQ-ID6): no signal · the code never arrived · the code is wrong. They have
 * different remedies, and a user who cannot tell them apart retries the wrong one.
 * Anything unrecognised falls through to the provider's own words rather than a
 * invented reassurance — a login that fails silently is the same sin as a save that
 * fails silently, which is what the previous version of this file said too.
 *
 * On success this component does nothing: App subscribes to onAuthStateChange and
 * swaps the screen the moment a session exists, so "logged in" has one source of
 * truth, not two.
 */
import React from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable,
  StyleSheet, Text, TextInput, View,
} from 'react-native';

import type { SupabaseConnector } from '../connector';
import { displayPhone, toE164 } from '../sendto';
import { t as T } from '../i18n';

/** Seconds before "send it again" becomes tappable (REQ-ID7). */
const RESEND_AFTER_S = 60;
const CODE_LEN = 6;

type Step = 'number' | 'confirm' | 'code';
/** REQ-ID6's three states, plus an honest escape hatch. */
type Fail = { kind: 'net' | 'notArrived' | 'badCode' } | { kind: 'other'; text: string } | null;

/**
 * Sort a thrown error into the three remedies. Deliberately conservative: anything
 * not confidently recognised becomes `other` and shows the provider's own message,
 * because guessing wrong here sends the user to fix something that is not broken.
 */
function classify(e: any): Fail {
  const text = e?.message ?? String(e ?? '');
  const status = e?.status ?? e?.code;
  if (/network|fetch|timed? ?out|connection|offline/i.test(text)) return { kind: 'net' };
  if (String(status) === '429' || /rate|too many|limit/i.test(text)) return { kind: 'notArrived' };
  if (/invalid|expired|incorrect|token|otp/i.test(text)) return { kind: 'badCode' };
  return { kind: 'other', text };
}

export function AuthScreen({ connector }: { connector: SupabaseConnector }) {
  const [step, setStep] = React.useState<Step>('number');
  const [typed, setTyped] = React.useState('');
  const [code, setCode] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [fail, setFail] = React.useState<Fail>(null);
  const [left, setLeft] = React.useState(0);

  // The parsed number is derived on every render from what is on screen, never
  // cached — a stored copy is how the number shown and the number texted come to
  // disagree, which is the exact failure the confirm step exists to prevent.
  const e164 = toE164(typed);

  // Resend countdown. Runs only while the code step is open and time remains.
  React.useEffect(() => {
    if (step !== 'code' || left <= 0) return;
    const id = setInterval(() => setLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [step, left]);

  const send = async () => {
    if (!e164 || busy) return;
    setBusy(true); setFail(null);
    try {
      await connector.startPhoneAuth(e164);
      setStep('code');
      setLeft(RESEND_AFTER_S);
    } catch (e) {
      setFail(classify(e));
    } finally {
      setBusy(false);
    }
  };

  // Guards the auto-submit below against re-firing on the same digits, which would
  // burn attempts against the provider's rate limit for free.
  const triedRef = React.useRef<string | null>(null);

  const verify = React.useCallback(async (value: string) => {
    if (!e164 || busy || value.length !== CODE_LEN) return;
    triedRef.current = value;
    setBusy(true); setFail(null);
    try {
      await connector.verifyPhoneCode(e164, value);
      // onAuthStateChange in App takes it from here.
    } catch (e) {
      setFail(classify(e));
      setCode('');            // clear so the next attempt starts from empty
      triedRef.current = null;
    } finally {
      setBusy(false);
    }
  }, [connector, e164, busy]);

  // SUBMIT ITSELF once six digits exist. With OS autofill this makes the whole step
  // zero taps, which is the point: every avoidable touch is one more thing to teach.
  const onCode = (v: string) => {
    const digits = v.replace(/\D/g, '').slice(0, CODE_LEN);
    setCode(digits);
    if (digits.length === CODE_LEN && digits !== triedRef.current) void verify(digits);
  };

  const failText = !fail ? null
    : fail.kind === 'other' ? fail.text
    : T(fail.kind === 'net' ? 'auth.errNoSignal'
      : fail.kind === 'notArrived' ? 'auth.errNotArrived'
      : 'auth.errBadCode');

  return (
    <KeyboardAvoidingView style={st.c} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={st.inner}>
        <Text style={st.brand}>EZchangeorder</Text>

        {step === 'number' && (
          <>
            <Text style={st.h}>{T('auth.phoneTitle')}</Text>
            <Text style={st.sub}>{T('auth.phoneWhy')}</Text>
            <TextInput
              style={st.input}
              value={typed}
              onChangeText={(v) => { setTyped(v); setFail(null); }}
              placeholder={T('auth.phonePlaceholder')}
              placeholderTextColor="#8c959f"
              keyboardType="phone-pad"
              inputMode="tel"
              textContentType="telephoneNumber"
              autoComplete="tel"
              autoFocus
              accessibilityLabel={T('auth.phoneTitle')}
            />
            {/* Only once they have typed enough to be wrong about. Scolding an empty
                field is how a form teaches someone that it dislikes them. */}
            {typed.replace(/\D/g, '').length >= 7 && !e164 && (
              <Text style={st.err}>{T('auth.phoneBad')}</Text>
            )}
            <Pressable
              style={[st.btn, !e164 && st.btnOff]}
              disabled={!e164}
              onPress={() => { setFail(null); setStep('confirm'); }}
            >
              <Text style={st.btnT}>{T('auth.continue')}</Text>
            </Pressable>
          </>
        )}

        {step === 'confirm' && (
          <>
            <Text style={st.h}>{T('auth.confirmTitle')}</Text>
            {/* The whole reason for this step. Big, grouped, proof-readable. */}
            <Text style={st.bigNumber}>{displayPhone(e164)}</Text>
            <Text style={st.sub}>{T('auth.confirmWhy')}</Text>

            {failText && <Text style={st.err}>{failText}</Text>}

            <Pressable style={[st.btn, busy && st.btnOff]} disabled={busy} onPress={send}>
              {busy ? <ActivityIndicator color="#fff" />
                : <Text style={st.btnT}>{T('auth.sendCode')}</Text>}
            </Pressable>
            <Pressable style={st.toggle} onPress={() => { setFail(null); setStep('number'); }}>
              <Text style={st.toggleT}>{T('auth.changeNumber')}</Text>
            </Pressable>
          </>
        )}

        {step === 'code' && (
          <>
            <Text style={st.h}>{T('auth.codeTitle')}</Text>
            <Text style={st.sub}>
              {T({ k: 'auth.codeSentTo', p: { phone: displayPhone(e164) } })}
            </Text>
            <TextInput
              style={[st.input, st.codeInput]}
              value={code}
              onChangeText={onCode}
              placeholder="000000"
              placeholderTextColor="#c9c4bb"
              keyboardType="number-pad"
              inputMode="numeric"
              // REQ-ID3 — the OS offers the code from the notification as one tap.
              textContentType="oneTimeCode"
              autoComplete="sms-otp"
              maxLength={CODE_LEN}
              autoFocus
              editable={!busy}
              accessibilityLabel={T('auth.codeTitle')}
            />

            {failText && <Text style={st.err}>{failText}</Text>}
            {busy && <ActivityIndicator color="#4E6243" style={{ marginBottom: 10 }} />}

            {/* Resend is a countdown, not a silently-ignored tap (REQ-ID7). */}
            <Pressable
              style={st.toggle}
              disabled={left > 0 || busy}
              onPress={() => { setCode(''); triedRef.current = null; void send(); }}
            >
              <Text style={[st.toggleT, (left > 0 || busy) && st.toggleOff]}>
                {left > 0 ? T({ k: 'auth.resendIn', p: { s: left } }) : T('auth.resend')}
              </Text>
            </Pressable>
            <Pressable style={st.toggle} onPress={() => {
              setFail(null); setCode(''); triedRef.current = null; setStep('number');
            }}>
              <Text style={st.toggleT}>{T('auth.changeNumber')}</Text>
            </Pressable>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  c: { flex: 1, backgroundColor: '#F7F4EE' },
  inner: { flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
  brand: { fontSize: 30, fontWeight: '900', color: '#4E6243', textAlign: 'center', marginBottom: 8 },
  h: { fontSize: 22, fontWeight: '700', color: '#151A1E', textAlign: 'center', marginBottom: 8 },
  sub: { fontSize: 16, lineHeight: 23, color: '#5E666E', textAlign: 'center', marginBottom: 22 },
  input: {
    backgroundColor: '#fff', borderColor: '#D5D0C7', borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 15, fontSize: 20, color: '#151A1E', marginBottom: 12,
  },
  // The code is read back digit by digit; spacing is what makes that possible.
  codeInput: { fontSize: 30, textAlign: 'center', letterSpacing: 10, fontWeight: '700' },
  // The number under proof-read. Deliberately the largest thing on the screen —
  // mandate #6 applies to the one figure this whole step exists to check.
  bigNumber: {
    fontSize: 30, fontWeight: '800', color: '#151A1E',
    textAlign: 'center', marginBottom: 14, letterSpacing: 0.5,
  },
  err: { color: '#8B5148', fontSize: 15, marginBottom: 10, textAlign: 'center' },
  btn: { backgroundColor: '#4E6243', borderRadius: 12, paddingVertical: 17, alignItems: 'center', marginTop: 6 },
  btnOff: { opacity: 0.45 },
  btnT: { color: '#fff', fontSize: 18, fontWeight: '800' },
  toggle: { alignItems: 'center', paddingVertical: 16 },
  toggleT: { color: '#4E6243', fontSize: 15, fontWeight: '600' },
  toggleOff: { color: '#9aa0a6' },
});
