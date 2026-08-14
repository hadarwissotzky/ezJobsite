-- 398 — photos on a message.
--
-- hadar, 2026-08-09: "if an image is to be added to the conversation then it should
-- be a simple image(s) from the camera not the change order special addition — and
-- it should add the image to the message".
--
-- A thread reply is not a contractor-side note: it lands in `confirmation_reply` and
-- renders on the homeowner's no-login page. So a photo sent into that conversation
-- has to reach the homeowner, and this is the row that lets it.
--
-- ─── shaped after 304_approval_photos.sql, deliberately ─────────────────────────
-- Same frozen-URL model: the DEVICE mints the signed URL, because the anon page
-- holds no rights to the object and Postgres cannot sign a Storage URL. Same
-- two-URL pair (a transformed one for load speed, the untransformed original as the
-- fallback when the transform tier 400s). Same create-only idempotency.
--
-- ─── what it deliberately does NOT do ───────────────────────────────────────────
-- It does not gate on whether the client has answered. 304 refuses to attach a photo
-- once a signature exists, because a photo appearing beside a signature that was not
-- there when it was given breaks mandate #5. A MESSAGE photo is not part of the
-- instrument — it is part of the conversation, which continues after an answer and
-- is timestamped per message. Freezing it to the pre-signature window would silently
-- drop pictures from a live discussion.

create table if not exists public.confirmation_reply_media (
  id           bigint generated always as identity primary key,
  -- The reply this belongs to. Device-authored id, same as confirmation_reply.id,
  -- so this insert is idempotent without consulting the mutation ledger.
  reply_id     text not null references public.confirmation_reply(id) on delete cascade,
  -- The capture behind it. Carried so the contractor's device can match a server row
  -- to the file it still holds, and so a bundle export can name the evidence.
  capture_id   text not null,
  -- Order shot, authored by the device.
  seq          integer not null,
  -- Frozen signed URLs. `url` is resized for page load, `fallback_url` is the
  -- original object; the page swaps on error.
  url          text not null,
  fallback_url text not null,
  bytes        bigint,
  created_at   timestamptz not null default now(),
  unique (reply_id, capture_id)
);

create index if not exists confirmation_reply_media_by_reply
  on public.confirmation_reply_media (reply_id, seq);

alter table public.confirmation_reply_media enable row level security;
-- No policy: every read goes through the SECURITY DEFINER functions below, exactly
-- like confirmation_reply itself. A table anon can select directly is a table anon
-- can enumerate.

-- ── the write path ───────────────────────────────────────────────────────────────
--
-- Owner-scoped through the reply's author. `confirmation_reply.author_id` is the
-- contractor who wrote it, so a caller can only attach pictures to their own words —
-- stated here rather than inherited, because SECURITY DEFINER bypasses RLS (the
-- lesson 260 wrote down and 397 had to re-learn).
create or replace function public.reply_media_attach_v1(p_media jsonb)
  returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare n int := 0;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  with incoming as (
    select (m->>'reply_id')::text    as reply_id,
           (m->>'capture_id')::text  as capture_id,
           (m->>'seq')::int          as seq,
           (m->>'url')::text         as url,
           (m->>'fallback_url')::text as fallback_url,
           nullif(m->>'bytes','')::bigint as bytes
      from jsonb_array_elements(coalesce(p_media, '[]'::jsonb)) m
  ), allowed as (
    select i.* from incoming i
      join public.confirmation_reply r on r.id = i.reply_id
     where r.author_id = auth.uid()
  ), ins as (
    insert into public.confirmation_reply_media
      (reply_id, capture_id, seq, url, fallback_url, bytes)
    select reply_id, capture_id, seq, url, fallback_url, bytes from allowed
    on conflict (reply_id, capture_id) do nothing
    returning 1
  )
  select count(*) into n from ins;

  return jsonb_build_object('inserted', n);
end $$;

revoke all on function public.reply_media_attach_v1 from public, anon;
grant execute on function public.reply_media_attach_v1 to authenticated;

-- ── the read path ────────────────────────────────────────────────────────────────
--
-- `confirmation_thread` gains a `media` array on contractor rows. Replaced whole
-- rather than patched: it is one function with two branches (a priced extra walks
-- its lineage, a bare decision does not) and editing one branch is how the two
-- silently stop agreeing.
--
-- The client rows carry an EMPTY array, not null — the page maps over it either way,
-- and a null that has to be guarded at every call site is how a blank thread happens.
create or replace function public.confirmation_thread(p_token text)
  returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare co text;
        out jsonb;
begin
  select change_order_id into co
    from public.confirmation_request where token = p_token;
  if not found then return '[]'::jsonb; end if;

  if co is null then
    select coalesce(jsonb_agg(x order by x->>'at'), '[]'::jsonb) into out from (
      select jsonb_build_object('side','client','body',q.note,'at',q.asked_at,
                                'media','[]'::jsonb) as x
        from public.confirmation_question q where q.token = p_token
      union all
      select jsonb_build_object('side','contractor','body',r.body,'at',r.written_at,
                                'media', public.reply_media_json(r.id))
        from public.confirmation_reply r where r.token = p_token
    ) s;
    return out;
  end if;

  select coalesce(jsonb_agg(x order by x->>'at'), '[]'::jsonb) into out from (
    select jsonb_build_object('side','client','body',q.note,'at',q.asked_at,
                              'media','[]'::jsonb) as x
      from public.confirmation_question q
      join public.confirmation_request cr on cr.token = q.token
     where cr.change_order_id in (select id from public.change_order_lineage(co))
    union all
    select jsonb_build_object('side','contractor','body',r.body,'at',r.written_at,
                              'media', public.reply_media_json(r.id))
      from public.confirmation_reply r
      join public.confirmation_request cr2 on cr2.token = r.token
     where cr2.change_order_id in (select id from public.change_order_lineage(co))
  ) s;
  return out;
end $$;

-- One reply's pictures, ordered. Split out so both branches above use the SAME
-- expression — the thing that went wrong the last time this function had two
-- branches maintained side by side.
create or replace function public.reply_media_json(p_reply_id text)
  returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'url', m.url, 'fallback_url', m.fallback_url, 'bytes', m.bytes
         ) order by m.seq), '[]'::jsonb)
    from public.confirmation_reply_media m
   where m.reply_id = p_reply_id;
$$;

-- NO GRANT. `confirmation_thread` is SECURITY DEFINER, so it calls this as the
-- function owner and needs no privilege of the caller's. Granting it to anon would
-- hand the client's page a way to read any reply's media by id, outside the token
-- check that is the only thing standing between one client and another's job.
revoke all on function public.reply_media_json from public, anon, authenticated;

revoke all on function public.confirmation_thread from public;
grant execute on function public.confirmation_thread to anon, authenticated;
