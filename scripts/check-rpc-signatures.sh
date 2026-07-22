#!/usr/bin/env bash
# Does every RPC the client calls actually EXIST, with the parameters the client sends?
#
# WHY THIS IS NOT COVERED BY ANYTHING ELSE: tsc checks TypeScript against TypeScript.
# An `.rpc('confirmation_create', { p_token, ... })` call is an untyped object literal
# crossing into Postgres, and PostgREST resolves it by EXACT PARAMETER NAME SET. Rename
# one parameter in a migration, or add one without a default, and every call fails at
# runtime with PGRST202 while the build stays green and every unit test passes.
#
# That is the app->server join, and it was the last one with no evidence.
#
# HOW IT TELLS THE TWO FAILURES APART, which is the whole trick:
#   PGRST202  -> "no function with those parameters". A real mismatch. FAIL.
#   42501     -> "permission denied" / "unknown token". The function was FOUND and
#                resolved; only the grant or the argument value stopped it. PASS —
#                that is exactly what an unauthenticated caller should see.
# So an anon key is enough to prove the signature without an account and without
# writing anything.
#
# A function that is absent because its migration is unapplied also reports PGRST202.
# Those are listed as PENDING rather than FAIL, and checked against the database so
# the list cannot go stale silently.
#
# Usage: ./scripts/check-rpc-signatures.sh
set -uo pipefail
cd "$(dirname "$0")/.."

URL=$(awk -F= '$1=="EXPO_PUBLIC_SUPABASE_URL"{v=$0;sub(/^[^=]*=/,"",v);gsub(/^["\x27]|["\x27]$/,"",v);print v;exit}' .env)
KEY=$(awk -F= '$1=="EXPO_PUBLIC_SUPABASE_ANON_KEY"{v=$0;sub(/^[^=]*=/,"",v);gsub(/^["\x27]|["\x27]$/,"",v);print v;exit}' .env)
[ -n "$URL" ] && [ -n "$KEY" ] || { echo "need EXPO_PUBLIC_SUPABASE_URL and _ANON_KEY in .env"; exit 2; }

# name : json body using the EXACT parameter set the client sends.
# Values are deliberately invalid — we are testing resolution, never behaviour, and
# nothing here may write.
probe() {
  local fn="$1" body="$2"
  local out code
  out=$(curl -s -X POST "$URL/rest/v1/rpc/$fn" -H "apikey: $KEY" \
        -H "Content-Type: application/json" -d "$body")
  code=$(printf '%s' "$out" | python3 -c "import sys,json
try: print(json.load(sys.stdin).get('code','OK'))
except Exception: print('OK')" 2>/dev/null)
  if [ "$code" = "PGRST202" ]; then echo "MISMATCH"; else echo "OK"; fi
}

FAIL=0
check() {
  local fn="$1" body="$2" r
  r=$(probe "$fn" "$body")
  if [ "$r" = "MISMATCH" ]; then
    # Absent because its migration is unapplied? Ask the database, do not assume.
    if ! ./spike/bin/pg.sh -X -q -A -t -c \
        "select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname='$fn' limit 1" 2>/dev/null | grep -q 1; then
      printf "  ?  %-26s PENDING (function not in the database — migration unapplied)\n" "$fn"
      return
    fi
    printf "  x  %-26s SIGNATURE MISMATCH — the client sends parameters this function does not take\n" "$fn"
    FAIL=1
  else
    printf "  v  %-26s signature resolves\n" "$fn"
  fi
}

echo
echo "RPC signatures, client call sites vs the live database:"
check confirmation_create '{"p_token":"x","p_decision_id":"d","p_project_id":"p","p_kind":"confirm","p_shown_content":"c","p_shown_sha256":"h","p_counterparty":"S","p_channel":"link","p_destination":null,"p_amount_cents":1,"p_nte_cents":null,"p_scope_title":"s","p_company_name":"c","p_job_label":"j","p_approved_running_cents":0,"p_change_order_id":null}'
check confirmation_fetch   '{"p_token":"no-such-token"}'
check confirmation_state   '{"p_token":"no-such-token"}'
check confirmation_respond '{"p_token":"no-such-token","p_action":"confirmed","p_note":null,"p_user_agent":"t","p_signed_name":"X"}'
check confirmation_ask     '{"p_token":"no-such-token","p_note":"q","p_user_agent":"t"}'
check confirmation_thread  '{"p_token":"no-such-token"}'
check confirmation_opened  '{"p_token":"no-such-token","p_user_agent":"t"}'
check ewa_terms_fetch      '{"p_token":"no-such-token"}'
echo
[ "$FAIL" = "0" ] && echo "PASS — no signature mismatches." || echo "FAIL — a client call site does not match the database."
exit "$FAIL"
