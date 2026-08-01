/**
 * R1 — "Send to" on the preview card: what the GPS suggests, and what a human
 * still has to tap.
 *
 * PURE. No imports, for the reason `approverrouting.ts` gives: this decides
 * where a priced commitment is addressed, it is a pure function of its inputs,
 * and it must be testable without PowerSync. The database half lives in
 * `sendtoprep.ts`.
 *
 * THE RULE, from PRD R1 and mandate #2: SUGGEST, NEVER DECIDE. Specifically:
 *
 *  - One known project in range -> pre-fill it and SAY WHY ("📍 Detected — you're
 *    at the Elm St job"). A pre-filled field the sender reads and taps past is
 *    not an automated send; a silently chosen recipient is.
 *  - Two or more in range -> `selectedId` is NULL. The duplex case. A three-metre
 *    difference between two jobsites is noise, not a signal, and the app filing
 *    the extra to the wrong half of a duplex produces an approval that binds the
 *    wrong homeowner. `projects.ts:resolveProject` already refuses to pick; this
 *    refuses to pre-select, which is the same refusal one screen later.
 *  - A fix that matches nothing -> recents. NOT the nearest project: the fix is
 *    positive evidence he is somewhere else, not an absence of evidence.
 *  - No fix at all -> recents, and capture is unaffected. Basement, permission
 *    denied, airplane mode. Mandate #7.
 */

export type SendToProject = {
  id: string;
  name: string;
  /** Metres from the capture fix, or null when there was no fix / no pin. */
  distanceM: number | null;
  /** 0 = never sent to. Drives the recents order. */
  lastUsedMs: number;
  /** null = we have no way to reach them yet. The UI must not offer Send. */
  phoneE164: string | null;
};

/**
 * `selectedId` is the field the preview card binds to. It is null in exactly the
 * cases where the system is not entitled to have an opinion, and that null is the
 * mechanism by which "the system never auto-selects between them" is enforced —
 * not a comment asking the UI to behave.
 */
export type SendToPrefill = {
  kind:
    | 'detected'   // exactly one project in range; pre-filled, one tap to change
    | 'pick'       // two or more in range; nothing pre-filled
    | 'recents'    // no fix, or a fix matching nothing
    | 'empty';     // nowhere to send yet; quick-add is the only path
  selectedId: string | null;
  options: SendToProject[];
  /** Rendered verbatim to the contractor. Never logged-only, never hidden. */
  reasonKey:
    | 'r1.sendto.detected'
    | 'r1.sendto.twoInRange'
    | 'r1.sendto.notAtAnyJob'
    | 'r1.sendto.noLocation'
    | 'r1.sendto.nothingYet';
  reasonParams: { name?: string; n?: number };
};

/**
 * How many recents to show. Five, because this list is read one-handed on a
 * ladder and a scrolling picker there is a mis-tap. Overridable so a test can
 * pin it rather than depend on the constant.
 */
export const MAX_RECENTS = 5;

/** Most recently sent-to first, then by name so the order never depends on row order. */
function byRecency(a: SendToProject, b: SendToProject): number {
  return b.lastUsedMs - a.lastUsedMs || a.name.localeCompare(b.name);
}

export function sendToPrefill(o: {
  /** Projects whose geofence contains the capture fix. Empty when there was no fix. */
  inRange: SendToProject[];
  /** Every other active project, for the fallback list. */
  others: SendToProject[];
  /** Did the capture get a location at all? Distinguishes "not here" from "don't know". */
  hasFix: boolean;
  maxRecents?: number;
}): SendToPrefill {
  const max = o.maxRecents ?? MAX_RECENTS;
  const inRange = [...o.inRange].sort(
    (a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity) || a.name.localeCompare(b.name)
  );

  if (inRange.length === 1) {
    return {
      kind: 'detected',
      selectedId: inRange[0].id,
      // The rest of the list still travels with it: "changeable in one tap" means
      // the alternatives are already on screen, not behind a search box.
      options: [inRange[0], ...[...o.others].sort(byRecency).slice(0, max)],
      reasonKey: 'r1.sendto.detected',
      reasonParams: { name: inRange[0].name },
    };
  }

  if (inRange.length > 1) {
    return {
      kind: 'pick',
      selectedId: null,              // the duplex refusal. See the header.
      options: inRange,
      reasonKey: 'r1.sendto.twoInRange',
      reasonParams: { n: inRange.length },
    };
  }

  // Nothing in range from here down. De-dup is unnecessary (inRange is empty) but
  // the recents cap is not: an unbounded list is the same mis-tap risk.
  const recents = [...o.others].sort(byRecency).slice(0, max);
  if (!recents.length) {
    return { kind: 'empty', selectedId: null, options: [],
             reasonKey: 'r1.sendto.nothingYet', reasonParams: {} };
  }
  return {
    kind: 'recents',
    // NOT pre-selected even though the top recent is a decent guess. A recent job
    // is where he WAS; the fix says nothing about where he is now, or says he is
    // somewhere else entirely. Pre-filling that is a guess wearing a suggestion's
    // clothes, and the tap it saves is not worth the wrong homeowner.
    selectedId: null,
    options: recents,
    reasonKey: o.hasFix ? 'r1.sendto.notAtAnyJob' : 'r1.sendto.noLocation',
    reasonParams: {},
  };
}

// ── quick-add (name + phone) ───────────────────────────────────────────────────

export type QuickAddCheck =
  | { ok: true; name: string; phoneE164: string | null }
  | { ok: false; problemKey: 'r1.quickadd.needName' | 'r1.quickadd.badPhone' };

/**
 * Validate a quick-add destination. PRD R1: "via recents or quick-add (name +
 * phone)".
 *
 * THE PHONE NUMBER IS A NUMBER, so mandate #6 applies: never invent digits, and
 * refuse rather than store something unusable. A number that is silently wrong
 * fails at the one moment it matters — when the approval link is sent and never
 * arrives — and by then the contractor believes the homeowner is ignoring him.
 *
 * The ONE assumption made, and it is stated rather than hidden: a bare 10-digit
 * number is treated as North American (+1). That is a country code we added,
 * which is exactly the kind of invention mandate #6 warns about — so the
 * normalised result is returned for the UI to DISPLAY BACK before anything is
 * sent. The user sees "+1 512 555 0147" and can correct it. An assumption shown
 * is a different thing from an assumption made.
 *
 * A blank phone is ALLOWED and yields null. A name-only destination is still
 * worth recording — you often know the job before you know the number — and
 * refusing it would push someone into typing a fake number to get past the form.
 * `canSend()` below is what stops a link going nowhere.
 */
export function checkQuickAdd(raw: { name: string; phone: string }): QuickAddCheck {
  const name = (raw.name ?? '').trim();
  if (!name) return { ok: false, problemKey: 'r1.quickadd.needName' };

  const typed = (raw.phone ?? '').trim();
  if (!typed) return { ok: true, name, phoneE164: null };

  const e164 = toE164(typed);
  if (!e164) return { ok: false, problemKey: 'r1.quickadd.badPhone' };
  return { ok: true, name, phoneE164: e164 };
}

/**
 * Normalise a typed number to E.164, or null if it cannot be read as one.
 *
 * EXTRACTED from checkQuickAdd (2026-08-01) so sign-in and quick-add share ONE
 * parser. They must: the number a contractor types to log in and the number he
 * types to reach a homeowner are the same kind of value, and two parsers would
 * be two places for the +1 assumption above to drift. The reasoning in the
 * comment above — never invent digits, show the assumption back — governs both.
 *
 * Null means "cannot be read", NOT "empty". Callers distinguish the two, because
 * quick-add allows a blank number and sign-in does not.
 */
export function toE164(raw: string): string | null {
  const typed = (raw ?? '').trim();
  if (!typed) return null;

  const plus = typed.startsWith('+');
  const digits = typed.replace(/\D/g, '');

  if (plus) {
    // Already international: trust the digits, check only that they could be a
    // number at all. E.164 is 8-15 digits including the country code.
    if (digits.length < 8 || digits.length > 15) return null;
    return `+${digits}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  // Anything else: we would be guessing which digits are the country code.
  return null;
}

/** Can an approval link actually reach this destination? Read by the Send button. */
export function canSend(phoneE164: string | null): boolean {
  return typeof phoneE164 === 'string' && /^\+\d{8,15}$/.test(phoneE164);
}

/**
 * Group an E.164 number for display so a human can proof-read it. Formatting
 * only — it never changes the digits, and a number it does not recognise is
 * returned untouched rather than mangled into something that looks official.
 */
export function displayPhone(phoneE164: string | null): string {
  if (!phoneE164) return '';
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(phoneE164);
  return m ? `+1 ${m[1]} ${m[2]} ${m[3]}` : phoneE164;
}
