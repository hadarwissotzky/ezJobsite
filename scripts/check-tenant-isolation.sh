#!/usr/bin/env bash
#
# Does one authenticated user see another user's signature? Read-only.
#
# Everything happens inside `begin; ... rollback;`, so this can be run against
# production before and after 260 without leaving a row behind.
#
# It proves the FIX, not the DEPLOY. "The migration ran" and "the leak is closed"
# are different claims, and only the second one matters. So this impersonates a
# real user with set_config('request.jwt.claims') -- which is what makes
# auth.uid() resolve inside psql -- and then tries the read that must fail.
#
#   ./scripts/check-tenant-isolation.sh
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
     -v ON_ERROR_STOP=1 --no-psqlrc -q <<'SQL'
begin;
do $$
declare
  policy_src text;
  leaks      boolean;
  victim     uuid;
  intruder   uuid;
  n          int;
begin
  -- 1. What does the policy actually say right now?
  select pg_get_expr(pol.polqual, pol.polrelid)
    into policy_src
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
   where c.relname = 'approval' and pol.polname = 'appr_read';

  if policy_src is null then
    raise notice 'INCONCLUSIVE: no appr_read policy on public.approval.';
    raise notice '              Either 260 has not been applied or the policy was renamed.';
    return;
  end if;
  raise notice 'policy appr_read USING: %', policy_src;

  if policy_src = 'true' then
    raise notice 'LEAK OPEN: the policy is literally `true`. Every authenticated';
    raise notice '           user can read every signature. Apply 260.';
    return;
  end if;

  -- 2. Prove it with a real read, not by reading the policy text. Pick two
  --    users who own different approvals; if there are not two, say so rather
  --    than passing on an empty set -- a check that verified nothing is not a
  --    pass.
  -- `approval` HAS NO owner_id. Ownership is reached through the project (or the
  -- change order), which is exactly what the new policy tests — so the check has
  -- to walk the same path the policy does, or it is not testing the policy.
  select p.owner_id into victim
    from public.approval a
    join public.project p on p.id = a.project_id
   limit 1;

  select p.id into intruder
    from auth.users p
   where p.id is distinct from victim
   limit 1;

  if victim is null or intruder is null then
    raise notice 'INCONCLUSIVE: need two distinct users with at least one approval';
    raise notice '              between them. Found victim=% intruder=%', victim, intruder;
    return;
  end if;

  -- Become the intruder. This is what makes auth.uid() resolve.
  perform set_config('request.jwt.claims',
                     json_build_object('sub', intruder::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into n
    from public.approval a
    join public.project p on p.id = a.project_id
   where p.owner_id = victim;

  leaks := n > 0;
  if leaks then
    raise notice 'LEAK OPEN: user % read % of user %''s approval row(s).',
                 intruder, n, victim;
  else
    raise notice 'ISOLATED: user % reads 0 of user %''s approval rows.',
                 intruder, victim;
  end if;
end $$;
rollback;
SQL
