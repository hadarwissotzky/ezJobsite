#!/bin/bash
# DEV-ONLY full data reset — wipes all jobs/captures/extras test data so you can
# start again. Written 2026-07-20 at hadar's request.
#
# WHAT IT DELETES:  every row in every table in the `public` schema (captures,
#   projects, decisions, change orders, transcripts, queue, …) + all media objects
#   in the storage bucket + the app on the connected iPhone (its local database
#   can only be cleared by uninstalling — it is append-only by design).
# WHAT IT KEEPS:    your login account + profile (auth schema untouched).
#
# TRUNCATE bypasses the append-only row triggers legitimately (no trigger disabling).
set -euo pipefail
cd "$(dirname "$0")/.."

H=$(grep '^SUPABASE_DB_HOST=' .env | cut -d= -f2- | tr -d '"')
P=$(grep '^SUPABASE_DB_PORT=' .env | cut -d= -f2- | tr -d '"')
B=$(grep '^SUPABASE_STORAGE_BUCKET=' .env | cut -d= -f2- | tr -d '"')
export PGPASSWORD=$(grep '^SUPABASE_DB_PASSWORD=' .env | cut -d= -f2- | tr -d '"')
CONN="host=$H port=$P dbname=postgres user=postgres.wwhfgsijnlpajvdiopfd sslmode=require"

echo "── wiping cloud app data (public schema) ──"
psql "$CONN" -tA -c "DO \$\$ DECLARE r record; BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
    EXECUTE format('TRUNCATE TABLE public.%I CASCADE', r.tablename);
  END LOOP; END \$\$; SELECT 'public schema truncated ✓';"

echo "── clearing storage bucket (${B:-captures}) ──"
psql "$CONN" -tA -c "DELETE FROM storage.objects WHERE bucket_id='${B:-captures}'; SELECT 'storage cleared ✓';"

echo "── verify ──"
psql "$CONN" -tA -c "SELECT 'captures='||(SELECT count(*) FROM public.capture)
  ||' projects='||(SELECT count(*) FROM public.project)
  ||' change_orders='||(SELECT count(*) FROM public.change_order)
  ||' | accounts kept='||(SELECT count(*) FROM auth.users);"

echo "── removing app from iPhone (clears its local append-only DB) ──"
xcrun devicectl device uninstall app --device 00008110-001805E401D3801E com.hilo.ezjobsite \
  && echo "app removed ✓" || echo "app not installed / device locked — unlock and rerun if needed"

echo ""
echo "DONE. Tell Claude to reinstall — then sign in again:"
echo "  email:    hadarwissotzky@me.com"
echo "  password: the WORKER_PASSWORD line in .env"
