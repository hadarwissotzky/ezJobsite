/** What is waiting, and why. 140's `processing_backlog`, printed. */
import { serviceClient } from './worker.ts';

const { data, error } = await serviceClient().from('processing_backlog').select('*');
if (error) { console.error(error.message); process.exit(1); }
if (!data?.length) { console.log('backlog empty'); process.exit(0); }
for (const r of data) {
  console.log(`${String(r.state).padEnd(8)} ${String(r.blocked_reason).padEnd(18)} n=${r.n}  oldest=${r.oldest}`);
}
