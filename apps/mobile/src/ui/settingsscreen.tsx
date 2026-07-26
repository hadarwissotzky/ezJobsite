/**
 * Account & Settings hub — the one place a contractor manages who they are, their
 * crew, and the app itself. Structured as a standard mobile settings hub (the shape
 * field apps like CompanyCam/Jobber and the Timemark reference all converge on):
 *
 *   Identity header → Profile → Team → Preferences → Subscription → Support → About
 *
 * WHY ONE SCREEN, MANY SECTIONS. The ICP is someone for whom software is not second
 * nature (CLAUDE.md §1). One gear, one scroll, every account concern in a predictable
 * order beats a nest of screens they have to learn to navigate. Low-frequency settings
 * stay out of the capture-first home entirely.
 *
 * HONESTY ON PAYMENTS. v1 does not process payments (CLAUDE.md §5 — do NOT build
 * invoicing/payments). The Subscription card states the pilot plan plainly and routes
 * an upgrade to a contact email rather than faking a checkout that cannot charge.
 *
 * SELF-CONTAINED. Takes db + the supabase client and loads its own data; App.tsx only
 * mounts it. Company reads come from the LOCALLY SYNCED tables; every membership write
 * is a server RPC (company.ts) — the client is never the authority on membership.
 */
import React from 'react';
import { Alert, Linking, Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native';
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';
import type { SupabaseClient } from '@supabase/supabase-js';
import appJson from '../../app.json';
import { t } from '../i18n';
import type { Lang } from '../i18n';
import { registerPushToken } from '../push';
import { C, F, T as TH, label } from './theme';
import { TRADES, type Profile } from '../profile';
import {
  myCompany, listMembers, createInvite, acceptInvite, revokeMember,
  type MyCompany, type Member,
} from '../company';

const APP_VERSION = (appJson as any)?.expo?.version ?? '1.0.0';
const SUPPORT_EMAIL = 'support@ezchangeorder.com';

export function SettingsScreen(props: {
  db: AbstractPowerSyncDatabase;
  supabase: SupabaseClient;
  userId: string;
  profile: Profile;
  lang: Lang;
  confirmBase: string;
  onSaveProfile: (p: Profile) => Promise<void>;
  onSetLang: (l: Lang) => Promise<void>;
  onSignOut: () => Promise<void>;
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

  // Notification permission is an OS truth, not ours to fake. We reflect it and offer
  // to request+register; we never claim "on" when the OS says otherwise.
  const [notif, setNotif] = React.useState<'unknown' | 'granted' | 'denied' | 'undetermined'>('unknown');

  const loadTeam = React.useCallback(async () => {
    try {
      const c = await myCompany(db, userId);
      setCo(c);
      if (c) setMembers(await listMembers(db, c.id, userId));
    } catch { /* tables may not have synced yet */ }
  }, [db, userId]);

  const loadNotif = React.useCallback(async () => {
    try {
      const N = await import('expo-notifications');
      const st = (await N.getPermissionsAsync()).status;
      setNotif(st === 'granted' ? 'granted' : st === 'denied' ? 'denied' : 'undetermined');
    } catch { setNotif('unknown'); }
  }, []);

  React.useEffect(() => { void loadTeam(); void loadNotif(); }, [loadTeam, loadNotif]);

  const save = async () => {
    await props.onSaveProfile({
      name: name.trim(), isSolo, company: isSolo ? null : company.trim(), trade,
    });
    if (lang !== props.lang) await props.onSetLang(lang);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  const enableNotif = async () => {
    try {
      const N = await import('expo-notifications');
      const st = (await N.requestPermissionsAsync()).status;
      if (st === 'granted') {
        await registerPushToken(supabase, userId);  // token now, not just on next launch
        setNotif('granted');
      } else {
        setNotif('denied');
      }
    } catch { /* best-effort — mandate #7, push is opportunistic */ }
  };

  const invite = async () => {
    if (!co) return;
    setBusy(true); setNote(null);
    const r = await createInvite(supabase, co.id, 'crew', props.confirmBase);
    setBusy(false);
    if (!r.ok) { setNote(t('set.inviteFailed') + ' ' + r.reason); return; }
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

  const revoke = (m: Member) => {
    if (!co) return;
    // Confirm before a destructive, non-undoable membership write (review 2026-07-25):
    // a mis-tap must not silently remove crew who then have to be re-invited.
    const who = m.name || t('set.teammate');
    Alert.alert(
      t('set.removeTitle'),
      t({ k: 'set.removeConfirm', p: { who } } as any),
      [
        { text: t('set.cancel'), style: 'cancel' },
        {
          text: t('set.remove'), style: 'destructive',
          onPress: async () => {
            setBusy(true);
            const r = await revokeMember(supabase, co.id, m.userId);
            setBusy(false);
            if (r.ok) await loadTeam(); else setNote(r.reason);
          },
        },
      ],
    );
  };

  const mailTo = (subject: string) =>
    Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`).catch(() => {});

  const roleLabel = (r: string) => t(('set.role.' + r) as any);
  const initials = (name.trim() || props.profile.name || '?')
    .split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
  const identityLine = isSolo
    ? t('set.solo')
    // Empty-state PROMPT, not a fake company literally named "Company" (review 2026-07-25).
    : (company.trim() || props.profile.company || t('set.addCompany'));

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#fff' }}
      contentContainerStyle={{ padding: 16, paddingTop: 56, paddingBottom: 48 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
        <Pressable onPress={props.onBack} hitSlop={12} style={{ paddingRight: 12 }}>
          <Text style={{ fontSize: 26, color: C.ink }}>‹</Text>
        </Pressable>
        <Text style={{ fontFamily: F.dispSemi, fontSize: 24, color: C.ink }}>{t('set.title')}</Text>
      </View>

      {/* ---- Identity header ---- */}
      <View style={{ ...TH.card, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: C.ink,
          alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: F.dispSemi, fontSize: 20, color: '#fff' }}>{initials}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: F.dispSemi, fontSize: 18, color: C.ink }}>
            {name.trim() || props.profile.name || t('set.you')}
          </Text>
          <Text style={{ ...TH.bodySteel, fontSize: 13 }}>
            {identityLine}{co ? '  ·  ' + roleLabel(co.role) : ''}
          </Text>
        </View>
      </View>

      {/* ---- Profile ---- */}
      <View style={{ ...TH.card, marginTop: 14 }}>
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
                  <Pressable onPress={() => revoke(m)} disabled={busy} hitSlop={10}
                    style={{ minHeight: 44, paddingHorizontal: 12, justifyContent: 'center' }}>
                    <Text style={{ color: C.danger, fontFamily: F.bodySemi, fontSize: 14 }}>{t('set.remove')}</Text>
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

        <Text style={{ ...TH.bodySteel, fontSize: 12.5, marginTop: 16, marginBottom: 6 }}>{t('set.joinTitle')}</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput style={{ ...inputStyle, flex: 1, marginTop: 0 }} value={joinToken}
            onChangeText={setJoinToken} autoCapitalize="none"
            placeholder={t('set.joinPlaceholder')} placeholderTextColor="#8c959f" />
          <Pressable onPress={join} disabled={busy || !joinToken.trim()}
            style={{ paddingHorizontal: 18, minHeight: 48, borderRadius: 10, backgroundColor: C.ink,
              alignItems: 'center', justifyContent: 'center', opacity: joinToken.trim() ? 1 : 0.4 }}>
            <Text style={{ color: '#fff', fontFamily: F.bodySemi }}>{t('set.joinBtn')}</Text>
          </Pressable>
        </View>
        {note && <Text style={{ ...TH.bodySteel, fontSize: 12.5, marginTop: 10, color: C.inkSoft }}>{note}</Text>}
      </View>

      {/* ---- Preferences ---- */}
      <View style={{ ...TH.card, marginTop: 14 }}>
        <Text style={label}>{t('set.prefs')}</Text>
        <Row
          title={t('set.notif')}
          value={notif === 'granted' ? t('set.notifOn')
            : notif === 'denied' ? t('set.notifDenied')
            : notif === 'unknown' ? t('set.notifUnknown') : t('set.notifOff')}
          // 'undetermined' → in-app request works; 'denied'/'unknown' → the request
          // would no-op (blocked, or the module is unavailable), so route to the OS
          // Settings app where it can actually be changed (review 2026-07-25).
          action={notif === 'granted' ? undefined
            : notif === 'undetermined' ? { label: t('set.notifEnable'), onPress: enableNotif }
            : { label: t('set.openSystem'), onPress: () => Linking.openSettings().catch(() => {}) }}
        />
      </View>

      {/* ---- Subscription ---- */}
      <View style={{ ...TH.card, marginTop: 14 }}>
        <Text style={label}>{t('set.plan')}</Text>
        <Row title={t('set.planName')} value={t('set.planPilot')} />
        <Text style={{ ...TH.bodySteel, fontSize: 12.5, marginTop: 8 }}>{t('set.planNote')}</Text>
        <Pressable onPress={() => mailTo('EZchangeorder — upgrade / plans')}
          style={{ ...saveBtn, backgroundColor: C.ink, marginTop: 12 }}>
          <Text style={saveBtnT}>{t('set.planContact')}</Text>
        </Pressable>
      </View>

      {/* ---- Support ---- */}
      <View style={{ ...TH.card, marginTop: 14 }}>
        <Text style={label}>{t('set.support')}</Text>
        <LinkRow title={t('set.contact')} onPress={() => mailTo('EZchangeorder — support')} />
        <LinkRow title={t('set.feedback')} onPress={() => mailTo('EZchangeorder — feedback')} />
      </View>

      {/* ---- About ---- */}
      <View style={{ ...TH.card, marginTop: 14 }}>
        <Text style={label}>{t('set.about')}</Text>
        <Row title={t('set.version')} value={APP_VERSION} />
        <LinkRow title={t('set.terms')}
          onPress={() => Linking.openURL(`https://${props.confirmBase || 'ezchangeorder.com'}/terms`).catch(() => {})} />
        <LinkRow title={t('set.privacy')}
          onPress={() => Linking.openURL(`https://${props.confirmBase || 'ezchangeorder.com'}/privacy`).catch(() => {})} />
        <Pressable
          onPress={() => Alert.alert(t('set.signOut'), t('set.signOutConfirm'), [
            { text: t('set.cancel'), style: 'cancel' },
            { text: t('set.signOut'), style: 'destructive', onPress: () => { void props.onSignOut(); } },
          ])}
          style={{ marginTop: 14, minHeight: 50, borderRadius: 12, borderWidth: 1.5,
            borderColor: C.danger, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: F.dispSemi, fontSize: 15.5, color: C.danger }}>{t('set.signOut')}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

/** A settings row: title on the left, a value + optional inline action on the right. */
function Row(props: { title: string; value?: string; action?: { label: string; onPress: () => void } }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingVertical: 10, minHeight: 44 }}>
      <Text style={{ fontFamily: F.bodySemi, fontSize: 15, color: C.ink, flex: 1 }}>{props.title}</Text>
      {props.value && <Text style={{ ...TH.bodySteel, fontSize: 14 }}>{props.value}</Text>}
      {props.action && (
        <Pressable onPress={props.action.onPress} hitSlop={8}
          style={{ marginLeft: 12, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9, backgroundColor: C.ink }}>
          <Text style={{ color: '#fff', fontFamily: F.bodySemi, fontSize: 13 }}>{props.action.label}</Text>
        </Pressable>
      )}
    </View>
  );
}

/** A tappable navigation row with a chevron — for links out (mailto, web). */
function LinkRow(props: { title: string; onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress}
      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingVertical: 12, minHeight: 44 }}>
      <Text style={{ fontFamily: F.bodySemi, fontSize: 15, color: C.ink }}>{props.title}</Text>
      <Text style={{ fontSize: 20, color: C.steel }}>›</Text>
    </Pressable>
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
  // minHeight meets the 44pt touch floor for gloves-on selection (CLAUDE.md mandate #3).
  borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
  minHeight: 44, justifyContent: 'center',
} as const;
const chipOn = { backgroundColor: C.ink, borderColor: C.ink } as const;
const chipT = { fontFamily: F.bodySemi, fontSize: 13.5, color: C.steel } as const;
const chipTOn = { color: '#fff' } as const;
const saveBtn = {
  marginTop: 16, minHeight: 50, borderRadius: 12, backgroundColor: C.orange,
  alignItems: 'center', justifyContent: 'center',
} as const;
const saveBtnT = { fontFamily: F.dispSemi, fontSize: 16, color: '#fff', letterSpacing: 0.5 } as const;
