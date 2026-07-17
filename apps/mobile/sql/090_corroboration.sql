-- Server corroboration of the evidence stamp — REQ-TL5.
--
-- WHAT I MISSED: REQ-TL5 says the stamp is "device-attested (from the device
-- clock/GPS, which are user-alterable offline) and CORROBORATED BY A TRUSTED
-- SERVER TIMESTAMP ON SYNC -- *not* claimed as tamper-proof while offline."
--
-- I built the device attestation and called mandate #9 done. The corroboration
-- half was never built. That matters: a device clock is trivially changed in
-- Settings, so `captured_at` alone is a CLAIM. What makes it evidence is a second
-- timestamp the device could not touch -- the server's -- and the relationship
-- between them.
--
-- WHAT THE PAIR ACTUALLY ESTABLISHES, stated precisely because this is the line
-- people overstate:
--   * The capture existed NO LATER THAN the server saw it. That is a real upper
--     bound and the device cannot forge it.
--   * It does NOT establish the capture happened WHEN the device said. An offline
--     device can claim any earlier time.
--   * So: a small gap corroborates. A large gap is NOT proof of dishonesty --
--     offline-first means a week in a basement is normal and expected. It means
--     the device's claim carries the weight, and the reader should know that.
--
-- This view says which of those applies, per capture, instead of leaving a reader
-- to assume the strongest reading.

create or replace view public.capture_corroboration as
select
  c.id,
  c.project_id,
  c.owner_id,
  c.modality,
  -- What the DEVICE says. User-alterable offline. A claim.
  c.client_created_at as device_claimed_at,
  -- What the SERVER saw. The device never touches this clock.
  c.inserted_at       as server_observed_at,
  extract(epoch from (c.inserted_at - c.client_created_at)) as sync_lag_seconds,

  case
    -- A device clock ahead of the server is the one genuinely suspicious shape:
    -- the capture claims to be from a future the server has not reached.
    when c.client_created_at > c.inserted_at + interval '2 minutes'
      then 'device_clock_ahead_of_server'
    -- Arrived while the claim was still fresh: the two clocks agree, and the
    -- server's independent observation backs the device's story.
    when c.inserted_at - c.client_created_at < interval '5 minutes'
      then 'corroborated_tight'
    when c.inserted_at - c.client_created_at < interval '24 hours'
      then 'corroborated_same_day'
    -- NOT an accusation. Offline-first is the product; a week with no signal is a
    -- Tuesday. It means only the device attests to the time.
    else 'device_attested_only'
  end as corroboration,

  case
    when c.client_created_at > c.inserted_at + interval '2 minutes'
      then 'The device claimed a time LATER than when the server received it. The device clock was wrong or was changed.'
    when c.inserted_at - c.client_created_at < interval '5 minutes'
      then 'The server received this within minutes of the time the device claimed, which independently supports it.'
    when c.inserted_at - c.client_created_at < interval '24 hours'
      then 'The server received this the same day the device claimed it was captured.'
    else 'This was captured offline and uploaded later. The server can only establish it existed by the time it arrived; the capture time itself rests on the device''s clock.'
  end as what_this_means
from public.capture c;

grant select on public.capture_corroboration to authenticated;

-- The bundle must carry this, or it repeats the overstatement in the artefact
-- that matters most. Rebuilt to add the corroboration pair per capture and a
-- fifth limitation naming the boundary in plain words.
create or replace function public.bundle_limitations()
returns jsonb language sql immutable as $$
  select jsonb_build_array(
    'Locations and timestamps come from the capturing device''s operating system. '
    || 'They are evidence of what that device recorded at the time, corroborated by '
    || 'content hashes and an append-only history. They are NOT proof against a '
    || 'modified device or a deliberately falsified GPS signal.',

    'Each capture shows two times: the time the DEVICE claimed, and the time the '
    || 'SERVER received it. The server''s time cannot be altered from the device. '
    || 'Where the two are close, they corroborate each other. Where a capture was '
    || 'taken offline and uploaded later, the server can only establish that it '
    || 'existed by the time it arrived -- the capture time itself rests on the '
    || 'device''s clock, which a person can change. A long gap is normal for work '
    || 'done without signal and is NOT evidence of anything improper.',

    'Approval links require no login: the token in the link is the credential. '
    || 'An approval records an identity SIGNAL (a code sent to the phone number the '
    || 'contractor entered, plus a typed legal name and timestamp) -- not proof of '
    || 'who was holding the phone.',

    'Captures recorded before a device had location permission, or with no GPS fix '
    || 'available, carry no location. Those records say so explicitly and cannot be '
    || 'backfilled, because the history is append-only.',

    'Where this shows that nobody was assigned a piece of work, that means NOBODY '
    || 'RECORDED AN ASSIGNMENT IN THIS APP -- not that no agreement existed. Work is '
    || 'assigned in conversations, contracts and drawings this app never saw. An '
    || 'unowned item here is a question to ask, not a finding.',

    'This bundle is assembled from records; it is not a legal opinion, and nothing '
    || 'in it has been reviewed by a lawyer.'
  )
$$;
