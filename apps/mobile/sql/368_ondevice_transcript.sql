-- 368: let a device append a transcript it produced itself.
--
-- WHY THIS EXISTS. R2's transcription is going hybrid: the phone recognises the
-- audio on device the moment it is recorded, and the worker re-transcribes via
-- the cloud when it gets there. The phone half was impossible because `150` does
-- `revoke insert, update, delete on capture_transcript from authenticated` --
-- correctly, since a transcript is evidence and evidence is not something a
-- client gets blanket write access to. So the write goes through a function that
-- checks ownership rather than through a grant that does not.
--
-- WHICH TRANSCRIPT IS EVIDENCE: unchanged, and deliberately so. `150` already
-- says "newest wins, history kept. Same law as decision_version", and
-- `capture_transcript_current` implements it with `distinct on (capture_id)
-- ... order by created_at desc`. On device lands in seconds, cloud lands minutes
-- later, so the cloud reading supersedes on its own. NO NEW RULE, no engine
-- ranking, no precedence table -- adding one would mean two laws for the same
-- question and this repo has been bitten by that shape before.
--
-- IS THE NUMBER ALLOWED TO CHANGE UNDER THE CONTRACTOR? Yes, and only before it
-- matters. A better transcript arriving can change the extracted price, but
-- `change_order.numbers_confirmed_at` is `not null` -- no unconfirmed number can
-- be stored, let alone sent -- and once sent, `shown_content` is frozen and is
-- the binding instrument. So a late cloud transcript can improve a draft and can
-- never alter something a client has seen. Mandate #6 holds.
--
-- OWNERSHIP: every object below is created only here (check-sql-duplicates).

-- The device's own reading. SECURITY DEFINER because the caller is
-- `authenticated` and 150 revoked their INSERT; the guard below is what replaces
-- that grant, and it is narrower than a grant would be -- a grant cannot check
-- whose capture it is.
create or replace function public.transcript_append_own(
  p_capture_id    text,
  p_text          text,
  p_engine        text,
  p_segments      jsonb default null,
  p_language      text  default null,
  p_engine_model  text  default null,
  p_duration_sec  double precision default null
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_id    text;
begin
  -- THE WHOLE POINT OF THE FUNCTION. Without this a caller could append a
  -- transcript to somebody else's capture, which is worse than reading one:
  -- it puts words in their evidence.
  select c.owner_id into v_owner from public.capture c where c.id = p_capture_id;
  if v_owner is null then
    raise exception 'no such capture: %', p_capture_id using errcode = '42704';
  end if;
  if v_owner is distinct from auth.uid() then
    raise exception 'not your capture' using errcode = '42501';
  end if;

  -- An empty transcript is not a transcript. Silence is a real recognition
  -- result, but storing it as evidence would make `capture_transcript_current`
  -- return a blank row that SUPERSEDES a good cloud reading under newest-wins.
  -- Refuse it here rather than let it win an argument later.
  if p_text is null or length(btrim(p_text)) = 0 then
    raise exception 'refusing to store an empty transcript' using errcode = '22023';
  end if;

  -- The engine is REQUIRED and is never defaulted. "Your app said X" -- which
  -- app, which model, which year -- is exactly the question a transcript has to
  -- answer, and a hybrid pipeline makes it sharper: two readings of the same
  -- audio disagree and the only way to say why is to know which produced which.
  if p_engine is null or length(btrim(p_engine)) = 0 then
    raise exception 'engine is required' using errcode = '22023';
  end if;

  v_id := 'tr-' || p_capture_id || '-' || p_engine || '-'
          || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS');

  -- created_at is set EXPLICITLY to clock_timestamp(), not left to the column's
  -- `default now()`. In Postgres `now()` is TRANSACTION start time, so two
  -- transcripts written in one transaction get the same timestamp, and
  -- `capture_transcript_current` -- `distinct on (capture_id) order by
  -- created_at desc` -- then picks between them arbitrarily. A test caught
  -- exactly that: a later cloud reading failed to supersede an earlier on-device
  -- one. In production the two land minutes apart in separate transactions so it
  -- would rarely bite, but "rarely picks the wrong transcript" is not a property
  -- worth shipping when the fix is one column.
  insert into public.capture_transcript
    (id, capture_id, owner_id, text, segments, source_language,
     engine, engine_model, duration_sec, created_at)
  values
    (v_id, p_capture_id, v_owner, p_text, p_segments, p_language,
     p_engine, p_engine_model, p_duration_sec, clock_timestamp());

  return v_id;
end $$;

-- anon is NOT granted: an unauthenticated caller has no auth.uid() and would
-- fail the ownership check anyway, but refusing at the grant is the honest place.
revoke all on function public.transcript_append_own from public, anon;
grant execute on function public.transcript_append_own to authenticated;
