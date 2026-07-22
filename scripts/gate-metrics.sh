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
set -a; . "$ROOT/.env"; set +a
export PGPASSWORD="$SUPABASE_DB_PASSWORD"

psql -h "$SUPABASE_DB_HOST" -p "${SUPABASE_DB_PORT:-5432}" \
     -U "$SUPABASE_DB_USER" -d "${SUPABASE_DB_NAME:-postgres}" \
     -v ON_ERROR_STOP=1 --no-psqlrc -q -f "$ROOT/scripts/gate-metrics.sql"
