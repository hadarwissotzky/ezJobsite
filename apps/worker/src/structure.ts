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

export type StructureResult = {
  subject: string;
  value: string;
  whoDirected: string | null;
  extraType: (typeof EXTRA_TYPES)[number] | null;
  confidence: 'high' | 'low' | 'none';
};

export const STRUCTURE_MODEL = 'claude-opus-4-8';

/** Strict schema: the API guarantees the shape, parseStructure re-checks anyway
 *  (a network boundary is a network boundary). */
export const STRUCTURE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['subject', 'value', 'who_directed', 'extra_type', 'confidence'],
  properties: {
    subject: {
      type: 'string',
      description: 'Short title naming the work, <=60 characters, no prices.',
    },
    value: {
      type: 'string',
      description: 'Clear 2-4 sentence description of the extra work, no prices.',
    },
    who_directed: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
      description: 'Who asked for or authorized this work, ONLY if the transcript names them.',
    },
    extra_type: {
      anyOf: [{ type: 'string', enum: [...EXTRA_TYPES] }, { type: 'null' }],
      description: 'The kind of extra, or null when unsure.',
    },
    confidence: {
      type: 'string',
      enum: ['high', 'low', 'none'],
      description: 'high only when the transcript clearly describes extra work.',
    },
  },
} as const;

const SYSTEM = `You turn a contractor's spoken jobsite narration into a clean change-order proposal for a residential remodeling job. You will receive a raw transcript.

Rules, in order of importance:
1. Use ONLY facts present in the transcript. Never invent measurements, materials, causes, names, or scope. You may compress and re-word; you may never add.
2. NEVER include prices, dollar amounts, hourly rates, or cost figures anywhere in your output — not in the subject, not in the value. Pricing is handled by a separate human-confirmed flow. If the transcript states a price, simply omit it.
3. Write in clear professional English a homeowner understands (the transcript may be in any language). Keep trade terms the contractor used.
4. subject: a short title naming the work (e.g. "Subfloor rot repair under tub"), 60 characters or fewer.
5. value: 2-4 sentences describing what was found and what work is needed, faithful to the contractor's meaning.
6. who_directed: the person who asked for or authorized the work, ONLY if the transcript names one; otherwise null.
7. extra_type: structural | mep (mechanical/electrical/plumbing) | finish (finish or fixture selection) | code_permit | site_condition (something discovered on site) | scope_clarification — or null when none clearly fits.
8. confidence: "high" only when the transcript clearly describes extra work and your subject and value are directly supported by it. "low" when the audio seems garbled or ambiguous. "none" when the transcript does not describe jobsite work at all.`;

/** Validate whatever came back over the wire into a StructureResult, or null. */
export function parseStructure(raw: unknown): StructureResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const subject = typeof r.subject === 'string' ? r.subject.trim().slice(0, 200) : '';
  const value = typeof r.value === 'string' ? r.value.trim().slice(0, 4000) : '';
  const confidence = r.confidence === 'high' || r.confidence === 'low' || r.confidence === 'none'
    ? r.confidence : null;
  if (!subject || !value || !confidence) return null;
  const extraType = typeof r.extra_type === 'string'
    && (EXTRA_TYPES as readonly string[]).includes(r.extra_type)
    ? (r.extra_type as StructureResult['extraType']) : null;
  const whoDirected = typeof r.who_directed === 'string' && r.who_directed.trim()
    ? r.who_directed.trim().slice(0, 120) : null;
  return { subject, value, whoDirected, extraType, confidence };
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
