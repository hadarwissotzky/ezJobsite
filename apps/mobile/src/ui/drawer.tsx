/**
 * The left navigation drawer — the ☰ menu (hadar, 2026-07-27).
 *
 * WHAT IT REPLACES: the ☰ used to open a centred card that LISTED YOUR JOBS — which
 * was wrong twice over. Jobs already have their own bottom-nav destination (the Jobs
 * tab owns the list, search, New Project, archive and label filters), so the menu
 * duplicated them; and a centred card is not what a hamburger promises. This slides in
 * from the left, over a scrim, like a hamburger should.
 *
 * WHAT IS IN IT:
 *  - PRIMARY nav to secondary destinations not on the bottom bar: the Settings hub
 *    (which is itself the profile/team/plan account page), Company Feed, Inbox, Plans.
 *  - A SUPPORT group (Contact support, Send feedback) and an ABOUT section at the very
 *    bottom (Terms, Privacy, Sign out, version). Both were pulled OUT of the Settings
 *    screen on 2026-07-27 at hadar's request, so they live here as first-class drawer
 *    items rather than buried inside a settings form.
 *
 * The rows link to screens/actions that ALREADY EXIST; this component navigates and
 * opens links, it does not own any of those surfaces. Nav rows close the drawer first.
 */
import React from 'react';
import { Alert, Animated, Easing, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { C, F } from './theme';
import { radii, shadows } from './tokens';
import { Icon, type IconName } from './icon';
import { t as T } from '../i18n';
import type { Lang } from '../i18n';

const SUPPORT_EMAIL = 'support@ezchangeorder.com';

export function Drawer({
  visible, onClose, onProfile, onCompanySettings, onInbox, onPlans,
  inboxCount, planName, isFreePlan, isOwner,
  lang, onToggleLang, appVersion, confirmBase, onSignOut,
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
  confirmBase: string;
  onSignOut: () => Promise<void>;
}) {
  const { width } = useWindowDimensions();
  const panelW = Math.min(340, Math.round(width * 0.82));

  // Keep the Modal mounted through the CLOSE animation: React Native's Modal unmounts
  // the instant `visible` goes false, which would snap the panel away with no slide. A
  // local `mounted` stays true until the exit finishes.
  const [mounted, setMounted] = React.useState(visible);
  const slide = React.useRef(new Animated.Value(0)).current;   // 0 = closed, 1 = open

  React.useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(slide, {
        toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }).start();
    } else if (mounted) {
      Animated.timing(slide, {
        toValue: 0, duration: 180, easing: Easing.in(Easing.cubic), useNativeDriver: true,
      }).start(({ finished }) => { if (finished) setMounted(false); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!mounted) return null;

  const go = (fn: () => void) => () => { onClose(); fn(); };
  const mailTo = (subject: string) =>
    Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`).catch(() => {});
  const openLegal = (path: string) =>
    Linking.openURL(`https://${confirmBase || 'ezchangeorder.com'}/${path}`).catch(() => {});
  const confirmSignOut = () =>
    Alert.alert(T('set.signOut'), T('set.signOutConfirm'), [
      { text: T('set.cancel'), style: 'cancel' },
      { text: T('set.signOut'), style: 'destructive', onPress: () => { onClose(); void onSignOut(); } },
    ]);

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
        {/* Brand header. Text, not the splash art — fonts are loaded by the time the
            Home screen (the only place ☰ shows) can render. */}
        <View style={st.brand}>
          <View style={st.brandBox}><Text style={st.brandBoxT}>EZ</Text></View>
          <Text style={st.brandWord}>CHANGEORDER</Text>
        </View>

        {/* ---- Plan box ---- at the very top, above Profile. Everyone sees the current
            plan; the Upgrade CTA appears only for the OWNER on a free plan, because only
            the owner can change the company's plan (hadar, 2026-07-27). */}
        <View style={st.planBox}>
          <View style={{ flex: 1 }}>
            <Text style={st.planLab}>{T('drawer.yourPlan')}</Text>
            <Text style={st.planName}>{planName}</Text>
          </View>
          {isOwner && isFreePlan && (
            <Pressable style={st.upgrade} onPress={go(onPlans)} accessibilityRole="button">
              <Text style={st.upgradeT}>{T('drawer.upgrade')}</Text>
            </Pressable>
          )}
        </View>

        {/* The nav + support scroll; About is pinned below, at the drawer's bottom, so
            it stays reachable even when the list is long on a short phone. */}
        <ScrollView style={st.rows} showsVerticalScrollIndicator={false}>
          <Row icon="gear" label={T('drawer.profile')} sub={T('drawer.profileSub')} onPress={go(onProfile)} />
          {isOwner && (
            <Row icon="job" label={T('set.companyTitle')} sub={T('drawer.settingsSub')}
              onPress={go(onCompanySettings)} />
          )}
          {inboxCount > 0 && (
            <Row icon="savedLocal" label={T('drawer.inbox')} badge={inboxCount} onPress={go(onInbox)} />
          )}

          {/* ---- Support ---- pulled out of Settings, its own group. */}
          <Text style={st.groupLab}>{T('set.support')}</Text>
          <MiniRow label={T('set.contact')} onPress={() => mailTo('EZchangeorder — support')} />
          <MiniRow label={T('set.feedback')} onPress={() => mailTo('EZchangeorder — feedback')} />
        </ScrollView>

        {/* ---- About ---- pinned to the bottom of the drawer. */}
        <View style={st.about}>
          <Text style={st.groupLab}>{T('set.about')}</Text>
          <MiniRow label={T('set.terms')} onPress={() => openLegal('terms')} />
          <MiniRow label={T('set.privacy')} onPress={() => openLegal('privacy')} />
          <Pressable style={st.signOut} onPress={confirmSignOut} accessibilityRole="button">
            <Text style={st.signOutT}>{T('set.signOut')}</Text>
          </Pressable>
          <View style={st.footer}>
            <Pressable style={st.langBtn} onPress={onToggleLang} accessibilityRole="button">
              <Text style={st.langT}>{lang === 'en' ? 'Español' : 'English'}</Text>
            </Pressable>
            <Text style={st.version}>v{appVersion}</Text>
          </View>
        </View>
      </Animated.View>
    </Modal>
  );
}

/** A primary nav row: olive icon disc, label + sub, optional count, chevron. */
function Row({ icon, label, sub, badge, onPress }: {
  icon: IconName; label: string; sub?: string; badge?: number; onPress: () => void;
}) {
  return (
    <Pressable style={st.row} onPress={onPress} accessibilityRole="button">
      <View style={st.rowIcon}><Icon name={icon} size={22} color={C.brand} /></View>
      <View style={{ flex: 1 }}>
        <Text style={st.rowLabel} numberOfLines={1}>{label}</Text>
        {sub && <Text style={st.rowSub} numberOfLines={1}>{sub}</Text>}
      </View>
      {badge != null && badge > 0 && (
        <View style={st.badge}><Text style={st.badgeT}>{badge}</Text></View>
      )}
      <Text style={st.chev}>›</Text>
    </Pressable>
  );
}

/** A lighter row for the Support / About links — no icon disc, secondary weight. */
function MiniRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={st.miniRow} onPress={onPress} accessibilityRole="button">
      <Text style={st.miniLabel}>{label}</Text>
      <Text style={st.chev}>›</Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(13,15,18,0.45)' },
  panel: { position: 'absolute', top: 0, bottom: 0, left: 0, backgroundColor: C.paper,
    paddingTop: 62, paddingHorizontal: 16, paddingBottom: 20, ...shadows.card,
    shadowOffset: { width: 4, height: 0 }, shadowOpacity: 0.12, shadowRadius: 16 },

  brand: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 18,
    borderBottomWidth: 1, borderBottomColor: C.line, marginBottom: 6 },
  brandBox: { borderWidth: 2, borderColor: C.brand, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  brandBoxT: { fontFamily: F.bodyBold, fontSize: 20, color: C.brand, letterSpacing: 0.5 },
  brandWord: { fontFamily: F.disp, fontSize: 20, color: C.ink, letterSpacing: 0.4 },

  planBox: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.brandSoft,
    borderRadius: radii.lg, padding: 14, marginTop: 4, marginBottom: 4 },
  planLab: { fontFamily: F.dispSemi, fontSize: 11.5, color: C.brand, textTransform: 'uppercase',
    letterSpacing: 1.2 },
  planName: { fontFamily: F.bodyBold, fontSize: 19, color: C.ink, marginTop: 1 },
  upgrade: { minHeight: 44, paddingHorizontal: 16, borderRadius: radii.pill, backgroundColor: C.brand,
    alignItems: 'center', justifyContent: 'center' },
  upgradeT: { fontFamily: F.bodyBold, fontSize: 14, color: '#fff' },

  rows: { flex: 1, paddingTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 56,
    paddingVertical: 6, paddingHorizontal: 4 },
  rowIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.brandSoft,
    alignItems: 'center', justifyContent: 'center' },
  rowLabel: { fontFamily: F.bodySemi, fontSize: 17, color: C.ink },
  rowSub: { fontFamily: F.body, fontSize: 13, color: C.steel, marginTop: 1 },
  badge: { minWidth: 24, height: 24, borderRadius: 12, backgroundColor: C.caution,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7 },
  badgeT: { fontFamily: F.bodyBold, fontSize: 13, color: C.ink },
  chev: { fontFamily: F.body, fontSize: 24, color: C.steel, marginLeft: 4 },

  groupLab: { fontFamily: F.dispSemi, fontSize: 12, color: C.steel, textTransform: 'uppercase',
    letterSpacing: 1.4, marginTop: 18, marginBottom: 2, paddingHorizontal: 4 },
  miniRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    minHeight: 48, paddingHorizontal: 4 },
  miniLabel: { fontFamily: F.bodySemi, fontSize: 15.5, color: C.ink },

  about: { borderTopWidth: 1, borderTopColor: C.line, marginTop: 8, paddingTop: 4 },
  signOut: { minHeight: 48, borderRadius: radii.md, borderWidth: 1.5, borderColor: C.danger,
    alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  signOutT: { fontFamily: F.dispSemi, fontSize: 15.5, color: C.danger },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 14 },
  langBtn: { minHeight: 44, paddingHorizontal: 16, borderRadius: radii.pill, borderWidth: 1,
    borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  langT: { fontFamily: F.bodySemi, fontSize: 15, color: C.ink },
  version: { fontFamily: F.body, fontSize: 13, color: C.steel },
});
