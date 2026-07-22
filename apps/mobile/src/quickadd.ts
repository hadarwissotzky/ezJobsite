/**
 * PRD R7 — quick-add a job: client name + phone + job label. Nothing else.
 *
 * PURE. No imports, so `quickadd.test.ts` runs under bare `node --test`. The
 * PowerSync half is `quickaddjob.ts`. Same split as approverrouting/approvers.
 *
 * WHAT R7 ACTUALLY ASKS FOR, and what was there instead:
 *   "a project = client + job name (e.g. 'Sarah Miller — Hall bath') ... created
 *    implicitly at first send via quick-add (name + phone + job label) — there is
 *    no project setup screen."
 *   The build had a setup screen collecting name + address, with no phone anywhere,
 *   so the job existed but the person who has to approve its extras did not. The
 *   send preview then opened onto an empty roster and the contractor had to type
 *   the client in a second time, at the worst possible moment — with a price on
 *   screen. The three fields here are the minimum that makes the first send
 *   complete.
 *
 * THE ADDRESS IS NOT A FIELD. R7 does not ask for one and a keyboard on a ladder is
 * the thing mandate #3's touch budget is spent on. `quickAddJob` still fills the
 * project's address when the OS hands one over for free (reverse geocode at the
 * capture's own fix) — a display convenience that is never asked for and never
 * blocks. Asking is what R7 forbids; knowing is fine.
 */

/** What the form collects. Raw, exactly as typed. */
export type QuickAddInput = {
  clientName: string;
  /** Optional. See `validateQuickAdd`. */
  phone: string;
  jobLabel: string;
};

/** Per-field i18n KEYS, never sentences — the render layer makes words (i18n.ts). */
export type QuickAddErrors = {
  clientName?: string;
  phone?: string;
  jobLabel?: string;
};

/**
 * "Sarah Miller — Hall bath". The em dash is R7's own example and it is load
 * bearing: this string is the job's whole identity in the picker, in recents, on
 * the approval page ("Job:") and in the frozen instrument the client signs
 * (renderCard bakes `projectName` in). A hyphen would read as part of a name.
 *
 * Either half alone still produces a usable name rather than a dangling dash —
 * a job called "Sarah Miller" is worse than one called "Sarah Miller — Hall bath"
 * and infinitely better than one called "Sarah Miller — ".
 */
export function jobName(clientName: string, jobLabel: string): string {
  const c = clientName.trim().replace(/\s+/g, ' ');
  const j = jobLabel.trim().replace(/\s+/g, ' ');
  if (c && j) return `${c} — ${j}`;
  return c || j;
}

/**
 * A typed phone number → E.164, or null when it cannot be read with confidence.
 *
 * CONSERVATIVE ON PURPOSE, the same bar as the price parser in changeorder.ts: a
 * number stored wrong is an approval link delivered to a stranger, and there is no
 * screen that would show the contractor it happened. Rather guess nothing.
 *
 * Judgement calls made here, and what was rejected:
 *  - REJECTED "store whatever they typed". `project_approver.phone_e164` says
 *    E.164 in its name; a column that sometimes holds "(415) 555-0134" is a column
 *    every later delivery path has to re-parse, differently.
 *  - REJECTED "require the user to type +1". No US contractor types a country code,
 *    and a field that rejects the number on his own phone is a field he abandons.
 *    So a bare 10-digit number is assumed US — honest, because this app ships US
 *    jurisdictions only (see us-states.geo.json / jurisdiction.ts) and the
 *    assumption is confined to that one shape.
 *  - An 11-digit number must start with 1, or it is not a US number with a country
 *    code on it and we do not know what it is.
 */
export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Everything a person might type between digits, and nothing else. A letter
  // anywhere (vanity numbers, "ext", a pasted name) means we did not get a number.
  if (/[^\d\s()+.\-]/.test(trimmed)) return null;

  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;

  if (hasPlus) {
    // E.164 is 1–15 digits; under 8 is not a reachable international number, it is
    // a typo that would silently fail to deliver.
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

/**
 * What is wrong with the form, per field. Empty object = good to create.
 *
 * THE PHONE IS COLLECTED BUT NOT REQUIRED, and that is a decision, not an
 * oversight. Today's send is `channel: 'link'` through the OS share sheet — the
 * contractor delivers it himself over whatever he and the client already use. A
 * required phone would block a job on a number the transport does not use, which
 * is a gate that buys nothing and blocks work offline (mandate #7). A phone that
 * IS typed must be readable, because a half-parsed number is worse than none.
 */
export function validateQuickAdd(i: QuickAddInput): QuickAddErrors {
  const e: QuickAddErrors = {};
  if (!i.clientName.trim()) e.clientName = 'quick.needClient';
  if (!i.jobLabel.trim()) e.jobLabel = 'quick.needLabel';
  if (i.phone.trim() && normalizePhone(i.phone) === null) e.phone = 'quick.badPhone';
  return e;
}

export function isComplete(e: QuickAddErrors): boolean {
  return Object.keys(e).length === 0;
}
