/**
 * R5c — what kind of extra is this, and who is entitled to approve it.
 *
 * PURE. No imports, no database, no clock, no I/O. That is deliberate and not
 * decoration: this file decides who a priced commitment gets sent to, it is the
 * only part of R5c that can be wrong in a way nobody notices, and this repo has no
 * test runner for anything that touches PowerSync. Keeping it free of imports is
 * what makes `approverrouting.test.ts` runnable at all (node --test strips the
 * types and needs nothing else to resolve).
 *
 * THE RULE, from PRD R5c and mandate #2: SUGGEST, NEVER DECIDE. Nothing here sends
 * anything. Every function returns a suggestion carrying its own reason, and the
 * reason is meant to be shown to the contractor, not logged. A commitment leaving
 * on an inference is the thing mandate #2 forbids; a pre-filled field the sender
 * reads and taps past is not that.
 */

// ─── the taxonomy ──────────────────────────────────────────────────────────────
// Straight from PRD R5c, which names these six. It is NOT invented here, and it is
// deliberately NOT extended here either: R5c's open question (a) says the final
// taxonomy must be derived from real captures, and there are none yet. Six is also
// about the limit for a picker someone uses on a ladder -- R5c's own test is that
// it stay "short enough that a wrong guess is obvious".
export const EXTRA_TYPES = [
  'structural',
  'mep',                  // mechanical / electrical / plumbing
  'finish',               // finish or fixture selection
  'code_permit',
  'site_condition',       // discovery: opened the wall and found something
  'scope_clarification',
] as const;
export type ExtraType = (typeof EXTRA_TYPES)[number];

// ─── who can approve ───────────────────────────────────────────────────────────
export const APPROVER_ROLES = [
  'owner',
  'general_contractor',
  'designer',
  'internal_specialist',
  'property_manager',
  'other',
] as const;
export type ApproverRole = (typeof APPROVER_ROLES)[number];

export type Approver = {
  id: string;
  name: string;
  role: ApproverRole;
  /** Most recently sent-to wins ties. 0 = never used. */
  lastUsedMs: number;
};

/**
 * Type -> the role that usually owns that call. From R5c: "A structural surprise
 * goes to the GC; a finish or fixture choice goes to the designer; anything that
 * costs the client money goes to the owner; a code/permit issue may go to an
 * internal specialist."
 *
 * THE TENSION IN THAT SENTENCE, named rather than papered over: "anything that
 * costs the client money goes to the owner" would route EVERYTHING to the owner,
 * because every extra costs money -- that is what makes it an extra. Read that way
 * the rule eats the other three and the feature is pointless.
 *
 * So it is read as the fallback it has to be: the owner is who you go to when
 * nobody more specific owns the decision, which is why `owner` heads the fallback
 * chain below rather than appearing here for every type. What this map encodes is
 * narrower and checkable: who is best placed to JUDGE this kind of extra.
 */
const PREFERRED_ROLE: Record<ExtraType, ApproverRole> = {
  structural: 'general_contractor',
  mep: 'general_contractor',
  finish: 'designer',
  code_permit: 'internal_specialist',
  site_condition: 'general_contractor',
  scope_clarification: 'owner',
};

/**
 * Tried in order when the preferred role is not on this job's roster. The owner is
 * first because they are the one party who can always authorise spending their own
 * money; the GC second because on a sub's job they are the counterparty who can.
 */
const FALLBACK_ROLES: ApproverRole[] = ['owner', 'general_contractor'];

export type Suggestion =
  | {
      kind: 'suggested';
      approver: Approver;
      /** Why THIS person. Rendered to the contractor verbatim; never hidden. */
      reasonKey: 'r5c.becauseRole' | 'r5c.becauseFallback' | 'r5c.becauseRecent';
      reasonParams: { role?: string; type?: string; name: string };
    }
  /** The roster has nobody who fits and nobody at all to fall back to. */
  | { kind: 'needs_approver'; wantedRole: ApproverRole | null };

/** Most recently used, then alphabetical so the order never depends on row order. */
function mostRecent(list: Approver[]): Approver | null {
  if (!list.length) return null;
  return [...list].sort(
    (a, b) => b.lastUsedMs - a.lastUsedMs || a.name.localeCompare(b.name)
  )[0];
}

function ofRole(roster: Approver[], role: ApproverRole): Approver | null {
  return mostRecent(roster.filter((a) => a.role === role));
}

/**
 * Pre-fill "Send to" on the preview card.
 *
 * `type` may be null and that is a FIRST-CLASS case, not a degraded one: R5c's last
 * AC requires that when classification is unavailable (offline, model down, or --
 * for now -- simply not yet asked) the extra is untyped, send-to falls back to
 * recents, and NOTHING IS BLOCKED. So an untyped extra still gets a suggestion; it
 * just gets a weaker reason, and the reason says so.
 */
export function suggestApprover(
  type: ExtraType | null,
  roster: Approver[]
): Suggestion {
  const active = roster.filter((a) => a.name.trim().length > 0);

  if (type) {
    const wanted = PREFERRED_ROLE[type];
    const match = ofRole(active, wanted);
    if (match) {
      return {
        kind: 'suggested',
        approver: match,
        reasonKey: 'r5c.becauseRole',
        reasonParams: { role: wanted, type, name: match.name },
      };
    }
    for (const role of FALLBACK_ROLES) {
      if (role === wanted) continue;
      const alt = ofRole(active, role);
      if (alt) {
        return {
          kind: 'suggested',
          approver: alt,
          reasonKey: 'r5c.becauseFallback',
          reasonParams: { role, type, name: alt.name },
        };
      }
    }
    // Somebody is on the roster, just nobody who fits. Still better than nothing,
    // and the reason will say it is only "who you last sent to".
    const recent = mostRecent(active);
    if (recent) {
      return {
        kind: 'suggested',
        approver: recent,
        reasonKey: 'r5c.becauseRecent',
        reasonParams: { name: recent.name },
      };
    }
    return { kind: 'needs_approver', wantedRole: wanted };
  }

  const recent = mostRecent(active);
  if (recent) {
    return {
      kind: 'suggested',
      approver: recent,
      reasonKey: 'r5c.becauseRecent',
      reasonParams: { name: recent.name },
    };
  }
  return { kind: 'needs_approver', wantedRole: null };
}

/** Narrowing helpers so callers never compare against a free string. */
export function isExtraType(v: unknown): v is ExtraType {
  return typeof v === 'string' && (EXTRA_TYPES as readonly string[]).includes(v);
}
export function isApproverRole(v: unknown): v is ApproverRole {
  return typeof v === 'string' && (APPROVER_ROLES as readonly string[]).includes(v);
}
