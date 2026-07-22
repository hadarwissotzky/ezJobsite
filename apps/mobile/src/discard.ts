/**
 * Discarding an extra that was never sent. The DECISIONS live here; `discardstore.ts`
 * does the deleting.
 *
 * WHY THIS IS DELICATE. Every other table in this app refuses deletion on
 * purpose: `capture_commit_no_delete`, `decision_version_no_delete`,
 * `thread_message_no_delete`, `capture_note_no_delete`, transcripts append-only.
 * Mandate #1 is "never lose a capture" and the schema takes it literally.
 *
 * THE READING THIS FILE RELIES ON, stated so it can be argued with: mandate #1
 * forbids LOSING a capture — to a crash, a failed sync, a bug, a silent cleanup.
 * An owner deliberately discarding his own draft, after being shown exactly what
 * will go, is not losing it. What must never happen is the two becoming
 * indistinguishable, which is why deletion is gated on an explicit authorisation
 * rather than on a trigger being relaxed: an accidental delete still hits the
 * same wall it always did.
 *
 * THREE THINGS THIS REFUSES, and each is a way a delete could destroy something
 * that was not the user's to destroy:
 *
 *   1. ANYTHING SENT. Once a link exists, a counterparty may have opened it,
 *      read a frozen price, and answered. That is their evidence too, and R7's
 *      `supersede` is the path for retiring it — not this.
 *   2. A CAPTURE A SIBLING STILL USES. `revision.ts` reuses `prior.decision_id`,
 *      so a revised extra SHARES its captures with the original. Deleting "the
 *      assets of this extra" would silently gut the other one. Checked per
 *      capture, never per extra.
 *   3. A DELETE THAT WAS ONLY HALF POSSIBLE. If the media is already on the
 *      server and the server cannot be reached, saying "deleted" is a lie the
 *      user cannot detect. Reported, not hidden.
 */

/** A capture considered for deletion, with the facts that decide it. */
export type CaptureRef = {
  captureId: string;
  /** How many DISTINCT extras reach this capture through their decision. */
  usedByExtras: number;
  /** Has it reached the server? Then local deletion alone is not deletion. */
  uploaded: boolean;
};

export type ExtraState = {
  status: string;
  /** A link was minted for it at some point. */
  hasLiveLink: boolean;
};

export type DiscardPlan =
  | { allowed: false; reason: 'not_found' | 'already_sent' | 'has_link' }
  | {
      allowed: true;
      /** Safe to remove: this extra is the only thing that reaches them. */
      deleteCaptures: string[];
      /** Kept, with the reason, so the confirmation can say so out loud. */
      keepCaptures: Array<{ captureId: string; why: 'shared' }>;
      /** Of the deletable ones, which need the server too. */
      needsServer: string[];
    };

/**
 * `draft` is the only status that was never sent. Deliberately a whitelist and
 * not `status !== 'sent'`: `discussing` is DERIVED from an open question on a
 * sent extra, and a blacklist would let a future status through by omission.
 */
const NEVER_SENT = ['draft'];

export function planDiscard(
  extra: ExtraState | null, captures: readonly CaptureRef[]
): DiscardPlan {
  if (!extra) return { allowed: false, reason: 'not_found' };
  if (!NEVER_SENT.includes(extra.status)) return { allowed: false, reason: 'already_sent' };
  // Belt and braces. A draft that somehow has a live link was sent by some path
  // this check does not know about, and the link is the thing a client holds.
  if (extra.hasLiveLink) return { allowed: false, reason: 'has_link' };

  const deleteCaptures: string[] = [];
  const keepCaptures: Array<{ captureId: string; why: 'shared' }> = [];
  for (const c of captures) {
    // > 1 means another extra reaches it too — a revision, or a second extra
    // raised from the same decision. Not ours to delete.
    if (c.usedByExtras > 1) keepCaptures.push({ captureId: c.captureId, why: 'shared' });
    else deleteCaptures.push(c.captureId);
  }
  return {
    allowed: true,
    deleteCaptures,
    keepCaptures,
    needsServer: captures
      .filter((c) => c.usedByExtras <= 1 && c.uploaded)
      .map((c) => c.captureId),
  };
}

/** What the confirmation must state before a thumb goes anywhere near it.
 *  Mandate #2: confirm, don't automate — and a confirmation that does not say
 *  what will be destroyed is a speed bump, not a confirmation. */
export function discardSummary(plan: DiscardPlan): {
  k: string; p: Record<string, string | number>;
} | null {
  if (!plan.allowed) return null;
  return {
    k: plan.keepCaptures.length ? 'discard.confirmShared' : 'discard.confirm',
    p: { n: plan.deleteCaptures.length, kept: plan.keepCaptures.length },
  };
}
