/**
 * AMENDING THE SCOPE OF WORK ON AN EDIT — the proposal, not the act.
 *
 * hadar, 2026-08-23: *"this is not a complete redo — this is an augmentation and
 * amendment. we take the scope of work and the audio (if exists transcription) and we
 * amend the scope of work if necessary"*.
 *
 * What an edit does today: `finishAugmentById` appends the new words to the SUMMARY as
 * an append-only addendum and deliberately never touches `scope_of_work`. That was the
 * right default while the scope could only be regenerated from scratch — a regeneration
 * is a redo, and a redo of the binding text is exactly what must not happen. What was
 * missing is the third option: read the scope that exists, read what he just said, and
 * propose the amended scope.
 *
 * ─── THIS TABLE STORES A PROPOSAL, AND THE DISTINCTION IS THE WHOLE DESIGN ──────
 * `change_order.scope_of_work` is what the client is asked to approve. MANDATE #2:
 * anything carrying a commitment gets a mandatory human confirmation before it commits.
 * So the model's amended text lands HERE, beside the capture that prompted it, and the
 * contractor sees both versions and accepts or rejects. Nothing in this migration ever
 * writes `change_order`.
 *
 * ─── AND ONLY WHILE THE EXTRA IS A DRAFT ────────────────────────────────────────
 * Once an extra is sent, `scope_of_work` is the frozen instrument the signature is taken
 * against (`SPEC-extra-lifecycle-v1.md`, and mandate #1's "an approved record is frozen
 * and permanent"). The worker refuses to propose an amendment for anything past draft,
 * and the app refuses to apply one; a sent extra keeps the append-only addendum it has
 * always had. Two guards for one rule, because a single guard on a rule this size is a
 * rule waiting to be routed around.
 *
 * ─── WHY COLUMNS ON capture_structured RATHER THAN A NEW TABLE ──────────────────
 * The amendment IS a structured reading of one capture's transcript — the same object
 * `structure` already produces, answering a second question about the same words. It
 * inherits that table's append-only trigger and its RLS unchanged, and the app reads it
 * through `fetchLatestProposalForCaptures`, which already selects this row.
 */

alter table public.capture_structured
  /* The full amended scope of work, rendered, ready to show beside the current one.
     NULL means the model was not asked or had nothing to add — see `amend_status`. */
  add column if not exists proposed_amended_scope text,

  /* Why there is (or is not) an amendment, in the model's own words and in one line.
     Shown to the contractor under the proposal: "you added two outlets in 3B". A
     proposal a man cannot see the reason for is a proposal he will accept blindly. */
  add column if not exists amend_reason text,

  /* What the amend step concluded. NULL for every row written before this migration
     and for every capture the step never ran on.
       'amended'    — proposed_amended_scope holds new text to offer.
       'no_change'  — the model read both and the scope already covers what was said.
                      Recorded rather than left NULL so "we looked and it was fine" is
                      distinguishable from "we never looked".
       'not_draft'  — the extra is past draft; the scope is frozen and was not touched.
       'no_scope'   — there is no scope of work yet to amend.
       'no_words'   — nothing was said on this capture. */
  add column if not exists amend_status text
    check (amend_status is null or amend_status in
           ('amended','no_change','not_draft','no_scope','no_words'));

/**
 * THE STEP LIST LIVES IN 140, NOT HERE.
 *
 * `enqueue_processing` is 140's object, and `check-sql-duplicates.mjs` calls a second
 * definition FATAL for a reason worth restating: an object defined in two files depends
 * on the order someone happened to run them in, and the loser is silent. So 140 carries
 * the `amend_scope` entry and 140 is the file to re-run for it.
 *
 * WHICH MEANS THIS MIGRATION IS TWO FILES: apply 420 for the columns, then re-apply
 * 140 for the step. 420 alone gives you the storage and a step nothing enqueues.
 */
