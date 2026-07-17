/**
 * Change Order client — SPEC §7.2, and the UI half of mandate #6.
 *
 * MANDATE #6 is the whole reason this file has a "read-back" step:
 *   "Numbers/prices/measurements are the highest-risk field. NEVER trust them
 *    from the transcript. Read-back + on-screen tap-to-correct. Always."
 *
 * The DB enforces that `numbers_confirmed_at` is NOT NULL, so an unconfirmed
 * price cannot be stored. This file is what makes that constraint reachable by a
 * human: parse a number OUT of what was said, show it back BIG, and make the
 * contractor look at it and agree before anything is sent.
 *
 * The parser is deliberately conservative. It would rather find nothing and make
 * someone type the figure than confidently find the wrong one — a silently wrong
 * price is the failure mode with a lawyer attached. That is why `confidence` is
 * returned and why 'low' forces the field open.
 */
import { SupabaseClient } from '@supabase/supabase-js';

export type ParsedMoney = {
  cents: number | null;
  /** low => do NOT prefill as if it were known. Make them type it. */
  confidence: 'high' | 'low' | 'none';
  matched?: string;
};

/**
 * Pull a dollar figure out of spoken/typed text.
 * "add three outlets, four fifty" is NOT parsed as $450 on purpose: spoken
 * numbers are exactly where transcription hallucinates, and a plausible-but-
 * wrong price is worse than no price.
 */
export function parseMoney(text: string): ParsedMoney {
  // $1,234.56 / $450 / 450 dollars — explicit currency markers only.
  const m = text.match(/\$\s?([\d,]+(?:\.\d{1,2})?)/)
    || text.match(/([\d,]+(?:\.\d{1,2})?)\s*(?:dollars|usd|bucks)\b/i);
  if (m) {
    const cents = Math.round(parseFloat(m[1].replace(/,/g, '')) * 100);
    if (Number.isFinite(cents) && cents >= 0) {
      return { cents, confidence: 'high', matched: m[0] };
    }
  }
  // A bare number MIGHT be a price. Surface it, but never as high confidence.
  const bare = text.match(/\b(\d{2,6}(?:\.\d{2})?)\b/);
  if (bare) {
    return { cents: Math.round(parseFloat(bare[1]) * 100), confidence: 'low', matched: bare[1] };
  }
  return { cents: null, confidence: 'none' };
}

/** Integer cents -> display. Money never becomes a float. */
export function money(cents: number | null): string {
  if (cents === null) return '—';
  const s = Math.abs(cents).toString().padStart(3, '0');
  const whole = s.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${cents < 0 ? '-' : ''}$${whole}.${s.slice(-2)}`;
}

/** Text -> integer cents. Used by the tap-to-correct field. */
export function centsFromInput(s: string): number | null {
  const clean = s.replace(/[^0-9.]/g, '');
  if (!clean) return null;
  const v = parseFloat(clean);
  if (!Number.isFinite(v) || v < 0) return null;
  return Math.round(v * 100);
}

export type CreateCOResult = { ok: true; id: string } | { ok: false; reason: string };

/**
 * Create the CO. `numbersConfirmedAt` is REQUIRED by the signature of this
 * function as well as by the DB: you cannot call it without having done the
 * read-back. Two locks on the same door, deliberately.
 */
export async function createChangeOrder(
  supabase: SupabaseClient,
  o: {
    id: string; decisionId: string; projectId: string; ownerId: string;
    scope: string; amountCents: number; nteCents?: number | null;
    whoDirected: string; refEstimate?: string | null; isMini?: boolean;
    lineItems?: Array<{ description: string; qty: number; unit_cents: number; total_cents: number }>;
    numbersConfirmedAt: Date;
  }
): Promise<CreateCOResult> {
  const { error } = await supabase.from('change_order').insert({
    id: o.id,
    decision_id: o.decisionId,
    project_id: o.projectId,
    owner_id: o.ownerId,
    scope: o.scope,
    line_items: o.lineItems ?? [],
    amount_cents: o.amountCents,
    nte_cents: o.nteCents ?? null,
    is_mini: o.isMini ? 1 : 0,
    who_directed: o.whoDirected,
    ref_estimate: o.refEstimate ?? null,
    numbers_confirmed_at: o.numbersConfirmedAt.toISOString(),
    status: 'draft',
  });
  if (error) return { ok: false, reason: error.message };
  return { ok: true, id: o.id };
}

/** §7.3 status ledger: Approved/Pending/Declined + running total. */
export async function ledger(supabase: SupabaseClient, projectId: string) {
  const { data } = await supabase
    .from('co_ledger')
    .select('id, scope, amount, nte, status, is_mini, signed_by, approved_running')
    .eq('project_id', projectId);
  return data ?? [];
}
