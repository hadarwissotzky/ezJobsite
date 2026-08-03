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

/**
 * WHAT THIS PERSON IS IN THE CHAIN (hadar, 2026-07-31, simplified from a two-way
 * homeowner/supply-chain flag: "they can select from homeowner, inspector, GC,
 * sub-contractor, designer, architect").
 *
 * Stored in `project_approver.chain_side`, which is deliberately a free TEXT column:
 * `role` carries a SQLite CHECK constraint that cannot be widened without rebuilding
 * the table, and this list is the one that will keep growing as trades ask for their
 * own word. Kept as its own fact rather than folded into `role` because role decides
 * AUTHORITY (who may bind the client's money) and this decides POSITION — a designer
 * may sit either side of me and only one of those two answers changes.
 *
 * `null`/absent = never asked. A third state, not a default.
 */
export const CLIENT_TYPES = [
  'homeowner',
  'general_contractor',
  'sub_contractor',
  'architect',
  'designer',
  'inspector',
] as const;
export type ClientType = (typeof CLIENT_TYPES)[number];
export function isClientType(v: unknown): v is ClientType {
  return typeof v === 'string' && (CLIENT_TYPES as readonly string[]).includes(v);
}

/** Older name, kept so existing call sites compile while the drawer lands. */
export type ChainSide = ClientType;
export const isChainSide = isClientType;

export type Approver = {
  id: string;
  name: string;
  role: ApproverRole;
  /** Most recently sent-to wins ties. 0 = never used. */
  lastUsedMs: number;
  /**
   * Can this person commit the client's money? `undefined` = not asked, fall back
   * to the role default. See BINDS_MONEY_BY_DEFAULT.
   */
  canBindMoney?: boolean;
};

/**
 * Roles that can commit the client's money without being asked.
 *
 * ADDED AFTER REVIEW (codex, 2026-07-21), and it was a real bug, not a nit. The
 * first version routed a `finish` extra to the designer even when the owner was
 * also on the roster, because R5c says "a finish or fixture choice goes to the
 * designer". A designer can CHOOSE a finish. A designer usually cannot bind the
 * homeowner to $1,850. Sending a priced commitment to someone without that
 * authority produces an approval that does not bind -- which is the exact failure
 * R5c opens by naming, and my own test had locked the wrong behaviour in.
 *
 * R5c's open (b) asks this directly: "whether an approver's authority is modelled
 * (can a designer approve money, or only selections?) ... v1 likely records the
 * role without enforcing a limit". I read that as permission to ignore authority.
 * It is not -- "does not ENFORCE a limit" is not "assumes there is none".
 *
 * So authority is recorded, not enforced: an unconfirmed approver is still
 * suggested (R5c's AC explicitly wants the designer pre-filled for a finish), but
 * the reason SAYS the authority is unconfirmed. Suggest, never decide -- and never
 * suggest silently when the thing being suggested might not hold.
 */
const BINDS_MONEY_BY_DEFAULT: ApproverRole[] = ['owner', 'general_contractor'];

/** Explicit answer wins; otherwise the role's default. */
export function bindsMoney(a: Approver): boolean {
  return a.canBindMoney ?? BINDS_MONEY_BY_DEFAULT.includes(a.role);
}

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
      reasonKey:
        | 'r5c.becauseRole'
        /** Right role for the job, but that role does not bind money by default. */
        | 'r5c.becauseRoleUnconfirmed'
        | 'r5c.becauseFallback'
        | 'r5c.becauseRecent';
      reasonParams: { role?: string; type?: string; name: string };
      /**
       * False when this person's authority to commit money is unconfirmed. The UI
       * must show the caveat; it must NOT silently block, because on plenty of jobs
       * a designer genuinely does hold signing authority and only the contractor
       * knows that.
       */
      bindsMoney: boolean;
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

    // The subject-matter match is preferred ONLY when they can also commit money.
    // When they cannot, someone who can is preferred over them -- the extra still
    // carries a price, and the price is what has to be authorised.
    if (match && bindsMoney(match)) {
      return {
        kind: 'suggested', approver: match, bindsMoney: true,
        reasonKey: 'r5c.becauseRole',
        reasonParams: { role: wanted, type, name: match.name },
      };
    }
    for (const role of FALLBACK_ROLES) {
      if (role === wanted) continue;
      const alt = ofRole(active, role);
      if (alt && bindsMoney(alt)) {
        return {
          kind: 'suggested', approver: alt, bindsMoney: true,
          reasonKey: 'r5c.becauseFallback',
          reasonParams: { role, type, name: alt.name },
        };
      }
    }
    // Nobody on this job is known to hold the money authority. Fall back to the
    // subject-matter match -- R5c's AC wants the designer pre-filled for a finish --
    // but say plainly that the authority is unconfirmed.
    if (match) {
      return {
        kind: 'suggested', approver: match, bindsMoney: false,
        reasonKey: 'r5c.becauseRoleUnconfirmed',
        reasonParams: { role: wanted, type, name: match.name },
      };
    }
    const recent = mostRecent(active);
    if (recent) {
      return {
        kind: 'suggested', approver: recent, bindsMoney: bindsMoney(recent),
        reasonKey: 'r5c.becauseRecent',
        reasonParams: { name: recent.name },
      };
    }
    return { kind: 'needs_approver', wantedRole: wanted };
  }

  // Untyped. Prefer someone who can bind money; fall back to plain recents rather
  // than blocking, because R5c's last AC says an untyped extra must not be blocked.
  const recent = mostRecent(active.filter(bindsMoney)) ?? mostRecent(active);
  if (recent) {
    return {
      kind: 'suggested', approver: recent, bindsMoney: bindsMoney(recent),
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
