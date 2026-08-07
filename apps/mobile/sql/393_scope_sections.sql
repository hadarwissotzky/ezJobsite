-- 393 — the SCOPE OF WORK, in sections, plus the terms the narration already stated.
--
-- WHY (hadar, 2026-08-06): "the users might not be sophisticated and this gives them
-- the opportunity to ramble and tell their story; it is our responsibility to generate
-- a professional looking change order that clearly communicates to the owner what will
-- happen, why, how, cost, what is not included and what to expect."
--
-- Until now the structure step returned ONE prose blob (`proposed_value`) and the app
-- seeded it into `change_order.scope_of_work`. That is a summary, not a change order:
-- an owner reading it cannot see where the work stops, what he is still paying for
-- separately, or whether his kitchen is unusable for three days. Meanwhile the four
-- fields that answer exactly those questions — schedule effect, payment timing,
-- exclusions, inclusions — sat empty on the change order and were counted as gaps the
-- CONTRACTOR had to fill, even when he had already said the answers out loud.
--
-- So the model now returns the scope BROKEN INTO SECTIONS, and separately reports the
-- terms it heard. Both are still PROPOSALS (160's rule, restated): a row here binds
-- nothing. The app decides what to apply, applies it only where the contractor has not
-- answered, and the send gate still puts a human in front of every one of them
-- (mandate #2).
--
-- THE PRICE IS STILL ABSENT AND STAYS ABSENT. `proposed_amount_cents` remains null
-- forever from this step and no column here holds a figure. A cost the contractor
-- spoke rides as a VERBATIM QUOTE in `proposed_tasks[].price_words`, is parsed by the
-- app's own `parseMoney`, and is confirmed by a person before it means anything
-- (mandate #6 — a model given "four fifty" invented $450 at high confidence).

ALTER TABLE public.capture_structured
  -- The scope, structured. Shape:
  --   { "background": text|null,
  --     "steps": [text], "included": [text], "excluded": [text], "assumptions": [text] }
  -- jsonb rather than six columns because it is ONE authored object that is rendered
  -- as a whole; splitting it would invite a writer to update four columns out of five.
  ADD COLUMN IF NOT EXISTS proposed_sections jsonb,

  -- The flow terms, when the narration stated them. Same vocabularies as
  -- change_order's CHECKs, so applying one is a copy and never a translation — two
  -- spellings of the same enum is how the app and the document start disagreeing about
  -- what the client agreed to.
  ADD COLUMN IF NOT EXISTS proposed_schedule_effect text
    CHECK (proposed_schedule_effect IS NULL
           OR proposed_schedule_effect IN ('no_change','adds_days','not_sure')),
  ADD COLUMN IF NOT EXISTS proposed_schedule_days integer
    CHECK (proposed_schedule_days IS NULL OR proposed_schedule_days > 0),
  ADD COLUMN IF NOT EXISTS proposed_billing_timing text
    CHECK (proposed_billing_timing IS NULL
           OR proposed_billing_timing IN ('next_invoice','when_completed','other')),

  -- Rendered text for the two lists the owner cares about most. Kept as text (not the
  -- jsonb above) because these are the columns `change_order.exclusions` is copied
  -- from, and a copy that needs formatting on the way is a copy that can differ from
  -- what was shown.
  ADD COLUMN IF NOT EXISTS proposed_exclusions text,
  ADD COLUMN IF NOT EXISTS proposed_inclusions text;

COMMENT ON COLUMN public.capture_structured.proposed_sections IS
  'The scope of work broken into background/steps/included/excluded/assumptions. A PROPOSAL: the app renders and seeds it, a human confirms before it can be sent (mandate #2). Never contains prices.';
COMMENT ON COLUMN public.capture_structured.proposed_schedule_effect IS
  'What the contractor SAID about schedule impact, in change_order''s own vocabulary. Null when he did not say.';
COMMENT ON COLUMN public.capture_structured.proposed_billing_timing IS
  'What the contractor SAID about when this gets billed. Null when he did not say.';
COMMENT ON COLUMN public.capture_structured.proposed_exclusions IS
  'What the change order does NOT cover, as the owner should read it. Drawn from the transcript; standard trade exclusions may be proposed but are marked for confirmation like everything else here.';
