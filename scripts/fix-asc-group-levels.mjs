/**
 * Fix the subscription group levels for EZchangeorder Plans (group 22268694).
 *
 * In App Store Connect, LEVEL 1 IS THE HIGHEST TIER. The group was configured
 * Core Monthly=1, Core Annual=2, Crew Monthly=3, Crew Annual=4 — i.e. StoreKit
 * believed Core outranked Crew, which is backwards: Crew is the pricier tier.
 *
 * The consequence is not cosmetic. StoreKit decides from the level whether a switch is
 * an UPGRADE (immediate, prorated) or a DOWNGRADE (deferred to next renewal). With the
 * levels inverted, someone paying MORE to move Core -> Crew would have waited until
 * their renewal to get it, while Crew -> Core would have applied instantly with a
 * refund. Both switches wrong, in the direction that costs the customer.
 *
 * Target: the two Crew products share level 1, the two Core products share level 2 —
 * two service tiers, each with a monthly and an annual. Same level + different duration
 * is a crossgrade, which is what monthly<->annual within one tier actually is.
 */
import { createSign, createPrivateKey } from 'node:crypto';
import { readFileSync } from 'node:fs';

const KEY_ID = 'PZ2U35DHUF';
const ISSUER = '69a6de72-5798-47e3-e053-5b8c7c11a4d1';
const KEY = createPrivateKey(readFileSync(process.env.HOME + '/.appstore/AuthKey_PZ2U35DHUF.p8'));

const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o))
  .toString('base64url');

function token() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' });
  const body = b64({ iss: ISSUER, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' });
  const s = createSign('SHA256');
  s.update(`${head}.${body}`);
  // ieee-p1363 is the r||s form JOSE wants; the default DER encoding is rejected.
  const sig = s.sign({ key: KEY, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `${head}.${body}.${sig}`;
}

const JWT = token();
const api = async (method, path, body) => {
  const r = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${JWT}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  return { status: r.status, json: text ? JSON.parse(text) : null };
};

const setLevel = (id, level) => api('PATCH', `/v1/subscriptions/${id}`, {
  data: { type: 'subscriptions', id, attributes: { groupLevel: level } },
});

const show = async () => {
  const r = await api('GET',
    '/v1/subscriptionGroups/22268694/subscriptions?fields[subscriptions]=name,productId,groupLevel&limit=50');
  return (r.json?.data ?? [])
    .map((d) => ({ id: d.id, name: d.attributes.name, level: d.attributes.groupLevel }))
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
};

const SUBS = {
  crewMonthly: '6795239874',
  crewAnnual: '6795239790',
  coreMonthly: '6795239815',
  coreAnnual: '6795239899',
};

console.log('BEFORE:', JSON.stringify(await show(), null, 1));

// Order matters if Apple refuses duplicate levels: push Core down and out of the way
// first, so Crew can take level 1 without ever colliding with a live value.
const steps = [
  ['coreMonthly', 3], ['coreAnnual', 4],   // vacate level 1 and 2
  ['crewMonthly', 1], ['crewAnnual', 1],   // Crew is the top tier
  ['coreMonthly', 2], ['coreAnnual', 2],   // Core sits below it
];

for (const [key, level] of steps) {
  const r = await setLevel(SUBS[key], level);
  const err = r.json?.errors?.[0];
  console.log(`${r.status === 200 ? 'ok  ' : 'FAIL'} ${key} -> ${level}` +
    (err ? `  :: ${err.title}: ${err.detail}` : ''));
}

console.log('AFTER: ', JSON.stringify(await show(), null, 1));
