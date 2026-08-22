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

/** The scope of work, as the sections a change order is written in (393). */
export type ScopeSections = {
  /** WHY: what was found or asked for, and what makes it extra. */
  background: string | null;
  /** WHAT / HOW: the work, in the order it happens. */
  steps: string[];
  /** WHAT THE OWNER GETS for this money — the boundary's inside edge. */
  included: string[];
  /** WHERE IT STOPS. The single most argued-about part of a change order. */
  excluded: string[];
  /** Conditions the contractor voiced ("if the framing is rotten we stop and call
   *  you") plus standard trade assumptions the model proposes. Not decoration:
   *  these are what the owner is agreeing to along with the work. */
  assumptions: string[];
};

/** The flow terms the narration already stated, in change_order's own vocabulary. */
export type StructureTerms = {
  scheduleEffect: 'no_change' | 'adds_days' | 'not_sure' | null;
  scheduleDays: number | null;
  billingTiming: 'next_invoice' | 'when_completed' | 'other' | null;
};

export type StructureResult = {
  subject: string;
  /** The RENDERED scope of work — built by `renderScope` from `sections`, never by
   *  the model, so the headings, order and formatting of the binding document are
   *  ours and identical on every extra. */
  value: string;
  sections: ScopeSections;
  terms: StructureTerms;
  whoDirected: string | null;
  extraType: (typeof EXTRA_TYPES)[number] | null;
  /** Search tags proposed from the transcript. Normalised lowercase, deduped,
   *  capped — a model that returns forty tags has stopped tagging and started
   *  listing, and the grid it feeds has finite room. */
  tags: string[];
  confidence: 'high' | 'low' | 'none';
  tasks: StructureTask[];
};

/**
 * THE MODEL THAT WRITES THE DOCUMENT — configurable, because it is ~70% of what a
 * change order costs to produce.
 *
 * hadar, 2026-08-17: unlimited subscriptions stay sellable only if COGS comes down.
 * Measured before this change: ~$0.66 per signed change order, of which Opus with
 * adaptive thinking was roughly two thirds. `docs/PRICING-STRATEGY.md` had assumed
 * ~$0.01 on a cheap model, and every margin number in it was computed from that.
 *
 * WHY IT IS AN ENV VAR AND NOT SIMPLY A CHEAPER CONSTANT. CLAUDE.md mandate #4:
 * "Transcription is a commodity; the structuring layer is the product." This is the
 * one model in the system whose output a homeowner signs. Swapping it blind trades a
 * cost problem for a quality problem that would surface as worse scopes of work —
 * visible to clients, invisible in any test we run. So the model is a setting, the
 * cheap one is the default, and `scripts/compare-structure.mjs` runs both over real
 * transcripts so the choice is made on read output rather than on price alone.
 *
 * Override with STRUCTURE_MODEL to go back to Opus for a single job, a single
 * deploy, or a comparison run.
 */
/**
 * MEASURED, THEN KEPT (2026-08-17). `scripts/compare-structure.mjs` ran this prompt
 * over ALL 19 usable real transcripts against `claude-sonnet-5`:
 *
 *   cost              Opus $1.7576   Sonnet $0.5165   — Sonnet 3.4x cheaper
 *   same confidence   17/19
 *   same task count   18/19
 *   who_directed      Opus 9/19      Sonnet 3/19      ← the reason we did not switch
 *
 * Subjects and tasks were near-identical; on price alone Sonnet wins easily. But
 * `who_directed` is WHO THE EXTRA IS FOR. It is copied into
 * `confirmation_request.counterparty_label` at send and frozen into the instrument the
 * client signs. Missing it puts the contractor back through "choose a client" by hand;
 * getting it wrong puts the wrong name on a legal document.
 *
 * Three times the miss rate on that field is not a saving, it is a transfer of cost
 * from us to the person on the ladder — and mandate #4 is explicit that the structuring
 * layer is the product. So Opus stays, and the cost came out of PROMPT CACHING instead,
 * which takes ~50% at volume and changes nothing the model sees.
 *
 * Revisit by re-running the comparison, not by reasoning about model tiers.
 */
export const STRUCTURE_MODEL =
  process.env.STRUCTURE_MODEL?.trim() || 'claude-opus-4-8';

/**
 * Extended thinking is OFF by default, and that is a cost decision with a reason.
 *
 * `thinking: adaptive` bills its reasoning tokens as OUTPUT, so the bill is not
 * bounded by `max_tokens` on the visible answer — the most expensive and least
 * predictable part of the call. This step is CONSTRAINED EXTRACTION: `STRUCTURE_SCHEMA`
 * dictates the shape, `SYSTEM` dictates the rules, and the input is a transcript. It is
 * not a task where a model needs to reason its way to an approach.
 *
 * Set STRUCTURE_THINKING=1 to turn it back on for a comparison run.
 */
export const STRUCTURE_THINKING = process.env.STRUCTURE_THINKING === '1';

/** Strict schema: the API guarantees the shape, parseStructure re-checks anyway
 *  (a network boundary is a network boundary). */
const TASK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'scope', 'materials', 'price_words', 'time_words', 'start_words'],
  properties: {
    title: {
      type: 'string',
      description: 'Short name for this SEGMENT of the work, <=60 characters. A segment is one area or one stage the owner would recognise as a separable piece — "Kitchen ceiling", "Rewire the hall", "Patch and paint after". Not a material, not a line item, not a price.',
    },
    scope: {
      type: 'string',
      description: 'Clear 1-3 sentence description of THIS SEGMENT for the owner: what gets done here, in plain words, naming the materials the contractor named. Describe ONLY this segment — the other segments have their own entries. Never a price: the money lives in price_words and nowhere else.',
    },
    materials: {
      type: 'array', items: { type: 'string' },
      description: 'Materials the transcript mentions FOR THIS TASK. Empty when none.',
    },
    price_words: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
      description: 'The VERBATIM transcript span where a price for THIS SEGMENT was spoken, e.g. "about eighteen fifty". Attribute a figure to a segment ONLY when the contractor tied it to that segment. A single figure covering the whole job belongs to no segment — leave every segment null and let the total stand alone. Null when no price was mentioned for this one. Never rewrite, round, convert, or split a figure across segments.',
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

const SECTIONS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['background', 'steps', 'included', 'excluded', 'assumptions'],
  properties: {
    background: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
      description: 'WHY this change is needed: what was found on site or what the owner asked for, in 1-3 sentences. From the transcript only. Null when the transcript gives no reason.',
    },
    steps: {
      type: 'array', items: { type: 'string' },
      description: 'WHAT WILL BE DONE, in the order it happens. One clear sentence per step, in the owner\'s language, naming the materials the contractor named. No prices.',
    },
    included: {
      type: 'array', items: { type: 'string' },
      description: 'What this change order COVERS that the owner would otherwise wonder about — cleanup, haul-away, patching back, matching finish, permits, the make-good after the work. Draw from the transcript first; you MAY add the standard items this trade normally includes, phrased so a homeowner understands. Never a price.',
    },
    excluded: {
      type: 'array', items: { type: 'string' },
      description: 'What this change order does NOT cover — the boundary. Anything the contractor said is separate or "not in this", plus the standard exclusions a professional would state for this work (e.g. hidden damage found once open, painting of adjacent rooms, fixture supply, permit fees when not mentioned). Phrase each as a plain sentence the owner can act on.',
    },
    assumptions: {
      type: 'array', items: { type: 'string' },
      description: 'Conditions this depends on: what the contractor said would change the job ("if the framing is rotten we stop and call you"), access or timing he needs, and standard assumptions for this work. Plain sentences.',
    },
  },
} as const;

const TERMS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['schedule_effect', 'schedule_days', 'billing_timing'],
  properties: {
    schedule_effect: {
      anyOf: [{ type: 'string', enum: ['no_change', 'adds_days', 'not_sure'] }, { type: 'null' }],
      description: 'What the contractor SAID about the effect on the schedule. no_change when he said it does not push anything; adds_days when he named or implied added days; not_sure when he said he does not know yet. NULL when he did not address it at all — null and not_sure are different answers and must not be merged.',
    },
    schedule_days: {
      anyOf: [{ type: 'integer' }, { type: 'null' }],
      description: 'Days added, ONLY when the transcript states a number of days for this work. Null otherwise. Never estimate.',
    },
    billing_timing: {
      anyOf: [{ type: 'string', enum: ['next_invoice', 'when_completed', 'other'] }, { type: 'null' }],
      description: 'What he SAID about when this gets billed. Null when he did not say — do not assume a default.',
    },
  },
} as const;

export const STRUCTURE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['subject', 'sections', 'terms', 'who_directed', 'extra_type', 'tags', 'confidence', 'tasks'],
  properties: {
    subject: {
      type: 'string',
      description: 'Short title naming the work overall, <=60 characters, no prices.',
    },
    sections: SECTIONS_SCHEMA,
    terms: TERMS_SCHEMA,
    who_directed: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
      description: 'Who asked for or authorized this work, ONLY if the transcript names them.',
    },
    extra_type: {
      anyOf: [{ type: 'string', enum: [...EXTRA_TYPES] }, { type: 'null' }],
      description: 'The kind of extra overall, or null when unsure.',
    },
    tags: {
      type: 'array',
      items: { type: 'string' },
      description: 'Three to eight short lowercase search tags drawn FROM THE TRANSCRIPT — room, trade, material, or condition (e.g. "kitchen", "electrical", "subfloor", "water damage"). One or two words each. No prices, no names of people, nothing the transcript does not support. Empty array when confidence is none.',
    },
    confidence: {
      type: 'string',
      enum: ['high', 'low', 'none'],
      description: 'high only when the transcript clearly describes extra work.',
    },
    tasks: {
      type: 'array', items: TASK_SCHEMA,
      description: 'The work split into SEGMENTS — one entry per area or stage the owner would recognise as a separable piece of the job, each with its own scope, materials and price span grouped under it. IN CHRONOLOGICAL ORDER: the sequence the work happens on site, which is usually the order the contractor walked and described it. A homeowner should be able to read these top to bottom and follow the job. A single-segment narration is an array of one. Empty only when confidence is none.',
    },
  },
} as const;

const SYSTEM = `You turn a contractor's spoken jobsite narration into a professional change order for a residential remodeling job. You will receive a raw transcript.

WHO YOU ARE WRITING FOR, AND WHY IT MATTERS. The contractor is standing on a jobsite and talking, not writing. He rambles, repeats himself, starts in the middle, and says things out of order. That is the point — his job is to tell you what happened; yours is to turn it into a document a homeowner can read once and say yes to. The homeowner must finish it knowing: what will happen, why, how, what it covers, what it does NOT cover, and what to expect. A change order that leaves any of those unanswered is how disputes start, which is the entire thing this product exists to prevent.

Rules, in order of importance:

1. FACTS COME FROM THE TRANSCRIPT. Never invent measurements, materials, causes, names, dates, durations, or work that was not described. You may compress, re-order and re-word freely — a rambling narration SHOULD come out as clean prose — but you may not add a fact.

2. THE ONE EXCEPTION, AND ITS LIMITS: 'included', 'excluded' and 'assumptions' may carry STANDARD trade items the contractor did not say, because their absence is what gets argued about later and a professional document states them. They must be (a) genuinely standard for this trade and this work, (b) phrased as plain sentences a homeowner understands, and (c) never contradict anything he did say. Never invent a standard item into 'background' or 'steps' — those are the work itself, and inventing there is inventing scope.

3. NEVER WRITE A PRICE. No dollar amounts, hourly rates, or cost figures anywhere in subject, sections, tasks or terms. Pricing runs through a separate human-confirmed flow. A cost the contractor spoke is captured ONLY as a verbatim quote in price_words.

4. VERBATIM SPANS. price_words, time_words and start_words must be EXACT copies from the transcript — "eighteen fifty" stays "eighteen fifty". Never rewrite, round, convert or normalise. Null when absent. Never guess.

5. SECTIONS — the scope of work, and the most important thing you produce. It becomes the binding text the owner signs.
   background — WHY. What was found on site or what the owner asked for, and what makes it extra work rather than part of the original job. 1-3 sentences. Null only when the transcript truly gives no reason.
   steps — WHAT and HOW, in the order the work happens, one clear sentence each, naming the materials he named. This is where his rambling becomes a sequence. Do not pad: three real steps beat eight invented ones.
   included — what the owner GETS for this. What he would otherwise have to ask about: cleanup, haul-away, patching back, matching the finish, protecting adjacent surfaces, permits when he mentioned them.
   excluded — WHERE IT STOPS. Anything he said is separate, plus the standard exclusions for this work under rule 2. This section is why the document is worth signing.
   assumptions — what this depends on and what would change it: conditions he voiced, access or timing he needs, standard dependencies for this work.

6. TERMS. Report only what he SAID. schedule_effect null and "not_sure" are different answers: null means he never addressed the schedule, not_sure means he said he does not know yet. Same for billing_timing — do not assume a default, because a clause nobody chose ends up in a document somebody signs.

7. TASKS ARE SEGMENTS OF THE JOB, AND THEY ARE HOW THE OWNER UNDERSTANDS IT. Split the work into the pieces a homeowner would recognise as separable — by AREA ("the hall bath", "the kitchen ceiling") or by STAGE ("open up and assess", "rebuild", "patch and paint back"). Group each segment's own materials, price mention, time mention and start mention under THAT segment. A mention belonging to one segment must not leak onto another; when genuinely ambiguous, attach it to the segment discussed nearest to it.

   ORDER THEM CHRONOLOGICALLY — the sequence the work happens on site, which is usually the order he walked and described it. The owner should read them top to bottom and follow the job. Do not order by price or by importance.

   A SEGMENT IS NOT A LINE ITEM. "Two sheets of drywall" is a material and belongs in that segment's materials; "Repair the ceiling where the leak came through" is a segment. Do not split one piece of work into a segment per material, and do not merge two rooms into one segment because they share a trade.

   PRICES ATTACH TO SEGMENTS ONLY WHEN HE TIED THEM THERE. "The bathroom's about twelve hundred, the hall another four" is two segment prices. "Call it three grand for the whole thing" is ONE price for the whole job — in that case leave every segment's price_words null, because a total split across segments is a number nobody said. Never divide a figure yourself.

8. subject: a short title naming the work overall (e.g. "Subfloor rot repair under tub"), 60 characters or fewer. Several tasks: name the dominant work.

9. who_directed: the person who asked for or authorised the work, ONLY if the transcript names one; otherwise null.

10. extra_type: structural | mep (mechanical/electrical/plumbing) | finish | code_permit | site_condition | scope_clarification — or null when none clearly fits.

11. tags: three to eight short lowercase search tags from the transcript — room, trade, material, condition. One or two words each. No prices, no people's names. Empty when confidence is none.

12. confidence: "high" only when the transcript clearly describes extra work and your output is directly supported by it. "low" when the audio is garbled or ambiguous. "none" when it does not describe jobsite work at all — then steps and tasks are empty.

LANGUAGE. Write the document in clear professional English a homeowner understands, whatever language he spoke; keep the trade terms he used. Short sentences. No jargon he did not use, no filler, no salesmanship.`;

/**
 * The sections -> the SCOPE OF WORK text, built HERE and never by the model.
 *
 * The document's shape is ours: same headings, same order, same punctuation on every
 * extra this product has ever produced. Letting the model format it means an owner who
 * signs two change orders from the same contractor reads two differently-shaped
 * documents, and it means a prompt edit can silently restyle a binding instrument.
 *
 * Empty sections are OMITTED, never printed as "None". A heading with nothing under it
 * reads as an oversight; the absence of an exclusions list is not a claim that nothing
 * is excluded, and printing "None" would make it one.
 *
 * Plain text with UPPERCASE headings rather than markdown: this string is rendered into
 * `shown_content` (the frozen instrument), an approval page, a PDF and an SMS-length
 * preview, and the only formatting all four agree on is line breaks.
 */
export function renderScope(x: ScopeSections): string {
  const out: string[] = [];
  const list = (heading: string, items: string[], numbered = false) => {
    const clean = items.map((i) => i.trim()).filter(Boolean);
    if (!clean.length) return;
    out.push(heading);
    clean.forEach((i, n) => out.push(numbered ? `${n + 1}. ${i}` : `• ${i}`));
    out.push('');
  };
  if (x.background?.trim()) { out.push('WHY THIS IS NEEDED', x.background.trim(), ''); }
  list('WHAT WILL BE DONE', x.steps, true);
  list('WHAT THIS INCLUDES', x.included);
  list('WHAT THIS DOES NOT INCLUDE', x.excluded);
  list('CONDITIONS', x.assumptions);
  return out.join('\n').trim();
}

function strArray(v: unknown, cap: number, max = 400): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && !!x.trim())
    .map((x) => x.trim().slice(0, max))
    .slice(0, cap);
}

function parseSections(raw: unknown): ScopeSections {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    background: str(r.background, 1200),
    // Capped so a model that starts listing cannot produce a document nobody reads.
    steps: strArray(r.steps, 20),
    included: strArray(r.included, 12),
    excluded: strArray(r.excluded, 12),
    assumptions: strArray(r.assumptions, 10),
  };
}

function parseTerms(raw: unknown): StructureTerms {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const eff = r.schedule_effect;
  const bill = r.billing_timing;
  const days = typeof r.schedule_days === 'number' && Number.isFinite(r.schedule_days)
    ? Math.max(1, Math.min(365, Math.round(r.schedule_days))) : null;
  return {
    scheduleEffect: eff === 'no_change' || eff === 'adds_days' || eff === 'not_sure' ? eff : null,
    // A day count without "adds_days" is a contradiction; trust the enum, drop the
    // number, because the enum is what the document renders a clause from.
    scheduleDays: eff === 'adds_days' ? days : null,
    billingTiming: bill === 'next_invoice' || bill === 'when_completed' || bill === 'other'
      ? bill : null,
  };
}

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
  const confidence = r.confidence === 'high' || r.confidence === 'low' || r.confidence === 'none'
    ? r.confidence : null;
  const sections = parseSections(r.sections);
  const terms = parseTerms(r.terms);
  // `value` is RENDERED, not read: the model no longer returns it (393). A result with
  // no subject, no confidence, or nothing at all to say about the work is unusable —
  // and an empty render is exactly that, so it fails here rather than seeding a blank
  // scope of work onto a change order.
  const value = renderScope(sections);
  if (!subject || !confidence || !value) return null;
  const extraType = typeof r.extra_type === 'string'
    && (EXTRA_TYPES as readonly string[]).includes(r.extra_type)
    ? (r.extra_type as StructureResult['extraType']) : null;
  const whoDirected = str(r.who_directed, 120);
  // A malformed task drops; the rest stand. Capped so a runaway array cannot
  // become a megabyte row.
  const tasks = Array.isArray(r.tasks)
    ? r.tasks.map(parseTask).filter((t): t is StructureTask => t !== null).slice(0, 12)
    : [];
  // Same defensive re-check as everything else crossing this boundary: lowercase,
  // trimmed, deduped, length-capped, and 8 at most. Non-strings are dropped rather
  // than coerced — "3" is not a tag.
  const tags = Array.isArray(r.tags)
    ? [...new Set(
        (r.tags as unknown[])
          .filter((x): x is string => typeof x === 'string' && !!x.trim())
          .map((x) => x.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 40)))]
        .slice(0, 8)
    : [];
  return { subject, value, sections, terms, whoDirected, extraType, tags, confidence, tasks };
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
    // Omitted entirely when off — sending `{ type: 'disabled' }` is not the same as
    // not asking, and the default here is not asking.
    ...(STRUCTURE_THINKING ? { thinking: { type: 'adaptive' } } : {}),
    output_config: { format: { type: 'json_schema', schema: STRUCTURE_SCHEMA } },
    /**
     * THE PROMPT IS CACHED, BECAUSE IT IS THE SAME EVERY TIME AND IT IS MOST OF THE BILL.
     *
     * Measured against real transcripts on 2026-08-17: input was 4,158 tokens for a
     * SEVENTY-ONE CHARACTER transcript, and 4,413 for an 830-character one. The speech
     * is a rounding error; what is being paid for on every single call is this system
     * prompt and the schema beside it — re-sent in full, per capture, forever.
     *
     * `cache_control: ephemeral` makes that prefix a cache write once and a cache READ
     * on every call after it (5-minute TTL, refreshed by each hit). Cache reads bill at
     * a fraction of input rate, and the pipeline structures captures in bursts, which is
     * exactly the shape that keeps a cache warm.
     *
     * ZERO QUALITY RISK, and that is why it is done here and unconditionally while the
     * model choice is still being measured: the model receives byte-identical input
     * either way. Nothing about the document changes.
     */
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: transcript }],
  } as unknown as Anthropic.MessageCreateParamsNonStreaming;
  const resp = await client.messages.create(params);

  if (resp.stop_reason === 'refusal') return null;
  const text = resp.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') return null;
  try { return parseStructure(JSON.parse(text.text)); } catch { return null; }
}

/**
 * The system prompt and the schema, exported for `scripts/compare-structure.mjs`.
 *
 * Exported rather than copied into that script on purpose: a comparison run against a
 * duplicated prompt would be comparing two things, neither of which is what ships. If
 * the rules change here, the comparison changes with them.
 */
export const SYSTEM_FOR_TOOLS = SYSTEM;
export const SCHEMA_FOR_TOOLS = STRUCTURE_SCHEMA;
