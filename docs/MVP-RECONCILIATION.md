# ezQuotePro MVP → EZjobsite — Reconciliation

> ⚠️ **CAVEAT ADDED 2026-07-15 (hadar's challenge: "is what is built even good?").** This document establishes what EXISTS in ezQuotePro, not what is GOOD. Known warning signs: the "ALL TESTS PASSED" offline result is **static analysis only** (file/syntax/translation checks — zero runtime, device, kill, or airplane-mode tests); there are **two overlapping offline systems** (services layer + a v2.1 recorder at 55%, testing 0%, on a branch); a **hardcoded client-side API key**; and heavy doc churn suggesting repeated restarts. **Adoption rule: no component transfers to EZjobsite by inheritance — each must pass the quality audit (`MVP-AUDIT` criteria) or it contributes lessons, not code.** §0's "riskiest assumption already answered" is downgraded to: *the assumption has a promising, unverified prior attempt.*

*External signal: a scan of the shipped `ezQuoteProIOS` codebase (a Hilo product — "voice powered proposal, invoice and change order application for the trades," Expo SDK 52, multiple production .ipa builds). This is the strongest possible input to the EZjobsite plan: a working app that already does much of what EZjobsite needs. Scanned 2026-07-15. Purpose: replace speculation with evidence, and re-frame the build from greenfield to extension.*

---

## 0. The headline

**EZjobsite is not a greenfield build. It is an extension of a working, shipped, offline-capable, multilingual, voice-capture app that already handles change orders.** ezQuotePro proves — in production — that the single riskiest assumption Codex named ("RN/Expo + queued upload can deliver never-lost offline capture without the solo dev building all the hard machinery") is achievable, because **it's already built here.** This changes the calculus of the entire plan, and especially the pending P1-scope decision.

---

## 1. The real stack (evidence, not my cold guesses)

| Layer | EZjobsite plan (guessed) | ezQuotePro (proven) | Reconciliation |
|---|---|---|---|
| Client | React Native + Expo (ADR-1) | **RN + Expo SDK 52**, iOS/Android/web, EAS builds | ✅ ADR-1 confirmed by shipped experience, not theory |
| STT | OpenAI gpt-4o-mini-transcribe | **Deepgram** (`nova`, `diarize:true`, `smart_format`) | **Adopt Deepgram** — proven, and **diarization = speaker separation → "who directed it"** for free |
| Media storage | Cloudflare R2 | **AWS S3** (`S3UploadManager.js`) | Keep R2's zero-egress advantage as an *option*; S3 pipeline is already working — reuse it for P1 |
| Backend | Supabase + PowerSync (greenfield) | **Xano** (`x5dq-3lan-lmlo.n7d.xano.io`) — auth, teams, companies, proposals; bearer-token; MCP already connected | **Big fork — see §4.** Existing Xano backend + offline pattern may make PowerSync/Supabase unnecessary for P1 |
| Offline store | PowerSync local SQLite | **AsyncStorage + FileSystem + custom queues** (no PowerSync) | **They proved offline-durable capture WITHOUT PowerSync** — simpler, already working (see §2) |
| Offline sync | PowerSync streaming | **Queue-based sync + NetInfo + conflictResolver** | Same principles; already implemented |
| State/data | — | react-query, GlobalVariableContext | Reuse |
| i18n | REQ-X2 (P1 ES localization — a must-fix) | **EN/ES/RU/UK/ZH already localized, incl. offline-specific keys** | **REQ-X2 essentially DONE** — Spanish chrome exists and is tested |
| Subscriptions | (pricing tiers) | RevenueCat (per original CLAUDE.md) | Reuse for Free/Core/Crew billing |

**Security finding (urgent):** the Deepgram API key is **hardcoded in `custom-files/deepgram.js`** and ships in the client bundle — rotate it and move STT behind a server proxy. (This is exactly the class of thing the security review flagged: no third-party keys client-side.)

---

## 2. The offline system — the riskiest assumption, already answered

ezQuotePro contains a **full offline-first architecture** (18 `OFFLINE_*` design/impl/test docs; two implementation layers totalling ~13,000 lines) whose stated principles are **identical to what I designed for EZjobsite cold**:

> Offline-first · optimistic updates · queue-based sync · idempotent operations · conflict resolution · graceful degradation · checksums/data-integrity.

What's already built (evidence):
- **Recording state machine** — 15 recording states, 25+ events (exactly the state machine Codex's Critical #3 demanded — they have it).
- **Services** (tested "ALL PASSED", 2025-09-29): `offlineStore`, `audioQueue`, `uploadQueueExtensions`, `networkMonitor`, `syncManager`, `offlineApi`, `conflictResolver`, `initOfflineServices` (~3,000 lines) — plus a v2.1 recorder system (`OfflineRecordingManager`, `LocalMetadataStore`, `RecordingSegmentStore`, `LocalAssetQueue`, `TranscriptionSyncManager`, `RealTimeTranscriptionService`, `NetworkMonitor`).
- **App-state/background handling during recording** (`RecordAppStateHandler.js`) — the C3 existential "does upload survive backgrounding/kill" concern, directly addressed.
- **Upload queue with status UI** (`uploadImagesQueue.js`, `UploadQueueStatus.js`, `S3UploadManager.js`) — the REQ-PROC6 "saved / waiting / uploading" states, already shipping.
- **Real-time transcription** (streaming Deepgram) *and* batch (`deepgram.js` preRecorded) — both models exist.

**⚠️ CORRECTED 2026-07-15 by the Codex code audit (`CRITIC-REVIEW-05`) — this §2 was WRONG.** Reading the actual source: **none of the offline systems above is wired into the shipped app.** `App.js` never initializes the `offlineStore/syncManager` stack (it lived only in git commit `3319ada`); the newer `RecordingManager/UploadCoordinator` stack is also unwired and internally broken. The **shipped recorder (`RecordBlock.js`) is not offline-first** — it calls Xano to create a proposal *before* recording and fetches a signed URL *before* queuing, so **airplane mode can neither start a recording nor save one.** And "ALL TESTS PASSED" = **file/export existence checks, not runtime tests** (no real tests exist; Jest isn't installed). The riskiest assumption was **not** answered here — it was *aspirational documentation over a cloud-first workflow.* The hard work that IS captured is the **lesson** (why it failed), not a working system. See `CRITIC-REVIEW-05-CODEX-CODE.md`.

---

## 3. What transfers to EZjobsite (the head start)

**Reuse largely as-is:** the RN/Expo scaffold + EAS build/deploy pipeline · the offline recording + queued-upload spine · Deepgram integration (batch + streaming) · S3 upload manager · NetInfo/network monitoring · conflict resolver · the multilingual i18n system (Spanish already done) · RevenueCat billing · auth against Xano · GPS/camera/image-optimization utilities.

**Adapt (same shape, new content):** the **AI structuring pipeline** — ezQuotePro's `construction_proposal_analyzer_prompt_v2` already turns a voice transcript into structured JSON with `completeness_score`, `estimate_confidence`, `critical/minor gaps`, and `key_assumptions_made`. That is *exactly* the confidence-and-gaps pattern EZjobsite needs for **voice → decision / change-order** structuring (numbers gated, low-confidence flagged). Adapt the prompt from "estimate" to "decision/change-order"; the machinery is built.

**Change orders already exist** as a document type in the shipped app — the wedge is not hypothetical here.

---

## 4. What this changes in the plan (decisions for hadar)

1. ~~**Build posture: fork/extend, not greenfield.**~~ **RESOLVED 2026-07-15 — GREENFIELD, with ezQuotePro as a lessons donor (hadar).** hadar's ground truth: the previous mistakes were **UX, adoption/GTM, and "offline workflow utilization was not right"** (not the wedge); the app was **soft-launched with few users** (so nothing is battle-proven); and hadar **wants to write it from scratch** — the old code isn't confidently changeable. Since UX is baked into every screen, the data model must change (proposal-centric → capture/decision-centric), and inheritance would carry unproven risk, **EZjobsite is built fresh against the verified spec suite.** ezQuotePro's role: (a) proof the domain is buildable solo, (b) a **lessons mine** — edge cases, the 18-doc offline failure archaeology, and especially *why the offline workflow wasn't right* (a mandatory input to the UX phase), (c) a running reference implementation, (d) a source of small extractable patterns (the analyzer-prompt confidence/gaps shape, i18n key structure, Deepgram diarization config) — patterns, not code. The rewrite-trap antidote is the spec suite + the lessons ledger.

2. ~~**PowerSync/Supabase may be unnecessary for P1**~~ **RESOLVED 2026-07-15 — owned queue for P1, PowerSync deferred to P1.5+ (hadar).** ezQuotePro proves durable offline capture is achievable without a streaming-sync engine; EZjobsite's P1 uses **an owned SQLite + queue** (a cleaner, greenfield version of the same idea — capture journal → upload queue → reconnect push/pull — not ezQuotePro's code). PowerSync's real value (multi-device conflict-free *relational* sync, the collaborator feed) stays a P1.5+ concern. This **dissolves** the PowerSync-specific architecture-review findings (Sync-Rules-vs-RLS parity, sync-rule re-replication cost). *(See ADR-2 in `ARCHITECTURE.md` + IMPLEMENTATION_NOTES §2.)*

3. ~~**Backend: extend Xano vs. migrate to Supabase.**~~ **RESOLVED 2026-07-15 — Supabase (raw Postgres), Xano dropped (hadar).** Consistent with the greenfield posture (§4.1): no inheritance of the Xano permission model; the security/multi-tenant review findings apply to **Postgres RLS + Edge-Function checks**, which the architecture already specs. Xano remains only a read-only reference/lessons source, not a runtime dependency.

4. **The pending P1-scope question is largely answered by evidence.** The "narrow capture-durability spike" Codex and the fable review both recommended is **mostly already done** in ezQuotePro. So the real P1 for EZjobsite is not "prove capture works" — it's "**fork the proven capture spine + build the decision/approval loop on top**," with the AI-accuracy spikes (Spanish/Spanglish decision extraction) as the genuine new unknown.

---

## 5. Edge cases / knowns already discovered (→ IMPLEMENTATION_NOTES)
From the shipped app's own docs + code: password special-character handling · language-not-switching-after-signup · translation-file JSON integrity · image optimization/upload sizing (a whole architecture doc) · the 15-state recording state machine + 25 events · OTA update architecture · performance optimizations. These are hard-won *knowns* — they move from "known-unknown" to "known" in our ledger, and the reasoning is worth reading before rebuilding any of it.

---

## 6. Recommended next steps
1. **Rotate the Deepgram key + move STT server-side** (today; it's exposed).
2. **Confirm production-wiring** of the offline system (which layer is live in the shipped `.ipa`).
3. **Decide build posture** (fork/extend ezQuotePro vs. greenfield-with-lessons) and **backend** (extend Xano vs. Supabase) — the two forks in §4.
4. Then re-derive the P1 build plan as *"extend the proven spine + build the decision/approval loop,"* and point the AI-accuracy spikes at the one true new unknown: Spanish/Spanglish **decision/change-order** extraction (ezQuotePro's analyzer is estimate-focused and English-first).
