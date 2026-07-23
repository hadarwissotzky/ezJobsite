/**
 * R2's structure step — the layer mandate #4 calls "the product".
 *
 * Turns the transcript of a jobsite narration into the PROPOSAL row that
 * `capture_structured` (160) was built to hold and the app's review screen
 * (proposals.ts / reviewscreen.tsx) has been reading into a void:
 * a short subject (the title), a cleaned-up account of the work (the value),
 * who directed it, an R5c type tag, and the model's own confidence.
 *
 * THE TWO FENCES, restated from 160's header because this is the file that
 * could breach them:
 *
 *  - NO PRICE. `proposed_amount_cents` stays null forever from here. Given
 *    "four fifty" a model invented $450 at high confidence — that is why the
 *    price is read back from the transcript by the app's own parser and
 *    confirmed by a human (mandate #6). The prompt forbids amounts in the
 *    subject and value too, so a price cannot ride in through a side door.
 *  - A PROPOSAL, NOT A RECORD. Only facts present in the transcript may
 *    appear; the model may compress and re-word, never add. Confidence is
 *    self-reported and anything below 'high' never prefills (proposals.ts
 *    rule 2), so the honest answer to a mumbled recording is 'low', not a
 *    tidy invention.
 */
import Anthropic from '@anthropic-ai/sdk';

/** Mirrors apps/mobile/src/approverrouting.ts EXTRA_TYPES and the 373 CHECK. */
export const EXTRA_TYPES = [
  'structural', 'mep', 'finish', 'code_permit', 'site_condition', 'scope_clarification',
] as const;

/** One task the narration described, with its elements grouped (374).
 *  The *_words fields are VERBATIM SPANS of the transcript — never parsed,
 *  never normalized: a quote is evidence, a number would be an author. */
export type StructureTask = {
  title: string;
  scope: string;
  materials: string[];
  priceWords: string | null;
  timeWords: string | null;
  startWords: string | null;
};

export type StructureResult = {
  subject: string;
  value: string;
  whoDirected: string | null;
  extraType: (typeof EXTRA_TYPES)[number] | null;
  confidence: 'high' | 'low' | 'none';
  tasks: StructureTask[];
};

export const STRUCTURE_MODEL = 'claude-opus-4-8';

/** Strict schema: the API guarantees the shape, parseStructure re-checks anyway
 *  (a network boundary is a network boundary). */
const TASK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'scope', 'materials', 'price_words', 'time_words', 'start_words'],
  properties: {
    title: { type: 'string', description: 'Short name for this task, <=60 characters.' },
    scope: {
      type: 'string',
      description: 'Clear 1-3 sentence description of this task for the owner. No prices.',
    },
    materials: {
      type: 'array', items: { type: 'string' },
      description: 'Materials the transcript mentions FOR THIS TASK. Empty when none.',
    },
    price_words: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
      description: 'The VERBATIM transcript span where a price for this task was spoken, e.g. "about eighteen fifty". Null when no price was mentioned. Never rewrite, round, or convert it.',
    },
    time_words: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
      description: 'Verbatim span mentioning labor time or duration, e.g. "six hours plus materials". Null when absent.',
    },
    start_words: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
      description: 'Verbatim span mentioning when work could start, e.g. "we could start Tuesday". Null when absent.',
    },
  },
} as const;

export const STRUCTURE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['subject', 'value', 'who_directed', 'extra_type', 'confidence', 'tasks'],
  properties: {
    subject: {
      type: 'string',
      description: 'Short title naming the work overall, <=60 characters, no prices.',
    },
    value: {
      type: 'string',
      description: 'The owner-facing scope of change: clear professional prose, grouped by task when there are several, covering what was found, what work is needed, materials, and timing the contractor mentioned. NO prices.',
    },
    who_directed: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
      description: 'Who asked for or authorized this work, ONLY if the transcript names them.',
    },
    extra_type: {
      anyOf: [{ type: 'string', enum: [...EXTRA_TYPES] }, { type: 'null' }],
      description: 'The kind of extra overall, or null when unsure.',
    },
    confidence: {
      type: 'string',
      enum: ['high', 'low', 'none'],
      description: 'high only when the transcript clearly describes extra work.',
    },
    tasks: {
      type: 'array', items: TASK_SCHEMA,
      description: 'One entry per distinct task the narration describes, each with ITS OWN elements grouped. A single-task narration is an array of one. Empty only when confidence is none.',
    },
  },
} as const;

const SYSTEM = `You turn a contractor's spoken jobsite narration into a clean change-order proposal for a residential remodeling job. You will receive a raw transcript.

Rules, in order of importance:
1. Use ONLY facts present in the transcript. Never invent measurements, materials, causes, names, timings, or scope. You may compress and re-word prose; you may never add.
2. NEVER write prices, dollar amounts, hourly rates, or cost figures into subject, value, title, or scope. Pricing is handled by a separate human-confirmed flow. Price mentions are captured ONLY as verbatim quotes in price_words.
3. The *_words fields (price_words, time_words, start_words) must be EXACT VERBATIM SPANS copied from the transcript. Never rewrite, round, convert, or normalize them — "eighteen fifty" stays "eighteen fifty". If no such mention exists, use null. Never guess.
4. TASKS: if the narration describes more than one distinct piece of work, produce one task entry per piece and group each task's own materials, price mention, time mention, and start mention with THAT task. A mention that clearly belongs to one task must not leak onto another. If an element's task is ambiguous, attach it to the task discussed nearest to it in the transcript.
5. value: the owner-facing scope of change. Clear professional English a homeowner understands (the transcript may be in any language; trade terms the contractor used stay). Cover, per task: what was found or requested, what work will be done, materials involved, and any labor-time or start-timing the contractor mentioned — in words, without dollar figures. When there are several tasks, present them as clearly separated numbered parts.
6. subject: a short title naming the work overall (e.g. "Subfloor rot repair under tub"), 60 characters or fewer. For several tasks, name the dominant work (e.g. "Bath rough-in extras: panel upgrade and subfloor repair").
7. who_directed: the person who asked for or authorized the work, ONLY if the transcript names one; otherwise null.
8. extra_type: structural | mep (mechanical/electrical/plumbing) | finish (finish or fixture selection) | code_permit | site_condition (something discovered on site) | scope_clarification — or null when none clearly fits.
9. confidence: "high" only when the transcript clearly describes extra work and your output is directly supported by it. "low" when the audio seems garbled or ambiguous. "none" when the transcript does not describe jobsite work at all (then tasks is an empty array).`;

function str(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
}

/** One wire task -> one StructureTask, or null when it lacks its spine. */
export function parseTask(raw: unknown): StructureTask | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  const title = str(t.title, 200);
  const scope = str(t.scope, 2000);
  if (!title || !scope) return null;
  const materials = Array.isArray(t.materials)
    ? t.materials.filter((m): m is string => typeof m === 'string' && !!m.trim())
        .map((m) => m.trim().slice(0, 120)).slice(0, 20)
    : [];
  return {
    title, scope, materials,
    priceWords: str(t.price_words, 200),
    timeWords: str(t.time_words, 200),
    startWords: str(t.start_words, 200),
  };
}

/** Validate whatever came back over the wire into a StructureResult, or null. */
export function parseStructure(raw: unknown): StructureResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const subject = str(r.subject, 200);
  const value = str(r.value, 4000);
  const confidence = r.confidence === 'high' || r.confidence === 'low' || r.confidence === 'none'
    ? r.confidence : null;
  if (!subject || !value || !confidence) return null;
  const extraType = typeof r.extra_type === 'string'
    && (EXTRA_TYPES as readonly string[]).includes(r.extra_type)
    ? (r.extra_type as StructureResult['extraType']) : null;
  const whoDirected = str(r.who_directed, 120);
  // A malformed task drops; the rest stand. Capped so a runaway array cannot
  // become a megabyte row.
  const tasks = Array.isArray(r.tasks)
    ? r.tasks.map(parseTask).filter((t): t is StructureTask => t !== null).slice(0, 12)
    : [];
  return { subject, value, whoDirected, extraType, confidence, tasks };
}

export function hasLlmKey(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

/**
 * One transcript -> one proposal. Throws on transport/auth failures (the caller
 * parks the job with the provider's own words); returns null when the model
 * declined or produced something unusable — which the caller records as a
 * 'none' proposal rather than pretending the step never ran.
 */
export async function structureTranscript(
  transcript: string
): Promise<StructureResult | null> {
  const client = new Anthropic();
  // Cast through the non-streaming params type: `output_config` may postdate
  // the installed SDK's typings, and the non-streaming overload is what pins
  // the return to a Message rather than a stream union.
  const params = {
    model: STRUCTURE_MODEL,
    max_tokens: 4096,
    thinking: { type: 'adaptive' },
    output_config: { format: { type: 'json_schema', schema: STRUCTURE_SCHEMA } },
    system: SYSTEM,
    messages: [{ role: 'user', content: transcript }],
  } as unknown as Anthropic.MessageCreateParamsNonStreaming;
  const resp = await client.messages.create(params);

  if (resp.stop_reason === 'refusal') return null;
  const text = resp.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') return null;
  try { return parseStructure(JSON.parse(text.text)); } catch { return null; }
}
