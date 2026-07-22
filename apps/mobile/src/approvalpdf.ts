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

export type DocBlock = SnapshotBlock | DiscussionBlock | SummaryBlock;

export type ApprovalDoc = {
  /** The item's scope line, for the page header. Not part of the instrument — the
   *  instrument restates it inside `content`. */
  title: string;
  blocks: DocBlock[];
};

export type ApprovalDocInput = {
  title: string;
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
