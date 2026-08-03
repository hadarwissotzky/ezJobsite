/**
 * The OTA mechanism (SPEC-ota-updates-v1). `ota.ts` decides WHEN it is safe; this
 * decides WHAT actually happens.
 *
 * SEPARATE FILE ON PURPOSE. `ota.ts` is unit-tested under plain node, and importing
 * `expo-updates` there would drag React Native into the test runner and break it. The
 * safety predicate must stay testable, so the native import lives here — where there
 * is nothing to test that a test could honestly assert.
 *
 * MOST OF "AUTOMATIC" IS CONFIGURATION, NOT CODE. With `checkAutomatically: ON_LOAD`
 * and `fallbackToCacheTimeout: 0` in app.json, expo-updates already does the right
 * thing without being asked: the app boots from the bundle on disk, then checks and
 * downloads in the background, then applies at the NEXT cold start. That default is
 * exactly REQ-OTA1 and REQ-OTA2 — launch is never delayed, and the swap never happens
 * mid-session. This module does not re-implement any of it.
 *
 * WHAT IT ADDS is the one thing the default cannot do safely on its own: let a user
 * apply an update NOW without that being a way to lose work. `Updates.reloadAsync()`
 * tears down the JS runtime, so it is offered only when `canApplyNow()` says every
 * outbox is empty and no capture draft is open.
 */
import React from 'react';
import * as Updates from 'expo-updates';
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';

import { canApplyNow } from './ota';
export { buildLine } from './ota';

export type OtaState = {
  /** A newer bundle is downloaded and will run at the next cold start. */
  pending: boolean;
  /** Pending AND nothing in flight — only then may we offer to restart (REQ-OTA2). */
  canRestart: boolean;
  /** What is running now. Null when running the bundle shipped inside the binary. */
  updateId: string | null;
  /** True when running the embedded bundle rather than a downloaded update. */
  embedded: boolean;
  /** Disabled in dev/Expo Go, and in any build without an updates URL. */
  enabled: boolean;
  /** Apply now. Caller must gate on `canRestart`; this re-checks anyway. */
  restart: (db: AbstractPowerSyncDatabase) => Promise<void>;
};

export function useOta(db: AbstractPowerSyncDatabase | null): OtaState {
  // `useUpdates` is safe to call when updates are disabled — it just reports nothing.
  const { isUpdatePending, currentlyRunning } = Updates.useUpdates();
  const [safe, setSafe] = React.useState(false);

  // Only ask the database when there is something to decide. Counting eleven outboxes
  // on every render would be a query storm for an answer nobody wanted.
  React.useEffect(() => {
    if (!isUpdatePending || !db) { setSafe(false); return; }
    let live = true;
    canApplyNow(db)
      .then((ok) => { if (live) setSafe(ok); })
      .catch(() => { if (live) setSafe(false); });   // fail closed
    return () => { live = false; };
  }, [isUpdatePending, db]);

  const restart = React.useCallback(async (d: AbstractPowerSyncDatabase) => {
    // Re-checked here and not merely at render: between the button appearing and the
    // tap landing, a sync could have queued a row. The cheap check is worth it when
    // the cost of being wrong is a reload over unsent evidence.
    if (!(await canApplyNow(d))) return;
    await Updates.reloadAsync();
  }, []);

  return {
    pending: !!isUpdatePending,
    canRestart: !!isUpdatePending && safe,
    updateId: currentlyRunning?.updateId ?? null,
    embedded: currentlyRunning?.isEmbeddedLaunch ?? true,
    enabled: Updates.isEnabled,
    restart,
  };
}
