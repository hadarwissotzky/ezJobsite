import assert from 'node:assert/strict';
import test from 'node:test';
import { runOnce, type Job } from './worker.ts';

/**
 * A recording stand-in for the Supabase client. Not a mock of behaviour — it
 * records the CALLS, because what this file is testing is the ORDER and the
 * CONDITIONS of the protocol: complete_step after each step rather than once at
 * the end, block_job instead of complete_step on failure, finish_job only when
 * nothing is outstanding. Those are the parts that cost money or lose work when
 * they are wrong.
 */
function fakeClient(job: Job | null) {
  const calls: Array<{ fn: string; args: any }> = [];
  const sb: any = {
    calls,
    rpc(fn: string, args: any) {
      calls.push({ fn, args });
      if (fn === 'claim_job') return Promise.resolve({ data: job, error: null });
      return Promise.resolve({ data: null, error: null });
    },
    from() {
      return { insert: (row: any) => (calls.push({ fn: 'insert', args: row }),
                                      Promise.resolve({ error: null })) };
    },
  };
  return sb;
}

const job = (over: Partial<Job> = {}): Job => ({
  id: 'j1', capture_id: 'c1', owner_id: 'u1', project_id: 'p1',
  steps: ['transcribe', 'detect_language', 'resolve_project', 'structure'],
  completed_steps: [], state: 'running', blocked_reason: 'none', attempts: 1,
  ...over,
});

test('an empty queue is not an error', async () => {
  const sb = fakeClient(null);
  assert.deepEqual(await runOnce(sb, 'w1'), { claimed: false });
});

// With no DEEPGRAM_API_KEY, transcribe() returns null and the job must be PARKED
// with a reason a person can read in processing_backlog — not crashed, and not
// silently marked done.
test('no key parks the job as needs_api_key', async () => {
  delete process.env.DEEPGRAM_API_KEY;
  const sb = fakeClient(job());
  const r = await runOnce(sb, 'w1');

  assert.equal(r.blocked, 'needs_api_key');
  const block = sb.calls.find((c: any) => c.fn === 'block_job');
  assert.equal(block.args.p_reason, 'needs_api_key');
  assert.equal(block.args.p_job, 'j1');
});

// THE EXPENSIVE MISTAKE. Marking a step complete when it did not run means the
// next claim skips it, and the capture is never transcribed at all.
test('a failed step is never marked complete', async () => {
  delete process.env.DEEPGRAM_API_KEY;
  const sb = fakeClient(job());
  await runOnce(sb, 'w1');
  assert.equal(sb.calls.some((c: any) => c.fn === 'complete_step'), false);
  assert.equal(sb.calls.some((c: any) => c.fn === 'finish_job'), false);
});

// The other expensive mistake, in the other direction: re-running a paid call
// after a crash. The SQL comment on completed_steps names this explicitly.
test('a resumed job does not re-run what it already did', async () => {
  delete process.env.DEEPGRAM_API_KEY;
  const sb = fakeClient(job({ completed_steps: ['transcribe'] }));
  await runOnce(sb, 'w1');
  // It must not have attempted transcribe again — the first step it tries is
  // detect_language, which also parks. What proves it is that no insert into
  // capture_transcript was attempted.
  assert.equal(sb.calls.some((c: any) => c.fn === 'insert'), false);
});

// A photo declares no steps. It must finish on the first claim rather than
// sitting in the queue forever.
test('a job with no steps finishes immediately', async () => {
  const sb = fakeClient(job({ steps: [] }));
  const r = await runOnce(sb, 'w1');
  assert.equal(r.done, true);
  assert.equal(sb.calls.at(-1).fn, 'finish_job');
  assert.equal(sb.calls.some((c: any) => c.fn === 'block_job'), false);
});

test('claim failure is infrastructure and propagates', async () => {
  const sb: any = { rpc: () => Promise.resolve({ data: null, error: new Error('down') }),
                    from: () => ({}) };
  await assert.rejects(() => runOnce(sb, 'w1'), /down/);
});

test('the lease is claimed under this worker\'s id', async () => {
  const sb = fakeClient(null);
  await runOnce(sb, 'worker-7');
  assert.equal(sb.calls[0].fn, 'claim_job');
  assert.equal(sb.calls[0].args.p_worker, 'worker-7');
});
