/**
 * Grouping a conversation by DAY, and the label on each divider.
 *
 * hadar 2026-08-13: "group messages by date and add a time to the message at the bottom
 * right" — with WhatsApp as the reference, where the thread is broken by a centred pill
 * reading "Today", "Yesterday" or "Tue, Aug 4".
 *
 * PURE, and in its own module, so it runs under `node --test`. The thread renderer
 * imports react-native and cannot; the grouping rule is the part with edge cases worth
 * pinning — a day boundary, an empty thread, two messages a minute apart either side of
 * midnight — and none of them need a phone to check.
 */

/** A local-time day key. NOT a UTC date: a message sent at 11pm belongs to the evening
 *  the person remembers, not to tomorrow in London. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export type DayGroup<T> = { key: string; atMs: number; items: T[] };

/**
 * Split a chronological list into consecutive same-day runs.
 *
 * Consecutive, not bucketed: the input is already sorted, and re-sorting into a map
 * would silently reorder a thread whose order is the whole meaning of it. Two runs with
 * the same key can therefore never appear — if they did, the caller handed us an
 * unsorted thread and the divider would be the visible symptom, which is the right
 * place for that bug to show up.
 */
export function groupByDay<T extends { atMs: number }>(items: readonly T[]): DayGroup<T>[] {
  const out: DayGroup<T>[] = [];
  for (const it of items) {
    const key = dayKey(it.atMs);
    const last = out[out.length - 1];
    if (last && last.key === key) last.items.push(it);
    else out.push({ key, atMs: it.atMs, items: [it] });
  }
  return out;
}

/** How many days apart two instants are, by local calendar day rather than by hours —
 *  23:59 and 00:01 are one day apart, not zero. */
function daysBetween(ms: number, nowMs: number): number {
  const a = new Date(ms); const b = new Date(nowMs);
  const da = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const db = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((db - da) / 86_400_000);
}

/**
 * The divider's words. "Today" and "Yesterday" carry recency faster than a date the
 * reader has to compare against a calendar; anything older gets "Tue, Aug 4", and
 * anything from another year gets the year too — a thread that has run that long is
 * exactly where a bare "Aug 4" becomes a guess.
 */
export function dayLabel(
  ms: number, nowMs: number, locale: string,
  words: { today: string; yesterday: string }
): string {
  const diff = daysBetween(ms, nowMs);
  if (diff === 0) return words.today;
  if (diff === 1) return words.yesterday;
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date(nowMs).getFullYear();
  return d.toLocaleDateString(locale, sameYear
    ? { weekday: 'short', month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "6:19 PM" — the stamp that sits in the corner of a bubble. Time only: the day is
 *  already stated by the divider above it, and repeating it in every bubble is the
 *  width this change exists to reclaim. */
export function messageTime(ms: number, locale: string): string {
  return new Date(ms).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}
