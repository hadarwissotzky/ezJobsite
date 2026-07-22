/**
 * PRD R7 — creating a job from the three quick-add fields. The storage half of
 * `quickadd.ts` (which is pure and tested); nothing here decides anything.
 *
 * ONE CALL CREATES TWO THINGS, and that is the point of the requirement.
 *
 *   the PROJECT   — "Sarah Miller — Hall bath", the home every extra needs
 *   the APPROVER  — Sarah herself, role owner, with the phone that was typed
 *
 * The build had only the first. So the job existed and the person entitled to
 * approve its extras did not, and the send preview opened onto `r5c.noRoster` with
 * a price already on screen — the contractor typing the client's name a second
 * time at the one moment R5c is trying to make him slow down and READ. approvers.ts
 * already says the roster "starts as whoever the first extra was sent to and
 * accumulates, the same principle as R7's implicit project creation"; this is that
 * principle actually wired.
 *
 * THE APPROVER IS BEST-EFFORT AND THE PROJECT IS NOT. If the roster write fails,
 * the job still exists and the send preview's "add approver" path still works. The
 * reverse — losing the job because a roster row would not insert — would throw away
 * the thing the captures are waiting to be filed to (mandate #1, mandate #7).
 */
import { AbstractPowerSyncDatabase } from '@powersync/react-native';
import { msg, type Msg } from './i18n';
import { createProject } from './projects';
import { addApprover } from './approvers';
import { jobName, normalizePhone, validateQuickAdd, type QuickAddInput } from './quickadd';

export type QuickAddResult =
  | { ok: true; projectId: string; approverId: string | null }
  | { ok: false; reason: Msg | string };

export async function quickAddJob(
  db: AbstractPowerSyncDatabase,
  o: QuickAddInput & {
    ownerId: string;
    /** Where he is standing. Pins the job so later captures file themselves. */
    lat?: number | null;
    lng?: number | null;
    /**
     * NOT a form field — R7 forbids the setup screen and asking for an address is
     * what made it one. Passed only when the OS reverse-geocoded the capture's own
     * fix for free, so the jobs list has something to show under the name.
     */
    address?: string | null;
  }
): Promise<QuickAddResult> {
  // Refuse at the door, on the same rules the form renders. The form is the fast
  // feedback; this is the guarantee, because a caller that forgets to check would
  // otherwise create "  — " as a job name.
  const bad = validateQuickAdd(o);
  const first = bad.clientName ?? bad.jobLabel ?? bad.phone;
  if (first) return { ok: false, reason: msg(first) };

  const p = await createProject(db, {
    ownerId: o.ownerId,
    name: jobName(o.clientName, o.jobLabel),
    address: o.address ?? null,
    lat: o.lat ?? null,
    lng: o.lng ?? null,
    // `client_ref` is the client's own name, kept apart from the composed job name
    // so "who is this job for" survives a later rename of the label.
    clientRef: o.clientName.trim(),
  });
  if (!p.ok) return p;

  let approverId: string | null = null;
  try {
    approverId = await addApprover(db, {
      projectId: p.id,
      name: o.clientName.trim(),
      // 'owner' is the honest default for the person the contractor named as the
      // client, and it is the role that binds money by default (approverrouting).
      // It is NOT silently authoritative: R5c shows the routing reason on the send
      // preview and changing it is one tap there.
      role: 'owner',
      phone: normalizePhone(o.phone),
    });
  } catch {
    // Swallowed on purpose — see the header. The job is the durable thing.
  }
  return { ok: true, projectId: p.id, approverId };
}
