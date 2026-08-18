/**
 * The app's side of the credit model: what can I send, and hold one while I send it.
 *
 * ─── IT ASKS THE SERVER, ALWAYS ─────────────────────────────────────────────────
 * There is no local balance and there must not be one. A client that can compute its own
 * balance is a client that can grant itself credits, and `quota.ts` already documents
 * what happens when a device-local value becomes an authority over money
 * (`currentPlan()` takes a max over a writable cache — safe for "is this tier
 * unlimited", not safe for anything spendable).
 *
 * ─── OFFLINE IS NOT A REFUSAL ───────────────────────────────────────────────────
 * hadar, 2026-08-17: "queue it — but needs to prompt the user letting them know that
 * they cannot send if they don't have credits."
 *
 * So an unreachable server yields `available: null` — UNKNOWN, not zero — and
 * `sendgate.decideSend` treats unknown as sendable. A contractor in a basement who
 * bought credits yesterday must not be blocked by a number we failed to fetch. The
 * server reserves on its own terms when the send actually goes; the worst case is a
 * queued send, which is the designed outcome anyway.
 */
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';
import type { SupabaseClient } from '@supabase/supabase-js';

export type CreditBalance = {
  /** False for an unlimited subscription — the gate then never consults a number. */
  metered: boolean;
  plan: string;
  /** Free signed change orders still available. */
  freeLeft: number;
  /** Purchased credits. NULL means the balance could not be read — never rendered as 0. */
  purchased: number | null;
  /** Paid reservations already held against sends awaiting signature. */
  open: number;
  /** freeLeft + purchased − open, or null when unlimited OR unknown. */
  available: number | null;
};

export type ReserveResult =
  | { ok: true; reserved: boolean; free?: boolean; already?: boolean; reason?: string }
  | { ok: false; reason: string };

async function call(
  supabase: SupabaseClient, body: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  try {
    const { data, error } = await supabase.functions.invoke('credits', { body });
    if (error) return null;
    return (data ?? null) as Record<string, unknown> | null;
  } catch {
    return null;
  }
}

/** What this account can send. Null fields mean unknown, never zero. */
export async function creditBalance(supabase: SupabaseClient): Promise<CreditBalance | null> {
  const d = await call(supabase, { action: 'balance' });
  if (!d || d.ok !== true) return null;
  const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
  return {
    metered: d.metered === true,
    plan: String(d.plan ?? 'free'),
    freeLeft: num(d.freeLeft) ?? 0,
    purchased: num(d.purchased),
    open: num(d.open) ?? 0,
    available: num(d.available),
  };
}

/**
 * Hold a credit for this change order.
 *
 * `reserved: false` with `reason: 'no_credits'` is the QUEUE signal, not an error — the
 * caller tells the contractor and holds the send. `reason: 'unlimited'` means the plan
 * does not meter and nothing was held, which is equally a success.
 *
 * IDEMPOTENT BY CONSTRUCTION: reserving the same extra twice returns `already: true` and
 * draws nothing down, which is what makes revise-and-resend cost exactly one credit.
 */
export async function reserveCredit(
  supabase: SupabaseClient, changeOrderId: string
): Promise<ReserveResult> {
  const d = await call(supabase, { action: 'reserve', changeOrderId });
  // A NETWORK FAILURE IS NOT A REFUSAL. Reporting `reserved: false` here would queue a
  // send that the server would happily have taken; the send proceeds and the server
  // settles it. Under-reserving is recoverable, a blocked send on a jobsite is not.
  if (!d) return { ok: true, reserved: false, reason: 'unreachable' };
  if (d.ok !== true) return { ok: false, reason: String(d.error ?? 'reserve failed') };
  return {
    ok: true,
    reserved: d.reserved === true,
    free: d.free === true,
    already: d.already === true,
    reason: d.reason ? String(d.reason) : undefined,
  };
}

/**
 * Give the credit back — the contractor cancelled, or the extra was superseded.
 *
 * A DECLINE DOES NOT COME THROUGH HERE. That path is handled server-side by the settle
 * trigger (412) precisely so it cannot depend on this app being open when the client
 * answers.
 */
export async function releaseCredit(
  supabase: SupabaseClient, changeOrderId: string,
  reason: 'CANCELLED' | 'EXPIRED' = 'CANCELLED'
): Promise<boolean> {
  const d = await call(supabase, { action: 'release', changeOrderId, reason });
  return d?.ok === true;
}

/**
 * The balance as one line a contractor reads, or null when there is nothing worth
 * saying.
 *
 * Returns an i18n key + params rather than a string: this module holds no copy, for the
 * same reason `flowterms.ts` does not — a sentence built here would be English on a
 * Spanish-speaking contractor's phone (mandate #5).
 */
export function balanceLine(b: CreditBalance | null): { k: string; p: Record<string, string> } | null {
  // Unlimited says nothing. A subscriber does not need a counter, and putting one on
  // screen invents a limit he does not have.
  if (!b || !b.metered) return null;
  if (b.available === null) return null;              // unknown — say nothing, not zero
  if (b.available <= 0) return { k: 'credits.none', p: {} };
  if (b.available === 1) return { k: 'credits.one', p: {} };
  return { k: 'credits.n', p: { n: String(b.available) } };
}

/* ─────────────────────────── has this account ever paid ─────────────────────── */

/**
 * STICKY, AND ONLY EVER SET TO TRUE.
 *
 * `entitlement.ts` needs to know whether this account has ever bought credits, and it
 * needs to know OFFLINE — the send gate runs on a jobsite. `purchased` is a live balance
 * and cannot answer the question: a contractor who buys twenty and spends all twenty
 * reads as zero, and re-imposing a 30-photo trial cap on a customer who has paid us is
 * exactly the failure this whole model exists to prevent.
 *
 * So the fact is recorded the first time we see evidence of it and never unset. It cannot
 * grant anything on its own — the BALANCE is still the server's answer and still gates
 * every send — it only decides whether the trial's photo and recording caps still apply.
 * The worst a wrong `true` can do is stop counting photographs, which is not a thing
 * anyone can spend.
 *
 * STATED BOUNDARY: it is device-local, so a reinstall forgets it. The next balance read
 * that shows a purchased credit sets it again; an account that has spent every credit it
 * ever bought would go back to the trial caps until it buys another. Recording it
 * server-side is the real fix and is a migration, not a line.
 */
const PAID_KEY = 'credits_ever_purchased';

export async function notePurchasedEver(db: AbstractPowerSyncDatabase): Promise<void> {
  try {
    await db.execute(
      `INSERT INTO device_settings (k, v) VALUES (?, 'yes')
       ON CONFLICT(k) DO UPDATE SET v = 'yes'`, [PAID_KEY]);
  } catch { /* the balance still gates every send; this only lifts trial caps */ }
}

export async function purchasedEver(db: AbstractPowerSyncDatabase): Promise<boolean> {
  try {
    const r = (await db.getAll<{ v: string }>(
      `SELECT v FROM device_settings WHERE k = ?`, [PAID_KEY]))[0];
    return r?.v === 'yes';
  } catch {
    return false;
  }
}

/**
 * Read the balance and record what it implies. The one call the app should make.
 *
 * Separate from `creditBalance` so the pure network read stays testable and so the
 * side-effect is visible at the call site rather than hidden inside a getter.
 */
export async function refreshBalance(
  db: AbstractPowerSyncDatabase, supabase: SupabaseClient
): Promise<CreditBalance | null> {
  const b = await creditBalance(supabase);
  if (b && (b.purchased ?? 0) > 0) await notePurchasedEver(db);
  return b;
}
