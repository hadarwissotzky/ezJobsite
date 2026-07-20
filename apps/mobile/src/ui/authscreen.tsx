/**
 * Sign in / create account. Email + password -- the only method that works without
 * an SMS/email-delivery provider we do not yet have, and the only one with a real
 * "registration" step. On success we do nothing here: App subscribes to
 * onAuthStateChange and swaps to the main screen the moment a session exists, so
 * there is one source of truth for "logged in", not two.
 *
 * Errors are shown plainly, never swallowed -- a login that fails silently is the
 * same sin as a save that fails silently.
 */
import React from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { SupabaseConnector } from '../connector';
import { t as T } from '../i18n';

export function AuthScreen({ connector }: { connector: SupabaseConnector }) {
  const [mode, setMode] = React.useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const valid = email.includes('@') && email.length >= 5 && password.length >= 6;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true); setErr(null); setNotice(null);
    try {
      if (mode === 'signin') {
        await connector.login(email.trim(), password);
        // onAuthStateChange in App takes it from here.
      } else {
        const { needsEmailConfirm } = await connector.signUp(email.trim(), password);
        if (needsEmailConfirm) {
          setNotice(T('auth.checkEmail'));
          setMode('signin');
        }
        // else: session came back -> onAuthStateChange swaps the screen.
      }
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={st.c} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={st.inner}>
        <Text style={st.brand}>EZchangeorder</Text>
        <Text style={st.h}>{mode === 'signin' ? T('auth.signInTitle') : T('auth.signUpTitle')}</Text>

        <TextInput
          style={st.input}
          value={email}
          onChangeText={setEmail}
          placeholder={T('auth.email')}
          placeholderTextColor="#8c959f"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          inputMode="email"
        />
        <TextInput
          style={st.input}
          value={password}
          onChangeText={setPassword}
          placeholder={T('auth.password')}
          placeholderTextColor="#8c959f"
          autoCapitalize="none"
          secureTextEntry
        />

        {err && <Text style={st.err}>{err}</Text>}
        {notice && <Text style={st.notice}>{notice}</Text>}

        <Pressable style={[st.btn, (!valid || busy) && st.btnOff]} disabled={!valid || busy} onPress={submit}>
          {busy ? <ActivityIndicator color="#fff" /> : (
            <Text style={st.btnT}>{mode === 'signin' ? T('auth.signIn') : T('auth.createAccount')}</Text>
          )}
        </Pressable>

        <Pressable style={st.toggle} onPress={() => { setErr(null); setNotice(null); setMode(mode === 'signin' ? 'signup' : 'signin'); }}>
          <Text style={st.toggleT}>{mode === 'signin' ? T('auth.toSignUp') : T('auth.toSignIn')}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  c: { flex: 1, backgroundColor: '#FAFAF8' },
  inner: { flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
  brand: { fontSize: 30, fontWeight: '900', color: '#FF5A00', textAlign: 'center', marginBottom: 8 },
  h: { fontSize: 20, fontWeight: '700', color: '#0D0F12', textAlign: 'center', marginBottom: 28 },
  input: {
    backgroundColor: '#fff', borderColor: '#E4E5E1', borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 15, fontSize: 17, color: '#0D0F12', marginBottom: 12,
  },
  err: { color: '#C6281C', fontSize: 15, marginBottom: 10, textAlign: 'center' },
  notice: { color: '#0E8A4C', fontSize: 15, marginBottom: 10, textAlign: 'center' },
  btn: { backgroundColor: '#FF5A00', borderRadius: 12, paddingVertical: 17, alignItems: 'center', marginTop: 6 },
  btnOff: { opacity: 0.45 },
  btnT: { color: '#fff', fontSize: 18, fontWeight: '800' },
  toggle: { alignItems: 'center', paddingVertical: 18 },
  toggleT: { color: '#FF5A00', fontSize: 15, fontWeight: '600' },
});
