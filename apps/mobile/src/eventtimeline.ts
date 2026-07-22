/**
 * R6 — turning server approval events into the record's timeline.
 *
 * PURE. No imports, no database, no clock, no I/O. Same reason as
 * approverrouting.ts: this decides what a legal record SAYS happened, it is the
 * part of R6 that can be wrong in a way nobody notices, and this repo has no test
 * runner for anything that touches PowerSync. Import-free is what makes
 * `eventtimeline.test.ts` runnable at all. The Supabase/SQLite half lives in
 * `eventlog.ts`.
 *
 * THE RULE INHERITED FROM record.ts, and it is the only rule here:
 *   every timestamp comes from a stored column, and an event whose time cannot be
 *   read is either dropped or marked — never given a plausible position.
 * So `parseTimeline` throws away a row whose `at` will not parse rather than
 * defaulting it to now(), which would put a fabricated moment on the one screen a
 * dispute turns on.
 *
 * Strings are KEY + PARAMS, never sentences (mandate #5, and the architectural note
 * at the top of i18n.ts). Nothing in this file can be read; only the render layer
 * turns these into words, in the reader's language.
 */

// ─── what the server sends ─────────────────────────────────────────────────────
// Mirrors `change_order_timeline()` in sql/366_event_timeline.sql. `delivered` and
// `reminder` are absent on purpose — see that file's header; nothing in this
// product records a delivery receipt or sends a reminder yet, and an event kind
// that can never fire is a promise the record cannot keep.
export const SERVER_EVENT_KINDS = [
  'sent', 'opened', 'asked', 'approved', 'declined', 'superseded',
] as const;
export type ServerEventKind = (typeof SERVER_EVENT_KINDS)[number];

export type ServerEvent = {
  kind: ServerEventKind;
  /** Server time. Always a real parsed value — see parseTimeline. */
  atMs: number;
  channel?: string | null;
  who?: string | null;
  note?: string | null;
  name?: string | null;
};

export type FrozenSnapshot = {
  token: string;
  /** The binding instrument (mandate #5). Never re-rendered, only displayed. */
  content: string;
  sha256: string;
  action: 'confirmed' | 'declined' | null;
  signedName: string | null;
  answeredAtMs: number | null;
  superseded: boolean;
};

/** A translated line the record screen already knows how to draw. */
export type LocalEvent = { atMs: number | null; at: string; what: string; hot?: boolean };

/**
 * A line on the merged timeline. Exactly one of `k` (an i18n key the render layer
 * translates) or `text` (a local line record.ts already translated) is set.
 */
export type MergedEvent = {
  atMs: number | null;
  k?: string;
  p?: Record<string, string | number>;
  text?: string;
  hot?: boolean;
  /** Set when the line came from the server rather than from the local row. */
  fromServer?: boolean;
};

// ─── parsing ───────────────────────────────────────────────────────────────────

function isKind(x: unknown): x is ServerEventKind {
  return typeof x === 'string' && (SERVER_EVENT_KINDS as readonly string[]).includes(x);
}

function ms(iso: unknown): number | null {
  if (typeof iso !== 'string' || !iso) return null;
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : null;
}

function str(x: unknown): string | null {
  return typeof x === 'string' && x.length > 0 ? x : null;
}

/**
 * jsonb -> events, chronological.
 *
 * Defensive on purpose: this payload crosses a network and a jsonb boundary, and
 * the record screen must render SOMETHING truthful even if one row is malformed.
 * A row with an unknown kind or an unparseable time is dropped — visible as a
 * missing line, never as a wrong one.
 */
export function parseTimeline(raw: unknown): ServerEvent[] {
  const rows = (raw && typeof raw === 'object' && Array.isArray((raw as any).events))
    ? (raw as any).events as unknown[]
    : Array.isArray(raw) ? raw as unknown[] : [];

  const out: ServerEvent[] = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const kind = (r as any).kind;
    const atMs = ms((r as any).at);
    if (!isKind(kind) || atMs === null) continue;
    const d = ((r as any).detail && typeof (r as any).detail === 'object')
      ? (r as any).detail as Record<string, unknown> : {};
    out.push({
      kind, atMs,
      channel: str(d.channel), who: str(d.who), note: str(d.note), name: str(d.name),
    });
  }
  return out.sort((a, b) => a.atMs - b.atMs);
}

export function parseSnapshot(raw: unknown): FrozenSnapshot | null {
  const s = (raw && typeof raw === 'object') ? (raw as any).snapshot ?? raw : null;
  if (!s || typeof s !== 'object') return null;
  const content = str((s as any).shown_content);
  const token = str((s as any).token);
  // No content means no instrument. A snapshot card with nothing in it would imply
  // the client signed a blank page.
  if (!content || !token) return null;
  const action = (s as any).action;
  return {
    token,
    content,
    sha256: str((s as any).shown_sha256) ?? '',
    action: action === 'confirmed' || action === 'declined' ? action : null,
    signedName: str((s as any).signed_name),
    answeredAtMs: ms((s as any).answered_at),
    superseded: (s as any).superseded === true,
  };
}

// ─── one event -> one line ─────────────────────────────────────────────────────

/**
 * The channel is part of the sent event because "sent by text to the Owner" and
 * "sent as a link" are different evidentiary claims — one names a destination that
 * can be checked, the other does not.
 *
 * It is folded into the KEY rather than passed as a parameter because a parameter
 * would have to be an English word ('sms') substituted into a Spanish sentence.
 * A key per channel is three dictionary entries; a parameter is a permanent
 * half-translated line.
 */
function sentKey(channel: string | null | undefined): string {
  switch (channel) {
    case 'sms':   return 'erec.evSentSms';
    case 'email': return 'erec.evSentEmail';
    case 'link':  return 'erec.evSentLink';
    default:      return 'erec.evSent';   // existing key, no params
  }
}

export function describeEvent(e: ServerEvent): { k: string; p?: Record<string, string | number>; hot?: boolean } {
  switch (e.kind) {
    case 'sent': {
      const k = sentKey(e.channel);
      // No recipient label, or a channel we do not have a sentence for: fall back to
      // the plain "Sent for approval" that already exists rather than rendering a
      // sentence with a hole in it.
      if (!e.who || k === 'erec.evSent') return { k: 'erec.evSent', hot: true };
      return { k, p: { who: e.who }, hot: true };
    }
    case 'opened':
      return { k: 'erec.evOpened' };
    case 'asked':
      // The question's own words. Quoting is the point: a paraphrase of what a
      // client asked is not evidence of what they asked.
      return e.note ? { k: 'erec.evAsked', p: { note: e.note }, hot: true } : { k: 'erec.evAskedPlain', hot: true };
    case 'approved':
      return e.name
        ? { k: 'erec.evApprovedBy', p: { name: e.name }, hot: true }
        : { k: 'erec.evApproved', hot: true };
    case 'declined':
      return e.name
        ? { k: 'erec.evDeclinedBy', p: { name: e.name }, hot: true }
        : { k: 'erec.evDeclined', hot: true };   // existing key
    case 'superseded':
      return { k: 'erec.evSuperseded', hot: true };
  }
}

// ─── merging with what the device already knew ─────────────────────────────────

/**
 * Local timeline + server timeline -> one chronological timeline.
 *
 * THE DEDUPE RULE, stated because it is the one thing here that throws information
 * away: an UNSTAMPED local event (atMs === null) is dropped when the server
 * returned any events at all.
 *
 * Why that is safe rather than convenient: record.ts emits an unstamped event only
 * for the three facts it holds with no time on this device — sent, signed,
 * declined — and every one of those is derived from the same server rows this
 * timeline is built from. Keeping both would print
 *     "Sent for approval — time not recorded"
 * directly beneath
 *     "Sent for approval — Jul 20, 2:14 pm"
 * on the screen whose entire job is to be trusted in a dispute. Two entries for one
 * event reads as two events.
 *
 * Why it is conditional rather than absolute: with no server data — offline, never
 * fetched, or the fetch failed — the unstamped events are all the record has, and
 * mandate #7 says the network is never a precondition for seeing what you captured.
 * They survive untouched, still marked "time not recorded".
 */
export function mergeTimeline(
  local: readonly LocalEvent[], server: readonly ServerEvent[]
): MergedEvent[] {
  const fromServer: MergedEvent[] = server.map((e) => {
    const d = describeEvent(e);
    return { atMs: e.atMs, k: d.k, p: d.p, hot: d.hot, fromServer: true };
  });

  const keepUnstamped = server.length === 0;
  const fromLocal: MergedEvent[] = local
    .filter((l) => l.atMs !== null || keepUnstamped)
    .map((l) => ({ atMs: l.atMs, text: l.what, hot: l.hot }));

  const all = [...fromLocal, ...fromServer];
  // Stamped ascending; unstamped last, in the order they arrived. Array#sort is
  // stable, so events sharing a millisecond keep local-before-server order.
  const stamped = all.filter((e) => e.atMs !== null)
    .sort((a, b) => (a.atMs as number) - (b.atMs as number));
  const unstamped = all.filter((e) => e.atMs === null);
  return [...stamped, ...unstamped];
}

// ─── the actionable signal R6 names ────────────────────────────────────────────

export function openCount(server: readonly ServerEvent[]): number {
  return server.filter((e) => e.kind === 'opened').length;
}

/**
 * "opened 3 times, no response" — R6 calls this out as the signal the contractor
 * acts on, so it is a summary line and not something he has to count off a list.
 *
 * Only shown while the item is still OUT. Once it is approved or declined the open
 * count stops being a prompt to chase and becomes trivia; the events remain in the
 * timeline either way.
 */
export function openSignal(
  server: readonly ServerEvent[], status: string
): { k: string; p?: Record<string, string | number> } | null {
  if (status !== 'sent') return null;
  const sent = server.some((e) => e.kind === 'sent');
  if (!sent) return null;
  const n = openCount(server);
  if (n === 0) return { k: 'erec.notOpenedYet' };
  if (n === 1) return { k: 'erec.openedOnce' };
  return { k: 'erec.openedTimes', p: { n } };
}

/**
 * Does the copy in front of the contractor hash to the value frozen at send?
 *
 * AC2 says both parties see the IDENTICAL snapshot. "Identical" that nobody checks
 * is a claim, not a property — this is what makes it checkable on the device that
 * is showing it. A mismatch is displayed, never hidden and never silently
 * corrected: a snapshot that does not match its hash is the single most important
 * thing this screen could ever tell someone.
 *
 * Comparison is case-insensitive and trimmed only because hex casing varies
 * between producers; nothing else about the value is normalised.
 */
export function snapshotVerifies(actualSha256: string, frozenSha256: string): boolean {
  const a = actualSha256.trim().toLowerCase();
  const b = frozenSha256.trim().toLowerCase();
  if (!a || !b) return false;
  return a === b;
}
