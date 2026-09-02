/**
 * THE VENDORED COPIES MUST BE IDENTICAL — byte for byte.
 *
 * The worker needs the app's money parser, and it cannot import it: Render builds with
 * `rootDir: apps/worker`, so anything outside that directory does not exist at deploy
 * time. A relative import across apps would break the DEPLOY, not a test — the worst
 * place to find out. So `money.ts` and `voiceprice.ts` are copied here.
 *
 * Two implementations of a money parser is a worse bug than the one this fixes: the
 * phone would show one figure, the server would store another, and the difference would
 * surface on a document somebody signed. This test is what makes the copies safe. It is
 * the same device `statusagreement.test.ts` uses to hold five copies of the status rule
 * together, applied to two copies of a parser.
 *
 * If this fails: copy the app's file over the worker's, do not edit one to match. The
 * app is the source; this directory is the copy.
 *
 * Run: cd apps/worker && npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const HERE = new URL('.', import.meta.url).pathname;
const APP = join(HERE, '..', '..', 'mobile', 'src');

for (const f of ['money.ts', 'voiceprice.ts']) {
  test(`${f} is byte-identical to the app's copy`, () => {
    const mine = readFileSync(join(HERE, f), 'utf8');
    const theirs = readFileSync(join(APP, f), 'utf8');
    assert.equal(mine, theirs,
      `apps/worker/src/${f} has drifted from apps/mobile/src/${f}. ` +
      'Copy the app\'s file over this one — the app is the source.');
  });
}

test('the two parsers agree on the figures that matter', async () => {
  // Belt and braces over the byte check: if someone ever makes the copy deliberate,
  // the behaviour still has to match on the cases that reach a client's document.
  const mine = await import('./money.ts');
  const theirs = await import('../../mobile/src/money.ts');
  for (const s of [
    '$1,200', '$1,200.00', 'about $1,200', '1200 dollars', 'four fifty',
    '750', 'call it $3,000 for the whole thing', 'no price here', '',
    // THE GROUPED BARE FIGURE. "1,850" used to return $850 — `\b(\d{2,6})\b` cannot
    // match across a comma, so it landed on the last group and dropped the thousands.
    // A hundredfold error on the field mandate #6 calls the highest-risk one, returning
    // a plausible number so nothing downstream could catch it. Found on hadar's own
    // recording, 2026-09-02.
    '1,850', '1,850 dollars', '12,400', '1,850.50', '1850',
  ]) {
    assert.deepEqual(mine.parseMoney(s), theirs.parseMoney(s), `disagreed on: ${s}`);
  }
});

test('a grouping comma never eats the thousands digit', async () => {
  const { parseMoney } = await import('./money.ts');
  // The exact shape that produced $850 for a spoken $1,850.
  assert.equal(parseMoney('1,850').cents, 185000);
  assert.equal(parseMoney('fix price 1,850 added a day').cents, 185000);
  assert.equal(parseMoney('12,400').cents, 1240000);
  assert.equal(parseMoney('1,850.50').cents, 185050);
  // Ungrouped and sub-thousand figures are unchanged.
  assert.equal(parseMoney('1850').cents, 185000);
  assert.equal(parseMoney('850').cents, 85000);
  assert.equal(parseMoney('18.50').cents, 1850);
});

test('a decimal point is not a sentence boundary', async () => {
  const { extractPrice } = await import('./voiceprice.ts');
  const { parseMoney } = await import('./money.ts');
  // hadar's own recording, 2026-09-02. "$18.50" was split at the decimal and read as
  // $18.00 — a price silently losing its cents, with a tick beside it on the read-back.
  assert.equal(extractPrice(
    'Open the wall. Need to reroute the line. Fixed price $18.50 added a day.',
    parseMoney).amountCents, 1850);
  assert.equal(extractPrice('Subfloor rot. Fixed price $1,850.00 and it adds a day.',
    parseMoney).amountCents, 185000);
  // Ordinary sentence splitting is untouched: 'p' and 'F' are not digits.
  assert.equal(extractPrice('Reroute the line. Nothing else changes.', parseMoney)
    .amountCents, null);
});
