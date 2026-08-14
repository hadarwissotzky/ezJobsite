/**
 * The job's map snapshot, fetched once and kept.
 *
 * WHY NOT JUST LET <Image> DO IT (hadar, 2026-08-12: "make sure it is cached, we
 * don't want to pull it every time"). Google returns `Cache-Control: public,
 * max-age=86400`, and iOS's NSURLCache honours it — so RN's Image does cache, for a
 * day, in a shared store the OS evicts under pressure. That is a cost control at
 * best, and it is not one here for two reasons:
 *
 *   1. MONEY. Static Maps is billed per request. A 24-hour TTL means every job on the
 *      list re-bills roughly daily, forever, for a picture of a street that has not
 *      moved. Keyed by coordinates, the honest number of requests per job is ONE.
 *
 *   2. MANDATE #7 — offline-forward. A contractor opens the Jobs list in a basement
 *      or on a site with no signal. An expired URL cache means grey rectangles at
 *      exactly the moment the app is supposed to work without a network. A file on
 *      disk does not expire.
 *
 * ─── the key ────────────────────────────────────────────────────────────────────
 * The filename is a hash of the RESOLVED URL, so it covers the coordinates AND the
 * template — change the zoom, the size or the marker colour and every job re-fetches
 * once, rather than showing stale snapshots taken at the old settings. Coordinates
 * are rounded to 5 decimal places (~1 m) first, so floating-point noise from a
 * re-geocode does not silently re-bill the whole list.
 *
 * ─── what it refuses to do ──────────────────────────────────────────────────────
 * It never blocks a render and never throws into one. A download that fails leaves
 * no file and returns null, the card falls back to the kit's map illustration, and
 * the next refresh tries again. A missing decoration is not worth an error screen on
 * the list a contractor opens fifty times a day.
 */
import * as FS from 'expo-file-system/legacy';
import { sha256 } from 'js-sha256';
import { mapUrlFor } from './mapurl';

export { mapUrlFor } from './mapurl';

const DIR = FS.documentDirectory + 'map-cache/';

let dirReady = false;
async function ensureDir() {
  if (dirReady) return;
  try {
    const info = await FS.getInfoAsync(DIR);
    if (!info.exists) await FS.makeDirectoryAsync(DIR, { intermediates: true });
    dirReady = true;
  } catch { /* a failed mkdir just means every lookup misses; the card falls back */ }
}

/**
 * A local file:// URI for this point's snapshot, downloading it once if needed.
 * Null when there is no template, no coordinates, or the fetch failed.
 */
export async function cachedMap(
  tmpl: string | undefined | null, lat: number | null, lng: number | null,
): Promise<string | null> {
  const url = mapUrlFor(tmpl, lat, lng);
  if (!url) return null;
  await ensureDir();
  const dest = `${DIR}${sha256(url)}.png`;
  try {
    const info = await FS.getInfoAsync(dest);
    // `size > 0` and not merely `exists`: an interrupted download leaves a 0-byte
    // file, and a cache that serves an empty image is worse than a cache miss —
    // it never retries and the card is permanently blank.
    if (info.exists && (info as any).size > 0) return dest;
    const r = await FS.downloadAsync(url, dest);
    if (r.status !== 200) { await FS.deleteAsync(dest, { idempotent: true }); return null; }
    return dest;
  } catch {
    return null;
  }
}

/** Snapshots for a list of jobs, keyed by job id. Missing entries render the
 *  fallback illustration; the caller never has to distinguish "no key", "no
 *  coordinates" and "download failed" — all three are simply absent. */
export async function cachedMaps(
  tmpl: string | undefined | null,
  jobs: readonly { id: string; lat: number | null; lng: number | null }[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  // Sequential on purpose. This runs inside refresh() on a phone that may be on a
  // jobsite LTE connection; firing twenty image downloads at once competes with the
  // capture uploads, which are the thing that must not be starved (mandate #1).
  for (const j of jobs) {
    const uri = await cachedMap(tmpl, j.lat, j.lng);
    if (uri) out[j.id] = uri;
  }
  return out;
}
