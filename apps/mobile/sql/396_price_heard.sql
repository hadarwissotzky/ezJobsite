-- 396 — THE PRICE HE SAID OUT LOUD, carried to where he can confirm it.
--
-- WHY (hadar, 2026-08-07): "there is information regarding the price in the scope and
-- raw transcription but there is none in the record (change order)". He recorded
-- "probably $1,800". The pipeline captured it — verbatim, in `proposed_tasks[].
-- price_words`, which is exactly right — and then nothing ever showed it to him. The
-- change order stayed priceless, Send refused on a hard blocker, and the number he had
-- already said was sitting two tables away.
--
-- THIS IS NOT THE MODEL SETTING A PRICE, and the distinction is the whole of mandate
-- #6. `proposed_amount_cents` is still null forever. What moves here is a QUOTE — the
-- contractor's own words, unparsed and unrounded — to the one screen where a human can
-- look at it and say yes. The app parses it with its own `parseMoney`, shows the figure
-- back, and writes nothing until he taps. A model given "four fifty" invented $450 at
-- high confidence; a man reading "probably $1,800" and tapping $1,800 is a confirmed
-- number, which is a different thing entirely.
--
-- WRITTEN ONLY WHILE THERE IS NO PRICE. Once an amount exists — typed, confirmed, or
-- carried from an earlier pass — the quote has done its job and must not reappear
-- underneath a figure a human already chose.

ALTER TABLE public.change_order
  ADD COLUMN IF NOT EXISTS price_heard text;

COMMENT ON COLUMN public.change_order.price_heard IS
  'The contractor''s own words about cost, verbatim from the transcript ("probably $1,800"). NOT a price and never rendered as one: it exists so the app can read the number back and ask a human to confirm it (mandate #6). Cleared/ignored once amount_cents is set.';

-- Fold it into the one function that applies a proposal, so there is still exactly one
-- writer and one guard (394).
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
  v_words    text;
  v_hit      boolean := false;
BEGIN
  SELECT dv.decision_id INTO v_decision
    FROM decision_version dv WHERE dv.capture_id = p_capture_id LIMIT 1;
  IF v_decision IS NULL THEN RETURN false; END IF;

  SELECT co.id INTO v_co
    FROM change_order co
   WHERE co.decision_id = v_decision AND co.status = 'draft'
   ORDER BY co.created_at DESC LIMIT 1;
  IF v_co IS NULL THEN RETURN false; END IF;

  SELECT cs.* INTO v_prop
    FROM capture_structured cs
    JOIN decision_version dv ON dv.capture_id = cs.capture_id
   WHERE dv.decision_id = v_decision AND cs.confidence = 'high'
   ORDER BY cs.created_at DESC LIMIT 1;
  IF v_prop IS NULL THEN RETURN false; END IF;

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

  IF v_prop.proposed_subject IS NOT NULL AND btrim(v_prop.proposed_subject) <> '' THEN
    UPDATE change_order SET scope = v_prop.proposed_subject
     WHERE id = v_co AND status = 'draft' AND scope = untitled_scope();
    IF FOUND THEN v_hit := true; END IF;
  END IF;

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

  -- THE SPOKEN COST, as a quote. First non-null price_words across the proposal's
  -- tasks — the tasks are ordered as the contractor said them, so the first mention is
  -- the one he led with. Applied only onto an unpriced draft.
  SELECT btrim(t.value ->> 'price_words') INTO v_words
    FROM jsonb_array_elements(COALESCE(v_prop.proposed_tasks, '[]'::jsonb)) AS t(value)
   WHERE COALESCE(btrim(t.value ->> 'price_words'), '') <> ''
   LIMIT 1;

  IF v_words IS NOT NULL THEN
    UPDATE change_order SET price_heard = v_words
     WHERE id = v_co AND status = 'draft' AND amount_cents IS NULL;
    IF FOUND THEN v_hit := true; END IF;
  END IF;

  RETURN v_hit;
END $$;

COMMENT ON FUNCTION public.apply_proposal_v1(text) IS
  'Applies the newest high-confidence proposal onto its DRAFT change order under one guard: never a sent/approved row, never a human-written scope, never an answered term, never a price — only a QUOTE of what was said about price, for a human to confirm (394, 396).';
