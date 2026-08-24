# SPEC: the extra's three-state lifecycle — v1
**Owner: Hadar | Written 2026-07-28 | Status: authoritative for the lifecycle**

*This document is the single source of truth for **what states an extra can be in, how it moves
between them, and what is permitted in each**. It exists because that answer was spread across
`PRD-change-approval-loop` (R1–R15), `FLOW-SIMPLEST-JOBSITE`, `SPEC-capture-core-v1 §7.1/§7.2`,
`CORE-CONCEPT`'s append-only principle, and eleven SQL migrations — and those sources disagreed
in twelve places, five of which are adjudicated in §6.*

**Governed by `CLAUDE.md`'s ten mandates, which override everything here.** Where this spec and a
mandate appear to conflict, the mandate wins and the conflict is a defect in this spec.

**What this document owns:** the stored status vocabulary, the derived display vocabulary, every
legal transition and its guard, the per-stage permission set, the send-readiness contract, the
negotiation contract, the seal, and the composition of the frozen instrument.

**What it does NOT own, and must never restate:** durability and the capture commit state machine
(`SPEC-capture-core-v1` + `DURABILITY-DESIGN-v1`), pricing/seats (`PRICING-STRATEGY`), the language
pivot (`LANGUAGE-LAYER`), the product rationale for the loop (`PRD-change-approval-loop` — this spec
*implements* its R-numbers, it does not replace them), the EWA's own terms schema (`303_ewa.sql`).

**Requirement IDs** are in the `REQ-LC*` namespace, stable, and never renumbered. Every one carries
an `Accept:` clause (how you know it holds) and a `[trace: …]` tag back to an R-number, a mandate,
one of the six binding decisions, or the file that already enforces it. **A requirement with no
trace is not a requirement — it is an assumption, and it is marked as one.**

**The six binding decisions (hadar, 2026-07-28)** this spec implements are referenced as D1–D6:

| | |
|---|---|
| **D1** | An extra has exactly THREE stages: pre-sent draft · post-sent negotiation · approved & locked. |
| **D2** | Revising after send creates a NEW VERSION that supersedes. v1 freezes, its link is retired, approval binds exactly one version. |
| **D3** | The send gate hard-blocks on DESCRIPTION and COST only. Photos, payment timing, schedule impact, what's-not-included warn but never block. |
| **D4** | Single required approver per extra. Others may view and answer questions; they cannot approve. |
| **D5** | Automated reminders run in the existing worker via the written `send-sms` Edge Function. Secrets are unset, so the path must fail loudly and visibly, never silently. |
| **D6** | After approval, a change is a NEW INDEPENDENT EXTRA linked by origin. The approved record is never reopened, superseded, edited or deleted. |

---

## 1. The state machine

### 1.1 The stored vocabulary

**REQ-LC1 — There are exactly five stored statuses, and there will never be a sixth.**
`change_order.status ∈ ('draft','sent','approved','declined','superseded')`, identically on the
device (`CHANGE_ORDER_DDL`, `changeorder.ts:64`) and on the server (`030_change_order.sql:50`).
Anything that looks like a status but is a function of other rows — *discussing, viewed, settled,
awaiting-your-reply, unpriced* — is **derived** (§1.2) and is never written to this column.
The reason is stated once and applies to all of them: a stored copy of a derived fact is a second
place for the truth to live and the first place for it to drift, and here two different writers
(the client's question and the client's answer) would both be able to move it.
- **Accept:** `STORED_STATUSES` in `extrastatus.ts`, the SQLite `CHECK`, and the Postgres `CHECK`
  contain the same five strings and no others. A migration proposing a sixth is rejected at review.
- `[trace: 030_change_order.sql:50 · extrastatus.ts:34 · 220_question_path.sql ("derivable and not a fourth stored state") · 308_r5b_discussion.sql:56]`

**REQ-LC2 — Stage mapping. Every status maps to exactly one stage of D1.**

| Stored status | D1 stage | What it means |
|---|---|---|
| `draft` | **Stage 1 — pre-sent draft** | Nothing has left the phone. Mutable, deletable. |
| `sent` | **Stage 2 — post-sent negotiation** | A live link exists. Frozen. The derived `discussing` and the `viewed` signal are sub-states of this one. |
| `approved` | **Stage 3 — approved & locked** | Sealed. Audit and conflict resolution only. |
| `declined` | **terminal exit from Stage 2** | Sealed by the same rules as Stage 3 (no edit, no delete, no supersede) but it never becomes Stage 3: it carries no approval, no money, and no obligation. |
| `superseded` | **terminal exit from Stage 2** | A frozen historical version. Its successor carries the live stage. Never re-enters any stage. |

`declined` and `superseded` are deliberately **not** called Stage 3. Stage 3 is defined by the
existence of an approval, and both of these have none. Calling them Stage 3 would make "Stage 3
means somebody signed" false, which is the one thing that sentence has to mean.
- **Accept:** every UI surface that names a stage derives it from this table via one shared
  function; no screen re-decides the mapping locally.
- `[trace: D1]`

**REQ-LC3 — `viewed` is DERIVED from `confirmation_open` events, is never stored, and is demoted
from a *status* to a *signal* on `sent`.**

`Viewed` appears as a status in `PRD-change-approval-loop:70` (data model) and `:591` (R8), has no
writer anywhere in the system, and R8's 24h auto-reminder AC (`:604`) is gated on it. The ruling,
and both halves of it matter:

1. **It is derived, not stored.** The raw fact already exists as append-only evidence in
   `confirmation_open` (`366_event_timeline.sql:34`), written by `confirmation_opened()` from the
   no-account page. Storing a status off it would let an **anonymous** caller move the status of a
   priced commitment — an authority the token was never granted (`020_confirmations.sql`: the token
   is a credential for *reading and answering*, not for moving state).
2. **It is not a status.** `R7`'s ledger AC enumerates exactly five per-item statuses
   (`approved/pending/discussing/declined/superseded`); a sixth chip would contradict a shipped
   requirement to express something that is a *degree of* `sent`, not an alternative to it.

The canonical derivation:
```ts
/** Derived from confirmation_open rows for every request on this change order. */
export type OpenSignal = {
  openCount: number;              // rows, after 366's 60s same-agent coalescing
  firstOpenedAtMs: number | null;
  lastOpenedAtMs: number | null;
  neverOpened: boolean;           // openCount === 0
};
export function openSignal(events: readonly TimelineEvent[]): OpenSignal;
```
Everything that previously said "status = Viewed" is restated on this signal: R8's auto-reminder
gate is `status === 'sent' && signal.neverOpened && now - sentAt >= 24h` (REQ-LC25), and R6b's
plain-language state line reads "opened 3× · no answer yet" rather than a chip.
- **Accept:** grep finds no `'viewed'` in any `CHECK`, any `STORED_STATUSES`, or any column
  default. `openSignal` has exactly one implementation. R8's reminder gate compiles against it.
- `[trace: PRD R8:591,604 · 366_event_timeline.sql:34 · contradiction C2 (§6)]`

**REQ-LC4 — State-change moments are recorded, not inferred.**
`change_order` today records *what* state it is in and never *when* it got there, so `record.ts`
renders sent/signed/declined with an explicit "time not recorded" marker.
- **On the device:** `change_order` gains `sent_at_ms`, `approved_at_ms`, `declined_at_ms`
  (`superseded_at_ms` too, mirroring the server's existing `superseded_at`). Each is written **by
  the same guarded UPDATE that moves the status**, in the same statement, and is **write-once**:
  `WHERE … AND sent_at_ms IS NULL`. A second writer never re-dates a transition.
- **On the server:** these are **derived, not stored** — `confirmation_request.created_at` is when
  it was sent and `confirmation_response.responded_at` is when it was answered, both already
  append-only evidence. A stored server copy would be exactly the drift REQ-LC1 forbids. The
  device stores them because the device holds none of those event rows and must render the record
  offline (mandate #7).
- **Accept:** an extra sent offline and never synced shows a real sent time on its record screen;
  `change_order_timeline` and the device's `sent_at_ms` agree to the second for a synced extra.
- `[trace: DEF-8 · R6 ("each event with timestamps in order") · mandate #7 · 366_event_timeline.sql:19]`

### 1.2 The derived vocabulary

**REQ-LC5 — There is exactly one derivation of the display status, and it is pure.**
`displayStatus(stored, signals) → 'draft'|'sent'|'discussing'|'approved'|'declined'|'superseded'`
(`extrastatus.ts:85`). Precedence, unchanged and load-bearing: **a terminal answer outranks a
question, always.** A client who asked at 9am and signed at 11am is `approved`; letting the
question win would show "Discussing" over a signed approval — the app contradicting its own binding
instrument. No second `displayStatus` may exist anywhere (this repo has removed two already).
- **Accept:** one exported `displayStatus`; `extrastatus.test.ts` covers the precedence cases; no
  screen computes a chip label from a raw status string.
- `[trace: R7 · extrastatus.ts:85]`

**REQ-LC6 — `settled` is an EWA-only derived status and is not part of the general machine.**
`ewaStatus({status, childStatus})` returns `'settled'` when an approved EWA's step-2 price is
itself approved (`ewa.ts:243`). It is derived for the same reason as `discussing`, it appears only
on EWA rows, and it never widens `change_order.status`.
- **Accept:** `settled` appears in no `CHECK`; the EWA ledger view derives it (`303_ewa.sql:338`).
- `[trace: R3 AC2 · ewa.ts:214-243 · 303_ewa.sql:312-338]`

### 1.3 The transition table

**REQ-LC7 — These are the only legal transitions. Every writer states the precondition in its own
`WHERE`/guard; no writer relies on a caller having checked first.**

| # | From | To | Actor | Guard (the exact precondition) | Writers |
|---|---|---|---|---|---|
| T1 | `draft` | `sent` | contractor | `sendGate(...).ok` (REQ-LC13) **and** a `confirmation_request` was successfully created | `markLocalSent` (`changeorder.ts:787`, `WHERE status='draft'`) · `confirmation_request_marks_sent` (`230:67`, `WHERE status='draft'`) |
| T2 | `sent` | `approved` | the single approver (D4) | link live (not `superseded_at`, not expired) **and** `status IN ('draft','sent')` **and** a typed legal name of length > 1 | `confirmation_response_settles_co` (`230:112`) · `applyLocalApproval` **(guard missing — DEF-1)** · `signApproval` **(guard missing — DEF-1)** |
| T3 | `sent` | `declined` | the single approver | same as T2 | same as T2 |
| T4 | `sent` | `superseded` | contractor | `status = 'sent'` **exactly** (`canSupersede`) | `supersede_change_order_v1` (`307:119`, `WHERE status='sent'`) · `supersedeExtra` (device) |
| T5 | `draft` | *(destroyed)* | contractor | no `confirmation_request` has ever existed for its decision **and** no other change order reaches its captures | `discard_extra_own` (`369`) + local tombstone `change_order_discarded` |
| T6 | `approved` | *(hard-deleted + hash stub)* | data subject | a valid GDPR/CCPA erasure request | the erasure path only — **the single lawful exception** |

`draft → approved` in T2's guard is deliberate and is not a bug: the *server* row is always `sent`
by the time an answer lands (T1's trigger), but a **device** row may still read `draft` because the
send has not been hydrated back. Refusing the answer there would make being behind on sync produce
a wrong outcome (mandate #7).

**Everything not in this table is refused, loudly.** In particular: `approved → anything`,
`declined → anything`, `superseded → anything`, `sent → draft`, and any edit of a frozen column
(REQ-LC30, REQ-LC31).
- **Accept:** for each row, a test drives the illegal neighbours and asserts a refusal with a
  reason, not a silent no-op; every writer named above contains its guard literally in its own SQL.
- `[trace: D1 · D2 · D6 · R6 AC2 · mandate #1]`

**REQ-LC8 — A refused transition is reported, never swallowed.**
A writer whose guard did not match returns `rowsAffected = 0` / `status:'not_superseded'` /
`already_answered`, and the **caller must read it**. `markLocalSent` already returns whether a row
moved and `App.tsx` already logs "was already past draft; server state wins" — that is the pattern.
A UI that reports a transition that did not happen is the "claims that outrun their evidence"
defect this project keeps finding.
- **Accept:** no call site of a transition writer discards its return value.
- `[trace: CLAUDE.md §3.1 · changeorder.ts:783-791]`

---

## 2. Stage 1 — the pre-sent draft

**The goal of Stage 1 is to collect enough that the owner can approve.** Not to collect everything.

**REQ-LC10 — The send gate hard-blocks on DESCRIPTION and COST only.**
Per D3. Nothing else may disable Send — not a missing photo, not a missing payment timing, not a
missing schedule answer, not missing exclusions. Those four **warn**, render as incomplete, and are
sent anyway if the contractor chooses.
- **Accept:** `sendReadiness` returns `ok:true` for an extra with a description, a cost, zero
  photos, and all four flow fields null. A build in which any recommended item can disable Send is
  a defect against D3.
- `[trace: D3 · FLOW-SIMPLEST-JOBSITE §3]`

**REQ-LC11 — The exact shape of the readiness result.**
The UI must be able to render *both* the blocking reason and the recommended-but-missing list from
one value, without re-deriving either.

```ts
export type SendBlocker =
  | 'no_description'      // btrim(scope) is empty
  | 'no_cost';            // see REQ-LC12 for what "cost" means per kind

export type SendRecommendation =
  | 'no_photos'           // zero photos attached (R4 allows 0–8; zero is legal, not ideal)
  | 'no_billing_timing'   // billing_timing IS NULL
  | 'no_schedule_effect'  // schedule_effect IS NULL   ('not_sure' is a COMPLETE answer)
  | 'no_exclusions';      // btrim(exclusions) is empty

export type SendReadiness = {
  /** true iff blockers.length === 0. The ONLY value permitted to disable Send. */
  ok: boolean;
  /** D3's hard gate, ordered description-then-cost — the order the composer asks in. */
  blockers: SendBlocker[];
  /** D3's soft gate. Never disables Send. Rendered as "incomplete", never as an error. */
  recommended: SendRecommendation[];
  /** For the "3 of 4 complete" affordance. `of` is always 4. */
  completeness: { have: number; of: 4 };
};

export function sendReadiness(x: {
  kind: 'extra' | 'decision' | 'ewa';
  scope: string;
  amountCents: number | null;
  nteCents: number | null;
  priceMode: 'fixed' | 'nte';
  photoCount: number;
  billingTiming: string | null;
  scheduleEffect: string | null;
  exclusions: string | null;
}): SendReadiness;
```
Rules the shape encodes: `'not_sure'` is a **complete** schedule answer (FLOW decision 3 — it
renders to the owner as "Schedule impact: to be confirmed", which is honest and revisable), so it
never appears in `recommended`. `completeness` counts the four recommended items only; blockers are
not a percentage, they are a wall.

`sendReadiness` is **pure** — no imports, no database, no clock — for the same three reasons
`extrastatus.ts` and `extraprocstate.ts` are: it decides whether a priced binding document may be
sent, it is a function of its inputs, and its test must run under `node --test`.
- **Accept:** a table test covers each blocker and each recommendation in isolation and the
  all-clear case; the function imports nothing at runtime.
- `[trace: D3 · R4 · FLOW-SIMPLEST-JOBSITE decision 3]`

**REQ-LC12 — What "cost" means, per kind. A missing price and a zero price are different facts.**
`amount_cents` is nullable on purpose: "he never said a price" is not "this is free", and storing 0
for the first would tell a homeowner the work costs nothing (`changeorder.ts:50-55`).

| Kind | `no_cost` fires when |
|---|---|
| **Extra, fixed** | `amountCents === null` |
| **Extra, NTE** | `amountCents === null` **or** `nteCents === null` — R3's standing rule: T&M **always** carries an NTE; a bare range is never offered |
| **EWA** | never on price (`amount_cents = 0` is the truthful number, enforced by `303`). Its own blockers are `proceed_term`, and for `tm_capped` both `hourly_rate_cents` and `cap_cents` — enforced at the table by `303`'s uncapped-authorization guard |
| **Decision** | never. A Decision carries no price by definition and no price field is shown (R10) |
- **Accept:** an NTE draft with a cap but no amount is blocked; an EWA with a `hold` term and no
  money is not blocked; a Decision with no price is not blocked.
- `[trace: R3 · R10 · 303_ewa.sql · changeorder.ts:50-55 · FLOW decision 4]`

**REQ-LC13 — The content gate and the pipeline gate are ORTHOGONAL. Both must pass.**
This is the single most likely thing for a builder to get wrong, so it is stated explicitly:

- **`sendReadiness` (this spec)** answers *"has the contractor said enough?"* — a **content**
  question, answerable entirely on the device, fixable by the contractor right now.
- **`canSendExtra(extraProcState(...))` (`extraprocstate.ts:98`, `extrareadiness.ts`)** answers
  *"has the evidence left the phone and been processed?"* — a **pipeline** question, not fixable by
  the contractor, only waitable. It exists because an extra whose audio or photos are still queued
  would send a client a link to evidence that has not left the device and might never.

Neither subsumes the other and neither is being replaced. The composition is one function:

```ts
export type SendGate =
  | { ok: true }
  | { ok: false; kind: 'content';  readiness: SendReadiness }
  | { ok: false; kind: 'pipeline'; whyKey: string };

/** Content first: it is the refusal the contractor can act on. Pipeline second: it is
 *  the refusal he can only wait out. Both are checked; only one is shown. */
export function sendGate(r: SendReadiness, proc: ProcState): SendGate;
```
- **Accept:** an extra with a description and a price but a photo still in the outbox is refused
  with `kind:'pipeline'`; an extra whose captures are all `processed` but which has no price is
  refused with `kind:'content'`. Neither gate is deleted or weakened in favour of the other.
- `[trace: D3 · extraprocstate.ts:98 · extrareadiness.ts · mandate #1 · mandate #6]`

**REQ-LC14 — Stage 1 is the only stage in which an extra may be edited in place or destroyed.**
A draft has no counterparty, no frozen instrument and no live link, so correcting it is honest and
deleting it destroys nobody's evidence. Deletion removes the **bytes** (the storage object) and
retains an auditable row that something existed and was deliberately discarded — `369`'s shape,
which refuses any extra that was ever sent and any capture another change order still reaches.
- **Accept:** `discard_extra_own` refuses a change order whose decision has a `confirmation_request`;
  the device writes its tombstone in the same transaction as the local delete so `hydrateChangeOrders`
  cannot resurrect it.
- `[trace: 369_discard_unsent.sql · mandate #1 · D1]`

**REQ-LC15 — Send is the freeze point, not approval.**
The moment the link is minted, `scope`, `amount_cents`, `nte_cents` and the four flow fields become
immutable, on both sides. See §6/C5 for why this is stricter than `CORE-CONCEPT`'s named principle
and why the stricter rule is the correct one.
- **Accept:** an UPDATE of any frozen column on a `sent` row raises, on the device and on the server
  (the server half is DEF-3, open).
- `[trace: mandate #5 · R6 AC2 · 030_change_order.sql:108 · changeorder.ts:149]`

---

## 3. Stage 2 — post-sent negotiation

**The goal of Stage 2 is communication, revision and resend.** The extra is live, the link is out,
and exactly three contractor moves exist.

**REQ-LC20 — The contractor's move set in Stage 2 is exactly: Reply · Remind · Revise & Resend ·
Withdraw.** No fifth move. In particular there is still no "edit", no "mark approved by hand", and
no "delete".

**AMENDED 2026-08-24 [hadar]: "Withdraw" was added; this requirement previously named "cancel" as a
move that does not exist.** The original reasoning was that a contractor who wants the work not to
happen "issues nothing — the link expires (30 days, `020`) or he revises to a version the client
declines". Both of those leave a LIVE instrument sitting in a client's messages for up to a month
with nothing said, and the second requires him to author a version he does not want in order to
have it refused. That is the miscommunication this product exists to prevent, performed by the
product. The move is now explicit, and it tells the counterparty rather than letting the silence do
it.

The withdrawal is bounded by three rules, all enforced on both sides:
- **Only from `sent`.** A draft has no live instrument and nobody to tell (that act is delete); an
  approved record is frozen and permanent (REQ-LC30, mandate #1).
- **An approval WINS a race.** `cancel_change_order_v1` refuses outright when a confirmed response
  exists, and says so, rather than racing the status. A cancellation that could land on top of a
  signature would let a contractor un-sign a signed document.
- **The link dies in the same transaction as the status,** so an approval already in flight cannot
  land after the withdrawal.

`cancelled` is a SIXTH stored status, not a reuse of `superseded`: superseded means a newer version
replaced this one and the client's page links them forward to it (367), whereas a withdrawal has no
successor, and printing "replaced" on an instrument nothing replaced is a false statement about
what happened.
- **Accept:** the record screen exposes exactly these four affordances on a `sent` extra, each
  disabled with a stated reason when its own precondition fails; every recipient of the confirmation
  receives a note; and the client page says "withdrawn", never "replaced".
- `[trace: D1 · R5b ("two moves from a thread") · R8 (remind) · 421_cancel_sent_extra.sql ·
  hadar 2026-08-24]`

**REQ-LC21 — `Remind` MUST reuse the live link and MUST NOT mint a token.**
R8 says it in five words — "always via the same link". Minting a token would fire `250`'s supersede
trigger and retire the link already sitting in the client's messages: they scroll back to Tuesday's
text, tap it, and get "This version was replaced" **because you reminded them**. The nudge would
break the thing it was nudging about.
Governing limits, which belong to the requirement and not to a UI: **max 2 automated + unlimited
manual, rate-limited to 1 per day per extra**, and **no reminder at all while a client question is
unanswered** (R8 pauses automated ones mid-negotiation; this spec applies it to manual too — the
client is waiting on *him*, and a nudge there is not a nudge).
- **Accept:** `canRemind` is the single arbiter (`remind.ts:49`); the remind path calls
  `liveLinkFor` and never `sendForConfirmation`; a reminder does not create a `confirmation_request`
  row. Verified today: `App.tsx:614-633` already satisfies this.
- `[trace: R8:601-605 · remind.ts · 250_one_live_link.sql · contradiction C6 (§6)]`

**REQ-LC22 — `Revise & Resend` MUST mint a new instrument and retire the old one.**
Per D2. A revision is a **new `change_order` row** at the new price; the prior row moves
`sent → superseded` with `superseded_by` pointing forward; the prior row's live link is retired in
the same act (`307:141`) so a client cannot sign yesterday's $1,850 after it became $1,500. The new
row starts at `draft` and reaches a client only through the ordinary preview-and-send path —
mandate #2 gets no exception for the second price just because a human confirmed the first.
- **Accept:** `reviseChangeOrder` creates a row and calls `supersedeExtra`; it sends nothing.
  `supersede_change_order_v1` refuses any status other than `sent` and refuses a second, different
  successor with `23505`. The thread survives the revision (`change_order_lineage`, `308:126`).
- `[trace: D2 · R5b · revision.ts · 307_extras_ledger.sql:91-150 · contradiction C6 (§6)]`

**REQ-LC23 — The thread closes when the version is answered, and the UI must never offer a reply
that cannot be delivered.**
The server closes the thread the instant a `confirmation_response` exists — for questions
(`confirmation_ask`, `220:86`) and for replies (`confirmation_reply_thread_open`, `308:94`, errcode
`23514`). `23514` is in `R5B_PERMANENT` (`discussionstore.ts:316`), so a reply written after the
answer is **parked forever while the UI shows it as sent**. That is a silent delivery failure on
the one surface whose whole job is that the record is complete.

**The ruling: `canReply` is `coStatus === 'sent'`, and nothing else.** A Stage 3 record is sealed
(D1: "no edits, no deletion, exists solely for audit"), R5b AC4 says the thread closes on approval,
and the server has enforced exactly that since `308`. The 2026-07-24 note in `discussion.ts:145-153`
("an extra becomes like a chat channel") widened the client to `sent|approved|declined` **without
the server ever being widened to match**; it is overridden here, and the reason it was wrong is not
that the idea is bad but that it was applied on one side of a two-sided contract.
Where the conversation goes instead: a post-approval change is a **new linked extra** (REQ-LC32),
which is where a new commitment belongs anyway.
- **Accept:** `threadState({coStatus:'approved'}).canReply === false`; `threadscreen.tsx` renders
  `r5b.threadClosed` (already written, both languages) instead of a composer; no `r5b_outbox` row
  can be created that `308:94` would reject.
- `[trace: D1 · D6 · R5b AC4 · 308_r5b_discussion.sql:94 · DEF-4]`

**REQ-LC24 — The derived negotiation signal: "waiting on X · opened N times".**
R6b item 2 requires "one line saying what is true now and what is owed next" — an instruction, not a
label. It is derived, in one place, from facts that already exist:

```ts
export type WaitingOn = 'contractor' | 'approver' | 'nobody';
export type NegotiationSignal = {
  waitingOn: WaitingOn;
  openCount: number;              // REQ-LC3's openSignal
  lastOpenedAtMs: number | null;
  neverOpened: boolean;
  unansweredSinceMs: number | null;  // earliest unanswered client message
  awaitingReply: boolean;            // unanswered > 48h  (discussion.ts's AWAITING_REPLY_MS)
};
```
`waitingOn` is `'contractor'` when an unanswered client message exists; `'approver'` when the status
is `sent` and none does; `'nobody'` when the status is terminal. `unansweredSinceMs` uses the
**earliest** unanswered client message, not the latest — `discussion.ts:119-132` already states why
and the deviation from R5b's literal wording stands: taking the latest lets a client who asks again
on day 6 reset the clock and un-flag an extra that has been ignored for a week.
- **Accept:** `threadState` supplies `unansweredSinceMs`/`awaitingReply`; `openSignal` supplies the
  open counts; one function composes them; the record screen's state line has no second derivation.
- `[trace: R6b:501-504 · R6 ("opened 3 times, no response" is actionable signal) · R5b AC5 · discussion.ts:105-158]`

**REQ-LC25 — Automated reminders: a scheduler in the existing worker, failing loudly.**
Per D5. The cadence is R8's: **one reminder when the extra has been `sent` for 24h and has never
been opened**, maximum **2 automated** per extra, paused entirely while `waitingOn === 'contractor'`.
The gate is a query over evidence, not over a flag: `confirmation_request.created_at` for sent-time
and the absence of `confirmation_open` rows for unopened (REQ-LC3).

**The loud-failure requirement is the substance of D5, not a footnote.** `send-sms`'s Twilio secrets
are not set, so the function refuses to send when unconfigured — deliberately, and it must stay that
way. Therefore:
1. A reminder attempt that fails records the failure with its reason and **does not consume the
   max-2 budget** — it never reached anyone, and burning the budget on it would silently convert a
   configuration outage into "we reminded them twice and they ignored it".
2. The failure is **visible in the app**, on the extra, in the contractor's own words ("we could not
   text this reminder"). A reminder that silently did not go out is worse than no reminder feature.
3. The scheduler never marks a reminder sent before the transport confirms it — the same rule
   `remindExtra` already applies to the manual path, where the count increments only after the share
   sheet returns.
- **Accept:** with secrets unset, the scheduler runs, attempts, fails, records a reason, surfaces it,
  and the extra's automated-reminder count is still 0. No code path treats "not configured" as sent.
- `[trace: D5 · R8:604 · supabase/functions/send-sms/index.ts · App.tsx:626-631]`

**REQ-LC26 — A declined version is terminal. The next attempt is a new extra, not a reopening.**
`declined` is sealed by REQ-LC30's rules. `canSupersede` refuses it (`extrastatus.ts:127`) and so
does `supersede_change_order_v1`. A contractor who wants to try again after a decline creates a new
extra linked by origin (REQ-LC32) — the same mechanism D6 defines for post-approval changes, for the
same reason: the record of what was refused, and when, must survive intact.
- **Accept:** the record screen of a declined extra offers no Revise; it offers "start a new extra
  from this one".
- `[trace: D6 · extrastatus.ts:112-128 · R3 AC4 ("Declined — do not proceed")]`

---

## 4. Stage 3 — approved & locked

**REQ-LC30 — An approved extra is SEALED: no edit, no delete, no supersede, no decline, no new
thread messages, no status movement of any kind.**
This is `CORE-CONCEPT`'s named principle applied to the money loop and it has exactly one lawful
exception (REQ-LC34). The seal has five independent enforcement points and all five are required —
a rule enforced in one place is a rule some other write path can forget:

| Enforced | Where | Today |
|---|---|---|
| the frozen columns cannot move | `change_order_frozen` (device) · `change_order_guard` (server) | device ✓ · server **partial (DEF-3)** |
| the status cannot move | the `WHERE status IN (…)` on every transition writer | server ✓ · device **missing (DEF-1)** |
| the approval row cannot change | `approval_immutable` (`030:85`) | ✓ |
| the thread cannot grow | `confirmation_reply_thread_open` (`308:94`) · `confirmation_ask` (`220:86`) | server ✓ · client **wrong (DEF-4)** |
| it cannot be deleted | `discard_extra_own` refuses anything ever sent (`369`) | ✓ |
- **Accept:** each row above has a test that attempts the forbidden act and asserts a refusal.
- `[trace: D1 · D6 · mandate #1 · CORE-CONCEPT:43 · R6 AC2]`

**REQ-LC31 — A change after approval is a NEW INDEPENDENT EXTRA, linked by origin.**
Per D6. The mechanism is **not** supersession and must not reuse it.

```
change_order.superseded_by        — forward pointer, WITHIN one negotiation.
                                    The predecessor is RETIRED. Nobody ever approved it.
                                    Written only by supersede_change_order_v1 (307).

change_order.origin_change_order_id  — NEW. Backward pointer, ACROSS the seal.
                                    Points from a new extra to the APPROVED extra it follows.
                                    The origin row is NOT written to, NOT retired, NOT moved.
```
Rules:
1. `origin_change_order_id` may only reference a change order whose status is `approved`.
   (Referencing a `sent` one would be a supersession wearing a different name.)
2. Writing it touches **no column of the origin row**. The origin's status, amount, scope and
   approval are untouched — that is the whole point of D6.
3. It is set once, at creation, and is itself frozen (a lineage that can be rewritten is not a
   lineage).
4. It is **not** transitive-collapsing: a chain A ← B ← C renders as three rows, never as one
   "current" row. Each carries its own signature.
- **Accept:** a migration adds the column with a `CHECK`-backed guard that the referent is
  `approved` at write time; attempting to set it against a `sent` row is refused; the origin row's
  `updated` state is byte-identical before and after.
- `[trace: D6 · 307_extras_ledger.sql:85-90 (the contrast) · CORE-CONCEPT:43 ("a change is a new record appended on top, which carries its own approval")]`

**REQ-LC32 — The ledger presents an origin-linked pair as TWO amounts, never a merged total.**
`$X approved + $Y pending`. Never `$X+Y`, never "revised to", never a single row that silently
becomes the sum. R7's totals are already "approved extras + pending extras", with no third bucket,
and `isAwaiting` already puts `sent`/`discussing` in pending. The new extra is an ordinary pending
extra; the approved one stays in the approved total forever.
The linkage is presentational: the new row carries a "Follows: <origin scope>" line and taps through
to the sealed record.
- **Accept:** a project with an approved $1,850 and an origin-linked pending $400 shows
  `Approved $1,850 · Pending $400` and nowhere shows `$2,250` as a single figure attributed to
  either extra. The approved total does not change when the follow-on is created, sent, or declined.
- `[trace: D6 · R7 AC4 · extrastatus.ts:108 (isAwaiting) · changeorder.ts:639-648 (running total)]`

**REQ-LC33 — Stage 3 is readable forever, by both parties, at the same address.**
The approver keeps access to the exact frozen wording at the link they used (`confirm.html`'s
`already_answered` branch renders `shown_content` verbatim), and the contractor sees the identical
snapshot via `change_order_timeline`. "Either party opens its record later and sees the identical
immutable snapshot" is R6 AC2 and it is a *two-sided* requirement — the party with the least access
and the most at stake is the one who signed.
- **Accept:** re-opening an answered link after approval renders the signed text and the answer, not
  a dead-end screen. Verified today for the priced path (`confirm.html:267-297`).
- `[trace: R6 AC2 · confirm.html:267-297 · 366_event_timeline.sql:163-176]`

**REQ-LC34 — The one lawful exception: erasure.**
A valid GDPR/CCPA erasure request **hard-deletes the content and media and retains a hash +
metadata stub**. It is a controlled destruction-with-tombstone, never an edit and never a plain
delete, and it is the only thing in this spec permitted to remove an approved record. Every place
that says "immutable" or "sealed" carries this carve-out.
- **Accept:** the erasure path is the only code that can remove an `approved` row, and what it
  leaves behind proves the row existed without containing the personal data.
- `[trace: mandate #1 · mandate #5 · CORE-CONCEPT:43]`

---

## 5. The binding instrument

**REQ-LC40 — THE SHOWN-CONTENT COMPLETENESS RULE. Anything the approver is shown and can rely on
must be inside the frozen text.**

If a fact (a) appears to the approver on the approval page, in the SMS/email body, or in a reminder,
**and** (b) could reasonably bear on the decision to approve, then it **must appear verbatim inside
`shown_content`**, which is frozen at send, hashed, and is the binding instrument (mandate #5).

The precedent being generalised is already enforced: `240_shown_content_integrity.sql:55-72` refuses
any send in which the displayed `amount_cents` or `nte_cents` does not literally appear in the frozen
wording, because "the approval page renders the big price from `amount_cents` while the binding
instrument is `shown_content`, and nothing made those agree". **This requirement says that reasoning
was never specific to money.** Schedule impact, payment timing and exclusions are terms of the deal
in exactly the same sense: an owner who reads "adds 3 days" on the page and signs a document that is
silent about the schedule has signed something other than what he was shown.
- **Accept:** for every field rendered on `confirm.html` above the Approve button, either the field's
  text is present in `shown_content`, or the field is listed in REQ-LC43's stated exclusions.
- `[trace: mandate #5 · mandate #2 · 240_shown_content_integrity.sql:17-26]`

**REQ-LC41 — The four flow fields are terms of the instrument.**
`exclusions`, `billing_timing`, `schedule_effect` (+`schedule_days`) are rendered into
`shown_content` by `renderCard`, as owner-facing sentences, not as database labels:
"Not included: …" · "Payment is due when the work is completed." · "Schedule: adds 3 days." ·
"Schedule impact: to be confirmed." A null field emits **no line** — an extra that predates the
fields signs the same instrument it always did, and inventing a default term would put a clause in a
contract that nobody chose.

**Status verified 2026-07-28: this is BUILT.** `confirmations.ts:60-104` renders the terms and
`App.tsx:1012-1013` passes all four at send (commit `1744c17`). The briefed DEF-2 ("phase 2 of
`375_flow_fields.sql` was never done") is **stale**. What remains open is the *server-side* half —
see DEF-3/REQ-LC42.
- **Accept:** `confirmations.test.ts` asserts each sentence and each omission; a send carrying a
  non-null flow field whose sentence is absent from `shown_content` is a defect.
- `[trace: FLOW-SIMPLEST-JOBSITE:43-47 (phase 2) · REQ-LC40 · confirmations.ts:55-115]`

**REQ-LC42 — The frozen-column set is IDENTICAL on the device and on the server.**
The device freezes seven columns (`amount_cents`, `scope`, `nte_cents`, `billing_timing`,
`schedule_effect`, `schedule_days`, `exclusions` — `changeorder.ts:150-160`). The server freezes
three (`030:108-117`). A sent extra's schedule impact is therefore **mutable server-side**, which
means the term an owner is reading right now can be changed underneath him by any path that reaches
Postgres. Being on one side of the wire must never lower the bar — the same principle `375`'s own
header states about its CHECKs ("the CHECKs mirror the device's exactly so being offline never
lowers the bar").

`extra_type` is deliberately **excluded** from the frozen set on both sides: `290`'s header states
it is a routing label, not a term of the deal, and it stays editable.
- **Accept:** a check (extending `scripts/check-schema-agreement.mjs`, which already exists to catch
  exactly this class of two-files-one-contract drift) asserts the two trigger definitions cover the
  same column list, and fails the build when they do not.
- `[trace: DEF-3 · mandate #5 · mandate #7 · 375_flow_fields.sql:1-8 · 290_r5c_transport.sql:28]`

**REQ-LC43 — Stated exclusions from REQ-LC40, and why each is outside the instrument.**

| Shown to the approver? | Item | Ruling |
|---|---|---|
| No — contractor-side only | R6c decision summary; the local `summary` column | Outside. It is a derived reading aid, explicitly "never the binding instrument", carries no signature, and appears nowhere in the approver's signed content. **If a build ever renders it to the approver, REQ-LC40 applies and it must be frozen.** |
| Yes | Photos (0–8, R4) | Inside by a different mechanism: media is immutable (mandate #1), published at send and bound to the request (`304`). Because they cannot be "in the text", **`shown_content` must state how many photos accompany it**, so a later dispute cannot claim photos were added or removed after signing. *(This line is a consequence of REQ-LC40, not an existing behaviour — it is new work.)* |
| Yes | The extras running total ("extras you've approved on this job") | Inside. It is money on the page; it is already frozen alongside `shown_content` at send (`approved_running_cents`) and falls squarely under `240`'s rule. |
| Yes | Company + sender identity ("Kowalski Remodeling — sent by Dave") | Inside. `renderCard` already emits the company line; the sender's identity is who the owner believes he is dealing with. |
- **Accept:** each row is either demonstrably in `shown_content` or has its ruling recorded here.
- `[trace: R6c ("never the binding instrument") · R4 · R5 · mandate #1]`

**REQ-LC44 — An approval binds exactly ONE version, and exactly one approver.**
Per D2 and D4. `approval.change_order_id` references one row; `shown_content` is that row's frozen
text at that send; a superseded version's link is retired so it cannot be answered
(`confirmation_response_not_superseded`, `250:61`); and the **first terminal answer wins** — an
already-answered change order is never walked to a different terminal state by a second, older link
(`230:112`). Other people on the job may **view and ask questions**; only the single named approver
can approve (D4; multi-party approval chains are a v1 non-goal).
- **Accept:** two live links for one change order cannot both be answered; the loser is recorded as
  evidence and does not move the status. A roster member who is not the approver has no Approve
  affordance.
- `[trace: D2 · D4 · 230_close_the_loop.sql:103-115 · 250_one_live_link.sql · PRD Non-Goal 4]`

**REQ-LC45 — The v1 instrument grade is `typed_link`, named honestly.**
The no-account link approval is a **typed legal name + immutable snapshot + audit trail**, recorded
under `grade = 'typed_link'`, which requires the typed name and does **not** pretend an OTP
(`230:39-59`). The stronger `signature`/`priced` grades keep their full OTP+phone binding for the
in-person path and are untouched. Whether typed-name alone clears ESIGN/UETA is **Fable Q1, a
BLOCKING legal question** — nothing ships claiming legal bindingness until it is answered. See §6/C4:
`SPEC-capture-core-v1 §7.1` and `ARCHITECTURE.md` still describe OTP as *the* signature and were
never edited after this was resolved.
- **Accept:** every link approval carries `grade='typed_link'` and a non-empty `legal_name`; no code
  writes a fabricated `otp_verified_at`.
- `[trace: PRD-RECONCILIATION §3.5 · 230_close_the_loop.sql:15-37 · PRD Open Question 1]`

---

## 6. Reconciliation — the contradictions and their rulings

*Five contradictions were identified by name in the 2026-07-28 sweep and are adjudicated below.
**Honest gap:** the sweep counted twelve; the other seven were not enumerated in any artifact this
session could read, so they are **not** adjudicated here. Three additional contradictions found
while writing this spec are recorded as C-LC1..C-LC3 rather than assigned numbers in a list I
cannot see.*

**C2 — `Viewed` is a specified status with no writer and no derivation.**
- *Contradiction:* `PRD:70` and `PRD:591` list Viewed as a status; nothing writes it; yet R8's 24h
  auto-reminder AC (`:604`) is gated on "Sent and unviewed for 24h", so a shipped requirement
  depends on a status that cannot exist.
- **Ruling:** Viewed is **derived from `confirmation_open`, never stored**, and is **demoted from a
  status to a signal on `sent`**. R8's gate is restated on the signal. → **REQ-LC3, REQ-LC25.**
- *Authority:* `366_event_timeline.sql:34` already holds the raw evidence; REQ-LC1's stored-vs-derived
  rule, which `220`/`308` established for `discussing` and `303`/`ewa.ts` for `settled`; R7's
  five-status ledger AC, which a sixth chip would falsify.

**C4 — OTP-bound signature vs typed-name-only.**
- *Contradiction:* `SPEC-capture-core-v1 §7.1:220` and `ARCHITECTURE.md:76,192,227,264,272` state the
  binding signature **is** SMS-OTP (Twilio Verify) + typed name + hash. `030_change_order.sql`'s
  original constraint enforced that. But the no-account link — the entire product — has no OTP and
  no phone, so a `priced` approval literally could not be recorded from the flow that produces
  priced approvals.
- **Ruling:** **already resolved and this spec only records it.** The v1 instrument is
  `grade='typed_link'`: typed legal name + immutable snapshot + audit trail, with the strong grades
  left intact for the in-person path. → **REQ-LC45.**
- *Authority:* `PRD-RECONCILIATION §3.5` (the source-of-truth doc for exactly this class of clash) and
  `230_close_the_loop.sql:39-59` (the shipped constraint). **Owed edit, not done here:**
  `SPEC-capture-core-v1 §7.1` and `ARCHITECTURE.md` were never updated and still assert the OTP form
  as the only one. A future session reading either first will be misled. Logged in §8.

**C5 — The freeze point: approval, or send?**
- *Contradiction:* `CORE-CONCEPT:43` freezes at **approval** ("once a record is digitally
  approved/signed, it is frozen and permanent"). The code freezes at **send**
  (`change_order_guard`: `old.status in ('sent','approved','declined')`).
- **Ruling:** **the code is stricter and the code wins.** The mandate states a floor, not a ceiling —
  it says an approved record can never move; it does not say a sent one may. Freezing at send is
  required by mandate #5 independently: `shown_content` is minted at send, so a scope edited after
  send would make the local row disagree with the document a person is reading *right now*, and R6
  AC2 says post-send edits are impossible, only void + reissue. → **REQ-LC15.**
- *Authority:* mandate #5 · `R6 AC2` · `030_change_order.sql:108`. No doc edit is needed;
  `CORE-CONCEPT:43` is not wrong, it is weaker, and this spec records that the stronger rule governs.

**C6 — The resend collision: one word means two incompatible acts.**
- *Contradiction:* `PRD R8:591` says "One-tap **reminder resend**", while `PRD R5b` says
  "**Revise & Resend** issues a superseding version". `250_one_live_link.sql` retires the previous
  live link on every new `confirmation_request`. So if "reminder resend" is implemented as a resend,
  reminding a client **invalidates the link in their messages**.
- **Ruling:** they are different acts and the words are now separated. **Remind reuses the live link
  and mints nothing** (REQ-LC21). **Revise & Resend mints a new instrument and retires the old**
  (REQ-LC22). Nothing may be called "resend" that does not mint.
- *Authority:* R8's own words, "always via the same link" (`:603`), which are unambiguous and outrank
  the loose "reminder resend" summary at `:591`; `remind.ts`'s header, which implements it; `250`,
  which makes the failure mode real. **Verified 2026-07-28: the code is correct** (`App.tsx:614-633`
  calls `liveLinkFor`). The residual is documentation: `PRD R8:591` should read "reminder", not
  "reminder resend". Logged in §8.

**C11 — The flow fields are not in the binding instrument.**
- *Contradiction:* `FLOW-SIMPLEST-JOBSITE` collects payment timing, schedule effect and exclusions
  and renders them on the review card, but `375_flow_fields.sql:7` deferred them to "phase 2" of the
  frozen instrument — so an owner could be shown a schedule impact and sign a document silent about it.
- **Ruling:** **the fields are terms of the instrument and must be inside `shown_content`; this is
  now a standing rule, not a phase.** → **REQ-LC40, REQ-LC41.**
- *Authority:* mandate #5 + `240_shown_content_integrity.sql`'s existing "any money displayed must
  literally appear in the frozen text" rule, generalised. **Status: the client half is BUILT**
  (commit `1744c17`); the server half is not (DEF-3 / REQ-LC42).

---

**C-LC1 — "The extra is a chat channel" vs the sealed Stage 3.** *(found while writing this spec)*
- *Contradiction:* `discussion.ts:145-153` records a 2026-07-24 decision that the conversation stays
  open after approval and explicitly says it "SUPERSEDES R5b AC4". The server never learned:
  `308:94` rejects any reply once the request is answered. D1 also seals Stage 3.
- **Ruling:** **the thread closes on the answer.** `canReply === (coStatus === 'sent')`. → REQ-LC23.
- *Authority:* D1 (2026-07-28, later than the note) · R5b AC4 · `308:94`, which is the side that
  decides whether a message actually exists. A client-only widening of a two-sided contract is not a
  decision, it is a bug (DEF-4).

**C-LC2 — "Contractor's own sign-off" appears in one doc and nowhere else.** *(found while writing)*
- *Contradiction:* `FLOW-SIMPLEST-JOBSITE:24` puts a **contractor's own sign-off** on the review-and-
  send card and `:51` makes it a build step. Nothing else in the doc set, the PRD, the mandates or
  the schema mentions a second signer. D4 says single required approver; mandate #2's approval is the
  *counterparty's* act.
- **Ruling: NOT a requirement of this spec — it is an unadjudicated proposal, and it is flagged
  rather than silently adopted or silently dropped.** If it is wanted, the only shape consistent with
  D2/D4 is an **attestation line inside `shown_content`** ("Issued by Dave Kowalski, 2026-07-28"),
  which is a term of the document, **not** a second `approval` row and not a second signature that
  the approval binds to. Adding a second approval row would break "approval binds exactly one
  version, one approver".
- *Authority:* `FLOW-SIMPLEST-JOBSITE` is **unregistered** in `PRD-RECONCILIATION §2` and post-dates
  it, so it has no adjudicated standing (fixed in §8 — it is now registered, with this carve-out
  named). Needs hadar.

**C-LC3 — The EWA's "Settled" status.** *(found while writing)*
- *Contradiction:* `R3 AC2` says "the EWA status = 'Settled'", which reads as a sixth stored status.
- **Ruling: no contradiction survives — it is already correctly derived** (`ewa.ts:243`,
  `303:338`) and never stored. Recorded here so the next reader does not re-open it. → REQ-LC6.

---

## 7. Defect register

*Each entry was re-verified against the working tree on 2026-07-28 before being written down.
Two of the eight did not survive verification as briefed; saying so is the point of this section.*

| ID | Verified | Defect | The fix it requires |
|---|---|---|---|
| **DEF-1** | **CONFIRMED** | Approval has no status precondition. `applyLocalApproval` (`changeorder.ts:762`) is a bare `UPDATE change_order SET status=? WHERE id=?` and `signApproval` (`signing.ts:106`) is a bare `.update({status}).eq('id',…)`. Both will walk a `superseded` or `declined` row to `approved`. Only `230:112` guards it (`AND status IN ('draft','sent')`). Both are reachable from `App.tsx:3341-3363`. | Add the same precondition to both: device `… WHERE id = ? AND status IN ('draft','sent')`, returning `rowsAffected` so the caller cannot report a transition that did not happen (REQ-LC8); server `.in('status',['draft','sent'])` on the update, and refuse to insert the `approval` row when the status update moved nothing. → **REQ-LC7 T2/T3, REQ-LC30.** |
| **DEF-2** | **NOT REPRODUCED — stale** | Briefed as "the four flow fields never enter the frozen `shown_content`; phase 2 of `375` was never done". Phase 2 **was** done: `confirmations.ts:60-104` renders all four as owner-facing sentences and `App.tsx:1012-1013` passes them at send (commit `1744c17`, "The instrument carries the flow terms"). `confirmations.test.ts` covers each line and each omission. | None on the client. The rule is now standing law (**REQ-LC40/41**) rather than a phase, and the *server-side* half of the same concern is real and tracked as DEF-3. |
| **DEF-3** | **CONFIRMED** | Freeze-trigger asymmetry. The SQLite trigger freezes seven columns (`changeorder.ts:150-160`); `change_order_guard` (`030:108-117`) freezes three. A sent CO's `billing_timing`, `schedule_effect`, `schedule_days` and `exclusions` are mutable server-side — the exact terms DEF-2 was about. | A new migration (next number) that takes ownership of `change_order_guard` and widens it to the same seven columns, with a comment in `030` pointing at the new owner — the established one-object-one-file move (`030`→`230` for `approval_signature_binding`, `250`→`367` for `confirmation_state`). Plus the agreement check in **REQ-LC42** so it cannot drift again. |
| **DEF-4** | **CONFIRMED** | Reply-after-answer is a **silent delivery failure**. `discussion.ts:153` sets `canReply` for `sent\|approved\|declined`; the server trigger `confirmation_reply_thread_open` (`308:94`) rejects with `23514`; `23514` is in `R5B_PERMANENT` (`discussionstore.ts:316`), so the reply is parked forever while the UI shows it as sent. | One line: `canReply: o.coStatus === 'sent'`. The closed-thread copy already exists in both languages (`i18n.ts:705`, `:1576`) and `threadscreen.tsx:252` already renders it. → **REQ-LC23.** Do **not** "fix" it by widening the server; see C-LC1. |
| **DEF-5** | **CONFIRMED** | Owners on an EWA link never see the discussion thread: `confirm.html:330` returns from the EWA branch before the `confirmation_thread` fetch at `:337`. The `already_answered` branch (`:267-297`) returns without it too. | Hoist the `confirmation_thread` fetch **above** the `kind === 'ewa'` dispatch and above the `already_answered` branch, so `data.__thread` is populated on every path that renders a document; pass it to `renderEwa` and render it under the answered snapshot. → **REQ-LC33** (both parties, same record). |
| **DEF-6** | **CONFIRMED** | `apps/web/ewa.js` is never uploaded — `scripts/deploy-web.sh` substitutes and uploads `confirm.html` only. If it is absent on the host, every EWA link fails closed at `confirm.html:312` ("This authorization could not load"). | Upload `ewa.js` in the same script, with the same `x-upsert` and cache headers. Failing closed is correct and must stay; a page that cannot render the proceed term must never render a signable document. |
| **DEF-7** | **CONFIRMED** | `Viewed` is a specified status (`PRD:70,591`) with no writer and no derivation, while R8's 24h auto-reminder AC (`:604`) is gated on it. The raw evidence exists in `confirmation_open` (`366:34`). | Implement `openSignal` (**REQ-LC3**) and gate the reminder on it (**REQ-LC25**). Strike Viewed from the *status* vocabulary in the PRD's data model line. |
| **DEF-8** | **CONFIRMED** | `change_order` records no `sent_at`/`approved_at`; the extra does not record when it changed state, which is why `record.ts` prints "time not recorded" and why R8's 24h clock has nothing to measure from. | Device columns written write-once by the same guarded UPDATE that moves the status; server-side derived from `confirmation_request.created_at` / `confirmation_response.responded_at` rather than stored. → **REQ-LC4.** (`303`'s `extra_work_authorization.approved_at` is the existing precedent for "the moment it changed is not derivable from the status".) |

---

## 8. Owed edits and open questions

**Doc edits this spec makes:** `PRD-RECONCILIATION §2` (registers this spec as the lifecycle owner
and registers `FLOW-SIMPLEST-JOBSITE`), `CLAUDE.md §6` (file map row).

**Doc edits this spec does NOT make, and someone must:**
1. `SPEC-capture-core-v1 §7.1` (line ~220) and `ARCHITECTURE.md` (lines 76, 192, 227, 264, 272) still
   describe SMS-OTP as *the* binding signature. C4 was resolved on 2026-07-21 and neither was edited.
2. `PRD-change-approval-loop:591` should read "one-tap **reminder**", not "reminder resend" (C6).
3. `PRD-change-approval-loop:70` should drop `Viewed` from the status list and name it a signal (C2).

**Open, needs hadar — not decided here:**
- **The contractor's own sign-off** (C-LC2). In or out of v1, and if in, as an attestation line inside
  `shown_content` (the only shape consistent with D2/D4) or something else.
- **The other seven of the twelve contradictions.** They were counted but not enumerated in anything
  this session could read. Naming them is a prerequisite to closing them.
