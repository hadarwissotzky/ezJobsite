/**
 * Who counts as the SAME person across jobs.
 *
 * ITS OWN FILE, and that is the point: `approvers.ts` imports `./i18n`, which Node's
 * test runner cannot resolve, so nothing in that module can be unit-tested. This
 * rule decides what the client picker offers and it is a pure function of two
 * strings — exactly the shape that should be tested rather than eyeballed. A leaf
 * with no imports is what makes that possible. (`approvers.ts` re-exports it, so
 * callers are unaffected.)
 *
 * THE PHONE NUMBER WINS when there is one: two "Sarah"s on different streets are
 * two people, and one Sarah typed once as "Sarah" and once as "Sarah M." is one
 * person. The last 10 digits are compared so that +1-prefixed and bare forms of the
 * same US mobile agree — contact-picker imports are not normalised to E.164.
 *
 * WITHOUT a number it falls back to a loosened name (case, surrounding and repeated
 * whitespace). Deliberately loose, because the two failure directions do not cost
 * the same: over-merging shows one wrong name that a human reads on the very next
 * screen and can correct, while under-merging shows the same person once per job,
 * which makes the list useless and sends him back to the phone's contact picker —
 * the trip this exists to remove.
 *
 * A string too short to be a phone number (an extension, "call the office") is
 * treated as NO number rather than as an identity of its own; otherwise every such
 * row becomes its own person.
 */
export function personKey(name: string, phone: string | null): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length >= 7) return `p:${digits.slice(-10)}`;
  return `n:${name.trim().toLowerCase().replace(/\s+/g, ' ')}`;
}
