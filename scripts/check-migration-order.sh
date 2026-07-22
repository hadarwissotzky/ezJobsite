#!/usr/bin/env bash
# Apply every UNAPPLIED migration in numeric order, in ONE transaction, then roll back.
#
# WHY THIS IS SEPARATE FROM `npm run verify`: it needs live database credentials, and
# verify must work offline. So this is a deliberate step you run BEFORE a migration
# run, not something that happens on every save.
#
# WHY IT EXISTS AT ALL: eleven pending migrations each applied cleanly ALONE. Applied
# in numeric order together, 305 died with
#     ERROR: column prior.superseded_by does not exist
# because 307 creates that column -- and ON_ERROR_STOP took every later migration down
# with it. Each file had been reviewed. The ORDER was the bug, and order is invisible
# until you run them in it. A half-migrated production database is the worst outcome a
# green build can have.
#
# ON_ERROR_STOP=1 is the whole point: without it psql keeps going after a failure and
# reports success at the end, which is precisely the lie this guards against.
set -euo pipefail
cd "$(dirname "$0")/.."

PENDING="${*:-}"
if [ -z "$PENDING" ]; then
  echo "usage: $0 <migration-basename> [...]   (e.g. 260_approval_visibility 270_ask_live_only)"
  echo "Pass the ones NOT yet applied. Ask the database which those are rather than guessing."
  exit 2
fi

TMP="$(mktemp)"
{
  echo "begin;"
  for m in $PENDING; do
    f="apps/mobile/sql/${m}.sql"
    [ -f "$f" ] || { echo "no such migration: $f" >&2; exit 2; }
    echo "\\echo '>>> ${m}'"
    cat "$f"
  done
  echo "select 'ALL ${#} APPLIED CLEANLY IN SEQUENCE' as result;"
  echo "rollback;"
} > "$TMP"

./spike/bin/pg.sh -X -v ON_ERROR_STOP=1 -q -f "$TMP"
rm -f "$TMP"
