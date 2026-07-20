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

export async function setSeenOnboarding(): Promise<void> {
  try {
    await AsyncStorage.setItem(SEEN_KEY, 'yes');
  } catch { /* non-fatal: worst case the intro shows again next launch */ }
}
