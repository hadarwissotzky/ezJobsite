#!/usr/bin/env bash
# Deploy the pipeline worker, then PROVE it is running the new code.
#
# WHY THIS EXISTS (2026-08-25): three commits went to main and none of them
# reached production. Render's auto-deploy had stopped firing, the old process
# kept claiming jobs, and every diagnostic looked healthy — the worker was up,
# jobs completed in seconds, nothing errored. I reported "pushed" as "shipped"
# three times before checking behaviour. A deploy you cannot verify is a rumour.
#
# It triggers the hook, then requeues one capture's `structure` step and waits
# for a proposal carrying `structure_ms` — a field only the new code writes.
# That is the difference between "Render said 200" and "the code is running".
#
#   ./scripts/deploy-worker.sh [capture_id]
#
# With no argument it picks the most recently structured capture. The requeue is
# safe: capture_structured is append-only, so a re-run ADDS a reading and edits
# nothing, and apply_proposal_v1 only touches an unpriced draft.
set -euo pipefail
cd "$(dirname "$0")/.."

env_get() { /usr/bin/grep -m1 "^$1=" .env | cut -d= -f2- | tr -d "\"'\r"; }
HOOK="$(env_get RENDER_DEPLOY_HOOK)"
[ -n "$HOOK" ] || { echo "RENDER_DEPLOY_HOOK missing from .env (Render → service → Settings → Deploy Hook)"; exit 2; }

PGPASSWORD="$(env_get SUPABASE_DB_PASSWORD)"; export PGPASSWORD
PSQL=(/opt/homebrew/bin/psql -h "$(env_get SUPABASE_DB_HOST)" -p 5432
      -U "postgres.$(env_get SUPABASE_DB_HOST | cut -d. -f2)" -d postgres -t -A)
# The pooler wants the project ref in the username; take it from the URL instead
# of a second .env key that could drift out of step with the host.
REF="$(env_get EXPO_PUBLIC_SUPABASE_URL | sed -E 's#https://([^.]+)\..*#\1#')"
PSQL=(/opt/homebrew/bin/psql -h "$(env_get SUPABASE_DB_HOST)" -p 5432 -U "postgres.${REF}" -d postgres -t -A)
q() { "${PSQL[@]}" -c "$1" 2>/dev/null; }

CAP="${1:-$(q "select capture_id from capture_structured order by created_at desc limit 1;")}"
[ -n "$CAP" ] || { echo "no capture to test against"; exit 2; }

echo "triggering deploy…"
code=$(curl -s -o /tmp/render-deploy.json -w '%{http_code}' -X POST "$HOOK")
[ "$code" = "200" ] || { echo "  hook returned HTTP $code"; cat /tmp/render-deploy.json; exit 1; }
echo "  queued: $(sed -E 's/.*"id":"([^"]+)".*/\1/' /tmp/render-deploy.json)"

echo "waiting for the new process, then testing with $CAP …"
for attempt in $(seq 1 12); do
  sleep 45
  before=$(q "select count(*) from capture_structured where capture_id='$CAP';")
  q "update processing_job set state='queued', attempts=0, leased_until=null, blocked_reason='none',
       completed_steps=(select coalesce(jsonb_agg(s),'[]'::jsonb)
                          from jsonb_array_elements(completed_steps) s where s <> '\"structure\"'::jsonb)
     where capture_id='$CAP';" >/dev/null
  for _ in $(seq 1 20); do
    sleep 3
    now=$(q "select count(*) from capture_structured where capture_id='$CAP';")
    [ "$now" -gt "$before" ] && break
  done
  ms=$(q "select coalesce(structure_ms::text,'') from capture_structured
           where capture_id='$CAP' order by created_at desc limit 1;")
  if [ -n "$ms" ]; then
    echo "  LIVE — the running worker reports structure_ms=${ms}ms"
    q "select '  price on that proposal: '||coalesce(proposed_amount_cents::text,'none')
         from capture_structured where capture_id='$CAP' order by created_at desc limit 1;"
    exit 0
  fi
  echo "  attempt $attempt: still the old code (no structure_ms)"
done
echo "The deploy did not take effect. Check Render → ezjobsite-pipeline → Events." >&2
exit 1
