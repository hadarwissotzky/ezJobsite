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

/** One of the listed values, or null. Never coerces: a value outside the vocabulary
 *  is a schema disagreement, and guessing which one it meant is how a clause nobody
 *  chose reaches a document somebody signs. */
function enumOr<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

function strList(v: unknown, cap: number): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string' && !!x.trim())
       .map((x) => x.trim().slice(0, 400)).slice(0, cap)
    : [];
}

function parseSections(raw: unknown): Proposal['sections'] {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const background = typeof r.background === 'string' && r.background.trim()
    ? r.background.trim().slice(0, 1200) : null;
  const sections = {
    background,
    steps: strList(r.steps, 20),
    included: strList(r.included, 12),
    excluded: strList(r.excluded, 12),
    assumptions: strList(r.assumptions, 10),
  };
  // Nothing in any section is not "an empty document" — it is no document.
  const empty = !sections.background && !sections.steps.length && !sections.included.length
    && !sections.excluded.length && !sections.assumptions.length;
  return empty ? null : sections;
}

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
  /** Search tags the model proposed from the transcript (392). A PROPOSAL: the app
   *  promotes them onto the capture as `author: 'ai'` tags, so a human can retract
   *  any of them and the retraction is itself recorded (tags.ts is append-only). */
  tags: string[];
  /** Grouped tasks (374). Empty when the proposal predates them. */
  tasks: ProposalTask[];
  /**
   * 393 — the scope IN SECTIONS, and the terms the narration already stated.
   *
   * `value` is the rendered text of `sections`; these are here so the app can apply
   * the parts that belong in the change order's OWN columns (schedule effect,
   * payment timing, exclusions) instead of counting them as gaps the contractor has
   * to fill by hand after he already said the answer out loud.
   *
   * Still proposals. They are applied only where he has answered nothing, and the
   * send gate puts him in front of every one before it can leave (mandate #2).
   */
  sections: {
    background: string | null;
    steps: string[];
    included: string[];
    excluded: string[];
    assumptions: string[];
  } | null;
  scheduleEffect: 'no_change' | 'adds_days' | 'not_sure' | null;
  scheduleDays: number | null;
  billingTiming: 'next_invoice' | 'when_completed' | 'other' | null;
  exclusionsText: string | null;
  inclusionsText: string | null;
  /**
   * THE AMENDED SCOPE OF WORK, PROPOSED (hadar, 2026-08-23: an edit is "an augmentation
   * and amendment", not a redo).
   *
   * The full amended text, ready to show beside the current scope. NEVER applied without
   * the contractor accepting it: `scope_of_work` is what the client is asked to approve,
   * so mandate #2 puts a confirmation in front of any change to it. Null unless
   * `amendStatus` is 'amended'.
   */
  amendedScope: string | null;
  /** One line naming what the model added, in his words — shown under the proposal so
   *  he is not asked to accept a change he cannot see the reason for. */
  amendReason: string | null;
  /**
   * What the amend pass concluded, or null when it never ran (every proposal written
   * before 420). 'no_change' is a FINDING — "we read both and the scope already covers
   * it" — and is deliberately distinguishable from never having looked.
   */
  amendStatus: 'amended' | 'no_change' | 'not_draft' | 'no_scope' | 'no_words' | null;
  confidence: Confidence;
  engine: string;
  engineModel: string | null;
  fromTranscript: string | null;
  createdAt: string;
};

/** Everything a proposal has held since 160, through 374/392. Every deployment has
 *  these columns. */
const BASE_COLS =
  'id, capture_id, proposed_subject, proposed_value, proposed_scope, ' +
  'proposed_who_directed, proposed_amount_cents, proposed_extra_type, proposed_tags, ' +
  'proposed_tasks, confidence, engine, engine_model, from_transcript, created_at';

/** 393's additions. Present only where the migration has been applied. */
const SECTION_COLS =
  ', proposed_sections, proposed_schedule_effect, proposed_schedule_days' +
  ', proposed_billing_timing, proposed_exclusions, proposed_inclusions';

/**
 * 420's columns. Appended to the same tier as 393's for the same reason its header
 * gives: the client ships over the air and the migration is applied by a person, so
 * between those two moments every select naming one of these fails with 42703 and the
 * fallback below is what keeps the AI's write-up reaching the app at all.
 */
const AMEND_COLS = ', proposed_amended_scope, amend_reason, amend_status';

const PROPOSAL_COLS = BASE_COLS + SECTION_COLS + AMEND_COLS;

/**
 * Ask for 393's columns, and fall back to the old set when the server does not have
 * them yet.
 *
 * WHY THIS IS NOT OVER-ENGINEERING. The client ships over the air; the migration is
 * applied by a person. Between those two moments every `select` naming a 393 column
 * fails with 42703 / PGRST204 — and this select is the ONLY path the AI's write-up
 * takes into the app. Without the fallback, shipping the new client would stop titles,
 * summaries and scopes from being applied AT ALL until someone remembered to run the
 * SQL: a total regression of the working feature, caused by adding a column.
 *
 * The failure is loud in the other direction (the fallback simply returns the older
 * shape, whose new fields are null), so the cost of being wrong here is one round-trip.
 */
/**
 * `amendAware` is passed to the builder, NOT baked into it, and the reason is the
 * fallback: the filter names `amend_status`, so on a server that has not run 420 the
 * filtered query 42703s exactly as the column list does — and the retry would carry the
 * same filter into the same error. The retry therefore asks the OLD question, which is
 * the right one for an old server: there are no amend rows there to exclude.
 */
async function selectProposal(
  client: SupabaseClient,
  build: (cols: string, amendAware: boolean) =>
    PromiseLike<{ data: unknown[] | null; error: unknown }>,
): Promise<Proposal | null> {
  let { data, error } = await build(PROPOSAL_COLS, true);
  if (error) {
    const code = (error as { code?: string }).code;
    // Only a SCHEMA disagreement retries. A permission or network error is not fixed
    // by asking for fewer columns, and retrying it would just double the wait.
    if (code !== '42703' && code !== 'PGRST204' && code !== 'PGRST200') return null;
    ({ data, error } = await build(BASE_COLS, false));
    if (error) return null;
  }
  if (!data?.length) return null;
  return rowToProposal(data[0] as any);
}

/** The latest proposal for a capture, or null if the pipeline hasn't produced one. */
export async function fetchProposal(
  client: SupabaseClient, captureId: string
): Promise<Proposal | null> {
  return selectProposal(client, (cols, amendAware) => {
    const q = client.from('capture_structured').select(cols).eq('capture_id', captureId);
    return (amendAware ? q.is('amend_status', null) : q)
      .order('created_at', { ascending: false }).limit(1) as any;
  });
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
  return selectProposal(client, (cols, amendAware) => {
    const q = client.from('capture_structured').select(cols).in('capture_id', captureIds);
    return (amendAware ? q.is('amend_status', null) : q)
      .order('created_at', { ascending: false }).limit(1) as any;
  });
}

/**
 * The latest SCOPE AMENDMENT for a set of captures. A separate reader on purpose.
 *
 * THIS IS THE FIX FOR THE BUG 420 SHIPPED WITH (code review, 2026-08-23, HIGH). The
 * `amend_scope` step writes a row for EVERY outcome — including `no_words` and
 * `no_scope`, which is right, because "we looked and there was nothing" is a finding.
 * But those rows carry `confidence 'none'` and no `proposed_*` values, and the readers
 * above take the newest row unconditionally. So the amend row shadowed the write-up:
 * `applyProposalToExtra` returns early on 'none', which silently cost the extra its
 * summary, its AI tags, its type AND the tasks the priced composer fills the total
 * from — the headline feature of the same branch, disabled by its own migration.
 *
 * Two questions, two queries. The proposal readers now exclude amend rows; this one
 * asks for exactly them.
 */
export async function fetchLatestAmendmentForCaptures(
  client: SupabaseClient, captureIds: string[]
): Promise<Proposal | null> {
  if (!captureIds.length) return null;
  const { data, error } = await client
    .from('capture_structured')
    .select(PROPOSAL_COLS)
    .in('capture_id', captureIds)
    .not('amend_status', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1) as any;
  // No fallback tier: a server without 420 has no amendments to report, and asking it
  // the old question would return a write-up dressed as an amendment.
  if (error || !data?.length) return null;
  return rowToProposal(data[0]);
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
    // Older proposals carry no column; an absent list is not an empty opinion, but
    // there is nothing to apply either way.
    tags: Array.isArray(r.proposed_tags) ? r.proposed_tags.filter((x: unknown): x is string => typeof x === 'string') : [],
    tasks: parseTasks(r.proposed_tasks),
    // Same defensive re-read as everything else crossing this boundary: a row written
    // before 393 has nulls here, and a malformed sections blob degrades to null rather
    // than half a document.
    sections: parseSections(r.proposed_sections),
    scheduleEffect: enumOr(r.proposed_schedule_effect,
      ['no_change', 'adds_days', 'not_sure'] as const),
    scheduleDays: typeof r.proposed_schedule_days === 'number' && r.proposed_schedule_days > 0
      ? Math.round(r.proposed_schedule_days) : null,
    billingTiming: enumOr(r.proposed_billing_timing,
      ['next_invoice', 'when_completed', 'other'] as const),
    exclusionsText: typeof r.proposed_exclusions === 'string' && r.proposed_exclusions.trim()
      ? r.proposed_exclusions.trim() : null,
    inclusionsText: typeof r.proposed_inclusions === 'string' && r.proposed_inclusions.trim()
      ? r.proposed_inclusions.trim() : null,
    amendedScope: typeof r.proposed_amended_scope === 'string' && r.proposed_amended_scope.trim()
      ? r.proposed_amended_scope : null,
    amendReason: typeof r.amend_reason === 'string' && r.amend_reason.trim()
      ? r.amend_reason.trim() : null,
    amendStatus: enumOr(r.amend_status,
      ['amended', 'no_change', 'not_draft', 'no_scope', 'no_words'] as const),
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
