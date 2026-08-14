-- 400 — "What changed", for a client looking at a revised change order.
--
-- hadar's portal design, 2026-08-09/10: the page opens with an amber banner —
-- "UPDATED AUG 9, 2026 AT 9:22 AM · This change order was updated after your
-- conversation with John" — over a three-column summary of what moved: what is not
-- included, the price, the schedule.
--
-- ─── WHY THIS EXISTS AT ALL ─────────────────────────────────────────────────────
-- REQ-LC22: a revision mints a NEW instrument and retires the old one. The client's
-- old link stops working and a new one arrives. From their side that is a second text
-- with a second document that looks almost identical to the first, and the burden of
-- spotting the difference is entirely theirs. A homeowner who cannot see what moved
-- either re-reads the whole thing or — far more likely — approves it without doing
-- so. That is the failure this banner exists to prevent, and it is the same class of
-- failure as an unread scope: a signature given without knowing what changed.
--
-- ─── THE RULE THIS FUNCTION OBEYS, STATED WHERE IT IS ENFORCED ──────────────────
-- THE DIFF IS A SUMMARY. IT IS NOT THE INSTRUMENT.
--
-- Mandate #5: the frozen `shown_content` the signer saw is the binding text. This
-- function reads the STRUCTURED COLUMNS of two versions and reports how they differ,
-- which is a navigational aid — "look here" — and nothing more. It is rendered above
-- the document, never inside it, and approving is still approving the frozen text
-- below.
--
-- The alternative — diffing `shown_content` itself and showing the client a marked-up
-- legal document — was rejected. A text diff of a rendered instrument produces
-- line-noise on any wording change, and the one thing worse than not telling somebody
-- what changed is telling them wrongly on the page where they sign.
--
-- ─── what "after your conversation" means ───────────────────────────────────────
-- Literally: were there messages on the version this one replaced. It is not a guess
-- about causation and the copy must not claim one — the client is told the
-- conversation happened and that the document then changed, which are two facts they
-- can both check, not an assertion that one caused the other.

create or replace function public.confirmation_changes_v1(p_token text)
  returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare cur   public.change_order%rowtype;
        prev  public.change_order%rowtype;
        n_ver int;
        talked boolean;
        issued timestamptz;
        fields jsonb := '[]'::jsonb;
begin
  select c.* into cur
    from public.confirmation_request cr
    join public.change_order c on c.id = cr.change_order_id
   where cr.token = p_token;
  if not found then return '{}'::jsonb; end if;

  -- The version this one REPLACED. `superseded_by` points forward (old → new), so the
  -- predecessor is the row pointing at us.
  select p.* into prev
    from public.change_order p
   where p.superseded_by = cur.id
   order by p.created_at desc
   limit 1;

  -- No predecessor: this is the original. Nothing changed, and the banner must not
  -- appear — an "updated" notice on a first issue is a lie that costs trust on the
  -- one page where trust is the product.
  if not found then return jsonb_build_object('revised', false); end if;

  select count(*) into n_ver from public.change_order_lineage(cur.id);

  -- Was anything said on the version being replaced? Both directions count: a
  -- contractor's unprompted correction is as much a reason to look as a client's
  -- question.
  select exists (
    select 1 from public.confirmation_request cr2
     where cr2.change_order_id = prev.id
       and (exists (select 1 from public.confirmation_question q where q.token = cr2.token)
         or exists (select 1 from public.confirmation_reply r where r.token = cr2.token))
  ) into talked;

  select cr3.created_at into issued
    from public.confirmation_request cr3
   where cr3.token = p_token;

  -- ── the three fields the design names, each reported only when it MOVED ────────
  --
  -- "No change" is still reported for PRICE (the design prints it), because on a
  -- revised document the absence of a price change is itself the reassurance a client
  -- is looking for. The other two are omitted when unchanged: a column reading "no
  -- change" for something they never worried about is noise.
  if coalesce(cur.exclusions,'') is distinct from coalesce(prev.exclusions,'') then
    fields := fields || jsonb_build_array(jsonb_build_object(
      'key','exclusions', 'label','Not included',
      'was', prev.exclusions, 'now', cur.exclusions));
  end if;

  fields := fields || jsonb_build_array(jsonb_build_object(
    'key','price', 'label','Price',
    'was', prev.amount_cents, 'now', cur.amount_cents,
    'was_nte', prev.nte_cents, 'now_nte', cur.nte_cents,
    'changed', (coalesce(cur.amount_cents,-1) is distinct from coalesce(prev.amount_cents,-1))
            or (coalesce(cur.nte_cents,-1) is distinct from coalesce(prev.nte_cents,-1))));

  if coalesce(cur.schedule_effect,'') is distinct from coalesce(prev.schedule_effect,'')
     or coalesce(cur.schedule_days,-1) is distinct from coalesce(prev.schedule_days,-1) then
    fields := fields || jsonb_build_array(jsonb_build_object(
      'key','schedule', 'label','Schedule',
      'was', prev.schedule_effect, 'was_days', prev.schedule_days,
      'now', cur.schedule_effect, 'now_days', cur.schedule_days));
  end if;

  -- The TITLE and the SCOPE moving is the biggest change of all, and it has no column
  -- in the design's three. Reported as its own flag so the page can say "the work
  -- itself was rewritten — read it again" instead of implying only the terms moved.
  return jsonb_build_object(
    'revised', true,
    'versions', n_ver,
    'updated_at', issued,
    'after_conversation', talked,
    'scope_rewritten',
      (coalesce(cur.scope,'') is distinct from coalesce(prev.scope,''))
      or (coalesce(cur.scope_of_work,'') is distinct from coalesce(prev.scope_of_work,'')),
    'fields', fields
  );
end $$;

revoke all on function public.confirmation_changes_v1 from public;
grant execute on function public.confirmation_changes_v1 to anon, authenticated;
