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
// The explicit .ts extension is load-bearing: confirmations.test.ts runs under
// node --test, which resolves no extensionless imports (same rule as
// discussion.ts). Metro and tsc both accept it.
import { money } from './changeorder.ts';
// The flow terms are worded ONCE, in flowterms.ts, because renderEwaCard signs the
// same sentences. Two copies of a term in a frozen instrument is the drift this
// file spends thirty lines below documenting the cost of.
import { flowTermLines, type FlowTerms } from './flowterms.ts';
import { LANG_PACK, type SendLang } from './langpack.ts';

export type SendKind = 'confirm' | 'acknowledge';

// Money is formatted by `money()` in changeorder.ts. There is ONE formatter.
//
// There used to be a local copy here called usd(), justified as avoiding "an import
// cycle with the CO module". There is no cycle: changeorder.ts imports supabase,
// powersync, js-sha256 and ./i18n, and never confirmations.ts. Checked, not assumed.
//
// The copy had already drifted. money() renders -5000 as "-$50.00"; the copy used
// Math.abs and no sign, so it rendered "$50.00" -- a credit shown as a charge, baked
// into shown_content, which mandate #5 makes THE binding instrument. Nothing in the
// schema forbade a negative amount_cents on a confirmation_request.
//
// The drift also had a second edge. 240_shown_content_integrity.sql requires the
// displayed figure to appear LITERALLY in the frozen wording, comparing against
// postgres `to_char`. So the JS formatter and the SQL formatter must agree forever.
// Two JS copies meant a fix applied to one and not the other would reject every send,
// or worse, quietly pass with the wrong number. One copy is hard enough to keep in
// step with postgres; two was a coin flip.

/**
 * The exact words the counterparty will see. Rendered once, here, and never
 * again. Plain language on purpose: the reader is an owner on a phone, not a
 * user of this app.
 *
 * When a price is present this is a PRICED APPROVAL: the dollar figure is baked
 * into the frozen text, so the binding instrument and the nicely-rendered page
 * carry the SAME number (mandate #5/#6). The page renders it beautifully; this
 * text is the legal fallback and the thing that is hashed.
 */
export function renderCard(o: {
  kind: SendKind; subject: string; value: string; directedBy: string;
  projectName: string; whenMs: number; amountCents?: number | null;
  nteCents?: number | null;
  companyName?: string | null;
  // The flow fields (375) arrive through FlowTerms, shared with renderEwaCard.
  // Absent -> no line, so an extra predating them signs the instrument it always did.
  /**
   * The language THIS instrument is written in (LANGUAGE-LAYER slice 2 — hadar,
   * 2026-09-03: "when sent the user is asked what language it should be sent as").
   * The caller passes `value` already in this language; this parameter makes the
   * CHROME agree with the body. Every sentence comes from langpack.ts, where a
   * language exists only after a human who speaks it reviewed it — this text is
   * frozen and signed (mandate #5). English output is byte-identical to what this
   * rendered before the parameter existed; the tests pin that.
   */
  lang?: SendLang;
} & FlowTerms): string {
  const L = LANG_PACK[o.lang ?? 'en'];
  // The date follows the document's language — a Spanish instrument with an
  // English-formatted date is a half-translated document.
  const when = o.lang === 'es'
    ? new Date(o.whenMs).toLocaleString('es-US')
    : new Date(o.whenMs).toLocaleString();
  const priced = typeof o.amountCents === 'number';
  const asker = o.companyName ? `${o.companyName}\n` : '';
  const flowTerms = flowTermLines(o, o.lang ?? 'en');
  if (priced) {
    const nte = typeof o.nteCents === 'number' ? o.nteCents : null;
    const priceBlock = nte === null
      ? `${L.priceLabel}: ${money(o.amountCents as number)}\n`
      : `${L.priceLabel}: ${money(o.amountCents as number)}${L.priceTm}\n` +
        `${L.nteLabel}: ${money(nte)}\n` +
        `${L.nteSentence(money(nte))}\n`;
    return `${L.coHeader}\n` +
      `${L.coSubheader}\n\n` +
      `${L.scopeHeading}\n${o.value}\n\n` +
      `${L.fromHeading}\n${asker}${L.jobLabel}: ${o.projectName}\n` +
      `${L.directedByLabel}: ${o.directedBy}\n${L.dateLabel}: ${when}\n\n` +
      `${L.termsHeading}\n` +
      priceBlock +
      flowTerms +
      `\n${L.nothingProceeds}`;
  }
  return (o.kind === 'confirm' ? L.confirmAsk : L.acknowledgeAsk) + `\n\n` +
    `${o.subject}: ${o.value}\n\n` +
    `${L.directedByLabel}: ${o.directedBy}\n${L.jobLabel}: ${o.projectName}\n${L.recordedLabel}: ${when}`;
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
    // Priced approval (optional). When present, the price + context are FROZEN
    // alongside shown_content so the client's page can render the report the
    // prototype describes without the number ever drifting from the signed one.
    amountCents?: number | null; nteCents?: number | null;
    companyName?: string | null; approvedRunningCents?: number | null;
    changeOrderId?: string | null;
    /**
     * THE COST BROKEN DOWN BY PART, frozen with the price (hadar 2026-08-24).
     *
     * Sent when the extra was priced in parts; omitted when one figure covers the
     * whole job, which is most sends. It is frozen deliberately (200's `line_items`
     * column, in the tamper guard): the client's page must show the parts the SIGNER
     * saw, not the parts the draft happens to carry today.
     */
    lineItems?: { description: string; qty: number; unit_cents: number; total_cents: number }[] | null;
    /** Flow fields — rendered into the frozen instrument by renderCard. */
    billingTiming?: string | null; scheduleEffect?: string | null;
    scheduleDays?: number | null; exclusions?: string | null;
    /** The instrument's language. `value` must already BE in it — see renderCard. */
    lang?: SendLang;
  }
): Promise<SendResult> {
  // REFUSE BEFORE WRITING. Without a link base the url below comes out as the
  // relative "/confirm.html?t=..." — not a link anyone can open. `shareLink` already
  // rejects that shape, so nothing dead ever reached a homeowner, but the refusal
  // came AFTER confirmation_create had inserted a real row: a token minted, and (for
  // a priced send) 230's confirmation_request_marks_sent had already moved the change
  // order to `sent`. The contractor got a "created" card showing a URL that could not
  // work, for a request that could not be delivered.
  //
  // The check lives HERE, not at the call sites, because there are two of them and
  // only one had it: the priced path guarded CONFIRM_BASE while the decision-confirm
  // path did not — and carried a comment claiming it did. A precondition every caller
  // must satisfy belongs to the function that has the precondition. Same reasoning as
  // the SQL one-object-one-owner pass: a rule you can forget to apply is not a rule.
  if (!o.linkBase) {
    return { ok: false, reason: 'No confirmation page is configured (EXPO_PUBLIC_CONFIRM_BASE)' };
  }

  const shownContent = renderCard(o);
  const token = newToken();

  const { error } = await supabase.rpc('confirmation_create', {
    p_token: token,
    p_decision_id: o.decisionId,
    p_project_id: o.projectId,
    p_kind: o.kind,
    p_shown_content: shownContent,          // frozen from here on
    p_shown_sha256: sha256(shownContent),
    // The portal reads this to set its own chrome's language. Defaulted server-side,
    // so a build predating 443 keeps working against the new function.
    p_lang: o.lang ?? 'en',
    p_counterparty: o.counterparty,
    p_channel: o.channel,
    p_destination: o.destination ?? null,
    // Frozen priced fields — null on the plain decision-confirm path.
    p_amount_cents: o.amountCents ?? null,
    p_nte_cents: o.nteCents ?? null,
    // THE TITLE IS `subject`, NOT `value` (fixed 2026-08-10, found by opening a real
    // link). 391 split these: `subject` became the short title and `value` became the
    // full scope-of-work document. This line was not updated, so every confirmation
    // sent since has frozen a ~1000-character document into the field the page renders
    // as its HEADLINE — 26px, uppercase, no clamp. The client's first screen was the
    // entire scope shouted at them, with the actual document below it.
    //
    // Not cosmetic: `scope_title` is a FROZEN field on the request, so this is wrong
    // on every already-sent link and cannot be corrected by a redeploy of the page.
    // See 402 for the backfill.
    p_scope_title: o.subject,
    p_company_name: o.companyName ?? null,
    p_job_label: o.projectName,
    p_approved_running_cents: o.approvedRunningCents ?? null,
    p_change_order_id: o.changeOrderId ?? null,
    // Null rather than [] for "no parts": the column reads as absent, and the page's
    // "render nothing" branch keys off absence. An empty array is a breakdown that
    // exists and has no rows, which is not a thing this ever means.
    p_line_items: o.lineItems?.length ? o.lineItems : null,
  });
  if (error) return { ok: false, reason: error.message };

  // ?t= query, not a /c/{token} path: a static host (GitHub Pages) serves the file
  // directly and cannot rewrite pretty paths. The page reads either form, but the
  // query form works everywhere without host config.
  return { ok: true, token, url: `${o.linkBase}/confirm.html?t=${token}`, shownContent };
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
