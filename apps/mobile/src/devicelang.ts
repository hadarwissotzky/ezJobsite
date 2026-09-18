/**
 * WHAT LANGUAGE IS THIS PHONE IN?
 *
 * The app shipped with `current: Lang = 'en'` in i18n and no reader for the
 * handset's own setting, so a contractor whose ENTIRE PHONE is in Spanish — who
 * told Apple that himself, deliberately, with no prompt from us — opened the app
 * and got English. The Spanish copy was already there and complete; nothing ever
 * selected it. His only way across was a chip on the cover that did nothing
 * (`View`, not `Pressable`) and a profile form five screens later, behind the
 * OTP. That is a language question asked in a language he may not read, which is
 * a question that cannot work.
 *
 * SO WE DETECT INSTEAD OF ASKING. The device locale is the strongest statement
 * of language preference that exists: the user set it, on purpose, and the OS
 * hands it over for free. Asking him to restate it is making the man teach the
 * tool — the exact inversion of the north star.
 *
 * NO NEW DEPENDENCY, DELIBERATELY. `expo-localization` is a native module, so
 * adopting it would mean a store build to fix a bug that is pure JS otherwise —
 * and this ships over OTA to phones that are wrong TODAY. Three readers, in
 * order of reliability, because Hermes' Intl is built with varying ICU support
 * and can answer 'en-US' on a Spanish handset:
 *
 *   1. `Intl.DateTimeFormat().resolvedOptions().locale` — correct where Hermes
 *      has real ICU. Already relied on elsewhere (changeorder.ts formats dates
 *      with `toLocaleDateString`), so it is present.
 *   2. iOS `SettingsManager.settings.AppleLanguages` / `AppleLocale` — the raw
 *      preference list, in the user's own priority order.
 *   3. Android `I18nManager.localeIdentifier`.
 *
 * Whichever answers first with a language we actually ship wins.
 *
 * ONLY THE PREFIX IS MATCHED. 'es-419', 'es-US' and 'es-MX' are all Spanish to
 * us, and a full-tag comparison would miss every one of them — es-419 (Latin
 * American Spanish) is the single most likely tag in this user base.
 *
 * RETURNS NULL rather than guessing 'en'. Null means "the phone is in something
 * we do not ship", which the caller must treat differently from "the phone is in
 * English" — the first deserves a question, the second does not.
 */
import { NativeModules, Platform } from 'react-native';

import type { Lang } from './i18n';

/** The languages the app actually has dictionaries for. Anything else is null. */
function fromTag(tag: unknown): Lang | null {
  if (typeof tag !== 'string' || !tag) return null;
  // 'es_419', 'es-MX', 'ES' -> 'es'
  const prefix = tag.toLowerCase().replace(/_/g, '-').split('-')[0];
  return prefix === 'es' ? 'es' : prefix === 'en' ? 'en' : null;
}

export function deviceLang(): Lang | null {
  const tags: unknown[] = [];

  try {
    tags.push(Intl.DateTimeFormat().resolvedOptions().locale);
  } catch { /* no Intl / no ICU — the native readers below still answer */ }

  try {
    if (Platform.OS === 'ios') {
      const s = (NativeModules as any)?.SettingsManager?.settings;
      // AppleLanguages is the ORDERED preference list; its head is what he reads.
      if (Array.isArray(s?.AppleLanguages)) tags.push(s.AppleLanguages[0]);
      // AppleLocale is the region format ("es_US"), a weaker but real signal.
      tags.push(s?.AppleLocale);
    } else {
      tags.push((NativeModules as any)?.I18nManager?.localeIdentifier);
    }
  } catch { /* a missing native module is not an error — Intl may have answered */ }

  for (const t of tags) {
    const l = fromTag(t);
    if (l) return l;
  }
  return null;
}
