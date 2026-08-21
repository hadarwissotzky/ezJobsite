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
  connector: SupabaseConnector, db: AbstractPowerSyncDatabase, p: Profile,
  /** The display language chosen during setup. Written to the account so a reinstall
   *  does not put a Spanish-speaking contractor back into English — see
   *  `restoreProfileFromAccount`. Optional so existing call sites are unaffected. */
  lang?: string | null,
): Promise<void> {
  // Local cache first — the profile is set even with no signal.
  await setKV(db, 'profile_name', p.name.trim());
  await setKV(db, 'profile_is_solo', p.isSolo ? 'yes' : 'no');
  await setKV(db, 'profile_company', p.company?.trim() ?? '');
  await setKV(db, 'profile_trade', p.trade ?? '');
  await setKV(db, 'profile_done', 'yes');
  // Then the account, best-effort. Offline is the normal case; it reconciles on the
  // next auth call and the local cache already carries the UI.
  //
  // THIS MIRROR IS NOT DECORATIVE, and for a long time it may as well have been:
  // nothing ever read it back, so a reinstall asked a five-year customer who he was
  // (hadar, 2026-08-21). `restoreProfileFromAccount` is the other half.
  try {
    await connector.client.auth.updateUser({
      data: {
        full_name: p.name.trim(),
        is_solo: p.isSolo,
        company_name: p.company?.trim() || null,
        trade: p.trade,
        ...(lang ? { lang } : {}),
      },
    });
  } catch { /* never let a sync failure lose the profile or wedge onboarding */ }
}

/**
 * Rebuild the local profile cache from the signed-in account.
 *
 * COSTS NOTHING AND NEEDS NO SIGNAL: `user_metadata` rides inside the session that is
 * already in hand, so this works on a reinstall in a basement — which is the situation
 * it exists for. It is the read half of the mirror `saveProfile` has always written.
 *
 * `full_name` IS THE TEST, not the mere presence of metadata. Supabase populates
 * `user_metadata` with sign-in details on its own, so an object being there proves
 * nothing; a name proves somebody completed setup. Without one this returns false and
 * the setup flow runs, which is the correct outcome for an account that never had a
 * profile.
 *
 * It writes `profile_done` LAST, for the same reason `claimDevice` records the owner
 * last: that key is what every gate reads, so it must not be true while the fields
 * behind it are half-written.
 *
 * Returns whether a profile was restored, and the display language the account
 * carried (see the note at the end — this module does not own that key).
 */
export async function restoreProfileFromAccount(
  db: AbstractPowerSyncDatabase,
  user: { user_metadata?: Record<string, unknown> | null } | null,
): Promise<{ restored: boolean; lang: 'en' | 'es' | null }> {
  const m = user?.user_metadata ?? null;
  if (!m) return { restored: false, lang: null };
  const name = typeof m.full_name === 'string' ? m.full_name.trim() : '';
  if (!name) return { restored: false, lang: null };

  const company = typeof m.company_name === 'string' ? m.company_name.trim() : '';
  await setKV(db, 'profile_name', name);
  // `is_solo` is stored as a real boolean by `saveProfile`. An account written by an
  // older build may not carry it at all, in which case "has a company name" is the
  // honest inference rather than a guess at the default.
  await setKV(db, 'profile_is_solo',
    typeof m.is_solo === 'boolean' ? (m.is_solo ? 'yes' : 'no') : (company ? 'no' : 'yes'));
  await setKV(db, 'profile_company', company);
  await setKV(db, 'profile_trade', typeof m.trade === 'string' ? m.trade : '');
  await setKV(db, 'profile_done', 'yes');
  // THE LANGUAGE IS HANDED BACK, NOT WRITTEN HERE. Its key belongs to `firstrun.ts`
  // (`saveLang`), and importing that module from this one drags `i18n.ts` into the
  // `node --test` loader, where it does not parse — the same "no expo/RN at module
  // scope" trap `closeaccount.ts` documents, arriving through a transitive import.
  // `accountflags.ts` already imports both and does the write.
  return { restored: true, lang: m.lang === 'en' || m.lang === 'es' ? m.lang : null };
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
