/**
 * WHAT THIS COMPANY HAS PAID FOR — the client half of the `invoices` function.
 *
 * hadar, 2026-08-18: "need to add billing section for the one that owns the account —
 * display all the invoices."
 *
 * ─── IT ASKS THE SERVER, AND THE SERVER DECIDES WHO MAY SEE IT ──────────────────
 * The owner check is `company.owner_id = the caller`, evaluated in the Edge Function with
 * the service key. Nothing here decides entitlement: a client that could decide it was
 * the owner is a client that could read another company's billing. `not_owner` comes back
 * as a distinct, renderable reason so a crew member is TOLD it is the owner's screen
 * rather than shown an empty list and left to conclude the app is broken.
 *
 * ─── AN UNREADABLE HISTORY IS NOT AN EMPTY ONE ──────────────────────────────────
 * The single most important distinction in this file. A network failure, a missing key
 * or a provider outage must never render as "no invoices" — that tells a contractor who
 * has paid us for a year that he has never bought anything, on the one screen where being
 * wrong about money is unforgivable. `null` is unknown, `[]` is genuinely none, and the
 * screen says something different for each.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type Invoice = {
  id: string;
  atMs: number | null;
  product: string;
  /** Cents. NULL means the provider did not tell us — rendered as absent, never as $0. */
  amountCents: number | null;
  currency: string;
  store: string;
  kind: 'purchase' | 'subscription';
  status: string | null;
};

export type BillingHistory =
  | { ok: true; invoices: Invoice[]; partial: boolean }
  | { ok: false; reason: 'not_owner' | 'no_company' | 'unavailable' };

export async function billingHistory(supabase: SupabaseClient): Promise<BillingHistory> {
  try {
    const { data, error } = await supabase.functions.invoke('invoices', { body: {} });
    if (error) {
      // `functions.invoke` reports a non-2xx as an error and hides the body, so the
      // owner refusal has to be recovered from the context rather than read off `data`.
      const status = (error as { context?: { status?: number } })?.context?.status;
      if (status === 403) return { ok: false, reason: 'not_owner' };
      return { ok: false, reason: 'unavailable' };
    }
    const d = data as Record<string, unknown> | null;
    if (!d || d.ok !== true) {
      const why = String((d as { error?: string } | null)?.error ?? '');
      if (why === 'not_owner') return { ok: false, reason: 'not_owner' };
      if (why === 'no company') return { ok: false, reason: 'no_company' };
      return { ok: false, reason: 'unavailable' };
    }
    return {
      ok: true,
      invoices: Array.isArray(d.invoices) ? (d.invoices as Invoice[]) : [],
      partial: d.partial === true,
    };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

/**
 * Where the actual RECEIPT lives, which is never with us.
 *
 * An App Store purchase is billed by Apple, and its receipt is in the buyer's own Apple
 * account — we can neither render it nor email it, and pretending otherwise would send a
 * contractor looking for a document we cannot produce. A web purchase is billed through
 * RevenueCat's Stripe account, which emails a receipt at the time of sale.
 *
 * So this returns a DESTINATION, not a document, and null when we genuinely have nowhere
 * to send him.
 */
export function receiptUrlFor(inv: Invoice): string | null {
  const s = inv.store.toLowerCase();
  if (s.includes('app_store') || s.includes('ios') || s.includes('mac')) {
    // Apple's own purchase history. The only address that exists for an IAP receipt.
    return 'https://apps.apple.com/account/billing';
  }
  if (s.includes('play')) return 'https://play.google.com/store/account/orderhistory';
  return null;
}

/** "$79.00" — or null when the amount is unknown, so the caller omits the line rather
 *  than printing a figure nobody charged. */
export function invoiceAmount(inv: Invoice): string | null {
  if (inv.amountCents === null || inv.amountCents === undefined) return null;
  const n = (inv.amountCents / 100).toFixed(2);
  return inv.currency === 'USD' ? `$${n}` : `${n} ${inv.currency}`;
}

/**
 * Is this row still money the contractor has? A refund is the one status that changes
 * what the line MEANS, so it is called out rather than left inside a status string he
 * would have to interpret.
 */
export function isRefunded(inv: Invoice): boolean {
  const s = (inv.status ?? '').toLowerCase();
  return s.includes('refund') || s.includes('revoked');
}
