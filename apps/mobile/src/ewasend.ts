/**
 * R3 step one — sending the Extra Work Authorization for signature.
 *
 * Split from `ewastore.ts` the way `confirmations.ts` is split from
 * `changeorder.ts`: storing a record and putting a signable link in a client's
 * hands are different acts with different failure modes, and only one of them
 * needs the network.
 *
 * MANDATE #2. Nothing in this file runs on a timer, a heuristic or a sync. It is
 * called from a button the contractor pressed, once, per authorization.
 *
 * MANDATE #5. `renderEwaCard` renders the words ONCE, here, and the server freezes
 * them. The homeowner page re-renders the *presentation* from structured terms, but
 * the instrument is the frozen text and the page shows it verbatim under "See the
 * exact wording" — the same arrangement the priced approval already uses.
 */
import { SupabaseClient } from '@supabase/supabase-js';
import { sha256 } from 'js-sha256';
import { money } from './changeorder';
import { renderEwaCard, validateEwaTerms, type EwaTerms } from './ewa';

export type SendEwaResult =
  | { ok: true; token: string; url: string; shownContent: string }
  | { ok: false; reason: string };

/**
 * Put the authorization in front of the client.
 *
 * `kind: 'ewa'` is what makes AC2's labelling possible end to end: the web page
 * dispatches on it and renders "Extra Work Authorization" rather than the priced
 * change-order report. The value is added to confirmation_request's CHECK in
 * 300_ewa.sql; without that migration this call fails loudly at the DB rather than
 * silently sending an EWA dressed as a change order, which is the right way round.
 *
 * `p_amount_cents` is NULL, not 0, and that is load-bearing twice over.
 *   1. Step one has no price (R3). A zero would render as "$0.00" on the client's
 *      page and read as "this extra is free".
 *   2. 240_shown_content_integrity requires any non-null amount to appear
 *      LITERALLY in the frozen wording. The EWA text names no price, so a zero
 *      would make every send fail the integrity trigger.
 * `p_nte_cents` DOES carry the T&M cap, so that same trigger checks the cap string
 * is present in the signed text — the one figure the client is held to.
 */
export async function sendEwa(
  supabase: SupabaseClient,
  o: {
    ewaChangeOrderId: string; decisionId: string; projectId: string;
    projectName: string; scope: string; directedBy: string; counterparty: string;
    terms: EwaTerms;
    channel: 'email' | 'sms' | 'link'; destination?: string;
    whenMs: number; linkBase: string;
    companyName?: string | null;
  }
): Promise<SendEwaResult> {
  // Refuse before writing anything, for the reason sendForConfirmation documents:
  // without a base the URL is a relative path nobody can open, and the refusal
  // would otherwise arrive AFTER a token was minted and 230 had moved the change
  // order to 'sent' — a link that cannot work, for a request marked delivered.
  if (!o.linkBase) {
    return { ok: false, reason: 'No confirmation page is configured (EXPO_PUBLIC_CONFIRM_BASE)' };
  }
  // Checked again here even though createEwa checked it. The terms can only have
  // come from storage, but this is the last moment before a human is asked to sign
  // them, and an uncapped T&M authorization is not a thing that should be
  // recoverable by any path.
  const bad = validateEwaTerms(o.terms);
  if (bad) return { ok: false, reason: bad.k };

  const shownContent = renderEwaCard({
    terms: o.terms,
    // ONE money formatter for the whole app — see the header note in ewa.ts.
    money: o.terms.proceed === 'tm_capped'
      ? { hourlyRate: money(o.terms.hourlyRateCents!), cap: money(o.terms.capCents!) }
      : undefined,
    scope: o.scope, directedBy: o.directedBy, projectName: o.projectName,
    whenMs: o.whenMs, companyName: o.companyName ?? null,
  });

  const token = newToken();
  const { error } = await supabase.rpc('confirmation_create', {
    p_token: token,
    p_decision_id: o.decisionId,
    p_project_id: o.projectId,
    p_kind: 'ewa',
    p_shown_content: shownContent,
    p_shown_sha256: sha256(shownContent),
    p_counterparty: o.counterparty,
    p_channel: o.channel,
    p_destination: o.destination ?? null,
    p_amount_cents: null,                 // step one has no price. See above.
    p_nte_cents: o.terms.proceed === 'tm_capped' ? o.terms.capCents ?? null : null,
    p_scope_title: o.scope,
    p_company_name: o.companyName ?? null,
    p_job_label: o.projectName,
    // Deliberately NOT sent: the running approved total belongs on a priced
    // approval, where the client is being asked to add to it. On an authorization
    // with no price it would imply this document adds to that figure.
    p_approved_running_cents: null,
    p_change_order_id: o.ewaChangeOrderId,
  });
  if (error) return { ok: false, reason: error.message };

  return { ok: true, token, url: `${o.linkBase}/confirm.html?t=${token}`, shownContent };
}

function newToken(): string {
  // The token is the credential (REQ-VAL3), so it needs real entropy. 160 bits.
  const a = new Uint8Array(20);
  (globalThis.crypto as any).getRandomValues(a);
  return Array.from(a).map((b) => b.toString(16).padStart(2, '0')).join('');
}
