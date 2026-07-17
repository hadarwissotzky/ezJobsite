-- Structured extraction — the third pipeline step, and mandate #4's "the product".
--
--   "Transcription is a commodity; THE STRUCTURING LAYER IS THE PRODUCT."
--
-- And the constraint that shapes every line of this:
--
--   "LLM structuring hallucinates ~31% OF THE TIME in the closest studied domain —
--    A DOLLAR FIGURE CANNOT RIDE ON AN UNCONFIRMED TRANSCRIPT." (mandate #2)
--   "Numbers/prices/measurements are the highest-risk field. NEVER trust them from
--    the transcript. Read-back + tap-to-correct. ALWAYS." (mandate #6)
--
-- So this table holds A PROPOSAL, NOT A RECORD. Nothing here is a decision, and
-- nothing here is a change order. It is what a model THINKS was said, waiting for a
-- human to look at it. The names say so: `proposed_*`, and `is_proposal_not_record`
-- is a literal column that a reader cannot miss.
--
-- WHY A SEPARATE TABLE RATHER THAN WRITING decision/change_order DIRECTLY:
-- because at a 31% hallucination rate, a pipeline that writes decisions creates a
-- decision the contractor never made, roughly one time in three. The existing law
-- already blocks the money path — change_order.numbers_confirmed_at is NOT NULL —
-- so a proposal CANNOT become a priced CO without a human read-back. This table is
-- the input to that read-back, not a way around it.

create table if not exists public.capture_structured (
  id            text primary key,
  capture_id    text not null,
  owner_id      uuid not null,

  -- What the model thinks. Every one is a GUESS until a person says otherwise.
  proposed_subject     text,
  proposed_value       text,
  proposed_scope       text check (proposed_scope is null or proposed_scope in ('project','party')),
  proposed_who_directed text,
  -- INTEGER cents, and NULL when the model is not sure. A wrong number is worse
  -- than no number: no number makes someone type it; a wrong one gets confirmed by
  -- a tired man who trusts the app.
  proposed_amount_cents bigint check (proposed_amount_cents is null or proposed_amount_cents >= 0),
  -- The model's own confidence, kept honestly. 'low' must never prefill a field.
  confidence    text not null check (confidence in ('high','low','none')),

  -- Provenance. "Your app said X" — which model, which day? A proposal with no
  -- engine cannot be argued about, or improved.
  engine        text not null,
  engine_model  text,
  -- The exact text the model was given. If the transcript was wrong, the proposal
  -- was doomed and this is how you find that out.
  from_transcript text,

  -- Not a column anyone reads to make a decision. A column anyone reads to
  -- remember what this table IS.
  is_proposal_not_record boolean not null default true
    check (is_proposal_not_record = true),

  created_at    timestamptz not null default now()
);

create index if not exists structured_by_capture
  on public.capture_structured (capture_id, created_at desc);

create or replace function public.structured_append_only() returns trigger
  language plpgsql as $$ begin
    raise exception 'proposals are append-only: re-structure by inserting, % blocked', tg_op;
  end $$;
drop trigger if exists structured_immutable on public.capture_structured;
create trigger structured_immutable before update or delete
  on public.capture_structured for each row execute function public.structured_append_only();

alter table public.capture_structured enable row level security;
drop policy if exists structured_own on public.capture_structured;
create policy structured_own on public.capture_structured for select to authenticated
  using (owner_id = auth.uid());
-- Server-owned: a client that could write a proposal could claim the model said
-- something it never said.
revoke insert, update, delete on public.capture_structured from authenticated;

create or replace view public.capture_structured_current as
select distinct on (capture_id) * from public.capture_structured
 order by capture_id, created_at desc;
grant select on public.capture_structured_current to authenticated;
