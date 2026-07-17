-- Transcripts — REQ-PROC3 / REQ-PROC5.
--
-- THE APPEND-ONLY TRIGGER CAUGHT ME, and it was right.
--
-- 140_processing_jobs.sql added `source_transcript` / `source_language` as COLUMNS
-- ON `capture` and the worker tried to UPDATE them:
--     ERROR: capture is append-only (immutable evidence): UPDATE blocked
--
-- That is the third time this session I have reached for a column on an immutable
-- row for something that arrives LATER, and the third time the answer is the same:
-- a DERIVATIVE BELONGS BESIDE THE RECORD, NOT ON IT. `capture_note` (REQ-CAP3) and
-- `capture_resolution` (REQ-P3) already have exactly this shape. I did not learn
-- it; the trigger taught me again.
--
-- Why it matters beyond tidiness: REQ-PROC3 says "the original recording + source
-- transcript are retained IMMUTABLY". A transcript column would have to be
-- UPDATE-able — which either breaks the law or forces a carve-out in it. And a
-- re-transcription (a better model next year) would SILENTLY OVERWRITE what the
-- pipeline said this year, destroying the very thing a dispute needs: what we
-- believed AT THE TIME.
--
-- Append-only means a re-transcription is a NEW ROW. The old one stays. Which
-- model said what, and when, is part of the record.

create table if not exists public.capture_transcript (
  id            text primary key,
  capture_id    text not null,
  owner_id      uuid not null,
  text          text not null,
  -- REQ-PROC5: the SOURCE language, detected. Whisper returns it with the text.
  source_language text,
  -- Which model said this. A transcript with no provenance cannot be argued about
  -- ("your app said X" — which app? which model? which year?).
  engine        text not null,
  engine_model  text,
  duration_sec  double precision,
  created_at    timestamptz not null default now()
);

create index if not exists transcript_by_capture
  on public.capture_transcript (capture_id, created_at desc);

create or replace function public.transcript_append_only() returns trigger
  language plpgsql as $$ begin
    raise exception 'transcripts are append-only: re-transcribe by inserting, % blocked', tg_op;
  end $$;
drop trigger if exists transcript_immutable on public.capture_transcript;
create trigger transcript_immutable before update or delete
  on public.capture_transcript for each row execute function public.transcript_append_only();

alter table public.capture_transcript enable row level security;
drop policy if exists transcript_own on public.capture_transcript;
create policy transcript_own on public.capture_transcript for select to authenticated
  using (owner_id = auth.uid());
-- SERVER-OWNED. A client that could write a transcript could claim words that were
-- never said — the same reason processing_state is server-owned.
revoke insert, update, delete on public.capture_transcript from authenticated;

-- The current transcript: newest wins, history kept. Same law as decision_version.
create or replace view public.capture_transcript_current as
select distinct on (capture_id)
       capture_id, text, source_language, engine, engine_model, created_at
  from public.capture_transcript
 order by capture_id, created_at desc;
grant select on public.capture_transcript_current to authenticated;

-- The columns 140 added to `capture` are DEAD: they can never be written, because
-- the row is immutable. Dropping them is safe (nothing ever set them — the trigger
-- refused) and leaving them would invite the next person to try again.
alter table public.capture drop column if exists source_transcript;
alter table public.capture drop column if exists source_language;
alter table public.capture drop column if exists transcribed_at;
