-- 407 — ask a teammate to review a draft extra.
--
-- hadar, 2026-08-14: "send it to a team member is either an invitation to the app or
-- using people that already have the application — either way it is a notification for
-- the user: 'so-and-so invited you to review the following change order'. The difference
-- between a client and a member is that if sent JUST to a member it is kept as a DRAFT
-- and continues to go through review, while if the client is involved then it gets into
-- a negotiation stage."
--
-- ─── THE RULE THIS ENCODES, AND THE ONE THING IT MUST NOT DO ────────────────────
-- WHO YOU SEND TO DECIDES THE STAGE. A client turns a draft into a sent instrument
-- (`confirmation_request` + the lifecycle transition that already exists). A teammate
-- does NOT: the extra stays exactly where it was.
--
-- So this function DOES NOT TOUCH `change_order` AT ALL — not its status, not its
-- timestamps, not a single column. That is not an oversight to be tidied up later; it
-- is the requirement. `SPEC-extra-lifecycle-v1` owns the status vocabulary and every
-- legal transition, and "somebody asked a colleague to look at this" is not one of
-- them. A review request is a MESSAGE ABOUT a draft, not a change to it. Anything added
-- here that writes to `change_order` would invent a lifecycle state through the side
-- door, which is exactly the failure mode the spec exists to prevent.
--
-- IT ALSO MINTS NO `confirmation_request`. A teammate must not be able to sign: only
-- the named client approves (D4 — "anyone else on the record may read and ask; nobody
-- else can approve"). Handing a colleague a signing token so they could "just approve
-- it" would let an internal person commit a client's money, which is the worst thing
-- this schema could be made to do.
--
-- ─── VERIFIED BY EXECUTION (2026-08-14) ─────────────────────────────────────────
-- Against a local Postgres 18: me + a teammate in company A, a stranger in company B,
-- a REVOKED ex-crew member in company A. One call listing all four plus myself
-- notified exactly ONE person — the active teammate. The stranger, the revoked member
-- and the caller were skipped without failing the call. Asking about somebody else's
-- extra raised `not yours to share`. `change_order` was byte-identical afterwards.
--
-- The bug that only running it found: the unnest alias was `t(uid)`, which collides
-- with the plpgsql variable `uid` — Postgres refuses the whole statement with
-- "column reference uid is ambiguous". It parses fine at CREATE; it fails at CALL.
--
-- ─── AUTHORISATION ──────────────────────────────────────────────────────────────
--   * the caller must OWN the extra — you cannot ask people to review somebody else's;
--   * every recipient must be an ACTIVE member of a company the caller also belongs to.
-- The second check is the one that matters: without it this is an open endpoint for
-- writing arbitrary rows into any user's notification feed, addressed with a name and
-- a dollar figure the recipient has no relationship to.

create or replace function public.request_extra_review(
  p_change_order_id text,
  p_user_ids uuid[]
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid    uuid := auth.uid();
  co     record;
  asker  text;
  n      int := 0;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_user_ids is null or array_length(p_user_ids, 1) is null then
    return jsonb_build_object('ok', true, 'notified', 0);
  end if;

  select id, scope, owner_id, co_number, amount_cents
    into co
    from public.change_order
   where id = p_change_order_id;
  if co.id is null then
    raise exception 'no such extra' using errcode = '42704';
  end if;
  if co.owner_id <> uid then
    raise exception 'not yours to share' using errcode = '42501';
  end if;

  -- The name the recipient reads. Falls back to nothing rather than to a placeholder:
  -- "Someone asked you to review" is honest, "Unknown asked you" is a fabricated actor.
  select nullif(btrim(coalesce(cm.display_name, cp.display_name, '')), '')
    into asker
    from public.company_member cm
    left join public.contractor_profile cp on cp.user_id = uid
   where cm.user_id = uid and cm.status = 'active'
   limit 1;

  insert into public.notification_outbox (user_id, title, body, data)
  select t.target,
         case when asker is null then 'A change order needs your review'
              else asker || ' asked you to review a change order' end,
         coalesce(nullif(btrim(co.scope), ''), 'Untitled extra'),
         jsonb_build_object('kind', 'review_request',
                            'change_order_id', co.id,
                            'co_number', co.co_number)
    -- `t(target)`, not `t(uid)`: the plpgsql variable is also called `uid`, and the
    -- collision is not a warning — Postgres refuses the statement outright.
    from unnest(p_user_ids) as t(target)
   -- SHARED COMPANY, ACTIVE ON BOTH SIDES. Written as a join rather than a loop so a
   -- single id that fails the test is skipped silently instead of aborting the whole
   -- request — one stale member in a list must not lose the other three notifications.
   where exists (
     select 1
       from public.company_member me
       join public.company_member them on them.company_id = me.company_id
      where me.user_id = uid and me.status = 'active'
        and them.user_id = t.target and them.status = 'active')
     and t.target <> uid;   -- never notify yourself about your own draft
  get diagnostics n = row_count;

  return jsonb_build_object('ok', true, 'notified', n);
end $$;

revoke all on function public.request_extra_review(text, uuid[]) from public, anon;
grant execute on function public.request_extra_review(text, uuid[]) to authenticated;
