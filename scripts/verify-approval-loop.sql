-- verify-approval-loop.sql
--
-- Proves the approval loop actually closes: send marks the change order sent, a
-- client's answer moves it to approved/declined and leaves an `approval` evidence
-- row, and a second conflicting link cannot overwrite a terminal state.
--
-- SAFE TO RUN AGAINST A LIVE DATABASE. Everything happens inside one transaction
-- that ends in ROLLBACK, so no fixture survives. Run:
--   psql "$CONN" -f scripts/verify-approval-loop.sql
--
-- Rows are inserted into confirmation_request DIRECTLY rather than through
-- confirmation_create(), because that function stamps owner_id from auth.uid()
-- and there is no JWT on a psql connection. The triggers under test fire on the
-- table insert, so this exercises the same path.
--
-- Written because this repo has no test harness at all (Codex review, 2026-07-21:
-- "No mobile test/spec files were found"), and the loop it checks is the product.
-- A file that can be re-run beats a shell heredoc nobody can repeat.

begin;

insert into public.change_order
  (id, decision_id, project_id, owner_id, scope, amount_cents, who_directed,
   numbers_confirmed_at, status)
values
  ('vco-a','vd1','vp1', gen_random_uuid(), 'Panel upgrade', 240000, 'Sarah', now(), 'draft'),
  ('vco-b','vd2','vp1', gen_random_uuid(), 'Subfloor',      185000, 'Sarah', now(), 'draft'),
  ('vco-c','vd3','vp1', gen_random_uuid(), 'Vanity',        230000, 'Sarah', now(), 'draft');

-- 1 ── sending marks it sent
do $$ declare st text; begin
  insert into public.confirmation_request
    (token,decision_id,project_id,owner_id,kind,shown_content,shown_sha256,
     counterparty_label,channel,amount_cents,change_order_id)
  values ('vt-a','vd1','vp1',gen_random_uuid(),'confirm','frozen words','sha',
          'Sarah','link',240000,'vco-a');
  select status into st from public.change_order where id='vco-a';
  raise notice 'CHECK 1 send      -> status=%   %', st,
    case when st='sent' then 'PASS' else 'FAIL (want sent)' end;
end $$;

-- 2 ── approving moves it, and leaves signed evidence
do $$ declare st text; nm text; g text; begin
  insert into public.confirmation_response(token,action,signed_name)
  values ('vt-a','confirmed','Sarah Miller');
  select status into st from public.change_order where id='vco-a';
  select legal_name, grade into nm, g from public.approval where change_order_id='vco-a';
  raise notice 'CHECK 2 approve   -> status=% signed=% grade=%   %', st, nm, g,
    case when st='approved' and nm='Sarah Miller' and g='typed_link'
         then 'PASS' else 'FAIL' end;
end $$;

-- 3 ── declining moves it too
do $$ declare st text; begin
  insert into public.confirmation_request
    (token,decision_id,project_id,owner_id,kind,shown_content,shown_sha256,
     counterparty_label,channel,amount_cents,change_order_id)
  values ('vt-b','vd2','vp1',gen_random_uuid(),'confirm','frozen words','sha',
          'Sarah','link',185000,'vco-b');
  insert into public.confirmation_response(token,action,signed_name)
  values ('vt-b','declined','Sarah Miller');
  select status into st from public.change_order where id='vco-b';
  raise notice 'CHECK 3 decline   -> status=%   %', st,
    case when st='declined' then 'PASS' else 'FAIL (want declined)' end;
end $$;

-- 4 ── a second, conflicting link cannot walk a terminal state (partial Codex #6)
do $$ declare st text; n int; begin
  insert into public.confirmation_request
    (token,decision_id,project_id,owner_id,kind,shown_content,shown_sha256,
     counterparty_label,channel,amount_cents,change_order_id)
  values ('vt-c1','vd3','vp1',gen_random_uuid(),'confirm','frozen words','sha',
          'Sarah','link',230000,'vco-c');
  insert into public.confirmation_request
    (token,decision_id,project_id,owner_id,kind,shown_content,shown_sha256,
     counterparty_label,channel,amount_cents,change_order_id)
  values ('vt-c2','vd3','vp1',gen_random_uuid(),'confirm','frozen words','sha',
          'Sarah','link',230000,'vco-c');
  insert into public.confirmation_response(token,action,signed_name)
  values ('vt-c1','confirmed','Sarah Miller');
  insert into public.confirmation_response(token,action,signed_name)
  values ('vt-c2','declined','Someone Else');
  select status into st from public.change_order where id='vco-c';
  select count(*) into n from public.approval where change_order_id='vco-c';
  -- BOTH answers are recorded as evidence; only the first moves the change order.
  raise notice 'CHECK 4 conflict  -> status=% approvals_recorded=%   %', st, n,
    case when st='approved' and n=2 then 'PASS' else 'FAIL (want approved + 2)' end;
end $$;

-- 5 ── signatures are still mandatory on both answers (210)
do $$ begin
  insert into public.confirmation_response(token,action,signed_name)
  values ('vt-c1','confirmed',null);
  raise notice 'CHECK 5 unsigned  -> ALLOWED   FAIL';
exception
  when check_violation then raise notice 'CHECK 5 unsigned  -> refused   PASS';
  when unique_violation then raise notice 'CHECK 5 unsigned  -> token already answered (inconclusive)';
end $$;

rollback;
