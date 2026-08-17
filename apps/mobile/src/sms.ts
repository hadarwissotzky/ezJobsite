/**
 * SMS delivery — invoke the send-sms Edge Function (Twilio) to text an approval link
 * or an invite. The credentials live in Edge secrets; the client only asks.
 *
 * FALLBACK. If the function is not deployed / not configured, this returns a reason,
 * and the caller keeps the manual "Send by text" (OS share sheet) as the always-works
 * path — automatic SMS is an upgrade, never the only way a link can reach the client.
 */
import { SupabaseClient } from '@supabase/supabase-js';

/**
 * THE COMPLIANCE FOOTER, ON EVERY MESSAGE THIS APP SENDS.
 *
 * Carriers require an A2P message to identify its sender and to tell the recipient how
 * to stop. Twilio answers the word STOP automatically, but that is the PLUMBING — the
 * recipient still has to be told the word exists, and CTIA guidance puts that in the
 * message content.
 *
 * WHY IT IS APPENDED HERE AND NOT BUILT INTO THE MESSAGE.
 * The approval text is `shown_content` — the FROZEN INSTRUMENT the client signs, which
 * `240_shown_content_integrity.sql` requires to contain the displayed figure literally.
 * Adding a line to it would be editing a legal document to satisfy a telecoms rule.
 * The SMS is the ENVELOPE, not the instrument: the footer rides outside the frozen
 * text, after the link, and what the signer sees on the approval page is untouched.
 *
 * ONE PLACE, so no send path can escape it — approvals, reminders and invites all
 * pass through `sendSms`, and a footer added at three call sites is two chances to
 * forget one.
 */
const SMS_FOOTER = '\n\nSent by EZchangeorder. Reply STOP to opt out.';

export async function sendSms(
  supabase: SupabaseClient, to: string, body: string
): Promise<{ ok: true; sid: string | null } | { ok: false; reason: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('send-sms', {
      body: { to, body: body.trimEnd() + SMS_FOOTER },
    });
    if (error) return { ok: false, reason: error.message };
    if (data && (data as any).ok === false) return { ok: false, reason: (data as any).error ?? 'send failed' };
    return { ok: true, sid: (data as any)?.sid ?? null };
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? String(e) };
  }
}
