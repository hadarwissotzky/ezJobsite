-- 413 — where a contractor buys credits.
--
-- hadar, 2026-08-18: created the RevenueCat Web Purchase Link and supplied the token.
--
-- ─── WHY THIS IS A CONFIG ROW AND NOT A CONSTANT ────────────────────────────────
-- Same reason every other price in `pricing_config` is: the checkout URL is the one
-- thing in the purchase flow most likely to move. A purchase link can be regenerated,
-- pointed at a different offering, or swapped for the Web SDK on our own domain — and
-- none of that should need an App Store review cycle to reach a contractor.
--
-- ─── THE APP USER ID IS NOT OPTIONAL ────────────────────────────────────────────
-- RevenueCat's rule, and it fails loudly rather than quietly: a purchase link WITHOUT
-- the URL-encoded App User ID appended shows the customer a 404. The app appends
-- `company.id` — the same value `billing.ts` already gives the SDK as `appUserID`, so a
-- pack bought on the web lands on the same customer the app reads.
--
-- Getting this wrong is the failure that has already happened once on this project: a
-- purchase attached to `$RCAnonymousID:…`, the webhook matched nothing, and the money
-- bought nothing (`company.ts:billingTenantId`). The 404 is the better outcome — it is
-- at least visible.
--
--     https://pay.rev.cat/<token>/<company.id>
alter table public.pricing_config
  add column if not exists purchase_link_token text;

comment on column public.pricing_config.purchase_link_token is
  'RevenueCat Web Purchase Link token. The app builds '
  'https://pay.rev.cat/<token>/<company.id> — the App User ID must be appended or the '
  'customer sees a 404. Null disables the web rail in the client regardless of '
  'linkout_enabled, because a rail with no address is not a rail.';

update public.pricing_config
   set purchase_link_token = 'jzhrqgvkbhkbwqba',
       version = version + 1,
       updated_at = now()
 where id = 1;
