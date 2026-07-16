# Sync Bakeoff — PowerSync vs. hand-built (the build-vs-buy spike)

> **Why this exists.** We hand-built the offline **sync transport** twice; Codex failed it twice on the same three distributed-systems problems (commit-ordering, mutable-state sync, crash atomicity). This spike answers **one question with evidence, not opinion: do we delegate the sync transport to PowerSync, or hand-build v2 ourselves?** It is time-boxed (target **2–4 focused days**) and throwaway — its only output is a go/no-go with proof. Chosen 2026-07-16 (hadar) over writing DURABILITY-DESIGN-v2 blind.
>
> ### ⚠️ Test-validity tightenings applied 2026-07-16 (Codex #8 — `CRITIC-REVIEW-08-CODEX.md`)
> A narrow cross-model **test-validity** check found **all seven questions (Q1–Q7) could FALSE-PASS as originally written** — the bakeoff targeted the right faults, but its pass criteria weren't operationally strict enough to distinguish "PowerSync fixed it" from "the test proved nothing." **The tightened steps + assertions are inlined per question below. No question was redesigned; only its bar was made falsifiable.**
>
> **The two traps worth internalizing before running anything:**
> 1. **A fresh device cannot substitute for the checkpointed one (Q1).** A client syncing from scratch receives both rows trivially. The late row must arrive at **the same device that already checkpointed past B** — no reset, reinstall, or DB clear.
> 2. **"Decrypt succeeded" is not a Q3 pass.** It can conceal a harness-supplied DEK, a plaintext staging file, or a full restart mislabeled as a resume.
>
> **This is the ezQuotePro "ALL TESTS PASSED" trap, one layer up:** a green bakeoff that green-lights a rewrite on evidence that never existed. A test that cannot fail is not evidence.

## What is NOT in question (kept either way)
- **The on-device capture-commit path is ours** (DURABILITY-DESIGN Artifact 1: reserve → journal → stream → finalize+fsync → verify → local commit → "saved ✓"). This is the ezQuotePro lesson; no sync engine replaces it. *(Note: PowerSync uses its own local SQLite; the bakeoff must confirm our capture-commit state machine composes with — not fights — PowerSync's local write model. See Q4.)*
- **Append-only for evidence** (media, capture-receipts, record versions, approvals) — immutable, tamper-proof (L1–L5). PowerSync would carry these as ordinary rows; immutability is enforced by *our* rules (authz + no-update policies), not by the transport.
- **Media encryption = Option B** (client-side per-capture-key, ciphertext uploaded unchanged).
- **Backend still ours regardless:** authz-in-Postgres-functions (Artifact 5), transactional outbox → jobs (Artifact 6), the failpoint matrix (Artifact 8). PowerSync replaces the *sync pipe*, not the whole backend, and it explicitly leaves **semantic conflict resolution + backend idempotency to the app** — so those stay on our side.

## Current external signal (verify during the spike, don't trust these blind)
- PowerSync attachments helper is **alpha** ("production-ready but evolving"), **format-agnostic** (accepts arbitrary bytes → **client-encrypted ciphertext is supported**), and **RN/Expo-supported** (needs `@powersync/attachments-storage-react-native` + Expo 54+ `expo-file-system`). You implement your own `RemoteStorageAdapter` (we were building the RemoteStorage abstraction anyway) and it uses signed URLs. *(The old "experimental — avoid" note that justified rejecting it in ADR-2 is stale; "alpha" is the real, testable caveat.)*
- PowerSync orders sync by the Postgres **commit log (replication/LSN)**, which is *commit-ordered by construction* — the theoretical answer to blocker #1. **The spike must prove this empirically, not take it on faith.**

---

## The three killer questions (must all pass to adopt)

*These are the exact Codex #7 blockers that failed our hand-built design. If PowerSync doesn't solve them, it buys us nothing.*

- **Q1 — Commit-ordering (blocker #1: silent capture loss).** Reproduce the fault that kills our design: two concurrent writes where the lower-numbered transaction **commits after** the higher one. Does the device still receive the late-committing row, or is it lost past the checkpoint? *Pass: no row is ever permanently missed across the stalled-commit fault.* (PowerSync should pass by LSN ordering — prove it.)

  > #### ⚠️ Q1 AS ORIGINALLY WRITTEN COULD FALSE-PASS — tightened per Codex #8
  > "Two concurrent writes where the lower-numbered txn commits after the higher one" **does not guarantee the device completed a durable checkpoint containing B before A committed** — which is the entire fault. Merely committing B before A and eventually seeing both rows is not a pass.
  >
  > **Note the structural risk:** PowerSync orders by the Postgres commit log (LSN), which is commit-ordered by construction and has **no `nextval()` cursor to invert** — so it is expected to pass *by design*. That makes it doubly important to prove **which mechanism** produced the pass, or Q1 becomes a test that cannot fail being counted as evidence.
  >
  > **The deterministic procedure (all steps required):**
  > 1. Start from a **fully synchronized** device and an empty test scope/bucket.
  > 2. A control Postgres session acquires session advisory lock `K` (`pg_advisory_lock(K)`).
  > 3. **Session A:** `BEGIN` → insert capture A **explicitly obtaining `seq=10`** (the negative control: the test table keeps a `seq bigint DEFAULT nextval(…)` column so the inversion our design died on is *demonstrably reproduced*) → issue `pg_advisory_xact_lock(K)` **asynchronously**; it blocks before `COMMIT`, leaving A open and invisible.
  > 4. **Assert from `pg_stat_activity`** that A is still in its transaction and waiting on the advisory lock.
  > 5. **Session B** independently inserts capture B with `seq=11` and **commits**.
  > 6. **From a third connection, assert** B is visible and A is **not**.
  > 7. **Keep A blocked while the original device synchronizes.** Record PowerSync diagnostics proving a **completed durable download checkpoint containing B** — *not merely that a sync started*. Assert locally: B exists, A does not. **Restart the app without clearing its database** and confirm the state persists.
  > 8. **Only then** release `K` and let A commit. **Assert A's commit occurred after the device observation in step 7.**
  > 9. On **that same already-checkpointed device** — no reset, resnapshot, reinstall, or DB clear — wait for sync and assert: A appears with the exact ID and payload/hash · A appears **exactly once** · B unchanged · both rows in Postgres · PowerSync returns to idle/completed checkpoint.
  > 10. A fresh second client should also receive A, **but only as a control** proving sync-rule eligibility. **A fresh client cannot substitute for delivery to the original checkpointed device** — a from-scratch resync gets both rows trivially and proves nothing.
  > 11. **Repeat with unique IDs for a predeclared number of trials.** Every late A must arrive.
  >
  > **Two distinct legitimate passes — report WHICH, never conflate them:**
  > - **(a) "late row delivered"** — B is durably checkpointed first, and late A subsequently reaches the same device; or
  > - **(b) "unsafe checkpoint prevented"** — PowerSync demonstrably **refuses to advance the checkpoint** while A is open. Also safe, but a *different mechanism* with different consequences under sustained long transactions (a stalled writer could stall sync). Prove B was committed and replication had adequate opportunity; after releasing A, **both** rows must arrive.
- **Q2 — Mutable operational state (blocker #3: L5 false for operational data).** Change a server-owned mutable field (`processing_state`, `resolution_status`, `Project.status`) and a device-editable one. Do both converge correctly on the device without clobbering unsynced local writes? *Pass: mutable fields sync both directions with a defined, correct convergence — the thing append-only couldn't do.*

  > #### ⚠️ Q2 could FALSE-PASS — tightened per Codex #8
  > **Sequential edits prove only happy-path propagation.** Required instead: **predeclare field ownership + the expected convergence rule** *before* running (otherwise any observed outcome can be rationalized as correct). Then **hold an unsynced offline device edit while committing a conflicting server edit**, and assert: the exact final value in Postgres **and** on both devices · the **pending local edit is preserved, not clobbered** · **no unauthorized client write** to a server-owned field succeeds.
- **Q3 — Encrypted media attachments (the fit risk).** Client-encrypt real audio bytes (Option B), hand the **ciphertext** to the PowerSync attachment helper → your `RemoteStorageAdapter` → Supabase Storage; on a second device, sync down, decrypt, verify byte-identical. Test offline-capture-then-reconnect and mid-upload kill (resumability). *Pass: encrypted media round-trips offline→online→another device, survives a kill, with no plaintext ever leaving the device.* **This is the most likely place PowerSync doesn't fit — test it first.**

  > #### ⚠️ Q3 AS ORIGINALLY WRITTEN COULD FALSE-PASS — tightened per Codex #8
  > The prose states the intended round trip but proves neither the **production key path**, the **absence of plaintext staging**, nor **actual TUS resume**. Bare "decrypt succeeded" can conceal three separate failures: a **harness-supplied DEK** (the real unwrap path never ran), a **plaintext staging file**, or a **complete restart mislabeled as a resume**.
  >
  > **The oracle must assert ALL of:**
  > - **Known source:** generate/record the audio **without creating a plaintext fixture file**. Record byte length, SHA-256, sample count/duration, and decodability *before* encryption.
  > - **Real path:** Device 1 uses the **production** capture-encryption path, the PowerSync attachment helper, and the real `RemoteStorageAdapter` — **no test-only copy or manual upload**.
  > - **Ciphertext identity:** hash the ciphertext before handing it to the helper. The adapter request body, the Supabase object, and the Device 2 download must all have **identical ciphertext length + hash**.
  > - **End-to-end plaintext identity:** Device 2's decrypted bytes must **exactly** equal the original — length, SHA-256, byte-for-byte, plus audio decode + sample count.
  > - **Key unwrap actually exercised:** **Device 2 starts WITHOUT the plaintext DEK.** It receives the intended wrapped-key material and invokes the **production unwrap path**. ***Supplying a DEK directly from the harness invalidates the test.*** Wrong identity/key and modified wrapped-key metadata **must fail authentication**.
  > - **Authenticated encryption:** corrupting ciphertext *or* authenticated metadata must make decryption **fail**, not yield unchecked output.
  > - **No plaintext staging:** after capture, upload, forced kill, relaunch, download, and cleanup, scan **all** app-controlled files, caches, temp/staging dirs, SQLite content, logs, and crash artifacts for distinctive **plaintext canaries**. Only explicitly-allowed in-memory recording buffers may hold plaintext. The storage object and captured upload body must be **ciphertext only**.
  > - **Offline behavior:** while Device 1 is offline, **no remote object/request exists**; reconnect triggers the real queued upload.
  > - **Real resumability:** use an object **large enough to require multiple TUS requests**; throttle/barrier the upload; wait until the **server reports `0 < committed offset < total size`**, then **externally terminate** the process (`SIGKILL` / force-stop) — **not** a graceful cancellation.
  > - **Resume evidence:** after a **cold production-build relaunch**, the same persisted upload/session URL **resumes from the prior nonzero server offset**. Request logs must show **continuation**, not a new upload starting at byte zero.
  > - **Post-resume outcome:** **exactly one** finalized object + attachment linkage; no duplicate finalized objects, no orphan sessions; all ciphertext/decryption assertions still pass.
  > - **Physical coverage:** run the kill/resume and sandbox-leak checks **independently on real iOS and Android**.

## Secondary questions (inform the decision; not solo dealbreakers)

*Codex #8 found **all four** could false-pass as originally written — each bar below is the tightened one. The recurring defect: subjective bars ("sits cleanly," "fits our scale") and happy-path checks prove nothing.*

- **Q4 — Local-commit composition.** Does our capture-commit state machine (Artifact 1) sit cleanly *above* PowerSync's local SQLite, or does PowerSync want to own the write in a way that fights the "verify media before the row commits" ordering? (If they fight, that's a real cost.)
  > **⚠️ Tightened (#8):** ***"sits cleanly above" is subjective and unfalsifiable.*** Exercise the **actual local-database integration with kills at the verify / write / commit boundaries**, and assert: **no row before verified media** · **no "saved" before the complete local commit** · **no saved capture lacking outbound intent**.
- **Q5 — RN/Expo + alpha maturity.** How rough is the alpha attachments helper in practice on iOS **and** Android — background upload, large files, retries? Any blocking bugs?
  > **⚠️ Tightened (#8):** **one foreground upload is insufficient.** Require a **release-build matrix on physical iOS + Android** covering representative **maximum** file sizes, **background/locked** operation, **OS termination**, **retries**, and **URL expiry** — with the **acceptable failure/recovery behavior declared in advance**.
- **Q6 — Cost + licensing + self-host.** PowerSync Cloud pricing at our scale vs. self-hosted (open-source core); licensing terms; the operational cost of running it. Must fit the "cheap, democratic" constraint.
  > **⚠️ Tightened (#8):** ***"fits our scale" has no scale or cost oracle.*** **Fix the workload assumptions + required features FIRST**, then compare Cloud vs. self-hosted on **all-in cost, licensing rights, HA/backup/monitoring, upgrades, and operator time**.
- **Q7 — Consistency + windowing.** Does its sync-rules / windowing model (only Active projects + last-N-days) fit our REQ-PM windowing, and does its consistency model hold under revocation/offboarding (REQ-MEMBER-5)?
  > **⚠️ Tightened (#8):** **active-row inclusion alone proves neither windowing nor revocation.** Test **active → archived / time-window exit → re-entry**, and **revocation while offline**. Assert: removal and later **re-delivery** where appropriate · **local purge** after revocation · **queued writes remain blocked** · the **revoked client cannot regain access**. *(Note the #7 finding this echoes: a revoked client may be unauthorized to pull the very tombstone meant to purge it.)*

---

## What to build (minimal, throwaway)

1. PowerSync Cloud (or self-host) wired to a throwaway Supabase project.
2. A tiny schema: one **immutable** `capture` (evidence), one **mutable** `capture_op_state` field, one **attachment** (encrypted media). **Include a `seq bigint DEFAULT nextval(…)` column on the capture table** — not because PowerSync uses it, but as the **Q1 negative control**: it proves the seq-inversion fault our design died on was genuinely reproduced (see Q1 step 3).
3. A bare RN/Expo app: create a capture offline, attach client-encrypted audio, go online, sync; a second device/emulator to observe convergence. **Release builds + the production entrypoint** for the kill/leak tests — a test-only path proves nothing (the ezQuotePro trap).
4. A `RemoteStorageAdapter` to Supabase Storage that stores/reads **ciphertext** (Option B).
5. A minimal fault harness for Q1 and Q3 — **the stalled-commit injection** (control session + advisory lock `K`, async `pg_advisory_xact_lock`, `pg_stat_activity` assertions, third-connection visibility check) and **a real mid-upload `SIGKILL`** at a server-confirmed `0 < offset < total`.
6. **The oracles + PowerSync diagnostics access** needed to make a pass falsifiable: read a **completed durable download checkpoint** (not "sync started"); capture the **adapter request body**; **plaintext-canary scanning** across app files/caches/temp/SQLite/logs/crash artifacts; **TUS request logs** proving continuation vs. restart-at-zero.
7. **A predeclared trial count for Q1** and **predeclared field-ownership/convergence rules for Q2** — written down *before* the run, so an outcome can't be rationalized after the fact.

## Go / No-Go

- **ADOPT PowerSync** if **Q1, Q2, Q3 all pass** and Q4–Q7 show no dealbreaker (esp. Q3 media fit, Q6 cost). → PowerSync becomes the sync transport; see "What adopt changes" below.
  > **⚠️ A "pass" only counts if it meets the tightened bar for that question (Codex #8).** A pass recorded without its named assertions is **not a pass** — it is an untested question. In particular: **Q1 must state which mechanism produced the pass** — *(a) "late row delivered"* or *(b) "unsafe checkpoint prevented"* — because they have different consequences under sustained long transactions, and "both rows eventually showed up" distinguishes neither.
- **REJECT → hand-build v2** if media/encryption doesn't fit (Q3), commit-ordering doesn't actually hold (Q1), consistency/windowing fails (Q7), or cost/licensing is prohibitive (Q6). → Write DURABILITY-DESIGN-v2 with the named fixes (commit-ordered outbox log, atomicity truth table, evidence-vs-operational split).
- **Optional secondary contender:** if PowerSync fails on *one specific axis*, a short **ElectricSQL** spike (same Postgres-sync category, different model) before committing to hand-build — worth a day, not more.

## What "ADOPT" changes in the design
- **ADR-2 flips:** sync transport = PowerSync (not owned queue / not append-only-hand-built). Append-only for *evidence* stays (enforced by our rules).
- **DURABILITY-DESIGN Artifact 2 (sync protocol) is largely REPLACED by PowerSync** — the seq-ordering, checkpoint, tombstone, pull-protocol work we kept getting wrong becomes its problem. Artifact 1 (local commit), the media-encryption decision, Artifacts 5/6/8 (authz/outbox/failpoints) **stay ours**.
- The three Codex #7 blockers 1 & 3 are dissolved (transport-owned); blocker 2 (MEDIA_COMMITTED atomicity) remains **ours** to finish (it's local) — but it's one problem instead of three.

## What "REJECT" changes
- We write **DURABILITY-DESIGN-v2** for a hand-built transport, addressing all three blockers explicitly, and it gets its own Codex pass. (This is the road that's failed twice — only take it if the bakeoff proves the engines don't fit.)

## Verification / protocol
- Run the bakeoff on **real devices** (iOS + Android) for the media + kill tests; an emulator is fine for the commit-ordering logic test. **Release builds + production entrypoints** for anything involving a kill or a leak scan.
- **Log the result** (pass/fail per Q1–Q7 + evidence) into `IMPLEMENTATION_NOTES §4`, and run a **Codex pass on the bakeoff conclusion** before flipping ADR-2 — same discipline as every other gate.
- **Record the evidence, not the verdict.** For each question, log the **named assertions** it passed (per the tightened bars above) — not "Q1 ✅". A verdict with no assertion trail is exactly the false-pass Codex #8 exists to prevent, and the conclusion-stage Codex pass will (correctly) reject it.
- Time-box: if Q1–Q3 aren't answered in ~4 focused days, that *itself* is signal about integration cost — report and decide rather than sinking more.

## One-line summary
**Build the smallest thing that throws our three killer faults at PowerSync — commit-ordering, mutable-state sync, and encrypted-media attachments — and adopt it only if it survives all three; otherwise hand-build v2 knowing the engines genuinely don't fit.**
