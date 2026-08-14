/**
 * R8 / R5b push — the device half. Decisions live in `notify.ts`.
 *
 * expo-notifications is imported DYNAMICALLY. Every other module here loads
 * under `node --test`; a static import of a native module would take this file,
 * and anything that imports it, out of the test runner entirely.
 *
 * PERMISSION IS NEVER REQUESTED FROM THE TICK. Asking raises an OS dialog that
 * blocks until a human taps it -- a probe that did exactly that once hung the
 * whole device check with no way to tell from the outside. The tick READS the
 * status; `requestNotifyPermission` is called from a button, where a person is
 * already looking at the screen.
 */
import { AbstractPowerSyncDatabase } from '@powersync/react-native';
import { markNotified, pendingNotifications } from './discussionstore.ts';
import { money } from './changeorder.ts';
import { planNotifications, type PendingApproval } from './notify.ts';
import { t } from './i18n.ts';

/**
 * Which green lights this handset has already announced.
 *
 * Per-device and never uploaded, for the same reason `activity_read` is: "did
 * this phone buzz" is a fact about a handset, not about the change order. Two
 * phones both announcing the same approval is CORRECT -- both people want to
 * know. An outbox here would be a bug, not a gap.
 */
export const NOTIFY_DDL = [
  `CREATE TABLE IF NOT EXISTS notify_sent (
      change_order_id TEXT NOT NULL PRIMARY KEY,
      at_ms           INTEGER NOT NULL
   ) STRICT`,
];

export async function ensureNotifySchema(db: AbstractPowerSyncDatabase) {
  const existed = await db.getAll<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='notify_sent'`
  );
  for (const s of NOTIFY_DDL) await db.execute(s);
  // SEED THE WATERMARK on first creation. Without this, the first launch after
  // an update announces every extra ever approved on this job at once -- a
  // burst of stale green lights that reads as a sync failure. Only approvals
  // that land AFTER the feature exists are news.
  if (!existed.length) {
    await db.execute(
      `INSERT OR IGNORE INTO notify_sent (change_order_id, at_ms)
         SELECT id, ? FROM change_order WHERE status = 'approved'`,
      [Date.now()]
    );
  }
}

/** Read-only. Safe to call from a tick or an automated check. */
export async function notifyPermissionStatus(): Promise<string> {
  try {
    const N = await import('expo-notifications');
    return (await N.getPermissionsAsync()).status;
  } catch { return 'unavailable'; }
}

/** Raises the OS dialog. Call ONLY from a user tap. */
export async function requestNotifyPermission(): Promise<string> {
  try {
    const N = await import('expo-notifications');
    return (await N.requestPermissionsAsync()).status;
  } catch { return 'unavailable'; }
}

/**
 * THE NUMBER ON THE APP ICON (hadar, 2026-08-12: "when the application is closed and
 * the notification is displayed and has not yet viewed we add [a badge] to the
 * application icon").
 *
 * MIRRORS THE BELL, ALWAYS. The caller drives it from the same `unreadCount` the header
 * badge renders, so the icon and the bell cannot disagree — which is the entire value of
 * an icon badge. Two numbers on one app teach a user to trust neither.
 *
 * WHAT IT CAN AND CANNOT DO, stated because the difference is invisible from outside.
 * iOS PERSISTS the badge across launches, so a number set while the app was last awake
 * is still on the home screen after it is killed — that IS the "app is closed" case, and
 * it works. What it cannot do is CHANGE while the app is dead: these notifications are
 * local (see notify.ts), so nothing polls, nothing fires, and nothing re-badges until
 * the app is opened. Remote push is the only fix for that and it needs a provider; the
 * gap is the same one notify.ts already names, not a new one.
 *
 * Never throws. A platform with no badge (Android launchers vary, web has none) is a
 * missing decoration, not an error — and this is called from a render effect.
 */
export async function setAppBadge(n: number): Promise<void> {
  try {
    const N = await import('expo-notifications');
    await N.setBadgeCountAsync(Math.max(0, Math.floor(n)));
    (globalThis as any).__BADGE__ = `ok:${n}`;
  } catch (e: any) {
    (globalThis as any).__BADGE__ = `err:${String(e?.message ?? e)}`;
    /* no badge on this platform — the in-app bell still carries the count */
  }
}

async function pendingApprovals(
  db: AbstractPowerSyncDatabase, projectId: string
): Promise<PendingApproval[]> {
  const rows = await db.getAll<{
    id: string; scope: string; amount_cents: number | null; signed_by: string | null;
  }>(
    `SELECT co.id, co.scope, co.amount_cents, co.signed_by
       FROM change_order co
      WHERE co.project_id = ? AND co.status = 'approved'
        AND co.id NOT IN (SELECT change_order_id FROM notify_sent)
      ORDER BY co.created_at_ms`,
    [projectId]
  );
  return rows.map((r) => ({
    id: r.id, scope: r.scope, amount: money(r.amount_cents), signedBy: r.signed_by,
  }));
}

/**
 * Present everything owed, then record it. Called from the sync tick, after the
 * pull -- there is nothing to announce until the rows are local.
 *
 * Each notification is stamped INDIVIDUALLY and only once the OS has accepted
 * it. A single stamp over the whole batch would lose the remainder whenever the
 * fourth of five throws.
 */
export async function runNotifications(
  db: AbstractPowerSyncDatabase, projectId: string
): Promise<{ presented: number; blocked: string | null }> {
  const [permission, questions, approvals] = await Promise.all([
    notifyPermissionStatus(), pendingNotifications(db), pendingApprovals(db, projectId),
  ]);
  if (!questions.length && !approvals.length) return { presented: 0, blocked: null };

  const plan = planNotifications({ permission, questions, approvals });
  if (plan.blocked) return { presented: 0, blocked: plan.blocked };

  const N = await import('expo-notifications');
  let presented = 0;
  for (let i = 0; i < plan.present.length; i++) {
    const n = plan.present[i];
    const qCount = questions.length;
    try {
      await N.scheduleNotificationAsync({
        content: {
          title: t(n.title),
          body: n.body,
          // Read back by the tap handler to open the right thread. The URL is
          // carried rather than the bare id so the handler stays one parser.
          data: { url: n.link },
        },
        // Immediate. A delayed trigger here would fire the green light minutes
        // after the contractor already saw it on screen.
        trigger: null,
      });
      if (i < qCount) await markNotified(db, [questions[i].id]);
      else {
        await db.execute(
          `INSERT OR REPLACE INTO notify_sent (change_order_id, at_ms) VALUES (?, ?)`,
          [approvals[i - qCount].id, Date.now()]
        );
      }
      presented++;
    } catch {
      // Left unstamped on purpose: it fires again on the next tick. A
      // notification shown twice is a nuisance; one never shown is mandate #1.
    }
  }
  return { presented, blocked: null };
}
