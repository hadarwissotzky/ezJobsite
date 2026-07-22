/**
 * R6b items 1 and 3 — the People block, and what the money block is allowed to say.
 *
 * PURE. No imports, no database, no clock, no locale. Same reason as
 * `approverrouting.ts`: this decides what a legal record says about WHO did what,
 * it is the kind of thing that is wrong in a way nobody notices until a record is
 * questioned, and keeping it import-free is what makes `recordpeople.test.ts`
 * runnable at all (node --test strips the types and needs nothing else to resolve).
 *
 * THE RULE INHERITED FROM record.ts, and it is the whole design: every actor and
 * every timestamp comes from a STORED row. Nothing here invents, back-fills or
 * substitutes. A fact that was never recorded produces NO ROW — never a plausible
 * stand-in. record.ts's header documents what happens when that rule slips: an
 * earlier version read the signed-in profile at RENDER time, so editing your name
 * silently rewrote who priced a two-week-old record.
 *
 * This module fixes the other half of that: the facts are now written at the moment
 * they happen (`recordactors.ts`) so there is something real to read. This file only
 * arranges them.
 *
 * WORDS ARE NOT HERE EITHER. Every row carries i18n KEYS and raw millisecond
 * timestamps; the render layer turns them into a sentence in the reader's language
 * and their locale's date format (mandate #5). Returning "Captured on Jul 20" from
 * here would weld English into the logic, which is the mistake i18n.ts's own header
 * was written to stop.
 */

// ─── what is stored ────────────────────────────────────────────────────────────

/** The three contributions R6b names for the contractor's side of the record. */
export type ActorAct = 'captured' | 'priced' | 'sent';

/** One row of `extra_actor`, as stored. `atMs` is required: an actor fact without
 *  the moment it happened fails R6b's AC ("each with its timestamp"), and this
 *  table is written at the moment of the event, so there is no honest way to hold
 *  one without a time. Rows predating the table simply do not exist and no person
 *  appears for them. */
export type ActorFact = { act: ActorAct; name: string; atMs: number };

/**
 * Who the extra was addressed to, and the role they held WHEN IT WENT.
 *
 * `role` is a slug copied onto the record at send time rather than a live join to
 * the roster. R5c lets a roster member be retired or re-roled later; if the record
 * resolved the role live, retiring someone would silently change what an already
 * signed record says about who was entitled to approve it. The roster is mutable;
 * the record is not.
 */
export type ApproverFact = { name: string; role: string | null; atMs: number | null };

// ─── what the screen renders ───────────────────────────────────────────────────

/** One thing this person did, and when. `atMs` null = the event is real but its
 *  time is not on this device (see record.ts's KNOWN GAP on send/sign times). */
export type Contribution = { roleKey: string; atMs: number | null };

export type PersonRow = {
  name: string;
  /** Approver role slug, or null. Words come from roleLabel() at render time. */
  roleSlug: string | null;
  contributions: Contribution[];
  /** Drives the avatar colour only. 'approver' = the client's side of the record. */
  kind: 'approver' | 'crew';
};

export type PeopleInput = {
  actors: ActorFact[];
  /** The roster member the approval link was addressed to (R5c). */
  approver: ApproverFact | null;
  /** REQ-VAL4: who ASKED for this extra. NOT the approver — conflating the two is
   *  how a request reaches someone who cannot authorise it, and record.ts's header
   *  records that this screen once labelled who_directed "the approver". */
  whoDirected: string | null;
  /** The typed-name signature (R6). Who actually signed, which is a different fact
   *  from who was entitled to. R5c's AC wants both on the record. */
  signedBy: string | null;
};

export const ROLE_KEY: Record<ActorAct, string> = {
  captured: 'erec.capturedBy',
  priced: 'erec.pricedBy',
  sent: 'erec.sentBy',
};

export const APPROVER_KEY = 'erec.approverRole';
export const SIGNED_KEY = 'erec.signedBy';
export const DIRECTED_KEY = 'erec.directedBy';

/**
 * Display order within a person's card. Fixed, not chronological: this block is a
 * ROSTER of roles, and the timeline underneath it is where time already governs
 * the order. Sorting contributions by time would make the same person's card
 * reshuffle between two renders of the same record.
 */
const KEY_ORDER = [
  APPROVER_KEY, SIGNED_KEY, DIRECTED_KEY,
  ROLE_KEY.captured, ROLE_KEY.priced, ROLE_KEY.sent,
];

/** Merge key. Case- and whitespace-insensitive so "marco reyes" and "Marco  Reyes"
 *  are one person. NOT an identity: two different people with the same spelled name
 *  on one job would merge. That is accepted deliberately — the case that actually
 *  happens on every solo job is one person who captured AND priced AND sent, and
 *  showing them as three separate humans in a block headed "People on this record"
 *  misreads the record far more often than a name collision would. */
function keyOf(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

function clean(name: string | null | undefined): string | null {
  const s = (name ?? '').trim().replace(/\s+/g, ' ');
  return s.length ? s : null;
}

/**
 * One actor row per act.
 *
 * captured/priced take the EARLIEST: each happens once by construction (a capture
 * creates the item, the price read-back creates the change order), so a second row
 * is a retry or a second device replaying, not a second person doing it again.
 *
 * sent takes the LATEST: a re-send is a real second event and can go to a different
 * person. "Who is holding this right now" is what the contractor opened the record
 * to find out; every earlier send is still in the history below, unabridged.
 */
function pickPerAct(actors: ActorFact[]): Map<ActorAct, ActorFact> {
  const out = new Map<ActorAct, ActorFact>();
  for (const a of actors) {
    if (!clean(a.name)) continue;          // never render a nameless "someone"
    if (!Number.isFinite(a.atMs)) continue; // nor a fact with no moment
    const prior = out.get(a.act);
    if (!prior) { out.set(a.act, a); continue; }
    const takeNewer = a.act === 'sent';
    if (takeNewer ? a.atMs > prior.atMs : a.atMs < prior.atMs) out.set(a.act, a);
  }
  return out;
}

/**
 * The People block, ordered exactly as R6b lists it: the approver first (the
 * question a questioned record is opened to answer is "who was entitled to say
 * yes"), then the contractor's side.
 *
 * THE TWO SIDES NEVER MERGE, even on an identical name. The approver's entitlement
 * to bind the client and a crew member's contribution are facts about different
 * parties to the same document; collapsing them because two strings matched would
 * put "Approver · Priced this" on one avatar and quietly assert that the client
 * priced their own change order. Within a side, the same name is one person.
 */
export function assemblePeople(input: PeopleInput): PersonRow[] {
  const rows: PersonRow[] = [];

  // ---- client side -----------------------------------------------------------
  const clientOrder: Array<{ name: string; roleKey: string; atMs: number | null; roleSlug: string | null }> = [];
  const apprName = clean(input.approver?.name);
  if (apprName) {
    clientOrder.push({
      name: apprName, roleKey: APPROVER_KEY,
      atMs: input.approver!.atMs ?? null,
      roleSlug: clean(input.approver!.role),
    });
  }
  const signed = clean(input.signedBy);
  // The signature carries no timestamp on this device — the approval is authored
  // server-side (see record.ts's KNOWN GAP). null, never Date.now().
  if (signed) clientOrder.push({ name: signed, roleKey: SIGNED_KEY, atMs: null, roleSlug: null });
  const directed = clean(input.whoDirected);
  // who_directed is recorded at capture and carries no time of its own.
  if (directed) clientOrder.push({ name: directed, roleKey: DIRECTED_KEY, atMs: null, roleSlug: null });

  for (const c of clientOrder) addTo(rows, 'approver', c);

  // ---- contractor side -------------------------------------------------------
  const picked = pickPerAct(input.actors);
  for (const act of ['captured', 'priced', 'sent'] as const) {
    const a = picked.get(act);
    if (!a) continue;
    addTo(rows, 'crew', {
      name: clean(a.name)!, roleKey: ROLE_KEY[act], atMs: a.atMs, roleSlug: null,
    });
  }

  for (const r of rows) {
    r.contributions.sort((x, y) => KEY_ORDER.indexOf(x.roleKey) - KEY_ORDER.indexOf(y.roleKey));
  }
  return rows;
}

function addTo(
  rows: PersonRow[], kind: PersonRow['kind'],
  c: { name: string; roleKey: string; atMs: number | null; roleSlug: string | null }
) {
  const existing = rows.find((r) => r.kind === kind && keyOf(r.name) === keyOf(c.name));
  const target = existing ?? { name: c.name, roleSlug: null, contributions: [], kind };
  if (!existing) rows.push(target);
  // A role slug already on the row wins: it was copied from the roster at send time
  // and is the entitlement fact. Nothing later should be able to blank it.
  if (!target.roleSlug && c.roleSlug) target.roleSlug = c.roleSlug;
  if (!target.contributions.some((x) => x.roleKey === c.roleKey)) {
    target.contributions.push({ roleKey: c.roleKey, atMs: c.atMs });
  }
}

// ─── item 1: what kind of item is this, and what may the money block say ───────

export type ItemKind = 'extra' | 'decision';

/**
 * The identity line's type. R6b item 1 wants Extra/Decision visible: the two are
 * approved through the same mechanics and only one of them carries money, so a
 * record that does not say which it is has hidden the single most consequential
 * fact about itself.
 */
export const KIND_KEY: Record<ItemKind, string> = {
  extra: 'erec.kindExtra',
  decision: 'erec.kindDecision',
};

/**
 * The money block. A DISCRIMINATED UNION on purpose: a Decision is not an Extra
 * with the price hidden, so the shape that carries a price is unconstructable for
 * one. R6b's AC is "no price is shown ANYWHERE on the screen", and a boolean flag
 * beside an amount field is one forgotten `&&` away from breaking it.
 */
export type PricedItem = { kind: 'extra'; amount: string; nte: string | null; isMini: boolean };
export type Item = PricedItem | { kind: 'decision' };

export type MoneyBlock =
  | { show: 'price'; amount: string; nte: string | null; isMini: boolean }
  /** Renders `erec.noCostChange` (R10: "Confirmation — no cost change"). */
  | { show: 'noCost' };

export function moneyBlock(item: Item): MoneyBlock {
  if (item.kind === 'decision') return { show: 'noCost' };
  return { show: 'price', amount: item.amount, nte: item.nte, isMini: item.isMini };
}
