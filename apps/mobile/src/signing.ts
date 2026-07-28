/**
 * Signature-grade approval — SPEC §7.1.
 *
 * "approval = a digital signature (a binding, verifiable sign-off), distinct
 *  from the unsigned verify/confirm step. Identity binding: SMS OTP to the
 *  number the contractor entered + typed legal name + timestamp + a hash of
 *  shown_content."
 *
 * Four things make a signature, and the DB refuses it without all four:
 *   1. OTP verified against the number the CONTRACTOR entered (not one the
 *      signer supplies — otherwise anyone can nominate their own phone)
 *   2. typed legal name
 *   3. timestamp
 *   4. hash of the exact text they saw
 *
 * (4) is the one people get wrong. Storing "approved: true" against a mutable
 * change order proves nothing later, because the CO can change. Storing the
 * frozen bytes they read, hashed, proves what they agreed to. That is why
 * shown_content is frozen by trigger and why `grade in ('signature','priced')`
 * carries a check constraint rather than a comment asking nicely.
 */
import { SupabaseClient } from '@supabase/supabase-js';
import { sha256 } from 'js-sha256';
import { canTransition } from './extralifecycle.ts';

/** The exact words the signer reads. Rendered once, hashed, frozen. */
export function renderApproval(o: {
  scope: string; amount: string; nte?: string | null;
  whoDirected: string; refEstimate?: string | null; projectName: string;
}): string {
  return [
    `Approve this change order`,
    ``,
    o.scope,
    ``,
    `${o.amount}${o.nte ? `  (not to exceed ${o.nte})` : ''}`,
    ``,
    `Directed by: ${o.whoDirected}`,
    `Job: ${o.projectName}`,
    o.refEstimate ? `Estimate: ${o.refEstimate}` : null,
    ``,
    `By typing your legal name you are signing this change order.`,
  ].filter((l) => l !== null).join('\n');
}

/** 6 digits. Sent to the number the CONTRACTOR entered, never one the signer picks. */
export function newOtpCode(): string {
  const a = new Uint8Array(4);
  (globalThis.crypto as any).getRandomValues(a);
  const n = ((a[0] << 24) | (a[1] << 16) | (a[2] << 8) | a[3]) >>> 0;
  return (n % 1_000_000).toString().padStart(6, '0');
}

export async function issueOtp(
  supabase: SupabaseClient, token: string, phoneE164: string, code: string
) {
  // Only the HASH is stored. A DB dump must not hand over live codes.
  const { data, error } = await supabase.rpc('otp_issue', {
    p_token: token, p_phone: phoneE164, p_code_sha256: sha256(code),
  });
  if (error) return { ok: false as const, reason: error.message };
  return { ok: true as const, status: data?.status };
}

export async function verifyOtp(supabase: SupabaseClient, token: string, code: string) {
  const { data, error } = await supabase.rpc('otp_verify', {
    p_token: token, p_code_sha256: sha256(code),
  });
  if (error) return { ok: false as const, reason: error.message };
  return { ok: true as const, status: data?.status, attemptsLeft: data?.attempts_left };
}

export type SignResult = { ok: true; id: string } | { ok: false; reason: string };

/**
 * Record the signature. Every identity field is required here because it is
 * required by `approval_signature_binding` in the DB — this function cannot
 * produce a row the constraint would reject, by construction.
 *
 * THE SERVER HALF OF DEF-1 IS FIXED HERE. The status write was a bare
 * `.update({status}).eq('id', …)` with no precondition, so a `superseded` version
 * (retired, its link already killed by 307) or a `declined` one (a client's
 * recorded NO) walked to `approved`, with a freshly-filed signature row making it
 * look legitimate. The typed-link path (230_close_the_loop.sql:112) has always
 * carried `AND status IN ('draft','sent')`; this path never did. Two guards now do:
 * `canTransition` refuses before anything is written, and `.in('status', …)` on the
 * update is what protects the row against an answer that lands mid-call.
 *
 * THE WRITE ORDER IS DELIBERATELY UNCHANGED — signature first, status second — and
 * that is a decision, not an oversight. DEF-1's note suggested refusing the approval
 * insert when the status update moves nothing, which would mean moving the status
 * first; that ordering trades this defect for a worse one, because these are two
 * PostgREST calls with no transaction between them: an approval insert that fails
 * after the status has moved leaves a change order reading `approved` with NO
 * signature behind it, which is the same lie DEF-1 tells, arriving from the other
 * side. Keeping the signature first means the failure mode is a recorded signature
 * whose status did not move — evidence that survives and a status that is merely
 * behind. REQ-LC44 already names that outcome as the correct one: when two answers
 * race, "the loser is recorded as evidence and does not move the status".
 *
 * Closing the gap properly needs ONE RPC doing both writes in a transaction, the
 * way 230 does for the link path. That is owed work, and it is named here rather
 * than hidden.
 *
 * REFUSING WHEN THE ROW IS NOT ON THE SERVER YET IS NOT A NEW WAY TO LOSE A
 * SIGNATURE, and it was checked rather than assumed: `approval.change_order_id`
 * references `change_order`, so an insert against a row that has not drained out of
 * the outbox fails on the foreign key regardless. This says so in words instead of
 * as a constraint violation.
 */
export async function signApproval(
  supabase: SupabaseClient,
  o: {
    changeOrderId: string; projectId: string; shownContent: string;
    signerLabel: string; legalName: string; phoneE164: string;
    otpVerifiedAt: string; action: 'approved' | 'declined'; userAgent?: string;
  }
): Promise<SignResult> {
  const { data: co, error: readErr } = await supabase
    .from('change_order').select('status').eq('id', o.changeOrderId).maybeSingle();
  if (readErr) return { ok: false, reason: readErr.message };
  if (!co) {
    return { ok: false, reason: 'this extra has not reached the server yet — try again once it syncs' };
  }
  if (!canTransition(co.status, o.action)) {
    return { ok: false, reason: `this extra is ${co.status} and cannot be ${o.action}` };
  }

  const id = `ap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const { error } = await supabase.from('approval').insert({
    id,
    change_order_id: o.changeOrderId,
    project_id: o.projectId,
    grade: 'priced',
    shown_content: o.shownContent,          // the binding instrument
    shown_sha256: sha256(o.shownContent),
    signer_label: o.signerLabel,
    legal_name: o.legalName.trim(),
    phone_e164: o.phoneE164,
    otp_verified_at: o.otpVerifiedAt,
    action: o.action,
    user_agent: o.userAgent ?? null,
  });
  if (error) return { ok: false, reason: error.message };

  // Reflect the outcome onto the CO. Its price and scope are already frozen by
  // trigger once sent, so this can only move `status` — and now only from a status
  // REQ-LC7 permits to move. `.select('id')` is what makes a refusal visible:
  // without it PostgREST returns no rows whether it matched or not, so "the client
  // answered a second before you did" and "it worked" look identical.
  const { data: moved, error: updErr } = await supabase.from('change_order')
    .update({ status: o.action })
    .eq('id', o.changeOrderId)
    .in('status', ['draft', 'sent'])
    .select('id');
  if (updErr) return { ok: false, reason: updErr.message };
  if (!moved?.length) {
    // REQ-LC8/REQ-LC44: reported, never swallowed. The signature above is kept —
    // it is evidence that this person signed this text — but the earlier answer
    // stands, and the caller must not go on to move the local row either.
    return { ok: false,
      reason: 'this extra was answered first — your signature is recorded, but the earlier answer stands' };
  }

  return { ok: true, id };
}
