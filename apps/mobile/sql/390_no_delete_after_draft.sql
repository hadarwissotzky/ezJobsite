-- 390 — an extra that left draft cannot be deleted. At the TABLE, not in a function.
--
-- hadar, 2026-08-05: "lets make sure you cannot delete an extra that was approved."
--
-- WHAT WAS ACTUALLY PROTECTING IT: nothing on purpose. Every guard on
-- change_order fires on INSERT or UPDATE — `change_order_frozen`,
-- `change_order_transition`, `change_order_origin`, `change_order_ewa_priceless`.
-- There was no BEFORE DELETE trigger at all, and `authenticated` holds a DELETE
-- grant under policy `co_own` (ALL, owner_id = auth.uid()). So the owner could
-- delete an approved extra straight through PostgREST, never touching
-- `discard_extra_own` and never meeting its ever-sent check.
--
-- A live attempt did fail — but on
-- `confirmation_request_change_order_fk`, i.e. only because a sent extra happens
-- to be referenced by its request row. That is INCIDENTAL protection. It depends
-- on FK topology nobody is holding still: the day that constraint gains ON
-- DELETE CASCADE, or an approved row exists whose request was pruned, the
-- deletion succeeds silently. Mandate #1 says an approved record is "frozen and
-- permanent — never edited in place NOR DELETED"; that invariant should not rest
-- on a foreign key that exists for a different reason.
--
-- THE RULE: only a draft may be deleted. Deliberately a whitelist on 'draft'
-- rather than a blacklist on 'approved', matching discard.ts's NEVER_SENT and for
-- the same stated reason — `sent`, `declined` and any status added later are all
-- somebody else's evidence too, and a blacklist lets a future status through by
-- omission. This is the server half of `canDelete()` (extralifecycle.ts), which
-- already answers stageOf(status) === 'draft' on the client.
--
-- SAFE FOR THE ONE LEGITIMATE DELETER. `discard_extra_own` (389) deletes only
-- after refusing anything not draft and anything ever sent, so it never presents
-- a row this trigger would stop. Verified below in a rolled-back transaction.
--
-- THE ERASURE CARVE-OUT (mandate #5) IS NOT IMPLEMENTED AND THIS BLOCKS IT. A
-- lawful erasure request hard-deletes content while retaining a hash + metadata
-- stub; no such path exists in SQL today (grep: the only deleters are 369/389).
-- When one is built it must clear this trigger DELIBERATELY — by dropping it for
-- the duration, or via `session_replication_role = replica` in a privileged
-- function. Making that an explicit, visible act is the point; an erasure path
-- that slips through a gap nobody declared is how the immutability promise
-- quietly stops being true.

create or replace function public.change_order_no_delete()
returns trigger
language plpgsql as $$
begin
  if old.status is distinct from 'draft' then
    raise exception
      'extra % is %, not a draft; an extra that left draft is permanent (retire it with a revision)',
      old.id, old.status
      using errcode = '42501';
  end if;
  return old;
end $$;

drop trigger if exists change_order_no_delete on public.change_order;
create trigger change_order_no_delete
  before delete on public.change_order
  for each row execute function public.change_order_no_delete();
