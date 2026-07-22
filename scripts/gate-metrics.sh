#!/usr/bin/env bash
#
# Answer the PRD's phasing question: are G1, G2 and G5 green yet?
#
# Read-only (the SQL rolls back). Run it whenever you want to know whether P1 is
# allowed to start.
#
#   ./scripts/gate-metrics.sh
#
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Read ONLY the keys we need, and never `source` the file: .env holds values
# with characters that break shell parsing (line 16 does exactly that), and
# sourcing it executes whatever is in there. Values are exported, never echoed.
# tr, not sed: a sed class written as ["\x27] is the literal set " \ x 2 7 —
# sed does not read \x escapes — so it stripped the trailing 2 from port 5432
# and every connection went to port 543. Quotes are removed by name instead.
# tr, not sed: a sed class written as ["\x27] is the literal set " \ x 2 7 —
# sed does not read \x escapes — so it stripped the trailing 2 from port 5432
# and every connection went to port 543.
envget() { /usr/bin/grep -m1 "^$1=" "$ROOT/.env" | cut -d= -f2- | tr -d "\"\r" | tr -d "'"; }
SUPABASE_DB_HOST=$(envget SUPABASE_DB_HOST)
SUPABASE_DB_PORT=$(envget SUPABASE_DB_PORT)
SUPABASE_DB_NAME=$(envget SUPABASE_DB_NAME)
SUPABASE_DB_USER=$(envget SUPABASE_DB_USER)
SUPABASE_DB_PASSWORD=$(envget SUPABASE_DB_PASSWORD)
# SUPABASE'S POOLER NEEDS THE PROJECT REF IN THE USERNAME. Connecting as a bare
# `postgres` fails with "(ENOIDENTIFIER) no tenant identifier provided" — the
# pooler multiplexes every project on one host and the username is how it knows
# which one. The ref is the subdomain of the public API URL, so it is derived
# rather than stored twice and cannot drift from it.
case "$SUPABASE_DB_USER" in
  *.*) ;;   # already qualified
  *) _REF=$(envget EXPO_PUBLIC_SUPABASE_URL | sed 's|https://||; s|\.supabase\.co.*||')
     [ -n "$_REF" ] && SUPABASE_DB_USER="${SUPABASE_DB_USER}.${_REF}" ;;
esac
export PGPASSWORD="$SUPABASE_DB_PASSWORD"

psql -h "$SUPABASE_DB_HOST" -p "${SUPABASE_DB_PORT:-5432}" \
     -U "$SUPABASE_DB_USER" -d "${SUPABASE_DB_NAME:-postgres}" \
     -v ON_ERROR_STOP=1 --no-psqlrc -q -f "$ROOT/scripts/gate-metrics.sql"
