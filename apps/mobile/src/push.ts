/**
 * Push-token registration — the client half of REQ-NOTIF1's remote push. Gets this
 * device's Expo push token and stores it (RLS-gated own row) so the worker can reach
 * the contractor when the app is closed.
 *
 * REQUIRES AN EAS PROJECT ID. Expo's push service issues tokens per EAS project, so
 * getExpoPushTokenAsync needs a projectId — without it it THROWS (review 2026-07-25:
 * the feature would otherwise ship dark).
 *
 * ─── IT SHIPPED DARK ANYWAY (found 2026-08-18) ──────────────────────────────────
 * This read ONLY `process.env.EXPO_PUBLIC_EAS_PROJECT_ID`, which is not set in this
 * repo — while `app.json` has carried `extra.eas.projectId` the whole time. So every
 * launch logged "remote push disabled" and returned, and the live database held ZERO
 * rows in `push_token`: verified, not inferred.
 *
 * The consequence was the entire 379 pipeline being decorative. Triggers enqueued
 * verdicts and opens, the worker claimed them, found no tokens for the user, and marked
 * them sent — six notifications, all `sent_at` set, none delivered to anything. The
 * "reserved; nobody to reach" branch in `apps/worker/src/notifications.ts` was doing all
 * the work.
 *
 * So the id now comes from the app's OWN CONFIG first, which is where `eas init` writes
 * it and where it cannot drift from the build, with the env var kept as an override for
 * a build that needs to point somewhere else. A value that has to be duplicated into an
 * untracked file to work is a value that will be missing.
 *
 * Best-effort otherwise: no permission = quiet no-op (mandate #7 — push is opportunistic).
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import type { SupabaseClient } from '@supabase/supabase-js';

/** app.json's `extra.eas.projectId`, however this build exposes it. `easConfig` is where
 *  a native build surfaces it and `expoConfig.extra` is where the manifest does; taking
 *  both means the token works in dev and in a store build without a second setting. */
function easProjectId(): string | undefined {
  const c = Constants as unknown as {
    easConfig?: { projectId?: string };
    expoConfig?: { extra?: { eas?: { projectId?: string } } };
  };
  return process.env.EXPO_PUBLIC_EAS_PROJECT_ID
    || c.expoConfig?.extra?.eas?.projectId
    || c.easConfig?.projectId;
}

export async function registerPushToken(
  supabase: SupabaseClient, userId: string,
): Promise<void> {
  const projectId = easProjectId();
  if (!projectId) {
    console.log('[push] remote push disabled — no EAS projectId (run `eas init`)');
    return;
  }
  try {
    const N = await import('expo-notifications');
    let status = (await N.getPermissionsAsync()).status;
    if (status !== 'granted') status = (await N.requestPermissionsAsync()).status;
    if (status !== 'granted') return;
    const tok = await N.getExpoPushTokenAsync({ projectId });
    const token = tok?.data;
    if (!token) return;
    const { error } = await supabase.from('push_token').upsert({
      user_id: userId, token, platform: Platform.OS, updated_at: new Date().toISOString(),
    });
    // REPORTED, not swallowed. A refused upsert (RLS, a missing table) leaves the whole
    // remote-push pipeline dark in exactly the way this file just spent three years
    // being dark — silently, with everything upstream of it appearing to work.
    if (error) console.log('[push] token upsert refused:', error.message);
    else console.log('[push] registered', token.slice(0, 24) + '…');
  } catch (e: any) {
    // Observable, not a silent swallow — a dead push pipeline should be visible.
    console.log('[push] registration failed:', e?.message ?? String(e));
  }
}
