# Codex #13 — the role decision (NOT a review)

> **Provenance.** `codex exec`, `gpt-5.6-sol` @ high, read-only, apikey auth. Asked to **decide, not grade**: should Codex architect the capture-durability solution? Prompt: `docs/CODEX-REVIEW-13-PROMPT.txt`.
>
> ## Outcome: **YES — Codex architects, with a narrower guarantee and an explicit complexity budget.**
>
> **The line that matters most, and it is for hadar, not for either model:**
> > *"Without another qualified human, there is no independent architectural review. We should say that plainly rather than pretending two models constitute one."*
>
> **It passed the cutting test.** Asked whether its own #11/#12 fix lists were an ocean, it said **"the 'ocean' charge is fair"** and then **cut nine items — most of them its own findings**, including H5, which it had credited Claude with fixing one review earlier. A reviewer adds; an architect chooses. It chose.
>
> **It also corrected Claude's diagnosis, in Claude's disfavour:** *"Claude's diagnosis is only half right. There is a validator problem, but there is plainly also an author problem. A missing harness did not cause repeated factual errors, contradictory claims, or the invalid assumption that PowerSync-managed rows remain authoritative after synchronization. A harness validates a chosen design; it cannot choose the authority model or repair incoherent requirements."* **Adopted — the "validator not author" framing was self-serving and wrong.**
>
> ## Division of ownership (agreed)
> | Owner | Scope |
> |---|---|
> | **Codex** | Capture durability architecture · minimal state machine · **commitment authority** · recovery behaviour · the executable acceptance harness |
> | **Claude** | Requirements traceability · repo consistency · **bounded implementation against that architecture** — *not* redefining the safety model, *not* declaring the gate closed |
> | **Nobody (stated honestly)** | Independent architectural review. Claude may review adversarially but **cannot be the approval gate.** |
>
> **Real gates:** executable fault tests · direct verification of PowerSync/SQLite contracts · **hadar's explicit acceptance of product tradeoffs and residual platform risk**.
>
> ## Cut from the A0.2 prerequisite (9 items — most were Codex's own demands)
> per-chunk SHA-256+CRC log & binary grammar (its #11 H7) · generational authenticated manifests, predecessor chains, 2-generation retention, fencing, fork quarantine (its H6) · exhaustive generated recovery-state vector · exact reconstruction after catastrophic DB loss (its H9) · canonical envelopes for years of schema evolution · cross-device download/cache/GC as an A0.2 prerequisite (its H10) · SQLCipher + media encryption from blocker 2 · durable server receipts + dead-letter subsystem from the local-save proof (its C3 fix) · **disk preallocation as a correctness requirement (its H5) — because "disk-full before commitment is a failed capture, not a phantom saved."**
>
> ## Retained
> finalized + hashed media · durable atomic installation · **a durable app-owned commit plus outbox** · acknowledgment only after that commit · idempotent server submission · fault testing.
>
> ## The commitment record — the question nobody had answered
> **Chosen: an app-owned append-only `CaptureCommit` + outbox in the same SQLite database, local-only.** It commits with the outbox and **cannot be reverted by PowerSync synchronization**; PowerSync rows become **replaceable projections**. Must be proven against the exact adapter, including database-reset behaviour. **Fallback if the adapter can't guarantee those semantics: a separate app-owned SQLite ledger — NOT a filesystem commitment protocol.** Rejected: server receipt as authority — *"'saved' would require connectivity. That changes the offline product."*
>
> **Engineering fact:** PowerSync-managed projections cannot be the sole authority if PowerSync may revert them.
> **Product tradeoffs for hadar:** does "saved" have to work offline · is catastrophic local-DB loss inside the guarantee · do encryption / cross-device recovery belong in the first release.
>
> ## Next action
> **Build the fault harness around that minimal architecture — not Artifact 1 v4.** First vertical slice: finalize + durably install media → commit `CaptureCommit` + outbox under the enforced durability profile → show "saved" only after → **inject process death at every boundary** → **simulate upload rejection and PowerSync reversion** → assert every acknowledged capture stays locally discoverable and exportable.
>
> **Caveat it volunteered:** *"Process-kill testing will not prove sudden-power-loss durability, so physical-device power testing remains a later gate for that narrower claim."*

---

## Full response, verbatim

**YES, I should architect it—but with a deliberately narrower guarantee and complexity budget.**

1. Claude’s diagnosis is only half right. There is a validator problem, but there is plainly also an author problem. A missing harness did not cause repeated factual errors, contradictory claims, or the invalid assumption that PowerSync-managed rows remain authoritative after synchronization. A harness validates a chosen design; it cannot choose the authority model or repair incoherent requirements.

2. I should own the capture durability architecture, its minimal state machine, the commitment authority, recovery behavior, and the executable acceptance harness. Claude should own requirements traceability, repository consistency, and bounded implementation work against that architecture—not redefine the safety model or declare the gate closed.

Claude can review me adversarially, but cannot be the approval gate. The real gates should be:

- Executable fault tests for behavior.
- Direct verification of PowerSync/SQLite contracts.
- Hadar’s explicit acceptance of product tradeoffs and residual platform risk.

Without another qualified human, there is no independent architectural review. We should say that plainly rather than pretending two models constitute one.

3. The “ocean” charge is fair. My findings were valid against the promises being made, but my “minimum required before A0.2” inherited an excessively broad promise: survive arbitrary power loss, database loss, corruption, sync rejection, cross-device recovery, and years of schema evolution.

For the first product architecture, I would cut:

- The paired per-chunk SHA-256/CRC log and executable binary grammar.
- Generational authenticated manifests, predecessor chains, two-generation retention, fencing, and fork quarantine.
- The exhaustive generated recovery-state vector.
- Exact reconstruction after catastrophic database loss.
- Canonical envelopes supporting years of schema evolution.
- Cross-device download/cache/retention/GC design as an A0.2 prerequisite.
- SQLCipher and media encryption from blocker 2.
- Durable server receipts, stored responses, and a full dead-letter/quarantine subsystem from the local-save proof.
- Disk preallocation as a correctness requirement; disk-full before commitment is a failed capture, not a phantom saved.

I would retain: finalized and hashed media, durable atomic installation, a durable app-owned commit plus outbox, acknowledgment only after that commit, idempotent server submission, and fault testing.

4. The commitment-record options are:

- **App-owned local-only table in the same SQLite database:** smallest change; can be committed with the outbox and cannot be reverted by PowerSync synchronization. This must be proven against the exact adapter, including database-reset behavior.
- **Separate app-owned SQLite ledger:** stronger isolation from PowerSync, but adds a second database, projection/reconciliation logic, and more operational burden.
- **Server receipt as authority:** conceptually clean, but “saved” requires connectivity and server acceptance. That changes the offline product.

I would pick the first option: an append-only `CaptureCommit` plus outbox owned by the application, with PowerSync rows treated as replaceable projections. If the adapter cannot guarantee the local table’s transaction and persistence semantics, fall back to the separate ledger—not a filesystem commitment protocol.

Engineering fact: PowerSync-managed projections cannot be the sole authority if PowerSync may revert them. Product tradeoffs for Hadar: whether “saved” must work offline, whether catastrophic local database loss is in the guarantee, and whether encryption or cross-device recovery belongs in the first release.

5. The single next action is to build the fault harness around that minimal architecture—not write Artifact 1 v4.

The first vertical slice should:

1. Finalize and durably install media.
2. Commit `CaptureCommit` and its outbox under the enforced SQLite durability profile.
3. Show “saved” only afterward.
4. Inject process death at every boundary.
5. Simulate upload rejection and PowerSync reversion.
6. Assert that every acknowledged capture remains locally discoverable and exportable.

That moves blocker 2. Process-kill testing will not prove sudden-power-loss durability, so physical-device power testing remains a later gate for that narrower claim.
