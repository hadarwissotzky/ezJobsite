-- 406 — close the account. The lawful-erasure path, and the only one.
--
-- hadar, 2026-08-13: "I cannot seem to be able to downgrade if I want to, or cancel the
-- account — need to be able to do both."
--
-- ─── TWO OBLIGATIONS THAT PULL AGAINST EACH OTHER ───────────────────────────────
--   * APP STORE 5.1.1(v): an app that lets a person create an account must let them
--     delete it FROM INSIDE THE APP. Not an email to support. Today there is no path
--     at all, which is a review rejection as well as a trap.
--   * MANDATES #1/#2 and this schema's whole design: evidence is append-only. Sixteen
--     triggers in this database exist specifically to raise on DELETE.
--
-- CLAUDE.md §2.5 already settled the conflict, and this implements exactly that
-- settlement and nothing wider: a valid erasure request HARD-DELETES the content and
-- media but RETAINS A HASH + METADATA STUB. The personal data is destroyed; the
-- skeleton of the evidence chain survives, so a counterparty holding a signed document
-- still has something to check it against. This is the ONE carve-out to "never
-- destroy", and it is deliberately the narrowest thing that satisfies the law.
--
-- ─── HOW IT GETS PAST THE APPEND-ONLY TRIGGERS ──────────────────────────────────
-- `close_my_account` DISABLES the sixteen immutability triggers, deletes, and enables
-- them again, all inside its own transaction.
--
-- WHY NOT ADD AN ESCAPE CLAUSE TO EACH TRIGGER, which was the first attempt: it means
-- `create or replace`-ing sixteen functions that sixteen other files already own, and
-- `check-sql-duplicates.mjs` calls that FATAL for a reason this project has already
-- been bitten by — an object defined in two files resolves by whichever ran last, and
-- that is how the bundle silently lost a limitation. One object, one file. A deletion
-- feature is not a good reason to take co-ownership of every guard in the schema.
--
-- WHY NOT `session_replication_role = 'replica'`, which is the one-liner: it needs
-- superuser, Supabase's `postgres` may not have it, and the failure would land at
-- RUNTIME on a destructive path after the confirmation was tapped. `ALTER TABLE …
-- DISABLE TRIGGER` only needs table ownership, which the migration role has by
-- definition — it created the tables.
--
-- WHY THE WINDOW IS SAFE. DDL is transactional in Postgres: if anything below raises,
-- the disable rolls back with everything else and no trigger is left off. And
-- `ALTER TABLE` takes ACCESS EXCLUSIVE, so for the milliseconds a trigger is off, no
-- other session can write to that table at all — the lock is what closes the hole,
-- not luck. UPDATE protection is restored by the same statement that restores DELETE;
-- nothing here is a permanent opening.

-- ─── WHAT THIS DOES NOT DO ──────────────────────────────────────────────────────
-- It does not cancel the subscription. Apple owns that (3.1.2); no server can revoke
-- it. The client says so plainly instead of implying the charge stops.
-- It does not delete the `auth.users` row or Storage objects. Both need service-role
-- (`auth.admin.deleteUser`; the storage API), so the CLIENT deletes its own media
-- folder first — it has a `captures_delete_own` policy for exactly that — and the auth
-- row survives until an Edge Function is written. Stated, not implied: as of this
-- migration that makes it a DATA erasure, not an identity erasure.
--
-- ─── VERIFIED BY EXECUTION, NOT BY READING (2026-08-13) ─────────────────────────
-- Run against a local Postgres 18 loaded with `spike/sql/001_schema.sql` + all 76
-- files in `apps/mobile/sql/`, seeded with a full account (project, capture,
-- transcript, note, tag, decision, decision_version, an APPROVED change order, a signed
-- approval, approval photo, confirmation request/response/open, push token, profile):
--   * every one of those tables went to 0 for the erased user
--   * both stubs survived, with hash and date
--   * a SECOND user's project, capture, note and transcript were untouched
--   * all 17 delete-guards were `tgenabled = 'O'` afterwards, and DELETE on a note,
--     DELETE on a capture and UPDATE on a transcript were all still refused
--
-- Two real bugs were found this way and only this way, because plpgsql resolves table
-- columns at first EXECUTION and a `create function` that succeeds proves nothing:
--   1. the stub read `capture.created_at`, a column that does not exist (`inserted_at`)
--   2. the guard list was hand-typed with sixteen entries and there are seventeen
--      (`capture_no_delete`), so the erasure aborted midway through
-- The second is why the list is now asked of `pg_trigger` instead of written down.
--
-- ─── RESIDUAL BOUNDARIES, named honestly (mandate #5) ───────────────────────────
--   * vendor backups and their expiry windows
--   * copies a counterparty already downloaded
--   * the retained hash/metadata stub itself, which is the point
--   * the `*_mutation` idempotency journals — see the note at the bottom, where they
--     are kept ON PURPOSE

-- ── the stub ────────────────────────────────────────────────────────────────────
create table if not exists public.erasure_stub (
  -- No user_id, no owner_id. A stub that named the person would defeat the erasure it
  -- records. What survives is: this document existed, on this date, hashing to this.
  id             text primary key,
  subject_kind   text not null check (subject_kind in ('change_order','capture')),
  content_sha256 text,
  occurred_at    timestamptz,
  erased_at      timestamptz not null default now()
);
alter table public.erasure_stub enable row level security;
-- No policy and no grant: nothing reads this through the API. It exists for the
-- operator and for a dispute, and a readable stub is a re-identification surface.
revoke all on table public.erasure_stub from anon, authenticated;

-- ── the erasure ─────────────────────────────────────────────────────────────────
create or replace function public.close_my_account()
  returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid    uuid := auth.uid();
  n_co   int  := 0;
  n_cap  int  := 0;
  toks   text[];
  cos    text[];
  decs   text[];
  -- The tables this function deletes from. Named once, and used twice: to find the
  -- guards to lift, and as the checklist a reviewer reads.
  targets text[] := array[
    'approval_photo','confirmation_reply','confirmation_question','confirmation_open',
    'confirmation_response','signing_otp','approval','change_order_reminder',
    'extra_work_authorization','extra_actor','co_comment','capture_note',
    'capture_transcript','capture_structured','capture_tag','capture_content_signal',
    'capture_discarded','capture_op_state','attachment','processing_job',
    'decision_version','scope_boundary','project_party','project_approver',
    'confirmation_request','change_order','decision','capture','project',
    'push_token','notification_outbox','contractor_profile'
  ];
  guards text[];
  g      text;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  -- WHICH GUARDS TO LIFT IS ASKED OF THE CATALOG, NOT WRITTEN DOWN.
  --
  -- The first version of this function carried a hand-typed list of sixteen
  -- `table:trigger` pairs. There are seventeen — `capture_no_delete` was missed — and
  -- nothing catches that except running it, which is how it was found. A list like that
  -- is wrong again the day somebody adds an evidence table, and the symptom is an
  -- account deletion that fails halfway for one unlucky person.
  --
  -- `tgtype & 8` is the DELETE bit; `tgisinternal` excludes foreign-key and constraint
  -- triggers, which must keep firing — referential integrity is not what we are lifting.
  select coalesce(array_agg(c.relname || ':' || t.tgname), '{}') into guards
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and not t.tgisinternal
     and (t.tgtype & 8) <> 0
     and c.relname = any(targets);

  -- The guards come off. Transactional: any failure below rolls this back with it, so
  -- there is no path that leaves a trigger disabled.
  foreach g in array guards loop
    execute format('alter table public.%I disable trigger %I',
                   split_part(g, ':', 1), split_part(g, ':', 2));
  end loop;

  -- Anchors, resolved BEFORE anything is deleted. Reading them as the rows disappear
  -- underneath would silently leave children behind — which in this schema means
  -- leaving TRANSCRIPTS behind, the most personal rows in the database.
  select coalesce(array_agg(token), '{}') into toks
    from public.confirmation_request where owner_id = uid;
  select coalesce(array_agg(id), '{}') into cos
    from public.change_order where owner_id = uid;
  select coalesce(array_agg(id), '{}') into decs
    from public.decision where owner_id = uid;

  -- 1. THE STUBS FIRST. If the delete succeeded and the stub write failed, we would
  --    have destroyed the record of the destruction — the one ordering nothing can
  --    recover from. Same reasoning as committing a capture before acknowledging it.
  --    `sha256()` is core Postgres; `digest()` would need pgcrypto to be on the
  --    search_path, which is not guaranteed here.
  insert into public.erasure_stub (id, subject_kind, content_sha256, occurred_at)
  select 'er-' || co.id, 'change_order',
         encode(sha256(convert_to(coalesce(co.scope, ''), 'UTF8')), 'hex'),
         co.created_at
    from public.change_order co
   where co.owner_id = uid
  on conflict (id) do nothing;
  get diagnostics n_co = row_count;

  insert into public.erasure_stub (id, subject_kind, content_sha256, occurred_at)
  -- `inserted_at`, not `created_at`: `capture` has no such column, and the mistake
  -- survives a syntax check — plpgsql resolves table columns at first EXECUTION, so it
  -- would have surfaced as an error the first time somebody deleted their account.
  select 'er-' || c.id, 'capture', c.payload_sha256, c.inserted_at
    from public.capture c
   where c.owner_id = uid
  on conflict (id) do nothing;
  get diagnostics n_cap = row_count;

  -- 2. THE CONTENT, children before parents. Explicit rather than relying on cascade:
  --    most of these tables carry `capture_id` as plain text with NO foreign key, so
  --    deleting the capture would orphan them, not remove them.

  -- counterparty-facing, keyed by the confirmation token
  delete from public.approval_photo          where token = any(toks);
  delete from public.confirmation_reply      where token = any(toks);  -- media cascades
  delete from public.confirmation_question   where token = any(toks);
  delete from public.confirmation_open       where token = any(toks);
  delete from public.confirmation_response   where token = any(toks);
  delete from public.signing_otp             where token = any(toks);

  -- the extra and everything hanging off it
  delete from public.approval
   where change_order_id = any(cos) or decision_id = any(decs);
  delete from public.change_order_reminder   where owner_id = uid;
  delete from public.extra_work_authorization where owner_id = uid;
  delete from public.extra_actor             where owner_id = uid;
  -- Comments this person wrote on SOMEBODY ELSE'S extra are theirs too: the row
  -- carries their name and their words. Scoped by author, not by ownership.
  delete from public.co_comment
   where author_id = uid or change_order_id = any(cos);

  -- capture-scoped
  delete from public.capture_note            where owner_id = uid;
  delete from public.capture_transcript      where owner_id = uid;
  delete from public.capture_structured      where owner_id = uid;
  delete from public.capture_tag             where owner_id = uid;
  delete from public.capture_content_signal  where owner_id = uid;
  delete from public.capture_discarded       where owner_id = uid;
  delete from public.capture_op_state        where owner_id = uid;
  delete from public.attachment              where owner_id = uid;
  delete from public.processing_job          where owner_id = uid;

  -- decision history
  delete from public.decision_version        where decision_id = any(decs);

  -- project-scoped
  delete from public.scope_boundary          where owner_id = uid;
  delete from public.project_party           where owner_id = uid;
  delete from public.project_approver        where owner_id = uid;

  -- the parents, in dependency order: change_order -> decision, capture -> project
  delete from public.confirmation_request    where owner_id = uid;
  delete from public.change_order            where owner_id = uid;
  delete from public.decision                where owner_id = uid;
  delete from public.capture                 where owner_id = uid;
  delete from public.project                 where owner_id = uid;

  -- the person
  delete from public.push_token              where user_id = uid;
  delete from public.notification_outbox     where user_id = uid;
  delete from public.contractor_profile      where user_id = uid;

  -- 3. MEMBERSHIP is revoked, not deleted. A company's roster history is the COMPANY's
  --    record of who worked there, not this person's to erase — but the display_name
  --    is the personal part of it, so that goes.
  update public.company_member
     set status = 'revoked', display_name = null
   where user_id = uid;

  -- 4. A company this person owned, that nobody else is in, has nothing left to be.
  delete from public.company_invite ci
   where ci.company_id in (
     select c.id from public.company c
      where c.owner_id = uid
        and not exists (select 1 from public.company_member m
                         where m.company_id = c.id and m.status = 'active'));
  delete from public.company c
   where c.owner_id = uid
     and not exists (select 1 from public.company_member m
                      where m.company_id = c.id and m.status = 'active');

  -- 5. THE GUARDS GO BACK ON, before the function returns and therefore before the
  --    transaction commits. Not in an exception handler, because there is nothing to
  --    handle: a raise here rolls back the disable along with the deletes.
  foreach g in array guards loop
    execute format('alter table public.%I enable trigger %I',
                   split_part(g, ':', 1), split_part(g, ':', 2));
  end loop;

  -- 6. THE `*_mutation` JOURNALS ARE KEPT, ON PURPOSE. They hold a mutation_id and a
  --    timestamp — no content, no name, nothing personal. Keeping them is not a gap in
  --    the erasure, it is what makes it hold: a device that still has queued outbox
  --    rows will retry after the account is closed, and the journal is what turns each
  --    retry into a no-op instead of resurrecting the row that was just destroyed.

  return jsonb_build_object('ok', true, 'change_orders', n_co, 'captures', n_cap);
end $$;

revoke all on function public.close_my_account from public, anon;
grant execute on function public.close_my_account to authenticated;
