/**
 * Address assist — good UX wherever an address is typed. Two keyless sources:
 *
 *  - TYPEAHEAD (`suggestAddresses`) — OpenStreetMap **Nominatim**, free, no API key.
 *    Caller debounces (Nominatim asks ≤1 req/s) and a User-Agent is required by its
 *    usage policy. Returns a label + lat/lng, so selecting one also pins the job for
 *    the static map and GPS resolution.
 *  - "USE MY LOCATION" (`addressFromHere`) — expo-location's OS reverse-geocoder,
 *    keyless, turns the current fix into a street address (CompanyCam's "nearest
 *    address" pattern) with zero typing.
 *
 * OFFLINE-FORWARD (mandate #7): both need the network; when it's absent they return
 * nothing and the caller falls back to a plain editable field. Address assist is an
 * online *enhancement*, never a precondition to naming a job.
 *
 * To upgrade to Google Places later, swap `suggestAddresses`'s fetch for the Places
 * Autocomplete + Details calls (key in an EXPO_PUBLIC_ var); the component contract
 * (label + lat/lng) does not change.
 */
import * as Location from 'expo-location';

export type AddressHit = { label: string; lat: number; lng: number };

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const UA = 'EZchangeorder/1.0 (jobsite field-capture app)';   // Nominatim requires an identifying UA

/** Typeahead suggestions for a partial address. [] on empty query, offline, or error. */
export async function suggestAddresses(query: string): Promise<AddressHit[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  try {
    const url = `${NOMINATIM}?q=${encodeURIComponent(q)}&format=jsonv2&addressdetails=1&limit=5&countrycodes=us`;
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' } });
    if (!r.ok) return [];
    const rows = (await r.json()) as Array<{ display_name: string; lat: string; lon: string }>;
    return rows
      .map((x) => ({ label: x.display_name, lat: parseFloat(x.lat), lng: parseFloat(x.lon) }))
      .filter((h) => Number.isFinite(h.lat) && Number.isFinite(h.lng));
  } catch {
    return [];   // offline / rate-limited / bad response -> no suggestions, plain field still works
  }
}

/**
 * The street address for a KNOWN fix. Used to make a capture's stamp readable:
 * a contractor cannot check "37.76543, -122.45678", but can check "841 Hickory Hill Rd".
 * Keyless (OS reverse-geocoder). Needs network; null offline, and the caller must then
 * fall back to something honest rather than printing coordinates.
 */
export async function addressFor(lat: number, lng: number): Promise<string | null> {
  try {
    const [a] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
    if (!a) return null;
    const street = [a.streetNumber, a.street].filter(Boolean).join(' ');
    const rest = [a.city, a.region].filter(Boolean).join(', ');
    const label = [street, rest].filter(Boolean).join(' · ');
    return label || null;
  } catch {
    return null;
  }
}

/** The street address at the current GPS fix, via the OS reverse-geocoder. null if unavailable. */
export async function addressFromHere(): Promise<AddressHit | null> {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (perm.status !== 'granted') {
      const req = await Location.requestForegroundPermissionsAsync();
      if (req.status !== 'granted') return null;
    }
    const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const [a] = await Location.reverseGeocodeAsync({
      latitude: fix.coords.latitude, longitude: fix.coords.longitude,
    });
    if (!a) return null;
    const label = [a.streetNumber, a.street, a.city, a.region, a.postalCode]
      .filter(Boolean).join(a.streetNumber ? ' ' : ', ').replace(/^(\S+ \S+)/, '$1,');
    return {
      label: label || `${fix.coords.latitude.toFixed(5)}, ${fix.coords.longitude.toFixed(5)}`,
      lat: fix.coords.latitude, lng: fix.coords.longitude,
    };
  } catch {
    return null;
  }
}
