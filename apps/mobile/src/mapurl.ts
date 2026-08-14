/**
 * The Static Maps URL for a point. PURE — no filesystem, no network.
 *
 * Split out of mapcache.ts so it can be tested under `node --test` (that module
 * imports expo-file-system at the top level, which node cannot load). Same split the
 * rest of this repo uses: the decision lives in a pure module, the IO wraps it.
 *
 * THE ROUNDING IS THE POINT. This string is the cache key — mapcache hashes it to
 * name the file on disk. Two geocodes of the same address differ in the tenth decimal
 * place, and unrounded that is a different key, a fresh download and a fresh Static
 * Maps charge for a picture of the same street. 5 dp is about a metre.
 */
export function round5(n: number): string {
  return (Math.round(n * 1e5) / 1e5).toFixed(5);
}

export function mapUrlFor(
  tmpl: string | undefined | null, lat: number | null, lng: number | null,
): string | null {
  if (!tmpl || lat == null || lng == null) return null;
  return tmpl.replace(/\{lat\}/g, round5(lat)).replace(/\{lng\}/g, round5(lng));
}
