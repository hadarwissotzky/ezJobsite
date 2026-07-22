-- 220_question_path.sql
--
-- A QUESTION IS NOT A DECLINE. Separating them, and signing both terminal answers.
--
-- The bug (Codex #4, confirmed in the wiring 2026-07-21):
--   `confirm.html` routed BOTH "Ask a question instead" (priced page, line 220) and
--   "No — that's not right" (decision page, line 263) into the same handler, which
--   called `answer('declined', ...)`. The database vocabulary only ever had two
--   actions -- `check (action in ('confirmed','declined'))` -- and
--   `confirmation_response.token` is a PRIMARY KEY, so a response is single-use and
--   append-only.
--
--   Consequences, both bad:
--   1. Asking a question PERMANENTLY DECLINED the item and burned the token. The
--      client could never approve afterwards. PRD R5b is explicit that the opposite
--      must be true: "the Approve button remains pinned and functional for the
--      homeowner at every point in the thread".
--   2. It corrupted the decline status itself. A `declined` row might mean "do not
--      proceed" or might mean "I had a question" -- so the contractor reads
--      "Declined" for someone who only wanted to ask something. A status two
--      different intents can write is a status nobody can rely on.
--      [hadar 2026-07-21: "there is a decline use case and status"]
--
-- THE MODEL, matching PRD R5/R5b/R8:
--   A question is a MESSAGE, not an answer. It lives in its own append-only table,
--   many rows per token, and it does NOT consume the token. Approve and Decline stay
--   in `confirmation_response`: exactly one, terminal, immutable.
--   "In Discussion" is therefore derivable and not a fourth stored state: a request
--   with question rows and no response is in discussion (R5b's first-class status).
--
-- SIGNATURES [hadar 2026-07-21: "yes decisions should also be signed"]:
--   Both TERMINAL answers are signed -- approve and decline alike. A decline stops
--   work and the contractor relies on it; unsigned, anyone holding the link could
--   halt a job. A question is signed by nobody because it commits nobody to
--   anything, and putting a signature wall in front of "I have a question" is how
--   you get silence instead of a question.

-- ── the question thread ─────────────────────────────────────────────────────
create table if not exists public.confirmation_question (
  id           bigint generated always as identity primary key,
  -- NOT unique: a client may ask more than once, and each asking is evidence.
  token        text not null references public.confirmation_request(token),
  note         text not null check (length(btrim(note)) > 0),
  -- identity SIGNAL, not identity PROOF. Named honestly, as elsewhere.
  user_agent   text,
  asked_at     timestamptz not null default now()
);

create index if not exists confirmation_question_token_idx
  on public.confirmation_question (token, asked_at);

-- Append-only, like every other evidence table here.
create or replace function public.confirmation_question_no_change() returns trigger
  language plpgsql as $$ begin
    raise exception 'questions are append-only evidence: % blocked', tg_op;
  end $$;

drop trigger if exists confirmation_question_no_update on public.confirmation_question;
create trigger confirmation_question_no_update before update or delete
  on public.confirmation_question for each row
  execute function public.confirmation_question_no_change();

alter table public.confirmation_question enable row level security;

-- ── asking, from the no-account page ────────────────────────────────────────
-- Deliberately a SEPARATE rpc rather than a third action on confirmation_respond:
-- that function inserts into confirmation_response, whose PK-on-token IS the
-- single-use guarantee. Reusing it would have meant weakening that guarantee for
-- every answer in order to allow many questions.
create or replace function public.confirmation_ask(
  p_token text, p_note text, p_user_agent text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.confirmation_request%rowtype;
        answered boolean;
begin
  select * into r from public.confirmation_request where token = p_token;
  if not found then raise exception 'unknown token' using errcode = '42501'; end if;
  if now() > r.expires_at then raise exception 'link expired' using errcode = '23514'; end if;

  if p_note is null or length(btrim(p_note)) = 0 then
    raise exception 'a question needs a question' using errcode = '23514';
  end if;

  -- Once answered the item is closed; a question afterwards would imply the record
  -- is still open when it is not. R5b closes the thread on approval.
  select exists(select 1 from public.confirmation_response where token = p_token) into answered;
  if answered then
    return jsonb_build_object('status','already_answered');
  end if;

  insert into public.confirmation_question (token, note, user_agent)
  values (p_token, btrim(p_note), p_user_agent);

  return jsonb_build_object('status','asked');
end $$;

revoke all on function public.confirmation_ask from public;
grant execute on function public.confirmation_ask to anon, authenticated;

-- ── read the thread back with the request ───────────────────────────────────
-- The client's page shows what it already asked, so the page reads as a thread
-- rather than a form that forgot them.
create or replace function public.confirmation_questions(p_token text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare out jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('note', q.note, 'asked_at', q.asked_at)
                            order by q.asked_at), '[]'::jsonb)
    into out
    from public.confirmation_question q
   where q.token = p_token;
  return out;
end $$;

revoke all on function public.confirmation_questions from public;
grant execute on function public.confirmation_questions to anon, authenticated;

-- ── signatures on the terminal answers ──────────────────────────────────────
-- NOT redefined here. `confirmation_response_require_signature` is owned by
-- 210_approval_signature.sql and was widened there to cover declines as well as
-- approvals. An earlier draft of this file redefined it, which added a FIFTH fatal
-- duplicate to check-sql-duplicates (4 -> 5) and created exactly the hazard that
-- checker exists to catch: re-running 210 after 220 would have narrowed the rule
-- back and silently re-allowed unsigned declines. One object, one file.
