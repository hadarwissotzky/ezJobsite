#!/usr/bin/env bash
# Deploy the no-login confirmation page to the public-web bucket.
#
# It is a static file, so "deploy" is an upload. The anon key is substituted in
# at this step rather than committed into the HTML: the key is public, but a repo
# that hardcodes one project's key is a repo that silently deploys to the wrong
# project the first time someone forks it.
set -euo pipefail
cd "$(dirname "$0")/.."

getval(){ awk -F= -v k="$1" '$1==k{sub(/^[^=]*=/,"");print}' .env | tr -d '"'"'"'\r'; }
URL="$(getval EXPO_PUBLIC_SUPABASE_URL)"
ANON="$(getval EXPO_PUBLIC_SUPABASE_ANON_KEY)"
[ -n "$URL" ] && [ -n "$ANON" ] || { echo "missing .env values"; exit 1; }

# Deploy as a SIGNED-IN OWNER, not with the service-role key.
#
# The bucket policy already says "authenticated may write to public-web", so a
# session is sufficient and the service-role key -- which bypasses RLS entirely --
# is not needed. Using the weaker credential that suffices means a leaked deploy
# script cannot be turned into full database access.
# (SUPABASE_SERVICE_ROLE_KEY in .env is still an unfilled placeholder anyway.)
EMAIL="${DEPLOY_EMAIL:-device1@example.com}"
PASSWORD="${DEPLOY_PASSWORD:-bakeoff-spike-pw-2026}"
TOKEN=$(curl -s -X POST "${URL}/auth/v1/token?grant_type=password" \
  -H "apikey: ${ANON}" -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))")
[ -n "$TOKEN" ] || { echo "could not sign in as ${EMAIL}"; exit 1; }

OUT="$(mktemp -d)/confirm.html"
sed -e "s|__SUPABASE_URL__|${URL}|g" -e "s|__ANON_KEY__|${ANON}|g" \
  apps/web/confirm.html > "$OUT"

# Upload with the service role: only the owner deploys the page. x-upsert so a
# redeploy replaces it rather than failing.
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  "${URL}/storage/v1/object/public-web/confirm.html" \
  -H "apikey: ${ANON}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: text/html; charset=utf-8" \
  -H "cache-control: max-age=300" \
  -H "x-upsert: true" \
  --data-binary "@${OUT}")
rm -rf "$(dirname "$OUT")"

if [ "$code" = "200" ]; then
  echo "deployed: ${URL}/storage/v1/object/public/public-web/confirm.html"
else
  echo "deploy failed: HTTP ${code}"; exit 1
fi
