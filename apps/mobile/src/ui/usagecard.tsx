/**
 * The subscription-state surfaces (hadar 2026-08-04: "communicate to the user about
 * the subscription, their correct subscription state and when to upgrade, through
 * multiple points of upgrade especially between free and paid").
 *
 * TWO COMPONENTS, ONE IDEA — say where you stand before the wall, not at it.
 *
 *   <UsageNudge>  a one-line strip for the main screen. Appears only when something
 *                 is 'nearing' or 'reached', so it is silent for a user with room and
 *                 impossible to ignore for one without.
 *   <UsageCard>   the full picture for the drawer: plan name, every metered line, and
 *                 an upgrade route.
 *
 * WHY A NUDGE EXISTS AT ALL. A limit a user meets only at the moment of refusal is
 * experienced as the app breaking. The same limit, announced one action earlier, is a
 * decision they get to make — and it is the only moment where upgrading feels like a
 * choice rather than a toll. That is the whole conversion argument, and it is why
 * `severityFor` bothers to distinguish 'nearing' from 'reached'.
 *
 * IT NEVER BLOCKS ANYTHING. Both components are pure display over `usageSummary()`;
 * quota.ts still owns every yes/no. A banner that could refuse an action would be a
 * second authority, and the two would eventually disagree.
 */
import React from 'react';
import { Pressable, Text, View } from 'react-native';

import { t } from '../i18n';
import type { UsageItem, UsageSummary } from '../usage';
import { C, F } from './theme';

/** "2 of 2 photos left" — or the none-left form, which reads better than "0 of 30". */
function line(it: UsageItem): string {
  if (it.remaining <= 0) return t(('usage.none.' + it.kind) as any);
  return t({
    k: ('usage.left.' + it.kind) as any,
    p: { n: String(it.remaining), limit: String(it.limit) },
  } as any);
}

const TONE: Record<'nearing' | 'reached', { bg: string; fg: string; border: string }> = {
  // Amber = "decide now, while you still can". Red-ish = "this one is spent".
  nearing: { bg: '#F3E7D6', fg: '#6b5220', border: '#E0CDA9' },
  reached: { bg: '#F6E3DF', fg: '#7A3B32', border: '#E6C4BC' },
};

/**
 * The pre-emptive strip. Renders nothing at all when there is nothing worth saying —
 * an always-present usage bar becomes furniture, and furniture does not convert.
 */
export function UsageNudge({ summary, onUpgrade }: {
  summary: UsageSummary | null;
  onUpgrade: () => void;
}) {
  const worst = summary?.worst;
  if (!worst || worst.severity === 'ok') return null;
  const tone = TONE[worst.severity];

  return (
    <Pressable
      onPress={onUpgrade}
      accessibilityRole="button"
      accessibilityLabel={`${line(worst)}. ${t('usage.upgrade')}`}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 10,
        backgroundColor: tone.bg, borderColor: tone.border, borderWidth: 1,
        borderRadius: 12, paddingVertical: 11, paddingHorizontal: 14,
        marginHorizontal: 16, marginBottom: 12,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: tone.fg }}>
          {t(worst.severity === 'reached' ? 'usage.reachedTitle' : 'usage.nearingTitle')}
        </Text>
        <Text style={{ fontFamily: F.body, fontSize: 13.5, color: tone.fg, marginTop: 1 }}>
          {line(worst)}
        </Text>
      </View>
      {/* A visible target, not just a tappable row: the upgrade must look like the
          way out, or the banner reads as bad news with nothing to do about it. */}
      <View style={{ backgroundColor: tone.fg, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 }}>
        <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: '#fff' }}>
          {t('usage.upgrade')}
        </Text>
      </View>
    </Pressable>
  );
}

/**
 * The full state, for the drawer. Shows the plan by name — a paying user should see
 * what they are paying for, not only what they are running out of — then every metered
 * line, then a route to plans.
 */
export function UsageCard({ summary, planLabel, onSeePlans }: {
  summary: UsageSummary | null;
  /** Already localised (`plan.<id>`), because the tier name is not this file's job. */
  planLabel: string;
  onSeePlans: () => void;
}) {
  if (!summary) return null;
  const paid = summary.plan !== 'free';

  return (
    <View style={{
      borderWidth: 1, borderColor: C.line, borderRadius: 14,
      padding: 14, marginTop: 10, backgroundColor: C.card,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <Text style={{ fontFamily: F.body, fontSize: 12.5, color: C.steel, letterSpacing: 0.6 }}>
          {t('usage.yourPlan').toUpperCase()}
        </Text>
        <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: paid ? C.brand : C.ink }}>
          {planLabel}
        </Text>
      </View>

      {summary.items.length > 0 && (
        <View style={{ marginTop: 10, gap: 5 }}>
          {summary.items.map((it) => (
            <Text
              key={it.kind}
              style={{
                fontFamily: it.severity === 'ok' ? F.body : F.bodySemi,
                fontSize: 13.5,
                color: it.severity === 'reached' ? '#7A3B32'
                  : it.severity === 'nearing' ? '#6b5220' : C.steel,
              }}
            >
              {line(it)}
            </Text>
          ))}
        </View>
      )}

      {/* Offered on EVERY tier, not just free. A Core owner who needs a fourth seat is
          an upgrade too, and hiding the route until they hit the wall wastes it. */}
      <Pressable onPress={onSeePlans} style={{ minHeight: 44, justifyContent: 'center', marginTop: 8 }}>
        <Text style={{ fontFamily: F.bodySemi, fontSize: 14.5, color: C.brand }}>
          {summary.anyReached ? t('usage.upgrade') : t('usage.seePlans')} ›
        </Text>
      </Pressable>
    </View>
  );
}

/**
 * The crown that marks a row as needing a paid plan.
 *
 * BORROWED FROM HANDOFF, WITH RESTRAINT (hadar 2026-08-04). Their settings screen
 * crowns seven-plus rows — Templates, Catalogs, QuickBooks, Roles, Project statuses —
 * and at that density the mark stops meaning "premium" and starts meaning "most of
 * this app is not for you". For a user who by definition does not think in software
 * (CLAUDE.md §1), a mostly-locked settings screen reads as broken rather than
 * aspirational.
 *
 * So: crown ONLY what is genuinely gated, and prefer showing the row to hiding it. A
 * hidden feature teaches nothing; a crowned one is an advertisement the user can act
 * on, which is the whole reason the pattern is worth taking at all.
 *
 * THE STRUCTURAL DIFFERENCE, stated because it decides where this may be used:
 * Handoff gates FEATURES (you have Catalogs or you don't). We gate VOLUME (2 change
 * orders, 30 photos). A crown on a volume-metered row would be a lie — the user is
 * not locked out of sending, they have a number remaining. Volume belongs in
 * <UsageCard>/<UsageNudge>; the crown is for capabilities a plan does not include.
 */
export function LockCrown({ size = 18 }: { size?: number }) {
  return (
    <View
      accessibilityLabel={t('usage.paidFeature')}
      style={{
        width: size + 8, height: size + 8, borderRadius: (size + 8) / 2,
        backgroundColor: '#FBF0DA', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <Text style={{ fontSize: size - 4, color: '#C8871A' }}>♛</Text>
    </View>
  );
}
