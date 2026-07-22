-- 210_approval_signature.sql
--
-- MANDATE #2, enforced by the database: an approval is not an approval unless it
-- carries a signature. Priced Extras AND no-cost Decisions alike.
--
-- The hole this closes (Codex adversarial review, 2026-07-21):
--   `confirmation_respond` is granted to `anon` -- correctly, the whole design is a
--   no-account link -- and takes `p_signed_name text default null` with no check.
--   The only thing requiring a name was two lines of browser JavaScript disabling a
--   button (`confirm.html`: `nameEl.value.trim().length < 2`). Anyone holding the
--   link could call the RPC directly with p_action='confirmed' and no name, and mint
--   a binding, immutable, append-only "approval" that nobody signed.
--   CLAUDE.md mandate #2 defines approval as "a digital signature -- a binding,
--   verifiable sign-off". An unsigned row is not that.
--
-- SCOPE, revised 2026-07-21 [hadar]: the first version of this file required a
--   signature only for PRICED requests, to avoid breaking the legacy no-price
--   decision path, which confirmed with no name at all
--   (`confirm.html` renderPlain -> answer('confirmed', null, null)).
--   That preserved a second hole: a Decision -- "confirm the vanity height at 34
--   inches", the thing that prevents a rework argument -- could be confirmed by
--   anyone holding the link, unsigned. It also contradicted the product spec:
--   PRD-change-approval-loop R10 says a Decision "records signature + timestamp
--   LIKE ANY ITEM". The spec was right and the implementation was wrong.
--   The rule is now unconditional: every 'confirmed' response is signed.
--   `confirm.html` renderPlain gained the matching name field in the same change --
--   a server rule with no client field would just be a wall.
--
-- WHY AT THE TABLE AND NOT IN THE RPC:
--   Two reasons. (1) It holds for every write path, not just the one function.
--   (2) `200_priced_approval.sql` redefines four functions still owned by
--   `020_confirmations.sql`; if 020 is ever re-run after 200 the older definitions
--   come back. A guard living in a function can be reverted by that migration-order
--   hazard. A trigger owned by this file cannot.
--
-- WHAT THIS DELIBERATELY DOES NOT DO:
--   It does not require a name to DECLINE or to ask a question. Demanding identity
--   to say "not yet" is how you get no answer at all, and a decline commits the
--   client to nothing. It does not verify that the typed name belongs to the person
--   typing it: per PRD-RECONCILIATION §3.5 the v1 instrument is typed-name +
--   immutable snapshot + audit trail, and whether that clears the ESIGN/UETA bar is
--   Fable Q1, a BLOCKING legal question. This raises the floor from "nothing at all"
--   to the v1 instrument; it does not settle Q1.
--
-- EXISTING ROWS ARE NOT RE-VALIDATED. This is BEFORE INSERT, so historical
--   confirmations recorded before this rule stand as they were. They are evidence of
--   what happened, and rewriting or invalidating them would be its own dishonesty.

create or replace function public.confirmation_response_require_signature()
  returns trigger language plpgsql as $$
begin
  -- BOTH terminal answers are signed. Approve authorises the work and the money;
  -- decline stops the work and the contractor acts on it, so an unsigned decline
  -- would let anyone holding the link halt a job. No exception for no-cost
  -- Decisions either: a confirmed spec is exactly what a rework argument turns on
  -- later. [hadar 2026-07-21: "yes decisions should also be signed"]
  --
  -- Questions never reach this table at all -- they are messages in
  -- confirmation_question (220_question_path.sql), unsigned by design, because a
  -- signature wall in front of "I have a question" produces silence, not questions.
  if new.signed_name is null or length(btrim(new.signed_name)) < 2 then
    raise exception 'an answer requires a typed signature'
      using errcode = '23514', hint = 'signature_required';
  end if;

  return new;
end $$;

drop trigger if exists confirmation_response_require_signature on public.confirmation_response;
create trigger confirmation_response_require_signature
  before insert on public.confirmation_response
  for each row execute function public.confirmation_response_require_signature();
