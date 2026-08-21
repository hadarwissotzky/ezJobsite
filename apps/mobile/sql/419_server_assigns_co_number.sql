-- 419 — the SERVER assigns an extra's number, and nothing else may
--
-- WHY (hadar, 2026-08-21): "it cannot have a number until it reached the server and
-- the server gave it one."
--
-- He is right, and the device has been minting them. `nextCoNumber` takes
-- `MAX(co_number)+1` over the LOCAL rows of a project, which is only correct on a
-- phone that has seen every extra on that job. Two consequences, both real:
--
--   · TWO DEVICES OFFLINE BOTH MINT THE SAME NUMBER. Each sees its own local maximum,
--     each says "#4", and both are wrong the moment they meet. `pushCoNumbers` (added
--     this morning) softened it with a first-write-wins predicate, but softening a
--     racing counter is not the same as not racing: both phones still SHOW #4 until a
--     hydrate corrects one, and by then the contractor has said "number four" out loud.
--   · A NUMBER IS AN IDENTIFIER ON A DOCUMENT SOMEBODY SIGNS. It appears on the
--     client's portal page (399) and in the approval record. An identifier minted by a
--     device that cannot see the whole job is a guess wearing an authoritative face.
--
-- One project, one counter, one place. The server can see every extra on a job by
-- definition; the device cannot.
--
-- ─── A TRIGGER, NOT A CHANGE TO ingest_change_order_v1 ──────────────────────────
-- 391 records why that function is not casually edited: PostgREST resolves an RPC by
-- its exact argument-name set, it is shared by 050 and 375, and widening it means
-- DROP + CREATE. A BEFORE INSERT trigger needs none of that and catches EVERY door
-- into the table, including any future one.
--
-- ─── THE ADVISORY LOCK IS THE WHOLE POINT ──────────────────────────────────────
-- `MAX(...)+1` under concurrency is the classic double-assign: two transactions read
-- the same maximum and both write it. A transaction-scoped advisory lock keyed on the
-- project serialises assignment per job — and only per job, so two crews on two
-- different sites never wait on each other. It is released at COMMIT, automatically,
-- including on rollback.
--
-- ─── IT ONLY EVER FILLS A NULL ─────────────────────────────────────────────────
-- A row arriving WITH a number keeps it. That is what makes this safe to apply to a
-- live database: every extra already numbered stays exactly as it is, on the client's
-- page and in every approval record already sent.

create or replace function public.assign_co_number() returns trigger
  language plpgsql as $$
begin
  if new.co_number is not null then
    return new;   -- already numbered (backfill, replay, or a legacy client)
  end if;

  -- Serialise per project. Transaction-scoped: released at COMMIT or ROLLBACK.
  perform pg_advisory_xact_lock(hashtext('co_number:' || coalesce(new.project_id, '')));

  select coalesce(max(co_number), 0) + 1 into new.co_number
    from public.change_order
   where project_id is not distinct from new.project_id;

  return new;
end $$;

drop trigger if exists change_order_number on public.change_order;
create trigger change_order_number
  before insert on public.change_order
  for each row execute function public.assign_co_number();

-- ─── NUMBER WHAT IS ALREADY HERE ───────────────────────────────────────────────
-- Oldest first per project, so the numbering matches the order the work happened in —
-- the same rule the device's own backfill used. Rows that already carry a number are
-- untouched: `where co_number is null` is doing real work, not defensive noise.
with ordered as (
  select id,
         row_number() over (partition by project_id order by created_at, id)
           + coalesce((select max(c2.co_number) from public.change_order c2
                        where c2.project_id is not distinct from c.project_id), 0)
           as n
    from public.change_order c
   where co_number is null
)
update public.change_order co set co_number = o.n
  from ordered o where o.id = co.id;
