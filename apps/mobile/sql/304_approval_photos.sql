-- R4 — the photos the client sees before they sign, frozen against the token.
--
-- PRD R4: "0-8 photos per extra ... compressed for SMS-link load speed."
-- AC:     "Given photos attached, when the homeowner opens the link, then photos
--          load in <=3s on LTE."
--
-- Before this file the homeowner half of R4 did not exist: `confirm.html` contained
-- no <img> at all and the confirmation payload had no photo field. The contractor
-- could attach eight photos to an extra and the person being asked for $1,850 saw
-- none of them.
--
-- ─── WHAT IS FROZEN, AND WHY IT MATTERS HERE ────────────────────────────────────
-- Mandate #5 says the rendered thing the signer saw is the binding instrument. A
-- photo of the cracked joist IS part of what they saw; it is frequently the whole
-- reason they said yes. So this table is treated exactly like `shown_content`:
--   * append-only  -- no UPDATE, no DELETE, ever (mandate #1, evidence is append-only)
--   * closed on answer -- attach is refused the moment a response row exists, so a
--     photo can never appear beside a signature that was given without it
-- The gap that leaves is named honestly: between confirmation_create and the moment
-- the client answers, photos CAN still be added. That window exists because the
-- attach is a second round trip (this file may not edit the confirmation RPCs, which
-- 200_priced_approval.sql owns). Adding is bounded and one-directional -- nothing the
-- signer saw can ever be removed or altered -- but the airtight version attaches
-- inside `confirmation_create`'s transaction. See `integration_steps`.
--
-- ─── WHY SIGNED URLS ARE STORED, RATHER THAN OBJECT KEYS ────────────────────────
-- The page is opened by `anon` with no account. anon cannot be given read on the
-- `captures` bucket -- 011_storage_policies.sql scopes reads to the OWNER, and
-- widening that to anon would expose every jobsite photo in the system to anyone
-- holding the public anon key. And Postgres cannot mint a Storage signature: the
-- signing secret is not in the database.
--
-- So the URL is minted on the CONTRACTOR's device, where the rights already exist,
-- and stored. The URL is the capability, scoped to one object and expiring at 45
-- days -- narrower and shorter-lived than any policy change would be.
-- The trade, stated plainly rather than dressed up: whoever holds the URL can fetch
-- that one photo until it expires. That is the same trade the token itself makes
-- (REQ-VAL3: the link IS the credential), applied to the images on the page.

create table if not exists public.approval_photo (
  token       text not null references public.confirmation_request(token),
  -- Position on the page, dense from 0. PRD R4's cap lives here as a CHECK and not
  -- only in the app: a product rule that only one screen enforces is a rule you can
  -- forget to apply, and this one governs how much a client has to read before they
  -- can answer.
  seq         integer not null check (seq >= 0 and seq < 8),

  -- Which capture this is, so a disputed photo can be traced back to the append-only
  -- commitment record and its GPS stamp. Not a foreign key: `capture_commit` is
  -- DEVICE-LOCAL by design (see capture.ts) and the server's `capture` table is a
  -- replaceable projection of it. A FK here would make attaching a photo depend on
  -- the upload queue having drained, and mandate #7 forbids that kind of precondition.
  capture_id  text not null,

  -- What the page loads first: a Storage signed URL carrying a resize+quality
  -- transform. This is the "compressed for SMS-link load speed" half of R4.
  url         text not null check (length(url) > 0),
  -- The same object, untransformed. The image transformer is a storage-tier feature
  -- that can refuse; the page falls back to this rather than showing a broken tile.
  fallback_url text,

  -- true  -> the page fetches it with the document (above the fold)
  -- false -> loading="lazy": not fetched until the client scrolls to it.
  -- Which is which is decided by src/approvalphotos.ts against a stated LTE byte
  -- budget, and that is the mechanism the <=3s AC actually rests on.
  eager       boolean not null default false,

  bytes       bigint,
  captured_at_ms bigint,
  attached_at timestamptz not null default now(),

  primary key (token, seq)
);

-- Append-only. Same rule as confirmation_response, for the same reason: this is
-- evidence of what was put in front of the signer, and evidence you can edit after
-- the fact is not evidence.
--
-- A separate function from 020's `confirmation_no_change()` on purpose -- reusing that
-- one would make 020 and this file co-own it, which is the exact failure
-- scripts/check-sql-duplicates.mjs exists to catch.
create or replace function public.approval_photo_no_change() returns trigger
  language plpgsql as $$ begin
    raise exception 'approval photos are append-only evidence: % blocked', tg_op;
  end $$;

drop trigger if exists approval_photo_frozen on public.approval_photo;
create trigger approval_photo_frozen before update or delete
  on public.approval_photo for each row execute function public.approval_photo_no_change();

alter table public.approval_photo enable row level security;

-- The sender can read back what they attached (the record screen shows it). Nobody
-- reads this table as anon -- the page goes through confirmation_photos() below.
drop policy if exists ap_own on public.approval_photo;
create policy ap_own on public.approval_photo for select to authenticated
  using (exists (select 1 from public.confirmation_request cr
                  where cr.token = approval_photo.token and cr.owner_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- Attach — contractor only, before the client answers.
-- ---------------------------------------------------------------------------
create or replace function public.approval_photos_attach(p_token text, p_photos jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.confirmation_request%rowtype; n integer;
begin
  if jsonb_typeof(p_photos) is distinct from 'array' then
    raise exception 'p_photos must be a json array' using errcode = '22023';
  end if;
  -- PRD R4's cap, enforced server-side as well as in the app. Refuse the whole batch
  -- rather than silently keeping the first eight: a caller that sent nine has a bug,
  -- and quietly dropping one of a client's photos is the kind of loss mandate #1 is
  -- about.
  if jsonb_array_length(p_photos) > 8 then
    raise exception 'an extra carries at most 8 photos' using errcode = '23514';
  end if;

  select * into r from public.confirmation_request where token = p_token;
  if not found then
    raise exception 'unknown token' using errcode = '42501';
  end if;
  -- security definer bypasses RLS, so ownership is checked explicitly. Without this
  -- any authenticated user could staple images onto anyone else's approval page.
  if r.owner_id is distinct from auth.uid() then
    raise exception 'only the sender can attach photos to their own request'
      using errcode = '42501';
  end if;
  if exists (select 1 from public.confirmation_response where token = p_token) then
    raise exception 'the approval instrument is frozen: photos cannot change after the client has answered'
      using errcode = '23514', hint = 'photos_frozen';
  end if;

  -- `do nothing`, never `do update`: the table is append-only and a retry after a
  -- dropped connection must be a no-op, not an overwrite. Same contract as the
  -- capture outbox -- losing the upload is fine, changing the record is not.
  insert into public.approval_photo
    (token, seq, capture_id, url, fallback_url, eager, bytes, captured_at_ms)
  select p_token,
         (e->>'seq')::integer,
         e->>'capture_id',
         e->>'url',
         e->>'fallback_url',
         coalesce((e->>'eager')::boolean, false),
         nullif(e->>'bytes','')::bigint,
         nullif(e->>'captured_at_ms','')::bigint
    from jsonb_array_elements(p_photos) e
  on conflict (token, seq) do nothing;
  get diagnostics n = row_count;

  return jsonb_build_object('status', 'ok', 'inserted', n);
end $$;
revoke all on function public.approval_photos_attach(text, jsonb) from public, anon;
grant execute on function public.approval_photos_attach(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Read — the no-login page. anon, like confirmation_fetch.
-- ---------------------------------------------------------------------------
-- A SEPARATE function rather than more fields on confirmation_fetch, deliberately:
-- confirmation_fetch is owned by 200_priced_approval.sql and has already been
-- redefined once across files, which cost this repo real bugs. A second small
-- function costs the page nothing -- it is fetched in the SAME Promise.all as the
-- existing two calls, so it adds zero round trips to the client's 3 seconds.
create or replace function public.confirmation_photos(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.confirmation_request%rowtype;
begin
  select * into r from public.confirmation_request where token = p_token;
  -- An empty list, not an error. The page must render the approval whether or not
  -- there are photos; a bad token is already reported by confirmation_fetch and
  -- saying it twice would just give the page two ways to disagree with itself.
  if not found then return jsonb_build_object('status','not_found','photos', '[]'::jsonb); end if;
  if now() > r.expires_at then return jsonb_build_object('status','expired','photos','[]'::jsonb); end if;

  -- Returned even after the client has answered: re-opening the link shows what was
  -- signed, and the photos are part of that.
  return jsonb_build_object(
    'status', 'ok',
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'seq', ap.seq, 'url', ap.url, 'fallback_url', ap.fallback_url,
               'eager', ap.eager, 'captured_at_ms', ap.captured_at_ms
             ) order by ap.seq)
        from public.approval_photo ap where ap.token = p_token), '[]'::jsonb)
  );
end $$;
revoke all on function public.confirmation_photos(text) from public;
grant execute on function public.confirmation_photos(text) to anon, authenticated;
