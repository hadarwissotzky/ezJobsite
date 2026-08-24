/**
 * PUT THE CLIENT'S LINK ON THE CLIPBOARD.
 *
 * hadar, 2026-08-24: "user should be able to have access and copy the client portal CO
 * link in case they need to send it via email".
 *
 * The link already existed and was reachable in exactly one way: the share sheet behind
 * Remind, which composes a text message. That is the right default — this contractor
 * already talks to this client by text — but it is not the only way a link travels. A
 * client who reads email, a homeowner's assistant, a second address, a lender who wants
 * it forwarded: all of those need the URL as a URL, and the app had no way to hand it
 * over.
 *
 * IT IS THE SAME LINK. Nothing is minted here. `co_live_link` holds the one live token
 * (250_one_live_link retires the old one the moment a new one is issued), so copying and
 * reminding hand over the same URL and the client can hold only one that works.
 *
 * COPYING IS NOT SENDING, and this deliberately does NOT record one. `noteReminded`
 * burns the 1-per-day reminder, and `shared` on the ledger means the contractor actually
 * handed the link off — both are claims about something that reached a person. A string
 * on a pasteboard has reached nobody yet. The app would be guessing, and the whole point
 * of the reminder ledger is that it is not guessing.
 *
 * REFUSES A LINK THAT IS NOT ONE, same rule and same reason as `shareLink`: without
 * EXPO_PUBLIC_CONFIRM_BASE the stored URL comes out relative ("/confirm.html?t=..."),
 * which pastes into an email as text nobody can open. A refusal the contractor can read
 * beats a silent copy of something broken — he would only find out when the client did.
 */

export type CopyResult = { ok: true } | { ok: false; reason: string };

/** Injected so the rule above is testable without a native pasteboard. */
export type SetString = (text: string) => Promise<void>;

async function pasteboard(text: string): Promise<void> {
  const Clipboard = await import('expo-clipboard');
  await Clipboard.setStringAsync(text);
}

export async function copyLink(
  url: string | null | undefined,
  setString: SetString = pasteboard,
): Promise<CopyResult> {
  const clean = (url ?? '').trim();
  if (!clean) return { ok: false, reason: 'r8.noLink' };
  // A relative path is not a link anyone can open. `shareLink` rejects the same shape.
  if (clean.startsWith('/') || !/^https?:\/\//i.test(clean)) {
    return { ok: false, reason: 'link.notConfigured' };
  }
  try {
    await setString(clean);
    return { ok: true };
  } catch (e: any) {
    // The pasteboard can refuse (a locked device, a restricted profile). Say so rather
    // than showing "Copied" over an empty clipboard — the contractor would paste
    // nothing into an email and never know why.
    return { ok: false, reason: e?.message ?? String(e) };
  }
}
