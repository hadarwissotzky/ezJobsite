/**
 * The loop. Claims one job at a time and sleeps when the queue is empty.
 *
 * ONE AT A TIME on purpose: `claim_job` uses `for update skip locked`, so
 * running several of these is the supported way to go faster. Concurrency
 * belongs in how many workers you start, not in this file.
 */
import { runOnce, serviceClient } from './worker.ts';
import { drainNotifications } from './notifications.ts';
import { drainOneCreditSpend } from './creditspend.ts';

const IDLE_MS = 5_000;
const WORKER_ID = `${process.env.WORKER_ID ?? 'worker'}-${process.pid}`;

const sb = serviceClient();
let stop = false;
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  // Finish the job in hand, then exit. Killing mid-job is survivable — the lease
  // expires and another worker reclaims it — but finishing is cheaper.
  process.on(sig, () => { stop = true; });
}

console.log(`[worker] ${WORKER_ID} started`);
while (!stop) {
  try {
    const r = await runOnce(sb, WORKER_ID);
    if (!r.claimed) {
      // Idle on jobs → drain any pending push notifications, then sleep.
      try { const n = await drainNotifications(sb); if (n) console.log(`[worker] pushed ${n}`); }
      catch (e: any) { console.error(`[worker] notify: ${e?.message ?? e}`); }

      /**
       * CREDIT SPENDS DRAIN ON THE IDLE TICK, and that is a deliberate priority.
       *
       * A pending spend is money we are owed; a pending capture is a contractor waiting
       * to see whether his recording became a change order. He notices the second within
       * seconds and the first never — so processing wins, and billing catches up in the
       * gaps. The signature has already been recorded either way; nothing about the
       * client's experience is waiting on this.
       *
       * Loops until dry rather than one-per-idle: a burst of signatures should not take
       * one IDLE_MS each to settle.
       */
      try {
        for (;;) {
          const s = await drainOneCreditSpend(sb);
          if (!s.drained) break;
          console.log(`[worker] credit ${JSON.stringify(s)}`);
          if (!s.ok) break;   // back off on the first failure; 412's backoff owns retry
        }
      } catch (e: any) { console.error(`[worker] credit: ${e?.message ?? e}`); }

      await new Promise((s) => setTimeout(s, IDLE_MS)); continue;
    }
    console.log(`[worker] ${JSON.stringify(r)}`);
  } catch (e: any) {
    // Infrastructure, not a bad capture. Back off rather than spin.
    console.error(`[worker] ${e?.message ?? e}`);
    await new Promise((s) => setTimeout(s, IDLE_MS));
  }
}
console.log(`[worker] ${WORKER_ID} stopped`);
