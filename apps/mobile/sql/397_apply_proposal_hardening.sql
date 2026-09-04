-- NOTE (2026-09-03): the LATEST definition of apply_proposal_v1 lives in
-- 442_native_scope.sql, which is this body plus the native-scope columns. Edit there.
-- 397 — hardening apply_proposal_v1 after an independent review (Codex, 2026-08-07).
--
-- Four real defects in 394/396, in severity order:
--
-- 1. A HUMAN'S SCOPE COULD BE DESTROYED. The guard allowed replacement whenever
--    scope_of_work was blank, equal to the title, or the placeholder — REGARDLESS of
--    scope_of_work_ai. A contractor who typed a scope that happened to match his own
--    title had it silently overwritten by the model. The stated rule was always "only
--    equality with scope_of_work_ai proves AI authorship"; the SQL did not say that.
--    Now: before the AI has ever written (ai IS NULL) the birth states are seedable;
--    after it has, ONLY its own text may be replaced.
--
-- 2. SECURITY DEFINER WAS UNDER-HARDENED. `search_path = public` does not pin pg_temp,
--    so a caller with EXECUTE could shadow the unqualified tables with temporary
--    relations — the standard definer-hijack path. And 396 replaced the function
--    without repeating 394's REVOKE, so a from-scratch create would have granted
--    EXECUTE to PUBLIC.
--
-- 3. SELECTION WAS NONDETERMINISTIC. `decision_version ... LIMIT 1` had no ORDER BY,
--    and ties on created_at picked arbitrarily. On a function that writes a binding
--    document, "arbitrary" is not acceptable even when the rows are usually identical.
--
-- 4. TERM GAPS. The WHERE omitted schedule_days, so a missing day count alone was
--    never filled; and price_heard was rewritten on every pass, overwriting a quote a
--    human may have corrected.
CREATE OR REPLACE FUNCTION public.apply_proposal_v1(p_capture_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_decision text;
  v_co       text;
  v_prop     record;
  v_words    text;
  v_hit      boolean := false;
BEGIN
  SELECT dv.decision_id INTO v_decision
    FROM decision_version dv
   WHERE dv.capture_id = p_capture_id
   ORDER BY dv.created_at_ms, dv.id LIMIT 1;
  IF v_decision IS NULL THEN RETURN false; END IF;

  SELECT co.id INTO v_co
    FROM change_order co
   WHERE co.decision_id = v_decision AND co.status = 'draft'
   ORDER BY co.created_at DESC, co.id LIMIT 1;
  IF v_co IS NULL THEN RETURN false; END IF;

  SELECT cs.* INTO v_prop
    FROM capture_structured cs
    JOIN decision_version dv ON dv.capture_id = cs.capture_id
   WHERE dv.decision_id = v_decision AND cs.confidence = 'high'
   ORDER BY cs.created_at DESC, cs.id DESC LIMIT 1;
  IF v_prop IS NULL THEN RETURN false; END IF;

  -- THE SCOPE. Seedable only from a birth state while the AI has written nothing;
  -- afterwards only the AI's own last text may be replaced.
  IF v_prop.proposed_value IS NOT NULL AND btrim(v_prop.proposed_value) <> '' THEN
    UPDATE change_order
       SET scope_of_work = v_prop.proposed_value,
           scope_of_work_ai = v_prop.proposed_value
     WHERE id = v_co AND status = 'draft'
       AND ( (scope_of_work_ai IS NULL
              AND (scope_of_work IS NULL OR btrim(scope_of_work) = ''
                   OR scope_of_work = scope OR scope_of_work = untitled_scope()))
          OR (scope_of_work_ai IS NOT NULL AND scope_of_work = scope_of_work_ai) );
    IF FOUND THEN v_hit := true; END IF;
  END IF;

  IF v_prop.proposed_subject IS NOT NULL AND btrim(v_prop.proposed_subject) <> '' THEN
    UPDATE change_order SET scope = v_prop.proposed_subject
     WHERE id = v_co AND status = 'draft' AND scope = untitled_scope();
    IF FOUND THEN v_hit := true; END IF;
  END IF;

  -- THE TERMS. schedule_days is now in the WHERE (a missing day count alone used to be
  -- unfillable), and it is taken only when the SURVIVING effect is 'adds_days' — a day
  -- count under a human's 'no_change' would contradict the answer he gave.
  UPDATE change_order
     SET schedule_effect = COALESCE(schedule_effect, v_prop.proposed_schedule_effect),
         schedule_days   = COALESCE(schedule_days,
                             CASE WHEN COALESCE(schedule_effect,
                                                v_prop.proposed_schedule_effect) = 'adds_days'
                                  THEN v_prop.proposed_schedule_days END),
         billing_timing  = COALESCE(billing_timing, v_prop.proposed_billing_timing),
         exclusions      = COALESCE(exclusions, v_prop.proposed_exclusions),
         extra_type      = COALESCE(extra_type, v_prop.proposed_extra_type)
   WHERE id = v_co AND status = 'draft'
     AND (schedule_effect IS NULL OR schedule_days IS NULL OR billing_timing IS NULL
          OR exclusions IS NULL OR extra_type IS NULL);
  IF FOUND THEN v_hit := true; END IF;

  /*
   * THE PRICE, ONTO THE SERVER'S OWN ROW [2026-08-25].
   *
   * Until now no path existed. The change order is created on the phone at capture
   * time with no price and syncs immediately; `ingest_change_order_v1` is insert-once
   * by design; and the figure was worked out on the device seconds later, by which
   * point there was no queued payload left to amend. Result, verified against
   * production: eight change orders, none of them carrying a price. Every figure lived
   * on exactly one device, and a reinstall or a second phone lost all of them.
   *
   * This is the same door the scope of work already comes through, and it is guarded
   * the same way -- `status = 'draft'` and only when there is no figure yet:
   *   - a SENT or SIGNED extra is never touched, so nothing frozen can move;
   *   - `amount_cents IS NULL` means the app never argues with a number a human typed.
   *     The device's own auto-fill carries `onlyIfUnpriced` for the same reason, so
   *     whichever arrives second does nothing.
   *
   * The figure itself is NOT the model's. `proposed_amount_cents` is written by the
   * worker running the app's own parseMoney over the verbatim spans the model quoted
   * (see worker.ts). Mandate #6 forbids the model authoring a number; it does not
   * forbid our parser reading one earlier than it used to.
   */
  IF v_prop.proposed_amount_cents IS NOT NULL THEN
    UPDATE change_order
       SET amount_cents = v_prop.proposed_amount_cents,
           -- The confirmation stamp moves with the figure: a price with no moment
           -- attached is the state 050's ingest refuses outright.
           numbers_confirmed_at = COALESCE(numbers_confirmed_at, now())
     WHERE id = v_co AND status = 'draft' AND amount_cents IS NULL;
    IF FOUND THEN v_hit := true; END IF;
  END IF;

  -- THE SPOKEN COST, once. COALESCE so a quote a human corrected is never rewritten.
  SELECT btrim(t.value ->> 'price_words') INTO v_words
    FROM jsonb_array_elements(COALESCE(v_prop.proposed_tasks, '[]'::jsonb)) AS t(value)
   WHERE COALESCE(btrim(t.value ->> 'price_words'), '') <> ''
   LIMIT 1;
  IF v_words IS NOT NULL THEN
    UPDATE change_order SET price_heard = COALESCE(price_heard, v_words)
     WHERE id = v_co AND status = 'draft' AND amount_cents IS NULL AND price_heard IS NULL;
    IF FOUND THEN v_hit := true; END IF;
  END IF;

  RETURN v_hit;
END $$;

-- Repeated because CREATE OR REPLACE does not re-run 394's revoke, and a from-scratch
-- create grants EXECUTE to PUBLIC by default.
REVOKE ALL ON FUNCTION public.apply_proposal_v1(text) FROM public, anon, authenticated;
