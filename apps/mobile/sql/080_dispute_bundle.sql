-- Dispute bundle — §7.3 / EVID-3.
--
-- THIS IS WHAT EVERYTHING ELSE WAS FOR. Every append-only trigger, every frozen
-- shown_content, every GPS stamp and media hash exists for one moment: someone
-- says "I never agreed to that" and a contractor has to answer. The product's
-- stated purpose is to "protect contractors and subcontractors from
-- miscommunication and errors". This is the artefact that does the protecting.
--
-- WHAT MAKES A BUNDLE WORTH ANYTHING:
--
-- 1. IT ASSEMBLES, IT NEVER RE-RENDERS. Every value here is read from the row it
--    was written to. shown_content is the frozen text the signer actually saw --
--    NOT the change order re-rendered as it stands today. A bundle that
--    regenerates its own evidence is worthless in the only moment it is used.
--
-- 2. IT SHOWS THE WHOLE CHAIN, INCLUDING THE INCONVENIENT PARTS. Superseded
--    decision values are included, not filtered out. "The colour was white, then
--    off-white, then grey" IS the evidence -- hiding the changes would make the
--    bundle an argument rather than a record, and an argument that has been
--    tidied is worth less than a record that has not.
--
-- 3. IT STATES ITS OWN LIMITS. See bundle_limitations(). A bundle that overclaims
--    gets a contractor humiliated by the first person who asks what it actually
--    proves.

create or replace function public.bundle_limitations()
returns jsonb language sql immutable as $$
  select jsonb_build_array(
    'Locations and timestamps come from the capturing device''s operating system. '
    || 'They are evidence of what that device recorded at the time, corroborated by '
    || 'content hashes and an append-only history. They are NOT proof against a '
    || 'modified device or a deliberately falsified GPS signal.',

    'Approval links require no login: the token in the link is the credential. '
    || 'An approval records an identity SIGNAL (a code sent to the phone number the '
    || 'contractor entered, plus a typed legal name and timestamp) -- not proof of '
    || 'who was holding the phone.',

    'Captures recorded before a device had location permission, or with no GPS fix '
    || 'available, carry no location. Those records say so explicitly and cannot be '
    || 'backfilled, because the history is append-only.',

    'This bundle is assembled from records; it is not a legal opinion, and nothing '
    || 'in it has been reviewed by a lawyer.'
  )
$$;

/**
 * Everything known about one project's decisions and money, in one document.
 * SECURITY DEFINER + an explicit owner check: a dispute bundle is the most
 * sensitive artefact this system produces, and it must never be assemblable for
 * a project the caller does not own.
 */
create or replace function public.dispute_bundle(p_project_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb; owner uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select p.owner_id into owner from public.project p where p.id = p_project_id;
  if not found then raise exception 'no such project' using errcode = '42501'; end if;
  if owner is distinct from auth.uid() then
    raise exception 'not your project' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'bundle_version', 1,
    'project_id', p_project_id,
    'assembled_at', now(),

    -- READ THIS FIRST. Placed at the top of the document on purpose: a reader
    -- meets the limits before the evidence, not after they have over-relied on it.
    'limitations', public.bundle_limitations(),

    -- The decisions, WITH their full history. Superseded values included.
    'decisions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id,
        'subject', d.subject,
        'current_value', (select v.value from public.decision_version v
                           where v.decision_id = d.id
                           order by v.created_at_ms desc limit 1),
        -- The inconvenient part, kept. This is the evidence, not noise.
        'history', (select jsonb_agg(jsonb_build_object(
                        'value', v2.value,
                        'directed_by', v2.directed_by,
                        'at', to_timestamp(v2.created_at_ms / 1000.0),
                        'from_capture', v2.capture_id)
                        order by v2.created_at_ms desc)
                      from public.decision_version v2 where v2.decision_id = d.id)
      ) order by d.created_at_ms)
      from public.decision d where d.project_id = p_project_id), '[]'::jsonb),

    -- The money, and exactly what was signed for it.
    'change_orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', co.id,
        'decision_id', co.decision_id,
        'scope', co.scope,
        'amount', public.money_str(co.amount_cents, co.currency),
        'amount_cents', co.amount_cents,
        'nte', public.money_str(co.nte_cents, co.currency),
        'line_items', co.line_items,
        'lines_sum_cents', public.line_items_sum(co.line_items),
        -- Stated per row rather than assumed: a reader should not have to add up
        -- the lines themselves to find out whether the document is consistent.
        'lines_agree_with_total',
          jsonb_array_length(co.line_items) = 0
          or public.line_items_sum(co.line_items) = co.amount_cents,
        'status', co.status,
        'who_directed', co.who_directed,
        'numbers_confirmed_at', co.numbers_confirmed_at,
        'created_at', co.created_at,
        'approvals', coalesce((select jsonb_agg(jsonb_build_object(
              'grade', a.grade,
              'action', a.action,
              -- THE BINDING INSTRUMENT. The frozen words the signer read.
              -- Never re-rendered from the change order as it stands now.
              'shown_content', a.shown_content,
              'shown_sha256', a.shown_sha256,
              'legal_name', a.legal_name,
              'signer_label', a.signer_label,
              'phone_e164', a.phone_e164,
              'otp_verified_at', a.otp_verified_at,
              'signed_at', a.signed_at,
              'user_agent', a.user_agent)
              order by a.signed_at)
            from public.approval a where a.change_order_id = co.id), '[]'::jsonb)
      ) order by co.created_at)
      from public.change_order co where co.project_id = p_project_id), '[]'::jsonb),

    -- What was asked of the other party, and what they said back.
    'confirmations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', cr.kind,
        'counterparty', cr.counterparty_label,
        'channel', cr.channel,
        'delivery_state', cr.delivery_state,
        'shown_content', cr.shown_content,
        'shown_sha256', cr.shown_sha256,
        'sent_at', cr.created_at,
        'response', (select jsonb_build_object('action', cx.action, 'note', cx.note,
                            'at', cx.responded_at, 'user_agent', cx.user_agent)
                       from public.confirmation_response cx where cx.token = cr.token)
      ) order by cr.created_at)
      from public.confirmation_request cr where cr.project_id = p_project_id), '[]'::jsonb),

    -- The raw evidence: what was captured, where, when, and the hash that proves
    -- the bytes in storage are the bytes that were captured.
    'captures', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'modality', c.modality,
        -- REQ-TL5: BOTH times, never just the device's claim. The pair is what
        -- makes a timestamp evidence instead of an assertion.
        'device_claimed_at', c.client_created_at,
        'server_observed_at', c.inserted_at,
        'corroboration', (select cc.corroboration from public.capture_corroboration cc where cc.id = c.id),
        'what_this_means', (select cc.what_this_means from public.capture_corroboration cc where cc.id = c.id),
        'object_key', c.payload,
        'media_sha256', c.payload_sha256,
        'location', case when c.gps_lat is not null
                    then jsonb_build_object('lat', c.gps_lat, 'lng', c.gps_lng,
                                            'accuracy_m', c.gps_accuracy_m,
                                            'fix_age_ms', c.gps_fix_age_ms)
                    else null end,
        -- Says WHY there is no location rather than leaving an unexplained hole.
        'location_status', coalesce(c.stamp_status, 'not recorded (captured before location stamping existed)')
      ) order by c.client_created_at)
      from public.capture c where c.project_id = p_project_id), '[]'::jsonb)
  ) into result;

  return result;
end $$;

revoke all on function public.dispute_bundle from public, anon;
grant execute on function public.dispute_bundle to authenticated;
