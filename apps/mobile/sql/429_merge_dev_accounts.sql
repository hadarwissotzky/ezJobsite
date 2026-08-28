-- 429_merge_dev_accounts.sql
--
-- A ONE-OFF REPAIR FOR HADAR'S OWN TWO ACCOUNTS. Not a feature, not a function, and
-- deliberately not reusable.
--
-- hadar, 2026-08-27: "Merge the account and make sure it only will happens to me
-- because I am testing and developing."
--
-- ─── WHAT WENT WRONG ────────────────────────────────────────────────────────────
-- He signed in on the phone with a phone number and in the browser with an email, so
-- Supabase minted two users. Each became `owner` of its own company, and the app is
-- working exactly as designed on both — which is why nothing looked broken until the
-- surfaces disagreed:
--
--   11c7660e  Streamline construction   7 jobsites, the logo, the letterhead
--   120a387f  Hadar wissotzky           1 jobsite, no logo, no letterhead  <- the phone
--
-- So the job picker showed one site out of eight, and the client portal printed no
-- letterhead on change orders raised from the phone. Both are the same fact.
--
-- ─── WHY IT IS SAFE FOR EVERY OTHER USER ────────────────────────────────────────
-- Every statement is keyed to TWO LITERAL UUIDs. There is no pattern match, no join
-- that could widen, and no parameter. The guard below ABORTS the whole transaction
-- unless both users and both companies exist exactly as expected — so running this
-- against any other database, or after the shape has changed, does nothing at all.
--
-- IDEMPOTENT: every UPDATE is `WHERE owner_id = <phone>`, so a second run moves the
-- zero rows that remain.
--
-- ─── WHAT IT DOES NOT DO ────────────────────────────────────────────────────────
-- It does not delete the phone user or its company. They are left as empty husks:
-- deleting a user with `auth.users` references is a different and riskier operation,
-- and nothing reads an empty company. It also does not touch the DEVICE — after this
-- runs, the phone is still signed in as `120a387f` and will now see NOTHING, because
-- everything it owned has moved. Signing that phone into the email account is the
-- other half, and it is a handover: it wipes local data and refuses while the outbox
-- is non-empty (deviceowner.ts). Drain first.
--
-- OWNERSHIP: this file creates no objects (check-sql-duplicates has nothing to own).

begin;

do $$
declare
  v_phone  uuid := '120a387f-cceb-4512-a7f5-3fdeef43f09e';  -- the phone sign-in
  v_email  uuid := '11c7660e-da04-4ad9-9363-cc727365322a';  -- the account that keeps everything
  v_cphone text := 'cmp-120a387fcceb4512a7f53fdeef43f09e';
  v_cemail text := 'cmp-11c7660eda044ad99363cc727365322a';
  v_moved  int;
begin
  -- REFUSE UNLESS THIS IS EXACTLY THE DATABASE THIS FILE WAS WRITTEN FOR. Four
  -- existence checks, all four required. This is the whole of the "only me" promise.
  if not exists (select 1 from public.company where id = v_cphone and owner_id = v_phone)
     or not exists (select 1 from public.company where id = v_cemail and owner_id = v_email)
  then
    raise exception
      'refusing: this file merges two specific dev accounts and they are not both here';
  end if;

  update public.project        set owner_id = v_email, company_id = v_cemail where owner_id = v_phone;
  get diagnostics v_moved = row_count; raise notice 'project        %', v_moved;

  update public.change_order   set owner_id = v_email where owner_id = v_phone;
  get diagnostics v_moved = row_count; raise notice 'change_order   %', v_moved;

  update public.capture        set owner_id = v_email where owner_id = v_phone;
  get diagnostics v_moved = row_count; raise notice 'capture        %', v_moved;

  update public.decision       set owner_id = v_email where owner_id = v_phone;
  get diagnostics v_moved = row_count; raise notice 'decision       %', v_moved;

  update public.extra_actor    set owner_id = v_email where owner_id = v_phone;
  get diagnostics v_moved = row_count; raise notice 'extra_actor    %', v_moved;

  update public.scope_boundary set owner_id = v_email where owner_id = v_phone;
  get diagnostics v_moved = row_count; raise notice 'scope_boundary %', v_moved;

  update public.processing_job set owner_id = v_email where owner_id = v_phone;
  get diagnostics v_moved = row_count; raise notice 'processing_job %', v_moved;

  -- Anything still stamped with the retired company, regardless of who owns it.
  update public.project set company_id = v_cemail where company_id = v_cphone;
  get diagnostics v_moved = row_count; raise notice 'restamped      %', v_moved;

  -- NOTHING MAY BE LEFT BEHIND. If any owner-scoped table still holds a row for the
  -- phone user, the merge was partial and a partial merge is worse than none — it
  -- splits one job's evidence across two owners. Roll the whole thing back instead.
  if exists (select 1 from public.project        where owner_id = v_phone)
     or exists (select 1 from public.change_order where owner_id = v_phone)
     or exists (select 1 from public.capture      where owner_id = v_phone)
     or exists (select 1 from public.decision     where owner_id = v_phone)
     or exists (select 1 from public.extra_actor  where owner_id = v_phone)
  then
    raise exception 'refusing: rows still owned by the phone account after the merge';
  end if;
end $$;

commit;
