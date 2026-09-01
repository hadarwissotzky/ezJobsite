/**
 * Is there already a jobsite at this address?
 *
 * hadar, 2026-08-31: "we should not allow the creation of multiple jobsites with the
 * same address."
 *
 * WHY THIS IS NOT A DATABASE UNIQUE CONSTRAINT. A job must be creatable with no
 * signal (mandate #7), so the check has to run against the device's own list at the
 * moment of typing. A server-side constraint would accept the offline creation, let
 * the user work on it, and then REJECT the row at sync — turning a duplicate into
 * lost work, which is the one failure this project does not permit (mandate #1). The
 * device is where the answer is needed and where it can be acted on.
 *
 * WHY IT WARNS RATHER THAN REFUSES. Two units of a duplex, two phases of the same
 * remodel a year apart, and a genuine slip of the finger all look identical to a
 * string comparison. Refusing outright makes the legitimate cases impossible and
 * teaches the contractor that the app is wrong about his own street. The caller
 * shows what already exists and offers to open it; creating anyway stays available
 * and deliberate. That is mandate #2's shape — confirm, don't automate — applied to
 * a refusal instead of a send.
 */

import { distanceM } from './projects.ts';

/**
 * The same place, written two ways, must reduce to the same string.
 *
 * "1155 Stanyan St · San Francisco, CA" and "1155 stanyan street, san francisco ca"
 * are one address. Punctuation, case and the street-type abbreviation are the three
 * ways the same jobsite gets typed differently — the middle dot in particular comes
 * from our own geocoder, so a hand-typed address never matches a picked one without
 * this.
 */
const STREET_WORDS: Record<string, string> = {
  street: 'st', str: 'st',
  avenue: 'ave', av: 'ave',
  road: 'rd', drive: 'dr', lane: 'ln', court: 'ct', place: 'pl',
  boulevard: 'blvd', highway: 'hwy', parkway: 'pkwy', terrace: 'ter',
  circle: 'cir', square: 'sq', trail: 'trl',
  north: 'n', south: 's', east: 'e', west: 'w',
  northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw',
  apartment: 'apt', suite: 'ste', unit: 'unit', number: 'no',
};

export function normalizeAddress(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .toLowerCase()
    // Everything that is not a letter or digit is a separator. This is what kills the
    // geocoder's "·", commas, and the difference between "st." and "st".
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((w) => STREET_WORDS[w] ?? w)
    .join(' ');
}

/**
 * How close two pins have to be to be the same jobsite.
 *
 * A geocoded street address lands within a few metres of the same point every time,
 * so this only has to absorb that jitter — not neighbouring lots. 35m is roughly one
 * suburban lot width: wide enough that the same house geocoded twice always matches,
 * narrow enough that the house next door does not.
 */
export const SAME_SITE_M = 35;

export type SiteLike = {
  id: string; name: string; address?: string | null;
  lat?: number | null; lng?: number | null;
};

/**
 * The first existing jobsite that looks like the one being created, or null.
 *
 * TWO INDEPENDENT SIGNALS, because either one alone has a blind spot. The normalised
 * STRING catches "1155 Stanyan St" typed twice even with no GPS fix at all — the
 * offline case. The COORDINATES catch the same house written two irreconcilable ways
 * ("… San Francisco, CA" against "… San Francisco 94117"), which no amount of string
 * normalising will ever reconcile, because neither spelling contains what the other
 * one knows.
 *
 * `skipId` exists so an edit of an existing job does not report the job as its own
 * duplicate.
 */
export function findAddressTwin<T extends SiteLike>(
  sites: readonly T[],
  address: string | null | undefined,
  coords?: { lat?: number | null; lng?: number | null } | null,
  skipId?: string,
): T | null {
  const flat = normalizeAddress(address);
  const lat = coords?.lat, lng = coords?.lng;
  const havePin = typeof lat === 'number' && typeof lng === 'number';
  // Nothing to compare on. An address-less job is not a duplicate of anything —
  // reporting one would block the perfectly normal "name it now, place it later".
  if (!flat && !havePin) return null;

  for (const s of sites) {
    if (skipId && s.id === skipId) continue;
    if (flat && normalizeAddress(s.address) === flat) return s;
    if (havePin && typeof s.lat === 'number' && typeof s.lng === 'number') {
      if (distanceM({ lat: lat as number, lng: lng as number },
                    { lat: s.lat, lng: s.lng }) <= SAME_SITE_M) return s;
    }
  }
  return null;
}
