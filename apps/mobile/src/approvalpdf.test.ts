/**
 * R6c AC3 / R6 / R5b AC3 — the approval document.
 * `node --test src/approvalpdf.test.ts`
 *
 * The load-bearing assertion is the last section: the derived summary must not be
 * inside the signed content. Everything else here exists to make that assertion
 * meaningful — a document with no summary would pass it trivially.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  approvalDocument, bindingText, renderApprovalHtml,
  type ApprovalDocInput, type PdfLabels,
} from './approvalpdf.ts';

const INSTRUMENT =
  'Replace cracked water heater — 40 gal, includes haul-away.\nPrice: $1,850.00\nApprove to authorize this work.';

const LABELS: PdfLabels = {
  signedHeading: 'APPROVED AND SIGNED',
  unsignedHeading: 'NOT YET SIGNED',
  signedByLine: 'Signed by Sarah Kim',
  co: {
    docTitle: 'Change Order', numberLabel: 'No.', versionLabel: 'Version', dateLabel: 'Date',
    fromLabel: 'From', toLabel: 'To', projectLabel: 'Project',
    descriptionHeading: 'Description of change', itemsHeading: 'Breakdown',
    qtyLabel: 'Qty', unitLabel: 'Unit', amountLabel: 'Amount',
    totalLabel: 'Total this change order', nteLabel: 'Not to exceed',
    licenseLabel: 'Lic.',
    includedHeading: 'Included in this price', excludedHeading: 'NOT included',
    nothingExcluded: 'Nothing excluded.', scheduleHeading: 'Effect on schedule',
    paymentHeading: 'Payment terms', authHeading: 'Authorization',
    authBody: 'Signing amends the contract.', signContractor: 'Contractor signature',
    signClient: 'Client signature', signDate: 'Date', noPrice: 'No price given',
  },
  integrityOk: 'MATCHES-FROZEN-COPY',
  integrityFailed: 'DOES-NOT-MATCH-FROZEN-COPY',
  discussionHeading: 'DISCUSSION',
  clientLabel: 'CLIENT',
  contractorLabel: 'CONTRACTOR',
  summaryHeading: 'DECISION-SUMMARY',
  derivedNote: 'DERIVED-FROM-THE-EVENTS-BELOW-NOT-PART-OF-THE-SIGNED-RECORD',
  owedLabel: 'NEXT:',
  footer: 'FOOTER',
};

const SUMMARY_LINE = 'Marco Reyes captured it.';
const OWED_LINE = 'Nothing owed — approved.';

function input(over: Partial<ApprovalDocInput> = {}): ApprovalDocInput {
  return {
    title: 'Water heater replacement',
    snapshot: {
      content: INSTRUMENT, sha256: 'abc123', signedName: 'Sarah Kim',
      signedAtLabel: 'Jul 20 · 2:14 pm', action: 'confirmed', verified: true,
    },
    discussion: [
      { side: 'client', text: 'Does that include the permit?', atLabel: 'Jul 19 · 9:02 am' },
      { side: 'contractor', text: 'Yes, permit is in the price.', atLabel: 'Jul 19 · 9:40 am' },
    ],
    summary: { lines: [SUMMARY_LINE, 'You priced it at $1,850.00.'], owed: OWED_LINE },
    ...over,
  };
}

// ── R6 / R5b AC3: what must be in the document ────────────────────────────────

test('the signed snapshot and the discussion log both appear, snapshot first', () => {
  const html = renderApprovalHtml(approvalDocument(input()), LABELS);
  assert.ok(html.includes('Replace cracked water heater'));
  assert.ok(html.includes('Does that include the permit?'));
  assert.ok(html.indexOf('Replace cracked water heater') < html.indexOf('Does that include'));
});

test('the instrument is reproduced byte for byte, only HTML-escaped', () => {
  const doc = approvalDocument(input());
  assert.equal(bindingText(doc), INSTRUMENT);
});

// ── R6c AC3: the derived summary is NOT inside the signed content ─────────────

test('AC3: the summary text is absent from the binding content', () => {
  const doc = approvalDocument(input());
  const signed = bindingText(doc);
  assert.ok(signed.length > 0, 'this test is only meaningful with a real instrument');
  assert.ok(!signed.includes(SUMMARY_LINE));
  assert.ok(!signed.includes(OWED_LINE));
  assert.ok(!signed.includes(LABELS.summaryHeading));
});

test('AC3: only the snapshot block is binding; the summary block never is', () => {
  const doc = approvalDocument(input());
  const binding = doc.blocks.filter((b) => b.binding === true);
  assert.equal(binding.length, 1);
  assert.equal(binding[0].kind, 'snapshot');
  assert.equal(doc.blocks.find((b) => b.kind === 'summary')!.binding, false);
});

test('AC3: in the rendered page the summary sits outside the data-binding section', () => {
  const html = renderApprovalHtml(approvalDocument(input()), LABELS);
  const signedOpen = html.indexOf('<section class="signed" data-binding="true">');
  const signedClose = html.indexOf('</section>', signedOpen);
  assert.ok(signedOpen >= 0 && signedClose > signedOpen);
  const signedSection = html.slice(signedOpen, signedClose);
  assert.ok(!signedSection.includes(SUMMARY_LINE));
  assert.ok(!signedSection.includes(LABELS.derivedNote));
  // And it is present, labelled as derived, further down.
  assert.ok(html.indexOf(SUMMARY_LINE) > signedClose);
  assert.ok(html.includes(LABELS.derivedNote));
  assert.equal(html.match(/data-binding="true"/g)!.length, 1);
});

// ── never blocks, never lies ──────────────────────────────────────────────────

test('R6c: no summary still produces the full document', () => {
  const doc = approvalDocument(input({ summary: null }));
  assert.equal(doc.blocks.some((b) => b.kind === 'summary'), false);
  assert.equal(bindingText(doc), INSTRUMENT);
  const html = renderApprovalHtml(doc, LABELS);
  assert.ok(html.includes('Replace cracked water heater'));
  assert.ok(html.includes('Does that include the permit?'));
});

test('an empty summary is the same as none — no bare heading with nothing under it', () => {
  const doc = approvalDocument(input({ summary: { lines: [], owed: OWED_LINE } }));
  assert.equal(doc.blocks.some((b) => b.kind === 'summary'), false);
});

test('mandate #7: with no snapshot on this device the document still renders and '
   + 'binding content is honestly empty', () => {
  const doc = approvalDocument(input({ snapshot: null }));
  assert.equal(bindingText(doc), '');
  const html = renderApprovalHtml(doc, LABELS);
  assert.ok(!html.includes('data-binding="true"'));
  assert.ok(html.includes('Does that include the permit?'));
});

test('a failed integrity check is printed, not swallowed', () => {
  const bad = input();
  const html = renderApprovalHtml(
    approvalDocument({ ...bad, snapshot: { ...bad.snapshot!, verified: false } }), LABELS);
  assert.ok(html.includes(LABELS.integrityFailed));
  assert.ok(!html.includes(LABELS.integrityOk));
});

test('an unanswered snapshot is headed as unsigned rather than as approved', () => {
  const i = input();
  const html = renderApprovalHtml(approvalDocument({
    ...i, snapshot: { ...i.snapshot!, action: null, signedName: null, signedAtLabel: null },
  }), LABELS);
  assert.ok(html.includes(LABELS.unsignedHeading));
  assert.ok(!html.includes(LABELS.signedHeading));
});

test('scope text containing markup cannot break out of the document', () => {
  const i = input();
  const html = renderApprovalHtml(approvalDocument({
    ...i,
    title: 'Trim 5" < 6" & "swap"',
    snapshot: { ...i.snapshot!, content: '<script>alert(1)</script>' },
  }), LABELS);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('Trim 5&quot; &lt; 6&quot; &amp; &quot;swap&quot;'));
});

test('each message is attributed to its side', () => {
  const html = renderApprovalHtml(approvalDocument(input()), LABELS);
  const client = html.indexOf(LABELS.clientLabel);
  const contractor = html.indexOf(LABELS.contractorLabel);
  assert.ok(client >= 0 && contractor > client);
});

// ── the letterhead (hadar, 2026-08-18: the logo saved but reached nothing) ─────

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

/** A CO face carrying whatever letterhead the case under test needs. */
function withCo(lh: any, contractorName = 'Streamline Construction'): ApprovalDocInput {
  return input({
    co: {
      number: '4', version: 1, dateLabel: 'Aug 18',
      letterhead: lh,
      contractor: { name: contractorName },
      client: { name: 'Sarah Kim' },
      projectName: 'Oak St', projectAddress: '1155 Stanyan St',
      description: 'Relocate the panel', items: [], total: '$1,850.00',
      included: ['Relocate the panel'], excluded: [],
      scheduleLine: null, paymentLine: null,
    },
  });
}

test('the logo is embedded, so the document still shows it offline a year later', () => {
  // A signed Storage URL expires in an hour. On the one artifact that is evidence, a
  // remote src is a broken-image box with a deadline.
  const html = renderApprovalHtml(
    approvalDocument(withCo({ logoDataUri: PNG, address: null, license: null })), LABELS);
  assert.ok(html.includes('src="' + PNG + '"'));
  assert.ok(!html.includes('http'), 'no remote reference may reach the letterhead');
});

test('the address and licence print, the licence behind its label', () => {
  const html = renderApprovalHtml(approvalDocument(withCo({
    logoDataUri: null, address: '1155 Stanyan St, San Francisco, CA 94117',
    license: 'CSLB 1043210',
  })), LABELS);
  assert.ok(html.includes('1155 Stanyan St, San Francisco, CA 94117'));
  assert.ok(html.includes('Lic. CSLB 1043210'));
});

test('a missing licence prints NO licence line, not an empty label', () => {
  // A change order printing "Lic." with nothing after it tells the reader a licence
  // number exists. That is the failure this whole block is disciplined against.
  const html = renderApprovalHtml(approvalDocument(withCo({
    logoDataUri: PNG, address: '1155 Stanyan St', license: null,
  })), LABELS);
  assert.ok(html.includes('1155 Stanyan St'));
  assert.ok(!html.includes('Lic.'));
});

test('no letterhead at all leaves the header exactly as it was', () => {
  // A contractor who never uploaded a logo must see no change and no empty band.
  const bare = renderApprovalHtml(approvalDocument(withCo(null)), LABELS);
  // The MARKUP, not the stylesheet: the CSS always defines .lh and .lhlogo, so asserting
  // on the bare class names passes for the wrong reason and would keep passing if the
  // band were rendered empty.
  assert.ok(!bare.includes('<div class="lh">'));
  assert.ok(!bare.includes('<img class="lhlogo"'));
  // The title and the meta still render.
  assert.ok(bare.includes('Change Order'));
  assert.ok(bare.includes('No. 4'));
});

test('a letterhead whose every field is empty is treated as absent', () => {
  const html = renderApprovalHtml(approvalDocument(
    withCo({ logoDataUri: null, address: null, license: null })), LABELS);
  assert.ok(!html.includes('<div class="lh">'));
});

test('the letterhead is NOT part of what was signed', () => {
  // It identifies who is making the offer; it does not add a term to it. If it ever
  // leaked into the binding block the document would assert someone signed our layout.
  const doc = approvalDocument(withCo({
    logoDataUri: PNG, address: '1155 Stanyan St', license: 'CSLB 1043210' }));
  const signed = bindingText(doc);
  assert.ok(!signed.includes('CSLB 1043210'));
  assert.ok(!signed.includes('1155 Stanyan St'));
  assert.ok(!signed.includes('base64'));
});

test('a company name with an ampersand cannot break the document', () => {
  // The alt text carries the company name into an ATTRIBUTE, which is the one place
  // esc()'s quote handling stops being theoretical.
  const html = renderApprovalHtml(approvalDocument(withCo(
    { logoDataUri: PNG, address: null, license: null },
    'Ruiz & Sons "Quality" Builders')), LABELS);
  assert.ok(html.includes('Ruiz &amp; Sons &quot;Quality&quot; Builders'));
  assert.ok(!html.includes('Ruiz & Sons "Quality"'));
});
