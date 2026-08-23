/**
 * The link message. Run: cd apps/mobile && node --test src/clientsms.test.ts
 *
 * Two kinds of assertion here, and the second kind is the point of the file.
 *
 * The GOLDENS are literal. This text is the first thing a homeowner reads about a
 * priced commitment, and asserting `includes('approve')` would pass on a message that
 * said the opposite — the same reasoning flowterms.test.ts opens with.
 *
 * The INVARIANTS hold whatever the wording becomes: nothing appears in the message
 * that is not in the frozen instrument (REQ-LC40), the EWA never inherits the priced
 * document's closing sentence, and the whole body stays inside GSM-7 so it does not
 * silently become an eleven-segment UCS-2 send.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clientSmsBody, isGsm7, replyNoticeSmsBody, smsSegments } from './clientsms.ts';

// A real instrument in the 391 layout, which is what renderCard emits today.
const PRICED = [
  'CHANGE ORDER — APPROVAL REQUESTED',
  'An extra outside the original scope.',
  '',
  'SCOPE OF WORK',
  'Replace 40sf of rotted subfloor under the vanity and rebuild the base.',
  '',
  'FROM',
  'Kowalski Remodeling',
  'Job: 1151 Stanyan St',
  'Directed by: Owner',
  'Date: 7/24/2026, 6:39:32 PM',
  '',
  'TERMS',
  'Price: $1,850.00',
  'Not included: permit fees',
  '',
  'Nothing proceeds until you approve.',
].join('\n');

// THE REAL SHAPE, and the length is the whole point of this constant.
//
// It used to be a 117-character Supabase storage URL from before the custom domain
// existed. That is 27 characters longer than anything this app now sends, and it made the
// two-segment test fail for a message that costs two segments in production — a fixture
// asserting a cost nobody pays. Found 2026-08-19 when the A2P opt-out line was added.
//
// `EXPO_PUBLIC_CONFIRM_BASE` + the 40-hex token, exactly as `noteLinkSent` records it.
const URL = 'https://approve.ezchangeorders.com/confirm.html'
  + '?t=35b00b9abeccfb35dc5ede9959ad215ee16a7889';

const priced = (over = {}) => clientSmsBody({
  kind: 'confirm', shownContent: PRICED, url: URL,
  companyName: 'Kowalski Remodeling', jobLabel: '1151 Stanyan St',
  amountText: '$1,850.00', ...over,
});

// ── the goldens ─────────────────────────────────────────────────────────────

test('a priced change order: who, what, how much, which job, the link, the term', () => {
  assert.equal(priced(),
    'Kowalski Remodeling sent you a change order to approve - $1,850.00.\n' +
    'Job: 1151 Stanyan St\n' +
    '\n' +
    'Open it here. No app or account needed:\n' +
    URL + '\n' +
    '\n' +
    'Nothing proceeds until you approve.\n' +
    'Reply STOP to opt out. HELP for help.');
});

test('the document itself is never quoted into the message', () => {
  const body = priced();
  // The scope is the longest thing in the instrument and the most tempting to
  // summarise. It must not be here at all: a truncated scope is not verbatim, so
  // REQ-LC40 forbids it, and a partial scope read out of its document is a
  // different scope.
  assert.ok(!body.includes('subfloor'));
  assert.ok(!body.includes('SCOPE OF WORK'));
  assert.ok(!body.includes('Not included'));
  assert.ok(!body.includes('Directed by'));
});

// ── REQ-LC40: nothing in the message that is not in the instrument ──────────

test('a price that is not in the frozen text is DROPPED, not sent', () => {
  // The exact failure 240_shown_content_integrity.sql exists to prevent, one channel
  // further out where no trigger can see it. The message degrades to the unpriced
  // sentence rather than naming a figure the signed document does not contain.
  const body = priced({ amountText: '$1,500.00' });
  assert.ok(!body.includes('$1,500'));
  assert.ok(!body.includes('$1,850'));
  assert.ok(body.startsWith('Kowalski Remodeling sent you something to check and confirm.'));
});

test('a company name that is not in the frozen text falls back, it does not guess', () => {
  const body = priced({ companyName: 'Kowalski Remodeling LLC' });
  assert.ok(body.startsWith('Your contractor sent you a change order to approve - $1,850.00.'));
  assert.ok(!body.includes('LLC'));
});

test('a job label that is not in the frozen text is omitted entirely', () => {
  const body = priced({ jobLabel: '1151 Stanyan Street' });
  assert.ok(!body.includes('Job:'));
  // …and the rest of the message is unaffected: one absent fact drops one line.
  assert.ok(body.includes('$1,850.00'));
});

test('null and blank facts are absent facts, never the string "null"', () => {
  const body = priced({ companyName: null, jobLabel: '  ', amountText: null });
  assert.ok(!/null|undefined/.test(body));
  assert.equal(body,
    'Your contractor sent you something to check and confirm.\n' +
    '\n' +
    'Open it here. No app or account needed:\n' + URL + '\n' +
    'Reply STOP to opt out. HELP for help.');
});

test('a label sitting at a line break in the instrument still counts as present', () => {
  // renderCard joins with '\n'; "Job: 1151 Stanyan St" is its own line. Matching had
  // to be whitespace-insensitive or every job label would read as absent.
  assert.ok(priced().includes('Job: 1151 Stanyan St'));
});

// ── the EWA must never inherit the priced closing sentence ──────────────────

const EWA = [
  'EXTRA WORK AUTHORIZATION',
  'Kowalski Remodeling',
  'Job: 1151 Stanyan St',
  'Work proceeds at $95.00/hr plus materials, not to exceed $2,000.00, '
    + 'until a fixed price is issued.',
  'The detailed price will follow within 24h and, once approved, supersedes and '
    + 'settles this authorization.',
].join('\n');

test('an EWA is never told that nothing proceeds until they approve', () => {
  const body = clientSmsBody({
    kind: 'ewa', shownContent: EWA, url: URL,
    companyName: 'Kowalski Remodeling', jobLabel: '1151 Stanyan St',
  });
  // On a T&M-capped authorization work proceeds precisely BECAUSE it was approved.
  // Copying the priced document's closing line here would be a lie about the one
  // clause that decides whether the crew starts today — ewa.ts refuses it for the
  // same reason and this is the same refusal one channel out.
  assert.ok(!body.includes('Nothing proceeds'));
  assert.ok(body.startsWith(
    'Kowalski Remodeling sent you an extra work authorization to review and sign.'));
  assert.ok(body.includes('Job: 1151 Stanyan St'));
});

test('an EWA never carries a price, even when one is passed in', () => {
  // An EWA is stored with amount_cents = 0 and its contract states NO price (303).
  // A caller that passed "$0.00" through would misrepresent the instrument.
  const body = clientSmsBody({
    kind: 'ewa', shownContent: EWA, url: URL, amountText: '$0.00',
  });
  assert.ok(!body.includes('$'));
});

test('an acknowledge is a directive to acknowledge, not something to approve', () => {
  const body = clientSmsBody({
    kind: 'acknowledge', shownContent: 'Please acknowledge you directed this.', url: URL,
  });
  assert.equal(body,
    'Your contractor asked you to acknowledge something on your job.\n' +
    '\n' +
    'Open it here. No app or account needed:\n' + URL + '\n' +
    'Reply STOP to opt out. HELP for help.');
});

// ── the transport budget ────────────────────────────────────────────────────

test('every message this module can produce stays inside GSM-7', () => {
  // One character outside the set re-encodes the whole body as UCS-2 and cuts the
  // per-segment budget from 153 to 67. The failure is invisible at the call site and
  // shows up as cost and as reassembly failures on the client's handset, so it is
  // asserted here rather than trusted to a copy edit.
  for (const body of [
    priced(),
    priced({ amountText: null }),
    clientSmsBody({ kind: 'ewa', shownContent: EWA, url: URL, companyName: 'Kowalski Remodeling' }),
    clientSmsBody({ kind: 'acknowledge', shownContent: 'x', url: URL }),
    replyNoticeSmsBody({ companyName: 'Kowalski Remodeling', url: URL }),
  ]) {
    assert.ok(isGsm7(body), `not GSM-7: ${JSON.stringify(body)}`);
  }
});

test('isGsm7 rejects exactly the characters the old message body was full of', () => {
  assert.equal(isGsm7('CHANGE ORDER — APPROVAL REQUESTED'), false);   // em dash
  assert.equal(isGsm7("you’ve approved"), false);                      // curly quote
  assert.equal(isGsm7('Elm St · San Francisco'), false);               // middot
  assert.equal(isGsm7('Price: $1,850.00 - approve now'), true);
});

test('a real priced message fits in two segments; the shape it replaces took seven', () => {
  assert.ok(smsSegments(priced()) <= 2, `${smsSegments(priced())} segments`);
  // The shape being replaced: the whole frozen instrument plus the link. Seven is the
  // measured figure FOR THIS FIXTURE, not a general claim — a longer scope or a
  // not-to-exceed clause pushes it higher, and that is the point: the old shape's cost
  // grows with the document while this one does not.
  const old = `${PRICED}\n\n${URL}`;
  assert.equal(isGsm7(old), false);          // the em dash alone forces UCS-2
  assert.equal(smsSegments(old), 7);
  assert.ok(smsSegments(old) > smsSegments(priced()) * 3);
});

test('segment arithmetic matches the carrier at the boundaries', () => {
  assert.equal(smsSegments('a'.repeat(160)), 1);
  assert.equal(smsSegments('a'.repeat(161)), 2);
  assert.equal(smsSegments('a'.repeat(306)), 2);
  assert.equal(smsSegments('a'.repeat(307)), 3);
  // An extension character costs two septets, so 80 of them exceed the single-segment
  // budget that 80 letters would sit comfortably inside.
  assert.equal(smsSegments('a'.repeat(80)), 1);
  assert.equal(smsSegments('€'.repeat(81)), 2);
  // UCS-2, once anything falls outside GSM-7.
  assert.equal(smsSegments('—'.repeat(70)), 1);
  assert.equal(smsSegments('—'.repeat(71)), 2);
});

// ── the reply notice ────────────────────────────────────────────────────────

test('the reply notice never quotes the reply', () => {
  const body = replyNoticeSmsBody({ companyName: 'Kowalski Remodeling', url: URL });
  assert.equal(body,
    'Kowalski Remodeling replied to your question.\n' +
    '\n' +
    'Read it and approve or decline here:\n' + URL);
  // A reply routinely carries the negotiation ("I can do 1,500 if we skip the trim").
  // A number that reaches a client outside the instrument reads as an offer, and an
  // offer read as agreed is the dispute this product exists to prevent.
  assert.ok(!/\d/.test(body.replace(URL, '')));
});

test('the reply notice degrades to a role when there is no company name', () => {
  assert.ok(replyNoticeSmsBody({ url: URL }).startsWith('Your contractor replied'));
  assert.ok(replyNoticeSmsBody({ companyName: '   ', url: URL })
    .startsWith('Your contractor replied'));
});

// ── A2P 10DLC (campaign rejected 2026-08-19: 30886 + 30909) ─────────────────

test('EVERY message a client can receive carries the opt-out', () => {
  // A carrier reviewer samples messages; finding it on the priced one and not the
  // acknowledgement is how a resubmission gets rejected a second time. There is no
  // branch that may omit it.
  const bodies = [
    priced(),
    priced({ amountText: null }),
    clientSmsBody({ kind: 'ewa', shownContent: 'T&M capped at $2,000.', url: URL }),
    clientSmsBody({ kind: 'acknowledge', shownContent: 'Please acknowledge.', url: URL }),
  ];
  for (const b of bodies) assert.ok(b.includes('Reply STOP to opt out. HELP for help.'), b);
});

test('the opt-out does not cost a third segment on a real message', () => {
  // The whole reason the line is 24 characters and not a sentence. Two segments is the
  // budget this module was built to hold; a compliance line that doubled the send cost
  // would be a different kind of failure.
  assert.ok(smsSegments(priced()) <= 2, `${smsSegments(priced())} segments`);
});

test('a long company name and address cannot buy a third segment', () => {
  // The budget used to be a comment ("11 characters of headroom") verified against one
  // fixture. Anything longer silently cost 50% more per send, invisibly, on every
  // client message — the kind of thing found on an invoice rather than in a test.
  const company = 'Wissotzky Brothers General Contracting and Restoration LLC';
  const job = '1155 Stanyan Street, Apartment 4B, San Francisco, California 94117';
  const amountText = '$128,450.00';
  const long = clientSmsBody({
    kind: 'confirm',
    companyName: company,
    jobLabel: job,
    amountText,
    url: 'https://ezchangeorders.com/c/abcdefghijklmnop',
    // The instrument must contain each one, or the builder omits it by design.
    shownContent: `${company}\n${job}\n${amountText}`,
  } as any);

  assert.ok(smsSegments(long) <= 2,
    `a real message must never exceed two segments, got ${smsSegments(long)}`);
  assert.match(long, /Open it here/, 'the link survives the trim');
  assert.match(long, /Reply STOP/, 'the opt-out survives the trim — the campaign depends on it');
  /**
   * THE TRIM MUST ACTUALLY TRIM (code review, 2026-08-23).
   *
   * The three assertions above all passed while the trim branch was unreachable: the
   * candidate was built with a `…`, which forces UCS-2 at 67 chars a segment, so every
   * shortened body still measured 4+ segments and the code fell through to dropping the
   * job line. A two-segment message with no `Job:` line satisfies "<= 2 segments", "the
   * link survives" and "the opt-out survives" perfectly — which is why the bug lived.
   *
   * So assert the OUTCOME the feature exists for: a shortened job line is present, and
   * the whole body is still GSM-7.
   */
  assert.match(long, /Job: 1155 Stanyan Street/,
    'a trimmed job line must survive — dropping it entirely is the fall-through, not the feature');
  assert.match(long, /Job:[^\n]*\.\.\./,
    'the trimmed line ends in periods, never the non-GSM-7 ellipsis character');
  assert.ok(isGsm7(long), 'one non-GSM-7 character doubles the segment count');
});
