#!/usr/bin/env bash
# Bakeoff psql helper. SESSION MODE (:5432) ONLY — transaction mode (:6543)
# multiplexes connections and would silently break Q1's session advisory locks
# and pg_stat_activity assertions (predeclaration §5).
set -euo pipefail
ENV_FILE="${ENV_FILE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/.env}"
getval() { awk -F= -v k="$1" '$1==k {v=$0; sub(/^[^=]*=/,"",v); gsub(/^["\x27]|["\x27]$/,"",v); print v; exit}' "$ENV_FILE"; }
DBH="$(getval SUPABASE_DB_HOST)"
DBPW="$(getval SUPABASE_DB_PASSWORD)"
REF="$(getval EXPO_PUBLIC_SUPABASE_URL | sed -E 's#https://([a-z0-9]+)\.supabase\.co#\1#')"
export PGPASSWORD="$DBPW"
export PGCONNECT_TIMEOUT=10
exec psql "host=$DBH port=5432 user=postgres.$REF dbname=postgres sslmode=require" "$@"
