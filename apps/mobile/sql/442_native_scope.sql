-- 442 — the scope of work exists in the speaker's language too (LANGUAGE-LAYER slice 1)
--
-- hadar, 2026-09-03: "if my profile is set to a language (spanish) ... the transcription
-- is done in spanish, scope of work is done in spanish."
--
-- ─── THE DESIGN, RESTATED SO NOBODY UNPICKS IT LATER ────────────────────────────
-- English stays CANONICAL (mandate #5): `scope_of_work` is still the English render,
-- still what search indexes, still what the instrument freezes unless a send explicitly
-- chooses another language (slice 2). What this adds is a SECOND RENDER of the same
-- sections in the language the contractor actually spoke, so the app can put his own
-- language in front of him. It is display material with provenance — never a fork of
-- the document. The worker writes both from ONE structuring pass, so they cannot say
-- different things; a human edit to the English does NOT edit the native copy, and the
-- app's display logic must prefer the edited English over a stale native render
-- (`scope_of_work_ai` is the tell, same as every other AI-vs-human question here).

alter table public.capture_structured
  add column if not exists proposed_value_native text,
  add column if not exists proposed_native_lang  text;

comment on column public.capture_structured.proposed_value_native is
  'renderScope() of the same sections as proposed_value, in the language the speaker '
  'actually used. Null when he spoke English, translation failed, or the language has '
  'no reviewed headings. Never canonical: proposed_value (English) is the record.';

alter table public.change_order
  add column if not exists scope_of_work_native text,
  add column if not exists scope_native_lang    text;

comment on column public.change_order.scope_of_work_native is
  'The AI scope in the speaker''s own language, written by apply_proposal_v1 under the '
  'same may-I-touch-this guard as scope_of_work. Display material for the contractor; '
  'the binding instrument renders from scope_of_work unless a send chooses this '
  'language explicitly. Stale the moment a human edits the English — readers must '
  'check scope_of_work = scope_of_work_ai before showing it.';

-- ── apply_proposal_v1 carries the native render (supersedes 397's definition) ────
-- The body is 397's verbatim plus ONE addition in the scope update. Kept whole rather
-- than patched at apply time because a function has no ALTER — the file that owns the
-- latest definition is this one now.
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

  IF v_prop.proposed_value IS NOT NULL AND btrim(v_prop.proposed_value) <> '' THEN
    UPDATE change_order
       SET scope_of_work = v_prop.proposed_value,
           scope_of_work_ai = v_prop.proposed_value,
           -- THE ONE ADDITION (442): the native render rides the exact same guard, so
           -- it can only land where the AI was allowed to write at all. Both columns
           -- move together or not at all — a native copy of a scope the human has
           -- since rewritten would be a document that says two things.
           scope_of_work_native = v_prop.proposed_value_native,
           scope_native_lang    = CASE WHEN v_prop.proposed_value_native IS NULL
                                       THEN NULL ELSE v_prop.proposed_native_lang END
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

  IF v_prop.proposed_amount_cents IS NOT NULL THEN
    UPDATE change_order
       SET amount_cents = v_prop.proposed_amount_cents,
           numbers_confirmed_at = COALESCE(numbers_confirmed_at, now())
     WHERE id = v_co AND status = 'draft' AND amount_cents IS NULL;
    IF FOUND THEN v_hit := true; END IF;
  END IF;

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

REVOKE ALL ON FUNCTION public.apply_proposal_v1(text) FROM public, anon, authenticated;
