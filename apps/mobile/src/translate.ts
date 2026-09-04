/**
 * The DEVICE half of the translate-once layer (LANGUAGE-LAYER slice 3).
 *
 * hadar, 2026-09-03: "the homeowner can respond to the messages in english, and the
 * user will read them in the app in spanish." The client's words stay exactly as
 * written — the original is the record — and what this produces is DISPLAY text,
 * cached on the device so a message is translated once per phone, and behind that once
 * per sentence ever (translate-v1's server cache).
 *
 * OFFLINE-FORWARD (mandate #7): a translation that cannot be fetched is a missing
 * nicety, not an error. The caller renders the original and this fills in on a later
 * pass — the same shape as every other opportunistic network read in this app.
 */
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sha256 } from 'js-sha256';
import type { SendLang } from './langpack';

const DDL = `CREATE TABLE IF NOT EXISTS msg_translation (
  key    TEXT NOT NULL PRIMARY KEY,
  target TEXT NOT NULL,
  body   TEXT NOT NULL
) STRICT`;

let ensured = false;
async function ensure(db: AbstractPowerSyncDatabase) {
  if (ensured) return;
  ensured = true;          // one attempt per launch — a throw must not retry-loop
  try { await db.execute(DDL); } catch { /* readers fall back to originals */ }
}

const keyFor = (target: string, text: string) => sha256(`${target}\n${text}`);

/**
 * Translate `texts` into `target` for display. Returns a map from ORIGINAL text to
 * translated text; anything missing from the map should be rendered as-is. Never
 * throws. Batches the misses into one function call.
 */
export async function translateForDisplay(
  db: AbstractPowerSyncDatabase, client: SupabaseClient,
  texts: string[], target: SendLang,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uniq = [...new Set(texts.map((t) => t.trim()).filter(Boolean))];
  if (!uniq.length) return out;
  await ensure(db);

  const misses: string[] = [];
  for (const t of uniq) {
    try {
      const r = await db.getAll<{ body: string }>(
        `SELECT body FROM msg_translation WHERE key = ?`, [keyFor(target, t)]);
      if (r.length) out.set(t, r[0].body);
      else misses.push(t);
    } catch { misses.push(t); }
  }
  if (!misses.length) return out;

  try {
    const { data, error } = await client.functions.invoke('translate-v1', {
      body: { texts: misses, target },
    });
    if (error || !data?.ok || !Array.isArray(data.texts)) return out;
    for (let i = 0; i < misses.length; i++) {
      const tr = data.texts[i];
      if (typeof tr !== 'string' || !tr.trim()) continue;
      out.set(misses[i], tr);
      try {
        await db.execute(
          `INSERT OR REPLACE INTO msg_translation (key, target, body) VALUES (?,?,?)`,
          [keyFor(target, misses[i]), target, tr]);
      } catch { /* uncached is only slower */ }
    }
  } catch { /* offline: originals render, a later pass fills in */ }
  return out;
}
