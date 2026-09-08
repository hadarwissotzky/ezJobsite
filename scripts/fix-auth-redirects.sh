#!/usr/bin/env bash
# Point Supabase Auth's redirect config at the real product.
#
# PROVEN BROKEN 2026-09-08 (hadar: email validate button lands on "a supabase
# empty screen"): the project still runs the factory Site URL
# http://localhost:3000 and an empty redirect allow-list, so /auth/v1/verify
# bounces EVERY emailed link - web registration and the app's sign-in link
# alike - to localhost. Probe that proved it:
#   curl -sI ".../auth/v1/verify?token=bogus&type=magiclink&redirect_to=..."
#   -> 303 Location: http://localhost:3000/#error=...
#
# Needs SUPABASE_ACCESS_TOKEN in .env or the environment
# (create at https://supabase.com/dashboard/account/tokens).
set -euo pipefail
cd "$(dirname "$0")/.."
envget() { grep -E "^$1=" .env | head -1 | cut -d= -f2- || true; }
SUPABASE_ACCESS_TOKEN=${SUPABASE_ACCESS_TOKEN:-$(envget SUPABASE_ACCESS_TOKEN)}
[ -n "${SUPABASE_ACCESS_TOKEN:-}" ] || {
  echo "SUPABASE_ACCESS_TOKEN missing. Create one at"
  echo "  https://supabase.com/dashboard/account/tokens"
  echo "and add it to .env."
  exit 1
}

REF=wwhfgsijnlpajvdiopfd
# Site URL is the fallback for any unlisted redirect AND {{ .SiteURL }} in the
# email templates - it must be a page that exists on a phone.
SITE_URL="https://approve.ezchangeorders.com"
# The three real redirect targets: web registration, anything else on the two
# public hosts, and the app's deep link (authscreen.tsx builds
# Linking.createURL('auth-callback') under scheme "ezjobsite").
ALLOW="https://approve.ezchangeorders.com/*,https://www.ezchangeorders.com/*,ezjobsite://*,ezjobsite:///*"

resp=$(curl -s -w '\n%{http_code}' -X PATCH "https://api.supabase.com/v1/projects/$REF/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d "{\"site_url\": \"$SITE_URL\", \"uri_allow_list\": \"$ALLOW\"}")
code=${resp##*$'\n'}
[ "$code" = "200" ] || { echo "PATCH failed ($code): ${resp%$'\n'*}"; exit 1; }

# PROVE it, the same way the bug was proven: a bogus-token verify must now
# bounce to the allow-listed target, not localhost.
loc=$(curl -s -o /dev/null -w '%{redirect_url}' \
  "https://$REF.supabase.co/auth/v1/verify?token=bogus&type=magiclink&redirect_to=https://approve.ezchangeorders.com/register.html")
case "$loc" in
  https://approve.ezchangeorders.com/register.html*)
    echo "LIVE - emailed links now return to the product (probe bounced to: $loc)" ;;
  *) echo "PATCH answered 200 but the verify probe still bounces to: $loc"; exit 1 ;;
esac
echo "Final check: register on the phone again - the email button should land back in the flow."
