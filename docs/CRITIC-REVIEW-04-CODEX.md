# Critic Review #04 — Codex Cross-Model Review (THE cross-vendor check)

*Run 2026-07-15 by hadar on their Mac: OpenAI Codex CLI v0.144.4, model `gpt-5.6-sol`, read-only over all 15 docs, using the tuned cross-vendor prompt. This is the real second-system check required by the verification protocol ("run the final output by codex to ensure both systems agree"). Full raw output: `codex-review-output.md` in hadar's project folder. Reconciliation by Claude (fable) below, followed by Codex's verbatim review.*

---

## Reconciliation — do the two systems agree?

**Headline: Codex DISAGREES with the architectural greenlight — but the disagreement is narrower than the word suggests, and most of its findings are confirmed and adopted.**

**Where both systems agree (the working consensus):**
- **Start a tightly bounded spike now.** Codex's own verdict: "a tightly bounded feasibility spike is reasonable… a narrower spike limited to capture durability plus one attachment round-trip." That *is* M0. Both systems say: begin that immediately.
- **4 of 7 must-fix reconciliations verified** by Codex as real document edits that fix the finding: MF-3 (feed), MF-5 (delivery channel), MF-6 (one confirm surface), MF-7 (consent-at-creation + ES localization).
- **The margin number roughly survives:** Codex's independent recomputation lands at 59–75% vs. our 60–70% — the *method* critique (point estimate, not a cohort model) is accepted; the number isn't overturned.

**Where Codex found what three Claude-family reviews missed (confirmed, adopted):**
1. **"Video is never stored" self-contradicts** (Critical #3): the video must exist locally during recording and until extraction durably completes — an OS kill/disk-full/thermal event mid-extraction loses everything. Fix: raw video is an **encrypted temporary local asset** with an explicit state machine (`recording → finalized → extracting → derivatives_verified → deleted`), retained across restarts until derivative hashes verify. *The elegant "don't store video" fix was never adversarially examined after it was adopted — a textbook same-family blind spot.*
2. **Pre-roll contradicts consent** (High #8): REQ-CAP7's 1–2s pre-roll records people *before* the deliberate tap — directly contradicting "the first tap starts recording" and creating consent exposure. Fix: **cut pre-roll from P1.**
3. **Plaintext quarantine hole** (Critical #2 / MF-1 inadequate): uploads sit as plaintext in the quarantine prefix pre-encryption; erasure during failed ingest leaves readable plaintext; vendors/backups/logs are outside crypto-shred. Fix: never-persist-plaintext ingest (or short mandatory quarantine lifecycle) + a **per-capture erasure inventory** across R2/Postgres/FTS/jobs/vendors/devices/logs/backups + documented backup expiry.
4. **"One authorization module" is physically impossible across runtimes** (Critical #1 / MF-2 inadequate): SQL, YAML sync rules, Workers JS, and Edge Functions can't literally call one predicate. Fix: a **policy matrix + canonical grant tables**, each enforcement point *generated/derived* from them, with shared positive/negative fixtures run through every path as a **deployment gate**. (Refines MF-2 rather than reversing it.)
5. **Merge protocol needs tombstones** (Critical #4): a stale offline device can resurrect a merged-away project or attach evidence to the losing ID. Fix: immutable project IDs + server-side **alias/tombstone map** + canonical-ID resolution on every upload + monotonic merge generations + stale-device tests.
6. **Billing idempotency isn't exactly-once** (Critical #5): a provider can charge, the worker dies pre-commit, retry re-charges; and pipeline-authored writes bumping `content_version` can re-trigger processing recursively. Fix: per-stage **execution ledger** + provider request IDs + separate source-version from derived-output-version + budget at-least-once billing.
7. **Doc contradictions we introduced while fixing things**: PROC1 still says keyframes extract on reconnect vs TL4's on-device (Medium #16); the architecture's §1–2 diagrams/stack table still show raw-video/Realtime/server-ffmpeg (Medium #15); stale Flutter references in §9 (Low #22); LANGUAGE-LAYER still calls English the "legal record" in §2–3 (Medium #17); VAL3 mentions an identity signal the light confirm doesn't have (Medium #18); ledger keeps superseded entries unmarked (Low #23). All accepted as cleanup.
8. Also accepted: per-party consent evidence vs. a project checkbox (High #13); explicit Free minute/storage allowances (High #14); windowing vs offline warranty retrieval → **offline pin/download** for archived projects (Medium #19); statistical confidence on verification gates (Medium #20); commit to ONE upload architecture before M0 (High #9); "atomic linkage" → sagas with compensation (High #10); pipeline tenant-binding moves from fix-during-build into MF-2-before-code (High #11).

**The one genuine disagreement — P1 scope (hadar's decision to re-open):**
Codex's top-3 solo-buildability cuts: **video out of P1**, **AI resolution/classification out of the foundation phase**, **external delivery out of the first spike** — i.e., split P1 into (a) a non-AI capture-durability spike and (b) a separate AI-assisted validation spike, each with its own pass/fail. The internal fable review said the same thing (CR-03 H1); hadar chose "keep P1 as is." **Two independent models have now converged against that decision.** Per the protocol ("make me verify key decisions explicitly"), this goes back to hadar rather than being silently overridden — but the recommendation is now unambiguous.

**Codex's single riskiest assumption (recorded verbatim):** *"That PowerSync plus Expo-native media code can deliver a never-lost, conflict-safe, revocable evidence system without the solo developer having to build most of the hard distributed-systems and native-background machinery themselves."* — This is the right thing to fear, and it is exactly what the narrow spike must measure.

**Status:** findings adopted into the fix register; P1-scope decision pending hadar; document edits applied per the ☑-only-with-edit rule (tracked in IMPLEMENTATION_NOTES).

---

## Codex review — verbatim

## Verdict: DISAGREE with greenlight (+ one paragraph)

I disagree with the claimed FIX-FIRST→GO verdict. A tightly bounded feasibility spike is reasonable, but the documents have not earned an architectural greenlight: several "applied" fixes are prose commitments without implementable protocols, and some directly contradict other requirements. Most seriously, authorization has no concrete shared policy representation, the media encryption flow leaves plaintext outside crypto-shred, PowerSync merge/revocation semantics are underspecified, and "video is never stored" is incompatible with durable on-device extraction. P1 also combines native media engineering, offline synchronization, AI classification, project resolution, evidence retrieval, and external delivery—too much to validate causally or build safely as one solo-developer phase. Before product code, replace these assertions with executable state machines, schemas, threat tests, and a narrower spike limited to capture durability plus one attachment round-trip.

## Findings (ranked Critical / High / Medium / Low)

### Critical

1. **ARCHITECTURE §3.2 and §11 C2 → the "one authorization module" cannot work as described across all paths → a removed collaborator can continue receiving or reading data because PowerSync Sync Rules, Postgres RLS, Workers, Edge Functions, and JWT pages execute in different runtimes and cannot literally call one shared predicate → define an authorization policy matrix and canonical grant tables; independently implement each enforcement point from those tables; add generated fixtures that run the same positive/negative cases through Sync Rules, RLS, upload issuance, media reads, Edge Functions, and homeowner links. Treat parity as a deployment gate, not a claimed shared module.**

2. **ARCHITECTURE §3.3 and §11 H1 → crypto-shred covers only permanently encrypted R2 objects, while uploads first exist as plaintext in a quarantine prefix and content is copied to Postgres, devices, AI vendors, job payloads, logs, and backups → an erasure performed during failed ingest leaves the plaintext quarantine object readable; later erasure may still leave STT input or transcript in vendor retention and operational backups → encrypt on the client or stream through an ingest service that never persists plaintext; give quarantine a short mandatory lifecycle; maintain a per-capture erasure inventory covering R2, Postgres, FTS, job payloads, vendors, caches, devices, logs, and backups; document backup expiry rather than claiming immediate complete erasure.**

3. **SPEC §6.2 REQ-TL4; ARCHITECTURE §3.1 → "raw video is never stored" contradicts durable offline capture and post-capture extraction → video must exist somewhere while recording and until audio/still extraction is durably committed; an OS kill, disk-full event, thermal termination, or ffmpeg failure can leave neither a usable raw video nor complete derived assets → explicitly model raw video as an encrypted temporary local asset with states `recording → finalized → extracting → derivatives_verified → deleted`; retain it across restart until hashes and durations of audio/stills are verified; define storage-pressure limits and recovery behavior.**

4. **ARCHITECTURE §3.1/§11 H3; SPEC §6.3 REQ-PROC7 and §8 → the offline merge protocol is not defined sufficiently to prevent resurrection and dangling references → device A merges project B into A while an offline device continues creating children under B; on reconnect it can recreate B, upload stale membership, or attach evidence to the losing ID → introduce immutable project IDs plus a server-side alias/tombstone map, canonical-ID resolution on every upload, monotonic merge generations, and tests for stale devices reconnecting after one or multiple merges. Never physically reuse or silently delete the losing identifier.**

5. **ARCHITECTURE §3.4 and §11 H2/H4 → `(capture_id, content_version)` does not provide exactly-once AI charging or execution → the STT provider can succeed and charge, then the worker can die before recording success; retrying with the same local key can charge again because the provider is not specified to honor that key. Bumping `content_version` while writing results can also recursively create a new job key → use an inbox/outbox and per-stage execution ledger; separate source version from derived-output version; record provider request IDs; accept and budget at-least-once billing where providers lack idempotency; prevent pipeline-authored fields from retriggering source processing.**

6. **PRICING-STRATEGY §§3 and 6; ARCHITECTURE §3.10 → the claimed 60–70% blended margin is not reproducible from the plan → no customer-tier mix, minute allowances, capture distribution, media retention curve, manager count, email cost, payment fees, support burden, or free-to-paid ratio is specified. Using the document's own busy-Core assumptions gives roughly $3.2–5.4 direct AI/Verify cost, plus approximately $1.5–2.3 per company for the stated platform/jobs floor at 1,000 companies—about 59–75% margin at the $19 price before payment fees, support, email, storage accumulation, fraud, or free-user subsidy → replace "blended margin" with a cohort model containing tier mix, free ratio, minutes, signatures, retained GB, platform step functions, payment fees, and sensitivity cases. Do not lock $19/$49 until the pessimistic case remains viable.**

### High

7. **ARCHITECTURE §3.1, §11 C3/H1, and §12 fix-during-build register → revocation and erasure requirements conflict → "instant Sync-Rule revocation" removes access, while the purge design says to keep a removed collaborator synchronized until a purge command arrives; a malicious or permanently offline device will retain plaintext regardless → separate server revocation from best-effort device deletion; immediately end new synchronization and token access, send deletion commands through a retained control bucket, minimize what collaborators ever receive, and state clearly that already-synced plaintext cannot be remotely guaranteed erased.**

8. **SPEC §6.1 REQ-CAP7 and §6.7 REQ-CON1 → continuous 1–2 second pre-roll means microphone/video capture occurs before the deliberate record action → a user can record nearby parties before the application's visible capture state, undermining the claim that the first tap starts recording and complicating consent disclosure → cut pre-roll from P1, or require an explicit always-listening mode with conspicuous indication, jurisdiction review, bounded in-memory buffering, and no persistence until the record action.**

9. **ARCHITECTURE §§3.1 and 4; SPEC §6.3 REQ-PROC4 → "PowerSync Attachments or a thin custom queue" hides a core subsystem behind an experimental dependency → an API change, app kill, expiring upload URL, multipart mismatch, or cellular-policy transition can strand evidence even if relational sync succeeds → choose one upload architecture before M0; specify its durable state machine, URL refresh, multipart persistence, checksum verification, cancellation, orphan cleanup, and iOS/Android background behavior. Test multi-hour interruption and credentials expiring mid-upload, not merely one round-trip.**

10. **SPEC §6.3 REQ-PROC4 and ARCHITECTURE §11 H4 → attachment state and capture linkage cannot be "atomic" across local SQLite, PowerSync/Postgres, and R2 → the systems have no shared transaction, so every boundary can produce row-without-object, object-without-row, or encrypted-object-without-key states → use explicit sagas with immutable object IDs, checksums, state transitions, compensating cleanup, and reconciliation queries. "Atomic linkage" should be removed.**

11. **ARCHITECTURE §3.4/§12 fix-during-build register → tenant isolation inside the AI pipeline is deferred despite service-role execution bypassing RLS → a malformed job or guessed `capture_id` can write a transcript or disposition into another tenant, creating a full cross-tenant breach → make global UUIDs, tenant-bound job claims, tenant checks on every read/write, and cross-tenant negative tests part of MF-2 before code, not fix-during-build.**

12. **SPEC §§4, 6.4, 6.6 and 9 → P1 still depends on AI despite presenting AI accuracy mainly as a P1.5 gate → decision-card inference, who-directed defaults, scope classification, content-assisted project resolution, and language detection all occur in P1; degradation to unclassified evidence removes the differentiating M5 validation loop → split P1 into a non-AI durability spike and a separate AI-assisted validation spike, each with its own pass/fail decision.**

13. **SPEC §6.7 REQ-CON1; ARCHITECTURE §3.9 → a project-level `recording_consent_state` is not evidence that every recorded party consented → a crew can record a new homeowner, subcontractor, inspector, or bystander under a stale project checkbox, producing potentially unlawful evidence → record consent basis, jurisdiction, parties or announcement method, collector, timestamp, and version; provide an audible recording notice or non-recording capture fallback where required.**

14. **PRICING-STRATEGY §§4–6; ARCHITECTURE §3.10 → Free limits decisions while the expensive unit is captures/minutes, and the actual minute allowance is never stated → users can accumulate unlimited audio and images, request lazy processing selectively, or create substantial retained storage without consuming a "decision"; offline devices also cannot reliably know the tenant-wide cap → publish and enforce explicit monthly processing minutes and retained-storage limits server-side; always accept uploads, but queue overage processing and preserve read/export access.**

### Medium

15. **ARCHITECTURE §§1–2 and stack table versus §§3.1/3.4 → obsolete architecture still says the client only captures/displays, includes raw video in device media, uses Realtime, and runs ffmpeg server-side → implementation following the diagrams can recreate findings supposedly fixed later → update the drivers, diagram, stack table, and walkthroughs so one consistent architecture remains.**

16. **SPEC §6.3 REQ-PROC1 versus §6.2 REQ-TL4 → PROC1 explicitly says keyframe extraction runs on reconnect, while TL4 requires on-device extraction before synchronization → developers cannot satisfy both acceptance criteria → change PROC1 to distinguish local deterministic media extraction from cloud transcription/translation/structuring.**

17. **LANGUAGE-LAYER §§2–3 versus §5; SPEC §8 → the same document still calls English the "permanent," "single source of truth," and "legal/working record" before later demoting it to an internal index → legal/export behavior remains ambiguous for unsigned confirmations and reports → define authority separately for raw capture, unsigned confirmation, signed act, and generated report; remove all obsolete "legal record" language.**

18. **SPEC §6.6 REQ-VAL3 → the lightweight no-login confirm requires an "identity signal," while SPEC §7.1 and ARCHITECTURE §3.7 say the light confirm has no identity → a dispute can misrepresent an anonymous bearer-token action as attributable confirmation → define the P1 signal precisely, such as token possession plus IP/user-agent with explicit "not identity verified" labeling.**

19. **ARCHITECTURE §3.1 MF-4 and SPEC §6.5 REQ-EVID2 → windowing only Active projects conflicts with durable offline warranty/dispute retrieval after archival → a contractor at a warranty visit may have no signal and find the archived evidence absent → specify an offline pin/download mechanism and retention cache, with clear UI indicating what is locally available.**

20. **VERIFICATION_PLAN Part C and SPEC §9 M0–M6 → several gates lack sample size or statistical confidence: attachment tests use 100 cycles, resolution uses percentages without case counts, and "language detection ≥95%" lacks a confidence interval → set minimum stratified samples, device/OS matrix, clip durations, weak-network profiles, and acceptable confidence bounds before interpreting a green result.**

### Low

21. **PRICING-STRATEGY §3 → R2 storage is labeled approximately zero despite indefinite retention of audio, stills, exports, replicas, and request operations → cumulative cost will not be zero even after raw-video removal → model GB-months and operation counts by cohort age.**

22. **ARCHITECTURE §4 and §9 → resolved ADR-1 still appears as an open Flutter-versus-RN decision, and validation still requests a Flutter spike → the build can branch unnecessarily → remove stale Flutter instructions and make the RN native-media spike authoritative.**

23. **IMPLEMENTATION_NOTES §2 and §4 → entries preserve superseded "70–80% margin," Flutter architecture, and "all fixes verified" without consistently striking them through → future agents can treat stale ledger entries as current decisions → mark superseded entries explicitly and link each to the current controlling section.**

## Reconciliation spot-check results (MF-1..MF-7: verified / not found / inadequate)

- **MF-1 — inadequate.** The KMS/DEK and authorized-read edit exists in ARCHITECTURE §3.3, but plaintext quarantine, failed-ingest cleanup, vendor copies, backups, and local replicas remain outside crypto-shred.
- **MF-2 — inadequate.** ARCHITECTURE §3.2 lists the paths and tests, but provides no realizable common policy representation; pipeline tenant binding is still deferred to "fix during build."
- **MF-3 — verified.** ARCHITECTURE §3.2 and SPEC §6.10 REQ-PM-D remove `postgres_changes` and render the feed from PowerSync-local data. Stale diagrams still need cleanup.
- **MF-4 — inadequate.** ARCHITECTURE §3.1 adds data-parameterized, windowed rules, but does not define buckets, grant/revocation behavior, offline archived retrieval, or migration/re-sync validation.
- **MF-5 — verified.** SPEC §6.6 REQ-VAL8 adds email plus SMS delivery, delivery state, and 10DLC kickoff.
- **MF-6 — verified.** SPEC §4 and §6.6 REQ-VAL4/VAL6 add unclassified-evidence degradation and exactly one confirmation surface.
- **MF-7 — verified.** SPEC §6.7 REQ-CON1 moves consent to project setup, and §6.9 REQ-X2 requires Spanish P1 chrome. The resulting consent model remains legally inadequate, but the requested document edits exist.

## Top 3 cuts for solo-buildability

1. **Cut video from P1.** Ship voice, photo, and text first. Video extraction, temporary-file durability, keyframe selection, thermal/storage handling, and native ffmpeg integration are a separate milestone.

2. **Cut AI project resolution and decision classification from the foundation phase.** Use last-selected/nearby project plus an unresolved inbox; produce plain evidence records. Add classification only after durability and sync are proven.

3. **Cut external validation delivery from the capture-core spike.** Prove local capture → durable attachment → server receipt → retrieval first. Then add one channel—email only—before introducing SMS, 10DLC, OTP, JWT lifecycle, and signature claims.

## One line: the single riskiest assumption in the whole plan.

That PowerSync plus Expo-native media code can deliver a never-lost, conflict-safe, revocable evidence system without the solo developer having to build most of the hard distributed-systems and native-background machinery themselves.
