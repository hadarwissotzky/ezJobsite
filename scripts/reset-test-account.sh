#!/usr/bin/env bash
# HARD-DELETE the test account hadar@foundersled.studio and everything it owns,
# so registration can be tested from zero (hadar, 2026-09-08).
#
# NOT the mandate-#5 erasure path (code review 2026-09-08 finding 5): lawful
# erasure retains a hash + metadata stub; this retains nothing. It is a TEST
# RESET for an account the operator owns, full stop.
#
# Shape (rebuilt after code review 2026-09-08, findings 1-7):
#   1. Collect the account's entity ids FIRST - companies, projects, change
#      orders, captures, decisions, confirmation tokens, replies - as SQL sets,
#      not LIMIT 1 scalars.
#   2. Delete storage objects via the API, checking every HTTP status.
#   3. One transaction deletes from every base table by EIGHT keys (owner/user/
#      author + the entity sets), covering the token-keyed tables
#      (approval_photo, confirmation_response, signing_otp), decision_version,
#      and reply media that the first version orphaned.
#   4. Delete the auth user, checking the status.
#   5. Verify counts INCLUDING the token-keyed tables, and EXIT 1 on any
#      nonzero - "DONE" is only printed when it is true.
# translation_cache is left alone deliberately: keyed by content hash, it is a
# derived cache with no ownership column, rebuilt on demand.
set -euo pipefail
cd "$(dirname "$0")/.."
envget() { grep -E "^$1=" .env | head -1 | cut -d= -f2- || true; }
export PGPASSWORD=$(envget SUPABASE_DB_PASSWORD)
PROJECT_REF=wwhfgsijnlpajvdiopfd
H=$(envget SUPABASE_DB_HOST); P=$(envget SUPABASE_DB_PORT)
U="$(envget SUPABASE_DB_USER).$PROJECT_REF"
SRK=$(envget SUPABASE_SERVICE_ROLE_KEY)
API="https://$PROJECT_REF.supabase.co"
# ONE ref drives both halves (finding 7): the psql tenant suffix and the API
# host cannot point at different projects.
case "$H" in *supabase.com*) ;; *) echo "SUPABASE_DB_HOST does not look like supabase - refusing"; exit 1;; esac

EMAIL='hadar@foundersled.studio'
PSQL=(psql -h "$H" -p "$P" -U "$U" -d postgres -v ON_ERROR_STOP=1)
TUID=$("${PSQL[@]}" -tA -c "SELECT id FROM auth.users WHERE email='$EMAIL';")
[ -n "$TUID" ] || { echo "no auth user for $EMAIL - nothing to reset"; exit 0; }
echo "user=$TUID"

echo "-- storage blobs (status-checked; 200 = gone)"
"${PSQL[@]}" -tA -c "SELECT bucket_id || '/' || name FROM storage.objects WHERE owner='$TUID' OR (storage.foldername(name))[1]='$TUID';" \
| while IFS= read -r objpath; do
    [ -n "$objpath" ] || continue
    code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$API/storage/v1/object/$objpath" \
      -H "Authorization: Bearer $SRK" -H "apikey: $SRK")
    [ "$code" = "200" ] || { echo "storage delete FAILED ($code) for $objpath"; exit 1; }
    echo "  deleted $objpath"
  done

echo "-- app rows (append-only triggers bypassed for this session only)"
"${PSQL[@]}" <<SQL
SET session_replication_role = replica;
BEGIN;
-- The entity sets, gathered BEFORE anything is deleted (finding 3: no LIMIT 1).
CREATE TEMP TABLE _cmp ON COMMIT DROP AS
  SELECT id FROM company WHERE owner_id='$TUID'
  UNION SELECT company_id FROM company_member WHERE user_id='$TUID';
CREATE TEMP TABLE _prj ON COMMIT DROP AS
  SELECT id FROM project WHERE company_id IN (SELECT id FROM _cmp) OR owner_id='$TUID';
CREATE TEMP TABLE _co ON COMMIT DROP AS
  SELECT id FROM change_order WHERE owner_id='$TUID' OR project_id IN (SELECT id FROM _prj);
CREATE TEMP TABLE _cap ON COMMIT DROP AS
  SELECT id FROM capture WHERE owner_id='$TUID' OR project_id IN (SELECT id FROM _prj);
CREATE TEMP TABLE _dec ON COMMIT DROP AS
  SELECT id FROM decision WHERE owner_id='$TUID' OR project_id IN (SELECT id FROM _prj);
CREATE TEMP TABLE _tok ON COMMIT DROP AS
  SELECT token FROM confirmation_request WHERE owner_id='$TUID'
    OR project_id IN (SELECT id FROM _prj);
CREATE TEMP TABLE _rep ON COMMIT DROP AS
  SELECT id FROM confirmation_reply WHERE author_id='$TUID'
    OR token IN (SELECT token FROM _tok);
DO \$\$
DECLARE r record; pair record;
BEGIN
  -- ONE loop over (key column, id set) pairs (finding 6), base tables only.
  FOR pair IN SELECT * FROM (VALUES
      ('owner_id',        'SELECT ''$TUID'''),
      ('user_id',         'SELECT ''$TUID'''),
      ('author_id',       'SELECT ''$TUID'''),
      ('company_id',      'SELECT id FROM _cmp'),
      ('project_id',      'SELECT id FROM _prj'),
      ('change_order_id', 'SELECT id FROM _co'),
      ('capture_id',      'SELECT id FROM _cap'),
      ('decision_id',     'SELECT id FROM _dec'),
      ('token',           'SELECT token FROM _tok'),
      ('reply_id',        'SELECT id FROM _rep')
    ) AS v(col, src)
  LOOP
    FOR r IN SELECT DISTINCT c.table_name FROM information_schema.columns c
             JOIN information_schema.tables t ON t.table_name=c.table_name
               AND t.table_schema='public' AND t.table_type='BASE TABLE'
             WHERE c.table_schema='public' AND c.column_name=pair.col
    LOOP
      -- Cast the column to text: owner_id/id columns are uuid on some tables
      -- and text on others, and the id sets are text — %I::text IN (...) matches
      -- both without a per-table type dance.
      EXECUTE format('DELETE FROM public.%I WHERE %I::text IN (%s)',
                     r.table_name, pair.col, pair.src);
    END LOOP;
  END LOOP;
  EXECUTE format('DELETE FROM public.project WHERE id IN (SELECT id FROM _prj)');
  EXECUTE format('DELETE FROM public.company WHERE id IN (SELECT id FROM _cmp)');
END \$\$;
COMMIT;
SQL

echo "-- the auth user (status-checked)"
code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$API/auth/v1/admin/users/$TUID" \
  -H "Authorization: Bearer $SRK" -H "apikey: $SRK")
[ "$code" = "200" ] || { echo "auth user delete FAILED ($code)"; exit 1; }
echo "  auth user deleted"

echo "-- verify (nonzero = this script FAILS, finding 4)"
LEFT=$("${PSQL[@]}" -tA <<SQL
SELECT (SELECT count(*) FROM auth.users WHERE email='$EMAIL')
     + (SELECT count(*) FROM company WHERE owner_id='$TUID')
     + (SELECT count(*) FROM capture WHERE owner_id='$TUID')
     + (SELECT count(*) FROM change_order WHERE owner_id='$TUID')
     + (SELECT count(*) FROM confirmation_request WHERE owner_id='$TUID')
     + (SELECT count(*) FROM approval_photo ap WHERE NOT EXISTS
          (SELECT 1 FROM confirmation_request cr WHERE cr.token=ap.token))
     + (SELECT count(*) FROM confirmation_response x WHERE NOT EXISTS
          (SELECT 1 FROM confirmation_request cr WHERE cr.token=x.token))
     + (SELECT count(*) FROM signing_otp x WHERE NOT EXISTS
          (SELECT 1 FROM confirmation_request cr WHERE cr.token=x.token))
     + (SELECT count(*) FROM storage.objects WHERE owner='$TUID' OR (storage.foldername(name))[1]='$TUID');
SQL
)
if [ "$LEFT" != "0" ]; then
  echo "RESET INCOMPLETE - $LEFT rows survived (see queries above)"; exit 1
fi
echo "DONE - account and all content deleted. Register fresh at app.ezchangeorders.com or in the app."
