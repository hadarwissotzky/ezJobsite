-- 367_supersede_forward_link.sql
--
-- A RETIRED LINK NOW SAYS WHERE THE LIVE ONE IS. Closing the last of R6 AC2.
--
-- The gap: 250_one_live_link retires the old link when a new one is issued, and
-- confirm.html tells the client "This version was replaced. Please open the most
-- recent link they texted you."
--
-- Think about who is reading that. A homeowner, standing in a doorway, holding a
-- phone, who has just been told the thing they were about to sign is stale and that
-- the fix is to go hunting through their SMS history for a link that looks almost
-- identical to the one they are already looking at. R6 AC2 asks for "links to the
-- current version" and this asked them to do a manual diff on two URLs instead.
--
-- The information was already in the database. Nothing exposed it.
--
-- WHY THIS IS A NEW FUNCTION AND NOT A COLUMN ON confirmation_request:
-- superseded_at records WHEN a request was retired. Which request replaced it is
-- derivable -- the live request on the same change_order -- and deriving it means
-- there is no second copy that can disagree with the supersession itself. Same
-- reasoning as `discussing` in 220: a fact two writers can set is a fact nobody can
-- rely on.
--
-- WHAT IS DELIBERATELY NOT DONE: this returns a token, not a URL. The page knows
-- its own origin and builds the link from it. A base URL stored server-side would
-- be a second source of truth for where this page lives, and EXPO_PUBLIC_CONFIRM_BASE
-- has already been wrong once (it pointed at a domain that did not exist).

create or replace function public.confirmation_state(p_token text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.confirmation_request%rowtype;
        answered boolean;
        live text;
begin
  select * into r from public.confirmation_request where token = p_token;
  if not found then return jsonb_build_object('found', false); end if;
  select exists(select 1 from public.confirmation_response where token = p_token)
    into answered;

  -- The request that replaced this one: same change order, still live, never
  -- answered. NULL is a normal outcome and the page must handle it -- a link can be
  -- retired without a replacement (the contractor changed his mind), and inventing
  -- a forward link in that case would send the client somewhere that does not exist.
  if r.superseded_at is not null and r.change_order_id is not null then
    select r2.token into live
      from public.confirmation_request r2
     where r2.change_order_id = r.change_order_id
       and r2.token <> r.token
       and r2.superseded_at is null
       and now() <= r2.expires_at
       and not exists (select 1 from public.confirmation_response x where x.token = r2.token)
     order by r2.created_at desc
     limit 1;
  end if;

  return jsonb_build_object(
    'found', true,
    'superseded', r.superseded_at is not null,
    -- WITHDRAWN IS NOT REPLACED (421). A superseded link points the client forward to
    -- the version that replaced it; a cancelled one has no successor and must say so,
    -- or the page sends them hunting for a link that does not exist. Reported
    -- separately for that reason, and the page checks it FIRST.
    'cancelled', r.cancelled_at is not null,
    'answered', answered,
    'expired', now() > r.expires_at,
    -- The token only. The page builds the URL from its own origin.
    'live_token', live
  );
end $$;

revoke all on function public.confirmation_state(text) from public;
grant execute on function public.confirmation_state(text) to anon, authenticated;
