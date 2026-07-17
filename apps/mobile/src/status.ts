/**
 * ONE status. — REQ-X3, and it is a core principle, not a polish item.
 *
 *   "Every item surfaces exactly ONE primary, plain-language status (is it safe /
 *    is it done / does it need me); sync × resolution × counterparty states are
 *    detail beneath it, NEVER THREE PARALLEL BADGES."
 *
 * I built the opposite. The app grew EIGHT parallel status surfaces — a red
 * "server refused" banner, an amber consent banner, a green inbox banner, a blue
 * "where it filed" note, a "9 SIN RESPALDO" counter, a parked warning, a
 * per-decision sync line, a per-capture location line — each one added honestly,
 * in its own commit, for its own good reason. Stacked together they are a wall of
 * colour that a man on a ladder cannot parse, and the net effect of eight things
 * shouting is that he reads NONE of them. Every one of my "never silent" fixes
 * made the next one quieter.
 *
 * THE COLLAPSE RULE, and why this order:
 *
 *   NEEDS_YOU  beats everything. Something is wrong and only a person can fix it.
 *   NOT_SAFE   next. It is on this phone and will never leave. Rare and serious.
 *   WAITING    then. Normal, expected, offline-first — mentioned, never alarming.
 *   SAFE       last. Done. Say so once and stop talking.
 *
 * The ordering is by WHAT THE USER MUST DO, not by what the system finds
 * interesting. A capture that is unfiled AND unsynced is ONE problem to him — "it
 * needs a job" — because filing it is the only action he can take; the sync will
 * happen by itself. Showing both is the system narrating its own internals.
 *
 * DETAIL IS REACHABLE, NOT DISPLAYED. The states are still all there in `detail`
 * for a tap-through. X3 does not say lose the information; it says stop leading
 * with it.
 */
import { msg, type Msg } from './i18n';

export type Level = 'needs_you' | 'not_safe' | 'waiting' | 'safe';

/**
 * REQ-PROC4's per-item state: "captured -> queued -> uploaded -> processed".
 *
 * DERIVED, never stored. Each state is a FACT that already exists somewhere:
 *   captured  -- capture_commit has the row (it could not be listed otherwise)
 *   queued    -- capture_outbox still holds the intent
 *   uploaded  -- the outbox is drained AND the server said so
 *   processed -- the server's capture_op_state says so. SERVER-OWNED: only the
 *                server knows whether its pipeline ran, and a client that could
 *                write this could claim work that never happened.
 *
 * A stored state column would be a fifth place for the truth to live and the
 * first place for it to drift. The queue IS the state.
 */
export type ProcState = 'captured' | 'queued' | 'uploaded' | 'processed';

export function procState(c: {
  pendingUpload: boolean;
  serverState: string | null;   // capture_op_state.processing_state, synced down
}): ProcState {
  // The server's word wins when we have it: it is the only party that knows what
  // its own pipeline did.
  if (c.serverState === 'processed') return 'processed';
  if (c.pendingUpload) return 'queued';
  if (c.serverState === 'uploaded') return 'uploaded';
  // No pending intent and NO server word. The bytes may have left, but nothing has
  // confirmed they landed, so we say the weaker true thing. Claiming 'uploaded'
  // from the ABSENCE of a queue row would be inferring success from silence --
  // the phantom-"saved" bug wearing a different hat.
  return 'captured';
}

export type Status = {
  level: Level;
  /** The ONE line. */
  primary: Msg;
  /** Everything else, for a tap-through. Never rendered as a second badge. */
  detail: Msg[];
};

const RANK: Record<Level, number> = { needs_you: 0, not_safe: 1, waiting: 2, safe: 3 };

/**
 * One capture's status.
 *
 * Note what is NOT here: "committed". Every capture in this list is committed by
 * definition — capture_commit IS the list. A "saved ✓" badge on a row that could
 * not exist unless it were saved is decoration, and decoration is what pushed the
 * real warnings off the screen.
 */
export function captureStatus(c: {
  /** REQ-PROC4: where it is in the pipeline. Detail, not the primary line. */
  procState?: ProcState;
  inInbox: boolean;
  rejected: boolean;
  pendingUpload: boolean;
  parked: boolean;
  hasLocation: boolean;
}): Status {
  const detail: Msg[] = [];
  // REQ-PROC4's state is DETAIL beneath the one primary line, exactly as REQ-X3
  // demands: "captured -> queued -> uploaded -> processed" is the system
  // describing its own pipeline, which is not what the user needs to know first.
  if (c.procState) detail.push(msg(`st.proc.${c.procState}`));
  if (c.pendingUpload) detail.push(msg('st.detail.waiting'));
  if (!c.hasLocation) detail.push(msg('st.detail.noLocation'));
  if (c.inInbox) detail.push(msg('st.detail.unfiled'));

  // needs_you: a person must act. Filing is the only thing he can DO.
  if (c.inInbox) return { level: 'needs_you', primary: msg('st.needsJob'), detail };

  // not_safe: it will never leave this phone. Worse than waiting, rarer, and the
  // only status that should ever alarm.
  if (c.rejected || c.parked) return { level: 'not_safe', primary: msg('st.wontBackUp'), detail };

  // waiting: the normal offline case. Mentioned, not alarming — mandate #7 says
  // no signal is the expected condition, so this is not a problem, it is Tuesday.
  if (c.pendingUpload) return { level: 'waiting', primary: msg('st.waitingBackup'), detail };

  return { level: 'safe', primary: msg('st.backedUp'), detail };
}

/**
 * The ONE thing the whole screen says, if it says anything.
 *
 * Not a sum, not a list: the single most urgent thing across every item, with a
 * count. Eight banners become one line, and the line is about what to DO.
 */
export function screenStatus(items: Status[]): Status | null {
  if (!items.length) return null;
  const worst = items.reduce((a, b) => (RANK[b.level] < RANK[a.level] ? b : a));
  if (worst.level === 'safe') return null;   // nothing to say. Say nothing.

  const n = items.filter((i) => i.level === worst.level).length;
  const key = worst.level === 'needs_you' ? 'st.screen.needsYou'
    : worst.level === 'not_safe' ? 'st.screen.notSafe'
    : 'st.screen.waiting';
  return { level: worst.level, primary: msg(key, { n }), detail: worst.detail };
}

/** The one colour that goes with the one status. */
export function levelColor(l: Level): { bg: string; border: string; text: string } {
  switch (l) {
    // Amber, not red: he has to do something, but nothing is wrong.
    case 'needs_you': return { bg: '#2d2410', border: '#7d6320', text: '#f0b72f' };
    // Red is reserved. If everything is red, nothing is.
    case 'not_safe':  return { bg: '#3d1418', border: '#b62324', text: '#ff7b72' };
    // Grey. Waiting is normal and must not look like a fault.
    case 'waiting':   return { bg: '#161b22', border: '#30363d', text: '#8b949e' };
    case 'safe':      return { bg: '#0d1117', border: '#21262d', text: '#7ee787' };
  }
}
