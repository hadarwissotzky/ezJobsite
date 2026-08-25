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
function fakeClient(job: Job | null,
  transcriptRows: any[] = [{ text: 'work at 14 Elm St', engine: 'deepgram' }]) {
  const calls: Array<{ fn: string; args: any }> = [];
  const sb: any = {
    calls,
    rpc(fn: string, args: any) {
      calls.push({ fn, args });
      if (fn === 'claim_job') return Promise.resolve({ data: job, error: null });
      if (fn === 'content_resolve') return Promise.resolve({
        data: [{ project_id: 'p1', matched_on: 'address',
                 matched_text: '14 Elm St', confidence: 'high' }], error: null });
      return Promise.resolve({ data: null, error: null });
    },
    from(table: string) {
      /**
       * The transcript read is now FILTERED BY ENGINE IN SQL rather than windowed and
       * sorted in JS (Codex 2026-08-24 — a LIMIT applied before the ranking let eight
       * on-device retries hide the cloud row). So the fake has to honour `.like` and
       * `.not(...)` the way PostgREST does, or these tests pass against a query shape
       * the database would never return.
       *
       * `transcriptRows` stays ONE list in newest-first order, exactly as the table
       * holds it; the fake splits it the way the server would.
       */
      const build = (onDevice: boolean | null) => {
        const rows = onDevice === null ? transcriptRows
          : transcriptRows.filter((r: any) => {
              const e = String(r.engine ?? '');
              return onDevice ? e.endsWith('ondevice') : !e.endsWith('ondevice');
            });
        const node: any = {
          like: () => build(true),
          not: () => build(false),
          // `.eq(...).limit(...)` with no order — the decision_version lookup in
          // extraTranscript. Returns nothing, which is the "capture belongs to no
          // decision" case and makes the step fall back to this capture alone.
          limit: () => (calls.push({ fn: 'select', args: table }),
            Promise.resolve({ data: [], error: null })),
          order: () => ({ limit: () => (calls.push({ fn: 'select', args: table }),
            Promise.resolve({ data: rows, error: null })) }),
          single: () => (calls.push({ fn: 'select', args: table }),
            Promise.resolve({ data: { payload: 'k/a.m4a', media_mime_type: 'audio/m4a' },
                              error: null })),
        };
        return node;
      };
      return {
        insert: (row: any) => (calls.push({ fn: 'insert', args: row }),
                               Promise.resolve({ error: null })),
        select: () => ({ eq: () => build(null) }),
      };
    },
    storage: {
      from: () => ({ download: () => (calls.push({ fn: 'download', args: null }),
        Promise.resolve({ data: { arrayBuffer: async () => new ArrayBuffer(8) },
                          error: null })) }),
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

// The happy path, with the provider stubbed at fetch. Everything up to and
// including the insert is the worker's own code; only Deepgram is faked. This is
// what proves the key-present branch is wired at all — without it the suite
// covered only the parked case, which is how a signature break survived here
// once already (--experimental-strip-types runs types, it does not check them).
test('with a key it downloads, transcribes and writes the transcript', async () => {
  process.env.DEEPGRAM_API_KEY = 'test-key';
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => ({
      metadata: { duration: 9 },
      results: { channels: [{ detected_language: 'en',
                              alternatives: [{ transcript: 'subfloor rot' }] }] },
    }),
  })) as any;
  try {
    const sb = fakeClient(job({ steps: ['transcribe'] }));
    const r = await runOnce(sb, 'w1');

    assert.equal(r.blocked, undefined);
    assert.equal(r.done, true);
    assert.equal(sb.calls.some((c: any) => c.fn === 'download'), true);

    const ins = sb.calls.find((c: any) => c.fn === 'insert');
    assert.equal(ins.args.text, 'subfloor rot');
    assert.equal(ins.args.source_language, 'en');
    assert.equal(ins.args.engine, 'deepgram');
    assert.equal(ins.args.duration_sec, 9);

    // After the step, not at the end of the job.
    assert.equal(sb.calls.some((c: any) => c.fn === 'complete_step'), true);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.DEEPGRAM_API_KEY;
  }
});

// A provider error must park the job WITH the reason attached, never write a
// transcript. This is the case that would otherwise hand a contractor a blank
// preview card after the audio is gone.
test('a provider error parks the job and writes nothing', async () => {
  process.env.DEEPGRAM_API_KEY = 'test-key';
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: false, status: 401, text: async () => '{"err_msg":"bad key"}',
  })) as any;
  try {
    const sb = fakeClient(job({ steps: ['transcribe'] }));
    const r = await runOnce(sb, 'w1');

    assert.equal(r.blocked, 'needs_api_key');
    assert.equal(sb.calls.some((c: any) => c.fn === 'insert'), false);
    // The provider's own words reach processing_job.last_error, so the backlog
    // says "401 bad key" rather than leaving someone guessing at the dashboard.
    const block = sb.calls.find((c: any) => c.fn === 'block_job');
    assert.match(block.args.p_error, /401/);
    assert.match(block.args.p_error, /bad key/);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.DEEPGRAM_API_KEY;
  }
});

// ── resolve_project: needs no credential at all ──────────────────────────────

test('resolve_project writes a signal from the transcript', async () => {
  const sb = fakeClient(job({ steps: ['resolve_project'] }));
  const r = await runOnce(sb, 'w1');

  assert.equal(r.done, true);
  const ins = sb.calls.find((c: any) => c.fn === 'insert');
  assert.equal(ins.args.candidate_project_id, 'p1');
  assert.equal(ins.args.matched_on, 'address');
  assert.equal(ins.args.confidence, 'high');
  // Auditable: the words that produced the signal travel with it.
  assert.match(ins.args.from_transcript, /14 Elm St/);
});

// THE RACE THAT LOOKED LIKE A HEALTHY PIPELINE.
//
// hadar, 2026-08-23: "the latest co that was created it is stack on writing it up".
// Both engines had written a row 302ms apart — Deepgram's 1,537 characters, then the
// phone's 34-character fragment. The read took the newest, `structure` was handed four
// words, answered `confidence: none` on them (correctly), and the extra kept its
// placeholder. Nothing errored and no job blocked, so every diagnostic said fine.
//
// Rows arrive newest-first, so the fragment is FIRST here — the order that produced
// the bug — and the cloud reading still has to win.
test('the phone fragment never outranks the cloud transcript', async () => {
  const sb = fakeClient(job({ steps: ['resolve_project'] }), [
    { text: "All right, we're gonna do a", engine: 'ios-ondevice' },
    { text: 'work at 14 Elm St', engine: 'deepgram' },
  ]);
  await runOnce(sb, 'w1');

  const ins = sb.calls.find((c: any) => c.fn === 'insert');
  assert.match(ins.args.from_transcript, /14 Elm St/,
    'the worker structured the phone fragment instead of the cloud transcript');
});

// The other half: preferring the cloud engine must not DISCARD an on-device reading
// when it is the only one there. Offline, the phone's pass is the whole record, and
// refusing it would turn a working offline capture into a silent nothing (mandate #7).
test('an on-device reading is used when it is the only one', async () => {
  const sb = fakeClient(job({ steps: ['resolve_project'] }), [
    { text: 'work at 14 Elm St', engine: 'ios-ondevice' },
  ]);
  await runOnce(sb, 'w1');

  const ins = sb.calls.find((c: any) => c.fn === 'insert');
  assert.match(ins.args.from_transcript, /14 Elm St/);
  assert.equal(ins.args.confidence, 'high');
});

// 'none' is a real answer — "the words point at nothing we know". Recording it is
// what distinguishes a capture that was considered from one never reached.
test('no match still writes a signal, with confidence none', async () => {
  const sb = fakeClient(job({ steps: ['resolve_project'] }));
  sb.rpc = (fn: string, args: any) => {
    sb.calls.push({ fn, args });
    if (fn === 'claim_job') return Promise.resolve({ data: job({ steps: ['resolve_project'] }), error: null });
    if (fn === 'content_resolve') return Promise.resolve({ data: [], error: null });
    return Promise.resolve({ data: null, error: null });
  };
  await runOnce(sb, 'w1');
  const ins = sb.calls.find((c: any) => c.fn === 'insert');
  assert.equal(ins.args.candidate_project_id, null);
  assert.equal(ins.args.confidence, 'none');
});

// A transcript naming TWO jobs. Verified against the real content_resolve on a
// local Postgres: it returns {project_id: null, matched_on: 'ambiguous',
// confidence: 'none'} — one row, not zero, and 'none' is already a legal value.
// So the coercion below is defensive, not load-bearing, and this test says which
// it is rather than implying the function returns something it does not.
test('an unexpected confidence is coerced, not inserted raw', async () => {
  const sb = fakeClient(job({ steps: ['resolve_project'] }));
  sb.rpc = (fn: string, args: any) => {
    sb.calls.push({ fn, args });
    if (fn === 'claim_job') return Promise.resolve({ data: job({ steps: ['resolve_project'] }), error: null });
    if (fn === 'content_resolve') return Promise.resolve({
      // Deliberately NOT the real shape: this asserts what happens if the
      // function ever returns a value the check constraint would reject.
      data: [{ project_id: null, matched_on: 'ambiguous', confidence: 'ambiguous' }], error: null });
    return Promise.resolve({ data: null, error: null });
  };
  await runOnce(sb, 'w1');
  assert.equal(sb.calls.find((c: any) => c.fn === 'insert').args.confidence, 'none');
});

// A signal saying "matched nothing" when nothing was READ would be a lie about
// evidence. Out-of-order must park, not invent.
test('no transcript parks the step instead of writing an empty signal', async () => {
  const sb = fakeClient(job({ steps: ['resolve_project'] }), []);
  const r = await runOnce(sb, 'w1');
  assert.equal(r.blocked, 'needs_api_key');
  assert.equal(sb.calls.some((c: any) => c.fn === 'insert'), false);
});

// The observed ambiguous shape, taken from a real call rather than assumed: two
// jobs named in one transcript must file to NEITHER. Mandate #8 — the column is
// `candidate_project_id`, and nothing here moves a capture between jobs.
test('a transcript naming two jobs resolves to neither', async () => {
  const sb = fakeClient(job({ steps: ['resolve_project'] }));
  sb.rpc = (fn: string, args: any) => {
    sb.calls.push({ fn, args });
    if (fn === 'claim_job') return Promise.resolve({ data: job({ steps: ['resolve_project'] }), error: null });
    if (fn === 'content_resolve') return Promise.resolve({
      data: [{ project_id: null, matched_on: 'ambiguous', matched_text: null, confidence: 'none' }],
      error: null });
    return Promise.resolve({ data: null, error: null });
  };
  await runOnce(sb, 'w1');
  const ins = sb.calls.find((c: any) => c.fn === 'insert');
  assert.equal(ins.args.candidate_project_id, null);
  assert.equal(ins.args.matched_on, 'ambiguous');
  assert.equal(ins.args.confidence, 'none');
});

// ── Codex, adversarial review 2026-08-24: three ways cloud-first went wrong ──────

test('CODEX: an EMPTY cloud transcript does not beat a device one that heard words', () => {
  // This one LOSES A CAPTURE. deepgram.ts treats '' as a real answer meaning silence,
  // and preferring any cloud row over any device row meant "replace damaged subfloor"
  // was thrown away for a '' that arrived after it. Preferring the cloud is about
  // accuracy between two readings of the same speech; when one contains no speech there
  // is nothing to be more accurate about.
  const sb = fakeClient(job({ steps: ['resolve_project'] }), [
    { text: '', engine: 'deepgram' },
    { text: 'work at 14 Elm St', engine: 'ios-ondevice' },
  ]);
  return runOnce(sb, 'w1').then(() => {
    const ins = sb.calls.find((c: any) => c.fn === 'insert');
    assert.match(ins.args.from_transcript, /14 Elm St/,
      'a capture with words in it was structured as silence');
  });
});

test('CODEX: many device retries cannot hide the cloud row', async () => {
  // The LIMIT used to apply before the ranking, so a contractor re-recording on a bad
  // morning pushed Deepgram out of the window and cloud-first stopped working —
  // silently, and exactly on the captures most likely to need it.
  const sb = fakeClient(job({ steps: ['resolve_project'] }), [
    ...Array.from({ length: 8 }, (_, i) => ({ text: `attempt ${i}`, engine: 'ios-ondevice' })),
    { text: 'work at 14 Elm St', engine: 'deepgram' },
  ]);
  await runOnce(sb, 'w1');

  const ins = sb.calls.find((c: any) => c.fn === 'insert');
  assert.match(ins.args.from_transcript, /14 Elm St/,
    'eight device retries buried the cloud transcript');
});

test('CODEX: a future on-device engine does not get treated as cloud', async () => {
  // The first version asked `engine !== 'ios-ondevice'`, so every other string counted
  // as cloud — android-ondevice, manual, imported. Ranking by "is not the one name I
  // remembered" is the fall-through shape extrabucket.ts exists to kill.
  const sb = fakeClient(job({ steps: ['resolve_project'] }), [
    { text: 'a phone guess', engine: 'android-ondevice' },
    { text: 'work at 14 Elm St', engine: 'deepgram' },
  ]);
  await runOnce(sb, 'w1');

  const ins = sb.calls.find((c: any) => c.fn === 'insert');
  assert.match(ins.args.from_transcript, /14 Elm St/,
    'android-ondevice outranked Deepgram');
});

test('silence heard by BOTH still reports silence, not "not transcribed yet"', async () => {
  // The distinction the callers depend on: '' means the recorder heard nothing and the
  // step is finished; null means nothing has been transcribed and the step must park.
  // Collapsing them turns a silent recording into a job that retries forever.
  const sb = fakeClient(job({ steps: ['resolve_project'] }), [
    { text: '', engine: 'deepgram' },
    { text: '', engine: 'ios-ondevice' },
  ]);
  const r = await runOnce(sb, 'w1');
  assert.notEqual(r.blocked, 'needs_api_key',
    'a heard-nothing recording parked as though it had never been transcribed');
});

// ── The structure step must report how long it took (302) ────────────────────────

test('a structured proposal carries its own duration', async () => {
  // 302 added `structure_ms`, its view reads it, and the worker never wrote it: 53
  // proposals and 27 latency rows, every one NULL. R2 targets 15s and nothing in the
  // product could say whether it was met — the pipeline could drift to 90s and the only
  // symptom would be contractors quietly giving up on the review card.
  //
  // Driven through the path where the model answers but the parser REJECTS the body:
  // `structureTranscript` returns null, the step still writes a proposal (confidence
  // 'none'), and that write must carry the duration like any other. Testing this shape
  // rather than a happy-path model reply keeps the test about the timing instead of
  // about the schema, which has its own tests.
  process.env.ANTHROPIC_API_KEY = 'test-key';
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    id: 'msg_1', type: 'message', role: 'assistant', model: 'test',
    stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 },
    content: [{ type: 'text', text: 'not the json this parser wants' }],
  }), { status: 200, headers: { 'content-type': 'application/json' } })) as any;
  try {
    const sb = fakeClient(job({ steps: ['structure'] }));
    await runOnce(sb, 'w1');

    const ins = sb.calls.find((c: any) => c.fn === 'insert' && 'confidence' in (c.args ?? {}));
    assert.ok(ins, 'no proposal was written at all');
    // The point of the test: a number, whatever the wall clock happened to be.
    assert.equal(typeof ins.args.structure_ms, 'number',
      'the proposal went in without a duration — 302s view stays empty and the 15s target unmeasurable');
    assert.ok(ins.args.structure_ms >= 0);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.ANTHROPIC_API_KEY;
  }
});
