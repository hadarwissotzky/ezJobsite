/**
 * GPS -> US state, fully OFFLINE. Mandate #7 (offline-forward, paramount): the
 * recording-consent screen must work with no signal, so this resolves a fix
 * against BUNDLED state boundaries with an on-device point-in-polygon test --
 * never an online reverse-geocode (iOS CLGeocoder needs the network; we cannot
 * make a legal-basis question wait on a tower).
 *
 * WHY THIS SUGGESTS BUT DOES NOT DECIDE (mandate #2, confirm-don't-automate).
 * The state chooses the *legal basis* for recording people -- one-party vs
 * all-party consent. A wrong auto-answer near a border, or on a bad/spoofed/stale
 * fix, could steer someone into unlawfully recording a person. That is exactly the
 * line the product refuses to cross silently. So this only PRE-FILLS the state;
 * the human still taps a basis to commit (see App.tsx `choose`), and can override
 * the state by typing. It accelerates the common case; it is not the decision.
 *
 * The boundaries are a simplified public dataset (~88KB, 50 states + DC + PR).
 * Near a state line the simplification can miss -- acceptable *because* the choice
 * is confirmed, never committed silently. A miss costs one correcting keystroke;
 * it never mis-commits a consent basis on its own.
 */
import statesGeo from './us-states.geo.json';

type Ring = number[][];              // [ [lng,lat], ... ]
type Polygon = Ring[];               // [ outerRing, ...holeRings ]
type Feature = { properties: { name: string }; geometry: { type: string; coordinates: any } };

const NAME_TO_ABBR: Record<string, string> = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA',
  Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', 'District of Columbia': 'DC',
  Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL',
  Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA',
  Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN',
  Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK',
  Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT',
  Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI',
  Wyoming: 'WY', 'Puerto Rico': 'PR',
};

/**
 * Ray-casting: is (lng,lat) inside this ring? Coordinates are GeoJSON [lng,lat].
 * Counts crossings of a horizontal ray to the east; odd = inside.
 */
function inRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersects = (yi > lat) !== (yj > lat)
      && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Inside the outer ring and outside every hole. */
function inPolygon(lng: number, lat: number, polygon: Polygon): boolean {
  if (!polygon.length || !inRing(lng, lat, polygon[0])) return false;
  for (let i = 1; i < polygon.length; i++) {
    if (inRing(lng, lat, polygon[i])) return false; // in a hole -> not inside
  }
  return true;
}

/**
 * The 2-letter USPS code for the US jurisdiction containing this fix, or null if
 * it falls in no bundled boundary (outside the US, mid-ocean, or a bad fix). Null
 * is honest: the caller leaves the field blank and `defaultConsentFor(null)`
 * assumes the strictest rule, which is the safe default for an unknown location.
 */
export function resolveJurisdiction(lat: number, lng: number): string | null {
  const features = (statesGeo as { features: Feature[] }).features;
  for (const f of features) {
    const g = f.geometry;
    const polys: Polygon[] = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const poly of polys) {
      if (inPolygon(lng, lat, poly)) return NAME_TO_ABBR[f.properties.name] ?? null;
    }
  }
  return null;
}
