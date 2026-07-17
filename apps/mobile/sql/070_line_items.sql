-- Line items must add up — §7.2, and mandate #6 squared.
--
-- WHY: line_items was plumbed everywhere and validated nowhere. It shipped as
-- '[]' and would have accepted anything: three lines totalling $300 on a change
-- order for $450, and the DB would have stored both happily. In a dispute that is
-- the worst possible artefact -- a document that contradicts itself, signed.
--
-- Mandate #6 says numbers are the highest-risk field. A line item is that risk
-- MULTIPLIED: every line is a qty and a unit price, each one a chance to be wrong,
-- and then a total that claims to be their sum. So the invariant is enforced here,
-- in the one place a client cannot skip:
--
--   IF there are line items, they MUST sum to amount_cents. Exactly. In integer
--   cents. No tolerance, no rounding slack -- a penny of "close enough" is a
--   rounding bug that a contractor gets to argue about on site.
--
-- Line items stay OPTIONAL. "Add 3 outlets for $450" is a complete, honest change
-- order and forcing a breakdown out of someone on a ladder would violate mandate
-- #3's touch budget to satisfy a bookkeeper who is not there.

create or replace function public.line_items_sum(items jsonb)
returns bigint language sql immutable as $$
  select coalesce(sum((i->>'total_cents')::bigint), 0)
    from jsonb_array_elements(coalesce(items, '[]'::jsonb)) i
$$;

-- Shape first: a malformed line item cannot be reasoned about, so it is refused
-- before anything tries to add it up.
create or replace function public.line_items_wellformed(items jsonb)
returns boolean language sql immutable as $$
  select coalesce(bool_and(
      i ? 'description' and i ? 'qty' and i ? 'unit_cents' and i ? 'total_cents'
      and length(coalesce(i->>'description','')) > 0
      -- integer cents only. A float here is how $0.30000000000004 gets signed for.
      and (i->>'unit_cents')  ~ '^-?[0-9]+$'
      and (i->>'total_cents') ~ '^-?[0-9]+$'
      and (i->>'qty') ~ '^[0-9]+(\.[0-9]+)?$'
      and (i->>'unit_cents')::bigint >= 0
      and (i->>'total_cents')::bigint >= 0
      and (i->>'qty')::numeric > 0
      -- qty * unit must equal the line's own total, ROUNDED THE SAME WAY the
      -- client rounds it. Otherwise a line reading "3 x $150 = $460" is storable,
      -- and every number on it is individually plausible.
      and (i->>'total_cents')::bigint
          = round((i->>'qty')::numeric * (i->>'unit_cents')::numeric)
    ), true)
  from jsonb_array_elements(coalesce(items, '[]'::jsonb)) i
$$;

alter table public.change_order drop constraint if exists change_order_line_items_shape;
alter table public.change_order add constraint change_order_line_items_shape check (
  jsonb_typeof(line_items) = 'array' and public.line_items_wellformed(line_items)
);

-- THE INVARIANT. Empty is fine (a CO need not be itemised). Non-empty must add up.
alter table public.change_order drop constraint if exists change_order_line_items_total;
alter table public.change_order add constraint change_order_line_items_total check (
  jsonb_array_length(line_items) = 0
  or public.line_items_sum(line_items) = amount_cents
);

-- The itemised view: what the money is actually made of, for §7.3 and a dispute.
create or replace view public.change_order_lines as
select co.id as change_order_id, co.project_id, co.owner_id, co.status,
       (i.ord)::int as line_no,
       i.item->>'description' as description,
       (i.item->>'qty')::numeric as qty,
       (i.item->>'unit_cents')::bigint as unit_cents,
       (i.item->>'total_cents')::bigint as total_cents,
       public.money_str((i.item->>'unit_cents')::bigint, co.currency) as unit_price,
       public.money_str((i.item->>'total_cents')::bigint, co.currency) as line_total
  from public.change_order co,
       lateral jsonb_array_elements(co.line_items) with ordinality as i(item, ord);
