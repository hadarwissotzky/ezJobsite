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
  ]) {
    assert.deepEqual(mine.parseMoney(s), theirs.parseMoney(s), `disagreed on: ${s}`);
  }
});
