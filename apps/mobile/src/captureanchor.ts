/**
 * WHICH CAPTURE A CHANGE ORDER HANGS OFF — the one definition.
 *
 * WHY THIS IS A FUNCTION AND NOT AN INDEX (Codex review, 2026-09-03, CRITICAL).
 *
 * It used to be `ids[photos.length]`, computed inline. That is not a lookup, it is an
 * ASSUMPTION about the order things were pushed — photos first, audio second. On
 * 2026-09-02 typed text was added to the commit loop BETWEEN them (App.tsx, "you can
 * talk — or you can write"), and the assumption became false without a single line of
 * the arithmetic changing.
 *
 * WHAT THAT BREAKS, when a contractor speaks, takes photos, and then types a correction:
 *
 *   · The anchor lands on the TEXT capture. `startExtraFromCapture` hangs the change
 *     order off it and the id becomes `co-<textCaptureId>`.
 *   · Text is NOT linked into `capture_pair` — the table's CHECK allows only
 *     ('photo','voice') — so the record's evidence walk starts from a capture with no
 *     siblings and finds NOTHING. The voice and every photo drop off the record.
 *   · `transcribeOnDevice` is handed the text artifact's path as though it were M4A.
 *
 * So the one feature that exists to let a man FIX a bad transcript was the feature that
 * detached his evidence from his change order.
 *
 * The rule, stated instead of computed: the anchor is the FIRST VOICE capture when there
 * is one, because the pair walk must reach the photos and only a paired capture can
 * start that walk. Failing that, the first PHOTO. Text is the anchor of last resort —
 * only when it is the only thing there is, where a walk that finds nothing is the truth.
 */
export type AnchorInput = {
  /** Photo capture ids, in the order committed. */
  photoIds: readonly string[];
  /** Voice capture ids, one per segment, in order. */
  voiceIds: readonly string[];
  /** The typed-text capture id, when he typed something. */
  textId: string | null;
};

export type Anchor = {
  /** The capture the extra hangs off. Null when nothing was captured at all. */
  captureId: string | null;
  /**
   * The VOICE anchor specifically — null when this walkthrough had no audio.
   * Callers use it for two things that are only true of voice: waiting on a
   * transcript, and naming the extra from the first sentence spoken.
   */
  voiceCaptureId: string | null;
};

export function pickAnchor(a: AnchorInput): Anchor {
  const voice = a.voiceIds[0] ?? null;
  // Never the text capture while a paired capture exists: the walk has to start
  // somewhere it can reach the rest of the evidence.
  const captureId = voice ?? a.photoIds[0] ?? a.textId ?? null;
  return { captureId, voiceCaptureId: voice };
}
