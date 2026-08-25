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

TMP="$(mktemp -d)"
OUT="${TMP}/confirm.html"
sed -e "s|__SUPABASE_URL__|${URL}|g" -e "s|__ANON_KEY__|${ANON}|g" \
  apps/web/confirm.html > "$OUT"
# ewa.js needs no substitution -- it holds no keys and reaches no network. Copied
# rather than uploaded from the repo path only so both objects go up the same way.
cp apps/web/ewa.js "${TMP}/ewa.js"

# Upload as the signed-in owner. x-upsert so a redeploy replaces rather than fails.
upload() {   # $1 = filename, $2 = content type
  curl -s -o /dev/null -w '%{http_code}' -X POST \
    "${URL}/storage/v1/object/public-web/$1" \
    -H "apikey: ${ANON}" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: $2" \
    -H "cache-control: max-age=300" \
    -H "x-upsert: true" \
    --data-binary "@${TMP}/$1"
}

# ── BOTH FILES, ALWAYS. DEF-6, THE HALF OF IT THAT WAS STILL OPEN. ──────────
# This script uploaded confirm.html alone. ewa.js is loaded by confirm.html with a
# plain <script src="ewa.js">, so on a host where it was never uploaded EVERY Extra
# Work Authorization link failed closed at confirm.html's `typeof window.renderEwa
# !== 'function'` check -- "This authorization could not load". Failing closed is
# CORRECT and must stay: a page that cannot render the proceed term must never render
# a signable document. The defect was that nothing put the file where the page looks.
#
# STATED PRECISELY, so this is not read as a bigger fix than it is: the LIVE deploy is
# `.github/workflows/deploy-confirm-page.yml` (GitHub Pages), and that workflow has
# copied ewa.js since it was written -- Supabase Storage refuses to serve HTML, which
# is why Pages exists at all.
#
# CORRECTION [2026-08-25]: the line that used to sit here said "So the production path
# was never broken." It was broken, for three days, and in a way this note would have
# sent someone looking in the wrong place. Pages was set to LEGACY branch publishing
# from `gh-pages`, so the workflow's artifact was ignored and the branch served a
# confirm.html whose placeholders had never been substituted -- every client approval
# link opened to "Invalid supabaseUrl". The workflow was green throughout. Pages is now
# `build_type: workflow` and the workflow verifies the live URL after deploying.
# THIS script is
# the second, hand-run path to the `public-web` bucket, and it was still shipping a
# page whose EWA renderer could not be there. Two deploy paths that disagree about
# what a deploy contains is the same one-object-two-owners problem the SQL checker
# exists for; they now agree.
#
# ewa.js goes FIRST, deliberately. If the second upload fails, the host is left
# holding an older confirm.html alongside a newer ewa.js -- and ewa.js's helper
# fallbacks are written for exactly that pairing. The reverse order would leave a new
# confirm.html calling into an ewa.js that predates the helpers it passes.
ok=1
code_js=$(upload ewa.js "application/javascript; charset=utf-8")
[ "$code_js" = "200" ] || { echo "deploy failed (ewa.js): HTTP ${code_js}"; ok=0; }
code=$(upload confirm.html "text/html; charset=utf-8")
[ "$code" = "200" ] || { echo "deploy failed (confirm.html): HTTP ${code}"; ok=0; }
rm -rf "${TMP}"

[ "$ok" = "1" ] || exit 1
echo "deployed: ${URL}/storage/v1/object/public/public-web/confirm.html"
echo "deployed: ${URL}/storage/v1/object/public/public-web/ewa.js"
