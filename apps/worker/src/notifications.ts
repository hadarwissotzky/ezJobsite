/**
 * Push notification drainer — REQ-NOTIF1's send half. Reads notification_outbox rows
 * that triggers wrote (a verdict, an open), looks up the recipient's Expo push tokens,
 * and sends via Expo's free push service. No API key needed.
 *
 * DELIVERY IS AT-MOST-ONCE by design: claim_notifications RESERVES a row (sets
 * sent_at) under SKIP LOCKED before we send, so concurrent workers never duplicate a
 * push, and a send that fails after the reserve is DROPPED rather than retried — for a
 * notification a rare miss beats a duplicate, and the in-app feed still carries the
 * event. Dead tokens (DeviceNotRegistered) are pruned from the per-ticket response.
 *
 * Runs from the worker's idle cycle (run.ts) — no new process, no pg_net.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

const EXPO_PUSH = 'https://exp.host/--/api/v2/push/send';

export async function drainNotifications(sb: SupabaseClient, limit = 20): Promise<number> {
  // Atomic claim: the RPC reserves the rows (sets sent_at) under SKIP LOCKED, so two
  // concurrent workers never send the same push twice. Reserve-BEFORE-send means a
  // failed send is dropped, not retried — a rare miss beats spamming the contractor.
  const { data: rows, error } = await sb.rpc('claim_notifications', { p_limit: limit });
  if (error || !rows?.length) return 0;

  let sent = 0;
  for (const r of rows as any[]) {
    try {
      const { data: toks } = await sb.from('push_token').select('token').eq('user_id', r.user_id);
      const tokens = (toks ?? []).map((t: any) => t.token as string);
      if (tokens.length === 0) { sent++; continue; }  // reserved; nobody to reach
      const resp = await fetch(EXPO_PUSH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(tokens.map((to) => ({
          to, title: r.title, body: r.body, data: r.data ?? {}, sound: 'default',
        }))),
      });
      const out: any = await resp.json().catch(() => null);
      // Expo returns 200 with PER-TICKET status; a dead token is DeviceNotRegistered.
      // Prune those so we stop sending to unregistered devices (review 2026-07-25).
      const tickets: any[] = out?.data ?? [];
      for (let i = 0; i < tickets.length && i < tokens.length; i++) {
        if (tickets[i]?.status === 'error' && tickets[i]?.details?.error === 'DeviceNotRegistered') {
          await sb.from('push_token').delete().eq('token', tokens[i]);
        }
      }
      sent++;
    } catch (e: any) {
      // Row is already reserved (sent_at set by claim) — record why, do not resend.
      await sb.from('notification_outbox').update({ last_error: String(e?.message ?? e) }).eq('id', r.id);
    }
  }
  return sent;
}
