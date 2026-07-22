#!/usr/bin/env bash
#
# Apply ONE migration to the database named in .env, and show what changed.
#
# WHY THIS EXISTS: applying production DDL is the one step in this repo that is
# deliberately not automated. It is irreversible in parts, and CLAUDE.md's second
# mandate is confirm-don't-automate. So this asks, it names the target out loud
# before it asks, and it does exactly one file per run.
#
# It also runs the file inside a single transaction with ON_ERROR_STOP. A
# migration that fails halfway is the worst outcome available here: the schema
# ends up in a state no file describes. All-or-nothing is the only safe shape.
#
#   ./scripts/apply-migration.sh apps/mobile/sql/260_approval_visibility.sql
#
set -euo pipefail

F="${1:-}"
[ -n "$F" ] || { echo "usage: $0 <path-to-migration.sql>"; exit 2; }
[ -f "$F" ] || { echo "no such file: $F"; exit 2; }

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
: "${SUPABASE_DB_HOST:?.env is missing SUPABASE_DB_HOST}"

export PGPASSWORD="$SUPABASE_DB_PASSWORD"
PSQL=(psql -h "$SUPABASE_DB_HOST" -p "${SUPABASE_DB_PORT:-5432}"
      -U "$SUPABASE_DB_USER" -d "${SUPABASE_DB_NAME:-postgres}"
      -v ON_ERROR_STOP=1 --no-psqlrc)

echo
echo "  file:   $F"
echo "  host:   $SUPABASE_DB_HOST"
echo "  db:     ${SUPABASE_DB_NAME:-postgres}"
echo
# The target is printed BEFORE the prompt on purpose. "Are you sure?" with the
# destination somewhere further up the scrollback is not a confirmation.
read -r -p "Apply this migration to the database above? [type: apply] " ans
[ "$ans" = "apply" ] || { echo "aborted, nothing sent"; exit 1; }

echo
"${PSQL[@]}" -1 -f "$F"
echo
echo "applied: $(basename "$F")"
