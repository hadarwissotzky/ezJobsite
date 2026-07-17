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
 */
export async function signApproval(
  supabase: SupabaseClient,
  o: {
    changeOrderId: string; projectId: string; shownContent: string;
    signerLabel: string; legalName: string; phoneE164: string;
    otpVerifiedAt: string; action: 'approved' | 'declined'; userAgent?: string;
  }
): Promise<SignResult> {
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

  // Reflect the outcome onto the CO. The CO's price/scope are already frozen by
  // trigger once sent, so this can only move `status`.
  await supabase.from('change_order')
    .update({ status: o.action === 'approved' ? 'approved' : 'declined' })
    .eq('id', o.changeOrderId);

  return { ok: true, id };
}
