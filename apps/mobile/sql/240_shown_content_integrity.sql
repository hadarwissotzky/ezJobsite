-- 240_shown_content_integrity.sql
--
-- THE NUMBER ON THE PAGE MUST BE THE NUMBER IN THE DOCUMENT. Closing Codex #7.
--
-- The hole: `confirmation_create` accepted shown_content, a CLIENT-SUPPLIED
-- shown_sha256, amount_cents, nte_cents, scope_title and change_order_id as six
-- independent values and cross-checked none of them. The approval page then renders
-- the big price from `amount_cents` while the binding instrument is `shown_content`.
-- Nothing made those agree. A buggy build -- or a hostile authenticated caller --
-- could freeze wording saying $10,000 beside a page showing $1,000, and the client
-- would sign while reading the small number.
--
-- The hash made it worse rather than better: shown_sha256 is the integrity proof for
-- the frozen text, and it was whatever the caller said it was. An unverified hash is
-- not evidence, it is decoration that looks like evidence.
--
-- WHAT THIS ENFORCES, at the table, on every write path:
--   1. shown_sha256 is RECOMPUTED server-side from shown_content. A caller that
--      supplies a wrong hash is rejected loudly rather than silently corrected --
--      a mismatch means a bug or an attack, and both deserve to be seen.
--   2. Any money the page will display MUST literally appear in the frozen text.
--      amount_cents and nte_cents are formatted exactly as renderCard formats them
--      ($1,850.00) and must be found in shown_content. This is what actually binds
--      the rendered page to the signed document.
--   3. change_order_id becomes a real foreign key. It was free text pointing at
--      nothing in particular.
--
-- WHY A TRIGGER, NOT CHANGES TO confirmation_create: the same reasoning as 210. It
-- holds for every write path rather than one function, and it survives the
-- migration-order hazard in Codex #5, where re-running 020 after 200 restores older
-- function definitions and would take a guard living inside one with it.
--
-- FORMAT COMPATIBILITY WAS VERIFIED, NOT ASSUMED (2026-07-21): postgres
-- encode(sha256(convert_to(t,'UTF8')),'hex') was compared against the client's
-- js-sha256 on identical input containing an em dash and a non-breaking context --
-- both produced 139f12667db7bfbce461579b682862134b6badf0d9788c2c0e3af633c54fe731.
-- And to_char(cents/100.0,'FM999,999,990.00') reproduces usd() exactly for
-- $1,850.00 / $0.50 / $12,345.67. If either ever drifts, every legitimate send
-- starts failing loudly -- which is the correct direction for this class of bug.

create or replace function public.confirmation_request_integrity() returns trigger
  language plpgsql as $$
declare computed text;
        want text;
begin
  -- 1 ── the hash is derived, never accepted
  computed := encode(sha256(convert_to(new.shown_content, 'UTF8')), 'hex');
  if new.shown_sha256 is not null
     and lower(new.shown_sha256) is distinct from computed then
    raise exception 'shown_sha256 does not match shown_content'
      using errcode = '23514', hint = 'hash_mismatch';
  end if;
  new.shown_sha256 := computed;

  -- 2 ── every figure the page will show must be in the document it signs
  if new.amount_cents is not null then
    want := '$' || to_char(new.amount_cents / 100.0, 'FM999,999,990.00');
    if position(want in new.shown_content) = 0 then
      raise exception
        'the displayed price % does not appear in the frozen wording', want
        using errcode = '23514', hint = 'price_not_in_shown_content';
    end if;
  end if;

  if new.nte_cents is not null then
    want := '$' || to_char(new.nte_cents / 100.0, 'FM999,999,990.00');
    if position(want in new.shown_content) = 0 then
      raise exception
        'the not-to-exceed cap % does not appear in the frozen wording', want
        using errcode = '23514', hint = 'nte_not_in_shown_content';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists confirmation_request_integrity on public.confirmation_request;
create trigger confirmation_request_integrity
  before insert on public.confirmation_request
  for each row execute function public.confirmation_request_integrity();

-- 3 ── change_order_id stops being free text.
-- NOT VALID: enforced for every new row, without re-scanning history. There are 0
-- orphans today (checked), so this is belt-and-braces rather than a workaround.
alter table public.confirmation_request
  drop constraint if exists confirmation_request_change_order_fk;
alter table public.confirmation_request
  add constraint confirmation_request_change_order_fk
  foreign key (change_order_id) references public.change_order(id) not valid;
