/**
 * R6c AC3 / R6 / R5b AC3 — the approval document both parties get.
 *
 * "Given an approved item, when its PDF is produced, then the signed snapshot and
 *  discussion log appear (R6) and the derived summary does not appear inside the
 *  signed content."
 *
 * PURE. No imports, no database, no clock, no I/O, no locale — so
 * `approvalpdf.test.ts` runs under `node --test` with type-stripping alone, and so
 * the one invariant that matters can be asserted rather than eyeballed. The
 * file-writing / sharing half is `approvalrecordshare.ts`.
 *
 * ─── THE INVARIANT, and why it is a TYPE and not a convention ─────────────────
 *
 * The signed snapshot is the binding instrument (mandate #5): the frozen
 * `shown_content` the signer actually saw, byte for byte. The decision summary is a
 * machine-derived reading aid that R6c explicitly bars from the signed content.
 * If those two ever share a container, the document starts asserting that somebody
 * signed a sentence this app wrote about them.
 *
 * So `binding` is a literal type — `true` on the snapshot block, `false` on the
 * others — which makes a binding summary block UNCONSTRUCTABLE rather than merely
 * discouraged. `bindingText()` reads only blocks whose flag is literally true, so
 * "what was signed" has exactly one definition in the codebase and it is one line
 * long. recordpeople.ts's MoneyBlock union makes the same move for the same reason:
 * R6b's "no price anywhere" was one forgotten `&&` away from being false when it
 * was a boolean beside an amount.
 *
 * ─── WHAT THIS FILE DOES NOT DO ──────────────────────────────────────────────
 *
 * It does not re-render, re-wrap, re-format or re-hash the snapshot. `content`
 * comes out of `change_order_snapshot.shown_content` (eventlog.ts) and goes into
 * the document unchanged except for HTML escaping, which is a transport encoding
 * and not an edit — 240_shown_content_integrity.sql is the reason: the text and its
 * sha256 must still agree after this file has touched them, and the only way to
 * guarantee that is to never touch them.
 *
 * It also authors no words. Every heading arrives already translated in `labels`
 * (mandate #5, per-user display language); this module only decides structure and
 * order. That is why it can have no imports and still be localized.
 */

// ─── the document ─────────────────────────────────────────────────────────────

export type SnapshotBlock = {
  kind: 'snapshot';
  /** Literal true. This is the only block that can carry it. */
  binding: true;
  /** The frozen instrument, verbatim. */
  content: string;
  sha256: string;
  signedName: string | null;
  /** Already formatted by the caller — this module owns no locale. */
  signedAtLabel: string | null;
  action: 'confirmed' | 'declined' | null;
  /**
   * False when the device's copy of the text does not hash to the frozen value
   * (eventlog.ts computes this). Carried into the document rather than suppressed:
   * a snapshot that fails its own integrity check is the single most important
   * thing this document could say, and a PDF that silently omitted the warning
   * would be worse evidence than no PDF.
   */
  verified: boolean;
};

export type DiscussionEntry = {
  side: 'client' | 'contractor';
  /** The message body, verbatim. R5b: every message is part of the record. */
  text: string;
  /** Already formatted. */
  atLabel: string;
};

export type DiscussionBlock = { kind: 'discussion'; binding: false; entries: DiscussionEntry[] };

/** R6c's narrative, already translated to sentences by the render layer. */
export type SummaryBlock = { kind: 'summary'; binding: false; lines: string[]; owed: string };

/**
 * THE CHANGE ORDER ITSELF — the face of the document (hadar, 2026-07-31).
 *
 * Modelled on what a residential GC/sub actually signs: the AIA G701 skeleton
 * (parties · project · description · adjustment to the contract sum · adjustment to
 * the contract time · authorising signatures) reduced to the fields this app truly
 * holds. Every field here is OPTIONAL and omitted when unknown — a change order with
 * an invented contract sum or a made-up licence number is worse than one that is
 * simply shorter, and this product's whole claim is that it does not invent.
 *
 * `binding: false`, always. This block PRESENTS the deal in the shape a contractor
 * and an owner expect to read; the one thing that binds is the frozen instrument in
 * `SnapshotBlock`, quoted verbatim. Two renderings of a legal text is exactly the
 * drift this file exists to prevent, so this block never restates the instrument —
 * it surrounds it.
 */
export type CoParty = {
  name: string;
  /** "General contractor", "Homeowner" — already translated by the caller. */
  role?: string | null;
  phone?: string | null;
  email?: string | null;
};

export type CoLineItem = {
  description: string;
  qty: number;
  /** Already formatted by the ONE money formatter — this file never touches cents. */
  unit: string;
  amount: string;
};

export type ChangeOrderBlock = {
  kind: 'co';
  binding: false;
  /** "4" — the extra's number on its job. Null when the job does not number them. */
  number: string | null;
  /** Which revision this is. 1 = the original. */
  version: number;
  dateLabel: string | null;
  contractor: CoParty | null;
  client: CoParty | null;
  projectName: string | null;
  projectAddress: string | null;
  /** What the change IS — the client-facing scope. */
  description: string;
  items: CoLineItem[];
  /** The total for THIS change order, formatted. Null when no price was given. */
  total: string | null;
  /** A not-to-exceed cap, when the price is T&M (R3 requires the clause). */
  nte?: string | null;
  /** Sentences, already composed and translated by the caller. */
  included: string[];
  excluded: string[];
  scheduleLine: string | null;
  paymentLine: string | null;
};

export type DocBlock = SnapshotBlock | DiscussionBlock | SummaryBlock | ChangeOrderBlock;

export type ApprovalDoc = {
  /** The item's scope line, for the page header. Not part of the instrument — the
   *  instrument restates it inside `content`. */
  title: string;
  blocks: DocBlock[];
};

export type ApprovalDocInput = {
  title: string;
  /** The change order's own face. Omit and the document is the older evidence-only
   *  shape, which is still valid — a draft with nothing agreed has no CO to print. */
  co?: Omit<ChangeOrderBlock, 'kind' | 'binding'> | null;
  snapshot: Omit<SnapshotBlock, 'kind' | 'binding'> | null;
  discussion: readonly DiscussionEntry[];
  summary: { lines: readonly string[]; owed: string } | null;
};

/**
 * Assemble the document.
 *
 * ORDER IS THE REQUIREMENT, not a layout preference. R6: "PDF generated to both
 * parties includes the discussion log beneath the approved snapshot." R5b AC3 says
 * the same from the other side. The summary comes last because it is the only part
 * that is derived, and a reader who stops early has then read only real evidence.
 *
 * A MISSING SNAPSHOT IS NOT AN ERROR. A draft, or an extra whose timeline has never
 * been fetched on this device, has no frozen instrument — and mandate #7 says the
 * network is never a precondition for seeing what you captured. The document is
 * produced anyway with no binding block, and `bindingText()` returns empty, which
 * is the truthful answer to "what was signed": nothing was.
 */
export function approvalDocument(i: ApprovalDocInput): ApprovalDoc {
  const blocks: DocBlock[] = [];
  // The CO face FIRST: it is what the document is. The instrument follows it, then
  // the discussion, then the derived summary last — the existing order is unchanged
  // below this line, and R6's "discussion beneath the approved snapshot" still holds.
  if (i.co) blocks.push({ kind: 'co', binding: false, ...i.co });
  if (i.snapshot) blocks.push({ kind: 'snapshot', binding: true, ...i.snapshot });
  if (i.discussion.length) {
    blocks.push({ kind: 'discussion', binding: false, entries: [...i.discussion] });
  }
  if (i.summary && i.summary.lines.length) {
    blocks.push({
      kind: 'summary', binding: false,
      lines: [...i.summary.lines], owed: i.summary.owed,
    });
  }
  return { title: i.title, blocks };
}

/**
 * Exactly what was signed, and nothing else. R6c AC3 in one function.
 *
 * The joiner is a newline rather than '' so that a future second binding block
 * cannot silently concatenate two instruments into one run-on string. There is
 * only one today.
 */
export function bindingText(doc: ApprovalDoc): string {
  return doc.blocks
    .filter((b): b is SnapshotBlock => b.binding === true)
    .map((b) => b.content)
    .join('\n');
}

// ─── rendering ────────────────────────────────────────────────────────────────

/** Headings, already translated by the caller. Every one is required: an optional
 *  label is a label somebody forgets to translate. */
export type PdfLabels = {
  signedHeading: string;
  /** Used when the snapshot exists but carries no answer yet. */
  unsignedHeading: string;
  /** Caller substitutes the name; this module never builds a sentence. */
  signedByLine: string;
  integrityOk: string;
  integrityFailed: string;
  discussionHeading: string;
  clientLabel: string;
  contractorLabel: string;
  summaryHeading: string;
  /** R6c: the summary is "labeled as derived". Not optional, for that reason. */
  derivedNote: string;
  owedLabel: string;
  footer: string;
  /** The change-order face. Required for the same reason the others are: an optional
   *  heading is a heading somebody forgets to translate. */
  co: {
    docTitle: string;
    numberLabel: string;
    versionLabel: string;
    dateLabel: string;
    fromLabel: string;
    toLabel: string;
    projectLabel: string;
    descriptionHeading: string;
    itemsHeading: string;
    qtyLabel: string;
    unitLabel: string;
    amountLabel: string;
    totalLabel: string;
    nteLabel: string;
    includedHeading: string;
    excludedHeading: string;
    nothingExcluded: string;
    scheduleHeading: string;
    paymentHeading: string;
    authHeading: string;
    /** The sentence that makes signing mean something. */
    authBody: string;
    signContractor: string;
    signClient: string;
    signDate: string;
    noPrice: string;
  };
};

/**
 * Escape everything that goes into the page.
 *
 * `shown_content` is client-facing text that passed through a transcript and a
 * contractor's keyboard; a scope reading `5" < 6" trim` would otherwise silently
 * eat the rest of the document, and the document is evidence. Quotes are escaped
 * too — not because anything here is an attribute today, but because the day one
 * of these strings lands in one is the day it stops being escaped enough.
 */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * The document as self-contained HTML.
 *
 * WHY HTML AND NOT PDF BYTES: this repo has no PDF library and adding one is not
 * this change's call to make. HTML is what `expo-print` takes as input, so the
 * upgrade to real PDF bytes is one dependency and one call in
 * `approvalrecordshare.ts` — and until then the document is still produced,
 * shareable, and offline. Stated plainly rather than labelled "PDF" and left to be
 * discovered.
 *
 * The signed content is rendered inside `<section data-binding="true">` and
 * nothing else is. That attribute is not decoration: it is what makes the AC
 * checkable by a reader of the output as well as by the test.
 */
/** One party block. Every line is omitted when absent: a change order that prints an
 *  empty "Phone:" label is telling the reader a number exists. */
function party(p: CoParty | null): string {
  if (!p) return '<div class="pname">—</div>';
  const out = [`<div class="pname">${esc(p.name)}</div>`];
  if (p.role) out.push(`<div class="prole">${esc(p.role)}</div>`);
  if (p.phone) out.push(`<div class="pcontact">${esc(p.phone)}</div>`);
  if (p.email) out.push(`<div class="pcontact">${esc(p.email)}</div>`);
  return out.join('');
}

export function renderApprovalHtml(doc: ApprovalDoc, labels: PdfLabels): string {
  const parts: string[] = [];
  parts.push('<!doctype html><html><head><meta charset="utf-8">');
  parts.push('<meta name="viewport" content="width=device-width,initial-scale=1">');
  parts.push(`<title>${esc(doc.title)}</title>`);
  parts.push(`<style>${CSS}</style></head><body>`);
  parts.push(`<h1>${esc(doc.title)}</h1>`);

  for (const b of doc.blocks) {
    if (b.kind === 'snapshot') {
      const heading = b.action ? labels.signedHeading : labels.unsignedHeading;
      parts.push('<section class="signed" data-binding="true">');
      parts.push(`<h2>${esc(heading)}</h2>`);
      // <pre>: the frozen text keeps its own line breaks. Reflowing it would make
      // the displayed instrument differ from the one that was hashed.
      parts.push(`<pre class="instrument">${esc(b.content)}</pre>`);
      if (b.signedName) {
        parts.push(`<p class="sig">${esc(labels.signedByLine)}`);
        if (b.signedAtLabel) parts.push(` · ${esc(b.signedAtLabel)}`);
        parts.push('</p>');
      }
      parts.push(`<p class="${b.verified ? 'ok' : 'bad'}">`);
      parts.push(esc(b.verified ? labels.integrityOk : labels.integrityFailed));
      parts.push(`<br><code>${esc(b.sha256)}</code></p>`);
      parts.push('</section>');
    } else if (b.kind === 'co') {
      const L = labels.co;
      parts.push('<section class="co" data-binding="false">');
      parts.push('<div class="cohead">');
      parts.push(`<div class="cotitle">${esc(L.docTitle)}</div><div class="cometa">`);
      if (b.number) parts.push(`<div>${esc(L.numberLabel)} ${esc(b.number)}</div>`);
      parts.push(`<div>${esc(L.versionLabel)} ${esc(String(b.version))}</div>`);
      if (b.dateLabel) parts.push(`<div>${esc(L.dateLabel)} ${esc(b.dateLabel)}</div>`);
      parts.push('</div></div>');

      // PARTIES + PROJECT — who is agreeing, and to what job. A change order with no
      // named parties is not enforceable against anyone.
      parts.push('<table class="parties"><tr>');
      parts.push(`<td><div class="plabel">${esc(L.fromLabel)}</div>${party(b.contractor)}</td>`);
      parts.push(`<td><div class="plabel">${esc(L.toLabel)}</div>${party(b.client)}</td>`);
      parts.push('</tr></table>');
      if (b.projectName || b.projectAddress) {
        parts.push(`<div class="proj"><span class="plabel">${esc(L.projectLabel)}</span> `);
        parts.push(esc([b.projectName, b.projectAddress].filter(Boolean).join(' · ')));
        parts.push('</div>');
      }

      parts.push(`<h3>${esc(L.descriptionHeading)}</h3>`);
      parts.push(`<p class="desc">${esc(b.description)}</p>`);

      if (b.items.length) {
        parts.push(`<h3>${esc(L.itemsHeading)}</h3>`);
        parts.push('<table class="items"><thead><tr>');
        parts.push(`<th>${esc(L.descriptionHeading)}</th><th class="n">${esc(L.qtyLabel)}</th>`);
        parts.push(`<th class="n">${esc(L.unitLabel)}</th><th class="n">${esc(L.amountLabel)}</th>`);
        parts.push('</tr></thead><tbody>');
        for (const it of b.items) {
          parts.push(`<tr><td>${esc(it.description)}</td><td class="n">${esc(String(it.qty))}</td>`);
          parts.push(`<td class="n">${esc(it.unit)}</td><td class="n">${esc(it.amount)}</td></tr>`);
        }
        parts.push('</tbody></table>');
      }

      // THE MONEY. Never a dash and never "no cost": a price nobody gave is said in
      // words, because a dash on a change order reads as zero.
      parts.push('<table class="sum"><tr>');
      parts.push(`<td class="sumlabel">${esc(L.totalLabel)}</td>`);
      parts.push(`<td class="sumval">${esc(b.total ?? L.noPrice)}</td></tr>`);
      if (b.nte) {
        parts.push(`<tr><td class="sumlabel">${esc(L.nteLabel)}</td>`);
        parts.push(`<td class="sumval">${esc(b.nte)}</td></tr>`);
      }
      parts.push('</table>');

      // WHAT IS AND IS NOT COVERED. The exclusions column is the one that prevents the
      // next argument, so it prints even when empty — as a stated "none", never blank.
      parts.push('<table class="incl"><tr>');
      parts.push(`<td><h3>${esc(L.includedHeading)}</h3><ul>`);
      for (const l of b.included) parts.push(`<li>${esc(l)}</li>`);
      parts.push('</ul></td>');
      parts.push(`<td><h3>${esc(L.excludedHeading)}</h3><ul>`);
      if (b.excluded.length) for (const l of b.excluded) parts.push(`<li>${esc(l)}</li>`);
      else parts.push(`<li class="none">${esc(L.nothingExcluded)}</li>`);
      parts.push('</ul></td></tr></table>');

      if (b.scheduleLine || b.paymentLine) {
        parts.push('<table class="terms"><tr>');
        if (b.scheduleLine) {
          parts.push(`<td><h3>${esc(L.scheduleHeading)}</h3><p>${esc(b.scheduleLine)}</p></td>`);
        }
        if (b.paymentLine) {
          parts.push(`<td><h3>${esc(L.paymentHeading)}</h3><p>${esc(b.paymentLine)}</p></td>`);
        }
        parts.push('</tr></table>');
      }

      // AUTHORISATION. The sentence above the lines is what turns two names into an
      // amendment to the contract; without it a signature is just a name.
      parts.push('<div class="auth">');
      parts.push(`<h3>${esc(L.authHeading)}</h3><p class="authbody">${esc(L.authBody)}</p>`);
      parts.push('<table class="sigs"><tr>');
      parts.push(`<td><div class="sigline"></div><div class="sigcap">${esc(L.signContractor)}`);
      if (b.contractor?.name) parts.push(` — ${esc(b.contractor.name)}`);
      parts.push(`</div><div class="sigline short"></div><div class="sigcap">${esc(L.signDate)}</div></td>`);
      parts.push(`<td><div class="sigline"></div><div class="sigcap">${esc(L.signClient)}`);
      if (b.client?.name) parts.push(` — ${esc(b.client.name)}`);
      parts.push(`</div><div class="sigline short"></div><div class="sigcap">${esc(L.signDate)}</div></td>`);
      parts.push('</tr></table></div>');
      parts.push('</section>');
    } else if (b.kind === 'discussion') {
      parts.push('<section class="discussion" data-binding="false">');
      parts.push(`<h2>${esc(labels.discussionHeading)}</h2>`);
      for (const e of b.entries) {
        const who = e.side === 'client' ? labels.clientLabel : labels.contractorLabel;
        parts.push('<div class="msg">');
        parts.push(`<span class="who">${esc(who)}</span> `);
        parts.push(`<span class="when">${esc(e.atLabel)}</span>`);
        parts.push(`<p>${esc(e.text)}</p></div>`);
      }
      parts.push('</section>');
    } else {
      parts.push('<section class="derived" data-binding="false">');
      parts.push(`<h2>${esc(labels.summaryHeading)}</h2>`);
      parts.push(`<p class="note">${esc(labels.derivedNote)}</p><ul>`);
      for (const l of b.lines) parts.push(`<li>${esc(l)}</li>`);
      parts.push('</ul>');
      parts.push(`<p class="owed"><strong>${esc(labels.owedLabel)}</strong> ${esc(b.owed)}</p>`);
      parts.push('</section>');
    }
  }

  parts.push(`<p class="footer">${esc(labels.footer)}</p>`);
  parts.push('</body></html>');
  return parts.join('');
}

const CSS = [
  'body{font:14px/1.5 -apple-system,Helvetica,Arial,sans-serif;color:#1b1a17;margin:32px;}',
  // ── the change-order face ──
  'section.co{border:1px solid #1b1a17;padding:0;}',
  '.cohead{display:flex;justify-content:space-between;align-items:flex-start;',
  'border-bottom:2px solid #1b1a17;padding:14px 16px;}',
  '.cotitle{font-size:22px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;}',
  '.cometa{font-size:11.5px;text-align:right;line-height:1.6;}',
  'table.parties{width:100%;border-collapse:collapse;}',
  'table.parties td{width:50%;vertical-align:top;padding:12px 16px;border-bottom:1px solid #e3ded4;}',
  'table.parties td+td{border-left:1px solid #e3ded4;}',
  '.plabel{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#6b6459;}',
  '.pname{font-weight:700;font-size:14px;margin-top:3px;}',
  '.prole{font-size:11.5px;color:#6b6459;}.pcontact{font-size:11.5px;}',
  '.proj{padding:10px 16px;border-bottom:1px solid #e3ded4;font-size:12.5px;}',
  'section.co h3{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;',
  'color:#6b6459;margin:14px 16px 6px;}',
  'p.desc{margin:0 16px 12px;white-space:pre-wrap;}',
  'table.items{width:calc(100% - 32px);margin:0 16px 10px;border-collapse:collapse;font-size:12.5px;}',
  'table.items th{text-align:left;border-bottom:1px solid #1b1a17;padding:5px 4px;font-size:10px;',
  'letter-spacing:.08em;text-transform:uppercase;color:#6b6459;}',
  'table.items td{padding:5px 4px;border-bottom:1px solid #efeae1;}',
  'table.items .n,table.items th.n{text-align:right;}',
  'table.sum{width:calc(100% - 32px);margin:0 16px 12px;border-collapse:collapse;}',
  '.sumlabel{text-align:right;font-size:11px;letter-spacing:.08em;text-transform:uppercase;',
  'color:#6b6459;padding:6px 10px 6px 0;}',
  '.sumval{width:34%;text-align:right;font-weight:800;font-size:17px;border-top:2px solid #1b1a17;padding:6px 4px;}',
  'table.incl,table.terms{width:100%;border-collapse:collapse;border-top:1px solid #e3ded4;}',
  'table.incl td,table.terms td{width:50%;vertical-align:top;padding-bottom:10px;}',
  'table.incl td+td,table.terms td+td{border-left:1px solid #e3ded4;}',
  'table.incl ul{margin:0 16px;padding-left:16px;font-size:12.5px;}',
  'table.incl li.none{list-style:none;margin-left:-16px;color:#6b6459;}',
  'table.terms p{margin:0 16px;font-size:12.5px;}',
  '.auth{border-top:2px solid #1b1a17;padding-bottom:16px;}',
  '.authbody{margin:0 16px 18px;font-size:11.5px;color:#3c382f;}',
  'table.sigs{width:100%;border-collapse:collapse;}',
  'table.sigs td{width:50%;padding:0 16px;vertical-align:bottom;}',
  '.sigline{border-bottom:1px solid #1b1a17;height:34px;}',
  '.sigline.short{width:60%;height:28px;margin-top:14px;}',
  '.sigcap{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#6b6459;padding-top:4px;}',
  'h1{font-size:20px;margin:0 0 18px;}h2{font-size:13px;letter-spacing:.08em;',
  'text-transform:uppercase;color:#6b6459;margin:0 0 8px;}',
  'section{margin:0 0 26px;padding:16px;border:1px solid #e3ded4;border-radius:8px;}',
  'section.signed{border-color:#1b1a17;border-width:2px;}',
  'section.derived{background:#faf7f2;border-style:dashed;}',
  '.instrument{white-space:pre-wrap;font:14px/1.6 inherit;margin:0;}',
  '.sig{font-weight:600;margin:14px 0 4px;}',
  '.ok{color:#4b7a3f;font-size:11px;}.bad{color:#b3261e;font-weight:700;font-size:12px;}',
  'code{font-size:10px;word-break:break-all;color:#8a8378;}',
  '.msg{border-top:1px solid #eee7dc;padding:9px 0;}',
  '.who{font-weight:700;}.when{color:#8a8378;font-size:11px;}',
  '.msg p{margin:4px 0 0;}',
  '.note{color:#6b6459;font-size:11.5px;margin:0 0 10px;}',
  'ul{margin:0;padding-left:18px;}li{margin:0 0 4px;}',
  '.owed{margin:12px 0 0;}',
  '.footer{color:#8a8378;font-size:10.5px;}',
].join('');
