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
 * The company this user belongs to, read from the LOCALLY SYNCED tables (company +
 * company_member). Null until the membership has synced down, or before the user has
 * a company at all. Picks the OWNED company first, else any active membership.
 */
export async function myCompany(
  db: AbstractPowerSyncDatabase, userId: string
): Promise<MyCompany | null> {
  const rows = await db.getAll<{ id: string; name: string; role: string; owner_id: string }>(
    `SELECT c.id, c.name, m.role, c.owner_id
       FROM company_member m JOIN company c ON c.id = m.company_id
      WHERE m.user_id = ? AND m.status = 'active'
      ORDER BY CASE WHEN c.owner_id = ? THEN 0 ELSE 1 END
      LIMIT 1`, [userId, userId]);
  const r = rows[0];
  if (!r) return null;
  return { id: r.id, name: r.name, role: (r.role as MemberRole), isOwner: r.owner_id === userId };
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
