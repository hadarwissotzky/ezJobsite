-- 394 — THE FIELD MAPPER MOVES TO THE BACKEND, and the "has a human touched this?"
-- rule becomes ONE predicate that lives in the database.
--
-- WHY (hadar, 2026-08-06): "why not do it as a backend field mapper / extraction?" —
-- and then the decider: "we will start the web app soon, so it will have to be done
-- either on a mobile or web app."
--
-- Extraction was already server-side (393). What was NOT was the last step: writing the
-- model's output onto the draft. That lived in the React Native app, which meant the
-- web app would have had to implement the same guard a second time, in a second
-- codebase, for the text people sign. This repo has already been bitten by exactly that
-- shape: the seed guard was encoded in two places, one of them drifted, and an extra
-- ended up with a real title, a real summary and a placeholder scope while the finished
-- write-up sat on the server unread.
--
-- THE OBJECTION THAT USED TO JUSTIFY CLIENT-SIDE APPLY, AND WHY IT DOES NOT HOLD: "the
-- server cannot see edits the contractor made offline." True — and irrelevant, because
-- a PROPOSAL ONLY EXISTS ONLINE. It is a server-side row produced by a server-side
-- pipeline; applying it was never something a disconnected phone could do. Moving it
-- here costs nothing offline that was ever available offline.
--
-- WHAT IS STILL SACRED: a contractor's own words. `scope_of_work_ai` records exactly
-- what the model last wrote, so "still ours to replace" and "his, untouchable" are
-- distinguishable facts rather than a guess. Every write below is conditional on that
-- and on the row still being a draft — an approved or sent extra is a frozen
-- instrument (mandate #5) and `change_order_frozen` refuses it anyway; this predicate
-- means we never even attempt it.

-- The AI-authorship marker, mirrored from the device (where it already exists as a
-- local column). Server-owned in practice: the client has no reason to write it and
-- the function below is the only thing that does.
ALTER TABLE public.change_order
  ADD COLUMN IF NOT EXISTS scope_of_work_ai text;

COMMENT ON COLUMN public.change_order.scope_of_work_ai IS
  'Exactly what the AI last wrote into scope_of_work. The whole point is comparison: current text = this -> the model may rewrite it (the contractor said more); anything else -> a human wrote it and nothing may overwrite it without asking. Never part of the instrument.';

-- The machine-written placeholder a capture-born extra is titled with until the model
-- names it. Declared once, here, because the predicate below and `sendReadiness` on the
-- device both have to agree about what "not written yet" means.
CREATE OR REPLACE FUNCTION public.untitled_scope() RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT 'Untitled extra — still being written up'::text $$;

/**
 * Apply the newest usable proposal for a capture onto the change order it belongs to.
 *
 * ONE STATEMENT, ONE RULE. Everything that decides whether the write is allowed is in
 * the WHERE clause, so there is no path — worker, web, mobile, psql — that can apply a
 * proposal under looser terms than any other.
 *
 * WHAT IT WILL NOT DO:
 *  - Touch anything but a DRAFT. Sent and approved extras are frozen instruments.
 *  - Overwrite a scope of work a human wrote (see `scope_of_work_ai` above).
 *  - Overwrite a term a human answered. Each flow field is COALESCE'd, so a value the
 *    contractor chose survives every future pass; only NULL — "nobody has answered" —
 *    is filled.
 *  - Write a price. There is no amount here and there never will be: mandate #6, and
 *    the measured reason (a model given "four fifty" invented $450 at high confidence).
 *  - Act on a low/none-confidence proposal. Mandate #2's gate, applied at the source.
 *
 * Returns true when a row was actually changed, so the caller can log a real outcome
 * instead of assuming one.
 */
CREATE OR REPLACE FUNCTION public.apply_proposal_v1(p_capture_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_decision text;
  v_co       text;
  v_prop     record;
  v_hit      boolean := false;
BEGIN
  -- Which extra is this capture part of? decision_version is the grouping that syncs
  -- (capture_pair is device-only), and it is the same link the structure step uses to
  -- gather every recording behind one extra.
  SELECT dv.decision_id INTO v_decision
    FROM decision_version dv WHERE dv.capture_id = p_capture_id LIMIT 1;
  IF v_decision IS NULL THEN RETURN false; END IF;

  SELECT co.id INTO v_co
    FROM change_order co
   WHERE co.decision_id = v_decision AND co.status = 'draft'
   ORDER BY co.created_at DESC LIMIT 1;
  IF v_co IS NULL THEN RETURN false; END IF;

  -- The newest HIGH-confidence proposal across every capture behind this extra. Newest
  -- wins because the pipeline is append-only and a later pass has heard more; high-only
  -- because a guess must never reach a document (proposals.ts rule 2).
  SELECT cs.* INTO v_prop
    FROM capture_structured cs
    JOIN decision_version dv ON dv.capture_id = cs.capture_id
   WHERE dv.decision_id = v_decision AND cs.confidence = 'high'
   ORDER BY cs.created_at DESC LIMIT 1;
  IF v_prop IS NULL THEN RETURN false; END IF;

  -- THE SCOPE OF WORK. Written only while it is empty, still the placeholder, still a
  -- copy of the title, or still exactly what the model last left here.
  IF v_prop.proposed_value IS NOT NULL AND btrim(v_prop.proposed_value) <> '' THEN
    UPDATE change_order
       SET scope_of_work = v_prop.proposed_value,
           scope_of_work_ai = v_prop.proposed_value
     WHERE id = v_co AND status = 'draft'
       AND (scope_of_work IS NULL
            OR btrim(scope_of_work) = ''
            OR scope_of_work = scope
            OR scope_of_work = untitled_scope()
            OR (scope_of_work_ai IS NOT NULL AND scope_of_work = scope_of_work_ai));
    IF FOUND THEN v_hit := true; END IF;
  END IF;

  -- THE TITLE, while it is still the machine placeholder. A contractor who renamed his
  -- extra named it; the model does not get a second opinion.
  IF v_prop.proposed_subject IS NOT NULL AND btrim(v_prop.proposed_subject) <> '' THEN
    UPDATE change_order SET scope = v_prop.proposed_subject
     WHERE id = v_co AND status = 'draft' AND scope = untitled_scope();
    IF FOUND THEN v_hit := true; END IF;
  END IF;

  -- THE TERMS HE ALREADY SAID OUT LOUD. COALESCE, never overwrite: null means nobody
  -- has answered, and that is the only state a proposal may fill. `schedule_days` is
  -- taken only alongside 'adds_days' — a day count under any other verdict is a
  -- contradiction, and the verdict is what renders the clause.
  UPDATE change_order
     SET schedule_effect = COALESCE(schedule_effect, v_prop.proposed_schedule_effect),
         schedule_days   = COALESCE(schedule_days,
                             CASE WHEN v_prop.proposed_schedule_effect = 'adds_days'
                                  THEN v_prop.proposed_schedule_days END),
         billing_timing  = COALESCE(billing_timing, v_prop.proposed_billing_timing),
         exclusions      = COALESCE(exclusions, v_prop.proposed_exclusions),
         extra_type      = COALESCE(extra_type, v_prop.proposed_extra_type)
   WHERE id = v_co AND status = 'draft'
     AND (schedule_effect IS NULL OR billing_timing IS NULL
          OR exclusions IS NULL OR extra_type IS NULL);
  IF FOUND THEN v_hit := true; END IF;

  RETURN v_hit;
END $$;

-- The worker calls this with the service role. No client role is granted EXECUTE: the
-- point of moving the rule here was to have one writer, and handing the predicate to
-- two clients again would undo it.
REVOKE ALL ON FUNCTION public.apply_proposal_v1(text) FROM public, anon, authenticated;

COMMENT ON FUNCTION public.apply_proposal_v1(text) IS
  'Applies the newest high-confidence proposal for a capture onto its DRAFT change order, under one guard: never a sent/approved row, never a human-written scope, never an answered term, never a price. Called by the worker after the structure step (394).';
