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
import {Linking,ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { t } from '../i18n';
import { PLANS, PAID_TIERS, offeredTiers, type PlanId } from '../plans';
import { billingStatus, manageSubscriptionUrl, purchasePlan, restorePurchases } from '../billing';
// Prices come from the server (`pricing_config`), never from this binary — the rail is a
// court case away from changing and must not need an App Store review.
import { money as packMoney, perCredit, type Pack } from '../pricingconfig';
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
  core: ['unlim', 'seats3', 'sms'],
  // Crew INHERITS Core rather than restating it (Handoff's "All FLEX features plus:",
  // 2026-08-04). Repeating shared bullets makes two tiers look similar when the whole
  // job of the card is to show what changes — and it buries the one line that actually
  // differs. What Crew adds over Core is seats, collaboration and integrations.
  crew: ['seatsUnlim', 'collab', 'integrations'],
};

/** The tier whose features this one builds on, for the "everything in X, plus" line. */
const INHERITS: Partial<Record<PlanId, PlanId>> = { crew: 'core' };

export type BillingCycle = 'monthly' | 'annual';

/** The store product for a tier on a cycle, falling back to whichever exists. */
export function productFor(plan: PlanId, cycle: BillingCycle): string | null {
  const p = PLANS[plan];
  return cycle === 'annual'
    ? (p.productIdAnnual ?? p.productIdMonthly)
    : (p.productIdMonthly ?? p.productIdAnnual);
}

/** The per-month figure to print for a tier on a cycle. Null when there is no price. */
export function priceFor(plan: PlanId, cycle: BillingCycle): number | null {
  const p = PLANS[plan];
  return cycle === 'annual' ? p.priceAnnualMonthly : p.priceMonthly;
}

/**
 * How much annual saves, as a whole percent, or 0 when it saves nothing.
 *
 * COMPUTED, never typed into a string. A hardcoded "Save 20%" is a price claim that
 * goes stale the first time a number in plans.ts moves, and a wrong discount on a
 * paywall is the kind of error that ends up in a refund request.
 */
export function annualSavingPct(plan: PlanId): number {
  const m = PLANS[plan].priceMonthly;
  const a = PLANS[plan].priceAnnualMonthly;
  if (m == null || a == null || m <= 0 || a >= m) return 0;
  return Math.round(((m - a) / m) * 100);
}

/**
 * The best saving across the tiers a reader can actually BUY — what the toggle
 * advertises.
 *
 * Over `offeredTiers`, not `PAID_TIERS`: advertising a discount that only exists on a
 * hidden tier is a number on a purchase screen that nothing on the screen can deliver
 * (mandate #6). Today Core carries the best rate anyway, so hiding Crew changes nothing
 * visible — which is exactly why it would have gone unnoticed the day it did.
 */
export function bestAnnualSavingPct(currentPlan: PlanId = 'free'): number {
  return offeredTiers(currentPlan)
    .reduce((best, p) => Math.max(best, annualSavingPct(p)), 0);
}

export function PaywallScreen(props: {
  visible: boolean;
  currentPlan: PlanId;
  onClose: () => void;
  onContact: () => void;   // mailto — the fallback when billing is not yet live
  /** Fired after a successful purchase/restore so the caller can re-read the plan.
   *  The AUTHORITY is still company.plan written by the RevenueCat webhook — this is
   *  only the cue to go look, not the entitlement itself. */
  /** The plan RevenueCat granted, so the caller can cache the verdict rather than
   *  re-deriving it from a server column that has not arrived yet. */
  onPurchased?: (plan: PlanId) => void;
  /** The store product actually being paid for, when known. Distinguishes Core-monthly
   *  from Core-annual — `currentPlan` alone cannot. Null/undefined falls back to
   *  tier-level matching, which is what this screen did before the toggle existed. */
  currentProductId?: string | null;
  /**
   * ─── PAY AS YOU GO (hadar, 2026-08-18: "how do I get the selection for pay as you
   * go") ─────────────────────────────────────────────────────────────────────────
   *
   * The answer that shaped this: PAY AS YOU GO IS NOT A TIER. A subscription is a state
   * you enter; credits are a quantity you buy. So the packs are NOT a fourth card in the
   * comparison column — putting them there would ask someone to choose between "20
   * change orders" and "unlimited, monthly", which are answers to different questions.
   *
   * They sit in their own section above the tiers, because the ladder reads: you have a
   * trial, you can buy more when you need them, and you stop counting when the business
   * is working.
   *
   * Empty array = no packs configured, and the section does not render. `pricing_config`
   * filters out any pack that grants nothing or costs nothing, so an empty list is a
   * misconfiguration and one fewer option beats a broken one.
   */
  packs?: readonly Pack[];
  /**
   * Opens the checkout. NULL when there is no web rail with an address — `purchaseUrl`
   * returns null without a token or a company id, and a buy button that opens a 404 is
   * worse than none. The section then shows the prices without a door, which is still
   * useful: he learns what it costs.
   */
  onBuyCredits?: (() => void) | null;
  /** Change orders he can still send. Null = unknown or unlimited; the line is dropped
   *  rather than rendered as zero. */
  creditsLeft?: number | null;
}) {
  const ready = billingStatus() === 'ready';
  const best = bestAnnualSavingPct(props.currentPlan);
  /**
   * MONTHLY OR ANNUAL, chosen once for the whole screen (hadar 2026-08-13: "I need the
   * paywall to split between annual and monthly as any option across the 3 options").
   *
   * ONE toggle above all three cards, not a control per card. Every plan is on the same
   * cycle at the same time, so the comparison down the column stays a comparison of
   * TIERS — which is the only thing the screen is for. A per-card cycle would let
   * somebody read $19 against $59 and conclude Crew costs three times Core, when they
   * were looking at an annual rate beside a monthly one.
   *
   * Defaults to annual because that is the cheaper per-month number and what this
   * screen already showed; the monthly price is never hidden, only one tap away.
   */
  const [cycle, setCycle] = React.useState<'monthly' | 'annual'>('annual');
  // DEV ONLY — the two inputs that decide which card reads "Your plan", readable from
  // the inspector. Guessing at them from a screenshot is how the last hour went.
  if (__DEV__) (globalThis as any).__pw = JSON.stringify({
    currentPlan: props.currentPlan, currentProductId: props.currentProductId, cycle });
  // WHICH plan is buying, not merely "something is". A shared boolean disabled every
  // button and marked none of them, so the one you pressed gave no sign of life.
  const [busy, setBusy] = React.useState<PlanId | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  /** Which card the note belongs to, so it appears where the finger was. */
  const [noteFor, setNoteFor] = React.useState<PlanId | null>(null);

  /**
   * BUY — and say what happened, always (hadar, 2026-08-13: "I click on it and nothing
   * happens", against the RevenueCat Test Store).
   *
   * Three things were wrong at once, and together they made a working call look like a
   * dead button:
   *
   *   1. `cancelled` produced NO message and no state change. Indistinguishable from a
   *      tap that did nothing at all.
   *   2. A purchase that granted NO ENTITLEMENT was reported as success. The Test Store
   *      returns customerInfo happily; if the product is not attached to a `core`/`crew`
   *      entitlement in the dashboard, `planFromCustomerInfo` yields 'free' — so the app
   *      said "thanks", re-read the plan, found it unchanged, and left the same paywall
   *      on screen. That is the exact symptom, and saying thank you for nothing is the
   *      worse half of it.
   *   3. `detail` was discarded, so the one string that says WHICH of these happened
   *      (`product_unavailable`, a store error) never reached anybody.
   */
  const buy = async (plan: PlanId) => {
    // The chosen cycle decides the product. The fallback is not cosmetic: a tier with
    // only one of the two configured must still be buyable rather than silently
    // routing to the contact-us mailto.
    const pid = productFor(plan, cycle);
    if (!ready || !pid) { props.onContact(); return; }
    setBusy(plan); setNote(null); setNoteFor(plan);
    const r = await purchasePlan(pid);
    setBusy(null);
    // DEV ONLY — the raw result, readable from the inspector. The screen shows a
    // sentence; this is the shape that produced it.
    if (__DEV__) (globalThis as any).__lastBuy = JSON.stringify(r);
    if (r.ok && r.plan !== 'free') {
      // Paid AND entitled. The webhook writes company.plan server-side and it syncs
      // down, which can lag a moment — so acknowledge here rather than leaving the
      // buyer staring at the paywall wondering whether their money went anywhere.
      setNote(t('paywall.thanks'));
      props.onPurchased?.(r.plan);
      return;
    }
    if (r.ok) { setNote(t('paywall.noEntitlement')); return; }
    if (r.reason === 'cancelled') { setNote(t('paywall.cancelled')); return; }
    // Refused before the store sheet: there is no tenant to attach the plan to. Says
    // what to do rather than what went wrong.
    if (r.reason === 'no_tenant') { setNote(t('paywall.needProfile')); return; }
    // The detail is SHOWN in a debug build. It is the difference between "the store is
    // down" and "this product is not set up", and without it the next hour is guesswork.
    setNote(__DEV__ && r.detail ? `${t('paywall.failed')}\n${r.detail}` : t('paywall.failed'));
  };

  const restore = async () => {
    setBusy('free'); setNote(null); setNoteFor('free');
    const r = await restorePurchases();
    setBusy(null);
    if (r.ok && r.plan !== 'free') { setNote(t('paywall.thanks')); props.onPurchased?.(r.plan); return; }
    if (!r.ok || r.plan === 'free') setNote(ready ? t('paywall.restoreNone') : t('paywall.notLive'));
  };

  const card = (plan: PlanId) => {
    const price = priceFor(plan, cycle);
    const productId = productFor(plan, cycle);
    /**
     * "Your plan" means THIS product, not this tier — when we know the product.
     *
     * Somebody on Core-annual who taps Monthly is looking at a different thing to buy,
     * and the card has to offer it. Marking the tier as current would leave them staring
     * at a monthly price they cannot select, which is exactly the dead-button complaint
     * that produced the note-in-the-card fix above.
     *
     * When the product is unknown (billing not configured, nothing cached yet) this
     * falls back to tier matching — the behaviour before the toggle existed. Free is
     * always tier-level: it has no product and no cycle.
     */
    const sameTier = props.currentPlan === plan;
    // The product NARROWS the tier match; it never stands in for it. Written the other
    // way first, and caught on device: with the plan reading 'free' and a Core product
    // still cached, the Free card AND the Core card both said "Your plan". A stale
    // product id from a lapsed subscription does the same thing in production.
    const knowsCycle = plan !== 'free' && !!props.currentProductId && !!productId;
    const isCurrent = sameTier && (!knowsCycle || props.currentProductId === productId);
    /** Same tier, other cycle: a switch, not a purchase — and it must say so. */
    const isSwitch = sameTier && !isCurrent;
    const saving = cycle === 'annual' ? annualSavingPct(plan) : 0;
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
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }}>
            <Text style={{ fontFamily: F.body, fontSize: 12.5, color: C.steel }}>
              {cycle === 'annual'
                ? t({ k: 'paywall.billedAnnually',
                      // The REAL annual charge, not the headline times twelve — Apple
                      // has no $228 price point (see plans.ts `priceAnnualTotal`).
                      p: { total: String(PLANS[plan].priceAnnualTotal ?? price * 12) } } as any)
                : t('paywall.billedMonthly')}
            </Text>
            {saving > 0 && (
              <View style={{ backgroundColor: C.brandSoft, borderRadius: 6,
                paddingHorizontal: 6, paddingVertical: 2 }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: C.brandDark }}>
                  {t({ k: 'paywall.savePct', p: { pct: String(saving) } } as any)}
                </Text>
              </View>
            )}
          </View>
        )}
        <View style={{ marginTop: 12, gap: 8 }}>
          {INHERITS[plan] && (
            <Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: C.steel, marginBottom: 2 }}>
              {t({ k: 'paywall.everythingIn', p: { plan: t(('plan.' + INHERITS[plan]) as any) } } as any)}
            </Text>
          )}
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
          <>
          {/* THE OUTCOME, IN THE CARD HE PRESSED (hadar: "it thinks and returns
              nothing"). There has been a message for every branch since v132 — it was
              rendered once, at the BOTTOM of the sheet under all three cards, where a
              scrolled paywall puts it off-screen. A message nobody can see is the same
              as no message, and the button reads as dead. */}
          {noteFor === plan && !!note && (
            <View style={{ marginTop: 12, backgroundColor: C.surfaceMuted, borderRadius: 10,
              paddingVertical: 10, paddingHorizontal: 12 }}>
              <Text style={{ fontFamily: F.body, fontSize: 13.5, lineHeight: 19, color: C.ink }}>
                {note}
              </Text>
            </View>
          )}
          <Pressable onPress={() => buy(plan)} disabled={!!busy}
            style={{ marginTop: 14, minHeight: 52, borderRadius: 12, backgroundColor: C.ink,
              alignItems: 'center', justifyContent: 'center', opacity: busy && busy !== plan ? 0.5 : 1 }}>
            {busy === plan
              ? <ActivityIndicator color="#fff" />
              : (
                <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: '#fff' }}>
                  {!ready ? t('paywall.comingSoon')
                    : isSwitch ? t(cycle === 'annual' ? 'paywall.switchAnnual' : 'paywall.switchMonthly')
                    : t({ k: 'paywall.choose', p: { plan: t(('plan.' + plan) as any) } } as any)}
                </Text>
              )}
          </Pressable>
          </>
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

          {/* THE BANNER IS ABOUT SUBSCRIPTIONS, NOT ABOUT THIS SCREEN.
              `ready` is `billingStatus() === 'ready'`, which is the STORE SDK — a release
              build carrying a test key discards it deliberately (billing.ts), so on
              TestFlight this is on. It has nothing to say about the packs below: those
              are bought through a web link and need no SDK at all.

              It sat at the top of the screen reading as "nothing here works", which is
              what sent hadar looking for the pay-as-you-go section on 2026-08-19. Moved
              under the packs and reworded to name what is actually unavailable. */}
          {!ready && !props.packs?.length && (
            <View style={{ backgroundColor: C.brandSoft, borderRadius: 12, padding: 14, marginBottom: 16 }}>
              <Text style={{ fontFamily: F.body, fontSize: 13.5, color: C.brandDark }}>{t('paywall.notLive')}</Text>
            </View>
          )}

          {/* THE CYCLE SWITCH. One control, above all three cards — see the note on
              `cycle`. Rendered as two halves of a single pill so it reads as one
              either/or choice rather than two buttons, and sized past the touch-target
              floor because this is a gloved thumb on a jobsite. */}
          <View style={{ flexDirection: 'row', backgroundColor: C.surfaceMuted,
            borderRadius: 12, padding: 4, marginBottom: 16 }}>
            {(['monthly', 'annual'] as const).map((c) => {
              const on = cycle === c;
              return (
                <Pressable key={c} onPress={() => setCycle(c)} disabled={!!busy}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  style={{ flex: 1, minHeight: 44, borderRadius: 9,
                    backgroundColor: on ? C.card : 'transparent',
                    alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 }}>
                  <Text style={{ fontFamily: on ? F.bodyBold : F.body, fontSize: 15,
                    color: on ? C.ink : C.steel }}>
                    {t(c === 'annual' ? 'paywall.annual' : 'paywall.monthly')}
                  </Text>
                  {c === 'annual' && best > 0 && (
                    <Text style={{ fontFamily: F.bodySemi, fontSize: 12,
                      color: on ? C.brandDark : C.steel }}>
                      {t({ k: 'paywall.saveUpTo', p: { pct: String(best) } } as any)}
                    </Text>
                  )}
                </Pressable>
              );
            })}
          </View>

          {card('free')}

          {/* PAY AS YOU GO — between the trial and the subscriptions, because that is the
              order the ladder actually reads: you have a trial, you buy more when you
              need them, you stop counting when the business is working.

              THE PACK IS CHOSEN AT THE CHECKOUT, not here, and that is not a shortcut:
              the RevenueCat purchase link opens the offering with every pack on it, so
              three rows that each opened the same page would be three buttons pretending
              to be different. The ladder is shown so the decision is INFORMED before he
              leaves the app — including the per-change-order figure, which is the only
              number that makes a bigger pack obviously better. */}
          {!!props.packs?.length && (
            <View style={{ backgroundColor: C.card, borderRadius: 16, borderWidth: 1,
              borderColor: C.line, padding: 18, marginBottom: 12 }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 20, color: C.ink }}>
                {t('paywall.payg.title')}
              </Text>
              <Text style={{ fontFamily: F.body, fontSize: 14, color: C.steel, marginTop: 4 }}>
                {t('paywall.payg.sub')}
              </Text>

              <View style={{ marginTop: 14 }}>
                {props.packs.map((p, i) => {
                  // The last pack is the cheapest per change order — `pricingconfig`
                  // orders them by what they grant, so this is a property of the list
                  // rather than a hardcoded id.
                  const best = i === (props.packs!.length - 1);
                  return (
                    <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center',
                      paddingVertical: 9,
                      borderTopWidth: i === 0 ? 0 : 1, borderTopColor: C.line }}>
                      <Text style={{ fontFamily: F.dispSemi, fontSize: 17, color: C.ink,
                        width: 38 }}>{String(p.credits)}</Text>
                      <Text style={{ fontFamily: F.body, fontSize: 14, color: C.steel, flex: 1 }}>
                        {t({ k: 'paywall.payg.each', p: { each: perCredit(p) } } as any)}
                      </Text>
                      {best && (
                        <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5,
                          color: C.brandDark, backgroundColor: C.brandSoft,
                          paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6,
                          overflow: 'hidden', marginRight: 8 }}>
                          {t('paywall.payg.best')}
                        </Text>
                      )}
                      <Text style={{ fontFamily: F.dispSemi, fontSize: 17, color: C.ink }}>
                        {packMoney(p.web)}
                      </Text>
                    </View>
                  );
                })}
              </View>

              {/* NO DOOR IS BETTER THAN A DOOR TO A 404 — `onBuyCredits` is null when the
                  web rail has no address. The prices above still stand on their own. */}
              {props.onBuyCredits && (
                <Pressable onPress={props.onBuyCredits}
                  style={({ pressed }) => [{ marginTop: 14, minHeight: 50, borderRadius: 12,
                    backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' },
                    pressed && { opacity: 0.85 }]}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: '#fff' }}>
                    {t('paywall.payg.buy')}
                  </Text>
                </Pressable>
              )}
              {typeof props.creditsLeft === 'number' && (
                <Text style={{ fontFamily: F.body, fontSize: 13, color: C.steel,
                  textAlign: 'center', marginTop: 8 }}>
                  {t({ k: props.creditsLeft === 1 ? 'credits.one' : 'credits.n',
                       p: { n: String(props.creditsLeft) } } as any)}
                </Text>
              )}
            </View>
          )}

          {/* Scoped to the tiers it describes. When packs ARE available the screen is not
              "not live" — one half of it sells today. */}
          {!ready && !!props.packs?.length && (
            <View style={{ backgroundColor: C.brandSoft, borderRadius: 12, padding: 14,
              marginBottom: 12 }}>
              <Text style={{ fontFamily: F.body, fontSize: 13.5, color: C.brandDark }}>
                {t('paywall.subsNotLive')}
              </Text>
            </View>
          )}
          {offeredTiers(props.currentPlan).map(card)}

          {note && <Text style={{ fontFamily: F.body, fontSize: 13, color: C.steel, marginTop: 4 }}>{note}</Text>}

          {/* CHANGE OR CANCEL. Shown whenever there is a paid plan to change — the one
              control that lets somebody stop paying. Apple owns the act; this is the
              door to it, and App Store guideline 3.1.2 requires the door to exist. */}
          {props.currentPlan !== 'free' && (
            <Pressable
              onPress={() => void manageSubscriptionUrl().then((u) => Linking.openURL(u).catch(() => {}))}
              style={{ minHeight: 46, alignItems: 'center', justifyContent: 'center', marginTop: 10 }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 15, color: C.ink,
                textDecorationLine: 'underline' }}>
                {t('paywall.manage')}
              </Text>
            </Pressable>
          )}

          <Pressable onPress={restore} disabled={!!busy}
            style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 8 }}>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: C.steel }}>{t('paywall.restore')}</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}
