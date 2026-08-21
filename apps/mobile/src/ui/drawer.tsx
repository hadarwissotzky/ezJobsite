/**
 * The left navigation drawer — the ☰ menu (hadar, 2026-07-27; restyled 2026-08-04).
 *
 * WHAT IT REPLACES: the ☰ used to open a centred card that LISTED YOUR JOBS — wrong
 * twice over. Jobs have their own bottom-nav destination, so the menu duplicated them;
 * and a centred card is not what a hamburger promises. This slides in from the left.
 *
 * THE 2026-08-04 RESTYLE (hadar, from Handoff screenshots: "streamline the drawer like
 * these examples"). Rows used to be a flat list with mixed weights — big icon-disc rows
 * for nav, lighter rows for support, a bordered plan box, a separate usage card — five
 * visual treatments down one panel. They are now ONE treatment: an uppercase group
 * label outside a white card, rows inside it separated by inset hairlines, chevron
 * right. The eye learns the pattern once and every later row is free to read.
 *
 * WHY INSET DIVIDERS. The hairline starts at the label's x, not the card's edge, so it
 * reads as "these rows belong together" rather than as a table grid. It is the detail
 * that makes a grouped list look native rather than drawn.
 *
 * WHAT IS DELIBERATELY NOT COPIED from the reference: their crown density (see
 * usagecard.tsx's LockCrown header), the referral card, and a DANGER ZONE group — we
 * have no destructive account action, and inventing a section to hold Sign out would
 * misrepresent signing out as dangerous when it is routine and reversible.
 */
import React from 'react';
import { Alert, Animated, Easing, Image, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { LockCrown } from './usagecard';
import { C, F } from './theme';
import { radii, shadows } from './tokens';
import { Icon, type IconName } from './icon';
import { t as T } from '../i18n';
import type { Lang } from '../i18n';
import type { UsageItem, UsageSummary } from '../usage';

const SUPPORT_EMAIL = 'support@ezchangeorders.com';

export function Drawer({
  visible, onClose, onProfile, onCompanySettings, onPlans,
  planName, isFreePlan, isOwner, hasTeam,
  lang, onToggleLang, appVersion, confirmBase, onSignOut, unsent, account,
  onShowIntro, onSimulateFirstRun,
  devTools,
  companies, activeCompanyId, onSwitchCompany, onCloseAccount,
  buildLabel, updateReady, onApplyUpdate, onCheckUpdates, usage,
  logoUri, companyName, canEditLogo, onLogoPress,
}: {
  visible: boolean;
  onClose: () => void;
  onProfile: () => void;
  /** Opens the owner-only company Settings. Only rendered when isOwner. */
  onCompanySettings: () => void;
  onPlans: () => void;
  planName: string;
  isFreePlan: boolean;
  /** This user created/owns the company: gates the Upgrade CTA and the Settings row. */
  isOwner: boolean;
  /** True only when there is somebody ELSE in the tenant. Names the row — a solo
   *  operator gets "Your business", a crew gets "Company settings". Same screen. */
  hasTeam?: boolean;
  lang: Lang;
  onToggleLang: () => void;
  appVersion: string;
  /** Plan + what is left of each metered cap. Null until the first read completes. */
  usage?: UsageSummary | null;
  /** From `buildLine()` — native version PLUS the running update id (REQ-OTA5). */
  buildLabel?: string;
  /** An update is downloaded AND nothing is in flight (REQ-OTA2). */
  updateReady?: boolean;
  onApplyUpdate?: () => void;
  /** Manual "check for updates". Resolves with what happened so the row can say so. */
  onCheckUpdates?: () => Promise<'downloaded' | 'none' | 'error'>;
  confirmBase: string;
  onSignOut: () => Promise<void>;
  /** Rows still queued in every owned outbox plus any open capture draft — what a
   *  handover to another account would destroy. Null when it could not be counted. */
  unsent?: number | null;
  /** The signed-in identity, already formatted — a grouped phone number or an email.
   *  Null only before the session lands. See the note where it renders. */
  account?: string | null;
  /** DEV ONLY: re-render the first-open intro over the current screen. */
  /**
   * Show the developer-only rows. `__DEV__` OR a user flagged in `developer_user` (417) —
   * the caller ORs them, because a debug build keeps its tools whether or not anyone is
   * signed in, and a flagged user keeps them in a release build.
   *
   * VISIBILITY ONLY. Everything behind it is something this user could already do to his
   * own data; it must never gate access to anyone else's.
   */
  devTools?: boolean;
  onShowIntro?: () => void;
  /** DEV ONLY: clear the seen-flags and sign out, to replay the whole first-run path. */
  onSimulateFirstRun?: () => void;
  /** Every tenant this person belongs to. One entry (or none) hides the switcher. */
  companies?: { id: string; name: string; isOwner: boolean }[];
  activeCompanyId?: string | null;
  onSwitchCompany?: (companyId: string) => void;
  /** Opens the close-account confirmation. */
  onCloseAccount?: () => void;
  /** A local file:// URI for the company logo, or null to draw the EZ wordmark. */
  logoUri?: string | null;
  /** The company's name for the panel header. Null falls back to the product name. */
  companyName?: string | null;
  /** Owner-only: shows the add/change affordance. The writer refuses non-owners. */
  canEditLogo?: boolean;
  /** Opens the caller's logo sheet. Omitted = the header is not pressable. */
  onLogoPress?: () => void;
}) {
  const { width } = useWindowDimensions();
  const panelW = Math.min(340, Math.round(width * 0.86));
  const [checking, setChecking] = React.useState(false);
  const [checkNote, setCheckNote] = React.useState<string | null>(null);

  // Keep the Modal mounted through the CLOSE animation: RN unmounts the instant
  // `visible` goes false, which would snap the panel away with no slide.
  const [mounted, setMounted] = React.useState(visible);
  const slide = React.useRef(new Animated.Value(0)).current;
  // An action to run once this panel has FULLY closed. See `go` below.
  const pending = React.useRef<null | (() => void)>(null);

  React.useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(slide, {
        toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }).start();
    } else if (mounted) {
      Animated.timing(slide, {
        toValue: 0, duration: 180, easing: Easing.in(Easing.cubic), useNativeDriver: true,
      }).start(({ finished }) => {
        if (!finished) return;
        setMounted(false);
        // NOW run whatever the tapped row wanted. iOS refuses to present a modal while
        // another is still dismissing, so firing this alongside onClose() meant every
        // row that opens a Modal — Upgrade, and any future one — closed the drawer and
        // did nothing visible. The bug reads as "the button is dead", which is why it
        // is worth the ref rather than a setTimeout guess at the animation length.
        const fn = pending.current;
        pending.current = null;
        fn?.();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!mounted) return null;

  // Close first, act after. Anything that opens a Modal MUST go through this.
  const go = (fn: () => void) => () => { pending.current = fn; onClose(); };
  const mailTo = (subject: string) =>
    Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`).catch(() => {});
  const openLegal = (path: string) =>
    Linking.openURL(`https://${confirmBase || 'ezchangeorders.com'}/${path}`).catch(() => {});
  /**
   * THE COUNT IS PART OF THE QUESTION, not a footnote.
   *
   * Signing out does not itself destroy anything — but the next account to sign in on
   * this phone wipes it (deviceowner.ts), and anything that never reached the cloud
   * goes with it. This is the last moment the person who owns that work is standing
   * in front of the app, so it is the only place the warning is worth anything.
   */
  const confirmSignOut = () =>
    Alert.alert(
      T('set.signOut'),
      unsent && unsent > 0
        ? `${T('set.signOutConfirm')}\n\n${T({ k: 'set.signOutUnsent', p: { n: String(unsent) } } as any)}`
        : T('set.signOutConfirm'),
      [
        { text: T('set.cancel'), style: 'cancel' },
        { text: T('set.signOut'), style: 'destructive', onPress: () => { onClose(); void onSignOut(); } },
      ]);

  const check = async () => {
    if (!onCheckUpdates || checking) return;
    setChecking(true); setCheckNote(null);
    const r = await onCheckUpdates();
    setChecking(false);
    // Say what happened. A check that spins and goes quiet teaches the user that the
    // button does nothing, which is worse than not having it.
    setCheckNote(T(r === 'downloaded' ? 'set.updateReady'
      : r === 'none' ? 'set.updateNone' : 'set.updateFailed'));
  };

  const usageLine = (it: UsageItem) =>
    it.remaining <= 0
      ? T(('usage.none.' + it.kind) as any)
      : T({ k: ('usage.left.' + it.kind) as any,
            p: { n: String(it.remaining), limit: String(it.limit) } } as any);

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <Animated.View style={[st.scrim, { opacity: slide }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={T('common.close')} />
      </Animated.View>

      <Animated.View
        style={[st.panel, {
          width: panelW,
          transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [-panelW, 0] }) }],
        }]}
      >
        {/* ── THE COMPANY'S OWN MARK ── (hadar 2026-08-12: "Add logo — add that to
            the drawer"). This block used to be the EZChangeOrders wordmark, i.e. the
            app telling the contractor what app he is in — which he knows. His own logo
            is the more useful thing in the same space, and it is not decoration: the
            SAME image goes on the letterhead of every change order his clients open
            (402), so this is where he can see what they will see.

            The wordmark is NOT gone — it is the fallback when no logo is set, so the
            panel is never headless. */}
        <Pressable style={st.brand} onPress={onLogoPress ? go(onLogoPress) : undefined}
          accessibilityRole="button"
          accessibilityLabel={T(logoUri ? 'logo.change' : 'logo.add')}>
          {logoUri ? (
            <Image source={{ uri: logoUri }} style={st.brandLogo} resizeMode="contain" />
          ) : (
            <View style={st.brandBox}><Text style={st.brandBoxT}>EZ</Text></View>
          )}
          <View style={{ flex: 1 }}>
            {/* The company's name when we know it, the product's when we do not. A solo
                operator who never named a company still gets a header, not a blank. */}
            <Text style={st.brandWord} numberOfLines={1}>
              {companyName || 'CHANGEORDERS'}
            </Text>
            {/* The affordance is SPELLED OUT rather than left to a tap-the-logo
                convention. The ICP does not go hunting for hidden controls (CLAUDE.md
                §1), and "Add logo" is also the only thing on this screen that tells him
                the feature exists at all. Owner only: it is the company's mark, and
                402's writer refuses a non-owner anyway — offering a control the server
                will refuse is the dead-button failure this app keeps paying for. */}
            {canEditLogo && (
              <Text style={st.brandAct}>{T(logoUri ? 'logo.change' : 'logo.add')}</Text>
            )}
          </View>
        </Pressable>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}
          showsVerticalScrollIndicator={false}>

          {/* ── YOUR PLAN ── first, because it is the account's headline and the one
              thing a user opens this menu to check. Usage lines sit INSIDE the group
              rather than in a separate card, so the panel has one rhythm. */}
          <Group label={T('usage.yourPlan')}>
            <Row
              label={planName}
              value={usage?.anyReached ? T('usage.upgrade') : T('usage.seePlans')}
              accent
              onPress={go(onPlans)}
            />
            {(usage?.items ?? []).map((it, i, arr) => (
              <Meta key={it.kind} text={usageLine(it)} severity={it.severity} last={i === arr.length - 1} />
            ))}
          </Group>

          {/* ── WHICH COMPANY ── shown ONLY when this person belongs to more than one.
              A switcher over a list of one is a decision nobody has, and for the
              freelancer this app is built for that is the normal case — so it renders
              nothing at all rather than a menu with a single entry.

              A LIST, NOT A TOGGLE. "Toggle" reads as two; a person can be crew on one
              company, a sub on another and a freelancer besides, and the row has to show
              which one is live at a glance. */}
          {companies && companies.length > 1 && (
            <Group label={T('co.switchLabel')}>
              {companies.map((c, i) => (
                <Row
                  key={c.id}
                  icon={c.isOwner ? 'job' : 'people'}
                  label={c.name}
                  value={c.id === activeCompanyId ? T('co.switchOn') : undefined}
                  accent={c.id === activeCompanyId}
                  last={i === companies.length - 1}
                  onPress={c.id === activeCompanyId ? undefined
                    : go(() => onSwitchCompany?.(c.id))}
                />
              ))}
            </Group>
          )}

          {/* ── ACCOUNT ──
              TWO ROWS REMOVED HERE (hadar, 2026-08-12: "drawer has 2 sections index and
              company feed — both can be removed from there").

              COMPANY FEED was a stand-in door. It went in when the notifications screen
              took the feed's bottom-nav slot, and the slot was given back to Company on
              the same day — so it had been a second entrance to a place that already has
              a tab. Two doors to one room is one door too many in a menu this short.

              INBOX (`drawer.inbox`) is the one worth stating plainly: it was the ONLY
              working way into the unfiled-captures screen. See the note at the App.tsx
              call site — the screen still exists and now has no entrance. */}
          <Group label={T('drawer.account')}>
            <Row icon="gear" label={T('drawer.profile')} onPress={go(onProfile)} />
            {/* ONE DESTINATION, TWO NAMES (hadar, 2026-08-17: "where does the solo
                operator add a logo or address?").
                Every account has a tenant — `ensureBillingTenant` creates one named
                after the person when they are solo, and calls it "the letterhead name
                on a change order". So a freelancer HAS the thing behind this row and
                needs it: his business name, address and licence are what a client
                reads above a price, and the licence is legally required in most US
                states.
                What company.ts ruled out was making a freelancer read the word
                COMPANY — "the freelancer never sees the word". That is a labelling
                rule, not a reason to hide his letterhead, so the row is named for who
                is reading it and goes to the same screen either way. */}
            {isOwner && (
              <Row icon="job" label={T(hasTeam ? 'set.companyTitle' : 'set.businessTitle')}
                onPress={go(onCompanySettings)}
                crown={isFreePlan} last />
            )}
          </Group>

          {/* ── APP ── language inline, exactly as the reference does it: the control
              lives IN the row rather than opening a screen to flip one switch. */}
          <Group label={T('drawer.app')}>
            <Row label={T('set.language')} last={!updateReady}
              right={
                <View style={st.seg}>
                  {(['en', 'es'] as Lang[]).map((l) => (
                    <Pressable key={l} onPress={() => { if (l !== lang) onToggleLang(); }}
                      accessibilityRole="radio" accessibilityState={{ selected: lang === l }}
                      style={[st.segBtn, lang === l && st.segOn]}>
                      <Text style={[st.segT, lang === l && st.segTOn]}>
                        {l === 'en' ? 'English' : 'Español'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              } />
            {updateReady && onApplyUpdate && (
              <Row label={T('set.restartToUpdate')} accent onPress={onApplyUpdate} />
            )}
            {/* DEV ONLY — replay the first-open intro. It lives HERE, not only on the
                sign-in screen, because the sign-in screen is unreachable once you are
                signed in: the pages and the door to them both vanished at the same
                moment. Shown when `devTools` is on — a debug build, or a user flagged
                in `developer_user` (417), which is the case that matters: replaying the
                intro on TestFlight, where `__DEV__` is false. */}
            {devTools && onShowIntro && (
              <Row label="Show intro (dev)" onPress={go(onShowIntro)} />
            )}
            {/* DEV ONLY — replay the guided first change order in place. It no longer
                signs you out: doing so cost a fresh magic link every cycle and Supabase
                rate-limits those, so the tool produced the error it was used to reach.
                The pre-login intro has its own row above; a genuinely logged-out run is
                Sign out, three rows down. */}
            {devTools && onSimulateFirstRun && (
              <Row label="Replay first change order (dev)" accent
                onPress={go(onSimulateFirstRun)} last />
            )}
          </Group>

          {/* ── HELP ── */}
          <Group label={T('set.support')}>
            <Row label={T('set.contact')} onPress={() => mailTo('EZChangeOrders — support')} />
            <Row label={T('set.feedback')} onPress={() => mailTo('EZChangeOrders — feedback')} />
            <Row label={T('set.terms')} onPress={() => openLegal('terms')} />
            <Row label={T('set.privacy')} onPress={() => openLegal('privacy')} />
            {/* CLOSE ACCOUNT. Required by App Store 5.1.1(v) for any app that lets
                somebody create an account — and it was missing entirely. Last in Help,
                below the legal rows, because that is where somebody looks for it and
                nowhere near anything they might hit by accident. */}
            <Row label={T('set.closeAccount')} onPress={go(() => onCloseAccount?.())} last />
          </Group>

          {/**
            * WHICH ACCOUNT AM I SIGNED IN AS.
            *
            * hadar, 2026-08-21: "I am loading 4254979641 user and this is what comes up
            * and it is wrong." The database said otherwise — the session on that phone
            * was 415 497 9641, and every row on screen belonged to it, correctly. But
            * NOTHING IN THIS APP SAID SO. There was no phone number, no email, no
            * account line anywhere: not here, not in Profile, not in Settings.
            *
            * That is the whole reason a day went into chasing sync bugs. When the app
            * cannot answer "who am I?", every screen becomes evidence of the wrong
            * thing, and a correct render of account A is indistinguishable from a
            * leak of account B. Identity has to be checkable in one tap, or nobody —
            * user or developer — can tell a data bug from a login they did not notice.
            *
            * Directly above Sign out, deliberately: this is the fact that makes that
            * button's consequence legible.
            */}
          {!!account && (
            <Text style={st.account} numberOfLines={1}>
              {T('set.signedInAs')} {account}
            </Text>
          )}

          <Pressable style={st.signOut} onPress={confirmSignOut} accessibilityRole="button">
            <Text style={st.signOutT}>{T('set.signOut')}</Text>
          </Pressable>

          {/* Build + manual check, as in the reference. Ours does more than theirs can:
              with OTA wired, this genuinely fetches a new bundle rather than sending
              the user to the App Store. */}
          <Text style={st.version}>{buildLabel ?? `v${appVersion}`}</Text>
          {onCheckUpdates && (
            <Pressable onPress={check} disabled={checking}
              style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={st.checkT}>
                {checking ? T('set.updateChecking') : T('set.checkUpdates')}
              </Text>
            </Pressable>
          )}
          {checkNote && <Text style={st.checkNote}>{checkNote}</Text>}
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

/** An uppercase label with a white card beneath it. The one grouping primitive. */
function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: 18 }}>
      <Text style={st.groupLab}>{label.toUpperCase()}</Text>
      <View style={st.card}>{children}</View>
    </View>
  );
}

/**
 * One row. Everything optional except the label, so a nav row, a value row, a crowned
 * row and a row with an inline control are all the SAME component — which is what
 * keeps the rhythm identical down the panel.
 */
function Row({ icon, label, value, badge, crown, right, accent, last, onPress }: {
  icon?: IconName; label: string; value?: string; badge?: number;
  crown?: boolean; right?: React.ReactNode; accent?: boolean; last?: boolean;
  onPress?: () => void;
}) {
  const body = (
    <View style={[st.row, !last && st.rowDiv]}>
      {icon && <Icon name={icon} size={20} color={C.steel} />}
      {/* The label FLEXES and the spacer is gone. With a fixed-width label beside a
          flex:1 spacer, the spacer wins the layout and clips the text — "Profile &
          preferences" rendered as "Pro…" on a 340pt panel. */}
      <Text style={[st.rowLabel, accent && { color: C.brand }]} numberOfLines={1}>{label}</Text>
      {crown && <LockCrown size={15} />}
      {badge != null && badge > 0 && (
        <View style={st.badge}><Text style={st.badgeT}>{badge}</Text></View>
      )}
      {value && <Text style={st.rowValue}>{value}</Text>}
      {right}
      {onPress && <Text style={st.chev}>›</Text>}
    </View>
  );
  if (!onPress) return body;
  return <Pressable onPress={onPress} accessibilityRole="button">{body}</Pressable>;
}

/** A non-tappable detail line inside a group — the usage numbers. */
function Meta({ text, severity, last }: {
  text: string; severity: 'ok' | 'nearing' | 'reached'; last?: boolean;
}) {
  return (
    <View style={[st.meta, !last && st.rowDiv]}>
      <Text style={{
        fontFamily: severity === 'ok' ? F.body : F.bodySemi,
        fontSize: 13.5,
        color: severity === 'reached' ? '#7A3B32' : severity === 'nearing' ? '#6b5220' : C.steel,
      }}>
        {text}
      </Text>
    </View>
  );
}

const ROW_X = 16;   // the row's left padding; dividers inset to match it

const st = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(13,15,18,0.45)' },
  panel: { position: 'absolute', top: 0, bottom: 0, left: 0, backgroundColor: C.paper,
    paddingTop: 62, paddingHorizontal: 14, paddingBottom: 20, ...shadows.card,
    shadowOffset: { width: 4, height: 0 }, shadowOpacity: 0.12, shadowRadius: 16 },

  brand: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: C.line },
  // 44pt square, rounded, with a hairline: a logo on a cream panel needs an edge or a
  // white-background mark dissolves into the page. `contain` so nothing is cropped —
  // the crop decision was already made in the picker, by him.
  brandLogo: { width: 44, height: 44, borderRadius: 8, borderWidth: 1, borderColor: '#ece5de',
    backgroundColor: '#fff' },
  brandAct: { fontFamily: F.bodySemi, fontSize: 12.5, color: C.brand, marginTop: 2 },
  brandBox: { borderWidth: 2, borderColor: C.brand, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  brandBoxT: { fontFamily: F.bodyBold, fontSize: 20, color: C.brand, letterSpacing: 0.5 },
  brandWord: { fontFamily: F.disp, fontSize: 20, color: C.ink, letterSpacing: 0.4 },

  groupLab: { fontFamily: F.dispSemi, fontSize: 11.5, color: C.steel, textTransform: 'uppercase',
    letterSpacing: 1.3, marginBottom: 7, paddingHorizontal: 4 },
  card: { backgroundColor: C.card, borderRadius: radii.lg, overflow: 'hidden',
    borderWidth: 1, borderColor: C.line },

  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 54,
    paddingHorizontal: ROW_X, paddingVertical: 8 },
  // Inset from the row's own padding, so the group reads as one object rather than a
  // table. Full-bleed lines are what make a grouped list look drawn instead of native.
  rowDiv: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line,
    marginLeft: ROW_X, paddingLeft: 0 },
  rowLabel: { flex: 1, minWidth: 0, fontFamily: F.bodySemi, fontSize: 16, color: C.ink },
  rowValue: { fontFamily: F.bodySemi, fontSize: 14, color: C.brand },
  meta: { paddingHorizontal: ROW_X, paddingVertical: 9, marginLeft: 0 },

  badge: { minWidth: 24, height: 24, borderRadius: 12, backgroundColor: C.caution,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7 },
  badgeT: { fontFamily: F.bodyBold, fontSize: 13, color: C.ink },
  chev: { fontFamily: F.body, fontSize: 22, color: C.steel, marginLeft: 2 },

  seg: { flexDirection: 'row', backgroundColor: C.surfaceMuted, borderRadius: 999, padding: 3 },
  segBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  segOn: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line },
  segT: { fontFamily: F.body, fontSize: 13, color: C.steel },
  segTOn: { fontFamily: F.bodySemi, color: C.ink },

  // An outline pill, not a red block: signing out is routine and reversible, and
  // dressing it as destructive teaches the wrong thing about the one action that is.
  // Quiet: this is a fact to check, not a control. It must be READABLE though —
  // a number nobody can proof-read answers nothing.
  account: { fontFamily: F.body, fontSize: 13, color: C.steel,
    textAlign: 'center', marginTop: 18, marginBottom: 8 },
  signOut: { minHeight: 50, borderRadius: radii.pill, borderWidth: 1, borderColor: C.line,
    backgroundColor: C.card, alignItems: 'center', justifyContent: 'center', marginTop: 22 },
  signOutT: { fontFamily: F.bodySemi, fontSize: 15.5, color: C.ink },

  version: { fontFamily: F.body, fontSize: 12.5, color: C.steel, textAlign: 'center', marginTop: 18 },
  checkT: { fontFamily: F.bodySemi, fontSize: 13.5, color: C.steel, textDecorationLine: 'underline' },
  checkNote: { fontFamily: F.body, fontSize: 12.5, color: C.steel, textAlign: 'center', marginTop: 2 },
});
