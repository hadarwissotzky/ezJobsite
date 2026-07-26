/**
 * Settings — profile editing + language + Team (company membership).
 *
 * WHY ONE SCREEN. A contractor has one place for "who I am and who's on my crew".
 * Profile (name, solo/company, trade, language) is the identity a proposal is
 * personalised from; Team is the company roster + invite/join. Both are low-
 * frequency, settings-shaped, so they live together behind one gear rather than
 * cluttering the capture-first home.
 *
 * SELF-CONTAINED. Takes db + the supabase client and loads its own data, so App.tsx
 * only has to mount it. Company reads come from the LOCALLY SYNCED tables (company /
 * company_member); every write is a server RPC (company.ts) — the client is never the
 * authority on membership.
 */
import React from 'react';
import { Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native';
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';
import type { SupabaseClient } from '@supabase/supabase-js';
import { t } from '../i18n';
import type { Lang } from '../i18n';
import { C, F, T as TH, label } from './theme';
import { TRADES, type Profile } from '../profile';
import {
  myCompany, listMembers, ensureOwnCompany, createInvite, acceptInvite, revokeMember,
  type MyCompany, type Member,
} from '../company';

export function SettingsScreen(props: {
  db: AbstractPowerSyncDatabase;
  supabase: SupabaseClient;
  userId: string;
  profile: Profile;
  lang: Lang;
  confirmBase: string;
  onSaveProfile: (p: Profile) => Promise<void>;
  onSetLang: (l: Lang) => Promise<void>;
  onBack: () => void;
}) {
  const { db, supabase, userId } = props;
  const [name, setName] = React.useState(props.profile.name);
  const [isSolo, setIsSolo] = React.useState(props.profile.isSolo);
  const [company, setCompany] = React.useState(props.profile.company ?? '');
  const [trade, setTrade] = React.useState<string | null>(props.profile.trade);
  const [lang, setLang] = React.useState<Lang>(props.lang);
  const [saved, setSaved] = React.useState(false);

  const [co, setCo] = React.useState<MyCompany | null>(null);
  const [members, setMembers] = React.useState<Member[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [joinToken, setJoinToken] = React.useState('');
  const [note, setNote] = React.useState<string | null>(null);

  const loadTeam = React.useCallback(async () => {
    try {
      const c = await myCompany(db, userId);
      setCo(c);
      if (c) setMembers(await listMembers(db, c.id, userId));
    } catch { /* tables may not have synced yet */ }
  }, [db, userId]);

  React.useEffect(() => { void loadTeam(); }, [loadTeam]);

  const save = async () => {
    await props.onSaveProfile({
      name: name.trim(), isSolo, company: isSolo ? null : company.trim(), trade,
    });
    if (lang !== props.lang) await props.onSetLang(lang);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  const invite = async () => {
    if (!co) return;
    setBusy(true); setNote(null);
    const r = await createInvite(supabase, co.id, 'crew', props.confirmBase);
    setBusy(false);
    if (!r.ok) { setNote(t('set.inviteFailed') + ' ' + r.reason); return; }
    // Share the link when hosted, else the code (always works typed in).
    const msg = r.url
      ? t({ k: 'set.inviteMsg', p: { company: co.name } } as any) + '\n\n' + r.url
      : t({ k: 'set.inviteMsgCode', p: { company: co.name, code: r.token } } as any);
    try { await Share.share({ message: msg }); } catch { /* user dismissed */ }
  };

  const join = async () => {
    const tok = joinToken.trim();
    if (!tok) return;
    setBusy(true); setNote(null);
    const r = await acceptInvite(supabase, tok, props.profile.name);
    setBusy(false);
    if (!r.ok) { setNote(t('set.joinFailed') + ' ' + r.reason); return; }
    setJoinToken('');
    setNote(t({ k: 'set.joined', p: { company: r.companyName } } as any));
    await loadTeam();
  };

  const revoke = async (m: Member) => {
    if (!co) return;
    setBusy(true);
    const r = await revokeMember(supabase, co.id, m.userId);
    setBusy(false);
    if (r.ok) await loadTeam(); else setNote(r.reason);
  };

  const roleLabel = (r: string) => t(('set.role.' + r) as any);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#fff' }}
      contentContainerStyle={{ padding: 16, paddingTop: 56, paddingBottom: 48 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
        <Pressable onPress={props.onBack} hitSlop={12} style={{ paddingRight: 12 }}>
          <Text style={{ fontSize: 26, color: C.ink }}>‹</Text>
        </Pressable>
        <Text style={{ fontFamily: F.dispSemi, fontSize: 24, color: C.ink }}>{t('set.title')}</Text>
      </View>

      {/* ---- Profile ---- */}
      <View style={TH.card}>
        <Text style={label}>{t('set.profile')}</Text>
        <TextInput style={inputStyle} value={name} onChangeText={setName}
          placeholder={t('fr.yourName')} placeholderTextColor="#8c959f" />
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          <Toggle on={isSolo} onPress={() => setIsSolo(true)} label={t('fr.solo')} />
          <Toggle on={!isSolo} onPress={() => setIsSolo(false)} label={t('fr.company')} />
        </View>
        {!isSolo && (
          <TextInput style={inputStyle} value={company} onChangeText={setCompany}
            placeholder={t('fr.companyName')} placeholderTextColor="#8c959f" />
        )}
        <Text style={{ ...TH.bodySteel, fontSize: 12.5, marginTop: 12, marginBottom: 6 }}>{t('set.trade')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {TRADES.map((tr) => (
            <Pressable key={tr} onPress={() => setTrade(trade === tr ? null : tr)}
              style={[chip, trade === tr && chipOn]}>
              <Text style={[chipT, trade === tr && chipTOn]}>{t(('trade.' + tr) as any)}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={{ ...TH.bodySteel, fontSize: 12.5, marginTop: 14, marginBottom: 6 }}>{t('set.language')}</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Toggle on={lang === 'en'} onPress={() => setLang('en')} label="English" />
          <Toggle on={lang === 'es'} onPress={() => setLang('es')} label="Español" />
        </View>
        <Pressable onPress={save} style={saveBtn}>
          <Text style={saveBtnT}>{saved ? t('set.saved') : t('set.save')}</Text>
        </Pressable>
      </View>

      {/* ---- Team ---- */}
      <View style={{ ...TH.card, marginTop: 14 }}>
        <Text style={label}>{t('set.team')}</Text>
        {co ? (
          <>
            <Text style={{ ...TH.bodySteel, fontSize: 13, marginTop: 4 }}>
              {t({ k: 'set.teamOf', p: { company: co.name } } as any)}
            </Text>
            {members.map((m) => (
              <View key={m.memberId} style={{ flexDirection: 'row', alignItems: 'center',
                justifyContent: 'space-between', marginTop: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: '#EDEFF2',
                    alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontFamily: F.dispSemi, color: C.steel }}>{m.isMe ? '★' : '•'}</Text>
                  </View>
                  <View>
                    <Text style={{ fontFamily: F.bodySemi, fontSize: 14.5, color: C.ink }}>
                      {m.name ? (m.isMe ? `${m.name} (${t('set.you')})` : m.name)
                        : (m.isMe ? t('set.you') : t('set.teammate'))}
                    </Text>
                    <Text style={{ ...TH.bodySteel, fontSize: 12 }}>{roleLabel(m.role)}</Text>
                  </View>
                </View>
                {co.isOwner && !m.isMe && (
                  <Pressable onPress={() => revoke(m)} disabled={busy} hitSlop={8}>
                    <Text style={{ color: C.danger, fontFamily: F.bodySemi, fontSize: 13 }}>{t('set.remove')}</Text>
                  </Pressable>
                )}
              </View>
            ))}
            {co.isOwner && (
              <Pressable onPress={invite} disabled={busy} style={{ ...saveBtn, backgroundColor: C.ink }}>
                <Text style={saveBtnT}>{t('set.invite')}</Text>
              </Pressable>
            )}
          </>
        ) : (
          <Text style={{ ...TH.bodySteel, fontSize: 13, marginTop: 4 }}>{t('set.noCompany')}</Text>
        )}

        {/* Join a company by code (always available). */}
        <Text style={{ ...TH.bodySteel, fontSize: 12.5, marginTop: 16, marginBottom: 6 }}>{t('set.joinTitle')}</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput style={{ ...inputStyle, flex: 1, marginTop: 0 }} value={joinToken}
            onChangeText={setJoinToken} autoCapitalize="none"
            placeholder={t('set.joinPlaceholder')} placeholderTextColor="#8c959f" />
          <Pressable onPress={join} disabled={busy || !joinToken.trim()}
            style={{ paddingHorizontal: 18, borderRadius: 10, backgroundColor: C.ink,
              alignItems: 'center', justifyContent: 'center', opacity: joinToken.trim() ? 1 : 0.4 }}>
            <Text style={{ color: '#fff', fontFamily: F.bodySemi }}>{t('set.joinBtn')}</Text>
          </Pressable>
        </View>
        {note && <Text style={{ ...TH.bodySteel, fontSize: 12.5, marginTop: 10, color: C.inkSoft }}>{note}</Text>}
      </View>
    </ScrollView>
  );
}

function Toggle({ on, onPress, label: lbl }: { on: boolean; onPress: () => void; label: string }) {
  return (
    <Pressable onPress={onPress} style={[chip, { flex: 1, alignItems: 'center', paddingVertical: 12 }, on && chipOn]}>
      <Text style={[chipT, on && chipTOn]}>{lbl}</Text>
    </Pressable>
  );
}

const inputStyle = {
  marginTop: 10, borderWidth: 1, borderColor: C.line, borderRadius: 10,
  paddingHorizontal: 12, paddingVertical: 12, fontFamily: F.body, fontSize: 15.5, color: C.ink,
} as const;
const chip = {
  borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8,
} as const;
const chipOn = { backgroundColor: C.ink, borderColor: C.ink } as const;
const chipT = { fontFamily: F.bodySemi, fontSize: 13.5, color: C.steel } as const;
const chipTOn = { color: '#fff' } as const;
const saveBtn = {
  marginTop: 16, minHeight: 50, borderRadius: 12, backgroundColor: C.orange,
  alignItems: 'center', justifyContent: 'center',
} as const;
const saveBtnT = { fontFamily: F.dispSemi, fontSize: 16, color: '#fff', letterSpacing: 0.5 } as const;
