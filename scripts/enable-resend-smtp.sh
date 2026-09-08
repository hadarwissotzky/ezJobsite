#!/usr/bin/env bash
# Flip Supabase Auth's sign-in emails (web register.html + the app - both send
# their magic links through Supabase Auth) from the built-in mailer to Resend.
#
# WHY A SCRIPT AND NOT A DASHBOARD CLICK: the built-in mailer works today; a
# premature flip to an UNVERIFIED sender domain silently kills every sign-in
# email. So this refuses to run until Resend actually accepts mail from
# ezchangeorders.com - proved by a real send to Resend's own test inbox, not by
# reading a status field.
#
# Needs in the repo .env (or environment):
#   RESEND_API_KEY          - the send key (already stored 2026-09-08)
#   SUPABASE_ACCESS_TOKEN   - a personal access token from
#                             https://supabase.com/dashboard/account/tokens
set -euo pipefail
cd "$(dirname "$0")/.."
# Pull ONLY the two keys - .env holds unquoted placeholder values ("<...>")
# that break a blanket `source`.
envget() { grep -E "^$1=" .env | head -1 | cut -d= -f2-; }
RESEND_API_KEY=${RESEND_API_KEY:-$(envget RESEND_API_KEY)}
SUPABASE_ACCESS_TOKEN=${SUPABASE_ACCESS_TOKEN:-$(envget SUPABASE_ACCESS_TOKEN)}

REF=wwhfgsijnlpajvdiopfd
SENDER_EMAIL="signin@ezchangeorders.com"
SENDER_NAME="EZChangeOrder"

[ -n "${RESEND_API_KEY:-}" ] || { echo "RESEND_API_KEY missing from .env"; exit 1; }
[ -n "${SUPABASE_ACCESS_TOKEN:-}" ] || {
  echo "SUPABASE_ACCESS_TOKEN missing. Create one at"
  echo "  https://supabase.com/dashboard/account/tokens"
  echo "and add it to .env - the CLI's keychain login cannot be read from here."
  exit 1
}

# ── GATE: does Resend accept mail from our domain yet? ──────────────────────
# delivered@resend.dev is Resend's own test recipient - nothing lands anywhere.
probe=$(curl -s -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer $RESEND_API_KEY" -H "Content-Type: application/json" \
  -d "{\"from\":\"$SENDER_NAME <$SENDER_EMAIL>\",\"to\":[\"delivered@resend.dev\"],\"subject\":\"SMTP flip gate\",\"text\":\"Domain verification gate for enable-resend-smtp.sh\"}")
case "$probe" in
  *'"id"'*) echo "gate passed: Resend accepts mail from $SENDER_EMAIL" ;;
  *) echo "REFUSING to flip - Resend does not accept mail from ezchangeorders.com yet:"
     echo "  $probe"
     echo "Verify the domain at https://resend.com/domains (DNS lives at GoDaddy), then rerun."
     exit 1 ;;
esac

# ── FLIP: point Supabase Auth's SMTP at Resend ──────────────────────────────
# Resend SMTP: host smtp.resend.com, port 465 (implicit TLS), user literally
# "resend", password = the API key.
resp=$(curl -s -w '\n%{http_code}' -X PATCH "https://api.supabase.com/v1/projects/$REF/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d "{
    \"smtp_admin_email\": \"$SENDER_EMAIL\",
    \"smtp_sender_name\": \"$SENDER_NAME\",
    \"smtp_host\": \"smtp.resend.com\",
    \"smtp_port\": \"465\",
    \"smtp_user\": \"resend\",
    \"smtp_pass\": \"$RESEND_API_KEY\",
    \"smtp_max_frequency\": 5
  }")
code=${resp##*$'\n'}
[ "$code" = "200" ] || { echo "Supabase config PATCH failed ($code): ${resp%$'\n'*}"; exit 1; }

# ── PROVE it stuck (memory rule: a deploy that cannot say it deployed is not
# a deploy). Read the config back; the pass is redacted, the host is not. ────
back=$(curl -s "https://api.supabase.com/v1/projects/$REF/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN")
case "$back" in
  *'"smtp_host":"smtp.resend.com"'*) echo "LIVE - Supabase Auth now sends via Resend as $SENDER_NAME <$SENDER_EMAIL>" ;;
  *) echo "PATCH answered 200 but the config does not show smtp.resend.com - inspect manually:"; echo "$back" | head -c 600; exit 1 ;;
esac
echo "Final check: register at https://approve.ezchangeorders.com/register.html and confirm the email arrives from $SENDER_EMAIL."
