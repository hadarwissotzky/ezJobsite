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
import { Alert, Animated, Easing, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { LockCrown } from './usagecard';
import { C, F } from './theme';
import { radii, shadows } from './tokens';
import { Icon, type IconName } from './icon';
import { t as T } from '../i18n';
import type { Lang } from '../i18n';
import type { UsageItem, UsageSummary } from '../usage';

const SUPPORT_EMAIL = 'support@ezchangeorder.com';

export function Drawer({
  visible, onClose, onProfile, onCompanySettings, onInbox, onPlans,
  inboxCount, planName, isFreePlan, isOwner,
  lang, onToggleLang, appVersion, confirmBase, onSignOut,
  buildLabel, updateReady, onApplyUpdate, onCheckUpdates, usage,
}: {
  visible: boolean;
  onClose: () => void;
  onProfile: () => void;
  /** Opens the owner-only company Settings. Only rendered when isOwner. */
  onCompanySettings: () => void;
  onInbox: () => void;
  onPlans: () => void;
  inboxCount: number;
  planName: string;
  isFreePlan: boolean;
  /** This user created/owns the company: gates the Upgrade CTA and the Settings row. */
  isOwner: boolean;
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
    Linking.openURL(`https://${confirmBase || 'ezchangeorder.com'}/${path}`).catch(() => {});
  const confirmSignOut = () =>
    Alert.alert(T('set.signOut'), T('set.signOutConfirm'), [
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
        <View style={st.brand}>
          <View style={st.brandBox}><Text style={st.brandBoxT}>EZ</Text></View>
          <Text style={st.brandWord}>CHANGEORDER</Text>
        </View>

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

          {/* ── ACCOUNT ── */}
          <Group label={T('drawer.account')}>
            <Row icon="gear" label={T('drawer.profile')} onPress={go(onProfile)} />
            {isOwner && (
              <Row icon="job" label={T('set.companyTitle')} onPress={go(onCompanySettings)}
                crown={isFreePlan} />
            )}
            {inboxCount > 0 && (
              <Row icon="savedLocal" label={T('drawer.inbox')} badge={inboxCount} onPress={go(onInbox)} last />
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
              <Row label={T('set.restartToUpdate')} accent onPress={onApplyUpdate} last />
            )}
          </Group>

          {/* ── HELP ── */}
          <Group label={T('set.support')}>
            <Row label={T('set.contact')} onPress={() => mailTo('EZchangeorder — support')} />
            <Row label={T('set.feedback')} onPress={() => mailTo('EZchangeorder — feedback')} />
            <Row label={T('set.terms')} onPress={() => openLegal('terms')} />
            <Row label={T('set.privacy')} onPress={() => openLegal('privacy')} last />
          </Group>

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
  signOut: { minHeight: 50, borderRadius: radii.pill, borderWidth: 1, borderColor: C.line,
    backgroundColor: C.card, alignItems: 'center', justifyContent: 'center', marginTop: 22 },
  signOutT: { fontFamily: F.bodySemi, fontSize: 15.5, color: C.ink },

  version: { fontFamily: F.body, fontSize: 12.5, color: C.steel, textAlign: 'center', marginTop: 18 },
  checkT: { fontFamily: F.bodySemi, fontSize: 13.5, color: C.steel, textDecorationLine: 'underline' },
  checkNote: { fontFamily: F.body, fontSize: 12.5, color: C.steel, textAlign: 'center', marginTop: 2 },
});
