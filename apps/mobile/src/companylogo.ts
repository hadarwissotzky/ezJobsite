/**
 * The company's logo — pick it, keep it, publish it.
 *
 * hadar, 2026-08-12: "Add logo — add that to the drawer".
 *
 * ─── WHY THIS IS WORTH MORE THAN A PICTURE IN A MENU ────────────────────────────
 * `company.logo_key` has existed since 402 and NOTHING HAS EVER WRITTEN IT. The
 * client's approval page already reads it (`confirmation_company_v1`) and draws the
 * letterhead — so every change order this app has ever sent went out with a blank
 * space where the contractor's mark belongs. 402's own header says why that matters:
 * a homeowner is being asked to authorise money by a link from a number they may not
 * have saved, and the letterhead is one of the two facts that make it checkable. This
 * module is the missing half of a feature the server has been waiting on.
 *
 * ─── THE LOCAL FILE IS THE DISPLAY COPY, THE KEY IS THE RECORD ──────────────────
 * Two different jobs, so two different stores:
 *   * a file at `logo/<name>` in documentDirectory — what the DRAWER draws. On disk,
 *     no signed URL, no expiry, no network. Mandate #7: a menu that shows a grey box
 *     in a basement is a menu that looks broken in a basement.
 *   * `company.logo_key` — what the CLIENT'S PAGE reads, minted into a signed URL
 *     server-side at read time.
 * A second device has the key but not the file, so `ensureLogoCached` fetches once and
 * writes the same local path. After that it never asks again.
 *
 * ─── WHAT IT DOES NOT DO ────────────────────────────────────────────────────────
 * No cropping, no resizing beyond what the picker's editor produced, no format
 * conversion. A logo is a file the contractor already owns and has already chosen the
 * shape of; re-encoding it is how a crisp mark becomes a soft one on the one document
 * that carries his name.
 */
import { Buffer } from 'buffer';
import * as FS from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { sha256 } from 'js-sha256';
import type { SupabaseClient } from '@supabase/supabase-js';

const BUCKET = 'captures';
const DIR = FS.documentDirectory + 'company/';

/** Bytes we refuse to upload. A logo is a mark, not a photograph; anything past this
 *  is a camera-roll snapshot picked by mistake, and it would be uploaded on every
 *  device that syncs and re-fetched on every client page load. */
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

export type PickedLogo = { uri: string; mime: string; bytes: number };

/**
 * Where the drawer reads it from.
 *
 * KEYED BY COMPANY **AND** BY THE STORAGE KEY (fixed 2026-08-13, found by review). The
 * key used to be the company alone, and `ensureLogoCached` returns early on any
 * non-empty file at that path — so a second device that had cached logo A would keep
 * drawing logo A forever after the owner replaced it with B. It syncs the new
 * `logo_key`, finds a file, and never looks at the key it just received. Including the
 * key means a NEW logo is a NEW path: the old file is simply orphaned and the new one
 * is fetched, which is the same content-addressed rule the Storage object itself uses.
 *
 * `logoKey` is optional so a caller that only wants to CLEAR the current one (which has
 * no key by then) can still name a file to delete — see removeCompanyLogo.
 */
export function localLogoPath(companyId: string, logoKey?: string | null): string {
  const co = sha256(companyId).slice(0, 16);
  return `${DIR}logo-${co}-${sha256(logoKey ?? '').slice(0, 16)}`;
}

async function ensureDir(): Promise<void> {
  try {
    const info = await FS.getInfoAsync(DIR);
    if (!info.exists) await FS.makeDirectoryAsync(DIR, { intermediates: true });
  } catch { /* a failed mkdir means every read misses; the drawer shows the EZ mark */ }
}

/**
 * Open the picker. Returns null when the user cancelled OR when permission was
 * refused — the caller cannot tell them apart and does not need to: both mean "no
 * logo was chosen", and neither is an error worth a dialog.
 *
 * `allowsEditing` with a 1:1 aspect on purpose. The drawer draws a square; letting a
 * banner through would mean either squashing it (wrong) or letterboxing it into a
 * square (grey bars around a logo, worse). The crop box is the honest place to make
 * that decision, and it is the contractor making it.
 */
export async function pickLogo(): Promise<PickedLogo | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1,
  });
  if (res.canceled || !res.assets?.length) return null;
  const a = res.assets[0];
  const info = await FS.getInfoAsync(a.uri);
  const bytes = (info as any).size ?? 0;
  return { uri: a.uri, mime: a.mimeType || 'image/jpeg', bytes };
}

export type SaveLogoResult =
  /**
   * `logoKey` is RETURNED, not left for the caller to look up. It used to be re-read from
   * the local `company` table, which is EMPTY on a real device (letterhead.ts's header
   * explains the sync gap) — so after a successful upload the caller set its key to null,
   * and the Remove button then had nothing to delete. The value is right here; handing it
   * back is cheaper and cannot be wrong.
   */
  | { ok: true; localUri: string; logoKey: string }
  | { ok: false; reason: 'too_big' | 'read_failed' | 'upload_failed' | 'save_failed';
      /** The SERVER'S own words, when it had any. Carried rather than translated into
       *  our guess: "only the owner can change the logo" is the RIGHT message for a
       *  42501 and a LIE for a missing function, and the caller cannot tell which
       *  happened. Shown verbatim beneath our sentence when present. */
      detail?: string };

/**
 * Commit a picked logo: local copy FIRST, then Storage, then the key.
 *
 * THE ORDER IS THE POINT and it is the same order every capture in this app uses. The
 * local copy is what the contractor sees, so it lands before anything can fail over
 * the network; a logo that shows in the drawer while the upload retries is correct,
 * and a logo that vanishes because the jobsite has no signal is not.
 *
 * The Storage key is the CONTENT HASH, so re-picking the same file is a no-op upload
 * and two devices that pick the same file converge on one object.
 */
export async function saveCompanyLogo(
  supabase: SupabaseClient,
  o: { companyId: string; ownerId: string; picked: PickedLogo },
): Promise<SaveLogoResult> {
  if (o.picked.bytes > LOGO_MAX_BYTES) return { ok: false, reason: 'too_big' };

  let b64: string;
  try {
    b64 = await FS.readAsStringAsync(o.picked.uri, { encoding: FS.EncodingType.Base64 });
  } catch { return { ok: false, reason: 'read_failed' }; }

  const bytes = Buffer.from(b64, 'base64');
  /**
   * THE OWNER'S UID COMES FIRST. NOT COSMETIC — IT IS THE RLS PREDICATE.
   *
   * `011_storage_policies.sql` allows a write only when the FIRST path segment is the
   * caller's uid:
   *
   *     (storage.foldername(name))[1] = auth.uid()::text
   *
   * This key used to be `logo/<uid>/<hash>`, whose first segment is the literal word
   * "logo". Every upload was refused with "new row violates row-level security policy",
   * and the READ policy is the same shape, so the signed URL would have failed too.
   * The logo feature has therefore never worked once since it was written on
   * 2026-08-12 — the sheet opened, the picker opened, and the save died at the network
   * with `upload_failed` (hadar, 2026-08-17: "cannot add a logo").
   *
   * `<uid>/logo/<hash>` satisfies the policy and matches every other object in this
   * bucket. No new policy is needed, which is the point: a second policy carved out
   * for one file type is a second thing that can drift from the first.
   *
   * Nothing to migrate — no `company.logo_key` was ever written successfully, so there
   * are no old-format keys in the wild to keep reading.
   */
  const key = `${o.ownerId}/logo/${sha256(bytes)}`;
  const local = localLogoPath(o.companyId, key);

  /**
   * THE SERVER GOES FIRST NOW (fixed 2026-08-13, found by review).
   *
   * The local copy used to be written before either network call, on the reasoning that
   * a contractor should see his logo while the upload retries. That reasoning is right
   * for a CAPTURE — evidence must survive the network — and wrong here, because a logo
   * is not evidence and the write can be REFUSED: `set_company_logo_v1` is owner-only,
   * and the drawer's brand block is tappable by any member. A crew member picked an
   * image, the RPC raised 42501, the error was shown — and the rejected image stayed as
   * that device's cached logo permanently, because nothing ever deleted it.
   *
   * So: upload, then record the key, and only cache locally once the server has agreed
   * the mark is the company's. The cost is that a logo set with no signal does not
   * appear until it can be saved, which is the honest outcome for a field nobody loses
   * work over.
   */
  try {
    const up = await supabase.storage.from(BUCKET).upload(key, bytes, {
      contentType: o.picked.mime, upsert: false,
    });
    // "Already exists" IS success: the key is the content hash, so the object there is
    // byte-for-byte this file. Same rule as the capture and message-photo uploads.
    if (up.error && !/exists|duplicate/i.test(up.error.message)) throw up.error;
  } catch { return { ok: false, reason: 'upload_failed' }; }

  const { error } = await supabase.rpc('set_company_logo_v1', {
    p_company_id: o.companyId, p_logo_key: key,
  });
  if (error) return { ok: false, reason: 'save_failed', detail: error.message };

  await ensureDir();
  try {
    await FS.writeAsStringAsync(local, b64, { encoding: FS.EncodingType.Base64 });
  } catch { /* the key is saved; ensureLogoCached will fetch it on the next read */ }
  return { ok: true, localUri: local, logoKey: key };
}

/**
 * Clear it. The Storage OBJECT IS LEFT IN PLACE, deliberately.
 *
 * Every change order already sent carries a frozen `shown_content` the client signed,
 * and the letterhead they saw is part of what that document looked like. Deleting the
 * object to tidy up would blank the mark on documents that are already evidence. The
 * key is dropped from the company row so FUTURE documents stop using it; the bytes
 * behind old ones stay reachable. (A real erasure request is a different path — the
 * hard-delete carve-out in mandate #5 — not a menu tap.)
 */
export async function removeCompanyLogo(
  supabase: SupabaseClient, o: { companyId: string; logoKey: string | null },
): Promise<{ ok: boolean; detail?: string }> {
  const { error } = await supabase.rpc('set_company_logo_v1', {
    p_company_id: o.companyId, p_logo_key: '',
  });
  if (error) return { ok: false, detail: error.message };
  // The path includes the key, so removal has to be told which file it is clearing.
  await FS.deleteAsync(localLogoPath(o.companyId, o.logoKey), { idempotent: true })
    .catch(() => {});
  return { ok: true };
}

/**
 * The URI the drawer should draw, fetching once if this device has never seen it.
 *
 * Null means "draw the EZ mark" and covers every reason at once: no company, no logo
 * set, no signal on a fresh device. The caller never has to tell those apart — there
 * is one fallback and it is always correct.
 */
export async function ensureLogoCached(
  supabase: SupabaseClient,
  o: { companyId: string | null; logoKey: string | null },
): Promise<string | null> {
  if (!o.companyId || !o.logoKey) return null;
  const local = localLogoPath(o.companyId, o.logoKey);
  try {
    const info = await FS.getInfoAsync(local);
    // size > 0, not merely exists: an interrupted write leaves a 0-byte file, and a
    // cache that serves an empty image never retries. Same rule as mapcache.ts.
    if (info.exists && (info as any).size > 0) return local;
  } catch { /* fall through to the fetch */ }

  await ensureDir();
  try {
    const signed = await supabase.storage.from(BUCKET).createSignedUrl(o.logoKey, 3600);
    const url = signed.data?.signedUrl;
    if (!url) return null;
    const r = await FS.downloadAsync(url, local);
    if (r.status !== 200) {
      await FS.deleteAsync(local, { idempotent: true }).catch(() => {});
      return null;
    }
    return local;
  } catch {
    return null;
  }
}
