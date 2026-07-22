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
set -a; . "$ROOT/.env"; set +a
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
  select a.owner_id into victim
    from public.approval a
   where a.owner_id is not null
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
   where a.owner_id = victim;

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
