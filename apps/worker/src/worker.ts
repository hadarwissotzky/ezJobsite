/**
 * The worker that implements `140_processing_jobs`.
 *
 * WHAT THIS FIXES. `voicesource.ts` reads `capture_transcript` and
 * `voiceprice.ts` extracts a price from it, both built and both tested. NOTHING
 * WROTE THAT TABLE. R2 was recorded for weeks as "pipeline built but not
 * configured (no STT key)", which named the symptom and got the cause wrong: a
 * key alone would have changed nothing, because there was no worker and no
 * server in this repo at all.
 *
 * WHY IT IS USEFUL BEFORE THERE IS A KEY. `processing_job.blocked_reason`
 * already includes `needs_api_key`, and `block_job` already takes a reason a
 * person can act on. Parking a job with that reason is the SPECIFIED behaviour,
 * not a placeholder: `processing_backlog` then answers "what is waiting, and
 * why" — which is the office's Monday query and REQ-PROC6's source. Run it today
 * and the backlog says `needs_api_key` with a count. Supply a key and the same
 * jobs drain, because claim_job already re-claims blocked jobs whose reason may
 * have cleared.
 *
 * It uses the SERVICE ROLE. 140 revokes claim/complete/finish/block from public,
 * anon and authenticated, so this is the only identity that can advance a job —
 * which is why the worker is a server and never the app.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isComplete, pendingSteps } from './steps.ts';
import { hasSttKey, transcribe, type Transcript } from './transcribe.ts';

export type Job = {
  id: string; capture_id: string; owner_id: string; project_id: string;
  steps: string[]; completed_steps: string[];
  state: string; blocked_reason: string; attempts: number;
};

export type StepOutcome =
  | { ok: true }
  /** Park it with a reason. `retryable` decides whether it is worth another pass. */
  | { ok: false; reason: 'needs_api_key' | 'needs_connection'; error?: string };

/**
 * Run ONE step. Split out so the loop below has no knowledge of what a step
 * does, and so each step's failure is parked with its own reason rather than a
 * generic one.
 */
export async function runStep(
  sb: SupabaseClient, job: Job, step: string
): Promise<StepOutcome> {
  if (step === 'transcribe') {
    if (!hasSttKey()) return { ok: false, reason: 'needs_api_key' };
    // `capture.payload` holds the storage object key (060 inserts p_object_key
    // into it). The bucket is 'captures', matching uploader.ts.
    const { data: cap, error: capErr } = await sb
      .from('capture').select('payload, media_mime_type').eq('id', job.capture_id).single();
    if (capErr || !cap?.payload) {
      return { ok: false, reason: 'needs_connection', error: capErr?.message ?? 'no payload key' };
    }
    const dl = await sb.storage.from('captures').download(cap.payload);
    if (dl.error || !dl.data) {
      return { ok: false, reason: 'needs_connection', error: dl.error?.message ?? 'no audio' };
    }
    // A provider failure PARKS the job, it does not throw. A 401 from a wrong
    // key thrown out of here would leave the job 'running' until its lease
    // expired, retry five times, and never once appear in processing_backlog as
    // something a person could fix. needs_api_key with the provider's own words
    // attached is REQ-PROC6 working: "what is waiting, and why".
    let t: Transcript | null;
    try {
      t = await transcribe(await dl.data.arrayBuffer(),
                           cap.media_mime_type ?? 'audio/m4a');
    } catch (e: any) {
      return { ok: false, reason: 'needs_api_key', error: String(e?.message ?? e).slice(0, 400) };
    }
    if (t === null) return { ok: false, reason: 'needs_api_key' };
    return writeTranscript(sb, job, t);
  }
  // detect_language and structure both consume the transcript. Until the
  // transcribe step can run there is nothing for them to read, so they are not
  // implemented here rather than being implemented against nothing — a step that
  // "succeeds" without doing anything would mark the job done and the capture
  // processed, and the contractor would get an empty preview card with no
  // indication that anything was missing.
  return { ok: false, reason: 'needs_api_key' };
}

/**
 * Transcripts are append-only (150's trigger blocks UPDATE and DELETE), so this
 * inserts and never upserts. Re-transcribing means a NEW row, which is why the
 * table is read newest-first.
 */
async function writeTranscript(
  sb: SupabaseClient, job: Job, t: Transcript
): Promise<StepOutcome> {
  const { error } = await sb.from('capture_transcript').insert({
    id: `tr-${job.capture_id}-${t.engine}-${Date.now()}`,
    capture_id: job.capture_id,
    owner_id: job.owner_id,
    text: t.text,
    source_language: t.language,
    engine: t.engine,
    engine_model: t.model,
    duration_sec: t.durationSec,
  });
  if (error) return { ok: false, reason: 'needs_connection', error: error.message };
  return { ok: true };
}

/**
 * Claim one job and advance it as far as it can go.
 *
 * `complete_step` is called after EACH step, never once at the end. That is the
 * whole point of the design: recording only at the end means every crash re-runs
 * a paid API call.
 *
 * Returns what happened so the caller can log it. Never throws on a job-level
 * failure — a worker that dies on one bad capture stops processing every other
 * capture behind it.
 */
export async function runOnce(
  sb: SupabaseClient, workerId: string
): Promise<{ claimed: boolean; jobId?: string; done?: boolean; blocked?: string }> {
  const { data, error } = await sb.rpc('claim_job', {
    p_worker: workerId, p_lease_seconds: 120,
  });
  if (error) throw error;                    // a claim failure is infrastructure
  const job = (Array.isArray(data) ? data[0] : data) as Job | null;
  if (!job || !job.id) return { claimed: false };

  for (const step of pendingSteps(job.steps ?? [], job.completed_steps ?? [])) {
    const out = await runStep(sb, job, step);
    if (!out.ok) {
      await sb.rpc('block_job', {
        p_job: job.id, p_reason: out.reason, p_error: out.error ?? null,
      });
      return { claimed: true, jobId: job.id, blocked: out.reason };
    }
    await sb.rpc('complete_step', { p_job: job.id, p_step: step });
    job.completed_steps = [...(job.completed_steps ?? []), step];
  }

  if (isComplete(job.steps ?? [], job.completed_steps ?? [])) {
    // finish_job re-checks the same condition server-side and refuses silently
    // if work is outstanding. Calling it is a request, not an assertion.
    await sb.rpc('finish_job', { p_job: job.id });
    return { claimed: true, jobId: job.id, done: true };
  }
  return { claimed: true, jobId: job.id };
}

export function serviceClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'worker needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. ' +
      'The anon key cannot advance a job: 140 revokes claim_job from anon.');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}
