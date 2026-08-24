/**
 * Change Order client — SPEC §7.2, and the UI half of mandate #6.
 *
 * MANDATE #6 is the whole reason this file has a "read-back" step:
 *   "Numbers/prices/measurements are the highest-risk field. NEVER trust them
 *    from the transcript. Read-back + on-screen tap-to-correct. Always."
 *
 * The DB enforces that `numbers_confirmed_at` is NOT NULL, so an unconfirmed
 * price cannot be stored. This file is what makes that constraint reachable by a
 * human: parse a number OUT of what was said, show it back BIG, and make the
 * contractor look at it and agree before anything is sent.
 *
 * The parser is deliberately conservative. It would rather find nothing and make
 * someone type the figure than confidently find the wrong one — a silently wrong
 * price is the failure mode with a lawyer attached. That is why `confidence` is
 * returned and why 'low' forces the field open.
 */
import { SupabaseClient } from '@supabase/supabase-js';
// TYPE-ONLY, and it must stay that way. A value import pulls in React
// Native's Flow-typed source, which Node cannot parse, and the tests that
// exercise this file's SQL stop running.
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';
import { sha256 } from 'js-sha256';
import { getLang } from './i18n.ts';
// The hydrate's conflict line has to survive a Release build. console.log does not
// (diaglog.ts's header): a permanent phone-vs-cloud disagreement about a signed
// document that only ever printed to a debugger nobody has attached is, in the
// field, silent.
import { logDiag } from './diaglog.ts';
// SPEC-extra-lifecycle-v1 §1.3 is the ONE authority on which status moves are
// legal. Every status write below states its guard TWICE on purpose: once through
// this module (the belt — a diagnosable refusal with both states named) and once
// as a literal `WHERE status …` on the UPDATE (the braces — what actually protects
// the row against a writer that forgot the belt). DEF-1 is what one alone costs.
// The explicit .ts extension keeps this file loadable under `node --test`.
import {
  canAdoptServerStatus, canTransition, canCreateLinkedExtra, isStoredStatus, type StoredStatus,
} from './extralifecycle.ts';

/**
 * The device authors change orders. The cloud gets a copy.
 *
 * This was a direct insert to Supabase, which meant PRICING REQUIRED SIGNAL --
 * and the list was read from the server, so with no signal you could not even see
 * the change orders you already had. Mandate #7 calls offline-forward paramount
 * and the money was the one thing that ignored it.
 *
 * Same three-part shape as capture and decisions, for the same reasons:
 *   change_order       -- the record. Local, durable, authored here.
 *   change_order_outbox-- transport intent. Deleting a row never destroys a CO.
 * The outbox row is written INSIDE the insert's transaction; a crash between them
 * would leave a priced CO that nothing will ever try to upload.
 */
/** The machine placeholder a capture-born extra is titled with. Same string as
 *  `startextra.ts:UNTITLED` and `public.untitled_scope()` on the server — three
 *  copies of one literal is two too many, and this one exists only because
 *  importing startextra here would make a cycle. Change one, change all three. */
const UNTITLED_SCOPE_TEXT = 'Untitled extra — still being written up';

export const CHANGE_ORDER_DDL = [
  `CREATE TABLE IF NOT EXISTS change_order (
      id            TEXT NOT NULL PRIMARY KEY,
      decision_id   TEXT NOT NULL,
      project_id    TEXT NOT NULL,
      owner_id      TEXT NOT NULL,
      scope         TEXT NOT NULL CHECK (length(scope) > 0),
      -- 391 — the detailed client-facing scope; the column above is the title.
      -- Declared HERE as well as in the ALTER list so a FRESH install has it from the
      -- first statement rather than only once ensureFlowFields has run. The test
      -- harness applies this DDL alone, so hydrate INSERTing the column failed there
      -- silently until discardextra.test.ts caught it.
      scope_of_work TEXT,
      line_items    TEXT NOT NULL DEFAULT '[]',
      -- INTEGER cents. Never float. Money in floats is a bug with a lawyer attached.
      --
      -- NULLABLE, and null is NOT zero. R2 takes the price from what the
      -- contractor said; if he never said one there is no price, and that is a
      -- different fact from "this costs nothing". Storing 0 for it would tell a
      -- homeowner the work is free, which is the most expensive sentence this
      -- app could print. The CHECK still bars negatives when a price IS given.
      amount_cents  INTEGER CHECK (amount_cents IS NULL OR amount_cents >= 0),
      currency      TEXT NOT NULL DEFAULT 'USD',
      nte_cents     INTEGER,
      is_mini       INTEGER NOT NULL DEFAULT 0 CHECK (is_mini IN (0,1)),
      who_directed  TEXT NOT NULL,
      ref_estimate  TEXT,
      -- MANDATE #6: not nullable here either. The device refuses an unconfirmed
      -- price at the same bar the server does, so being offline never lowers it.
      numbers_confirmed_at_ms INTEGER NOT NULL,
      status        TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','sent','approved','declined','superseded','cancelled')),
      signed_by     TEXT,
      created_at_ms INTEGER NOT NULL,
      -- The Simplest Jobsite Flow (FLOW-SIMPLEST-JOBSITE.md, 2026-07-23):
      -- billing timing, schedule effect, and exclusions are part of what the
      -- owner reads and signs. "not_sure" is a legal, honest value (decision 3).
      billing_timing  TEXT CHECK (billing_timing IS NULL
                        OR billing_timing IN ('next_invoice','when_completed','other')),
      schedule_effect TEXT CHECK (schedule_effect IS NULL
                        OR schedule_effect IN ('no_change','adds_days','not_sure')),
      schedule_days   INTEGER CHECK (schedule_days IS NULL OR schedule_days > 0),
      exclusions      TEXT,
      -- REQ-LC4: WHEN it changed state, not just what state it is in. Written by
      -- the same guarded UPDATE that moves the status, write-once
      -- (COALESCE on the stamp), so a second writer can never re-date a
      -- transition. Without them record.ts prints "time not recorded" over a
      -- signature and R8's 24h reminder clock has nothing to measure from.
      -- DEVICE-ONLY. The server derives the same moments from evidence it already
      -- holds (confirmation_request.created_at / confirmation_response.responded_at);
      -- a stored server copy would be the second-place-for-the-truth REQ-LC1
      -- forbids. The device stores them because it holds none of those rows and
      -- must render the record offline (mandate #7).
      sent_at_ms       INTEGER,
      approved_at_ms   INTEGER,
      declined_at_ms   INTEGER,
      superseded_at_ms INTEGER,
      -- REQ-LC31 / D6. The BACKWARD pointer, ACROSS the seal: this extra follows an
      -- APPROVED one. It is not superseded_by, which points FORWARD within one
      -- negotiation and retires what it points at. Writing this touches no column of
      -- the origin row — that is the whole point of D6.
      origin_change_order_id TEXT
   ) STRICT`,

  // Frozen once it leaves: a sent CO is superseded by a new one, never edited.
  // Mirrors change_order_guard() on the server so the rule does not depend on
  // which side you are looking from. NOTE: ensureFlowFields() re-creates this
  // trigger on every launch so existing installs pick up newly-frozen fields —
  // edit the copy THERE, this one only serves a brand-new install's first run.
  `CREATE TRIGGER IF NOT EXISTS change_order_frozen
     BEFORE UPDATE ON change_order
     WHEN old.status IN ('sent','approved','declined')
      AND (new.amount_cents IS NOT old.amount_cents
           OR new.scope IS NOT old.scope
           OR new.nte_cents IS NOT old.nte_cents
           OR new.billing_timing IS NOT old.billing_timing
           OR new.schedule_effect IS NOT old.schedule_effect
           OR new.schedule_days IS NOT old.schedule_days
           OR new.exclusions IS NOT old.exclusions
            -- 391: the scope of work IS the instrument's body now, so it freezes
            -- with everything else. Without this a sent extra's signed scope could
            -- be rewritten underneath the person who signed it.
            OR new.scope_of_work IS NOT old.scope_of_work)
     BEGIN SELECT RAISE(ABORT, 'a sent change order is frozen: supersede it'); END`,

  `CREATE TABLE IF NOT EXISTS change_order_outbox (
      mutation_id   TEXT NOT NULL PRIMARY KEY,
      change_order_id TEXT NOT NULL,
      payload_json  TEXT NOT NULL,
      payload_sha256 TEXT NOT NULL,
      queued_at_ms  INTEGER NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_attempt_at_ms INTEGER,
      next_attempt_at_ms INTEGER NOT NULL DEFAULT 0,
      last_error_code TEXT,
      last_error_text TEXT
   ) STRICT`,
];

export async function ensureChangeOrderSchema(db: AbstractPowerSyncDatabase) {
  for (const s of CHANGE_ORDER_DDL) await db.execute(s);
  await makeAmountNullable(db);
  await allowCancelledStatus(db);
  await ensureFlowFields(db);
}

/** The flow-mock fields (billing timing / schedule effect / exclusions) on
 *  EXISTING installs, plus the freeze trigger that covers them.
 *
 *  The trigger is dropped and re-created on every launch, deliberately:
 *  CREATE TRIGGER IF NOT EXISTS pins whatever definition a phone first shipped
 *  with, and a frozen-fields list that can silently lag behind the schema is
 *  how a "frozen" record stays editable. Drop+create is idempotent and costs
 *  nothing measurable at startup. */
async function ensureFlowFields(db: AbstractPowerSyncDatabase) {
  const cols = await db.getAll<{ name: string }>(
    `SELECT name FROM pragma_table_info('change_order')`);
  const have = new Set(cols.map((c) => c.name));
  const adds: Array<[string, string]> = [
    ['billing_timing', `TEXT CHECK (billing_timing IS NULL
        OR billing_timing IN ('next_invoice','when_completed','other'))`],
    ['schedule_effect', `TEXT CHECK (schedule_effect IS NULL
        OR schedule_effect IN ('no_change','adds_days','not_sure'))`],
    ['schedule_days', `INTEGER CHECK (schedule_days IS NULL OR schedule_days > 0)`],
    ['exclusions', 'TEXT'],
    // WHAT THE AI LAST WROTE into scope_of_work (2026-08-06). DEVICE-ONLY, like the
    // lifecycle stamps above and for the same reason: it is bookkeeping about
    // authorship, not part of the instrument, so it stays out of the ingest RPC's
    // fixed argument set. It is what lets a second recording rewrite a scope the model
    // produced while leaving a scope the contractor typed alone — see saveScopeOfWork.
    ['scope_of_work_ai', 'TEXT'],
    // 396 — the contractor's own words about cost ("probably $1,800"), verbatim. NOT a
    // price: it exists so the draft screen can read the number back and ask him to
    // confirm it, which is the half of mandate #6 that was missing — the pipeline
    // captured what he said and nothing ever showed it to him.
    ['price_heard', 'TEXT'],
    // The AI's owner-facing SUMMARY of the change (structure.ts `value`): clear
    // prose the client reads, grouped by task, no prices (hadar, 2026-07-27). Set
    // at draft processing from the proposal and shown on the record beside the raw
    // transcript. LOCAL-ONLY and derived — the server has no such column, so
    // hydrateChangeOrders (INSERT OR IGNORE + status-only UPDATE) never clobbers it.
    // Deliberately NOT in the freeze trigger: it is written draft-only (setDraftSummary),
    // so it cannot change after send, and it is a display aid, not the binding scope.
    ['summary', 'TEXT'],
    // REQ-LC4's state-change moments and REQ-LC31's origin link, for phones
    // already in the field. See CHANGE_ORDER_DDL above for what each one means and
    // why the server does NOT store the timestamps.
    ['sent_at_ms', 'INTEGER'],
    ['approved_at_ms', 'INTEGER'],
    ['declined_at_ms', 'INTEGER'],
    ['superseded_at_ms', 'INTEGER'],
    ['origin_change_order_id', 'TEXT'],
    // THE CHANGE ORDER'S NUMBER ON ITS JOB (hadar, 2026-07-31: "we cannot rely on
    // title"). Sequential per project — CO #1, #2, #3 on the Miller job — because
    // that is how a contractor, an owner and an office all file one. It is assigned
    // once at creation and never reassigned; a REVISION inherits the number of the
    // row it supersedes, so "CO #4 v2" is the second version of one change and not a
    // fifth change. The title is not an identifier: two extras can be called the same
    // thing, and a retitle would silently rename a document already in someone's inbox.
    ['co_number', 'INTEGER'],
    // 391 — THE DETAILED CLIENT-FACING SCOPE, split out of `scope`.
    //
    // `scope` was doing three jobs: the list-row title, the send-readiness gate, and
    // the body of the frozen instrument (App.tsx passed it to renderCard as both
    // subject AND value). A field short enough for a list row cannot also be a scope
    // of work, and the data proved it -- 15 change orders, average scope length 27
    // characters, longest 39, none approved. The client was signing a title.
    // `scope` stays the title; this is what the owner reads and signs.
    ['scope_of_work', 'TEXT'],
  ];
  for (const [name, ddl] of adds) {
    if (!have.has(name)) {
      await db.execute(`ALTER TABLE change_order ADD COLUMN ${name} ${ddl}`);
    }
  }
  // REQ-LC31 rule 3: "a lineage that can be rewritten is not a lineage." The origin
  // link is set at creation and never again. NULL -> a value is deliberately still
  // allowed: that is a lineage arriving late (a pull, a backfill), which can only
  // ADD the true fact. Value -> a different value is the act being refused, because
  // it would re-parent a priced extra onto an approval it never followed.
  //
  // A SEPARATE TRIGGER FROM change_order_frozen, not another clause in it: that one
  // only fires once a row is sent, and an origin link must be immutable from the
  // moment the draft exists.
  await db.execute(`DROP TRIGGER IF EXISTS change_order_origin_frozen`);
  await db.execute(`CREATE TRIGGER change_order_origin_frozen
     BEFORE UPDATE ON change_order
     WHEN old.origin_change_order_id IS NOT NULL
      AND new.origin_change_order_id IS NOT old.origin_change_order_id
     BEGIN SELECT RAISE(ABORT, 'the origin link is set once and never rewritten'); END`);
  await db.execute(`DROP TRIGGER IF EXISTS change_order_frozen`);
  await db.execute(`CREATE TRIGGER change_order_frozen
     BEFORE UPDATE ON change_order
     WHEN old.status IN ('sent','approved','declined')
      AND (new.amount_cents IS NOT old.amount_cents
           OR new.scope IS NOT old.scope
           OR new.nte_cents IS NOT old.nte_cents
           OR new.billing_timing IS NOT old.billing_timing
           OR new.schedule_effect IS NOT old.schedule_effect
           OR new.schedule_days IS NOT old.schedule_days
           OR new.exclusions IS NOT old.exclusions
            -- 391: the scope of work IS the instrument's body now, so it freezes
            -- with everything else. Without this a sent extra's signed scope could
            -- be rewritten underneath the person who signed it.
            OR new.scope_of_work IS NOT old.scope_of_work)
     BEGIN SELECT RAISE(ABORT, 'a sent change order is frozen: supersede it'); END`);
}

/** The flow-mock enums, exported once so UI, payloads and checks agree. */
export const BILLING_TIMINGS = ['next_invoice', 'when_completed', 'other'] as const;
export type BillingTiming = (typeof BILLING_TIMINGS)[number];
export const SCHEDULE_EFFECTS = ['no_change', 'adds_days', 'not_sure'] as const;
export type ScheduleEffect = (typeof SCHEDULE_EFFECTS)[number];

/**
 * EXISTING INSTALLS: drop NOT NULL from change_order.amount_cents.
 *
 * `CREATE TABLE IF NOT EXISTS` does nothing to a table that already exists, so a
 * phone that has been running keeps the old NOT NULL column and a priceless
 * extra fails on insert. SQLite has no ALTER COLUMN, so the only way is to
 * rebuild the table — which is why this is a guarded one-off and not an ALTER.
 *
 * IT RUNS AT MOST ONCE. The guard reads `pragma table_info` and returns
 * immediately if the column is already nullable, so this costs one pragma on
 * every launch after the first and rewrites nothing.
 *
 * THE COPY IS THE DANGEROUS PART and it is why the whole thing is one
 * transaction: this table holds the contractor's extras, including sent ones a
 * homeowner may have already approved. A rebuild that failed halfway with the
 * old table dropped and the new one unpopulated would lose the ledger. On any
 * error the transaction rolls back and the old table is still there, unchanged.
 *
 * Columns are listed EXPLICITLY rather than `SELECT *`: a positional copy is
 * correct only while the column order matches, and silently shifts every value
 * one place the day someone inserts a column into the DDL above.
 */
/**
 * WIDEN THE STATUS CHECK so a withdrawn extra can be stored (421, 2026-08-24).
 *
 * `CREATE TABLE IF NOT EXISTS` does not alter an existing table, so every device that
 * has ever run this app still holds `CHECK (status IN (... 'superseded'))`. Hydrating a
 * `cancelled` row onto one raises a constraint violation — on the pull path, for a fact
 * the server has already committed, which is the shape of failure mandate #7 forbids:
 * being behind on sync must not produce a wrong outcome.
 *
 * SAME SHAPE AS `makeAmountNullable` BELOW, and for the same reason it is that shape:
 * this table holds the contractor's ledger, including sent extras a homeowner may have
 * approved. One transaction, an explicit column list rather than `SELECT *`, and the
 * trigger recreated afterwards because it went with the dropped table.
 *
 * Detected from the table's own SQL rather than a version number: the question is
 * literally "does this CHECK admit the word", and `sqlite_master` answers it exactly.
 */
async function allowCancelledStatus(db: AbstractPowerSyncDatabase) {
  const row = (await db.getAll<{ sql: string }>(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='change_order'`))[0];
  // Absent (the DDL above just built it correctly) or already widened.
  if (!row?.sql || row.sql.includes("'cancelled'")) return;

  await db.writeTransaction(async (tx) => {
    await tx.execute(`CREATE TABLE change_order_cancelrebuild (
      id TEXT PRIMARY KEY, decision_id TEXT NOT NULL, project_id TEXT NOT NULL,
      owner_id TEXT NOT NULL, scope TEXT NOT NULL CHECK (length(scope) > 0),
      line_items TEXT NOT NULL DEFAULT '[]',
      amount_cents INTEGER CHECK (amount_cents IS NULL OR amount_cents >= 0),
      currency TEXT NOT NULL DEFAULT 'USD', nte_cents INTEGER,
      is_mini INTEGER NOT NULL DEFAULT 0 CHECK (is_mini IN (0,1)),
      who_directed TEXT NOT NULL, ref_estimate TEXT,
      numbers_confirmed_at_ms INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','sent','approved','declined','superseded','cancelled')),
      signed_by TEXT, created_at_ms INTEGER NOT NULL
    ) STRICT`);
    await tx.execute(`INSERT INTO change_order_cancelrebuild
      (id, decision_id, project_id, owner_id, scope, line_items, amount_cents,
       currency, nte_cents, is_mini, who_directed, ref_estimate,
       numbers_confirmed_at_ms, status, signed_by, created_at_ms)
      SELECT id, decision_id, project_id, owner_id, scope, line_items, amount_cents,
             currency, nte_cents, is_mini, who_directed, ref_estimate,
             numbers_confirmed_at_ms, status, signed_by, created_at_ms
        FROM change_order`);
    const before = (await tx.getAll<{ n: number }>(
      `SELECT COUNT(*) AS n FROM change_order`))[0]?.n ?? -1;
    const after = (await tx.getAll<{ n: number }>(
      `SELECT COUNT(*) AS n FROM change_order_cancelrebuild`))[0]?.n ?? -2;
    // COUNTED BEFORE THE DROP, like migrateOutboxFk: a rebuild that lost a sent extra
    // must leave the original standing, not report success.
    if (before !== after) throw new Error(`change_order rebuild would lose rows: ${before} -> ${after}`);
    await tx.execute(`DROP TABLE change_order`);
    await tx.execute(`ALTER TABLE change_order_cancelrebuild RENAME TO change_order`);
    // The trigger went with the dropped table. Without it a sent change order becomes
    // editable, which is the one thing the frozen rule exists to prevent.
    await tx.execute(`CREATE TRIGGER IF NOT EXISTS change_order_frozen
       BEFORE UPDATE ON change_order
       WHEN old.status IN ('sent','approved','declined')
        AND (new.amount_cents IS NOT old.amount_cents
             OR new.scope IS NOT old.scope
             OR new.nte_cents IS NOT old.nte_cents)
       BEGIN SELECT RAISE(ABORT, 'a sent change order is frozen: supersede it'); END`);
  });
  console.log('change_order: status CHECK now admits cancelled');
}

async function makeAmountNullable(db: AbstractPowerSyncDatabase) {
  const cols = await db.getAll<{ name: string; notnull: number }>(
    `SELECT name, "notnull" FROM pragma_table_info('change_order')`);
  const amount = cols.find((c) => c.name === 'amount_cents');
  // No column at all means the table is not there yet and the DDL above just
  // created it nullable. Nothing to migrate either way.
  if (!amount || amount.notnull === 0) return;

  await db.writeTransaction(async (tx) => {
    await tx.execute(`CREATE TABLE change_order_rebuild (
      id TEXT PRIMARY KEY, decision_id TEXT NOT NULL, project_id TEXT NOT NULL,
      owner_id TEXT NOT NULL, scope TEXT NOT NULL CHECK (length(scope) > 0),
      line_items TEXT NOT NULL DEFAULT '[]',
      amount_cents INTEGER CHECK (amount_cents IS NULL OR amount_cents >= 0),
      currency TEXT NOT NULL DEFAULT 'USD', nte_cents INTEGER,
      is_mini INTEGER NOT NULL DEFAULT 0 CHECK (is_mini IN (0,1)),
      who_directed TEXT NOT NULL, ref_estimate TEXT,
      numbers_confirmed_at_ms INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','sent','approved','declined','superseded','cancelled')),
      signed_by TEXT, created_at_ms INTEGER NOT NULL
    ) STRICT`);
    await tx.execute(`INSERT INTO change_order_rebuild
      (id, decision_id, project_id, owner_id, scope, line_items, amount_cents,
       currency, nte_cents, is_mini, who_directed, ref_estimate,
       numbers_confirmed_at_ms, status, signed_by, created_at_ms)
      SELECT id, decision_id, project_id, owner_id, scope, line_items, amount_cents,
             currency, nte_cents, is_mini, who_directed, ref_estimate,
             numbers_confirmed_at_ms, status, signed_by, created_at_ms
        FROM change_order`);
    await tx.execute(`DROP TABLE change_order`);
    await tx.execute(`ALTER TABLE change_order_rebuild RENAME TO change_order`);
    // The trigger went with the dropped table. Recreating it is not optional:
    // without it a sent change order becomes editable, which is the one thing
    // the frozen rule exists to prevent.
    await tx.execute(`CREATE TRIGGER IF NOT EXISTS change_order_frozen
       BEFORE UPDATE ON change_order
       WHEN old.status IN ('sent','approved','declined')
        AND (new.amount_cents IS NOT old.amount_cents
             OR new.scope IS NOT old.scope
             OR new.nte_cents IS NOT old.nte_cents)
       BEGIN SELECT RAISE(ABORT, 'a sent change order is frozen: supersede it'); END`);
  });
  console.log('change_order: amount_cents is now nullable');
}

export type ParsedMoney = {
  cents: number | null;
  /** low => do NOT prefill as if it were known. Make them type it. */
  confidence: 'high' | 'low' | 'none';
  matched?: string;
};

/**
 * Pull a dollar figure out of spoken/typed text.
 * "add three outlets, four fifty" is NOT parsed as $450 on purpose: spoken
 * numbers are exactly where transcription hallucinates, and a plausible-but-
 * wrong price is worse than no price.
 */
export function parseMoney(text: string): ParsedMoney {
  // $1,234.56 / $450 / 450 dollars — explicit currency markers only.
  const m = text.match(/\$\s?([\d,]+(?:\.\d{1,2})?)/)
    || text.match(/([\d,]+(?:\.\d{1,2})?)\s*(?:dollars|usd|bucks)\b/i);
  if (m) {
    const cents = Math.round(parseFloat(m[1].replace(/,/g, '')) * 100);
    if (Number.isFinite(cents) && cents >= 0) {
      return { cents, confidence: 'high', matched: m[0] };
    }
  }
  // A bare number MIGHT be a price. Surface it, but never as high confidence.
  const bare = text.match(/\b(\d{2,6}(?:\.\d{2})?)\b/);
  if (bare) {
    return { cents: Math.round(parseFloat(bare[1]) * 100), confidence: 'low', matched: bare[1] };
  }
  return { cents: null, confidence: 'none' };
}

/** Integer cents -> display. Money never becomes a float. */
export function money(cents: number | null): string {
  if (cents === null) return '—';
  const s = Math.abs(cents).toString().padStart(3, '0');
  const whole = s.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${cents < 0 ? '-' : ''}$${whole}.${s.slice(-2)}`;
}

/**
 * Integer cents -> whole-dollar display, no cents (hadar 2026-07-27: the Home hero
 * showed "$1,500.00" and the ".00" is noise at that size).
 *
 * ROUNDS to the nearest dollar rather than truncating, so a summary total is never
 * understated. This is for HEADLINE TOTALS ONLY — every priced row, change order and
 * signed document keeps `money()` and its exact cents. Never use this where a number
 * is confirmed, approved, or sent.
 */
export function moneyWhole(cents: number | null): string {
  if (cents === null) return '—';
  const dollars = Math.round(Math.abs(cents) / 100);
  return `${cents < 0 ? '-' : ''}$${dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

/** Text -> integer cents. Used by the tap-to-correct field. */
export function centsFromInput(s: string): number | null {
  const clean = s.replace(/[^0-9.]/g, '');
  if (!clean) return null;
  const v = parseFloat(clean);
  if (!Number.isFinite(v) || v < 0) return null;
  return Math.round(v * 100);
}

/**
 * A line item — §7.2. Mandate #6 MULTIPLIED: every line is a qty and a unit
 * price, each its own chance to be wrong, and then a total claiming to be their
 * sum. So the arithmetic lives in ONE function used by the composer, the create
 * path and the read-back, and it rounds EXACTLY as the server's check does. Two
 * implementations of the same sum is how a device and a server come to disagree
 * about what someone signed.
 */
export type LineItem = {
  description: string;
  qty: number;
  unit_cents: number;
  total_cents: number;
};

/** qty x unit, in integer cents. The one place this multiplication happens. */
export function lineTotal(qty: number, unitCents: number): number {
  return Math.round(qty * unitCents);
}

export function makeLine(description: string, qty: number, unitCents: number): LineItem {
  return { description: description.trim(), qty, unit_cents: unitCents,
           total_cents: lineTotal(qty, unitCents) };
}

export function linesSum(items: LineItem[]): number {
  return items.reduce((n, i) => n + i.total_cents, 0);
}

/**
 * The same rules the DB enforces, checked here so the user is told what is wrong
 * BEFORE a round trip, in words rather than as constraint violation 23514.
 * The DB remains the authority -- this is a courtesy, not the guarantee.
 */
export function validateLines(items: LineItem[], amountCents: number): string | null {
  if (!items.length) return null;                 // itemising is optional
  for (const [n, i] of items.entries()) {
    if (!i.description.trim()) return `Line ${n + 1} needs a description`;
    if (!(i.qty > 0)) return `Line ${n + 1}: quantity must be more than zero`;
    if (!Number.isInteger(i.unit_cents) || i.unit_cents < 0) return `Line ${n + 1}: bad price`;
    if (i.total_cents !== lineTotal(i.qty, i.unit_cents)) {
      return `Line ${n + 1} does not add up`;
    }
  }
  const sum = linesSum(items);
  if (sum !== amountCents) {
    // The most useful error in the file: it says the two numbers AND the gap,
    // because "invalid" would leave someone hunting for a penny.
    return `Lines add up to ${money(sum)} but the change order says ${money(amountCents)}`;
  }
  return null;
}

export type CreateCOResult = { ok: true; id: string } | { ok: false; reason: string };

/**
 * The status every extra is born in.
 *
 * A CREATION IS NOT A TRANSITION, which is why this is a typed constant and not an
 * `assertTransition` call: REQ-LC7's table has no edge INTO 'draft' because there
 * is no prior state to move from. What the lifecycle module contributes here is the
 * VOCABULARY — typing this as `StoredStatus` means a typo, or a status invented
 * outside REQ-LC1's five, fails to compile instead of being written and then
 * treated as sealed by `stageOf` on the phone that reads it back.
 */
const BORN_AS: StoredStatus = 'draft';

/**
 * Create the CO. NO NETWORK. It commits locally and queues the copy.
 *
 * `numbersConfirmedAt` is required by this signature, by the local CHECK, and by
 * the server RPC. Three locks on the same door, deliberately: mandate #6 says a
 * price a human has not read back must never exist, and being offline is not a
 * reason to lower that bar.
 */
/**
 * The next change-order number on a job.
 *
 * PER PROJECT, not global: "CO #4" means the fourth change on THIS job, which is what
 * both parties file it under. Computed as MAX+1 over the project rather than kept in a
 * counter row — a counter is a second place for the truth and it drifts the moment a
 * row is inserted by any path that forgets to bump it.
 *
 * STATED COLLISION BOUNDARY: two devices creating an extra on the same job while both
 * are offline can allocate the same number, and neither can know. That is a real
 * limitation of numbering offline-first, not an oversight — the alternative is a
 * server round-trip before a capture can be saved, which mandate #7 forbids. The
 * number is a filing label; the row id is the identity, and nothing keys off the
 * number. A future server-side reconcile can renumber the loser without breaking a
 * reference.
 */
/**
 * RETIRED FROM THE CREATE PATH 2026-08-21 — the SERVER assigns the number (sql/419).
 *
 * hadar: "it cannot have a number until it reached the server and the server gave it
 * one." He is right, and this was the thing doing it wrong: `MAX+1` over the LOCAL
 * rows of a project is only correct on a phone that has seen every extra on that job,
 * so two devices offline both mint the same number and both show it.
 *
 * Kept only because `backfillCoNumbers` below reads the same column and the two are
 * easier to reason about together. Do not wire it back into a create: an identifier a
 * device guesses is one a client's signed page can contradict.
 */
export async function nextCoNumber(
  db: AbstractPowerSyncDatabase, projectId: string
): Promise<number> {
  try {
    const r = (await db.getAll<{ n: number | null }>(
      `SELECT MAX(co_number) AS n FROM change_order WHERE project_id = ?`,
      [projectId]))[0];
    return (r?.n ?? 0) + 1;
  } catch {
    // The column arrives with ensureFlowFields; a device mid-migration gets 1, which
    // the backfill below then corrects.
    return 1;
  }
}

/**
 * Give every existing extra a number, oldest first, per project.
 *
 * Runs once at launch and is a no-op afterwards (it only touches rows where
 * `co_number IS NULL`). Ordering by `created_at_ms` is what makes it deterministic —
 * two devices backfilling the same history independently arrive at the same numbers.
 */
export async function backfillCoNumbers(db: AbstractPowerSyncDatabase): Promise<void> {
  try {
    const rows = await db.getAll<{ id: string; project_id: string }>(
      `SELECT id, project_id FROM change_order
        WHERE co_number IS NULL ORDER BY project_id, created_at_ms, id`);
    if (!rows.length) return;
    const next = new Map<string, number>();
    for (const r of rows) {
      let n = next.get(r.project_id);
      if (n == null) n = await nextCoNumber(db, r.project_id);
      await db.execute(`UPDATE change_order SET co_number = ? WHERE id = ? AND co_number IS NULL`,
        [n, r.id]);
      next.set(r.project_id, n + 1);
    }
  } catch { /* pre-migration device: the next launch backfills */ }
}

export async function createChangeOrder(
  db: AbstractPowerSyncDatabase,
  o: {
    id: string; decisionId: string; projectId: string; ownerId: string;
    scope: string;
    /** null = he never said a price (370). NOT zero, which says it is free. */
    amountCents: number | null;
    nteCents?: number | null;
    whoDirected: string; refEstimate?: string | null; isMini?: boolean;
    lineItems?: LineItem[];
    numbersConfirmedAt: Date;
    /** Flow-mock fields (decisions 2-3): billing defaults to when_completed at
     *  the UI, "not_sure" schedule is legal, exclusions optional. */
    billingTiming?: BillingTiming | null;
    scheduleEffect?: ScheduleEffect | null;
    scheduleDays?: number | null;
    exclusions?: string | null;
    /**
     * REQ-LC31 / D6 — the APPROVED extra this one follows. Almost always absent;
     * `createLinkedExtra` is the guarded door for setting it, and it is the only
     * caller that should. Passed straight through so a follow-on is an ORDINARY
     * extra in every other respect: it starts at draft, it is priced, previewed and
     * sent by the same path, and it carries its own signature (REQ-LC32).
     */
    originChangeOrderId?: string | null;
    /** The CO number to stamp. Omit and one is allocated for the project. A REVISION
     *  passes the number of the row it supersedes, so a change keeps one number for
     *  its whole life and only its version moves. */
    coNumber?: number | null;
  }
): Promise<CreateCOResult> {
  const now = Date.now();
  // Allocated BEFORE the transaction: it is a read, and doing it inside would hold the
  // write lock across a query for no reason.
  /**
   * NO LOCAL NUMBER unless the caller supplies one (a revision carries its
   * predecessor's). sql/419's trigger assigns it on insert, per project, under an
   * advisory lock — the only place that can see every extra on a job. Until the
   * hydrate brings the server's answer back the extra shows no number, which is the
   * honest state: it does not have one yet.
   */
  const coNumber: number | null = o.coNumber ?? null;
  const confirmedMs = o.numbersConfirmedAt.getTime();
  const mutationId = `cm-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const lineItems = o.lineItems ?? [];
  // Refuse here too. The DB would refuse anyway, but a CO that fails on upload is
  // a CO the contractor believed was saved -- and mandate #1 says never say
  // "saved" for something that is not.
  // Line items are checked against the amount only when there IS an amount.
  // With no price given there is nothing for them to add up TO — and an extra
  // with line items but no total is a contradiction the caller should not be
  // able to construct, so it is refused rather than quietly allowed.
  if (o.amountCents === null) {
    if (lineItems.length) {
      return { ok: false, reason: 'line items need a total; this extra has no price yet' };
    }
  } else {
    const bad = validateLines(lineItems, o.amountCents);
    if (bad) return { ok: false, reason: bad };
  }

  const payload = {
    mutation_id: mutationId, id: o.id, decision_id: o.decisionId,
    project_id: o.projectId, scope: o.scope.trim(), line_items: lineItems,
    amount_cents: o.amountCents, nte_cents: o.nteCents ?? null,
    is_mini: o.isMini ? 1 : 0, who_directed: o.whoDirected,
    ref_estimate: o.refEstimate ?? null,
    numbers_confirmed_at_ms: confirmedMs, created_at_ms: now,
    billing_timing: o.billingTiming ?? null,
    schedule_effect: o.scheduleEffect ?? null,
    schedule_days: o.scheduleDays ?? null,
    exclusions: o.exclusions?.trim() || null,
    origin_change_order_id: o.originChangeOrderId ?? null,
    co_number: coNumber,
    scope_of_work: o.scope.trim(),
  };
  const payloadJson = JSON.stringify(payload);

  try {
    await db.writeTransaction(async (tx) => {
      await tx.execute(
        `INSERT INTO change_order (id, decision_id, project_id, owner_id, scope,
           line_items, amount_cents, nte_cents, is_mini, who_directed, ref_estimate,
           numbers_confirmed_at_ms, status, created_at_ms,
           billing_timing, schedule_effect, schedule_days, exclusions,
           origin_change_order_id, co_number, scope_of_work)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [o.id, o.decisionId, o.projectId, o.ownerId, o.scope.trim(),
         JSON.stringify(lineItems), o.amountCents, o.nteCents ?? null,
         o.isMini ? 1 : 0, o.whoDirected, o.refEstimate ?? null, confirmedMs,
         BORN_AS, now,
         o.billingTiming ?? null, o.scheduleEffect ?? null,
         o.scheduleDays ?? null, o.exclusions?.trim() || null,
         o.originChangeOrderId ?? null, coNumber,
         // Seeded to the title at birth so the field is never null: a capture not yet
         // summarised still signs SOMETHING, and it is the same string it would have
         // signed before 391. The summary and the contractor's edits replace it.
         o.scope.trim()]
      );
      // Atomic with the record. Never after it.
      await tx.execute(
        `INSERT INTO change_order_outbox (mutation_id, change_order_id,
           payload_json, payload_sha256, queued_at_ms)
         VALUES (?,?,?,?,?)`,
        [mutationId, o.id, payloadJson, sha256(payloadJson), now]
      );
    });
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? String(e) };
  }
  return { ok: true, id: o.id };
}

/**
 * D6 / REQ-LC31 — a change AFTER approval is a NEW INDEPENDENT EXTRA, linked to the
 * approved one by origin. This is the local door to that act, and it is a different
 * mechanism from a revision, not a variant of one:
 *
 *   supersedeExtra    retires the row it points at. Nobody had signed it.
 *   createLinkedExtra WRITES NOTHING TO THE ORIGIN AT ALL. The approved record
 *                     keeps its status, its amount, its scope and its signature —
 *                     that is the entire content of D6, and the reason the origin
 *                     id lives on the NEW row rather than as a forward pointer on
 *                     the old one.
 *
 * The status precondition is `approved`, and it is read FROM THE ROW inside this
 * call rather than trusted from the caller's rendered ledger copy — the same rule
 * `supersedeExtra` follows, for the same reason: a screen can be seconds stale, and
 * hanging a lineage off a `sent` row would be a supersession wearing a different
 * name (REQ-LC31 rule 1).
 *
 * NOTE THE OPEN SPEC CONFLICT, carried here rather than quietly decided: REQ-LC26
 * says a retry after a DECLINE is also "a new extra linked by origin", which rule 1
 * forbids. `canCreateLinkedExtra` encodes rule 1 (the migration-backed one) and
 * this refuses a declined origin with its actual status named, so whoever
 * adjudicates it can see exactly what was refused.
 */
export async function createLinkedExtra(
  db: AbstractPowerSyncDatabase,
  o: Parameters<typeof createChangeOrder>[1] & { originChangeOrderId: string }
): Promise<CreateCOResult> {
  const origin = (await db.getAll<{ status: string }>(
    `SELECT status FROM change_order WHERE id = ?`, [o.originChangeOrderId]))[0];
  if (!origin) {
    return { ok: false, reason: `no extra ${o.originChangeOrderId} to follow` };
  }
  if (!canCreateLinkedExtra(origin.status)) {
    return { ok: false, reason:
      `a follow-on extra may only follow an APPROVED one; ${o.originChangeOrderId} is ${origin.status}` };
  }
  return createChangeOrder(db, o);
}

/**
 * What this extra follows, if anything — REQ-LC32's "Follows: <origin scope>" line.
 *
 * A column nothing reads is a column that is wrong and nobody notices, which is the
 * exact defect ledgerstatus.ts's header records about `superseded`. Returns the
 * origin's scope and amount so the follow-on can point at it WITHOUT the ledger
 * ever merging the two figures: REQ-LC32 is emphatic that an origin-linked pair
 * renders as `$X approved · $Y pending`, never as one row silently showing the sum.
 */
export async function originOf(
  db: AbstractPowerSyncDatabase, changeOrderId: string
): Promise<{ id: string; scope: string; amountCents: number | null; status: string } | null> {
  const r = (await db.getAll<{
    id: string; scope: string; amount_cents: number | null; status: string;
  }>(
    `SELECT o.id, o.scope, o.amount_cents, o.status
       FROM change_order co JOIN change_order o ON o.id = co.origin_change_order_id
      WHERE co.id = ?`, [changeOrderId]))[0];
  return r ? { id: r.id, scope: r.scope, amountCents: r.amount_cents, status: r.status } : null;
}

/**
 * Push queued change orders. Same rules as every other queue here: delete the
 * intent only on success, idempotent by mutation_id, park permanent rejections
 * rather than discarding them.
 *
 * 23503 is NOT permanent: a CO whose decision has not synced yet is an ordering
 * race the next attempt wins, not a corrupt payload.
 */
// 23502 = not_null_violation. It was ABSENT, and the audit found what that
// costs: a row the server structurally cannot accept retried forever at the
// 30-minute cap, never parked, never surfaced, with the contractor's ledger
// quietly showing "pending" for the rest of the install's life. A constraint
// violation is the server saying "never", and never is permanent by definition.
const CO_PERMANENT = new Set(['42501', '23505', '23514', '23502']);

export async function drainChangeOrderOutbox(
  db: AbstractPowerSyncDatabase, supabase: SupabaseClient, ownerId: string
) {
  const r = { attempted: 0, uploaded: 0, alreadyApplied: 0, parked: 0, retryable: 0 };
  const rows = await db.getAll<{
    mutation_id: string; payload_json: string; payload_sha256: string; attempt_count: number;
  }>(
    `SELECT mutation_id, payload_json, payload_sha256, attempt_count
       FROM change_order_outbox WHERE next_attempt_at_ms <= ?
      ORDER BY queued_at_ms LIMIT 20`, [Date.now()]
  );

  for (const row of rows) {
    r.attempted++;
    let p: any;
    try { p = JSON.parse(row.payload_json); }
    catch { await parkCO(db, row.mutation_id, 'CORRUPT_PAYLOAD', 'not valid JSON'); r.parked++; continue; }

    try {
      const { data, error } = await supabase.rpc('ingest_change_order_v1', {
        p_mutation_id: p.mutation_id, p_id: p.id, p_decision_id: p.decision_id,
        p_project_id: p.project_id, p_owner_id: ownerId, p_scope: p.scope,
        p_line_items: p.line_items, p_amount_cents: p.amount_cents,
        p_nte_cents: p.nte_cents, p_is_mini: p.is_mini,
        p_who_directed: p.who_directed, p_ref_estimate: p.ref_estimate,
        p_numbers_confirmed_at_ms: p.numbers_confirmed_at_ms,
        p_created_at_ms: p.created_at_ms, p_request_sha256: row.payload_sha256,
        // 375: older payloads carry no flow fields; nulls match the defaults.
        p_billing_timing: p.billing_timing ?? null,
        p_schedule_effect: p.schedule_effect ?? null,
        p_schedule_days: p.schedule_days ?? null,
        p_exclusions: p.exclusions ?? null,
        // 391. Defaulted server-side, so a payload queued before this shipped still
        // ingests -- the RPC falls back to p_scope, which is what it signed anyway.
        p_scope_of_work: p.scope_of_work ?? null,
      });
      if (error) throw error;

      // REQ-LC31's lineage rides its OWN RPC, and this is the one place the two
      // halves of the feature could have disagreed. `ingest_change_order_v1` does
      // NOT declare `p_origin_change_order_id` — 386 deliberately made the link a
      // separate function rather than widening that signature, because widening it
      // means DROP + CREATE (a third owner for a function 050 and 375 already
      // share) and because PostgREST resolves an RPC by its exact argument-name
      // set. Passing the origin to `ingest` instead would fail with PGRST202, which
      // is not in CO_PERMANENT, so exactly the follow-on extras D6 exists to create
      // would retry on the device forever while every ordinary extra synced fine.
      //
      // AFTER the ingest, never before: the child row has to exist for the link's
      // ownership check to find it. It runs BEFORE the outbox row is deleted, so a
      // failure here leaves the intent queued and the whole row replays — the
      // ingest answers `already_applied` off its mutation ledger and the link is
      // idempotent by outcome (386), so replaying costs nothing and losing the
      // lineage costs the record of what this change followed from.
      if (p.origin_change_order_id) {
        const link = await supabase.rpc('link_origin_change_order_v1', {
          p_id: p.id, p_origin_change_order_id: p.origin_change_order_id,
        });
        if (link.error) throw link.error;
      }

      await db.execute(`DELETE FROM change_order_outbox WHERE mutation_id = ?`, [row.mutation_id]);
      if (data?.status === 'already_applied') r.alreadyApplied++; else r.uploaded++;
    } catch (e: any) {
      const code = e?.code ?? e?.error_code;
      if (CO_PERMANENT.has(code)) {
        await parkCO(db, row.mutation_id, code, e?.message ?? String(e)); r.parked++;
      } else {
        const n = row.attempt_count + 1;
        const delay = Math.min(60_000 * 2 ** Math.min(n, 6), 30 * 60_000);
        await db.execute(
          `UPDATE change_order_outbox SET attempt_count = ?, last_attempt_at_ms = ?,
             next_attempt_at_ms = ?, last_error_code = ?, last_error_text = ?
           WHERE mutation_id = ?`,
          [n, Date.now(), Date.now() + delay, code ?? 'TRANSIENT',
           e?.message ?? String(e), row.mutation_id]
        );
        r.retryable++;
      }
    }
  }
  return r;
}

async function parkCO(db: AbstractPowerSyncDatabase, mutationId: string, code: string, msg: string) {
  await db.execute(
    `UPDATE change_order_outbox SET attempt_count = attempt_count + 1,
       last_attempt_at_ms = ?, next_attempt_at_ms = ?, last_error_code = ?, last_error_text = ?
     WHERE mutation_id = ?`,
    [Date.now(), 8640000000000, code, msg, mutationId]
  );
}

/**
 * §7.3 status ledger: Approved / Pending / Declined + a running total.
 *
 * Reads LOCALLY. It used to select from the server's co_ledger view, so with no
 * signal the list rendered EMPTY -- a contractor standing in a basement was shown
 * no change orders at all, as if the money did not exist. The running total is
 * computed here for the same reason it is derived on the server: a stored total
 * can disagree with the rows it claims to sum.
 */
export type LedgerRow = {
  id: string; scope: string; amount: string; nte: string | null;
  /** 391 — the detailed client-facing scope. `scope` is the title. This is the text
   *  frozen into the instrument at send; null on rows created before 391, and the
   *  sender falls back to the title for exactly those. */
  scope_of_work: string | null;
  status: string; is_mini: number; signed_by: string | null;
  approved_running: string; synced: number;
  // Raw cents alongside the formatted string: the c4 ledger totals (approved sum,
  // awaiting sum) are DERIVED in the UI, and deriving them from formatted "$1,850"
  // strings would be a parser bug waiting to happen. One number, two renderings.
  amount_cents: number;
  // Needed to send a priced approval: the confirmation is keyed to the decision,
  // and the report names who directed the extra.
  decision_id: string; who_directed: string;
  // Raw cap alongside the formatted `nte`, for the same reason as amount_cents:
  // the SENDER must pass the number, and it previously exposed only the formatted
  // string, so sendPricedApproval had nothing to pass and every not-to-exceed went
  // out as a flat fixed price.
  nte_cents: number | null;
  // When the CHANGE ORDER was created, which is the moment the price was confirmed
  // (see createChangeOrder: created_at_ms = Date.now() at insert). It is NOT the
  // capture moment -- an earlier version of this comment claimed it was, and the
  // PRD repeated the claim. The real capture time lives on capture_commit and the
  // record screen shows it separately. PRD R7 orders the ledger by this field and
  // labels it "Created", which is now true. Raw ms alongside the rendered label for
  // the same reason as amount_cents -- never re-parse a formatted string.
  created_at_ms: number; created: string;
  /**
   * R5c. Null is a FIRST-CLASS value, not a missing one: an untyped extra is a
   * normal extra and must never be blocked (R5c's last AC, mandate #7).
   */
  extra_type: string | null;
  /** Flow-mock fields (375). Null on extras that predate them — first-class,
   *  same rule as extra_type; renderCard simply omits the line. */
  billing_timing: string | null;
  schedule_effect: string | null;
  schedule_days: number | null;
  exclusions: string | null;
  /** Relpath of the extra's first PHOTO (for a thumbnail), or null when it has no
   *  photo (voice-only). Joined FS.documentDirectory-relative, same as the grid. */
  photo_relpath: string | null;
  /** The extra's real per-job number, for the line that IDENTIFIES the document on
   *  the send sheet. Null on rows created before the column existed (and on rows the
   *  backfill has not reached) — the sheet then prints no number at all, because a
   *  made-up one on an instrument's identity line is worse than a short line. */
  co_number: number | null;
};

/**
 * The earliest PHOTO relpath behind an extra `co`, as a correlated subquery — null
 * when the extra is voice-only. Covers BOTH the anchor capture being a photo and the
 * photo siblings paired to the voice narration (the fused-capture shape). Exported so
 * the cross-job Home/Activity query can reuse the exact same rule (one definition, no
 * drift). Assumes the outer query aliases change_order as `co`.
 */
/**
 * WHO RAISED AN EXTRA — the FIRST actor on it, as a joinable subquery.
 *
 * Join it as `fa` and read `fa.name` / `fa.at_ms`. Assumes the outer query aliases
 * change_order as `co`, exactly like `CO_PHOTO_SUBQUERY` above.
 *
 * Exported rather than copied because it is now read by BOTH lists that show a person
 * on a row — the company feed and Home — and hadar's ask was precisely that those two
 * stop disagreeing (2026-08-17: "make sure the home change order records data
 * structure and style looks like the company one"). Two copies of this window function
 * is two chances for one of them to start naming a different human.
 *
 * DELIBERATELY NOT FILTERED TO act='captured'. That act is written by the capture flow,
 * and an extra typed rather than spoken never gets one — filtering would leave those
 * rows permanently anonymous. The earliest act of ANY kind is by definition the person
 * who brought the extra into existence.
 */
export const CO_AUTHOR_JOIN = `(
  SELECT subject_id, name, at_ms,
         ROW_NUMBER() OVER (PARTITION BY subject_id ORDER BY at_ms ASC, id ASC) AS rn
    FROM extra_actor WHERE subject_kind = 'change_order'
)`;

/**
 * THE COVER PHOTO — this device's own capture first, a cached cloud copy second.
 *
 * The second branch is the fix for hadar's 2026-08-21 report ("images not displaying
 * in the records" on a freshly signed-in phone). `capture_commit` only ever holds
 * captures THIS device took, so on a second handset, a reinstall, or after a device
 * handover it is empty and every card fell back to the microphone placeholder — while
 * the photos sat in Storage the whole time. `capture_mirror` is the account's captures
 * as pulled by `hydrateEvidence`, with `local_relpath` non-null once the bytes have
 * actually been downloaded (evidencemirror.ts).
 *
 * COALESCE, NOT UNION, and the order is deliberate: where both exist, the row backed
 * by real committed bytes wins. The `local_relpath IS NOT NULL` guard is what stops a
 * not-yet-downloaded capture returning a path to a file that is not there — the
 * placeholder is the honest answer until the bytes land.
 */
export const CO_PHOTO_SUBQUERY = `COALESCE(
 (
  SELECT cc.media_relpath FROM capture_commit cc
   WHERE cc.modality = 'photo' AND cc.capture_id IN (
     SELECT dv.capture_id FROM decision_version dv
      WHERE dv.decision_id = co.decision_id AND dv.capture_id IS NOT NULL
     UNION
     SELECT p2.capture_id FROM capture_pair p2
      WHERE p2.pair_id IN (
        SELECT p1.pair_id FROM capture_pair p1
         WHERE p1.capture_id IN (
           SELECT dv.capture_id FROM decision_version dv WHERE dv.decision_id = co.decision_id
         )
      )
   )
   ORDER BY cc.captured_at_ms LIMIT 1
 ),
 (
  SELECT cm.local_relpath FROM capture_mirror cm
   WHERE cm.modality = 'photo' AND cm.local_relpath IS NOT NULL
     AND cm.capture_id IN (
       SELECT dv.capture_id FROM decision_version dv
        WHERE dv.decision_id = co.decision_id AND dv.capture_id IS NOT NULL
     )
   ORDER BY cm.captured_at_ms LIMIT 1
 )
)`;

/**
 * "Jul 20 · 2:14 pm" — a stored moment as a row or record shows it.
 * Deliberately no year: a job's extras live inside weeks, and the year is noise on a
 * phone row.
 *
 * Locale follows the reader (mandate #5). Forcing 'en-US' put an English date on a
 * Spanish-language legal record.
 */
/**
 * "Aug 5" — the DATE alone, for a list row (hadar 2026-08-06: "add date to the record
 * item in the lists").
 *
 * Separate from `createdLabel` because a list is scanned, not read: the time of day
 * doubles the width of the line and answers a question nobody asks while looking for
 * last Tuesday's extra. Same locale rule, so the two never disagree about a month.
 *
 * THE YEAR APPEARS WHEN IT IS NOT THIS ONE. "Aug 5" on a change order from last August
 * is not shorter, it is wrong — and this is a list a contractor uses to find what he
 * has already billed.
 */
export function shortDate(ms: number, nowMs: number = Date.now()): string {
  const d = new Date(ms);
  const locale = getLang() === 'es' ? 'es-419' : 'en-US';
  const sameYear = d.getFullYear() === new Date(nowMs).getFullYear();
  return d.toLocaleDateString(locale, sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' });
}

export function createdLabel(ms: number): string {
  const d = new Date(ms);
  const locale = getLang() === 'es' ? 'es-419' : 'en-US';
  const date = d.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time.toLowerCase()}`;
}

export async function ledger(db: AbstractPowerSyncDatabase, projectId: string): Promise<LedgerRow[]> {
  const rows = await db.getAll<{
    id: string; decision_id: string; who_directed: string; scope: string;
    scope_of_work: string | null;
    amount_cents: number; nte_cents: number | null;
    status: string; is_mini: number; signed_by: string | null;
    created_at_ms: number; pending: number; extra_type: string | null;
    billing_timing: string | null; schedule_effect: string | null;
    schedule_days: number | null; exclusions: string | null;
    photo_relpath: string | null; co_number: number | null;
  }>(
    `SELECT co.id, co.decision_id, co.who_directed, co.scope, co.scope_of_work,
            co.amount_cents, co.nte_cents, co.co_number,
            co.status, co.is_mini, co.signed_by, co.created_at_ms, co.extra_type,
            co.billing_timing, co.schedule_effect, co.schedule_days, co.exclusions,
            ${CO_PHOTO_SUBQUERY} AS photo_relpath,
            EXISTS (SELECT 1 FROM change_order_outbox o WHERE o.change_order_id = co.id) AS pending
       FROM change_order co
      WHERE co.project_id = ?
      ORDER BY co.created_at_ms`,
    [projectId]
  );

  // The SQL stays ASCENDING on purpose. `approved_running` is a running total and only
  // means anything computed forward through time; flipping the ORDER BY to DESC would
  // still "work" and silently invert every running figure on the screen. So: accumulate
  // chronologically, then reverse for presentation (PRD R7 = newest created first).
  let running = 0;
  const chronological = rows.map((r) => {
    if (r.status === 'approved') running += r.amount_cents;
    return {
      id: r.id, decision_id: r.decision_id, who_directed: r.who_directed,
      scope: r.scope, scope_of_work: r.scope_of_work ?? null,
      amount: money(r.amount_cents),
      nte: r.nte_cents == null ? null : money(r.nte_cents),
      nte_cents: r.nte_cents,
      status: r.status, is_mini: r.is_mini, signed_by: r.signed_by,
      approved_running: money(running),
      amount_cents: r.amount_cents,
      created_at_ms: r.created_at_ms, created: createdLabel(r.created_at_ms),
      extra_type: r.extra_type,
      billing_timing: r.billing_timing, schedule_effect: r.schedule_effect,
      schedule_days: r.schedule_days, exclusions: r.exclusions,
      photo_relpath: r.photo_relpath, co_number: r.co_number,
      // "on this phone" and "in the cloud" are different facts and the sender is
      // entitled to know which one they are looking at.
      synced: r.pending ? 0 : 1,
    };
  });
  return chronological.reverse();
}

/**
 * Price an EXISTING draft in place — the flow-mock's "fill what's missing"
 * applied to the extra a capture already created (startExtraFromCapture).
 *
 * A draft is mutable by design (the freeze starts at sent), so the local UPDATE
 * is legal. The server side: if the draft's INSERT is still queued in the
 * outbox, its payload is refreshed under the same mutation_id (the server has
 * never seen it, so the replay guard is satisfied); if it already uploaded, the
 * server row keeps the priceless shape — a NAMED, bounded staleness: what a
 * client signs is frozen from the LOCAL row at send (shown_content +
 * confirmation's own amount), never read back from server change_order.
 */
export async function priceDraftExtra(
  db: AbstractPowerSyncDatabase,
  o: {
    changeOrderId: string;
    amountCents: number; nteCents?: number | null;
    lineItems?: LineItem[];
    billingTiming?: BillingTiming | null;
    scheduleEffect?: ScheduleEffect | null;
    scheduleDays?: number | null;
    exclusions?: string | null;
    whoDirected: string;
    numbersConfirmedAt: Date;
  }
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const lineItems = o.lineItems ?? [];
  const bad = validateLines(lineItems, o.amountCents);
  if (bad) return { ok: false, reason: bad };

  const upd = await db.execute(
    `UPDATE change_order SET amount_cents = ?, nte_cents = ?, line_items = ?,
        who_directed = ?, numbers_confirmed_at_ms = ?,
        billing_timing = ?, schedule_effect = ?, schedule_days = ?, exclusions = ?
      WHERE id = ? AND status = 'draft'`,
    [o.amountCents, o.nteCents ?? null, JSON.stringify(lineItems),
     o.whoDirected, o.numbersConfirmedAt.getTime(),
     o.billingTiming ?? null, o.scheduleEffect ?? null,
     o.scheduleDays ?? null, o.exclusions?.trim() || null, o.changeOrderId]
  );
  if (!upd.rowsAffected) {
    return { ok: false, reason: 'this extra is not a draft anymore' };
  }

  // Refresh the still-queued INSERT payload, if any, so the server's first
  // sight of this extra is the priced one.
  const q = await db.getAll<{ mutation_id: string; payload_json: string }>(
    `SELECT mutation_id, payload_json FROM change_order_outbox WHERE change_order_id = ?`,
    [o.changeOrderId]);
  if (q.length) {
    let p: any = null;
    try { p = JSON.parse(q[0].payload_json); } catch { /* corrupt: drain will park it */ }
    if (p) {
      const next = {
        ...p, amount_cents: o.amountCents, nte_cents: o.nteCents ?? null,
        line_items: lineItems, who_directed: o.whoDirected,
        numbers_confirmed_at_ms: o.numbersConfirmedAt.getTime(),
        billing_timing: o.billingTiming ?? null,
        schedule_effect: o.scheduleEffect ?? null,
        schedule_days: o.scheduleDays ?? null,
        exclusions: o.exclusions?.trim() || null,
      };
      const json = JSON.stringify(next);
      await db.execute(
        `UPDATE change_order_outbox SET payload_json = ?, payload_sha256 = ? WHERE mutation_id = ?`,
        [json, sha256(json), q[0].mutation_id]);
    }
  }
  return { ok: true };
}

/**
 * Write the FLOW FIELDS of a draft — schedule effect, billing timing, exclusions —
 * WITHOUT touching the price (hadar, 2026-07-31, when each field became its own
 * bottom drawer).
 *
 * WHY THIS EXISTS RATHER THAN REUSING `priceDraftExtra`: that function takes
 * `amountCents: number` and stamps `numbers_confirmed_at_ms` on every call. Both are
 * correct for a price read-back and WRONG here twice over. First, an extra may have
 * no price yet (370: null ≠ 0), so answering "does this move the schedule?" on an
 * unpriced draft had nothing to pass and was refused with "set a price first" — a
 * refusal that has nothing to do with the question being answered. Second,
 * `numbers_confirmed_at_ms` is the EVIDENCE that a human read a figure back
 * (mandate #6); stamping it while saving a billing choice would claim a confirmation
 * that never happened.
 *
 * Same guard and same outbox discipline as its sibling: draft-only, and a still-queued
 * INSERT payload is refreshed under its own mutation_id.
 */
export async function setDraftFlowFields(
  db: AbstractPowerSyncDatabase,
  o: {
    changeOrderId: string;
    billingTiming?: BillingTiming | null;
    scheduleEffect?: ScheduleEffect | null;
    scheduleDays?: number | null;
    exclusions?: string | null;
  }
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const upd = await db.execute(
    `UPDATE change_order SET billing_timing = ?, schedule_effect = ?,
        schedule_days = ?, exclusions = ?
      WHERE id = ? AND status = 'draft'`,
    [o.billingTiming ?? null, o.scheduleEffect ?? null,
     o.scheduleDays ?? null, o.exclusions?.trim() || null, o.changeOrderId]
  );
  if (!upd.rowsAffected) {
    return { ok: false, reason: 'this extra is not a draft anymore' };
  }
  const q = await db.getAll<{ mutation_id: string; payload_json: string }>(
    `SELECT mutation_id, payload_json FROM change_order_outbox WHERE change_order_id = ?`,
    [o.changeOrderId]);
  if (q.length) {
    let p: any = null;
    try { p = JSON.parse(q[0].payload_json); } catch { /* corrupt: drain will park it */ }
    if (p) {
      const next = {
        ...p,
        billing_timing: o.billingTiming ?? null,
        schedule_effect: o.scheduleEffect ?? null,
        schedule_days: o.scheduleDays ?? null,
        exclusions: o.exclusions?.trim() || null,
      };
      const json = JSON.stringify(next);
      await db.execute(
        `UPDATE change_order_outbox SET payload_json = ?, payload_sha256 = ? WHERE mutation_id = ?`,
        [json, sha256(json), q[0].mutation_id]);
    }
  }
  return { ok: true };
}

/**
 * WHO THIS EXTRA IS FOR — written to the DRAFT, on its own (hadar 2026-08-14: "once a
 * client is selected we need to save it to the CO").
 *
 * Picking a client in the send sheet used to live only in that sheet's state: close it
 * without sending and the choice was gone, and the draft still read "No client selected
 * yet". Worse, the choice never reached the record the send is ABOUT — so an extra could
 * be sent to somebody while its own `who_directed` still held the unnamed sentinel.
 *
 * ITS OWN WRITER, NOT `priceDraftExtra`, for that function's own stated reason: it
 * takes `amountCents: number` and stamps `numbers_confirmed_at_ms` on every call.
 * Naming a client on an unpriced draft would have been refused for want of a price, and
 * saving one would have claimed a read-back (mandate #6) that never happened.
 *
 * DRAFT-ONLY, by the `WHERE`. Once an extra is sent, who it was addressed to is part of
 * the instrument: `confirmation_request.counterparty_label` is frozen into what the
 * client signed, and quietly re-pointing the record afterwards would make the app
 * disagree with the document.
 */
export async function setDraftClient(
  db: AbstractPowerSyncDatabase, changeOrderId: string, whoDirected: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const name = whoDirected.trim();
  if (!name) return { ok: false, reason: 'a client needs a name' };

  const upd = await db.execute(
    `UPDATE change_order SET who_directed = ? WHERE id = ? AND status = 'draft'`,
    [name, changeOrderId]);
  if (!upd.rowsAffected) {
    return { ok: false, reason: 'this extra is not a draft anymore' };
  }
  // Same outbox discipline as its siblings: while the server has never seen this extra,
  // the queued INSERT is rewritten under its own mutation_id so the first thing the
  // server sees already names the client.
  const q = await db.getAll<{ mutation_id: string; payload_json: string }>(
    `SELECT mutation_id, payload_json FROM change_order_outbox WHERE change_order_id = ?`,
    [changeOrderId]);
  if (q.length) {
    let p: any = null;
    try { p = JSON.parse(q[0].payload_json); } catch { /* corrupt: drain will park it */ }
    if (p) {
      const json = JSON.stringify({ ...p, who_directed: name });
      await db.execute(
        `UPDATE change_order_outbox SET payload_json = ?, payload_sha256 = ? WHERE mutation_id = ?`,
        [json, sha256(json), q[0].mutation_id]);
    }
  }
  return { ok: true };
}

/** Move a DRAFT to the job a human picked (flow step 2). The queued INSERT
 *  payload follows, same rules as priceDraftExtra: refresh under the same
 *  mutation_id while the server has never seen it. */
export async function rehomeDraftExtra(
  db: AbstractPowerSyncDatabase, changeOrderId: string, projectId: string
): Promise<void> {
  const upd = await db.execute(
    `UPDATE change_order SET project_id = ? WHERE id = ? AND status = 'draft'`,
    [projectId, changeOrderId]);
  if (!upd.rowsAffected) return;
  const q = await db.getAll<{ mutation_id: string; payload_json: string }>(
    `SELECT mutation_id, payload_json FROM change_order_outbox WHERE change_order_id = ?`,
    [changeOrderId]);
  if (!q.length) return;
  try {
    const p = JSON.parse(q[0].payload_json);
    p.project_id = projectId;
    const json = JSON.stringify(p);
    await db.execute(
      `UPDATE change_order_outbox SET payload_json = ?, payload_sha256 = ? WHERE mutation_id = ?`,
      [json, sha256(json), q[0].mutation_id]);
  } catch { /* corrupt payload: the drain parks it loudly */ }
}

export type ApplyApprovalResult =
  | { ok: true; at: number }
  /** `status` is what the row ACTUALLY reads, so a log line or a message can name
   *  it. null means the row is not on this device at all. */
  | { ok: false; reason: 'not_found' | 'not_approvable' | 'raced'; status: string | null };

/**
 * Mark the outcome of a signature locally. The signing path is online-only.
 *
 * THIS WAS DEF-1, AND IT WAS A BARE `UPDATE … SET status = ? WHERE id = ?`.
 * With no precondition on the status, a `superseded` row — a version the contractor
 * retired, whose link 307 already killed — and a `declined` row — a client's
 * recorded NO — both walked straight to `approved`, and the ledger then showed a
 * signature over a document nobody signed and a yes over a recorded no. Only the
 * server's typed-link path (230_close_the_loop.sql:112) ever carried the guard.
 *
 * The precondition is stated TWICE, and the duplication is the design:
 *   - `canTransition` names both states in the refusal, so the log says WHY;
 *   - `AND status IN ('draft','sent')` on the UPDATE protects the ROW, including
 *     against a client answer that landed between the read and the write. The
 *     `rowsAffected` read is what tells those two cases apart ('raced').
 * `draft` is legal here for the offline reason REQ-LC7 spells out: the server row
 * is always `sent` by the time an answer can exist, but this device may not have
 * hydrated the send back yet, and being behind on sync must not refuse a real
 * signature (mandate #7).
 *
 * IT RETURNS A RESULT, and REQ-LC8 is why: a refused transition that nobody reads
 * is a UI reporting a state change that did not happen — the "claims that outrun
 * their evidence" defect this project keeps finding. The caller must read it.
 */
export async function applyLocalApproval(
  db: AbstractPowerSyncDatabase, coId: string, action: 'approved' | 'declined', legalName: string
): Promise<ApplyApprovalResult> {
  const cur = (await db.getAll<{ status: string }>(
    `SELECT status FROM change_order WHERE id = ?`, [coId]))[0];
  if (!cur) return { ok: false, reason: 'not_found', status: null };
  if (!canTransition(cur.status, action)) {
    return { ok: false, reason: 'not_approvable', status: cur.status };
  }

  // REQ-LC4: the moment is recorded by the same statement that moves the status,
  // and only if it was never recorded before. A transition is dated once.
  const at = Date.now();
  const stamp = action === 'approved' ? 'approved_at_ms' : 'declined_at_ms';
  const r = await db.execute(
    `UPDATE change_order
        SET status = ?, signed_by = ?,
            ${stamp} = COALESCE(${stamp}, ?)
      WHERE id = ? AND status IN ('draft','sent')`,
    [action, action === 'approved' ? legalName : null, at, coId]
  );
  if (!r.rowsAffected) return { ok: false, reason: 'raced', status: cur.status };
  return { ok: true, at };
}

/**
 * Mark a change order sent, locally, the moment its link goes out.
 *
 * The server does this too (`confirmation_request_marks_sent`, 230_close_the_loop),
 * and that remains the authority. This exists because the contractor is holding the
 * phone: without it the row he just sent still reads "Send for approval →" until the
 * next hydrate, so the app looks like it dropped the thing he watched it do.
 *
 * `status = 'draft'` in the WHERE is the same rule the server trigger uses, for the
 * same reason: never walk a terminal state backwards. If the client somehow answered
 * before this ran, the answer wins and this is a no-op.
 *
 * Returns whether a row actually moved, so the caller never reports a transition
 * that did not happen.
 *
 * REQ-LC4: `sent_at_ms` is stamped by this same statement, and by COALESCE only if
 * it was never stamped. A re-send after a revision is a NEW row with its own
 * lifecycle (REQ-LC22), so this row's send time is a fact that happens exactly once
 * — re-dating it would move R8's 24h reminder clock and rewrite the record screen's
 * account of when the client was actually asked.
 */
export async function markLocalSent(
  db: AbstractPowerSyncDatabase, coId: string
): Promise<boolean> {
  // The lifecycle check, ahead of the write, for what it puts in the log: `false`
  // alone cannot tell "already sent" from "already answered" from "no such row",
  // and those are three different things to say to a contractor holding the phone.
  const cur = (await db.getAll<{ status: string }>(
    `SELECT status FROM change_order WHERE id = ?`, [coId]))[0];
  if (!cur) {
    console.log('[send] no local row %s to mark sent', coId);
    return false;
  }
  if (!canTransition(cur.status, 'sent')) {
    console.log('[send] %s is %s, not a draft — the local row does not move', coId, cur.status);
    return false;
  }
  const r = await db.execute(
    `UPDATE change_order
        SET status = 'sent', sent_at_ms = COALESCE(sent_at_ms, ?)
      WHERE id = ? AND status = 'draft'`,
    [Date.now(), coId]
  );
  return !!r.rowsAffected;
}

/**
 * Pull change orders the device does not have. Needed for three real cases, not
 * just migration: a reinstall, a second device, and change orders authored before
 * the device became the author.
 *
 * INSERT OR IGNORE, never overwrite: a local row may have unsent edits, and the
 * device's own record is never clobbered by a copy of itself.
 *
 * STATUS is the one field allowed to come back down, and only for rows with no
 * pending local intent -- an approval is authored on the server (it needs the OTP
 * check), so without this a CO signed on another device reads "draft" here
 * forever. Scope and amount are NEVER refreshed: they are frozen once sent, so a
 * server copy disagreeing with the local row is a bug to surface, not a value to
 * silently adopt.
 *
 * KNOWN LIMIT, stated rather than hidden: this is a pull, not a subscription. It
 * runs on launch and on drain, so a second device's change shows up within a tick
 * of connectivity, not instantly. Real-time multi-device is what PowerSync would
 * buy, and it is not bought here.
 *
 * THE SERVER IS AUTHORITATIVE, BUT NOT ABOUT MOVES THE MACHINE FORBIDS — the ruling
 * for this path, made explicitly because "the server wins" reads like a complete
 * answer and is not one. REQ-LC7's table is the shape of a lawful history, and it
 * binds both sides. So a server status that is lawful PROGRESS on the local one is
 * ADOPTED (`canAdoptServerStatus`), and one that is not — local `approved`, server
 * `sent`; local `declined`, server `approved` — is REFUSED and COUNTED, never
 * silently written.
 *
 * ADOPTION IS NOT THE SAME PREDICATE AS ACTION, and using the action one here was a
 * bug: see `canAdoptServerStatus`'s header for `draft → superseded`, the pair
 * `canTransition` refuses forever on a device that is merely behind.
 *
 * Two reasons, and the second is the one that decides it:
 *  1. Such a pair is not a fact the server produced lawfully; it means one side is
 *     behind (this device holds an approval or a supersession the queues have not
 *     pushed yet) or something is wrong. Neither is repaired by overwriting.
 *  2. The write it would make is the DEF-1 write, arriving through the back door:
 *     `approved → sent` un-signs a signature and `declined → approved` turns a
 *     client's recorded NO into a yes. Guarding two functions and leaving the pull
 *     able to do the same thing is the "rule enforced in one place" failure again.
 * Refusing is also the SAFE side of the trade: the local terminal state stands, the
 * conflict is logged with both statuses, and the next tick re-offers it — where
 * adopting destroys evidence on the spot. It is deliberately NOT silent: silence is
 * how a wrong status survives, and this is the class of bug this file has been
 * bitten by before. `reassertSupersessions` runs right after this on the same tick
 * and covers the specific pending-supersession case (see its header).
 */
/**
 * REMOVED 2026-08-21 — see sql/419.
 *
 * This uploaded the number the DEVICE minted. It fixed the symptom hadar reported
 * that morning (20 server rows, 0 numbers) by entrenching the cause: a phone that
 * cannot see every extra on a job was still deciding the identifier. Once the server
 * assigns on insert, sending a local guess would race the trigger and could win.
 *
 * The direction is one-way now: numbers come DOWN in the hydrate, never up.
 */

/**
 * `projectId: null` MEANS THE WHOLE ACCOUNT, and that is the correct default now.
 *
 * This was project-scoped, and two things went wrong with it (review, 2026-08-21):
 *
 *   1. `synced` — the flag that lets Home say "NO EXTRAS YET" — was set from this
 *      function's `ok`. On a fresh device `projectIdRef` is the INBOX (real projects
 *      arrive later via PowerSync), so it asked "does the inbox have extras?", got a
 *      truthful no, and Home announced the ACCOUNT was empty. Home's own query has no
 *      project filter, so the two were never asking the same question.
 *   2. Extras belonging to any project the user was not currently looking at never
 *      hydrated at all — so a second device only ever received the extras of whichever
 *      job happened to be open.
 *
 * RLS scopes the pull to the caller either way (`co_own`, plus 376's company-wide
 * read), so dropping the filter widens it to exactly what this account may see and no
 * further.
 */
export async function hydrateChangeOrders(
  db: AbstractPowerSyncDatabase, supabase: SupabaseClient,
  projectId: string | null, ownerId: string
) {
  const q = supabase
    .from('change_order')
    .select('id, decision_id, project_id, scope, line_items, amount_cents, nte_cents, is_mini, who_directed, ref_estimate, numbers_confirmed_at, status, created_at, scope_of_work, scope_of_work_ai, price_heard, schedule_effect, schedule_days, billing_timing, exclusions, extra_type, co_number');
  const { data, error } = await (projectId ? q.eq('project_id', projectId) : q);
  // `ok` SEPARATES "THIS ACCOUNT HAS NO EXTRAS" FROM "I COULD NOT ASK".
  //
  // Both used to return the same all-zero shape, so the caller had no way to tell them
  // apart — and Home read zero rows as a fact and printed "NO EXTRAS YET" at a
  // contractor with three change orders, one second after he signed in (hadar,
  // 2026-08-21). An empty local table is not evidence of an empty account until
  // somebody has actually asked the server and been told so.
  if (error || !data) {
    return { ok: false, pulled: 0, statusUpdated: 0, skipped: 0, conflicts: 0 };
  }

  // D6's lineage, in a SEPARATE best-effort query and deliberately not a column on
  // the select above. It is pulled at all because the origin link is authored on ONE
  // device and read on every other: without it a reinstall or a second handset gets
  // the follow-on extra back with a NULL origin, and the audit link the whole
  // decision exists to create is silently absent on the copy most likely to be
  // opened in a dispute.
  //
  // SEPARATE BECAUSE OF WHAT A MISSING COLUMN COSTS. `origin_change_order_id` arrives
  // with migration 386. Naming it in the main select would mean that on any server
  // that has not run 386 the whole pull returns an error — and this function's error
  // path returns zeros silently, so EVERY extra would stop syncing with nothing on
  // screen and nothing in a log. A lineage nobody can see is a real defect; a
  // hydrate that dies quietly is a worse one. Here, a server without the column
  // simply yields no lineage and the extras keep landing.
  let origins = new Map<string, string | null>();
  {
    const oq = supabase.from('change_order').select('id, origin_change_order_id');
    const { data: ol, error: oe } = await (projectId ? oq.eq('project_id', projectId) : oq);
    if (oe) void logDiag(db, 'hydrate.origin', String(oe.message ?? oe).slice(0, 160));
    else origins = new Map((ol ?? []).map((r: any) => [r.id, r.origin_change_order_id ?? null]));
  }

  // The signer's name lives on the approval, not the CO.
  const { data: appr } = await supabase
    .from('approval').select('change_order_id, legal_name, action');
  const signedBy = new Map((appr ?? [])
    .filter((a: any) => a.action === 'approved')
    .map((a: any) => [a.change_order_id, a.legal_name]));

  // EXTRAS THIS DEVICE DELETED. Without this, hydrate re-inserted a locally-deleted
  // draft the server still holds — every 15s tick — and the extra "would not delete":
  // it vanished on the tap and came back seconds later (hadar, 2026-07-28). The
  // tombstone (change_order_discarded) is written in the same transaction as the local
  // delete, so this set is authoritative even while the server row is still being
  // reaped by drainDiscardedExtras. try/catch for the one tick before ensureDiscardSchema.
  let discarded = new Set<string>();
  try {
    discarded = new Set((await db.getAll<{ change_order_id: string }>(
      `SELECT change_order_id FROM change_order_discarded`)).map((r) => r.change_order_id));
  } catch { /* schema not up yet; nothing deleted to skip */ }

  let pulled = 0, statusUpdated = 0, skipped = 0, conflicts = 0;
  for (const co of data as any[]) {
    // A deleted extra must not be resurrected by the pull. Skip it: the local delete
    // is the intent, the server row is being dropped by drainDiscardedExtras.
    if (discarded.has(co.id)) { skipped++; continue; }
    // REQ-LC1: five stored statuses and never a sixth. A status this build has
    // never heard of comes from a newer server, so it is skipped rather than
    // stored: written, it would land in a row `stageOf` reads as sealed and no
    // screen could explain, and the local CHECK would reject it below anyway —
    // this just refuses it by name instead of as constraint violation 23514.
    if (!isStoredStatus(co.status)) {
      skipped++;
      console.log('hydrate skipped an unknown status:', co.id, String(co.status));
      continue;
    }
    // ONE ROW MUST NOT TAKE THE HYDRATE WITH IT. This had no guard: a single
    // change order the local schema cannot accept — a priceless one once the
    // server column goes nullable, or any future column mismatch — threw out of
    // the loop, and every extra AFTER it in the same pull silently never landed.
    // The failure is invisible from the app: the ledger is simply short, with no
    // error anywhere, which is the shape of bug this codebase has been bitten by
    // repeatedly. Skip the row, count it, keep going.
    let res;
    try {
      res = await db.execute(
      // 391 + the flow terms. `scope_of_work` was missing from this pull, so a SECOND
      // device rendered the title where the scope of work belongs — the exact confusion
      // the split exists to end, reintroduced by the sync path. The four flow terms had
      // the same hole: they are frozen terms of the deal (REQ-LC41) and a second phone
      // showed them as "Not set".
      `INSERT OR IGNORE INTO change_order (id, decision_id, project_id, owner_id, scope,
         scope_of_work, line_items, amount_cents, nte_cents, is_mini, who_directed,
         ref_estimate, numbers_confirmed_at_ms, status, signed_by, created_at_ms,
         origin_change_order_id,
         billing_timing, schedule_effect, schedule_days, exclusions, co_number)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [co.id, co.decision_id, co.project_id, ownerId, co.scope,
       // Falls back to the title for a row written before 391 existed.
       co.scope_of_work ?? co.scope,
       JSON.stringify(co.line_items ?? []), co.amount_cents, co.nte_cents,
       co.is_mini ?? 0, co.who_directed, co.ref_estimate,
       new Date(co.numbers_confirmed_at).getTime(), co.status,
       signedBy.get(co.id) ?? null, new Date(co.created_at).getTime(),
       origins.get(co.id) ?? null,
       co.billing_timing ?? null, co.schedule_effect ?? null,
       co.schedule_days ?? null, co.exclusions ?? null,
       // THE NUMBER IS THE IDENTIFIER, and it was the one column this pull left
       // behind. It is written locally by `nextCoNumber`, uploaded in the outbox
       // payload, and stored on the server (sql/399) — but never selected back, so
       // every extra on a second device or a reinstall rendered the fallback kicker
       // ("Change order", no #) forever. `backfillCoNumbers` could not save it
       // either: that runs once at launch, BEFORE this pull, and renumbering a row
       // the server has already numbered would invent a second identity for one
       // document. Adopt the server's number; never mint one here.
       co.co_number ?? null]
      );
    } catch (e: any) {
      skipped++;
      console.log('hydrate skipped a change order:', co.id, String(e?.message ?? e).slice(0, 120));
      continue;
    }
    if (res.rowsAffected) { pulled++; continue; }

    /**
     * A ROW THIS DEVICE ALREADY HAS — adopt the number if it is missing one.
     *
     * `INSERT OR IGNORE` above does nothing when the row exists, so adding
     * `co_number` to the insert fixed only extras pulled for the FIRST time.
     * Every extra already sitting on a phone kept its NULL forever and went on
     * rendering "Change order" with no number — which is exactly what hadar was
     * still looking at after installing the build that "fixed" it (2026-08-21).
     *
     * SAFE ON A SENT OR SIGNED EXTRA, checked rather than assumed: `co_number` is
     * not among the columns `change_order_frozen` guards (scope, amount, nte,
     * billing_timing, schedule_effect, schedule_days, exclusions, scope_of_work),
     * so this UPDATE is permitted on a frozen instrument. It has to be — the
     * number is how a signed document is referred to, and a signed extra is
     * precisely the one you cannot afford to leave unidentified.
     *
     * `WHERE co_number IS NULL` is what keeps it an adoption rather than an
     * overwrite: a number this device minted and has not yet uploaded is never
     * replaced by the server's guess at one.
     */
    if (co.co_number != null) {
      try {
        // NO `AND co_number IS NULL` ANY MORE. That predicate was right while the
        // device minted numbers and the server merely stored them — it stopped a
        // remote value overwriting a local one. Since sql/419 the server is the only
        // thing that assigns, so its answer is not a competing opinion, it is THE
        // number; a local value that disagrees is a leftover from before and gets
        // corrected rather than defended.
        await db.execute(
          `UPDATE change_order SET co_number = ? WHERE id = ? AND co_number IS NOT ?`,
          [co.co_number, co.id, co.co_number]);
      } catch (e: any) {
        // Never let a cosmetic backfill cost the status adoption below.
        void logDiag(db, 'hydrate.conumber', `${co.id}: ${String(e?.message ?? e).slice(0, 100)}`);
      }
    }

    // Existing row: status only, and only if we are not holding an unsent intent.
    const local = (await db.getAll<{ status: string }>(
      `SELECT status FROM change_order WHERE id = ?`, [co.id]))[0];
    if (!local || local.status === co.status) continue;
    // `canAdoptServerStatus`, NOT `canTransition`, and the difference is a defect
    // this line shipped with. Adopting is LEARNING a move, not MAKING one, so the
    // question is "could the server lawfully have got here", not "could this device
    // have done it". `canTransition` answers the second, and it refused
    // `draft → superseded` forever — a second handset that pulled the row while it
    // was still a draft kept rendering a retired version as an editable draft, with
    // Edit, Send and Delete live, on every tick for the life of the extra.
    if (!canAdoptServerStatus(local.status, co.status)) {
      conflicts++;
      // LOUD, and with both statuses in it. This is the one line anybody will have
      // to work from when a phone and the cloud disagree about a signed document.
      // It goes to the flight recorder as well as the console: a Release build
      // shows nothing of console.log, and this refusal is permanent — it re-fires
      // every tick and repairs itself never.
      console.log('hydrate REFUSED an illegal server status: %s is %s here, %s there',
        co.id, local.status, co.status);
      void logDiag(db, 'hydrate.conflict', `${co.id}: ${local.status} here, ${co.status} there`);
      continue;
    }
    // No timestamp is stamped here, deliberately. This device knows WHEN IT LEARNED
    // of the move, which is not when the move happened, and REQ-LC4 dates a
    // transition once, at the transition. Writing Date.now() would put a plausible
    // wrong time on a signature; the record screen's honest "time not recorded" is
    // the correct output until the server's own event timeline is read.
    const upd = await db.execute(
      `UPDATE change_order SET status = ?, signed_by = ?
        WHERE id = ? AND status = ?
          AND NOT EXISTS (SELECT 1 FROM change_order_outbox o WHERE o.change_order_id = change_order.id)`,
      [co.status, signedBy.get(co.id) ?? null, co.id, local.status]
    );
    if (upd.rowsAffected) statusUpdated++;
  }

  // THE WRITE-UP, LEARNED RATHER THAN AUTHORED (394).
  //
  // The model's output is applied to the change order ON THE SERVER now
  // (`apply_proposal_v1`), because the web app is coming and the rule that decides what
  // a binding document says must exist once, not once per client. This device's job is
  // no longer to apply it — only to notice it happened.
  //
  // THE GUARD IS THE SAME ONE, RESTATED LOCALLY, and it has to be: a draft is edited on
  // the phone, often with no signal, and the row here can legitimately be ahead of the
  // server. So a pulled scope is adopted ONLY while this device is holding nothing of
  // its own — nothing queued in the outbox, and the local text still empty, still the
  // placeholder, still a copy of the title, or still exactly what the AI last left.
  // Anything else is the contractor's, and a hydrate that overwrote it would be the
  // cloud silently editing a man's document while he was writing it.
  //
  // Draft-only, like everything else that touches these columns: a sent extra's scope
  // is inside a frozen instrument (mandate #5).
  let scopesLearned = 0;
  for (const co of data as any[]) {
    if (discarded.has(co.id)) continue;   // a deleted extra is not resurrected here either
    const sow = (co as { scope_of_work?: string | null }).scope_of_work;
    const ai = (co as { scope_of_work_ai?: string | null }).scope_of_work_ai;
    if (!sow || !sow.trim() || sow !== ai) continue;   // not the server's AI text: leave it
    const upd = await db.execute(
      // THE TERMS COME DOWN WITH IT (2026-08-07). `apply_proposal_v1` writes schedule
      // effect, payment timing, exclusions and type on the SERVER, and this loop learned
      // only the scope and the price quote — so a change order that had been correctly
      // filled in the cloud showed empty fields on the phone, which is exactly what
      // hadar saw ("it didn't pick up the cost, impact on schedule, payment timing").
      //
      // COALESCE on every one: an answer this device already holds always wins. The
      // server may only fill a blank, never overwrite the contractor — the same rule
      // apply_proposal_v1 enforces on its side, restated here because a hydrate that
      // clobbered a local answer would be the cloud editing his document while he was
      // writing it.
      `UPDATE change_order SET scope_of_work = ?, scope_of_work_ai = ?, scope = ?,
              price_heard      = COALESCE(?, price_heard),
              schedule_effect  = COALESCE(schedule_effect, ?),
              schedule_days    = COALESCE(schedule_days, ?),
              billing_timing   = COALESCE(billing_timing, ?),
              exclusions       = COALESCE(exclusions, ?),
              extra_type       = COALESCE(extra_type, ?)
        WHERE id = ? AND status = 'draft'
          AND (scope_of_work IS NULL OR trim(scope_of_work) = ''
               OR scope_of_work = scope OR scope_of_work = ?
               OR (scope_of_work_ai IS NOT NULL AND scope_of_work = scope_of_work_ai))
          AND NOT EXISTS (SELECT 1 FROM change_order_outbox o WHERE o.change_order_id = change_order.id)`,
      [sow, sow, co.scope,
       (co as { price_heard?: string | null }).price_heard ?? null,
       (co as { schedule_effect?: string | null }).schedule_effect ?? null,
       (co as { schedule_days?: number | null }).schedule_days ?? null,
       (co as { billing_timing?: string | null }).billing_timing ?? null,
       (co as { exclusions?: string | null }).exclusions ?? null,
       (co as { extra_type?: string | null }).extra_type ?? null,
       co.id, UNTITLED_SCOPE_TEXT]
    );
    if (upd.rowsAffected) scopesLearned++;
  }
  if (scopesLearned) console.log('hydrate learned %d server-written scope(s)', scopesLearned);

  return { ok: true, pulled, statusUpdated, skipped, conflicts };
}


/**
 * Un-park extras the server refused for a reason that has since been FIXED.
 *
 * 23502 (not_null_violation) was permanent while the server demanded a price on
 * every extra; hadar's first two recordings under the new model parked on it
 * and would have sat "pending" forever. Then 370 dropped the constraint — the
 * refusal's reason no longer exists, but "parked" is a one-way door with no
 * retry. This is the other half of parking honestly: when the WORLD changes,
 * the verdicts issued under the old world must be reviewable, or a fixed server
 * still leaves permanently-lost uploads behind.
 *
 * Scoped to exactly the code whose meaning changed. A 42501 stays parked — the
 * server still means it.
 */
export async function redriveParked(
  db: AbstractPowerSyncDatabase, codes: readonly string[]
): Promise<number> {
  if (!codes.length) return 0;
  const marks = codes.map(() => '?').join(',');
  const r = await db.execute(
    `UPDATE change_order_outbox
        SET attempt_count = 0, next_attempt_at_ms = 0,
            last_error_code = NULL, last_error_text = NULL
      WHERE last_error_code IN (${marks})`, [...codes]);
  return r.rowsAffected ?? 0;
}
