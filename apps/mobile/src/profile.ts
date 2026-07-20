/**
 * Who the user is — name + business + trade. This is the gap the user named: before
 * this, the app knew only a login email. Kept deliberately MINIMAL (research, 2026-07-17):
 * Jobber's long "team size / revenue / how did you hear" wizard BEFORE first value is
 * the single most-criticized onboarding pattern, and CompanyCam keeps trade/role out of
 * the app itself. So we collect only what actually personalises a proposal — name,
 * solo-or-company, trade — and defer everything else.
 *
 * Stored TWICE: cached locally in device_settings so the app can greet the user and
 * gate onboarding OFFLINE (mandate #7, no round-trip), and best-effort on the Supabase
 * auth user (user_metadata) so it follows the account across devices. The local cache
 * is the source of truth for the UI; a failed sync never loses it or blocks setup.
 */
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';
import type { SupabaseConnector } from './connector';

export type Profile = {
  name: string;
  isSolo: boolean;
  company: string | null;   // null when solo
  trade: string | null;     // optional (skippable)
};

async function setKV(db: AbstractPowerSyncDatabase, k: string, v: string) {
  await db.execute(
    `INSERT INTO device_settings (k, v) VALUES (?, ?)
     ON CONFLICT(k) DO UPDATE SET v = excluded.v`, [k, v]);
}
async function getKV(db: AbstractPowerSyncDatabase, k: string): Promise<string | null> {
  const r = (await db.getAll<{ v: string }>(`SELECT v FROM device_settings WHERE k = ?`, [k]))[0];
  return r?.v ?? null;
}

export async function saveProfile(
  connector: SupabaseConnector, db: AbstractPowerSyncDatabase, p: Profile
): Promise<void> {
  // Local cache first — the profile is set even with no signal.
  await setKV(db, 'profile_name', p.name.trim());
  await setKV(db, 'profile_is_solo', p.isSolo ? 'yes' : 'no');
  await setKV(db, 'profile_company', p.company?.trim() ?? '');
  await setKV(db, 'profile_trade', p.trade ?? '');
  await setKV(db, 'profile_done', 'yes');
  // Then the account, best-effort. Offline is the normal case; it reconciles on the
  // next auth call and the local cache already carries the UI.
  try {
    await connector.client.auth.updateUser({
      data: {
        full_name: p.name.trim(),
        is_solo: p.isSolo,
        company_name: p.company?.trim() || null,
        trade: p.trade,
      },
    });
  } catch { /* never let a sync failure lose the profile or wedge onboarding */ }
}

export async function getProfile(db: AbstractPowerSyncDatabase): Promise<Profile | null> {
  if ((await getKV(db, 'profile_done')) !== 'yes') return null;
  return {
    name: (await getKV(db, 'profile_name')) ?? '',
    isSolo: (await getKV(db, 'profile_is_solo')) === 'yes',
    company: (await getKV(db, 'profile_company')) || null,
    trade: (await getKV(db, 'profile_trade')) || null,
  };
}

export async function hasProfile(db: AbstractPowerSyncDatabase): Promise<boolean> {
  return (await getKV(db, 'profile_done')) === 'yes';
}

/** Trade options for the picker. Keys map to i18n `trade.*`; value stored as the key. */
export const TRADES = [
  'roofing', 'hvac', 'plumbing', 'electrical', 'painting',
  'concrete', 'landscaping', 'remodeling', 'general', 'other',
] as const;
