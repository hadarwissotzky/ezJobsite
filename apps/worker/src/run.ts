/**
 * The loop. Claims one job at a time and sleeps when the queue is empty.
 *
 * ONE AT A TIME on purpose: `claim_job` uses `for update skip locked`, so
 * running several of these is the supported way to go faster. Concurrency
 * belongs in how many workers you start, not in this file.
 */
import { runOnce, serviceClient } from './worker.ts';
import { drainNotifications } from './notifications.ts';

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
