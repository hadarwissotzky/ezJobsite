/**
 * R5b — the rules of the on-record discussion thread.
 *
 * PURE. Its one import is `extrastatus.ts`, which is itself importless, so this
 * still runs under `node --test` with nothing but the type stripper. That import
 * exists to avoid restating a rule R7 already owns (`canSupersede`) -- an importless
 * module is the means, not the goal, and a second copy of "may this be revised"
 * would cost more than the import saves.
 *
 * Everything in this file is a decision the product makes about a thread — is it
 * still open, is this extra "In Discussion", has the contractor left someone
 * hanging, what does a revision say about the price. None of it needs a database,
 * a network or a React tree, so none of it is allowed to import one. Same split as
 * approverrouting.ts (pure) + approvers.ts (PowerSync/Supabase); the storage half
 * of R5b lives in discussionstore.ts.
 *
 * THE ONE RULE THAT SHAPES THE WHOLE FILE (PRD R5b, and mandate #2):
 *   "Price changes resolve only through revision + fresh approval — never through
 *    thread agreement ('ok, $1,500' in chat is not an approval and the UI never
 *    treats it as one)."
 * So nothing here reads a price out of message text, and nothing here returns a
 * state that a caller could mistake for consent. `revisionDelta` takes two numbers
 * a human already confirmed; it never derives one.
 *
 * "IN DISCUSSION" IS DERIVED, NOT STORED. 220_question_path.sql settled this on the
 * server side — "a request with question rows and no response is in discussion" —
 * and a stored fourth status would be a second place for the truth to live and the
 * first place for it to drift. `displayStatus()` is the client half of that same
 * decision, which is why it takes messages instead of reading a column.
 */

// The explicit .ts extension is load-bearing: node --test resolves no extensions,
// and this module has to keep running there.
import { canSupersede } from './extrastatus.ts';
// Same reasoning as the import above: `extralifecycle.ts` owns the stage rules and
// this file defers to them rather than keeping a second copy. Both are importless
// but for each other, so node --test still resolves this module.
import { canReply } from './extralifecycle.ts';

/** Who wrote it. The client is whoever holds the approval link (R5's role-neutral
 *  recipient — homeowner, GC, property manager); the contractor is the app user. */
export type ThreadSide = 'client' | 'contractor';

export type ThreadMessage = {
  /** Stable across devices — server row id for a question, authored id for a reply.
   *  Used as the tiebreak in sortThread so two devices render the same order. */
  id: string;
  side: ThreadSide;
  text: string;
  atMs: number;
  /**
   * Photos sent WITH this message (2026-08-09). Optional because every existing
   * producer of a ThreadMessage — the server pull, the fixtures, the tests — omits
   * it, and a message with no photos and a message from before photos existed are
   * the same thing to every reader.
   *
   * The shape is deliberately structural rather than an import from
   * `discussionstore`: this module stays free of PowerSync and expo so it can run
   * under `node --test`, which is the whole reason the pure/IO split exists here.
   */
  photos?: readonly { captureId: string; relpath: string | null; published: boolean }[];
};

/**
 * Structurally identical to i18n's `Msg`, redeclared rather than imported.
 * i18n.ts holds module-level mutable state (`current`) and a 800-line dictionary;
 * importing it here would make this module untestable under `node --test` for the
 * sake of a two-field type. The compiler still checks the shape at every call site
 * that passes one of these to t().
 */
export type Msg = { k: string; p?: Record<string, string | number> };

/**
 * R5b: "In Discussion >48h with no contractor response ... flagged 'Awaiting your
 * reply'". Exported so the test names the same number the product does.
 */
export const AWAITING_REPLY_MS = 48 * 60 * 60 * 1000;

/** Chronological. Ties break on id so two devices never disagree about the order
 *  of two messages that landed in the same millisecond. */
export function sortThread(messages: readonly ThreadMessage[]): ThreadMessage[] {
  return [...messages].sort(
    (a, b) => a.atMs - b.atMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/**
 * THE DISPLAYED STATUS IS NOT DEFINED HERE. `extrastatus.ts` (R7) owns the ledger
 * vocabulary, including R5b's first-class "In Discussion" — it landed alongside
 * this and derives the same fact from the same rule (220: questions plus no answer
 * means in discussion). A second definition here would be two functions that agree
 * today and disagree after the first edit to either, on the one label a contractor
 * reads to decide whether a client is waiting on him. R5b defers; the thread screen
 * calls `displayStatus`/`chipKey` from that module.
 *
 * What stays here is what R5b alone needs and R7 does not model: is the thread open,
 * may he reply, may he revise, and has he left somebody waiting.
 */
export type ThreadState = {
  /** Chronological, always — callers render this, not their own copy. */
  messages: ThreadMessage[];
  /** Can new messages still be added? R5b: approval closes the thread. */
  open: boolean;
  /** R5b's first-class status: sent, asked about, not yet answered by either side. */
  inDiscussion: boolean;
  /** When the client first said something the contractor has not answered. */
  unansweredSinceMs: number | null;
  /** R5b AC5. */
  awaitingReply: boolean;
  /** The contractor may type into the thread. */
  canReply: boolean;
  /** The contractor may issue a superseding version. */
  canRevise: boolean;
};

/** A change order that has reached one of these is finished; R5b closes the thread
 *  on approval and the record is preserved read-only from then on. */
const TERMINAL = new Set<string>(['approved', 'declined', 'superseded']);

export function threadState(o: {
  /** `change_order.status` as stored — never a DisplayStatus. */
  coStatus: string;
  messages: readonly ThreadMessage[];
  nowMs: number;
  /** Overridable only so the test does not have to fabricate 48h of clock. */
  awaitingAfterMs?: number;
}): ThreadState {
  const messages = sortThread(o.messages);
  const open = !TERMINAL.has(o.coStatus);

  let lastContractorMs = -Infinity;
  for (const m of messages) if (m.side === 'contractor' && m.atMs > lastContractorMs) lastContractorMs = m.atMs;

  // THE EARLIEST unanswered client message, not the latest.
  //
  // R5b's wording is "no contractor response to the latest homeowner message", and
  // I did not implement that literally. Taking the LATEST means a client who asks
  // again on day 6 resets the clock and un-flags an extra the contractor has now
  // ignored for a week — the nudge would suppress the very warning it should
  // trigger. The obligation starts when they first asked and nothing since has
  // discharged it, so the clock starts there. Deviation stated rather than hidden.
  let unansweredSinceMs: number | null = null;
  for (const m of messages) {
    if (m.side !== 'client' || m.atMs <= lastContractorMs) continue;
    unansweredSinceMs = m.atMs;
    break;
  }

  const hasClientMessage = messages.some((m) => m.side === 'client');
  const inDiscussion = open && o.coStatus === 'sent' && hasClientMessage;
  const after = o.awaitingAfterMs ?? AWAITING_REPLY_MS;

  return {
    messages,
    open,
    inDiscussion,
    unansweredSinceMs,
    awaitingReply:
      open && unansweredSinceMs !== null && o.nowMs - unansweredSinceMs >= after,
    // THE THREAD CLOSES ON THE ANSWER (REQ-LC23, D1, 2026-07-28). This line used
    // to read `sent || approved || declined`, on a 2026-07-24 note that an extra
    // "becomes like a chat channel" and that this superseded R5b AC4. The idea is
    // not the problem; applying it to ONE SIDE of a two-sided contract is. The
    // server has closed the thread on the answer since 308_r5b_discussion.sql:94
    // (`confirmation_reply_thread_open`, errcode 23514) and 23514 is in
    // R5B_PERMANENT (discussionstore.ts:316) — so every reply typed after the
    // yes/no PARKED FOREVER while this flag told the screen it had been sent. A
    // silent delivery failure on the one surface whose job is that the record is
    // complete (DEF-4). A post-approval conversation is a new linked extra
    // (REQ-LC31), which is where a new commitment belongs anyway.
    canReply: canReply(o.coStatus),
    // R7's rule, not a copy of it: a draft is edited rather than revised, and a
    // terminal one would rewrite a signed outcome.
    canRevise: canSupersede(o.coStatus),
  };
}

/** Client messages, for `extrastatus.displayStatus`'s `openQuestions` signal. The
 *  count is computed from the thread this module already holds so the thread screen
 *  does not need a second query to label its own header. */
export function clientMessageCount(messages: readonly ThreadMessage[]): number {
  return messages.reduce((n, m) => n + (m.side === 'client' ? 1 : 0), 0);
}

export type RevisionDelta = {
  priorCents: number;
  newCents: number;
  /** Which way the money moved. 'same' is legitimate: a revision may change scope
   *  or the not-to-exceed clause while the headline figure holds. */
  direction: 'down' | 'up' | 'same';
};

/**
 * R5b's "Revised: $1,850 → $1,500" marker, as data.
 *
 * It returns CENTS, not a formatted string, on purpose: money() lives in
 * changeorder.ts next to the parser and the server's to_char must agree with it
 * (240_shown_content_integrity). A second formatter here would be a second thing to
 * keep in step with postgres, which confirmations.ts already learned the hard way.
 */
export function revisionDelta(priorCents: number, newCents: number): RevisionDelta {
  return {
    priorCents, newCents,
    direction: newCents < priorCents ? 'down' : newCents > priorCents ? 'up' : 'same',
  };
}

// ── the deep link a push notification opens (R5b AC1) ───────────────────────
//
// A custom scheme rather than a universal link: this has to work from the lock
// screen with no network, and a universal link falls back to a web page — which is
// the CLIENT's approval page, the last place the contractor should land.
const SCHEME = 'ezjobsite://extra/';

/** `focusReply` is carried in the URL, not assumed, because the same screen is
 *  reachable from the ledger where popping the keyboard would be rude. */
export function threadLink(changeOrderId: string, focusReply = true): string {
  return `${SCHEME}${encodeURIComponent(changeOrderId)}/thread${focusReply ? '?reply=1' : ''}`;
}

export function parseThreadLink(
  url: string
): { changeOrderId: string; focusReply: boolean } | null {
  if (typeof url !== 'string' || !url.startsWith(SCHEME)) return null;
  const rest = url.slice(SCHEME.length);
  const [path, query = ''] = rest.split('?', 2);
  const parts = path.split('/');
  if (parts.length !== 2 || parts[1] !== 'thread') return null;
  let id: string;
  // A malformed percent-escape throws rather than returning junk. A link we cannot
  // read is a link we refuse, never one we guess at: routing to the WRONG extra's
  // thread would put a reply about one price under a different one.
  try { id = decodeURIComponent(parts[0]); } catch { return null; }
  if (!id) return null;
  return { changeOrderId: id, focusReply: /(^|&)reply=1(&|$)/.test(query) };
}

/** Cut long text for a notification body without cutting mid-word where avoidable.
 *  A question truncated to "can you do it for" reads as a different question. */
export function truncate(text: string, max: number): string {
  const s = text.trim().replace(/\s+/g, ' ');
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export type ThreadNotification = {
  title: Msg;
  /** The client's own words. NOT localized: it is what they typed. */
  body: string;
  /** Deep link, reply field focused — R5b AC1's "two taps from the lock screen". */
  link: string;
};

/**
 * What the push says. Pure so the wording is testable without a device.
 *
 * The PRICE IS DELIBERATELY ABSENT from the body. A notification is read on a lock
 * screen by whoever is holding the phone, and mandate #6 treats a number seen out
 * of its frozen context as a hazard, not a convenience. The scope names the extra;
 * the figure is one tap away inside the app where it is bound to its instrument.
 */
export function notificationFor(o: {
  changeOrderId: string; scope: string; question: string;
}): ThreadNotification {
  return {
    title: { k: 'r5b.pushTitle', p: { scope: truncate(o.scope, 40) } },
    body: truncate(o.question, 140),
    link: threadLink(o.changeOrderId, true),
  };
}

// ── the discussion log for the record bundle (R5b AC3) ──────────────────────

const esc = (s: string) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * The thread as it appears beneath the approved snapshot in the evidence bundle.
 *
 * Labels and the time formatter are INJECTED rather than imported so this stays a
 * pure function; bundle.ts already renders its own English chrome and owns that
 * choice. Timestamps are on every line because R5b AC3 asks for them by name — a
 * discussion log without times cannot show who was waiting on whom.
 */
export function renderDiscussionLogHtml(
  messages: readonly ThreadMessage[],
  o: {
    clientLabel: string; contractorLabel: string; emptyLabel: string;
    recordNote: string; formatAt: (ms: number) => string;
  }
): string {
  const rows = sortThread(messages);
  if (!rows.length) return `<p class="none">${esc(o.emptyLabel)}</p>`;
  const body = rows.map((m) => `
    <tr>
      <td>${esc(m.side === 'client' ? o.clientLabel : o.contractorLabel)}</td>
      <td>${esc(o.formatAt(m.atMs))}</td>
      <td>${esc(m.text)}</td>
    </tr>`).join('');
  return `<table><tr><th>From</th><th>When</th><th>Message</th></tr>${body}</table>
<p class="note">${esc(o.recordNote)}</p>`;
}
