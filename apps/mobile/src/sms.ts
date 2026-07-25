/**
 * SMS delivery — invoke the send-sms Edge Function (Twilio) to text an approval link
 * or an invite. The credentials live in Edge secrets; the client only asks.
 *
 * FALLBACK. If the function is not deployed / not configured, this returns a reason,
 * and the caller keeps the manual "Send by text" (OS share sheet) as the always-works
 * path — automatic SMS is an upgrade, never the only way a link can reach the client.
 */
import { SupabaseClient } from '@supabase/supabase-js';

export async function sendSms(
  supabase: SupabaseClient, to: string, body: string
): Promise<{ ok: true; sid: string | null } | { ok: false; reason: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('send-sms', { body: { to, body } });
    if (error) return { ok: false, reason: error.message };
    if (data && (data as any).ok === false) return { ok: false, reason: (data as any).error ?? 'send failed' };
    return { ok: true, sid: (data as any)?.sid ?? null };
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? String(e) };
  }
}
