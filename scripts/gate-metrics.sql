-- G1, G2, G5 — the three gates the PRD's phasing rule names.
--
-- WHY THIS FILE EXISTS. The PRD says: "nothing from P1 starts until G1, G2, G5
-- are green with design partners." Nothing computed them. A gate nobody can
-- evaluate is not a gate, it is a wall: P1 could never start, not because the
-- loop was unreliable but because no one could say whether it was. This makes
-- the phasing rule executable instead of aspirational.
--
-- READ-ONLY. Wrapped in begin/rollback, safe against production.
--
-- IT REFUSES TO CALL A GATE GREEN ON THIN DATA, which is the whole point. With
-- four sent extras, "p75 = 41s" is noise wearing a number's clothes, and a green
-- light derived from it would start P1 on a false reading — the exact decision
-- the phasing rule exists to prevent. Below MIN_N each gate reports
-- INSUFFICIENT and says how many more it needs. Same rule as verify.mjs: a check
-- that measured nothing must never report a pass.
begin;

do $$
declare
  -- Deliberately low enough to be reachable in a real beta and high enough that
  -- a percentile means something. Stated here rather than buried in each query
  -- so it is one decision, visible, and arguable.
  MIN_N constant int := 20;

  n           int;
  n_ok        int;
  p75_seconds numeric;
  pct         numeric;
begin
  raise notice '';
  raise notice '=== PRD phasing gates (G1, G2, G5) ===';
  raise notice '';

  ---------------------------------------------------------------------------
  -- G1 — capture to send, p75 <= 60 seconds.
  --
  -- "Capture -> send" is the contractor's working session: from the FIRST
  -- capture behind the extra to the moment the link was sent. Earliest capture,
  -- not latest, because the clock the contractor feels starts when he pulls the
  -- phone out.
  --
  -- The join is change_order -> decision_version -> capture, which is the only
  -- server-side path from an extra back to the media behind it.
  ---------------------------------------------------------------------------
  with first_capture as (
    select co.id            as change_order_id,
           co.decision_id,
           min(c.client_created_at) as started_at
      from public.change_order co
      join public.decision_version dv on dv.decision_id = co.decision_id
      join public.capture c           on c.id = dv.capture_id
     group by co.id, co.decision_id
  ),
  sent as (
    select fc.change_order_id,
           fc.started_at,
           min(cr.created_at) as sent_at
      from first_capture fc
      join public.confirmation_request cr on cr.decision_id = fc.decision_id
     group by fc.change_order_id, fc.started_at
  )
  select count(*),
         percentile_cont(0.75) within group (
           order by extract(epoch from (sent_at - started_at)))
    into n, p75_seconds
    from sent
   where sent_at >= started_at;   -- a negative interval is clock skew, not speed

  if n < MIN_N then
    raise notice 'G1  speed          INSUFFICIENT  n=% (need %) — p75 needs a real sample',
                 n, MIN_N;
  else
    raise notice 'G1  speed          %  n=%  p75=%s (target <= 60s)',
                 case when p75_seconds <= 60 then 'GREEN' else 'RED  ' end,
                 n, round(p75_seconds, 1);
  end if;

  ---------------------------------------------------------------------------
  -- G2 — >= 70% of sent changes approved within 24 hours.
  --
  -- Only 'confirm' requests count. An 'acknowledge' has no approval to give, so
  -- including them would dilute the rate with items that can never be approved.
  --
  -- The 24h window is measured from send. A request sent less than 24h ago has
  -- not had its chance yet and is EXCLUDED, not counted as a failure — counting
  -- it would make the number drop every time someone sends an extra.
  ---------------------------------------------------------------------------
  select count(*),
         count(*) filter (
           where rsp.action = 'confirmed'
             and rsp.responded_at <= cr.created_at + interval '24 hours')
    into n, n_ok
    from public.confirmation_request cr
    left join public.confirmation_response rsp on rsp.token = cr.token
   where cr.kind = 'confirm'
     and cr.created_at <= now() - interval '24 hours';

  if n < MIN_N then
    raise notice 'G2  approval vel.  INSUFFICIENT  n=% (need %) — only requests older than 24h count',
                 n, MIN_N;
  else
    pct := 100.0 * n_ok / n;
    -- Built by concatenation, not by format: in raise notice '%%' is a literal
    -- percent and '%' is a placeholder, so '%%%' is unavoidably read as
    -- literal-then-value and prints "%70.0" instead of "70.0%".
    raise notice 'G2  approval vel.  %  n=%  approved in 24h = %  (target >= 70%%)',
                 case when pct >= 70 then 'GREEN' else 'RED  ' end,
                 n, round(pct, 1) || '%';
  end if;

  ---------------------------------------------------------------------------
  -- G5 — >= 90% of homeowners who OPEN the link approve or question.
  --
  -- The denominator is opens, not sends: G5 measures friction INSIDE the page,
  -- so someone who never opened it never met that friction. Requires 366
  -- (confirmation_open); without it there is no denominator at all and this
  -- says so rather than dividing by zero and reporting 100%.
  --
  -- "Complete an action" is approve, decline, OR ask a question. A decline is
  -- not drop-off — the homeowner engaged and said no, which is the loop working.
  ---------------------------------------------------------------------------
  if to_regclass('public.confirmation_open') is null then
    raise notice 'G5  no drop-off    UNMEASURABLE  — confirmation_open does not exist (apply 366)';
  else
    with opened as (
      select distinct token from public.confirmation_open
    ),
    acted as (
      select o.token,
             (exists (select 1 from public.confirmation_response r where r.token = o.token)
              or exists (select 1 from public.confirmation_question q where q.token = o.token)
             ) as did_act
        from opened o
    )
    select count(*), count(*) filter (where did_act) into n, n_ok from acted;

    if n < MIN_N then
      raise notice 'G5  no drop-off    INSUFFICIENT  n=% opened links (need %)', n, MIN_N;
    else
      pct := 100.0 * n_ok / n;
      raise notice 'G5  no drop-off    %  n=%  acted = %  (target >= 90%%)',
                   case when pct >= 90 then 'GREEN' else 'RED  ' end,
                   n, round(pct, 1) || '%';
    end if;
  end if;

  raise notice '';
  raise notice 'P1 (R9-R15) starts only when all three read GREEN.';
  raise notice 'PRD: "nothing from P1 starts until G1, G2, G5 are green with design partners."';
  raise notice '';
end $$;

rollback;
