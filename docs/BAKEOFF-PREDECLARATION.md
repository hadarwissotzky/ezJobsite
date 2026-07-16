# Sync Bakeoff — PREDECLARATION (written BEFORE the run)

> ## ⚠️ CORRECTION 2026-07-16 — this file's own tamper-evidence claim was FALSE for run 1
>
> `CRITIC-REVIEW-09-CODEX.md` (CRITICAL, "it was not tamper-evident") is **adopted**. The
> claim below — *"Git history is the tamper-evidence"* — **was untrue when run 1 executed**:
> this file was **untracked**, so no git history for it existed. Filesystem mtimes ordered
> correctly (predeclaration 11:49 → q1 results 13:16 → write-up 13:22) but mtimes are
> forgeable. **Run 1's "frozen before the run" claim was therefore backed by nothing verifiable.**
>
> **Fix applied:** this file and the harness are **committed to git BEFORE run 2 executes**.
> For run 2, and only run 2, the freeze claim is real and checkable via `git log`.
>
> **No parameter below has been changed.** N is still 20; field ownership, convergence rules,
> workload assumptions, and void-trial rules are byte-identical to what run 1 used. Retuning a
> parameter after a result would be the exact offence this file exists to prevent. This
> correction records a false claim about the file's *evidentiary status*; it does not touch the
> *content* that status applies to.

> **Why this file exists.** `SPIKE-SYNC-BAKEOFF.md:99` makes these a build deliverable: *"**A predeclared trial count for Q1** and **predeclared field-ownership/convergence rules for Q2** — written down *before* the run, so an outcome can't be rationalized after the fact."* Q6 likewise (`:85`): *"**Fix the workload assumptions + required features FIRST**."*
>
> **Frozen 2026-07-16, before any harness executed.** Nothing below may be edited after a run produces a number. If a value here turns out to be wrong, the correct move is to record that in `BAKEOFF-RESULT.md` as a finding — **not** to silently retune this file. Git history is the tamper-evidence.

---

## 0. Environment reality at predeclaration time (recorded, not aspirational)

| Fact | State | Consequence |
|---|---|---|
| Supabase project | Live, Postgres **17.6**, `wal_level=logical` | Q1 runnable |
| `powersync` publication | **Already exists**, `puballtables=true` | No dashboard step needed |
| PowerSync Cloud instance | Live (`/probes/liveness` → 200), name **Development**, id in `powersync/cli.yaml` | Deploy target authorized by hadar 2026-07-16 |
| DB reachability | Pooler **session mode** (`:5432`, user `postgres.<ref>`) only; direct host `db.<ref>.supabase.co` **has no DNS** | See §5 — session mode is *required* for Q1 |
| Physical iOS device | iPhone 13 mini on **iOS 26.3.1**; installed Xcode **16.4** = iOS **18.5** SDK → **cannot deploy** | **Q3/Q5 physical coverage NOT MET** |
| Physical Android device | **No Android SDK installed** (`$ANDROID_HOME` points at a deleted dir) | **Q3/Q5 physical coverage NOT MET** |
| Decision (hadar, 2026-07-16) | Run **Q1/Q2 now on emulator**; **defer all of Q3** to a dedicated device session | Q3 is recorded **UNRUN**, never as a weak pass |

---

## 1. Q1 — predeclared trial count and, more importantly, what Q1 is *for*

### 1.1 Trial count: **N = 20** independent trials, each with unique capture IDs.

**Pass requires 20/20 late-A deliveries. A single miss is a FAIL.**

### 1.2 ⚠️ Q1 is a MECHANISM determination, NOT a failure-rate bound — declared in advance

This is the trap `CRITIC-REVIEW-06-CODEX.md` H10 named ("the statistical gate has no acceptable target — 0/50 ≈ <6% is catastrophic; ~30,000 zero-failure trials needed for <10⁻⁴ at 95%"). **We are deliberately not attempting a rate bound here, and N=20 must never be reported as one.**

- 20/20 successes bounds the failure rate at only **≈ <14% at 95% confidence** (rule of three: 3/20). That is a *worthless* durability guarantee and is **not** what Q1 claims.
- Q1 is justified at N=20 because **the fault it reproduces is deterministic in our hand-built design, not stochastic**: a seq-ordered cursor *always* misses a lower-seq row that commits after the cursor advanced past it. A mechanism that is immune produces 20/20; a mechanism that is vulnerable fails within the first few trials.
- Therefore: **Q1 answers "is PowerSync's ordering mechanism structurally immune to seq-inversion?" — it does NOT answer "what is PowerSync's capture-loss rate?"** Any rate claim requires the ~30k-trial harness, which is out of scope for a build-vs-buy spike and belongs to Spike A's failpoint matrix.
- **The `seq bigint DEFAULT nextval(…)` negative control is what makes N=20 meaningful**: it proves the inversion genuinely occurred in each trial (seq 10 committing after seq 11). Without an observed inversion, a trial is **void, not a pass**, and is re-run.

### 1.3 Predeclared: which legitimate pass is which

Per `SPIKE-SYNC-BAKEOFF.md:50-52`, the two passes must never be conflated. Declared **before** the run:

- **(a) "late row delivered"** — requires proof that the device reached a **completed durable download checkpoint containing B** *while A was still open*, and that late A then arrived at **that same device** with no reset/reinstall/DB-clear.
- **(b) "unsafe checkpoint prevented"** — requires proof that PowerSync **refused to advance the checkpoint** while A was open, that B was genuinely committed, and that replication had adequate opportunity. After releasing A, **both** rows must arrive.

**Expected outcome, declared in advance so it can be falsified:** PowerSync replicates from the Postgres commit log (LSN). An open transaction holds back the confirmed flush LSN, so we **predict (b) "unsafe checkpoint prevented"** — the device will *not* checkpoint past B while A is open. If we instead observe (a), that is a surprise worth investigating, not a better result.

**Declared consequence of (b), because it is not free:** under (b), a sustained long-running writer transaction **stalls sync for every client**. That is a real operational cost and must be recorded in the result, not buried. It is also a known Postgres logical-replication property, not a PowerSync defect.

### 1.4 Void-trial rules (declared in advance)

A trial is **void and re-run** (not counted as pass or fail) if any of:
- `pg_stat_activity` does not show session A open and waiting on the advisory lock before B commits.
- The third-connection visibility check does not show B visible and A invisible.
- The device never reaches a completed checkpoint AND PowerSync does not demonstrably withhold it (i.e. the run is inconclusive rather than either legitimate pass).
- The `seq` negative control does not show the inversion (seq 10 committed after seq 11).

---

## 2. Q2 — predeclared field ownership and convergence rules

Fields under test (from `SPIKE-SYNC-BAKEOFF.md:53` and `SPEC-capture-core-v1.md:247`).

| Field | Owner (declared) | Client may write? | Declared convergence rule |
|---|---|---|---|
| `capture.processing_state` | **SERVER** (`captured/queued/uploaded/processed`) | **No** | Server value is authoritative and always wins. A client write **must not reach Postgres** — it must be rejected at the DB boundary (not merely ignored by convention). Device converges to the server value even if it had a pending local write. |
| `capture.resolution_status` | **CLIENT** (`resolved/unresolved/overridden`) | **Yes** | Last-writer-wins **by upload order**. A pending offline local edit **must be preserved** and pushed on reconnect, and it **overwrites** a conflicting server edit made while the device was offline. |
| `project.status` | **SERVER** (`active/archived`) | **No** | Same as `processing_state`. Also drives the Q7 windowing test. |

### 2.1 Predeclared expected outcome for the conflict test

Sequence: device goes offline → device edits `resolution_status` → server commits a **conflicting** edit to the same row's `resolution_status` → device reconnects.

**Declared expectation:** the device's pending edit **wins** and lands in Postgres; the server's edit is overwritten. Both devices converge to the device-1 value.

**Declared failure conditions (any one = Q2 FAIL):**
- The pending local edit is **clobbered** by the incoming server value before it is uploaded (silent loss of a user edit — the exact class of bug this spike exists to find).
- A client write to `processing_state` or `project.status` **succeeds** in reaching Postgres.
- The two devices do not converge to the same value.
- The final Postgres value matches neither the declared rule nor any coherent rule.

### 2.2 Declared in advance: this is LWW, and LWW is a *choice with a cost*

`resolution_status` LWW means a simultaneous edit by two crew members silently discards one. That is acceptable **for this throwaway spike's field set** but is **not** a general endorsement — semantic conflict resolution is explicitly ours to own either way (`SPIKE-SYNC-BAKEOFF.md:18`: PowerSync "explicitly leaves **semantic conflict resolution + backend idempotency to the app**"). Recording this so a Q2 pass is not later misread as "PowerSync solved conflicts for us."

---

## 3. Q6 — predeclared workload assumptions and required features

### 3.1 ⚠️ The workload basis is CONTESTED — declared up front

`CRITIC-REVIEW-04-CODEX.md:55` already rejected the cost model these anchors come from: *"the claimed 60–70% blended margin is **not reproducible from the plan** → no customer-tier mix, minute allowances, capture distribution, media retention curve … is specified."* The numbers below are therefore **declared spike-local assumptions**, not validated facts. **Q6's output is a cost comparison *conditional on these assumptions*, and must say so.**

### 3.2 Declared workload

| Parameter | Declared value | Source / status |
|---|---|---|
| Fleet at target | **1,000 companies / 10,000 users** | `PRICING-STRATEGY.md:103` — contested |
| Assumed DAU fraction | **30% → 3,000 daily-active devices** | **Spike-local assumption. No doc basis.** |
| Busy user capture rate | **200 decisions/mo ≈ 10/working-day** | `PRICING-STRATEGY.md:46` — contested |
| Median user capture rate | **~30 decisions/mo ≈ 1.5/working-day** | `PRICING-STRATEGY.md:46` (Free tier) — contested |
| Capture unit | **~2-min voice capture** → transcribed/structured | `PRICING-STRATEGY.md:34` |
| Retained media per capture | **a few MB** (raw video not retained) | `ARCHITECTURE.md:67` |
| Vertical cap | **~15 decisions/project** | `PRICING-STRATEGY.md:86` |
| Windowing **N** | **N = 30 days** | ⚠️ **Spike-local. `N` is NEVER DEFINED anywhere in the docs** — every occurrence is the literal string "last-N-days". Picked so Q7 is runnable at all. |
| Rows synced per device | Windowed: Active projects + last-30-days of captures/op-state | Derived from `ARCHITECTURE.md:69` |
| Media path | **NOT through PowerSync** — Supabase Storage via `RemoteStorageAdapter` | PowerSync attachments table is local-only |

### 3.3 Declared required features (the "required features FIRST" half of the bar)

A PowerSync offering must provide **all** of these to count as fitting:
1. Commit-ordered delivery immune to seq-inversion (Q1).
2. Bidirectional mutable-field sync with a defined convergence rule (Q2).
3. Format-agnostic attachment bytes — client-encrypted ciphertext accepted unchanged (Q3).
4. Windowing equivalent to "Active projects + last-N-days" expressible in sync config (Q7).
5. Revocation that purges local data and blocks queued writes (Q7).
6. RN/Expo support on iOS **and** Android, release builds (Q5).
7. Self-host escape hatch under an acceptable licence (Q6).

### 3.4 Declared cost oracle

Compare **PowerSync Cloud** vs **self-hosted** on all-in cost at the §3.2 workload:
- Cloud: published pricing × declared workload (sync ops, data volume, concurrent connections).
- Self-hosted: infra + Postgres storage DB + HA/backup/monitoring + upgrade burden + **operator time priced at a stated hourly rate**.
- Licence rights for the open-source core must be quoted verbatim, not summarised.

**Declared decision threshold:** Q6 is a **dealbreaker** only if Cloud at the declared workload exceeds the per-user cost envelope implied by `PRICING-STRATEGY.md:46` (a busy Core solo must stay in the ~$3–6/mo all-in cost band against a $19–24 price) **and** self-hosting is not a viable escape. Anything else is a cost input to the decision, not a veto.

---

## 4. Q3/Q5 — declared status: **UNRUN, not failed**

Per hadar's decision (2026-07-16), Q3 is deferred to a device session. **Q3 and Q5 will be recorded as `UNRUN — BLOCKED (no physical device)`.** They must not be reported as passes, fails, or partials.

**Declared in advance, from documentation review only (no test run):**
- PowerSync's attachment helper exposes `uploadFile(fileData: ArrayBuffer, attachment: AttachmentRecord)` — **the whole buffer in one call. There is no TUS, no chunking, no resume-from-offset anywhere in the helper.** A killed upload retries the entire file from byte zero on the next sync interval.
- Therefore **the Q3 resumability bar as written in `SPIKE-SYNC-BAKEOFF.md:71-72` cannot be satisfied by PowerSync** — it presupposes TUS the helper does not implement. Declared test plan (hadar, 2026-07-16): **test stock behaviour first** (expected: restart at byte zero), record that as the honest finding, **then** implement TUS inside our own `RemoteStorageAdapter` and measure what it costs us to own.
- **Declared in advance so it cannot be spun later:** if our own TUS makes the resume assertion pass, that is **a pass for our code, not for PowerSync**. PowerSync contributes nothing to media resumability.

---

## 5. Declared harness constraints

- **Q1 must run over the pooler in SESSION mode (`:5432`)**, never transaction mode (`:6543`). Transaction-mode pooling multiplexes connections and would break both session advisory locks and the `pg_stat_activity` assertions — silently producing a meaningless result. This is a false-pass vector in its own right.
- The Q1 control session, session A, session B, and the third verification connection must be **four distinct backends**, asserted by distinct `pg_backend_pid()`.
- `pg_advisory_xact_lock(K)` in session A must be issued **asynchronously** so A remains open and blocked pre-COMMIT.

---

## 6. What this predeclaration does NOT cover (open gaps, recorded honestly)

These are mandated by the bakeoff but have **no basis in the docs to predeclare against**:

1. **`REQ-MEMBER-5` is cited 4× and defined 0×.** `IMPLEMENTATION_NOTES.md:50` claims it was written into `PM-LAYER.md`; it was not. Q7's revocation bar references a requirement that does not exist. Q7 will test against the closest written statement (`DURABILITY-DESIGN-v1.md:149`: purge revoked scope locally; suspend-don't-push queued writes) and record the gap.
2. **`REQ-PM windowing` does not exist as a requirement.** Windowing is `ARCHITECTURE.md`-only, and `N` is unbound. Q7 uses spike-local N=30.
3. **Option B is selected, not designed** (`IMPLEMENTATION_NOTES.md:199`): no AEAD choice, no nonce scheme, and **no defined location for the wrapped DEK**. Q3's "production unwrap path" bar therefore has no production path to exercise. Q3's design must be settled before Q3 can run — this is a Q3 blocker independent of the device problem.
4. **`DURABILITY-DESIGN-v1` Artifact 1 step 6 is marked NOT ATOMIC — OPEN GAP** by the doc itself. Q4 exercises exactly that step. Q4 therefore tests a design its own author marked unfinished; Q4's result must be read as "does PowerSync's local write model make this harder or easier", not "is our commit protocol correct".
