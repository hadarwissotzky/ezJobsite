-- Segment timestamps on transcripts — the narration TIMELINE.
--
-- Whisper has been returning per-segment start/end times all along (the worker asks
-- for verbose_json); we were discarding them. They are what lets a photo taken
-- mid-walkthrough be tied to the SENTENCE being spoken when the shutter fired —
-- "here's the kitchen… [snap]" — which is how a walkthrough's photos get tagged and
-- organised by what was said, not just when.
--
-- Format: jsonb array of {s, e, t} — start sec, end sec, text — relative to the
-- start of that audio file. Nullable: old rows predate it, and a transcript with no
-- segments still carries its text. ALTER, not a new table: the segments are facts
-- about THIS transcription run, not a new kind of record. capture_transcript stays
-- append-only; a row is inserted with its segments and never updated.

alter table public.capture_transcript
  add column if not exists segments jsonb;
