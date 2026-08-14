/**
 * Company membership — the client half of 376_company_membership (hadar 2026-07-25).
 *
 * WHAT THIS IS. A company is the tenant that groups a set of users and their projects.
 * Chosen scope: COMPANY-WIDE visibility (every active member reads the company's
 * projects + evidence) and SHARE-LINK invites. The server is the authority on
 * membership and role — every mutation here is a SECURITY DEFINER RPC that re-checks
 * auth.uid(); the client never writes company_member directly (the sync tables are
 * read-only mirrors). This module is only the door-knocking; the server decides.
 *
 * NAMES. company_member carries a display_name, set from the member's profile name at
 * create/join and synced down, so the roster reads by name (falling back to "you"/
 * "teammate" only when a member has no name yet).
 */
import { AbstractPowerSyncDatabase } from '@powersync/react-native';
import { SupabaseClient } from '@supabase/supabase-js';

export type MemberRole = 'owner' | 'crew' | 'sub';

export type Member = {
  memberId: string;
  companyId: string;
  userId: string;
  role: MemberRole;
  status: 'active' | 'revoked';
  name: string | null;
  isMe: boolean;
};

export type MyCompany = { id: string; name: string; role: MemberRole; isOwner: boolean };

/**
 * EVERY tenant this person belongs to, best-first.
 *
 * hadar, 2026-08-13: "the login (if the phone number is used) is to the SYSTEM… if
 * multiple companies are detected the user can toggle both from the drawer, and when
 * they first login."
 *
 * That is the correct model and it is worth stating plainly, because the code assumed
 * otherwise for a long time: A PHONE NUMBER IDENTIFIES A PERSON, NOT A FIRM. One person
 * signs in once and may be crew on a company, a sub on another, and a freelancer with
 * work of their own — all at the same time, all under one login. So "which company am
 * I?" is not a fact to be derived; it is a CHOICE, and the app's job is to remember it.
 *
 * Owned first, then by name, so the default is stable and the list never reshuffles
 * under a finger.
 */
export async function listMyCompanies(
  db: AbstractPowerSyncDatabase, userId: string
): Promise<MyCompany[]> {
  const rows = await db.getAll<{ id: string; name: string; role: string; owner_id: string }>(
    `SELECT c.id, c.name, m.role, c.owner_id
       FROM company_member m JOIN company c ON c.id = m.company_id
      WHERE m.user_id = ? AND m.status = 'active'
      ORDER BY CASE WHEN c.owner_id = ? THEN 0 ELSE 1 END, c.name`, [userId, userId]);
  return rows.map((r) => ({
    id: r.id, name: r.name, role: r.role as MemberRole, isOwner: r.owner_id === userId,
  }));
}

const ACTIVE_KEY = 'active_company_id';
const TENANT_KEY = 'billing_tenant_id';

/**
 * THE TENANT ID FOR BILLING, INDEPENDENT OF SYNC.
 *
 * `myCompany()` reads the PowerSync-synced `company` table, and on hadar's device that
 * table is EMPTY while the server holds a real tenant — so `configureBilling(null)` gave
 * RevenueCat an anonymous customer, the webhook could map nothing back, and the purchase
 * bought nothing. Billing was hostage to a sync bucket it has no reason to depend on.
 *
 * The server tells us the id when it settles the tenant (405). We keep it here, on the
 * device, so the billing identity survives an empty cache. It is not a source of truth
 * about ENTITLEMENT — `currentPlan()` still reads the server-written `company.plan`, and
 * a client may never be its own billing authority (sql/382) — it is only the ANSWER TO
 * "who is buying", which the server already gave us.
 */
export async function rememberTenantId(
  db: AbstractPowerSyncDatabase, tenantId: string
): Promise<void> {
  await db.execute(
    `INSERT INTO device_settings (k, v) VALUES (?, ?)
     ON CONFLICT(k) DO UPDATE SET v = excluded.v`, [TENANT_KEY, tenantId]);
}

/** The tenant to bill against: the live membership when it has synced, else the id the
 *  server last handed us. Null only when neither is known. */
export async function billingTenantId(
  db: AbstractPowerSyncDatabase, userId: string
): Promise<string | null> {
  const co = await myCompany(db, userId);
  if (co) return co.id;
  try {
    const r = (await db.getAll<{ v: string }>(
      `SELECT v FROM device_settings WHERE k = ?`, [TENANT_KEY]))[0];
    return r?.v ?? null;
  } catch { return null; }
}

/** Which tenant this DEVICE is working in. Device-local on purpose: the same person may
 *  keep the office iPad on the company and their own phone on their freelance work. */
export async function setActiveCompany(
  db: AbstractPowerSyncDatabase, companyId: string
): Promise<void> {
  await db.execute(
    `INSERT INTO device_settings (k, v) VALUES (?, ?)
     ON CONFLICT(k) DO UPDATE SET v = excluded.v`, [ACTIVE_KEY, companyId]);
}

/**
 * The tenant currently in use: the chosen one when it is still a live membership, else
 * the best default. Null only when this person belongs to nothing yet.
 *
 * THE VALIDITY CHECK IS THE POINT. A stored id is a memory, not a right — someone
 * removed from a company must not keep working inside it because their phone remembers
 * a choice. If the stored id is no longer an active membership it is ignored and the
 * default takes over, silently and safely.
 */
export async function myCompany(
  db: AbstractPowerSyncDatabase, userId: string
): Promise<MyCompany | null> {
  const all = await listMyCompanies(db, userId);
  if (!all.length) return null;
  let chosen: string | null = null;
  try {
    const r = (await db.getAll<{ v: string }>(
      `SELECT v FROM device_settings WHERE k = ?`, [ACTIVE_KEY]))[0];
    chosen = r?.v ?? null;
  } catch { /* no settings table yet — the default is correct */ }
  return all.find((c) => c.id === chosen) ?? all[0];
}

/** The roster of a company, from the synced company_member table. */
export async function listMembers(
  db: AbstractPowerSyncDatabase, companyId: string, userId: string
): Promise<Member[]> {
  const rows = await db.getAll<{
    id: string; company_id: string; user_id: string; role: string; status: string; display_name: string | null;
  }>(`SELECT id, company_id, user_id, role, status, display_name FROM company_member
        WHERE company_id = ? AND status = 'active'
        ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'crew' THEN 1 ELSE 2 END`, [companyId]);
  return rows.map((r) => ({
    memberId: r.id, companyId: r.company_id, userId: r.user_id,
    role: r.role as MemberRole, status: r.status as 'active' | 'revoked',
    name: r.display_name, isMe: r.user_id === userId,
  }));
}

/**
 * Ensure this user OWNS a company (the solo case → a real tenant). Idempotent: the
 * RPC returns the existing company if there is one, so this is safe to call on every
 * setup. `name` is the company display name from the profile.
 */
export async function ensureOwnCompany(
  supabase: SupabaseClient, name: string, memberName?: string | null
): Promise<{ ok: true; companyId: string } | { ok: false; reason: string }> {
  const id = `cmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const { data, error } = await supabase.rpc('create_company', {
    p_id: id, p_name: name, p_display_name: memberName || null,
  });
  if (error) return { ok: false, reason: error.message };
  return { ok: true, companyId: (data as string) ?? id };
}

/**
 * EVERY ACCOUNT NEEDS A BILLING TENANT. NOT EVERY ACCOUNT HAS A COMPANY.
 *
 * hadar, 2026-08-13: "not every user will have a company — a lot of users are
 * freelancers, they don't have companies." Correct, and the code had conflated two
 * different things behind one word:
 *
 *   * the COMPANY as a workplace — a roster, invites, crew who inherit the plan. A
 *     freelancer has none of this and must never be asked to invent one.
 *   * the TENANT as a container — the row that owns the subscription, the letterhead
 *     name on a change order, and the projects. A freelancer has exactly one of these:
 *     himself.
 *
 * Billing cannot work without the second. `company.plan` is the ONLY writable home for
 * a plan (sql/382: a client may never be its own billing authority), and RevenueCat is
 * keyed by the tenant id — so an account with no row gets an ANONYMOUS RevenueCat
 * customer, the webhook matches nothing, and the purchase silently buys nothing. That is
 * exactly what happened on hadar's device: zero rows in `company`, so the Test Store
 * purchase attached to `$RCAnonymousID:…` and `currentPlan` read an empty table.
 *
 * So the tenant is created for EVERYONE, named after the person when they are solo, and
 * the company-shaped UI stays hidden until there is actually somebody else in it. The
 * freelancer never sees the word.
 */
export async function ensureBillingTenant(
  supabase: SupabaseClient, db: AbstractPowerSyncDatabase,
  o: { companyName: string | null; personName: string | null },
): Promise<string | null> {
  // A real company name when there is one; the person's own name when there is not —
  // that is what belongs on his letterhead anyway. Never a placeholder like "Untitled":
  // this string is printed at the top of documents his clients sign.
  const name = (o.companyName ?? '').trim() || (o.personName ?? '').trim();
  if (!name) return null;   // no name yet — the profile step has not happened; retry later

  /**
   * THE SERVER DECIDES (405). This used to check the LOCAL `company_member` table first
   * and mint when it looked empty — and that table is a PowerSync cache which can be
   * empty while the server holds a real membership. On a crew member's phone during a
   * sync lag that would have created a personal company and made them its owner, and
   * `myCompany()` prefers owned over member, so their work would then file under a
   * tenant they never asked for. One phone number is one PERSON, who may be crew
   * somewhere and a freelancer as well; only the server can say whether they already
   * belong somewhere.
   */
  const { data, error } = await supabase.rpc('ensure_billing_tenant', {
    p_name: name, p_display_name: o.personName ?? null,
  });
  if (error) {
    if (__DEV__) (globalThis as any).__tenantErr = error.message;
    return null;
  }
  const id = (data as string) ?? null;
  // Kept so billing works even while the `company` bucket is not arriving.
  if (id) await rememberTenantId(db, id).catch(() => {});
  return id;
}

/**
 * Owner mints an invite. Returns the token, the invitee-facing link, and the raw
 * token for the manual "enter a code" fallback (the link needs the join page hosted;
 * the token always works typed in). Reuses the same base as the approval links.
 */
export async function createInvite(
  supabase: SupabaseClient, companyId: string, role: 'crew' | 'sub', linkBase: string
): Promise<{ ok: true; token: string; url: string; companyName: string }
         | { ok: false; reason: string }> {
  const { data, error } = await supabase.rpc('create_company_invite', {
    p_company_id: companyId, p_role: role,
  });
  if (error) return { ok: false, reason: error.message };
  const token = (data as any)?.token as string;
  if (!token) return { ok: false, reason: 'no token returned' };
  const base = (linkBase && !linkBase.startsWith('/')) ? linkBase.replace(/\/+$/, '') : '';
  const url = base ? `${base}/join?token=${token}` : '';
  return { ok: true, token, url, companyName: (data as any)?.company_name ?? '' };
}

/** Accept an invite (link tap or typed token) → join the company. */
export async function acceptInvite(
  supabase: SupabaseClient, token: string, memberName?: string | null
): Promise<{ ok: true; companyId: string; role: MemberRole; companyName: string }
         | { ok: false; reason: string }> {
  const clean = token.trim();
  if (!clean) return { ok: false, reason: 'no token' };
  const { data, error } = await supabase.rpc('accept_company_invite', {
    p_token: clean, p_display_name: memberName || null,
  });
  if (error) return { ok: false, reason: error.message };
  return {
    ok: true, companyId: (data as any)?.company_id, role: (data as any)?.role,
    companyName: (data as any)?.company_name ?? '',
  };
}

/** Owner removes a member (REQ-MEMBER-5). The sync rules then purge their scope. */
export async function revokeMember(
  supabase: SupabaseClient, companyId: string, userId: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { error } = await supabase.rpc('revoke_company_member', {
    p_company_id: companyId, p_user_id: userId,
  });
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}
