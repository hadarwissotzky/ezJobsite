/**
 * Where and when — MANDATE #9: "Every media capture is stamped with GPS + time
 * as tamper-evident evidence."
 *
 * This was unmet for EVERY modality, not just photo. A photo with no location is
 * a picture; a photo stamped with where and when it was taken is evidence. The
 * whole product is "protect contractors from miscommunication", and the stamp is
 * what makes a capture worth something in the argument it exists to prevent.
 *
 * THREE RULES THAT SHAPE THIS FILE:
 *
 * 1. A MISSING FIX NEVER BLOCKS A CAPTURE. Mandate #1 says never lose a capture;
 *    mandate #7 says the network is never a precondition. GPS is neither instant
 *    nor guaranteed -- indoors, in a basement, with location denied, there is no
 *    fix. So the stamp is BEST-EFFORT with a short timeout, and its absence is
 *    recorded honestly (`stamp_status`) rather than faked, retried forever, or
 *    allowed to stop the capture. A capture with no location beats no capture.
 *
 * 2. NEVER INVENT A LOCATION. No last-known-position fallback dressed up as the
 *    capture's location: a stale fix from a different jobsite is WORSE than null,
 *    because null is honest and a wrong stamp is evidence of something that did
 *    not happen. If a cached fix is used at all it carries its own age.
 *
 * 3. "TAMPER-EVIDENT" IS A CLAIM WE MUST NOT OVERSTATE. These values come from the
 *    OS and are stored in a row the device authored. That makes them evidence of
 *    what the device believed, corroborated by the media hash and the append-only
 *    chain -- NOT proof against a determined forger with a jailbroken phone and a
 *    GPS spoofer. Stated here so nobody reads the column name and assumes more
 *    than it can carry.
 */
import * as Location from 'expo-location';

export type StampStatus =
  | 'ok'                 // a real fix, taken at capture time
  | 'denied'             // the user said no; their choice, recorded, not nagged
  | 'unavailable'        // services off, or no fix in the time we allow
  | 'timeout';           // we stopped waiting rather than stall the capture

export type Stamp = {
  capturedAtMs: number;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  /** How old the fix was when we used it. 0 for a fresh one. */
  fixAgeMs: number | null;
  status: StampStatus;
};

/** Long enough for a real fix outdoors, short enough never to feel like a stall. */
const GPS_TIMEOUT_MS = 3_000;

/**
 * Ask once, at capture time. Never blocks longer than GPS_TIMEOUT_MS.
 * The clock is always stamped; only the location can be missing.
 */
export async function stampNow(): Promise<Stamp> {
  const capturedAtMs = Date.now();
  const base: Stamp = {
    capturedAtMs, lat: null, lng: null, accuracyM: null, fixAgeMs: null,
    status: 'unavailable',
  };

  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') return { ...base, status: 'denied' };

    // Race the fix against the clock. A capture must never wait on a satellite.
    const fix = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((r) => setTimeout(() => r(null), GPS_TIMEOUT_MS)),
    ]);
    if (!fix) return { ...base, status: 'timeout' };

    return {
      capturedAtMs,
      lat: fix.coords.latitude,
      lng: fix.coords.longitude,
      accuracyM: fix.coords.accuracy ?? null,
      // ROUNDED. iOS returns a FRACTIONAL timestamp, so this was a float
      // (219.08984375), and capture_commit is a STRICT table: "cannot store REAL
      // value in INTEGER column". Every stamped capture FAILED -- loudly, which is
      // the right failure mode, but a total break of the capture path the moment
      // location was granted. Sub-millisecond precision on the age of a GPS fix
      // is meaningless anyway.
      fixAgeMs: Math.round(Math.max(0, capturedAtMs - fix.timestamp)),
      status: 'ok',
    };
  } catch {
    // Location services off, hardware failure, anything else. The capture
    // proceeds regardless -- that is the entire point of this catch.
    return base;
  }
}

/**
 * Request permission at a moment the user can understand, NOT on cold start.
 * Asked the first time someone reaches for the camera, when "why do you want my
 * location" answers itself. A permission sheet on launch, before the app has done
 * anything, is how you get denied by someone for whom software is not second
 * nature -- and a denial is sticky.
 */
export async function ensureLocationPermission(): Promise<boolean> {
  try {
    const cur = await Location.getForegroundPermissionsAsync();
    if (cur.status === 'granted') return true;
    if (!cur.canAskAgain) return false;
    const req = await Location.requestForegroundPermissionsAsync();
    return req.status === 'granted';
  } catch {
    return false;
  }
}

/** What the stamp means, in words a person would actually say. */
export function describeStamp(s: { lat: number | null; lng: number | null; stamp_status?: string }) {
  if (s.lat != null && s.lng != null) return `${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}`;
  switch (s.stamp_status) {
    case 'denied':      return 'no location (you turned it off)';
    case 'timeout':     return 'no location (no fix in time)';
    default:            return 'no location';
  }
}
