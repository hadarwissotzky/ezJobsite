/**
 * Reading the AI's proposal — the missing half of the pipeline.
 *
 * The worker writes `capture_structured` server-side and, until now, NOTHING on the
 * client ever read it: the pipeline wrote into a void. This module is the read side.
 *
 * THREE RULES THIS FILE ENFORCES (they are the whole reason the table is called
 * "proposal" and not "decision"):
 *
 *  1. **A proposal is a GUESS.** `is_proposal_not_record` is true by construction. It
 *     becomes a record only when a human confirms it (REQ-PROC8 → recordDecision).
 *  2. **low/none confidence NEVER prefills** (mandate #2). A field the model wasn't
 *     sure about arrives EMPTY, so the human types it rather than nods at it. A
 *     confidently-wrong prefill that a tired man taps past is the failure mode.
 *  3. **The model never sets the price** (mandate #6, and the measured reason: given
 *     "four fifty" it invented `$450` at high confidence). `proposed_amount_cents` is
 *     expected to be null; the price is read back from `from_transcript` by the app's
 *     own `parseMoney()` at review time, and typed by a person if that refuses.
 *
 * Fetched over the network on purpose: the proposal only EXISTS after the online
 * pipeline ran, so there is nothing to show offline. The capture itself is always
 * local (mandate #7) — only the AI's opinion about it needs a connection.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type Confidence = 'high' | 'low' | 'none';

/** One grouped task from the structure step (374). The *_words fields are
 *  verbatim transcript spans — evidence of a mention, never a parsed figure. */
export type ProposalTask = {
  title: string;
  scope: string;
  materials: string[];
  priceWords: string | null;
  timeWords: string | null;
  startWords: string | null;
};

function parseTasks(raw: unknown): ProposalTask[] {
  if (!Array.isArray(raw)) return [];
  const out: ProposalTask[] = [];
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue;
    const r = t as Record<string, unknown>;
    if (typeof r.title !== 'string' || typeof r.scope !== 'string') continue;
    out.push({
      title: r.title, scope: r.scope,
      materials: Array.isArray(r.materials)
        ? r.materials.filter((m): m is string => typeof m === 'string') : [],
      priceWords: typeof r.price_words === 'string' ? r.price_words : null,
      timeWords: typeof r.time_words === 'string' ? r.time_words : null,
      startWords: typeof r.start_words === 'string' ? r.start_words : null,
    });
  }
  return out;
}

export type Proposal = {
  id: string;
  captureId: string;
  subject: string | null;
  value: string | null;
  scope: 'project' | 'party' | null;
  whoDirected: string | null;
  amountCents: number | null;
  /** R5c type the model proposed (373). A suggestion for the send preview's
   *  contractor-set picker — never applied without the human seeing it. */
  extraType: string | null;
  /** Grouped tasks (374). Empty when the proposal predates them. */
  tasks: ProposalTask[];
  confidence: Confidence;
  engine: string;
  engineModel: string | null;
  fromTranscript: string | null;
  createdAt: string;
};

const PROPOSAL_COLS =
  'id, capture_id, proposed_subject, proposed_value, proposed_scope, ' +
  'proposed_who_directed, proposed_amount_cents, proposed_extra_type, ' +
  'proposed_tasks, confidence, engine, engine_model, from_transcript, created_at';

/** The latest proposal for a capture, or null if the pipeline hasn't produced one. */
export async function fetchProposal(
  client: SupabaseClient, captureId: string
): Promise<Proposal | null> {
  const { data, error } = await client
    .from('capture_structured')
    .select(PROPOSAL_COLS)
    .eq('capture_id', captureId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error || !data?.length) return null;
  return rowToProposal(data[0] as any);
}

/**
 * The latest proposal across a SET of captures — a fused decision has photo captures
 * too, and only the voice one ever gets a structured row, so the caller passes every
 * capture behind the decision and takes the newest hit. Null when none has one yet.
 */
export async function fetchLatestProposalForCaptures(
  client: SupabaseClient, captureIds: string[]
): Promise<Proposal | null> {
  if (!captureIds.length) return null;
  const { data, error } = await client
    .from('capture_structured')
    .select(PROPOSAL_COLS)
    .in('capture_id', captureIds)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error || !data?.length) return null;
  return rowToProposal(data[0] as any);
}

function rowToProposal(r: any): Proposal {
  return {
    id: r.id,
    captureId: r.capture_id,
    subject: r.proposed_subject ?? null,
    value: r.proposed_value ?? null,
    scope: r.proposed_scope ?? null,
    whoDirected: r.proposed_who_directed ?? null,
    amountCents: r.proposed_amount_cents ?? null,
    extraType: r.proposed_extra_type ?? null,
    tasks: parseTasks(r.proposed_tasks),
    confidence: (['high', 'low', 'none'].includes(r.confidence) ? r.confidence : 'low') as Confidence,
    engine: r.engine,
    engineModel: r.engine_model ?? null,
    fromTranscript: r.from_transcript ?? null,
    createdAt: r.created_at,
  };
}

/**
 * What may be PREFILLED into the review form.
 *
 * Mandate #2, mechanically: only a `high`-confidence proposal prefills. Anything else
 * hands back empty fields and the reason, so the human authors it instead of
 * confirming the machine. The price is never prefilled from the model at all.
 */
export function prefillFrom(p: Proposal | null): {
  subject: string; value: string; whoDirected: string; prefilled: boolean; why: string | null;
} {
  if (!p) return { subject: '', value: '', whoDirected: '', prefilled: false, why: null };
  if (p.confidence !== 'high') {
    return {
      subject: '', value: '', whoDirected: '', prefilled: false,
      why: p.confidence === 'none'
        ? 'The recording didn’t sound like a decision — write it yourself.'
        : 'Not confident enough to fill this in — check the recording and write it.',
    };
  }
  return {
    subject: p.subject ?? '', value: p.value ?? '',
    whoDirected: p.whoDirected ?? '', prefilled: true, why: null,
  };
}
