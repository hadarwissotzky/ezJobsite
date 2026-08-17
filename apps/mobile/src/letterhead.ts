/**
 * THE COMPANY'S LETTERHEAD — name, address, licence.
 *
 * hadar, 2026-08-17: "the user needs to be able to add their logo, as part of the
 * company section in the drawer menu where the user can add company name, logo,
 * address, license (optional)."
 *
 * The logo half already exists (`companylogo.ts`). This is the three text fields
 * beside it, and the reason they matter is not decoration: `confirmation_company_v1`
 * prints them at the top of the page a homeowner opens to authorise money. Today that
 * page shows a company name and nothing else, because 402 added the columns and — as
 * 404's header admits — no screen was ever built to fill them.
 *
 * ─── IT GOES THROUGH RPCs, NOT THE LOCAL TABLE ──────────────────────────────────
 * `company` is PowerSync-managed and does not reach the device (empty locally while
 * the server holds a real row — the same gap `company.ts:billingTenantId` exists to
 * work around). Reading the local table here would show a contractor blank fields over
 * his own saved letterhead, and then save the blanks over it. So both directions go to
 * the server, and the screen says so when it cannot reach one.
 *
 * ─── IT NEVER TOUCHES THE LOGO ──────────────────────────────────────────────────
 * `save_company_letterhead_v1` names only name/address/licence. 402's six-column
 * writer would have set `logo_key` to whatever this screen passed — which is nothing,
 * so the first contractor to save an address would have erased his own logo. A writer
 * cannot lose a column it never mentions.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type Letterhead = {
  companyId: string;
  name: string;
  /** Null, never '' — a blank line on a document is not an address. */
  address: string | null;
  /** Free text: "CSLB 1043210", "TX-1234567". Optional by decision, not by oversight. */
  license: string | null;
  /** Storage key, or null. The local display copy is `companylogo.ts`'s business. */
  logoKey: string | null;
  /** Only the owner may edit. A crew member sees the letterhead read-only. */
  isOwner: boolean;
};

export type LetterheadResult =
  | { ok: true; letterhead: Letterhead }
  | { ok: false; reason: string };

export async function readLetterhead(
  supabase: SupabaseClient, companyId: string
): Promise<LetterheadResult> {
  if (!companyId) return { ok: false, reason: 'no company' };
  const { data, error } = await supabase.rpc('company_letterhead_v1', {
    p_company_id: companyId,
  });
  if (error) return { ok: false, reason: error.message };
  const d = data as Record<string, unknown> | null;
  if (!d || d.ok !== true) return { ok: false, reason: 'not found' };
  return {
    ok: true,
    letterhead: {
      companyId: String(d.id ?? companyId),
      name: String(d.name ?? ''),
      // The server already collapses '' to null; this guards a caller that did not.
      address: str(d.address),
      license: str(d.license),
      logoKey: str(d.logo_key),
      isOwner: d.is_owner === true,
    },
  };
}

export async function saveLetterhead(
  supabase: SupabaseClient,
  o: { companyId: string; name: string; address: string; license: string }
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!o.companyId) return { ok: false, reason: 'no company' };
  const { error } = await supabase.rpc('save_company_letterhead_v1', {
    p_company_id: o.companyId,
    p_name: o.name,
    p_address: o.address,
    p_license: o.license,
  });
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

const str = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? null : s;
};

/**
 * The letterhead as ONE BLOCK OF LINES, in the order a document prints them.
 *
 * Exported and pure so it can be tested, and so the app and the client's page cannot
 * disagree about what a half-filled letterhead looks like. BLANKS ARE DROPPED, never
 * rendered as "Not set": a contractor with no licence number has a shorter letterhead,
 * not a form with a hole in it, and "Not set" beside a price reads as an unfinished
 * document (402's own rule, applied on this side too).
 */
export function letterheadLines(l: {
  name?: string | null; address?: string | null; license?: string | null;
}): string[] {
  const out: string[] = [];
  const push = (v?: string | null) => { const s = (v ?? '').trim(); if (s) out.push(s); };
  push(l.name);
  push(l.address);
  // Prefixed, because a bare number on a change order is unreadable — a homeowner
  // checking a contractor against their state board needs to know what they are
  // looking at.
  const lic = (l.license ?? '').trim();
  if (lic) out.push(/^lic/i.test(lic) ? lic : `License ${lic}`);
  return out;
}
