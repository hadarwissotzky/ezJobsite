# Sync Bakeoff — RESULT (revision 2, 2026-07-16)

> **Revision 2 supersedes revision 1, which `docs/CRITIC-REVIEW-09-CODEX.md` REJECTED.** #9's verdict on rev 1 was: *"This is not fabricated evidence, but it is a false-pass write-up."* Both claimed passes were withdrawn, the harness was fixed, and Q1/Q2 were **re-run**. Every #9 finding is reconciled in §7.
>
> **Parameters:** `docs/BAKEOFF-PREDECLARATION.md`, **committed to git at 2026-07-16 14:00:19, before run 2 executed** (commit `aedc79d`). For run 1 this freeze claim was false — the file was untracked. Now it is checkable via `git log`. **No parameter was changed between runs.**
>
> **This does NOT flip ADR-2** and does not edit `ARCHITECTURE.md`. Per `SPIKE-SYNC-BAKEOFF.md:118`, **a Codex pass on THIS revision is required before ADR-2 moves.** Rev 1 shows why that gate is not a formality.
>
> **Raw artefacts:** `spike/out/q1.json` · `spike/out/q2.json` (both `"revision": 2`).

## Scoreboard

| Q | Question | Result |
|---|---|---|
| **Q1** | Commit-ordering (blocker #1: silent capture loss) | **VALID PASS** — 20/20, mechanism **(a) "late row delivered"** |
| **Q2** | Mutable operational state (blocker #3) | **VALID PASS** — 60/60 checks, **both** upload orderings, 5 trials each |
| **Q3** | Encrypted media attachments (**the fit risk**) | **UNRUN — BLOCKED** (no usable physical device; Option B undesigned) |
| **Q4** | Local-commit composition | **NOT RUN — blocked by an unfinished candidate protocol** |
| **Q5** | RN/Expo + alpha maturity | **PARTIAL** — 4 negatives, release matrix UNRUN |
| **Q6** | Cost + licensing + self-host | **PARTIAL** — one cost risk eliminated, full oracle UNRUN |
| **Q7** | Consistency + windowing | **PARTIAL** — windowing verified; **revocation UNRUN**; half the rule inexpressible |

**Go/No-Go per `:103`: NOT DECIDABLE.** Adoption requires Q1+Q2+Q3. **Q3 — which the plan itself calls *"the most likely place PowerSync doesn't fit — test it first"* — has not been run.** Two of three is not a verdict.

---

## Q1 — Commit-ordering · **VALID PASS** · mechanism **(a) "late row delivered"**

**20/20 passed, 0 failed, 0 void** (`spike/out/q1.json`). Rev 1 reported the same headline on assertions that **could not fail**; these can.

### The assertion trail — every number below is from `q1.json` revision 2

| Step | Assertion | Evidence (trial 1; all 20 in the artefact) |
|---|---|---|
| 1 | Fully synced, **empty scope** | `hasSynced: true`, `dbInitOk: true`, `local_captures: 0` — server rows purged and device purge confirmed **before each trial** |
| 5 | Four **distinct** backends | 4 distinct `pg_backend_pid()` — session mode, no pooler multiplexing |
| 3–4 | A open, blocked **pre-COMMIT** | `pg_stat_activity` → `['active','Lock','advisory']` |
| 3 | **The inversion is real** | `seq_a=44 < seq_b=45`; every trial 44<45 … 82<83 |
| 6 | Third connection: **B visible, A not** | only B returned |
| 7 | Checkpoint **advanced** for B (asserted, not recorded) | `last_op_total` **155 → 156** while A open |
| 7 | **A PROVEN NEW PROCESS** after restart | `old_boot mrnzsm91… → new_boot mrnzu0w7…`, `db_init_ok_in_new_process: true`. **All 20 trials proven.** |
| 7 | B present / A absent **re-queried from the new process** | `persisted_after_restart: true`, `checkpoint_survived_restart: true` |
| 8 | A committed **after** the device observation | advisory-lock causality; A cannot commit until the harness releases K |
| 9 | **Content verified independently** | `payload_exact_match` + `recomputed_sha_matches` (harness re-hashes the device's own payload) + `stored_hash_matches_own_payload`, for **both A and B** |
| 9 | Both rows in Postgres · PowerSync idle · checkpoint advanced for A | `156 → 157` |
| 10 | Fresh-client **control** | second device received A and B, content verified — **recorded as an artefact**, labelled *"eligibility control ONLY — cannot substitute for the checkpointed device"* |

**Timing is not marginal.** B reached the device in **0.13–0.98s** against the 25s opportunity window — a **~25x margin**. The (a)-vs-(b) classification is not a knife-edge artefact of the window.

### ⚠️ The predeclared prediction was WRONG — recorded, not buried

`BAKEOFF-PREDECLARATION.md §1.3` predicted mechanism **(b) "unsafe checkpoint prevented"**. Observed **(a)** in 20/20. **The prediction is falsified.** #9 is right that a wrong prediction is a signal about how well the author understood the system, not a neutral event — see §7.

### What Q1 establishes — stated narrowly (this is where rev 1 overclaimed)

`last_op_total` moved **155 → 156 → 157**. B (committed first, higher `seq`) got the earlier op; late A (lower `seq`, committing after the device had durably stored a checkpoint containing B) got the **later** op and arrived intact.

For **ordinary single-row transactions**, Postgres logical decoding emits changes in **commit order**, so a late commit lands at a later stream position and there is no cursor for it to fall behind.

**Rev 1 called this "structurally impossible". That claim is WITHDRAWN.** #9 is correct that *"a transaction's changes aren't decoded until it commits"* is **false** under streaming of large in-progress transactions (`logical_decoding_work_mem`), and that these were **never exercised**: in-progress streaming · two-phase decoding (`PREPARE TRANSACTION`) · parallel apply · **PowerSync's op-assignment atomicity** (Postgres commit order does not itself prove PowerSync assigns and durably stores op IDs in that order) · bucket compaction (MOVE/CLEAR make "one row got the next op ID" an unsafe general model) · initial-snapshot/CDC transition · service crash · slot restart.

**The honest claim: one-row ordinary transactions were delivered in commit order across 20 trials, under a stalled-commit inversion, on this configuration.** That is what the evidence supports and no more.

### Honest bounds (predeclared §1.2)

- **A MECHANISM determination, NOT a rate bound.** 20/20 bounds the failure rate only at **<14% @95%** — worthless as a durability guarantee. N=20 is justified *only* because the fault is deterministic in our hand-built design. Any rate claim (`<1e-4 @95%`, ~30k trials) belongs to Spike A's failpoint matrix.
- **#9 fairly asks whether that disclaimer is a shield.** It is a real limit, not a rhetorical hedge — which is why the paragraph above withdraws "structurally impossible" rather than leaning on the disclaimer to keep it.

---

## Q2 — Mutable operational state · **VALID PASS** · 60/60

**Both orderings, 5 trials each.** Ownership + convergence rules predeclared (`§2`) and committed before the run.

### Ordering A — server edits while the device is offline holding a pending edit

| Assertion | Evidence |
|---|---|
| Local edit **queued**, not lost | `pendingCrud = 1` |
| Server edit genuinely **conflicting** | PG → `resolution_status='overridden'` while device held `'resolved'` unsynced |
| **Pending local edit WON** | `pg_final.resolution_status = 'resolved'` |
| **Not clobbered** by the incoming server value | device1 → `'resolved'` |
| Both devices converged | 5/5 trials |

**What this ordering actually proves** (#9, adopted): PG ending on the client value is **expected** — it was the last write to *arrive*. The load-bearing result is that **the offline CRUD entry survived a reconnect and uploaded**, and was not clobbered by the conflicting download.

### Ordering B — device uploads first, server edits after (NEW in rev 2)

`pg_final = 'overridden'` in 5/5, matching the predeclared LWW rule from the other direction, with both devices converged. Rev 1 ran **only** ordering A, which #9 correctly called *"a single favorable upload ordering."*

### Server-owned field — the client write is refused

| Assertion | Evidence |
|---|---|
| A **NEW rejection naming THIS row and THIS field** | `{rowId: "q2-2276bf3b", fields: ["processing_state","updated_at"], code: "42501", at: "…21:05:14.173Z"}` — **beyond a baseline of 2**. Rev 1 accepted *any* 42501 from the app's lifetime. |
| Write **never reached PG** | `processing_state` `captured` → `captured` |
| **Device converged BACK to the server value** | device1 + device2 → `captured` |

That last row is the assertion **rev 1 claimed as a measured "silent revert" but never tested** (#9 HIGH). It now passes — but as a *tested* claim.

### What a Q2 pass does NOT mean

- **The 42501 proves the DATABASE refused the write** — the error came back from PostgREST, not from us. **But the discard policy is OURS.** PowerSync explicitly leaves asynchronous validation and discard policy to the application. This is not "PowerSync supplies safe rejection handling."
- **A client write to a server-owned field is applied locally, then silently reverted.** The user sees the edit land and vanish. PowerSync offers no "your write was rejected" hook. Under a mandate of honest UI, **that is a UX defect we must design around.**
- **LWW is our choice with a real cost:** two crew members editing at once means one edit is silently discarded. Semantic conflict resolution stays ours.
- **The two devices are separate stores but the same Supabase user** — the "one contractor, two devices" case, **not two independent actors**.

---

## Q3 — Encrypted media · **UNRUN — BLOCKED**

Not run. iPhone 13 mini is on **iOS 26.3.1** while installed **Xcode 16.4** ships the **iOS 18.5 SDK**; Android has **no SDK installed**. Deferred to a device session (hadar, 2026-07-16) rather than run weakly. **Recorded as UNRUN — not a pass, fail, or partial.**

### The structural finding — restated correctly (rev 1 overstated this)

The adapter interface is `uploadFile(fileData: ArrayBuffer, attachment)`: the **whole buffer, one call**. No TUS, no chunking, no offset, no session URL. A killed upload restarts at byte zero.

**Rev 1 called the Q3 resume bar "unmeetable by PowerSync". That is WITHDRAWN — #9 is right that it is false.** A custom adapter *can* look up a persisted TUS session by attachment id, query the server offset, upload `fileData.slice(offset)` in chunks, persist the new offset, and return early if already finalized. `RemoteStorageAdapter` is explicitly application-defined.

**The honest claim: PowerSync has no built-in resumable uploader; resumability requires custom adapter code and remains untested.** It is meetable *within* the interface — PowerSync simply isn't buying us the capability. Inferring infeasibility from API shape was the error.

Also untested and newly noted: the whole-file `ArrayBuffer` is a **mobile memory risk** for multi-minute media.

**Two blockers independent of hardware:**
- **Option B is selected, not designed** (`IMPLEMENTATION_NOTES.md:199`): no AEAD choice, no nonce scheme, **no defined home for the wrapped DEK**. Q3's bar demands Device 2 invoke *"the production unwrap path"* — **there is none to invoke.** Q3 cannot honestly run until Option B is designed.
- **The attachments table is local-only and never synced.** Only the data-model FK syncs, so wrapped-key material must ride in *our* synced row — an unwritten design constraint PowerSync imposes on Option B.

---

## Q4 — Local-commit composition · **NOT RUN — blocked by an unfinished protocol**

Rev 1 said "untestable". **#9 is right that this is too strong, and that the distinction matters:** Q4 is **unimplemented / blocked by an unfinished candidate protocol** — *which is exactly the design risk Q4 existed to expose.* The blocker is the finding.

`DURABILITY-DESIGN-v1.md:74-80` marks **Artifact 1 step 6 `NOT ATOMIC — OPEN GAP`** in its own text: *"the filesystem and SQLite **cannot share a transaction** … Two crash states are unhandled … **A single ordered commit protocol + a complete recovery truth table must be written before this is built.**"*

Concrete observation from building the spike: PowerSync's `saveFile()` writes the local file **via the localStorage adapter before** creating the attachment record, and `updateHook` runs **in the same transaction** as that record — a real atomicity primitive. But it sequences **file-then-row**, whereas Artifact 1 requires **verify-then-row**. Whether those compose is the open question, now concrete.

---

## Q5 — RN/Expo + alpha maturity · **PARTIAL**

The tightened bar (release-build matrix on physical iOS **and** Android; background/locked; OS termination; retries; URL expiry) is **UNRUN**. **#9 note adopted: two of the findings below are documentation review, the auto-detect crash has no preserved runtime log, and the only preserved build log is the unrelated path-with-spaces failure.** Treat 1–2 as doc review and 3–4 as reproducible-but-unlogged.

1. **`@powersync/attachments` is DEPRECATED** — attachments moved into `@powersync/react-native`. The bakeoff's premise (`:21`) named the old package. *(doc review)*
2. **The built-in replacement is ALPHA** across all platforms per PowerSync's own docs. The bakeoff's "production-ready but evolving" (`:21`) is **more generous than the vendor's wording**. Treat `:21` as stale. *(doc review)*
3. **`@powersync/op-sqlite` is not auto-detected.** The documented "detects which peer is present" **did not hold** for `op-sqlite@0.9.15` + `react-native@1.35.9`; the bare `{ dbFilename }` form silently fell back to quick-sqlite and **crashed at runtime**. The factory must be passed explicitly. *(observed; no runtime log preserved)*
4. **Expo Go is disqualified for durability work** — `@powersync/adapter-sql-js` has **no SQLite consistency guarantees** ("every write triggers a full rewrite of the entire database file; the app may end up with missing data or a corrupted file if killed mid-write"). Any Q1/Q3/Q4 result from Expo Go is a **false pass by construction**. *(doc review; drove the native-build decision)*

**Toolchain reality (not PowerSync's fault, decision-relevant):** Expo 57 **cannot build on Xcode 16.4** (`package 'apple' is using Swift tools version 6.2.0 but the installed version is 6.1.0`) — pinned to Expo 54 / RN 0.81.5. Expo's `EXConstants` script is **not space-safe** (`No such file or directory: /Volumes/Operational`); every path in this repo has spaces, so **the app had to be moved to `~/bakeoff-app` to build at all**.

---

## Q6 — Cost + licensing · **PARTIAL**

Full oracle **UNRUN**. The declared workload (`§3.2`) rests on anchors `CRITIC-REVIEW-04-CODEX.md:55` already rejected as not reproducible, so a cost number now would be theatre.

**One cost risk eliminated.** Supabase's direct host is **IPv6-only** (`AAAA`, no `A`), and **Supavisor cannot carry logical replication**, so PowerSync **must** reach it over IPv6. If it couldn't, adoption would force the **IPv4 add-on (~$4/mo) + Pro plan (~$25/mo)**. Observed: `powersync validate` → Test Connections ✓, replication streaming, lag 0 bytes.

**#9 caveat adopted:** no `powersync validate` / DNS / slot / pricing / licensing output was preserved as an artefact. Q1 does *indirectly* prove the configured cloud service replicates from the source (20 trials depended on it), but the full Q6 oracle is untested and this finding rests on transcript, not a saved file.

---

## Q7 — Consistency + windowing · **PARTIAL**

### The "Active projects" half — verified

| Transition | Observed |
|---|---|
| `active → archived` (window **exit**) | Local purge: **41 → 1** captures; project removed |
| `archived → active` (**re-entry**) | **Re-delivered: 1 → 41**; both projects restored |

*Correction recorded:* an earlier read called re-entry a **failure**. That was **wrong — the poll window was too short.** Re-delivery works; it is simply slower than exit.

### ⚠️ The "last-N-days" half is NOT EXPRESSIBLE

Sync Streams have **no server-side `now()`/`current_date`**. "Active projects" is a clean CTE; **"last-N-days" cannot be written server-side at all** — it needs a client-supplied parameter (**client can lie**; needs an auth guard) or a server-maintained flag column. Our rule (`ARCHITECTURE.md:69`) is *"Active projects **+ last-N-days**"*. **PowerSync expresses half of it natively.**

### ⚠️ Revocation — **UNRUN**, and the requirement does not exist

Not tested. **`REQ-MEMBER-5` is cited 4× and defined 0×** — `IMPLEMENTATION_NOTES.md:50` claims it was written into `PM-LAYER.md`; **it was not.** The Codex #7 finding it echoes (a revoked client may be unauthorized to pull the very tombstone meant to purge it) remains **open and untested**.

---

## Scope — and what these claims may NOT travel to

One bucket · one project · one Supabase user · two iOS simulators · ~40 rows · good network · **debug build** · iOS only · single-row transactions · no service restarts · no compaction · no concurrent third-party writers.

**#9 finding adopted:** rev 1's limitation paragraph did not actually contain its own conclusions. Concretely, this run says **nothing** about: multi-user or multi-tenant behaviour · revocation · large or streamed transactions · two-phase commit · service/slot restart · bucket compaction · initial-snapshot→CDC transition · upload idempotency under retry · release builds · Android · physical devices · background/locked operation · media of any kind · scale of any kind.

---

## What this result licenses

**Supports adoption:** the two blockers that killed our hand-built design twice — **commit-ordering (Q1)** and **mutable-state sync (Q2)** — held up under the tightened bars, with assertions that can now fail, across a stalled-commit inversion and both upload orderings. Backend integration took hours, and the IPv6 cost risk is gone.

**Argues against / unresolved:** **Q3 is unrun and is the axis the plan named as most likely to fail.** The one hard fact there is negative: **PowerSync provides no built-in resumable uploader**, so media durability stays ours to build. Q5's maturity signals are worse than the plan assumed. Q7 expresses half our windowing rule and revocation is untested. Q4 is blocked by our own unfinished protocol.

**Rev 1 wrote "PowerSync decisively wins the sync-transport argument" and "two blockers dissolved". Both are WITHDRAWN** (#9 CRITICAL: they *"perform the adoption decision rhetorically while disclaiming it procedurally"*). The supportable statement is narrower:

> **Q1 and Q2 met their tightened bars on this configuration. No adoption conclusion follows yet.**

### Required before ADR-2 moves (`SPIKE-SYNC-BAKEOFF.md:118`)
1. **Design Option B**, then **run Q3** on real hardware (needs Xcode 26.x **or** an Android SDK + device).
2. **Run a Codex pass on THIS revision.** Non-optional — rev 1 is the proof.
3. Then, and only then, decide ADR-2.

---

## §7 — Reconciliation of `CRITIC-REVIEW-09-CODEX.md`

☑ = the edit/fix exists. **All findings ADOPTED; none disputed.**

| # | Finding | Disposition |
|---|---|---|
| CRITICAL | Q1 restart assertion could false-pass | ☑ **Fixed** — `bootId` + `dbInitOk` from a proven new process; all 20 trials verified |
| CRITICAL | Predeclaration not tamper-evident | ☑ **Fixed** — committed `aedc79d` **before** run 2; correction block added; **no parameter changed** |
| CRITICAL | "not decidable" + "decisively wins" incoherent | ☑ **Fixed** — both statements removed |
| HIGH | Assertion trail used an unlisted smoke run | ☑ **Confirmed by author before publishing #9.** Rev 1 cited `q1.json` while quoting `q1-smoke.json` numbers. All figures here are from rev-2 `q1.json`; `q1-smoke.json` is git-ignored |
| HIGH | Exact-payload assertion absent (circular hash compare) | ☑ **Fixed** — device returns `payload`; harness recomputes SHA-256 for A and B |
| HIGH | `last_op` mislabeled; advancement not asserted; split reads | ☑ **Fixed** — asserted, single read transaction, honestly relabelled |
| HIGH | PG explanation half-right; "structurally impossible" overstated | ☑ **Adopted** — claim withdrawn and narrowed; untested conditions enumerated |
| HIGH | N=20 disclaimer used as a shield | ☑ **Adopted** — the overclaim it was shielding is gone |
| HIGH | 42501 attribution not robust | ☑ **Fixed** — baselined; requires a new rejection matching rowId + field + timestamp |
| HIGH | Server-owned convergence assertion missing | ☑ **Fixed** — now asserted and passing; the "silent revert" is tested, not claimed |
| HIGH | Conflict test was one favorable ordering | ☑ **Fixed** — both orderings, 5 trials each |
| HIGH | "Unmeetable by PowerSync" is false | ☑ **Adopted** — withdrawn; restated as "no built-in resumable uploader; requires custom adapter code; untested" |
| HIGH | Secondary evidence upgraded beyond artifacts (Q4/Q5/Q6) | ☑ **Adopted** — Q4 relabelled "blocked by unfinished protocol"; Q5 doc-review vs observed split; Q6 no-artifact caveat |
| HIGH | Bakeoff misses the transport's real failure envelope | ☑ **Adopted** — §Scope now enumerates what the run says nothing about |
| HIGH | Limitation paragraph didn't contain the conclusions | ☑ **Fixed** — §Scope rewritten |
| MEDIUM | 25s window could misclassify mechanism (b) | ☑ **Fixed** — window + actual B latency recorded per trial; 0.13–0.98s vs 25s = ~25x margin |
| MEDIUM | seq control proves the precondition, not the old fault | ☑ **Adopted** — the control proves the *inversion precondition* was reproduced; PowerSync never reads `seq` |
| MEDIUM | Two devices are separate stores, not separate actors | ☑ **Adopted** — stated in Q2 |
| MEDIUM | One Q2 trial insufficient | ☑ **Fixed** — 5 per ordering |
| MEDIUM | Wrong prediction handled correctly but not investigated | ☑ **Partially adopted** — investigated to a mechanism (commit-order decoding) and the resulting overclaim withdrawn. **Remains open:** the author predicted (b) from an incorrect model of flush-LSN behaviour, which is a fair signal about test-design confidence. |

**Harness bug found during rev 2 and recorded rather than hidden:** requiring observation of the transient local `processed` value was **racy** — PowerSync can revert faster than the 500ms poll (trial 1 caught it, trial 2 did not). That observation is now best-effort; the load-bearing assertions (rejection, PG unchanged, convergence) are unaffected. **This was a harness defect, not a PowerSync finding.**

---

## Reproduction

```bash
cd spike
./bin/pg.sh -f sql/001_schema.sql        # + 002 publication, 003 denorm, 004/005 users
powersync deploy --instance-id=6a5917477f33bac37ef768b8   # Development instance ONLY
./.venv/bin/python harness/q1.py --trials 20 --udid <sim1> --udid2 <sim2> --owner-id <uuid>
./.venv/bin/python harness/q2.py --trials 5  --udid1 <sim1> --udid2 <sim2> --owner-id <uuid>
```

**Environment:** Postgres 17.6 · PowerSync service **1.23.3** · `@powersync/react-native` **1.35.9** · `@powersync/op-sqlite` **0.9.15** · Expo **54** / RN **0.81.5** · iOS Simulator 18.6 · slot `powersync_…_9f25` (logical/pgoutput, streaming).

**Gotchas** (also `spike/PROGRESS.md`): the app must live at a **space-free path**; `.env`'s `SUPABASE_DB_USER=postgres` is **wrong** (pooler needs `postgres.<ref>`); never `source .env` (angle-bracket placeholders break zsh); `auth.users` token columns must be `''` not NULL or GoTrue 500s; Q1 requires pooler **session mode (:5432)** — `:6543` would silently invalidate it.
