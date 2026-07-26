/**
 * Push-token registration — the client half of REQ-NOTIF1's remote push. Gets this
 * device's Expo push token and stores it (RLS-gated own row) so the worker can reach
 * the contractor when the app is closed.
 *
 * REQUIRES AN EAS PROJECT ID. Expo's push service issues tokens per EAS project, so
 * getExpoPushTokenAsync needs a projectId — without it it THROWS (review 2026-07-25:
 * the feature would otherwise ship dark). We read it from EXPO_PUBLIC_EAS_PROJECT_ID
 * (hadar: run `eas init`, then set that env var / app.json extra.eas.projectId). When
 * it is missing, we LOG and no-op — remote push is simply off until it is configured,
 * which is observable, not a silent dark pipeline. Everything else about the app works.
 *
 * Best-effort otherwise: no permission = quiet no-op (mandate #7 — push is opportunistic).
 */
import { Platform } from 'react-native';
import type { SupabaseClient } from '@supabase/supabase-js';

export async function registerPushToken(
  supabase: SupabaseClient, userId: string,
): Promise<void> {
  const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
  if (!projectId) {
    console.log('[push] remote push disabled — set EXPO_PUBLIC_EAS_PROJECT_ID (run `eas init`)');
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
    await supabase.from('push_token').upsert({
      user_id: userId, token, platform: Platform.OS, updated_at: new Date().toISOString(),
    });
  } catch (e: any) {
    // Observable, not a silent swallow — a dead push pipeline should be visible.
    console.log('[push] registration failed:', e?.message ?? String(e));
  }
}
