/**
 * READING A DOLLAR FIGURE OUT OF WHAT SOMEBODY SAID — the one implementation.
 *
 * Split out of changeorder.ts on 2026-08-25 so the WORKER can use it too. Until then
 * the price was parsed only on the phone, AFTER the change order had already synced,
 * and `ingest_change_order_v1` is insert-once — so the figure never reached the server.
 * Eight change orders on production, none of them carrying a price.
 *
 * IT IS VENDORED, NOT IMPORTED, BY THE WORKER. Render builds with `rootDir:
 * apps/worker`, so nothing outside that directory exists at deploy time and a relative
 * import across apps would break the DEPLOY rather than fail a test. `apps/worker/src/`
 * holds a byte-for-byte copy and `moneyagreement.test.ts` fails the moment the two
 * drift — the same device `statusagreement.test.ts` uses to hold five copies of the
 * status rule together.
 *
 * NO IMPORTS, deliberately. This file has to stay loadable by a React Native bundle and
 * by `node --experimental-strip-types` alike; one dependency on either side ends that
 * and quietly forces the second implementation this file exists to prevent.
 */

export type ParsedMoney = {
  cents: number | null;
  /** low => do NOT prefill as if it were known. Make them type it. */
  confidence: 'high' | 'low' | 'none';
  matched?: string;
};

/**
 * Pull a dollar figure out of spoken/typed text.
 * "add three outlets, four fifty" is NOT parsed as $450 on purpose: spoken
 * numbers are exactly where transcription hallucinates, and a plausible-but-
 * wrong price is worse than no price.
 */
export function parseMoney(text: string): ParsedMoney {
  // $1,234.56 / $450 / 450 dollars — explicit currency markers only.
  const m = text.match(/\$\s?([\d,]+(?:\.\d{1,2})?)/)
    || text.match(/([\d,]+(?:\.\d{1,2})?)\s*(?:dollars|usd|bucks)\b/i);
  if (m) {
    const cents = Math.round(parseFloat(m[1].replace(/,/g, '')) * 100);
    if (Number.isFinite(cents) && cents >= 0) {
      return { cents, confidence: 'high', matched: m[0] };
    }
  }
  // A bare number MIGHT be a price. Surface it, but never as high confidence.
  const bare = text.match(/\b(\d{2,6}(?:\.\d{2})?)\b/);
  if (bare) {
    return { cents: Math.round(parseFloat(bare[1]) * 100), confidence: 'low', matched: bare[1] };
  }
  return { cents: null, confidence: 'none' };
}
