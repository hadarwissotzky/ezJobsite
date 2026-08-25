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
import { Alert, Image, Linking, Pressable, ScrollView, Share, StyleSheet, Text, TextInput,
         View } from 'react-native';
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';
import type { SupabaseClient } from '@supabase/supabase-js';
import { t } from '../i18n';
import type { Lang } from '../i18n';
import { registerPushToken } from '../push';
import { checkMembers, type QuotaKind } from '../quota';
import { LockCrown } from './usagecard';
import { Icon, type IconName } from './icon';
import { QuotaModal } from './quotamodal';
import { C, F, T as TH, label, tint } from './theme';
import { shadows } from './tokens';
import { BottomSheet } from './kit';
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
  /** Open the company screen — the artboard's "Open Company" pointer. Absent where the
   *  caller has no company screen to show (a solo account), and the card hides itself
   *  in that case anyway. */
  onOpenCompany?: () => void;
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

  /**
   * WHICH SHEET IS OPEN, and the text being typed into it.
   *
   * One sheet, one field. The screen behind stays exactly as it was, so a contractor
   * changing his trade never loses his place — the same reason the message sheet exists
   * on the record screen rather than a pane.
   */
  const [editing, setEditing] = React.useState<null | 'name' | 'work' | 'trade' | 'lang' | 'join'>(null);
  const [draft, setDraft] = React.useState('');

  /**
   * SAVE THE PROFILE AS IT CHANGES, taking the one field that moved.
   *
   * The Save button is gone with the form, so every choice commits itself. The
   * overrides are passed in rather than read from state because `setState` has not
   * landed by the time this runs — saving "the current state" here would save the
   * value BEFORE the tap, which is the classic version of this bug and silently writes
   * the wrong answer.
   */
  const commit = async (over: Partial<{ name: string; isSolo: boolean; trade: string | null }>) => {
    const next = {
      name: (over.name ?? name).trim(),
      isSolo: over.isSolo ?? isSolo,
      trade: 'trade' in over ? over.trade! : trade,
    };
    setName(next.name); setIsSolo(next.isSolo); setTrade(next.trade);
    await props.onSaveProfile({
      ...next,
      // Preserved, never re-derived — see `save` below for why writing null here would
      // erase a name other code still reads.
      company: next.isSolo ? null : company.trim(),
    });
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
    <>
    <ScrollView style={{ flex: 1, backgroundColor: C.paper }}
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

      {/* ---- Identity header ----
           NO CARD in profile mode (the artboard, 2026-08-25): the person is not one of
           the settings, they are who the settings are ABOUT, so they sit on the page
           and everything else sits on cards below. Company mode keeps its card — that
           screen is about the business, and the hero there is one item among several. */}
      {props.mode === 'profile' ? (
        <View style={ss.hero}>
          <View style={ss.heroAvatar}><Text style={ss.heroInitials}>{initials}</Text></View>
          <View style={{ flexGrow: 1, flexShrink: 1 }}>
            <Text style={ss.heroName} numberOfLines={2}>
              {name.trim() || props.profile.name || t('set.you')}
            </Text>
            <Text style={ss.heroSub} numberOfLines={2}>
              {identityLine}{co ? '  ·  ' + roleLabel(co.role) : ''}
            </Text>
          </View>
        </View>
      ) : (
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
      )}

      {/* ---- Profile (personal) ---- profile mode only */}
      {props.mode === 'profile' && (
      <>
        <SectionLabel>{t('set.secYou')}</SectionLabel>
        <RowCard>
          <ValueRow first label={t('fr.yourName')}
            value={name.trim() || props.profile.name}
            onPress={() => { setDraft(name); setEditing('name'); }} />
          <ValueRow label={t('set.howYouWork')}
            value={isSolo ? t('fr.solo') : t('fr.company')}
            onPress={() => setEditing('work')} />
          <ValueRow label={t('set.trade')}
            value={trade ? t(('trade.' + trade) as any) : t('set.notSet')}
            onPress={() => setEditing('trade')} />
        </RowCard>
        {/* IT SAVES ON CHANGE, and says so. The Save button is gone: on a list of four
            facts about yourself, a Save button is a way to lose a change by walking
            away. Mandate #7 earns the second sentence — none of this needs signal. */}
        <View style={ss.savedNote}>
          <Icon name={'ntCheck' as IconName} size={14} color={C.muted} />
          <Text style={ss.savedNoteT}>{t('set.savedAsYouGo')}</Text>
        </View>

        <SectionLabel>{t('set.secApp')}</SectionLabel>
        <RowCard>
          <ValueRow first icon={'ntChat' as IconName} label={t('set.language')}
            value={lang === 'es' ? 'Español' : 'English'}
            onPress={() => setEditing('lang')} />
          <ValueRow icon={'ntAttention' as IconName} label={t('set.notif')}
            /* A PILL WHEN IT IS ON, A TAP WHEN IT IS NOT. Granted is a state and there
               is nothing to do about it here; every other value is a thing he can act
               on, so it keeps the chevron and the action it already had. */
            right={notif === 'granted' ? (
              <View style={ss.pill}>
                <Icon name={'ntCheck' as IconName} size={13} color={tint('approved').ink} />
                <Text style={ss.pillT}>{t('set.notifOn')}</Text>
              </View>
            ) : undefined}
            value={notif === 'granted' ? undefined
              : notif === 'denied' ? t('set.notifDenied')
              : notif === 'unknown' ? t('set.notifUnknown') : t('set.notifOff')}
            onPress={notif === 'granted' ? undefined
              // 'undetermined' -> the in-app request still works. 'denied' or
              // 'unknown' -> asking would no-op, so route to the OS Settings app where
              // it can actually be changed (the same split the old Row made).
              : notif === 'undetermined' ? enableNotif
              : () => { Linking.openSettings().catch(() => {}); }} />
        </RowCard>
      </>
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
      <>
        {/* ---- Your company: a POINTER, not an editor ----
             The letterhead lives on the Company screen and is written by
             `save_company_letterhead_v1`; duplicating any of it here is how a
             contractor renames his company in one place and watches the old name print
             on the document he just sent (the reason the name field was removed on
             2026-08-18). So this card states what is there and shows the way. */}
        {co && (
          <>
            <SectionLabel>{t('set.secCompany')}</SectionLabel>
            <View style={[ss.card, { paddingVertical: 14 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={ss.coTile}>
                  {props.logoUri
                    ? <Image source={{ uri: props.logoUri }} style={{ width: 36, height: 36 }} resizeMode="cover" />
                    : <Icon name={'ntCompany' as IconName} size={18} color={C.muted} />}
                </View>
                <Text style={ss.coName} numberOfLines={1}>{co.name || t('set.businessTitle')}</Text>
                <Text style={ss.coRole}>{roleLabel(co.role)}</Text>
              </View>
              <Text style={ss.coWhy}>{t('set.companyWhy')}</Text>
              <Pressable onPress={() => props.onOpenCompany?.()} accessibilityRole="button"
                style={({ pressed }) => [ss.coOpen, pressed ? { opacity: 0.6 } : null]}>
                <Text style={ss.coOpenT}>{t('set.openCompany')}</Text>
                <Icon name={'chevRight' as IconName} size={18} color={C.brand} />
              </Pressable>
            </View>
          </>
        )}

        {/* ---- Join a company ----
             DASHED, because it is an invitation rather than a setting: nothing is
             stored here until a code is typed, and a solid card would claim otherwise.
             It opens a SHEET, which also puts the field above the keyboard instead of
             under it — the bug hadar hit on this screen earlier today. */}
        <Pressable onPress={() => { setJoinToken(''); setNote(null); setEditing('join'); }}
          accessibilityRole="button"
          style={({ pressed }) => [ss.joinRow, pressed ? { opacity: 0.6 } : null]}>
          <Icon name={'ntProfile' as IconName} size={20} color={C.steel} />
          <Text style={ss.joinT}>{t('set.joinTitle')}</Text>
          <Icon name={'chevRight' as IconName} size={18} color={C.muted} />
        </Pressable>
        {!!note && <Text style={{ ...TH.bodySteel, fontSize: 12.5, marginTop: 10, color: C.inkSoft }}>{note}</Text>}
      </>
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

    {/* ── The edit sheets ────────────────────────────────────────────────────────
        ONE FIELD PER SHEET, and the screen behind it does not move. Every choice
        commits itself and closes: there is no Save here either, and a sheet that
        asked twice would reintroduce the button the list just removed. */}
    <BottomSheet visible={editing === 'name'} title={t('fr.yourName')}
      onClose={() => setEditing(null)}
      footer={
        <Pressable onPress={async () => { await commit({ name: draft }); setEditing(null); }}
          style={saveBtn} accessibilityRole="button">
          <Text style={saveBtnT}>{t('set.save')}</Text>
        </Pressable>}>
      {/* The one sheet that KEEPS a button: text has no moment of choosing, so
          something has to say "I am finished typing". */}
      <TextInput style={inputStyle} value={draft} onChangeText={setDraft} autoFocus
        placeholder={t('fr.yourName')} placeholderTextColor="#8c959f"
        returnKeyType="done"
        onSubmitEditing={async () => { await commit({ name: draft }); setEditing(null); }} />
    </BottomSheet>

    <BottomSheet visible={editing === 'work'} title={t('set.howYouWork')}
      onClose={() => setEditing(null)}>
      <View style={ss.sheetPad}>
        <ChoiceRow first label={t('fr.solo')} on={isSolo}
          onPress={async () => { await commit({ isSolo: true }); setEditing(null); }} />
        <ChoiceRow label={t('fr.company')} on={!isSolo}
          onPress={async () => { await commit({ isSolo: false }); setEditing(null); }} />
      </View>
    </BottomSheet>

    <BottomSheet visible={editing === 'trade'} tall title={t('set.trade')}
      onClose={() => setEditing(null)}>
      <View style={ss.sheetPad}>
        {TRADES.map((tr, i) => (
          <ChoiceRow key={tr} first={i === 0} label={t(('trade.' + tr) as any)}
            on={trade === tr}
            /* Tapping the current trade CLEARS it. Trade is skippable by design, and a
               list with no way back out would trap someone who picked wrong. */
            onPress={async () => { await commit({ trade: trade === tr ? null : tr }); setEditing(null); }} />
        ))}
      </View>
    </BottomSheet>

    <BottomSheet visible={editing === 'lang'} title={t('set.language')}
      onClose={() => setEditing(null)}>
      <View style={ss.sheetPad}>
        <ChoiceRow first label="English" on={lang === 'en'}
          onPress={async () => { setLang('en'); await props.onSetLang('en'); setEditing(null); }} />
        <ChoiceRow label="Español" on={lang === 'es'}
          onPress={async () => { setLang('es'); await props.onSetLang('es'); setEditing(null); }} />
      </View>
    </BottomSheet>

    <BottomSheet visible={editing === 'join'} title={t('set.joinTitle')}
      onClose={() => setEditing(null)}
      footer={
        <Pressable onPress={async () => { await join(); setEditing(null); }}
          disabled={busy || !joinToken.trim()}
          style={[saveBtn, { opacity: joinToken.trim() && !busy ? 1 : 0.4 }]}
          accessibilityRole="button">
          <Text style={saveBtnT}>{t('set.joinBtn')}</Text>
        </Pressable>}>
      {/* In a sheet, so the field sits ABOVE the keyboard. On the page it sat under it
          — hadar hit exactly that on this screen earlier today. */}
      <TextInput style={inputStyle} value={joinToken} onChangeText={setJoinToken}
        autoCapitalize="none" autoFocus
        placeholder={t('set.joinPlaceholder')} placeholderTextColor="#8c959f" />
      {!!note && <Text style={{ ...TH.bodySteel, fontSize: 12.5, marginTop: 10 }}>{note}</Text>}
    </BottomSheet>
    </>
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

/* ── The profile screen's design language (hadar's artboard, 2026-08-25) ───────────
 *
 * The screen it replaces was a FORM: a name field, two toggle pairs, a row of trade
 * chips and a Save button, all on one card. Everything was editable at once and nothing
 * was legible at a glance — a contractor opening it to check which trade he was under
 * had to read a form to find out.
 *
 * The artboard is a LIST OF ANSWERS. Each row states a question and its current answer;
 * tapping one opens a sheet to change it. That reads at arm's length, it survives a
 * value getting longer, and it matches every other list in this app.
 *
 * AND IT SAVES ON CHANGE. The Save button is gone, which the design says out loud
 * underneath the card: "Saved as you change it. Works with no signal." A Save button on
 * a settings list is a way to lose a change by walking away, and this is the one screen
 * whose whole content is four facts about the person using it.
 */

/** A section heading — condensed small-caps, the artboard's 12/1.6 treatment. */
function SectionLabel({ children }: { children: string }) {
  return <Text style={ss.sectionLabel}>{children}</Text>;
}

/** The card the rows sit on. Rows separate themselves with hairlines. */
function RowCard({ children }: { children: React.ReactNode }) {
  return <View style={ss.card}>{children}</View>;
}

/**
 * One question and its answer. `onPress` makes it tappable and draws the chevron;
 * without it the row is a statement (the notifications pill uses `right` instead).
 */
function ValueRow({ icon, label: lab, value, right, onPress, first }: {
  icon?: IconName; label: string; value?: string;
  right?: React.ReactNode; onPress?: () => void; first?: boolean;
}) {
  const Body = (
    <View style={ss.row}>
      {icon && <Icon name={icon} size={20} color={C.steel} />}
      <Text style={ss.rowLabel} numberOfLines={1}>{lab}</Text>
      {right ?? (
        <>
          {/* The VALUE gives way, never the label: a long trade name may wrap or
              ellipsize, but "Trade" must stay readable or the row says nothing. */}
          {!!value && <Text style={ss.rowValue} numberOfLines={1}>{value}</Text>}
          {onPress && <Icon name={'chevRight' as IconName} size={18} color={C.muted} />}
        </>
      )}
    </View>
  );
  return (
    <>
      {!first && <View style={ss.hair} />}
      {onPress
        ? <Pressable onPress={onPress} accessibilityRole="button"
            accessibilityLabel={value ? `${lab}, ${value}` : lab}
            style={({ pressed }) => pressed ? { opacity: 0.6 } : null}>{Body}</Pressable>
        : Body}
    </>
  );
}

/** One choice inside an edit sheet. The current answer carries the tick. */
function ChoiceRow({ label: lab, on, onPress, first }: {
  label: string; on: boolean; onPress: () => void; first?: boolean;
}) {
  return (
    <>
      {!first && <View style={ss.hair} />}
      <Pressable onPress={onPress} accessibilityRole="button"
        accessibilityState={{ selected: on }}
        style={({ pressed }) => [ss.row, pressed ? { opacity: 0.6 } : null]}>
        <Text style={[ss.rowLabel, { flexGrow: 1 }]}>{lab}</Text>
        {on && <Icon name={'ntCheck' as IconName} size={18} color={C.brand} />}
      </Pressable>
    </>
  );
}

const ss = StyleSheet.create({
  sectionLabel: {
    fontFamily: F.dispSemi, fontSize: 12, color: C.steel,
    textTransform: 'uppercase', letterSpacing: 1.6, marginTop: 24, marginBottom: 8,
  },
  card: {
    backgroundColor: C.raised, borderWidth: 1, borderColor: C.line,
    borderRadius: 18, paddingHorizontal: 14, ...shadows.card,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 58, paddingVertical: 12 },
  rowLabel: { flexGrow: 1, flexShrink: 1, fontFamily: F.bodySemi, fontSize: 15.5, color: C.ink },
  rowValue: { flexShrink: 1, fontFamily: F.body, fontSize: 15, color: C.steel },
  hair: { height: 1, backgroundColor: C.line },
  // The reassurance under the You card. It replaces a Save button, so it has to be
  // believed: the tick is what makes it read as a statement of fact rather than a hope.
  savedNote: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, paddingLeft: 2 },
  savedNoteT: { fontFamily: F.body, fontSize: 12.5, color: C.muted },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 24, marginTop: 4 },
  heroAvatar: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: C.ink,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  heroInitials: { fontFamily: F.dispSemi, fontSize: 24, color: '#fff' },
  heroName: { fontFamily: F.bodyBold, fontSize: 24, letterSpacing: -0.2, color: C.ink, lineHeight: 28 },
  heroSub: { fontFamily: F.body, fontSize: 14.5, color: C.steel, lineHeight: 20, marginTop: 2 },
  // The company pointer: a tile, the name, and the role as a quiet chip.
  coTile: {
    width: 36, height: 36, borderRadius: 8, backgroundColor: C.surfaceMuted,
    borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, overflow: 'hidden',
  },
  coName: { flexGrow: 1, fontFamily: F.bodySemi, fontSize: 16, color: C.ink },
  coRole: {
    backgroundColor: C.surfaceMuted, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 4,
    fontFamily: F.dispSemi, fontSize: 11, textTransform: 'uppercase',
    letterSpacing: 0.6, color: C.steel,
  },
  coWhy: { fontFamily: F.body, fontSize: 13, color: C.steel, lineHeight: 19, marginTop: 10 },
  coOpen: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, minHeight: 44 },
  coOpenT: { fontFamily: F.bodySemi, fontSize: 15, color: C.brand },
  // Dashed, because it is an invitation rather than a setting: nothing is stored here
  // until a code is typed, and a solid card would claim otherwise.
  joinRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 20, minHeight: 52,
    borderWidth: 1, borderStyle: 'dashed', borderColor: C.line, borderRadius: 14,
    paddingHorizontal: 14,
  },
  joinT: { flexGrow: 1, fontFamily: F.bodySemi, fontSize: 15, color: C.steel },
  // The notifications pill — a state, not a control, when it is already on.
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 4,
    backgroundColor: tint('approved').soft, borderWidth: 1, borderColor: tint('approved').line,
  },
  pillT: { fontFamily: F.bodySemi, fontSize: 12.5, color: tint('approved').ink },
  sheetPad: { paddingBottom: 8 },
});

const inputStyle = {
  marginTop: 10, borderWidth: 1, borderColor: C.line, borderRadius: 10,
  paddingHorizontal: 12, paddingVertical: 12, fontFamily: F.body, fontSize: 15.5, color: C.ink,
} as const;
const saveBtn = {
  marginTop: 16, minHeight: 50, borderRadius: 12, backgroundColor: C.orange,
  alignItems: 'center', justifyContent: 'center',
} as const;
const saveBtnT = { fontFamily: F.dispSemi, fontSize: 16, color: '#fff', letterSpacing: 0.5 } as const;
