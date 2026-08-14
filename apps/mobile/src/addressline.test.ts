/**
 * The address-suggestion line.
 *   cd apps/mobile && node --test src/addressline.test.ts
 *
 * hadar, 2026-08-12: "the auto complete shows too much information, no need for the
 * neighbourhood or district." The rows used to be Nominatim's `display_name` — the full
 * administrative chain — so two suggestions for the same street differed only in their
 * first four characters and the rest wrapped to a second line.
 *
 * The fixtures below are REAL Nominatim shapes for the address in the screenshot,
 * including the multi-number node ("929;931;933") that produced the first row.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { formatAddressLine, type NominatimAddress } from './addressline.ts';

/** 933 Stanyan St, as Nominatim returns it with addressdetails=1. */
const stanyan: NominatimAddress = {
  house_number: '933',
  road: 'Stanyan Street',
  neighbourhood: 'Cole Valley',
  suburb: 'Haight-Ashbury',
  city_district: 'Richmond District',
  city: 'San Francisco',
  county: 'City and County of San Francisco',
  state: 'California',
  'ISO3166-2-lvl4': 'US-CA',
  postcode: '94117',
  country: 'United States',
  country_code: 'us',
};

test('the line is number, street, city, state and ZIP — nothing else', () => {
  assert.equal(formatAddressLine(stanyan), '933 Stanyan Street, San Francisco, CA 94117');
});

test('the neighbourhood, suburb, district, county and country are all dropped', () => {
  const line = formatAddressLine(stanyan);
  for (const noise of ['Cole Valley', 'Haight-Ashbury', 'Richmond District',
                       'City and County', 'United States']) {
    assert.ok(!line.includes(noise), `"${noise}" must not appear — got: ${line}`);
  }
});

test('the state is abbreviated from ISO3166-2-lvl4, not spelled out', () => {
  assert.ok(formatAddressLine(stanyan).includes('CA 94117'));
  assert.ok(!formatAddressLine(stanyan).includes('California'));
});

test('no ISO code falls back to the state NAME rather than dropping the state', () => {
  const { 'ISO3166-2-lvl4': _iso, ...noIso } = stanyan;
  assert.equal(formatAddressLine(noIso), '933 Stanyan Street, San Francisco, California 94117');
});

test('a multi-number node shows the number the user actually typed', () => {
  // OSM records one building covering several street numbers this way. Rendering it
  // verbatim hands the contractor an address he did not ask for — and he would then
  // print it on a change order.
  const range: NominatimAddress = { ...stanyan, house_number: '929;931;933' };
  assert.equal(formatAddressLine(range, '933 Stanyan St'),
    '933 Stanyan Street, San Francisco, CA 94117');
});

test('a multi-number node with no matching query falls back to the FIRST, never invents', () => {
  const range: NominatimAddress = { ...stanyan, house_number: '929;931;933' };
  assert.equal(formatAddressLine(range, 'Stanyan St'),
    '929 Stanyan Street, San Francisco, CA 94117');
});

test('a query number that is not one of the node\'s numbers does not override it', () => {
  const range: NominatimAddress = { ...stanyan, house_number: '929;931;933' };
  assert.equal(formatAddressLine(range, '947 Stanyan St'),
    '929 Stanyan Street, San Francisco, CA 94117');
});

test('missing parts shorten the line instead of leaving stray commas', () => {
  assert.equal(formatAddressLine({ road: 'Stanyan Street', city: 'San Francisco' }),
    'Stanyan Street, San Francisco');
  assert.equal(formatAddressLine({ house_number: '933', road: 'Stanyan Street' }),
    '933 Stanyan Street');
  assert.equal(formatAddressLine({}), '', 'an empty address yields an empty line, not ", ,"');
});

test('town/village/hamlet stand in for city — rural jobs have no "city"', () => {
  const { city: _c, ...noCity } = stanyan;
  assert.ok(formatAddressLine({ ...noCity, town: 'Bolinas' }).includes('Bolinas'));
  assert.ok(formatAddressLine({ ...noCity, village: 'Nicasio' }).includes('Nicasio'));
  assert.ok(formatAddressLine({ ...noCity, hamlet: 'Olema' }).includes('Olema'));
});
