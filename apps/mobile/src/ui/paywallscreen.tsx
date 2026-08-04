/**
 * Paywall — the tier comparison + purchase entry (hadar 2026-07-26, DEC-11). Replaces
 * the Settings "contact us" mailto and the QuotaModal "See plans" CTA. Reads tiers from
 * plans.ts and calls the billing seam (billing.ts) to purchase.
 *
 * Billing is a STUB today (billing.ts billingStatus() === 'not_configured'), so the
 * paid CTAs show a "coming soon" state and a note, and Enterprise/contact routes to
 * email — no dead buy button. When react-native-purchases + keys land, the same UI
 * drives real purchases; nothing here changes except billingStatus() flipping to
 * 'ready'. Field-first design: one clear action per card, plain words, big targets.
 */
import React from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { t } from '../i18n';
import { PLANS, PAID_TIERS, type PlanId } from '../plans';
import { billingStatus, purchasePlan, restorePurchases } from '../billing';
import { Icon } from './icon';
import { C, F } from './theme';

// Which feature bullets each tier shows (i18n keys under paywall.f.*).
//
// KEPT HONEST AGAINST plans.ts (2026-08-04). These previously read "Up to 2 active
// jobs" and "Unlimited jobs & extras" — written when jobs were the metered thing. The
// free tier now meters sent change orders, photos, recording and seats, so those
// bullets had become a sales claim the product does not make. A paywall that
// misdescribes the tier is worse than one with fewer bullets: the user discovers the
// truth at the moment they are refused, having already paid attention to the lie.
const FEATURES: Record<PlanId, string[]> = {
  free: ['free1', 'free2', 'free3', 'evidence'],
  core: ['unlim', 'seats3', 'sms', 'evidence'],
  crew: ['unlim', 'seatsUnlim', 'collab', 'integrations'],
};

export function PaywallScreen(props: {
  visible: boolean;
  currentPlan: PlanId;
  onClose: () => void;
  onContact: () => void;   // mailto — the fallback when billing is not yet live
  /** Fired after a successful purchase/restore so the caller can re-read the plan.
   *  The AUTHORITY is still company.plan written by the RevenueCat webhook — this is
   *  only the cue to go look, not the entitlement itself. */
  onPurchased?: () => void;
}) {
  const ready = billingStatus() === 'ready';
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);

  const buy = async (plan: PlanId) => {
    const pid = PLANS[plan].productIdAnnual ?? PLANS[plan].productIdMonthly;
    if (!ready || !pid) { props.onContact(); return; }
    setBusy(true); setNote(null);
    const r = await purchasePlan(pid);
    setBusy(false);
    if (r.ok) {
      // Paid. The webhook writes company.plan server-side and it syncs down, which can
      // lag a moment — so acknowledge here rather than leaving the buyer staring at
      // the paywall wondering whether their money went anywhere.
      setNote(t('paywall.thanks'));
      props.onPurchased?.();
      return;
    }
    if (r.reason !== 'cancelled') setNote(t('paywall.failed'));
  };

  const restore = async () => {
    setBusy(true); setNote(null);
    const r = await restorePurchases();
    setBusy(false);
    if (r.ok && r.plan !== 'free') { setNote(t('paywall.thanks')); props.onPurchased?.(); return; }
    if (!r.ok || r.plan === 'free') setNote(ready ? t('paywall.restoreNone') : t('paywall.notLive'));
  };

  const card = (plan: PlanId) => {
    const p = PLANS[plan];
    const isCurrent = props.currentPlan === plan;
    const price = p.priceAnnualMonthly;
    return (
      <View key={plan} style={{ backgroundColor: C.card, borderWidth: 1.5,
        borderColor: isCurrent ? C.brand : C.line, borderRadius: 18, padding: 18, marginBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 20, color: C.ink }}>{t(('plan.' + plan) as any)}</Text>
          {price != null && price > 0 ? (
            <Text style={{ fontFamily: F.bodyBold, fontSize: 22, color: C.ink }}>
              ${price}<Text style={{ fontFamily: F.body, fontSize: 13, color: C.steel }}>{t('paywall.perMo')}</Text>
            </Text>
          ) : (
            <Text style={{ fontFamily: F.bodyBold, fontSize: 18, color: C.brand }}>{t('paywall.free')}</Text>
          )}
        </View>
        {price != null && price > 0 && (
          <Text style={{ fontFamily: F.body, fontSize: 12.5, color: C.steel, marginTop: 2 }}>{t('paywall.annualNote')}</Text>
        )}
        <View style={{ marginTop: 12, gap: 8 }}>
          {FEATURES[plan].map((f) => (
            <View key={f} style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
              <Icon name="approved" size={16} color={C.approve} />
              <Text style={{ fontFamily: F.body, fontSize: 14.5, color: C.ink, flex: 1 }}>{t(('paywall.f.' + f) as any)}</Text>
            </View>
          ))}
        </View>
        {isCurrent ? (
          <View style={{ marginTop: 14, minHeight: 50, borderRadius: 12, backgroundColor: C.surfaceMuted,
            alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 15, color: C.steel }}>{t('paywall.current')}</Text>
          </View>
        ) : plan !== 'free' ? (
          <Pressable onPress={() => buy(plan)} disabled={busy}
            style={{ marginTop: 14, minHeight: 52, borderRadius: 12, backgroundColor: C.ink,
              alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: '#fff' }}>
              {ready ? t({ k: 'paywall.choose', p: { plan: t(('plan.' + plan) as any) } } as any) : t('paywall.comingSoon')}
            </Text>
          </Pressable>
        ) : null}
      </View>
    );
  };

  return (
    <Modal visible={props.visible} animationType="slide" onRequestClose={props.onClose}>
      <View style={{ flex: 1, backgroundColor: C.paper }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 56, paddingHorizontal: 16, paddingBottom: 8 }}>
          <Pressable onPress={props.onClose} hitSlop={12} style={{ paddingRight: 12, minHeight: 44, justifyContent: 'center' }}>
            <Text style={{ fontSize: 26, color: C.ink }}>‹</Text>
          </Pressable>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 24, color: C.ink }}>{t('paywall.title')}</Text>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <Text style={{ fontFamily: F.body, fontSize: 15, color: C.steel, marginBottom: 16 }}>{t('paywall.sub')}</Text>

          {!ready && (
            <View style={{ backgroundColor: C.brandSoft, borderRadius: 12, padding: 14, marginBottom: 16 }}>
              <Text style={{ fontFamily: F.body, fontSize: 13.5, color: C.brandDark }}>{t('paywall.notLive')}</Text>
            </View>
          )}

          {card('free')}
          {PAID_TIERS.map(card)}

          {note && <Text style={{ fontFamily: F.body, fontSize: 13, color: C.steel, marginTop: 4 }}>{note}</Text>}

          <Pressable onPress={restore} disabled={busy}
            style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 8 }}>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: C.steel }}>{t('paywall.restore')}</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}
