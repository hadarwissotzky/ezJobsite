/**
 * How one address suggestion READS. Pure, import-free, and its own module for the same
 * reason `mapurl.ts` is split out of `mapcache.ts`: `geocode.ts` imports expo-location
 * at module scope, which `node --test` cannot load, so a formatter living there is a
 * formatter with no tests. This one has nine.
 */
/** The structured half of a Nominatim result (`addressdetails=1`). Every field is
 *  optional — OSM data is contributed, not complete. */
export type NominatimAddress = {
  house_number?: string;
  road?: string;
  city?: string; town?: string; village?: string; hamlet?: string;
  state?: string; postcode?: string;
  /** "US-CA". The only place an abbreviation exists without shipping a state table. */
  'ISO3166-2-lvl4'?: string;
  [k: string]: string | undefined;
};

/**
 * ONE SUGGESTION LINE, as a contractor would write the address on an envelope.
 *
 * hadar, 2026-08-12: "the auto complete shows too much information, no need for the
 * neighbourhood or district."
 *
 * WHY IT WAS WRONG. The rows rendered Nominatim's `display_name`, which is the full
 * administrative chain — house number, street, neighbourhood, quarter, district, city,
 * county, state, postcode, country. On the screenshot that is "933, Stanyan Street,
 * Cole Valley, Haight-Ashbury, Richmond District, San Francisco, …", two wrapped lines
 * in which the words that tell one suggestion from another (the number and the street)
 * are the first four characters and everything after them is identical. A list whose
 * entries differ only in their first four characters is a list you cannot choose from.
 *
 * The request already asks for `addressdetails=1`, so the parts were arriving and being
 * thrown away. This keeps the four that identify a building — number, street, city,
 * state + ZIP — and drops the six that place it in a hierarchy nobody typed.
 *
 * THE STATE IS ABBREVIATED FROM `ISO3166-2-lvl4` ("US-CA" -> "CA"), not from a table of
 * fifty names. Nominatim already computed it; shipping our own map would be fifty more
 * strings that can disagree with the source.
 *
 * MULTI-NUMBER NODES. OSM records a building covering several street numbers as
 * "929;931;933". Rendering that verbatim gives a contractor an address he did not ask
 * for and would then print on a change order, so when the typed query names one of
 * them, THAT is the number shown; otherwise the first, which is the node's own order.
 * Never a number invented here.
 */
export function formatAddressLine(a: NominatimAddress, query = ''): string {
  const nums = (a.house_number ?? '').split(';').map((x) => x.trim()).filter(Boolean);
  const typed = query.match(/\d+/)?.[0];
  const num = (typed && nums.includes(typed)) ? typed : nums[0] ?? '';

  const street = [num, a.road].filter(Boolean).join(' ');
  const city = a.city || a.town || a.village || a.hamlet || '';
  const state = a['ISO3166-2-lvl4']?.split('-')[1] || a.state || '';
  const region = [state, a.postcode].filter(Boolean).join(' ');
  return [street, city, region].filter(Boolean).join(', ');
}
