/**
 * Send a decision to the counterparty — REQ-VAL1/2/3/8.
 *
 * The one rule that shapes this file (CLAUDE.md mandate #5):
 *   "the frozen rendered text the signer actually saw (`shown_content`) is the
 *    binding instrument"
 *
 * So the card text is rendered ONCE, hashed, and frozen server-side at send.
 * REQ-VAL5 guarantees the decision WILL change later — that is the product. If
 * the confirmation re-rendered against current state, then in the only moment it
 * matters (a dispute), it would evidence the wrong thing. The DB enforces this:
 * updating shown_content raises "shown_content is frozen".
 *
 * No-login (REQ-VAL3) is deliberate: a GC or owner will never make an account.
 * The token IS the credential. That trade is stated honestly rather than dressed
 * up — we record an identity SIGNAL (user agent, timestamp), not identity proof.
 */
import { SupabaseClient } from '@supabase/supabase-js';
import { sha256 } from 'js-sha256';

export type SendKind = 'confirm' | 'acknowledge';

/**
 * The exact words the counterparty will see. Rendered once, here, and never
 * again. Plain language on purpose: the reader is an owner on a phone, not a
 * user of this app.
 */
export function renderCard(o: {
  kind: SendKind; subject: string; value: string; directedBy: string;
  projectName: string; whenMs: number;
}): string {
  const when = new Date(o.whenMs).toLocaleString();
  return o.kind === 'confirm'
    ? `Please confirm this is what we agreed.\n\n` +
      `${o.subject}: ${o.value}\n\n` +
      `Directed by: ${o.directedBy}\nJob: ${o.projectName}\nRecorded: ${when}`
    : `Please acknowledge you directed this.\n\n` +
      `${o.subject}: ${o.value}\n\n` +
      `Directed by: ${o.directedBy}\nJob: ${o.projectName}\nRecorded: ${when}`;
}

function newToken(): string {
  // The token is the credential, so it needs real entropy. 160 bits.
  const a = new Uint8Array(20);
  (globalThis.crypto as any).getRandomValues(a);
  return Array.from(a).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type SendResult =
  | { ok: true; token: string; url: string; shownContent: string }
  | { ok: false; reason: string };

/**
 * REQ-VAL2 — sub<->GC directive: capture a directive with who-directed + scope
 *   (+ the change order's optional NTE) and send an "acknowledge you directed
 *   this" card. The 'acknowledge' kind is that path.
 */
export async function sendForConfirmation(
  supabase: SupabaseClient,
  o: {
    kind: SendKind; decisionId: string; projectId: string; projectName: string;
    subject: string; value: string; directedBy: string; counterparty: string;
    channel: 'email' | 'sms' | 'link'; destination?: string; whenMs: number;
    linkBase: string;
  }
): Promise<SendResult> {
  const shownContent = renderCard(o);
  const token = newToken();

  const { error } = await supabase.rpc('confirmation_create', {
    p_token: token,
    p_decision_id: o.decisionId,
    p_project_id: o.projectId,
    p_kind: o.kind,
    p_shown_content: shownContent,          // frozen from here on
    p_shown_sha256: sha256(shownContent),
    p_counterparty: o.counterparty,
    p_channel: o.channel,
    p_destination: o.destination ?? null,
  });
  if (error) return { ok: false, reason: error.message };

  return { ok: true, token, url: `${o.linkBase}/c/${token}`, shownContent };
}

/** Delivery state, per REQ-VAL8 "visible to the sender". */
export async function listSent(supabase: SupabaseClient, decisionId: string) {
  const { data } = await supabase
    .from('confirmation_request')
    .select('token, kind, counterparty_label, channel, delivery_state, created_at')
    .eq('decision_id', decisionId)
    .order('created_at', { ascending: false });
  return data ?? [];
}
