/**
 * How a letterhead reads on a client's document.
 *   cd apps/mobile && node --test src/letterhead.test.ts
 *
 * `letterheadLines` is the one part of this feature that is not a database call, and
 * it is the part a HOMEOWNER sees — the block printed above a price they are being
 * asked to authorise. The failures worth preventing are all the same shape: a blank
 * field turning into a visible hole in a document that is asking for trust.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { letterheadLines } from './letterhead.ts';

test('a full letterhead reads name, address, licence — in that order', () => {
  assert.deepEqual(
    letterheadLines({
      name: 'Wissotzky Construction',
      address: '1155 Stanyan St, San Francisco, CA 94117',
      license: 'CSLB 1043210',
    }),
    [
      'Wissotzky Construction',
      '1155 Stanyan St, San Francisco, CA 94117',
      'License CSLB 1043210',
    ]);
});

test('a missing licence shortens the block — it never prints "Not set"', () => {
  // 402's rule, applied on this side too: a half-filled business card is normal and
  // must render as a SHORTER card. "Not set" beside a price reads as an unfinished
  // document, which is the opposite of what a letterhead is for.
  assert.deepEqual(
    letterheadLines({ name: 'Wissotzky Construction', address: null, license: null }),
    ['Wissotzky Construction']);
});

test('whitespace is not content', () => {
  // The server collapses '' to null, but a caller mid-edit holds raw input, and a
  // line of spaces would print as a blank row in the middle of the letterhead.
  assert.deepEqual(
    letterheadLines({ name: '  Acme  ', address: '   ', license: '\n' }),
    ['Acme']);
});

test('the licence is labelled, because a bare number is unreadable', () => {
  // A homeowner checking a contractor against their state board has to know what the
  // number IS. "1043210" alone could be an invoice number or a phone extension.
  assert.deepEqual(letterheadLines({ name: 'Acme', license: '1043210' }),
                   ['Acme', 'License 1043210']);
});

test('a licence that already says so is not labelled twice', () => {
  // Contractors type it both ways, and "License License #12345" is the kind of detail
  // that makes a document look automated rather than authored.
  assert.deepEqual(letterheadLines({ name: 'Acme', license: 'License #12345' }),
                   ['Acme', 'License #12345']);
  assert.deepEqual(letterheadLines({ name: 'Acme', license: 'Lic. 998877' }),
                   ['Acme', 'Lic. 998877']);
});

test('an empty letterhead is an empty block, not a crash', () => {
  assert.deepEqual(letterheadLines({}), []);
  assert.deepEqual(letterheadLines({ name: null, address: null, license: null }), []);
});
