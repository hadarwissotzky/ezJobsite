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
import { Alert, Image, Linking, Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native';
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';
import type { SupabaseClient } from '@supabase/supabase-js';
import { t } from '../i18n';
import type { Lang } from '../i18n';
import { registerPushToken } from '../push';
import { checkMembers, type QuotaKind } from '../quota';
import { LockCrown } from './usagecard';
import { Icon } from './icon';
import { QuotaModal } from './quotamodal';
import { C, F, T as TH, label } from './theme';
import { TRADES, type Profile } from '../profile';
import {
  resolveMyCompany, listMembers, createInvite, acceptInvite, revokeMember,
  type MyCompany, type Member,
} from '../company';
import { cacheLetterhead, readLetterhead, saveLetterhead, type Letterhead } from '../letterhead';
// What the company has paid for. Owner-only, and the OWNER CHECK IS ON THE SERVER — see
// billinghistory.ts; nothing here decides entitlement.
import { billingHistory, invoiceAmount, isRefunded, receiptUrlFor,
         type BillingHistory, type Invoice } from '../billinghistory';

export function SettingsScreen(props: {
  db: AbstractPowerSyncDatabase;
  supabase: SupabaseClient;
  userId: string;
  profile: Profile;
  lang: Lang;
  /** 'profile' = personal (name, trade, language, notifications, join a company).
   *  'company' = company settings (team, plan) — the caller only opens this for the
   *  company OWNER; the drawer hides the entry point for everyone else. */
  mode: 'profile' | 'company';
  confirmBase: string;
  /** The company logo as a LOCAL file path, or null. Drawn in the letterhead card so
   *  the contractor sees what a client sees. */
  logoUri?: string | null;
  /** Opens the caller's logo sheet (App.tsx owns the picker and the upload). Omitted
   *  = the logo tile is not pressable, which is right for a non-owner. */
  onLogoPress?: () => void;
  onSaveProfile: (p: Profile) => Promise<void>;
  onSetLang: (l: Lang) => Promise<void>;
  onOpenPlans: () => void;
  onBack: () => void;
}) {
  const { db, supabase, userId } = props;
  const [name, setName] = React.useState(props.profile.name);
  const [isSolo, setIsSolo] = React.useState(props.profile.isSolo);
  /** Read-only now: the Company screen owns this field. Kept in state so `save` can
   *  write back what was loaded rather than blanking it — see the note in `save`. */
  const [company] = React.useState(props.profile.company ?? '');
  const [trade, setTrade] = React.useState<string | null>(props.profile.trade);
  const [lang, setLang] = React.useState<Lang>(props.lang);
  const [saved, setSaved] = React.useState(false);

  const [co, setCo] = React.useState<MyCompany | null>(null);
  /**
   * Billing. `null` = NOT ASKED YET, which is a third state and must not render as
   * "no invoices" — see billinghistory.ts on why an unreadable history and an empty one
   * are different answers on the one screen where being wrong about money is
   * unforgivable.
   */
  const [billing, setBilling] = React.useState<BillingHistory | null>(null);
  const [billingBusy, setBillingBusy] = React.useState(false);
  const [members, setMembers] = React.useState<Member[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [joinToken, setJoinToken] = React.useState('');
  const [note, setNote] = React.useState<string | null>(null);
  const [quotaHit, setQuotaHit] = React.useState<{ kind: QuotaKind; limit: number } | null>(null);

  /**
   * THE LETTERHEAD — what a client sees at the top of every change order.
   *
   * Read through an RPC, not from the local `company` table, which does not sync to
   * the device (`letterhead.ts` explains why). `null` means "not read yet" and is
   * kept distinct from "read, and empty": drawing empty inputs over a saved address
   * and then saving them back is how a contractor silently loses his own letterhead.
   */
  const [lh, setLh] = React.useState<Letterhead | null>(null);
  const [lhName, setLhName] = React.useState('');
  const [lhAddress, setLhAddress] = React.useState('');
  const [lhLicense, setLhLicense] = React.useState('');
  const [lhSaved, setLhSaved] = React.useState(false);
  const [lhErr, setLhErr] = React.useState<string | null>(null);

  // Notification permission is an OS truth, not ours to fake. We reflect it and offer
  // to request+register; we never claim "on" when the OS says otherwise.
  const [notif, setNotif] = React.useState<'unknown' | 'granted' | 'denied' | 'undetermined'>('unknown');

  const loadTeam = React.useCallback(async () => {
    try {
      // The RESOLVER, not `myCompany`: the local tables are empty on a device whose
      // sync rules have never been deployed, and this screen would then show a
      // contractor no company at all while the server holds his.
      const c = await resolveMyCompany(db, supabase, userId);
      setCo(c);
      if (c) setMembers(await listMembers(db, c.id, userId));
      // The letterhead comes from the SERVER even when `myCompany` found a row —
      // the local table carries the name and none of the letterhead columns.
      if (c) {
        const r = await readLetterhead(supabase, c.id);
        if (r.ok) {
          setLh(r.letterhead);
          setLhName(r.letterhead.name);
          setLhAddress(r.letterhead.address ?? '');
          setLhLicense(r.letterhead.license ?? '');
          // KEEP A COPY FOR THE DOCUMENT. The exported change order prints this
          // letterhead and must do it with no signal — see `cachedLetterhead`. Cached on
          // every successful read rather than only on save, so a letterhead set on
          // another device reaches this one's PDFs the first time the screen is opened.
          void cacheLetterhead(db, r.letterhead);
        } else {
          // Said out loud rather than shown as blank fields. A contractor who cannot
          // reach the server must not be invited to type over what he cannot see.
          setLhErr(r.reason);
        }
      }
    } catch { /* tables may not have synced yet */ }
  }, [db, userId]);

  /** Fetched on demand rather than on mount: it is a network round-trip to a third
   *  party, and most opens of this screen are for the roster or the letterhead. */
  const loadBilling = React.useCallback(async () => {
    setBillingBusy(true);
    setBilling(await billingHistory(supabase));
    setBillingBusy(false);
  }, [supabase]);

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
      name: name.trim(), isSolo,
      // PRESERVED, never re-derived. This screen no longer EDITS the company name, but
      // it still saves the profile — and writing null here would silently erase a name
      // that `ensureBillingTenant` and the SMS sender still read. Solo clears it, which
      // is a real statement ("I do not have one"), not a side effect.
      company: isSolo ? null : company.trim(), trade,
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

  // Whether another seat is included in this plan. Read from the SAME check the tap
  // performs, so a crowned button always refuses and an uncrowned one always works.
  const [seatsLocked, setSeatsLocked] = React.useState(false);
  React.useEffect(() => {
    if (!co) { setSeatsLocked(false); return; }
    let live = true;
    checkMembers(db, co.id)
      .then((q) => { if (live) setSeatsLocked(!q.ok); })
      .catch(() => { if (live) setSeatsLocked(false); });   // unknown -> do not crown
    return () => { live = false; };
  }, [db, co]);

  const invite = async () => {
    if (!co) return;
    // FREE-TIER members cap (hadar 2026-07-25): stop before inviting past the limit.
    const q = await checkMembers(db, co.id);
    if (!q.ok) { setQuotaHit({ kind: 'members', limit: q.limit }); return; }
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

  const roleLabel = (r: string) => t(('set.role.' + r) as any);
  const initials = (name.trim() || props.profile.name || '?')
    .split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
  const identityLine = isSolo
    ? t('set.solo')
    // Empty-state PROMPT, not a fake company literally named "Company" (review 2026-07-25).
    : (company.trim() || props.profile.company || t('set.addCompany'));

  return (
    /**
     * THE KEYBOARD COVERED THE FIELD (hadar, 2026-08-25: "in your profile section, join
     * a company — when I click on the field the field is blocked by keyboard").
     *
     * This screen is a bare ScrollView and had never been told about the keyboard, so
     * iOS drew it over the bottom of the page. "Join a company" sits well down the
     * profile, past identity and the company card, which put it squarely under the
     * keys — a crew member joining by code could not see what he was typing.
     *
     * `automaticallyAdjustKeyboardInsets` is the right tool for a SCROLLING FORM, and a
     * different one from the fix threadscreen.tsx got an hour ago. There, the composer
     * is pinned outside the scroll and the container itself has to shrink, which is
     * what KeyboardAvoidingView does. Here every field is inside the scroll, so the
     * content just needs insetting and iOS brings the focused field into view by
     * itself. Wrapping this in a KeyboardAvoidingView would fight the scroll instead.
     *
     * `keyboardShouldPersistTaps="handled"` so the first tap on Join still lands while
     * the keyboard is up, rather than being spent dismissing it — the field and its
     * button sit on the same row, and one wasted tap on a two-tap job is most of it.
     */
    <ScrollView style={{ flex: 1, backgroundColor: '#fff' }}
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      contentContainerStyle={{ padding: 16, paddingTop: 56, paddingBottom: 48 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
        <Pressable onPress={props.onBack} hitSlop={12} style={{ paddingRight: 12 }}>
          <Text style={{ fontSize: 26, color: C.ink }}>‹</Text>
        </Pressable>
        <Text style={{ fontFamily: F.dispSemi, fontSize: 24, color: C.ink }}>
          {props.mode !== 'company' ? t('set.profile')
            : members.length > 1 ? t('set.companyTitle') : t('set.businessTitle')}
        </Text>
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

      {/* ---- Profile (personal) ---- profile mode only */}
      {props.mode === 'profile' && (
      <View style={{ ...TH.card, marginTop: 14 }}>
        <Text style={label}>{t('set.profile')}</Text>
        <TextInput style={inputStyle} value={name} onChangeText={setName}
          placeholder={t('fr.yourName')} placeholderTextColor="#8c959f" />
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          <Toggle on={isSolo} onPress={() => setIsSolo(true)} label={t('fr.solo')} />
          <Toggle on={!isSolo} onPress={() => setIsSolo(false)} label={t('fr.company')} />
        </View>
        {/* THE COMPANY-NAME FOLLOW-UP IS GONE (hadar, 2026-08-18).
            
            It asked the same question the Company screen asks, and the two wrote to
            DIFFERENT stores: this one to `profile_company` in device_settings, the
            other through `save_company_letterhead_v1` to `company.name` on the server.
            The second is the authoritative one — it is what `confirmation_company_v1`
            prints at the top of every change order a homeowner opens — so a contractor
            who renamed his company here saw the old name on the document he sent, with
            nothing on either screen explaining why.
            
            One field, one owner. The toggle stays because it still means something
            (it gates the roster and the team surfaces); only the duplicate input goes,
            and a pointer replaces it so the answer is DIRECTED rather than merely
            missing — a user who does not think in software must not have to go
            looking. */}
        {!isSolo && (
          <Text style={{ ...TH.bodySteel, fontSize: 12.5, marginTop: 8, lineHeight: 18 }}>
            {t('set.companyLivesInCompany')}
          </Text>
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
      )}

      {/* ---- Company letterhead ---- company mode only.
          hadar, 2026-08-17: "the user needs to be able to add their logo, as part of
          the company section in the drawer menu where the user can add company name,
          logo, address, license (optional)."

          IT IS FIRST, ABOVE THE TEAM, because it is what the screen is named after and
          because it is the only part of this screen a CLIENT ever sees:
          `confirmation_company_v1` prints these three lines and the logo at the top of
          every change order. The team is internal; the letterhead is the company's
          face. */}
      {props.mode === 'company' && (
      <View style={{ ...TH.card, marginTop: 14 }}>
        <Text style={label}>{t('set.letterhead')}</Text>
        <Text style={{ ...TH.bodySteel, fontSize: 12.5, marginTop: 4 }}>
          {t('set.letterheadWhy')}
        </Text>

        {/* THE LOGO AND THE NAME, SIDE BY SIDE — the shape of the thing being edited,
            so he can see the letterhead rather than infer it from three text fields. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 14 }}>
          <Pressable
            onPress={props.onLogoPress}
            disabled={!props.onLogoPress}
            accessibilityRole={props.onLogoPress ? 'button' : undefined}
            accessibilityLabel={t(props.logoUri ? 'logo.change' : 'logo.add')}
            style={{
              width: 72, height: 72, borderRadius: 10, borderWidth: 1,
              borderColor: C.line, backgroundColor: C.surfaceMuted,
              alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
            }}>
            {props.logoUri
              ? <Image source={{ uri: props.logoUri }} style={{ width: '100%', height: '100%' }}
                       resizeMode="contain" />
              : <Icon name="image" size={24} color={C.muted} />}
          </Pressable>
          <View style={{ flex: 1 }}>
            {/* The affordance is SPELLED OUT, not left to a tap-the-picture guess —
                CLAUDE.md §1: a hidden gesture may as well not exist for someone who
                does not think in software. */}
            {!!props.onLogoPress && (
              <Pressable onPress={props.onLogoPress} accessibilityRole="button"
                style={{ minHeight: 44, justifyContent: 'center' }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 14.5, color: C.brand }}>
                  {t(props.logoUri ? 'logo.change' : 'logo.add')}
                </Text>
              </Pressable>
            )}
            <Text style={{ ...TH.bodySteel, fontSize: 12 }}>{t('logo.note')}</Text>
          </View>
        </View>

        {/* Could not be read: say so instead of drawing empty fields over a saved
            letterhead he would then overwrite with blanks. */}
        {lhErr !== null && lh === null ? (
          <Text style={{ ...TH.bodySteel, fontSize: 13, marginTop: 14, color: C.danger }}>
            {t('set.letterheadOffline')}
          </Text>
        ) : (
        <>
          <Text style={{ ...TH.bodySteel, fontSize: 12.5, marginTop: 16, marginBottom: 6 }}>
            {t('fr.companyName')}
          </Text>
          <TextInput style={inputStyle} value={lhName} onChangeText={setLhName}
            editable={lh?.isOwner !== false}
            placeholder={t('fr.companyName')} placeholderTextColor="#8c959f" />

          <Text style={{ ...TH.bodySteel, fontSize: 12.5, marginTop: 12, marginBottom: 6 }}>
            {t('set.companyAddress')}
          </Text>
          <TextInput style={{ ...inputStyle, minHeight: 64 }} value={lhAddress}
            onChangeText={setLhAddress} multiline
            editable={lh?.isOwner !== false}
            placeholder={t('set.companyAddressHint')} placeholderTextColor="#8c959f" />

          {/* OPTIONAL, and labelled so (hadar). An unlicensed handyman doing $800 of
              work is a real user; a required field would either stop him or teach him
              to type junk into a document a client relies on. */}
          <Text style={{ ...TH.bodySteel, fontSize: 12.5, marginTop: 12, marginBottom: 6 }}>
            {t('set.companyLicense')}
          </Text>
          <TextInput style={inputStyle} value={lhLicense} onChangeText={setLhLicense}
            editable={lh?.isOwner !== false}
            autoCapitalize="characters"
            placeholder={t('set.companyLicenseHint')} placeholderTextColor="#8c959f" />

          {lh?.isOwner === false ? (
            // A crew member sees the letterhead and cannot edit it — same bar the
            // server sets. A disabled Save with no explanation reads as broken.
            <Text style={{ ...TH.bodySteel, fontSize: 12.5, marginTop: 12 }}>
              {t('set.letterheadOwnerOnly')}
            </Text>
          ) : (
            <Pressable
              onPress={async () => {
                if (!co || busy) return;
                setBusy(true); setLhErr(null);
                const r = await saveLetterhead(supabase, {
                  companyId: co.id, name: lhName, address: lhAddress, license: lhLicense,
                });
                setBusy(false);
                if (!r.ok) { setLhErr(r.reason); return; }
                setLhSaved(true);
                setTimeout(() => setLhSaved(false), 1800);
                // Re-read rather than assume: the server trims, collapses blanks to
                // null, and refuses to blank the name. Echoing what we sent would show
                // him a letterhead the server does not actually hold.
                const back = await readLetterhead(supabase, co.id);
                if (back.ok) {
                  setLh(back.letterhead);
                  setLhName(back.letterhead.name);
                  setLhAddress(back.letterhead.address ?? '');
                  setLhLicense(back.letterhead.license ?? '');
                  // What the SERVER holds, not what he typed — the same reason this
                  // re-reads at all. Caching the echo would put a letterhead on his
                  // documents that the server would disagree with.
                  void cacheLetterhead(db, back.letterhead);
                }
              }}
              style={saveBtn}>
              <Text style={saveBtnT}>{lhSaved ? t('set.saved') : t('set.save')}</Text>
            </Pressable>
          )}
          {!!lhErr && lh !== null && (
            <Text style={{ ...TH.bodySteel, fontSize: 12.5, marginTop: 8, color: C.danger }}>
              {lhErr}
            </Text>
          )}
        </>
        )}
      </View>
      )}

      {/* ---- Team (members + invite) ---- company mode only. Managing the roster is
          a company setting; only the owner opens this screen. */}
      {props.mode === 'company' && (
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
                  <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: '#EFEBE3',
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
              <>
                {/* CROWNED WHEN THE SEAT IS NOT INCLUDED (Handoff's pattern, 2026-08-04).
                    The button is SHOWN, not hidden: hiding it teaches the owner nothing
                    and they never learn a bigger team is possible. Crowned, it is an
                    advertisement they can act on — and tapping still runs checkMembers,
                    so the modal explains the cap rather than the button lying about it. */}
                <Pressable onPress={invite} disabled={busy}
                  style={{ ...saveBtn, backgroundColor: C.ink, flexDirection: 'row', gap: 10 }}>
                  <Text style={saveBtnT}>{t('set.invite')}</Text>
                  {seatsLocked && <LockCrown size={16} />}
                </Pressable>
                {seatsLocked && (
                  <Text style={{ ...TH.bodySteel, fontSize: 12.5, marginTop: 6, textAlign: 'center' }}>
                    {t('set.seatsLocked')}
                  </Text>
                )}
              </>
            )}
          </>
        ) : (
          <Text style={{ ...TH.bodySteel, fontSize: 13, marginTop: 4 }}>{t('set.noCompany')}</Text>
        )}
        {note && <Text style={{ ...TH.bodySteel, fontSize: 12.5, marginTop: 10, color: C.inkSoft }}>{note}</Text>}
      </View>
      )}

      {/* ---- Join a company ---- profile mode: a crew member joins by code HERE, so
          joining is never locked behind the owner-only company screen. */}
      {props.mode === 'profile' && (
      <View style={{ ...TH.card, marginTop: 14 }}>
        <Text style={label}>{t('set.joinTitle')}</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
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
      )}

      {/* ---- Preferences ---- profile mode (notifications are personal). */}
      {props.mode === 'profile' && (
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
      )}

      {/* ---- Subscription ---- company mode only: the plan belongs to the company and
          only the owner (who is the only one this screen opens for) changes it. */}
      {props.mode === 'company' && (
      <View style={{ ...TH.card, marginTop: 14 }}>
        <Text style={label}>{t('set.plan')}</Text>
        <Row title={t('set.planName')} value={t('set.planPilot')} />
        <Text style={{ ...TH.bodySteel, fontSize: 12.5, marginTop: 8 }}>{t('set.planNote')}</Text>
        <Pressable onPress={props.onOpenPlans}
          style={{ ...saveBtn, backgroundColor: C.ink, marginTop: 12 }}>
          <Text style={saveBtnT}>{t('quota.seePlans')}</Text>
        </Pressable>
      </View>
      )}

      {/* ---- Billing ---- company mode, OWNER ONLY (hadar, 2026-08-18: "billing section
          for the one that owns the account — display all the invoices").

          BELOW the plan card on purpose: the plan is what you are on, this is what you
          were charged, and the second only makes sense after the first.

          THE OWNER CHECK IS THE SERVER'S. This renders whatever `billingHistory` returns
          and `not_owner` is one of the answers — a crew member is told it is the owner's
          screen rather than shown an empty list to misread. Gating the CARD on a local
          flag instead would be a client deciding who may see money. */}
      {props.mode === 'company' && (
      <View style={{ ...TH.card, marginTop: 14 }}>
        <Text style={label}>{t('set.billing')}</Text>

        {billing === null ? (
          // NOT ASKED YET — never "no invoices". The button is the ask.
          <>
            <Text style={{ ...TH.bodySteel, fontSize: 12.5, marginTop: 4 }}>
              {t('set.billingWhat')}
            </Text>
            <Pressable onPress={() => void loadBilling()} disabled={billingBusy}
              style={{ ...saveBtn, backgroundColor: C.ink, marginTop: 12 }}>
              <Text style={saveBtnT}>
                {billingBusy ? t('set.billingLoading') : t('set.billingShow')}
              </Text>
            </Pressable>
          </>
        ) : !billing.ok ? (
          <>
            <Text style={{ ...TH.bodySteel, fontSize: 13, marginTop: 4, lineHeight: 19 }}>
              {t(billing.reason === 'not_owner' ? 'set.billingOwnerOnly'
                : billing.reason === 'no_company' ? 'set.billingNoCompany'
                : 'set.billingUnavailable')}
            </Text>
            {/* Retry only where retrying could help. "Owner only" is not a transient
                failure and a Try again under it would be a lie. */}
            {billing.reason === 'unavailable' && (
              <Pressable onPress={() => void loadBilling()} disabled={billingBusy}
                style={{ ...saveBtn, backgroundColor: C.ink, marginTop: 12 }}>
                <Text style={saveBtnT}>
                  {billingBusy ? t('set.billingLoading') : t('set.billingRetry')}
                </Text>
              </Pressable>
            )}
          </>
        ) : billing.invoices.length === 0 ? (
          <Text style={{ ...TH.bodySteel, fontSize: 13, marginTop: 4, lineHeight: 19 }}>
            {t('set.billingNone')}
          </Text>
        ) : (
          <>
            {/* SAY SO WHEN THE LIST IS SHORT BY OUR OWN ADMISSION. Half a billing
                history rendered as the whole of it is the failure this screen cannot
                have. */}
            {billing.partial && (
              <Text style={{ ...TH.bodySteel, fontSize: 12.5, marginTop: 4,
                color: C.caution }}>
                {t('set.billingPartial')}
              </Text>
            )}
            {billing.invoices.map((iv: Invoice) => {
              const amount = invoiceAmount(iv);
              const url = receiptUrlFor(iv);
              const refunded = isRefunded(iv);
              return (
                <View key={iv.id} style={{ borderTopWidth: 1, borderTopColor: C.line,
                  paddingVertical: 11 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={{ fontFamily: F.bodySemi, fontSize: 15, color: C.ink,
                      flex: 1 }} numberOfLines={1}>
                      {iv.product}
                    </Text>
                    {/* No amount = NO LINE, never "$0.00" — see invoiceAmount. */}
                    {!!amount && (
                      <Text style={{ fontFamily: F.dispSemi, fontSize: 16,
                        color: refunded ? C.muted : C.ink,
                        textDecorationLine: refunded ? 'line-through' : 'none' }}>
                        {amount}
                      </Text>
                    )}
                  </View>
                  <Text style={{ ...TH.bodySteel, fontSize: 12.5, marginTop: 2 }}>
                    {[
                      iv.atMs ? new Date(iv.atMs).toLocaleDateString() : null,
                      t(iv.kind === 'subscription' ? 'set.billingSub' : 'set.billingPack'),
                      refunded ? t('set.billingRefunded') : null,
                    ].filter(Boolean).join(' · ')}
                  </Text>
                  {/* An App Store receipt is APPLE'S and lives in his Apple account. We
                      cannot render or email it, so this is a destination, not a
                      document. Web purchases already got a Stripe receipt by email. */}
                  {!!url && (
                    <Pressable onPress={() => void Linking.openURL(url).catch(() => {})}
                      style={{ marginTop: 6 }}>
                      <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.ink,
                        textDecorationLine: 'underline' }}>
                        {t('set.billingReceipt')}
                      </Text>
                    </Pressable>
                  )}
                </View>
              );
            })}
            <Pressable onPress={() => void loadBilling()} disabled={billingBusy}
              style={{ marginTop: 12, minHeight: 40, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: C.steel }}>
                {billingBusy ? t('set.billingLoading') : t('set.billingRefresh')}
              </Text>
            </Pressable>
          </>
        )}
      </View>
      )}

      {/* Support (Contact / Feedback) and About (version, Terms, Privacy, Sign out)
          moved OUT of this hub and into the left drawer (hadar, 2026-07-27). Profile
          holds identity + preferences + join-a-company; company Settings (owner-only)
          holds the team roster + plan. */}

      {quotaHit && (
        <QuotaModal kind={quotaHit.kind} limit={quotaHit.limit}
          onClose={() => setQuotaHit(null)}
          onSeePlans={() => { setQuotaHit(null); props.onOpenPlans(); }} />
      )}
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
