-- Seed with KNOWN answers so gate-metrics.sql can be CHECKED, not just run.
--
-- NEVER run this against production: it truncates. It is for a throwaway
-- Postgres, which is how gate-metrics.sql was verified:
--
--   initdb -D /tmp/gpg1 -U postgres --auth=trust
--   pg_ctl -D /tmp/gpg1 -o "-p 55433 -k /tmp" start
--   # create schema auth, roles anon/authenticated/service_role, auth.uid()
--   # apply spike/sql/*.sql then apps/mobile/sql/*.sql in numeric order
--   psql ... -v scen=green -v rows=20 -f scripts/fixtures/seed-gate-metrics.sql
--   psql ... -f scripts/gate-metrics.sql
--
-- The numbers are chosen so every verdict is predictable by hand and every
-- threshold is exercised from BOTH sides. A query that has only ever returned
-- GREEN has not been tested, it has been watched.
--
--   scen=green -> G1 p75=30.0s (<=60 PASS)  G2 70.0% (>=70 PASS)  G5 90.0% (>=90 PASS)
--   scen=red   -> G1 p75=90.0s (>60  FAIL)  G2 65.0% (<70  FAIL)  G5 85.0% (<90  FAIL)
--
-- G2 and G5 land EXACTLY on their thresholds in the green case deliberately: an
-- off-by-one in `>=` would show up there and nowhere else.
--
-- rows=19 vs rows=20 exercises the MIN_N guard — 19 must report INSUFFICIENT on
-- all three, 20 must report verdicts.
--
--   -v scen=green|red   -v rows=<n>
--
-- Three real schema rules bit while writing this, and each one is the schema
-- working: 240 rejected a fake shown_sha256, 210 rejected an answer with no
-- typed signature, and 366's trigger refused to let the fixture DELETE an open.
-- The seed computes a real hash and signs; it truncates rather than deletes.
\set ON_ERROR_STOP on

truncate table confirmation_open, confirmation_question, confirmation_response,
               confirmation_request, change_order, decision_version, decision, capture cascade;

insert into auth.users(id) values ('11111111-1111-1111-1111-111111111111') on conflict do nothing;
insert into project(id, owner_id, name)
  values ('p1','11111111-1111-1111-1111-111111111111','Gate test')
  on conflict (id) do nothing;

-- G1: 20 extras. GREEN => every capture->send gap is 30s (p75=30, <=60).
--                RED   => every gap is 90s (p75=90, >60).
-- G2: 20 requests all older than 24h. GREEN => 14 confirmed inside 24h (70.0%).
--                                     RED   => 13 confirmed (65.0%).
-- G5: 20 opened tokens. GREEN => 18 acted (90.0%). RED => 17 acted (85.0%).
set gate.scen = :'scen';
set gate.rows = :'rows';

do $$
declare
  scen        text := current_setting('gate.scen');
  gap_seconds int := case when scen = 'green' then 30 else 90 end;
  n_confirmed int := case when scen = 'green' then 14 else 13 end;
  n_acted     int := case when scen = 'green' then 18 else 17 end;
  i           int;
  cap_at      timestamptz;
  send_at     timestamptz;
begin
  for i in 1..current_setting('gate.rows')::int loop
    -- Sent 3 days ago so every request is comfortably past the 24h window.
    send_at := now() - interval '3 days';
    cap_at  := send_at - make_interval(secs => gap_seconds);

    insert into capture(id, owner_id, project_id, payload, payload_sha256, client_created_at)
      values ('c'||i, '11111111-1111-1111-1111-111111111111', 'p1', 'k', 'h', cap_at);

    insert into decision(id, project_id, owner_id, subject, created_at_ms)
      values ('d'||i, 'p1', '11111111-1111-1111-1111-111111111111', 's', 0);

    insert into decision_version(id, decision_id, value, capture_id, created_at_ms)
      values ('dv'||i, 'd'||i, 'v', 'c'||i, 0);

    insert into change_order(id, decision_id, project_id, owner_id, scope, amount_cents,
                             who_directed, numbers_confirmed_at)
      values ('co'||i, 'd'||i, 'p1', '11111111-1111-1111-1111-111111111111',
              'scope '||i, 1000, 'owner', now());

    insert into confirmation_request(token, decision_id, project_id, owner_id, kind,
                                     shown_content, shown_sha256, counterparty_label,
                                     channel, created_at)
      values ('t'||i, 'd'||i, 'p1', '11111111-1111-1111-1111-111111111111', 'confirm',
              'content '||i,
              encode(sha256(convert_to('content '||i, 'utf8')), 'hex'),
              'Owner', 'link', send_at);

    -- G2 numerator: confirmed 1 hour after send (inside the 24h window).
    if i <= n_confirmed then
      insert into confirmation_response(token, action, responded_at, signed_name)
        values ('t'||i, 'confirmed', send_at + interval '1 hour', 'Test Client');
    end if;

    -- G5 denominator: every token was opened.
    insert into confirmation_open(token, opened_at) values ('t'||i, send_at + interval '5 min');

    -- G5 numerator: acted = responded OR asked. Rows past n_confirmed that still
    -- need to count as "acted" get a QUESTION instead, which exercises the other
    -- branch of the OR rather than leaving it untested.
    if i > n_confirmed and i <= n_acted then
      insert into confirmation_question(token, note) values ('t'||i, 'a question');
    end if;
  end loop;
end $$;
