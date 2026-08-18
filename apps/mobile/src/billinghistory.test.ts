/**
 * The billing list's rendering rules.
 *   cd apps/mobile && node --test src/billinghistory.test.ts
 *
 * Every test here guards the same class of failure: a billing screen stating something
 * about money that is not true. On this screen a wrong figure is not a cosmetic bug — it
 * is the app telling a contractor what he was charged.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { invoiceAmount, isRefunded, receiptUrlFor, type Invoice } from './billinghistory.ts';

const inv = (over: Partial<Invoice> = {}): Invoice => ({
  id: 'p1', atMs: 1_700_000_000_000, product: 'credits_20',
  amountCents: 7900, currency: 'USD', store: 'rc_billing',
  kind: 'purchase', status: 'active', ...over,
});

test('an unknown amount renders as ABSENT, never as $0.00', () => {
  // The whole reason `amountCents` is nullable end to end. "$0.00" on a billing line
  // says he was charged nothing, which is a different claim from "we do not know".
  assert.equal(invoiceAmount(inv({ amountCents: null })), null);
  assert.equal(invoiceAmount(inv({ amountCents: undefined as any })), null);
});

test('a real zero still prints — it is a fact, not a gap', () => {
  assert.equal(invoiceAmount(inv({ amountCents: 0 })), '$0.00');
});

test('the figure is cents, not dollars', () => {
  // A $25 pack arriving as 2500 must not render as $2,500. The server-side `centsOf`
  // guards the input side; this guards the output.
  assert.equal(invoiceAmount(inv({ amountCents: 2500 })), '$25.00');
  assert.equal(invoiceAmount(inv({ amountCents: 14900 })), '$149.00');
});

test('a non-USD amount keeps its currency beside it', () => {
  assert.equal(invoiceAmount(inv({ amountCents: 7900, currency: 'CAD' })), '79.00 CAD');
});

test('an App Store purchase points at Apple, because the receipt is Apple’s', () => {
  // We cannot render or email an IAP receipt. Sending him to a document we cannot
  // produce is worse than sending him to the account that holds it.
  assert.equal(receiptUrlFor(inv({ store: 'app_store' })), 'https://apps.apple.com/account/billing');
  assert.equal(receiptUrlFor(inv({ store: 'APP_STORE' })), 'https://apps.apple.com/account/billing');
});

test('a web purchase has no link here — Stripe already emailed the receipt', () => {
  assert.equal(receiptUrlFor(inv({ store: 'rc_billing' })), null);
  assert.equal(receiptUrlFor(inv({ store: 'stripe' })), null);
});

test('an unknown store offers no link rather than a guessed one', () => {
  assert.equal(receiptUrlFor(inv({ store: 'unknown' })), null);
  assert.equal(receiptUrlFor(inv({ store: '' })), null);
});

test('a refund is called out, whatever word the store used for it', () => {
  // The one status that changes what the line MEANS. Left inside a raw status string,
  // a contractor would have to interpret the store's vocabulary to see he was refunded.
  assert.equal(isRefunded(inv({ status: 'refunded' })), true);
  assert.equal(isRefunded(inv({ status: 'REFUNDED_FOR_ISSUE' })), true);
  assert.equal(isRefunded(inv({ status: 'revoked' })), true);
  assert.equal(isRefunded(inv({ status: 'active' })), false);
  assert.equal(isRefunded(inv({ status: null })), false);
});
