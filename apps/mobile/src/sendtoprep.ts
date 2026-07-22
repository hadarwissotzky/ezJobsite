/**
 * R1 "Send to" — the database half. The decision half is `sendto.ts`, which has
 * no imports and is unit-tested; this file only feeds it rows and writes back
 * what a human confirmed. Same split as `approvers.ts` / `approverrouting.ts`.
 *
 * Nothing here sends anything. `prepareSendTo` reads; `quickAddDestination`
 * writes a job and a contact the user typed. The send itself stays where it is,
 * behind the confirmation step mandate #2 requires.
 */
import { AbstractPowerSyncDatabase } from '@powersync/react-native';

import { INBOX_ID, listProjects, createProject, distanceM } from './projects';
import { addApprover } from './approvers';
import { checkQuickAdd, sendToPrefill, type SendToPrefill, type SendToProject } from './sendto';

/**
 * The phone the approval link would actually go to: the most recently used
 * ACTIVE approver on that job who has a number.
 *
 * Read here rather than assumed, because "Send always displays the recipient
 * name" (PRD R1) is worth nothing if the recipient shown is not the one the
 * link reaches. A job with no reachable approver comes back null and the card
 * says so, instead of the Send button failing later with nothing to explain it.
 */
async function phonesByProject(db: AbstractPowerSyncDatabase): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const rows = await db.getAll<{ project_id: string; phone_e164: string | null; last_used_ms: number }>(
      `SELECT project_id, phone_e164, last_used_ms FROM project_approver
        WHERE status = 'active' AND phone_e164 IS NOT NULL
        ORDER BY last_used_ms ASC`);
    // ASC + overwrite = the most recently used wins, without a window function.
    for (const r of rows) if (r.phone_e164) out.set(r.project_id, r.phone_e164);
  } catch { /* roster table not created yet on a fresh install */ }
  return out;
}

/**
 * Build the Send-to prefill for a capture taken at `fix`.
 *
 * `fix` is the capture's OWN stamp, never a fresh reading. PRD R1: "location is
 * captured only at the moment of capture — no background tracking of the
 * contractor, ever." Re-reading the GPS when the preview card renders would make
 * the suggestion depend on where he walked to afterwards, which is both wrong
 * and the tracking that line forbids.
 */
export async function prepareSendTo(
  db: AbstractPowerSyncDatabase,
  fix: { lat: number | null; lng: number | null } | null,
  opts?: { maxRecents?: number }
): Promise<SendToPrefill> {
  const phones = await phonesByProject(db);
  const all = (await listProjects(db)).filter((p) => p.id !== INBOX_ID);
  const hasFix = !!fix && fix.lat != null && fix.lng != null;

  const inRange: SendToProject[] = [];
  const others: SendToProject[] = [];
  for (const p of all) {
    const d = hasFix && p.lat != null && p.lng != null
      ? distanceM({ lat: fix!.lat!, lng: fix!.lng! }, { lat: p.lat, lng: p.lng })
      : null;
    const row: SendToProject = {
      id: p.id, name: p.name, distanceM: d == null ? null : Math.round(d),
      lastUsedMs: p.last_used_ms ?? 0, phoneE164: phones.get(p.id) ?? null,
    };
    // Each project's OWN geofence, not a global radius: a downtown condo and a
    // rural build are not the same size, and `project.geofence_m` already exists
    // to say so.
    if (d != null && d <= p.geofence_m) inRange.push(row); else others.push(row);
  }
  return sendToPrefill({ inRange, others, hasFix, maxRecents: opts?.maxRecents });
}

export type QuickAddResult =
  | { ok: true; projectId: string; name: string; phoneE164: string | null }
  | { ok: false; problemKey: string };

/**
 * PRD R1: "Assignment ('Send to') happens on the preview card afterward, via
 * recents or quick-add (name + phone)."
 *
 * Creates the job AND the person in one action, because on a first visit those
 * are one fact to the contractor — "this is the Millers' place and that's their
 * number" — and splitting them into two forms is how a destination ends up with
 * no reachable contact.
 *
 * The capture's fix seeds the job's pin. PRD R1: "Each project silently learns
 * its location from its first send — no address entry ever." That is what makes
 * the NEXT capture at this address say "📍 Detected". Passing no fix is fine;
 * the job simply has no pin yet and never guesses one.
 *
 * OFFLINE: `createProject` and `addApprover` are local writes with their own
 * queued copies. Neither needs a network, so a dead zone cannot stop a
 * contractor from naming where the work is.
 */
export async function quickAddDestination(
  db: AbstractPowerSyncDatabase,
  o: { ownerId: string; name: string; phone: string;
       lat?: number | null; lng?: number | null }
): Promise<QuickAddResult> {
  const check = checkQuickAdd({ name: o.name, phone: o.phone });
  if (!check.ok) return { ok: false, problemKey: check.problemKey };

  const created = await createProject(db, {
    ownerId: o.ownerId, name: check.name,
    lat: o.lat ?? null, lng: o.lng ?? null,
  });
  if (!created.ok) {
    const r: any = created.reason;
    return { ok: false, problemKey: typeof r === 'string' ? r : r?.k ?? 'job.needsName' };
  }

  try {
    // 'owner' because a quick-add during a walk is the client, and R5c's routing
    // treats owner as the role that can commit their own money. If they turn out
    // to be a GC or a PM, the roster screen changes it — recording the common case
    // beats stopping the walk to ask a taxonomy question.
    await addApprover(db, {
      projectId: created.id, name: check.name, role: 'owner', phone: check.phoneE164,
    });
  } catch {
    // The JOB exists and that is the part the capture needs. A failed contact is
    // reported by the absent phone (canSend() blocks the send), not by throwing
    // away a job the user just named.
  }
  return { ok: true, projectId: created.id, name: check.name, phoneE164: check.phoneE164 };
}
