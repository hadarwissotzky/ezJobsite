/**
 * Pre-login onboarding state.
 *
 * The 4-slide intro is shown the FIRST time someone opens the app without a valid
 * session. Once they've seen it, a later logged-out entry (they signed out, or the
 * token expired) goes straight to sign-in -- the intro is an introduction, not a
 * toll booth. Kept in AsyncStorage, not the app's SQLite: it is a device-level UI
 * fact with no bearing on evidence, and it must be readable before the database is
 * up (the onboarding renders while the user is logged out).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const SEEN_KEY = 'onboarding_seen_v1';

export async function getSeenOnboarding(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(SEEN_KEY)) === 'yes';
  } catch {
    return false;               // unreadable -> show it; a repeated intro beats a lost one
  }
}

/**
 * DEV ONLY — forget that the intro was seen, so the next logged-out render shows it.
 *
 * hadar, 2026-08-12: "how can I test it? for me it displays the login screen." He is
 * signed out, so `session` is null — but this flag was set the first time he ever opened
 * the app, months of builds ago, and it is doing exactly what it was written to do. The
 * only ways to clear it were a reinstall (which takes the local capture database with
 * it) or a debugger. Neither is a way to review a design.
 *
 * Not gated here: the caller is, so the shipped app has no path to it.
 */
export async function forgetSeenOnboarding(): Promise<void> {
  try { await AsyncStorage.removeItem(SEEN_KEY); } catch { /* nothing to forget */ }
}

export async function setSeenOnboarding(): Promise<void> {
  try {
    await AsyncStorage.setItem(SEEN_KEY, 'yes');
  } catch { /* non-fatal: worst case the intro shows again next launch */ }
}
