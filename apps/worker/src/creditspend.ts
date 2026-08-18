/**
 * Spend the credit a signature consumed.
 *
 * ─── WHY THIS IS A WORKER AND NOT PART OF THE SIGNATURE ─────────────────────────
 * The settle trigger (412) records the signature and appends one row here, both local
 * writes inside the same transaction. It does NOT call RevenueCat, because that call
 * would sit inside the transaction that records a homeowner's signature — and a slow or
 * failing billing provider must never be able to refuse a signature.
 *
 *     Under-billing is recoverable. A failed signature is a lost change order and a
 *     lost customer.  (R-5.3)
 *
 * So the intent to charge is as durable as the signature, and the charge itself happens
 * here, on its own clock, with retries.
 *
 * ─── IDEMPOTENT, BECAUSE A DOUBLE SPEND IS THE WORST OUTCOME ────────────────────
 * Three layers, and none of them is decorative:
 *   1. `claim_credit_spend` uses `for update skip locked`, so two workers cannot hold
 *      the same row.
 *   2. Every call sends the reservation's own `idempotency_key`; RevenueCat collapses a
 *      repeat rather than deducting twice.
 *   3. A failure is left PENDING with its reason, never drained — the backoff in 412
 *      picks it up rather than a hot loop.
 *
 * A double charge is the hardest billing error to explain to a contractor and the one
 * most likely to lose him. Under-charging is a number we can fix later.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

const RC_API = 'https://api.revenuecat.com/v2';

export type SpendOutcome =
  | { drained: false }
  | { drained: true; ok: true; outboxId: number; rcTransactionId: string | null }
  | { drained: true; ok: false; outboxId: number; error: string };

/**
 * Claim ONE pending spend and settle it. Returns `{ drained: false }` when there is
 * nothing waiting, which is how the caller knows to sleep.
 *
 * One at a time on purpose, exactly like `runOnce`: concurrency belongs in how many
 * workers run, not in how many rows one worker juggles. And when the thing being
 * juggled is money, serial is worth the throughput.
 */
export async function drainOneCreditSpend(sb: SupabaseClient): Promise<SpendOutcome> {
  const projectId = process.env.REVENUECAT_PROJECT_ID ?? 'proj960cec8c';
  const key = process.env.REVENUECAT_SECRET_KEY;

  const { data, error } = await sb.rpc('claim_credit_spend');
  if (error) throw new Error(`claim_credit_spend: ${error.message}`);
  const row = (data as Array<{
    outbox_id: number; reservation_id: string; company_id: string; idempotency_key: string;
  }> | null)?.[0];
  if (!row) return { drained: false };

  // NO KEY IS A CONFIGURATION FAILURE, NOT A SPEND FAILURE. The row is left pending with
  // a reason a human can act on, rather than being retried forever against nothing.
  if (!key) {
    await sb.rpc('fail_credit_spend', {
      p_outbox_id: row.outbox_id,
      p_error: 'REVENUECAT_SECRET_KEY is not set on the worker',
    });
    return { drained: true, ok: false, outboxId: row.outbox_id, error: 'no_secret_key' };
  }

  try {
    /**
     * A NEGATIVE ADJUSTMENT IS THE SPEND. RevenueCat has no "deduct" verb — you post a
     * transaction with a negative amount, and it fails closed: an insufficient balance
     * returns 422 and deducts NOTHING. That is the behaviour this design wants, because
     * it means the database can never record a consumed credit that RevenueCat did not
     * actually take.
     */
    const resp = await fetch(
      `${RC_API}/projects/${projectId}/customers/${encodeURIComponent(row.company_id)}` +
      `/virtual_currencies/transactions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          // The reservation's identity. A retry after a timeout must not charge twice,
          // and this is what lets RevenueCat tell a retry from a second signature.
          'X-Idempotency-Key': row.idempotency_key,
        },
        body: JSON.stringify({ adjustments: { CREDIT: -1 } }),
      });

    const text = await resp.text();
    if (!resp.ok) {
      await sb.rpc('fail_credit_spend', {
        p_outbox_id: row.outbox_id,
        p_error: `rc ${resp.status}: ${text.slice(0, 300)}`,
      });
      return { drained: true, ok: false, outboxId: row.outbox_id, error: `rc_${resp.status}` };
    }

    let rcTxn: string | null = null;
    try {
      const body = JSON.parse(text);
      rcTxn = body?.transaction_id ?? body?.id ?? null;
    } catch { /* a 2xx with an unreadable body still spent the credit */ }

    await sb.rpc('settle_credit_spend', {
      p_outbox_id: row.outbox_id,
      p_rc_transaction_id: rcTxn ?? '',
    });
    return { drained: true, ok: true, outboxId: row.outbox_id, rcTransactionId: rcTxn };
  } catch (e: unknown) {
    // Transport failure. Left pending on purpose — the credit was consumed locally and
    // the charge is still owed; the backoff will bring it back.
    const msg = e instanceof Error ? e.message : String(e);
    await sb.rpc('fail_credit_spend', { p_outbox_id: row.outbox_id, p_error: msg.slice(0, 300) });
    return { drained: true, ok: false, outboxId: row.outbox_id, error: 'transport' };
  }
}
