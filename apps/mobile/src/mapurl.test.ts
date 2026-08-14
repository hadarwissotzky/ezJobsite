/**
 * The map snapshot's cache key.
 *   cd apps/mobile && node --test src/mapurl.test.ts
 *
 * WHAT THIS EXISTS TO CATCH: this string is hashed to name the file on disk, so it
 * IS the cache key. Two failures follow from getting it wrong and neither is visible
 * on screen — the map looks fine either way:
 *   · a key that varies for the same place re-downloads and RE-BILLS Static Maps on
 *     every geocode, forever;
 *   · a key that does not vary when the TEMPLATE changes serves snapshots taken at
 *     the old zoom or size and never refreshes them.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mapUrlFor, round5 } from './mapurl.ts';

const T = 'https://maps.example/s?c={lat},{lng}&z=15&m={lat},{lng}&k=K';

test('no template, no coordinates -> no url', () => {
  assert.equal(mapUrlFor(undefined, 1, 2), null);
  assert.equal(mapUrlFor('', 1, 2), null);
  assert.equal(mapUrlFor(T, null, 2), null);
  assert.equal(mapUrlFor(T, 1, null), null);
});

test('every {lat}/{lng} placeholder is filled, not just the first', () => {
  const u = mapUrlFor(T, 37.7632472927288, -122.452503620273)!;
  assert.ok(!u.includes('{lat}') && !u.includes('{lng}'), u);
  // the marker copy too — a half-filled template silently drops the pin
  assert.equal(u.match(/37\.76325/g)?.length, 2);
});

test('re-geocoding the same address does not change the key', () => {
  // Two reads of one address differ in the far decimals; rounded, they are one place.
  const a = mapUrlFor(T, 37.76324729, -122.45250362)!;
  const b = mapUrlFor(T, 37.76324731, -122.45250359)!;
  assert.equal(a, b);
});

test('a metre apart IS a different key', () => {
  // 5 dp is ~1 m: two genuinely different pins must not share a snapshot.
  assert.notEqual(mapUrlFor(T, 37.76324, -122.45250), mapUrlFor(T, 37.76424, -122.45250));
});

test('changing the template changes the key, so old snapshots are replaced', () => {
  const zoom15 = mapUrlFor(T, 37.7, -122.4);
  const zoom17 = mapUrlFor(T.replace('z=15', 'z=17'), 37.7, -122.4);
  assert.notEqual(zoom15, zoom17);
});

test('round5 is stable and fixed-width', () => {
  assert.equal(round5(37.7632472927288), '37.76325');
  assert.equal(round5(-122.4), '-122.40000');   // trailing zeros kept: one key per place
  assert.equal(round5(0), '0.00000');
});
