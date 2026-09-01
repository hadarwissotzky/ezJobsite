import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAddress, findAddressTwin, SAME_SITE_M } from './dupeaddress.ts';

const site = (id: string, address: string | null, lat?: number, lng?: number) =>
  ({ id, name: address ?? id, address, lat: lat ?? null, lng: lng ?? null });

// The real pair that was sitting in the database when this was written.
const REAL = '1155 Stanyan St · San Francisco, CA';

test('the geocoder middle dot does not make a new address', () => {
  assert.equal(normalizeAddress(REAL), normalizeAddress('1155 stanyan st, san francisco ca'));
});

test('street-type spellings collapse', () => {
  assert.equal(normalizeAddress('12 Oak Street'), normalizeAddress('12 oak st.'));
  assert.equal(normalizeAddress('9 N Bay Avenue'), normalizeAddress('9 north bay ave'));
});

test('a different house number is a different address', () => {
  assert.notEqual(normalizeAddress('1151 Stanyan St'), normalizeAddress('1155 Stanyan St'));
});

test('a unit number is preserved — a duplex is two jobs', () => {
  assert.notEqual(normalizeAddress('5 Elm St Apt A'), normalizeAddress('5 Elm St Apt B'));
});

test('finds the twin by string with no coordinates at all', () => {
  const found = findAddressTwin([site('a', REAL)], '1155 STANYAN STREET, San Francisco CA');
  assert.equal(found?.id, 'a');
});

test('finds the twin by pin when the two spellings can never match', () => {
  // "… San Francisco, CA" vs "… San Francisco 94117": neither string contains what
  // the other knows, so only the coordinates can answer this.
  const found = findAddressTwin(
    [site('a', '1155 Stanyan St · San Francisco, CA', 37.7671, -122.4531)],
    '1155 Stanyan st, San Francisco 94117', { lat: 37.7671, lng: -122.4531 });
  assert.equal(found?.id, 'a');
});

test('the house down the street is not a twin', () => {
  // ~0.01 degrees of latitude is over a kilometre — comfortably past SAME_SITE_M.
  const found = findAddressTwin(
    [site('a', '1 Far Rd', 37.7771, -122.4531)],
    '99 Other Rd', { lat: 37.7671, lng: -122.4531 });
  assert.equal(found, null);
  assert.ok(SAME_SITE_M < 100);
});

test('a job with no address is not a duplicate of anything', () => {
  assert.equal(findAddressTwin([site('a', REAL)], '', null), null);
  assert.equal(findAddressTwin([site('a', REAL)], null, { lat: null, lng: null }), null);
});

test('a job is never its own duplicate', () => {
  assert.equal(findAddressTwin([site('a', REAL)], REAL, null, 'a'), null);
});

test('an existing job with no address never matches', () => {
  assert.equal(findAddressTwin([site('a', null)], REAL), null);
});
