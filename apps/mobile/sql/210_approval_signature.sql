-- 210_approval_signature.sql
--
-- MANDATE #2, enforced by the database: a PRICED approval is not approved unless it
-- carries a signature.
--
-- The hole this closes (Codex adversarial review, 2026-07-21):
--   `confirmation_respond` is granted to `anon` -- correctly, the whole design is a
--   no-account link -- and takes `p_signed_name text default null` with no check.
--   The only thing requiring a name was two lines of browser JavaScript disabling a
--   button (`confirm.html`: `approveEl.disabled = nameEl.value.trim().length < 2`).
--   Anyone holding the link could call the RPC directly with p_action='confirmed'
--   and no name, and mint a binding, immutable "approval" that nobody signed.
--   CLAUDE.md mandate #2 defines approval as "a digital signature -- a binding,
--   verifiable sign-off". An unsigned row is not that.
--
-- WHY A TRIGGER AND NOT A CHECK CONSTRAINT:
--   The rule is conditional on the REQUEST, not the response: only priced approvals
--   need a signature. The legacy no-price decision confirmation legitimately answers
--   'confirmed' with no name (`confirm.html` renderPlain -> answer('confirmed',null,
--   null)), and a blanket constraint would have broken every decision confirmation
--   in the product. A CHECK constraint cannot look at another table; a BEFORE INSERT
--   trigger can.
--
-- WHY AT THE TABLE AND NOT IN THE RPC:
--   Two reasons. (1) It then holds for every write path, not just the one function.
--   (2) `200_priced_approval.sql` redefines four functions still owned by
--   `020_confirmations.sql`; if 020 is ever re-run after 200 the older definitions
--   come back. A guard living in a function can be reverted by that migration-order
--   hazard. A trigger owned by this file cannot.
--
-- WHAT THIS DELIBERATELY DOES NOT DO:
--   It does not require a name to DECLINE or to ask a question -- demanding identity
--   to say "not yet" is how you get no answer at all. It does not attempt to verify
--   that the typed name belongs to the person typing it: per PRD-RECONCILIATION §3.5
--   the v1 instrument is typed-name + immutable snapshot + audit trail, and whether
--   that clears the ESIGN/UETA bar is Fable Q1, a BLOCKING legal question. This
--   raises the floor from "nothing at all" to "the v1 instrument"; it does not
--   settle Q1.

create or replace function public.confirmation_response_require_signature()
  returns trigger language plpgsql as $$
declare req public.confirmation_request%rowtype;
begin
  -- Declines and questions pass through untouched.
  if new.action is distinct from 'confirmed' then
    return new;
  end if;

  select * into req from public.confirmation_request where token = new.token;
  if not found then
    raise exception 'unknown token' using errcode = '42501';
  end if;

  -- A priced request is a contract. amount_cents is null on the plain
  -- decision-confirm path (see sendForConfirmation: "null on the plain
  -- decision-confirm path"), which is how the two are told apart.
  if req.amount_cents is not null then
    if new.signed_name is null or length(btrim(new.signed_name)) < 2 then
      raise exception 'a priced approval requires a typed signature'
        using errcode = '23514', hint = 'signature_required';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists confirmation_response_require_signature on public.confirmation_response;
create trigger confirmation_response_require_signature
  before insert on public.confirmation_response
  for each row execute function public.confirmation_response_require_signature();
