-- 270_ask_live_only.sql
--
-- A RETIRED LINK CANNOT BE ANSWERED. IT COULD STILL BE ASKED. Closing that.
--
-- The gap (branch review, 2026-07-21): 250_one_live_link made a superseded link
-- unanswerable at the table -- `confirmation_response_not_superseded`, a BEFORE INSERT
-- trigger on confirmation_response. `confirmation_question` got no equivalent, because
-- 220 was written before 250 and nothing went back over it.
--
-- So the two halves of the same page disagreed. On a link the contractor had already
-- replaced:
--   "Approve" / "Decline"      -> refused, with the "this version was replaced" screen
--   "Ask a question instead"   -> accepted, silently, against the old price
--
-- confirm.html catches the common case at load() and shows the replaced screen before
-- anything renders. What it cannot catch is the page that was ALREADY OPEN when the
-- contractor hit resend -- exactly the race the answer() path handles at confirm.html
-- and the reason 250 put the rule at the table instead of in the RPC. The client reads
-- yesterday's $1,850, types "can you do it for less?", and the contractor receives a
-- question with no indication it is about a version that no longer exists. He answers
-- the question he was asked and they are now discussing two different numbers, which
-- is the precise failure this product exists to prevent.
--
-- AT THE TABLE, NOT IN confirmation_ask, for the same reason as 210/240/250: it holds
-- for every write path, and it cannot be undone by re-running an older file that
-- happens to redefine the function.
--
-- WHAT THIS DELIBERATELY DOES NOT DO: it does not touch questions already recorded
-- against a link that was later superseded. They are append-only evidence of a
-- question that really was asked, and rewriting history to tidy it would be its own
-- dishonesty. This is BEFORE INSERT: only new asks are refused.
--
-- ERROR SHAPE matches 250 exactly -- errcode 23514, hint 'link_superseded' -- so the
-- page's existing handler already says the right thing without a new branch.

create or replace function public.confirmation_question_not_superseded() returns trigger
  language plpgsql as $$
declare sup timestamptz;
begin
  select superseded_at into sup
    from public.confirmation_request where token = new.token;
  if sup is not null then
    raise exception 'this approval link was replaced by a newer one'
      using errcode = '23514', hint = 'link_superseded';
  end if;
  return new;
end $$;

drop trigger if exists confirmation_question_live_only on public.confirmation_question;
create trigger confirmation_question_live_only before insert on public.confirmation_question
  for each row execute function public.confirmation_question_not_superseded();
