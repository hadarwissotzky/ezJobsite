# EZjobsite — Architecture & Stack (v1)

> 🔷 **DATABASE DECISION LOCKED 2026-07-15 — read this before the PowerSync content below.** The sync engine is now settled and it is **NOT PowerSync for P1**. Locked: device store = **SQLite (encrypted)**; cloud = **Supabase (raw Postgres)** — Auth, RLS, Edge Functions, Storage; sync for P1 = **a simple owned queue** (device write-ahead capture journal per REQ-CAP8 → durable resumable upload queue → reconnect processing queue). **PowerSync is deferred to P1.5+**, adopted only if multi-device conflict-free *relational* sync (the collaborator feed) earns it. Throughout this document, wherever it says "PowerSync local SQLite / streaming sync / Sync Rules / Attachments," read the **owned-queue equivalent** for P1: our own SQLite + our own upload/sync queue, with authorization enforced by **Postgres RLS + Edge-Function checks + presign re-checks** (there are no client-side PowerSync Sync Rules in P1, so the "Sync-Rules↔RLS parity" findings are **dissolved**, not open). ADR-2, the §2 diagram, the §5 stack table, §3.1, and §3.2's feed have been updated to reflect this; deeper PowerSync-specific passages (C2 parity, sync-rule re-replication) are retained only as **P1.5+ notes** for the day PowerSync is reconsidered. Rationale + trade-off: `IMPLEMENTATION_NOTES.md` §2 (2026-07-15 DATABASE LOCKED) and `MVP-RECONCILIATION.md` §4. *[hadar, verified key decision]*

*Derived from the full use-case suite (`MASTER-USE-CASES.md`, 62+ use cases across ~13 layers) and the locked decisions. Optimized for: offline-first never-lose-it, process-on-reconnect, cheap to run, and buildable by a solo AI-assisted developer on managed services. Prepared 2026-07-15. External signal: Supabase(Postgres)+SQLite+owned-queue offline stack; RN+Expo for a shared TS web/mobile codebase (ADR-1). Stack choices are locked except where flagged.*

---

## 1. Architectural drivers (use cases → what the architecture must do)

| Requirement (source) | Architectural implication |
|---|---|
| Never lose a capture; offline-forward (mandate #1/#7, REQ-CAP/PROC) | **Local-first**: media to device filesystem + metadata to on-device SQLite *before* any network; durable resumable upload queue. The single dominant driver. |
| Process on reconnect, no heavy on-device ML (locked) | **Cloud processing pipeline** triggered by sync; client stays thin. Client does capture + display only. |
| Multimodal + timeline (REQ-CAP/TL) | Media files as attachments keyed to a `Capture`; timeline offsets as metadata rows; **audio/keyframe extraction runs on-device** (REQ-TL4, §3.1) — the pipeline only ever receives audio + images, never video. |
| English-canonical + per-user display + cache + pivot search (LANGUAGE) | Store `canonical_en` + `original` + `translations` cache in Postgres; FTS index on `canonical_en`; translate query→EN. |
| Handler model (Evidence/Approval/CO/Report/Checklist) | One `dispositions` table with a `type` + typed JSON payload; handlers are server functions, not new schemas. |
| Multi-tenant + collaborators + roles (PM) | Postgres **Row-Level Security** keyed by tenant + project membership; `author{user,org,role}` on every row; cross-org grants for collaborators. |
| Digital signature = SMS-OTP identity (locked C2) | Twilio Verify + typed legal name + frozen `shown_content` hash; no-login counterparty links via signed tokens. |
| Notifications (push + SMS) | Push for free/in-app; SMS reserved for binding OTP (cost control per pricing). |
| Cheap unit economics (pricing) | Cheapest AI models; small media footprint (voice-first; video extracted on-device); meter decisions + SMS per tenant. *(R2 zero-egress is the P1.5 lever, not a P1 assumption — DECISION 7.)* |
| Erasure/crypto-shred (locked C3) | Envelope-encrypt media per record; erase = destroy key + tombstone (retain hash stub). |
| Solo AI-assisted build | Managed services only; minimal DevOps; durable-jobs platform handles retries/idempotency. |

---

## 2. High-level architecture

```
 ┌────────────────── CLIENT (React Native + Expo, offline-first) ───────────────────┐
 │  Capture UI  │  Local SQLite (encrypted,   │  Media files (device FS)            │
 │  talk/snap   │  owned): capture journal,   │  audio/video/photo                  │
 │  ≤2 taps     │  Captures, Dispositions…    │  → owned upload queue               │
 └───────┬───────────────────────┬───────────────────────────┬─────────────────────┘
         │ owned sync queue (pull/push over REST)              │ resumable upload (on wifi / cell+consent)
         ▼                        ▼                            ▼
 ┌───────────────── BACKEND (Supabase / raw Postgres) ─────┐   ┌─── Object storage ───┐
 │ Postgres (RLS multi-tenant) · Auth · Edge Fns           │   │ Supabase Storage (P1) │
 │ tenants, projects, members, captures, dispositions,     │◀──│ TUS resumable         │
 │ decisions, resolutions, translations-cache, usage       │   │ client-encrypted      │
 └───────┬─────────────────────────────────────────────────┘   │ (R2 = P1.5 egress opt)│
         │                                                     └──────────────────────┘
         │ new capture / sync event
         ▼
 ┌──────────────── PROCESSING PIPELINE (durable jobs: Trigger.dev/Inngest) ─────────┐
 │ ingest → STT (gpt-4o-mini-transcribe) → detect lang → translate→canonical_en     │
 │ → structure into disposition draft (cheap LLM)  [no video: extracted on-device]  │
 │ → resolve project (GPS+content) → write results + cache → emit notifications     │
 │ idempotent · resumable · per-step retries · usage metered                        │
 └───────┬───────────────────────────────┬─────────────────────────────────────────┘
         ▼                                ▼
 ┌─ AI services ─┐               ┌─ Comms/identity ─┐
 │ OpenAI STT    │               │ Twilio Verify(OTP)│  push: OneSignal/FCM/APNs
 │ Gemini Flash  │               │ Twilio SMS        │  no-login links: signed JWT
 │ -Lite (LLM)   │               └───────────────────┘
 └───────────────┘
```

**Invariant preserved end-to-end:** the client's capture + local write + confirm is complete with zero backend dependency; everything right of the sync arrow happens later, opportunistically, and is retriable.

---

## 3. Component design

### 3.1 Client (React Native + Expo — see ADR-1)
- **Capture layer:** native camera/mic plugins; stream audio/photo to device filesystem *as recorded* (chunked). **The commit sequence is the capture-commit state machine** (`DURABILITY-DESIGN-v1.md` Artifact 1) — **not** "write the row immediately, confirm on the local write," which was the pre-Codex-#6 wording and is superseded. Ordered: reserve capacity/permissions (or **refuse loudly**) → commit `STARTED` journal + sidecar manifest **before arming the recorder** (REQ-CAP8) → stream chunks with `(seq, hash)` → finalize + `fsync` file *and* parent dir → **verify** decodable/duration/hash → one SQLite transaction creating `Capture` + `Attachment` + the outbound mutation → **`MEDIA_COMMITTED`**. **Audible+visual "saved ✓" fires ONLY at `MEDIA_COMMITTED`** — media verified *and* the local transaction committed — never on the raw local write, and never on the upload. *(Codex #7: the SQLite-commit↔manifest-advance step is **not yet atomic**; the truth table for a crash between them is an **open protocol gap** — see `IMPLEMENTATION_NOTES §4`.)*
- **Video is transient — never retained or uploaded after successful extraction (resolves C1; wording corrected per Codex #6 C6).** Video is a *capture medium*, not a durable asset. On the device, a **2-step on-device extraction** runs after a video capture: (1) demux the **audio track** (→ transcription like any voice capture), (2) extract **key still images** (user-marked timeline frames + periodic/scene-sampled frames). Only the **audio + the stills** are retained and synced. **The raw video IS held as an encrypted, journaled temporary asset** — it must be, or a crash mid-record/mid-extraction would lose the capture outright (REQ-CAP6 mid-video recovery). It is retained until the derived audio + stills are **finalized, verified, and registered**, and only then deleted via a **recoverable cleanup state**. It is never uploaded. Result: storage drops from ~50–130 MB/min to a few MB, and uploads are small (helping C3). *Note: on-device extraction is cheap, deterministic media work (native/ffmpeg-lite) — it does **not** violate "no on-device ML"; transcription/translation/structuring still happen in the cloud. Evidentiary trade-off (accepted): the continuous video isn't retained; the record is audio + timestamped stills + transcript — cheaper and still strong (the CompanyCam photo+audio evidence model).* `[✅ hadar]`
- **Local store (P1 = owned SQLite, not PowerSync):** an **encrypted SQLite** database on device is the offline source of truth for all relational data (projects, captures, dispositions, decisions). Reads/writes are local and instant. Sync is **our own queue**, not a streaming engine: (1) a **write-ahead capture journal** (REQ-CAP8) records that a capture began before any media is finalized or any network call is made; (2) a **push queue** ships local mutations to Postgres via Edge-Function/REST endpoints on a qualifying connection, with idempotency keys + server-side dedup/merge; (3) a **pull** step refreshes the role-scoped working set (Active projects + last-N-days) on reconnect. This is the three-layer durability the spec already requires, owned end-to-end. *[PowerSync deferred to P1.5+ — see banner.]*
- **Windowed working set from v1.** The device holds only **Active projects + last-N-days of notifications/history**; cold/archived history is fetched on demand. This caps device SQLite growth and keeps pull cheap. *(P1.5+ note: if PowerSync is ever adopted, this becomes its windowed, data-parameterized sync rules — near-immutable, grants/roles via rows never rule text — because a sync-rule deploy re-replicates the whole DB; greenlight MF-4. Not applicable to the P1 owned queue, which has no global rule redeploy.)*
- **Media queue (owned):** a **durable resumable upload queue** — survives app kill, tracks per-file state → drives the REQ-PROC6 "saved / waiting for Wi-Fi / uploading" status. Built and owned (no dependency on PowerSync's experimental Attachments helper); uploads **client-encrypted ciphertext** (DECISION 4) to **Supabase Storage** via TUS resumable + authorized issuance (§3.3).
- **Offline everything:** capture, project create, list/search/nearby all run against local SQLite (satisfies REQ-PROC7). Display renders in the user's `preferred_language` from the local cache.
- **Thin by design:** no ML on device; the client captures, stores, displays, and syncs. This is what keeps it buildable and cheap.

### 3.2 Backend — Supabase (Postgres-centric)
- **Postgres** is the system of record; the relational model (`Capture` / `Disposition` / `Decision` / `ProjectParty` / `Member` / `Resolution` / translations-cache) maps 1:1.
- **Auth:** Supabase Auth for owner/manager accounts (the paying users); **magic-link / signed-token** access for no-login counterparties (homeowners) and invited collaborators.
- **One authorization model for ALL access paths — canonical in Postgres (greenlight MF-2, reconciled to Codex #6 C7).**

  > **Superseded wording (Codex #7).** MF-2 previously read as *"a single membership/grant predicate … every path calls or is generated from it,"* implemented as shared Hono middleware. Codex #6 C7 is correct that this is fictitious: TypeScript middleware **cannot be** the same implementation as Postgres RLS, and "calls or is generated from it" is not a design. A top-level `org_id` check also misses nested resources.

  **The canonical authorization functions live in Postgres** — `can_read(actor, resource)`, `can_append(actor, record)`, `can_approve(actor, record)`. **RLS policies call these functions, and service-role code (Edge Functions, jobs) calls the same functions explicitly** — service-role bypasses RLS, so it must opt in. One source of truth, two callers. **Hono middleware is a convenience layer, not the root of trust.** **PostgREST is NOT publicly exposed** (all access via Edge Functions) to shrink the surface.
  - **Validate the whole chain, not the top:** actor → tenant membership → project membership/assignment → the specific capture/attachment/record belongs to that project. A nested `capture_id` from another tenant is rejected even when the top-level tenant matches.
  - **Paths, each with a negative test:** sync push/pull Edge Functions · **Postgres RLS** (`FORCE` on every tenant-bearing table, CI-checked) · all other Edge Functions (service-role → must call `can_*`) · upload/TUS issuance (re-check membership on the specific object every time) · the **homeowner read model** (dedicated whitelist read model, one-disposition-scoped JWT) · durable-job callbacks · the media **authorizing endpoint** (§3.3). **Negative tests:** collaborator-removed, cross-tenant `capture_id`, object-key enumeration, homeowner over-fetch, revoked-member pull (REQ-MEMBER-5).
  - **Deliverable:** a generated **policy matrix** (roles × resources × actions) checked in CI — a new endpoint can't ship without a row + a negative test.

  This is how "office sees all / field sees theirs / collaborator sees one project" is actually enforced. *(Codex #7 raises a further **OPEN** hardening step — revoking raw table DML from application roles so canonical mutation functions are the only write path, since "service-role must call `can_*`" is still a convention a new path can forget. Logged as an open protocol gap in `IMPLEMENTATION_NOTES §4`; not designed here.)* *(P1.5+ note: if PowerSync is adopted, its Sync Rules become a client boundary and must be generated from the same canonical functions, with a parity test vs RLS — greenlight C2.)*
- **Feed:** rendered from **local synced data** (a role-scoped local SQLite query; office web renders from its own pulled working set) — **not** Supabase Realtime `postgres_changes`, which is single-threaded under RLS (collapses ~100–300 companies) and leaks DELETE events. No `postgres_changes` subscription anywhere; freshness comes from the owned pull on reconnect + push notifications, not a streaming subscription. `[greenlight MF-3]`
- **Edge Functions:** thin API endpoints (sign a no-login link, issue an OTP, create an invite) + pipeline triggers.

### 3.3 Media storage — Supabase Storage (P1), client-side envelope encryption, authorized reads (MF-1 reconciled to DECISION 4 + DECISION 7, 2026-07-16)

> **Superseded wording (Codex #7).** This section previously specified *plaintext upload to an R2 quarantine prefix, server-side encryption at arrival, and "the client never holds DEKs."* All three contradict **DECISION 4 (Option B — per-capture-key envelope encryption)** and **DECISION 7 (Supabase Storage for P1)**, both LOCKED 2026-07-16 in `DURABILITY-DESIGN-v1.md`. The design below is the locked one. **The client DOES hold per-capture keys — that is the design.**

- **Provider (DECISION 7):** **Supabase Storage for P1** (one vendor; Spike A is already all-Supabase; **TUS resumable uploads** with usable background support; integrated auth). **Cloudflare R2 is deferred to P1.5** as the egress optimization once media volume (video playback) justifies a second vendor. P1 is voice-first (small audio), so egress is not yet the cost driver. Both sit behind the **`RemoteStorage` interface**, which must abstract *issuance / resume-token / part-state / checksum / abort / finalize / orphan-cleanup* — **not just `put()`** — because TUS and S3-multipart are not an isolated swap (Codex #6 H6). **The full fault suite runs against the P1 provider** — no "swap later, test later."
- **Uploads (DECISION 4 — Option B):** each capture gets its own **data key (DEK)**, generated **on-device**. Media chunks are **encrypted client-side**; the **ciphertext is uploaded unchanged** to an immutable content-addressed object key (`{tenant_id}/{capture_id}/{asset_type}/{sha256}.{ext}`, hashed over the exact ciphertext bytes). Background upload therefore never needs the plaintext or even the key — it just ships bytes. **No plaintext quarantine prefix; no server-side encryption at arrival.**
- **Key wrapping:** the DEK is wrapped (a) by a **device master key** in Keychain/Keystore and (b) for the **server ingest identity**. The server **unwraps without persistent plaintext staging**. Wrapping for the server is also what lets a *synced* capture survive device key-loss.
- **Reads:** **no direct presigned GET.** All media reads go through a short-lived **authorizing endpoint** that re-checks authorization (§3.2) and streams. *(Concept unchanged from MF-1; it now sits on Supabase Storage rather than R2-behind-a-Worker.)*
- **Crypto-shred** stays the erasure mechanism: destroy the wrapped DEK and the object is unreadable everywhere the key never went. *(Scope limit, per Codex #7: shredding the media DEK does **not** by itself erase transcripts, translations, thumbnails, exports, AI-provider copies, or backups — the full erasure surface is an **open protocol gap**, see `IMPLEMENTATION_NOTES §4`.)*

### 3.4 Processing pipeline — durable jobs (Trigger.dev or Inngest — ADR-3)
Triggered when a capture syncs. A **durable, idempotent, resumable** multi-step function:
1. Ingest media (from **Supabase Storage**) — the object is **client-encrypted ciphertext** (DECISION 4); the job unwraps the per-capture DEK via the server ingest identity and decrypts **without persistent plaintext staging**.
2. **Transcribe** (OpenAI `gpt-4o-mini-transcribe`, ~$0.003/min; Deepgram as alt).
3. **Detect language**; keep `original` + `source_language`.
4. **Translate → `canonical_en`** (cheap LLM) + write to the translations cache.
5. **Structure** into a disposition draft (decision card / CO fields) — cheap LLM with domain prompts + confidence per field; numbers flagged for confirmation.
6. **Video:** *(nothing here — video is extracted to audio + stills **on the device** (§3.1) and never uploaded; the pipeline only ever receives audio + images. This removes server-side ffmpeg for video and its serverless memory/cost risk — resolves critic M3.)*
7. **Resolve project** (GPS + content signals → existing or new-proposal, confirm-gated).
8. Write results, bump `content_version`, **emit notifications**, **meter usage**.
Every step retries independently; a failure parks the job and surfaces the REQ-PROC6 reason. Managed durable-jobs platforms (Trigger.dev/Inngest) give a solo dev retries/idempotency/observability for free.

### 3.5 AI services
- **Transcription:** OpenAI `gpt-4o-mini-transcribe` (multilingual incl. Spanish); Deepgram as a fallback / for any on-device rough draft later. Domain vocabulary/number biasing.
- **Translate + detect + structure:** a cheap LLM — **Gemini 2.5 Flash-Lite** ($0.10/$0.40 per M tok) or GPT-5 nano. Prompts carry the construction/Spanglish lexicon; numbers/prices are never auto-committed (confirm UX).
- All AI is **server-side and swappable** behind an interface — model prices move monthly; don't hard-couple.

### 3.6 Language subsystem
- `canonical_en` is the indexed working copy; `original`+`source_language` immutable; `translations{lang→{text,translated_at,source_version}}` cache; `content_version` invalidates stale translations. Signed `shown_content` is frozen and exempt (per C1/M4 fixes).
- **Search:** Postgres full-text search on `canonical_en`; a user's query is translated to English first, results rendered in their language from cache. pgvector later for semantic + voice retrieval.

### 3.7 Identity & signatures
- **Binding signature:** Twilio **Verify** (SMS OTP to the number the contractor entered) + typed legal name + timestamp + **hash of the frozen `shown_content`**. Distinct from the light no-identity confirm.
- **No-login counterparty links:** short-lived **signed JWT** tokens scoped to one disposition; the homeowner opens, sees the Page in their language, confirms/signs — no account.

### 3.8 Notifications
- **Push** (OneSignal or direct FCM/APNs) for in-app/free notifications (approval requests, feed, assignments) — keeps cost near zero.
- **SMS** (Twilio) reserved for the **binding OTP** and critical off-site delivery, metered per pricing tier.

### 3.9 Erasure, consent, evidence integrity
- **Crypto-shred erasure:** destroy the media's per-record data key + tombstone the row, retaining `{hash, metadata_stub, erased_at, basis}` — the one immutability carve-out.
- **Consent:** `recording_consent` + `cellular_consent` state stored on Project/Member; enforced client-side (no audio capture without recording consent) and server-side.
- **Evidence integrity:** **server trusted timestamp** written at upload + content hash (the honest, corroborated version of "tamper-evident" — fixes critic M5).

### 3.10 Usage metering (drives pricing — revised per greenlight)
- Per-tenant counters: **decisions**, **SMS**, **transcription minutes**, **storage GB**, **active projects**. Enforces Free caps (2 projects × 15 decisions) and Core/Crew allowances; also the cost-observability that keeps margins honest.
- **Transcription minutes are enforced, not just observed (greenlight fix):** the *cost* unit is captures (generated unbounded by free-forever crew), not decisions. On **Free, processing is lazy** — audio is stored durably at capture (never lost), transcription runs on first view/first decision, and a monthly minute allowance applies. Captures are never rejected or lost to a cap (M1 holds); *processing* is what defers.
- Tier-jump thresholds (Supabase compute/connections, object-storage volume, push-subscription caps) live on the metering dashboard so platform upgrades are deliberate, not surprises.

---

## 4. The stack (recommended)

| Layer | Choice | Why | Alternative |
|---|---|---|---|
| Mobile client | **React Native + Expo** (ADR-1) | Builder is strongest in TS/React; shares code with a React/Next **web** app (office/feed); first-class Supabase SDKs | Flutter (better native-media defaults) |
| Web (office/feed + homeowner page) | **React / Next.js** (shared TS monorepo) | Shares types/validation/logic with RN; office back-office + feed + no-login pages | — |
| Local store | **Encrypted SQLite (owned)** | Offline source of truth on device; instant local reads/writes; solo-debuggable, no experimental-API risk | PowerSync (P1.5+ if multi-device relational sync earns it), WatermelonDB |
| Sync (P1) | **Simple owned queue** | Write-ahead capture journal (REQ-CAP8) → durable resumable upload queue → reconnect push/pull over REST/Edge Fns; idempotent + server dedup/merge; the one thing we most need to own | PowerSync streaming sync (deferred), ElectricSQL |
| Offline media | **Owned upload queue** | Resumable, survives kill, per-file state → REQ-PROC6 status; uploads via presigned/authorized issuance | PowerSync Attachments (experimental) |
| Backend data/auth | **Supabase (raw Postgres)** — Auth, RLS, Edge Fns, Storage | Relational fit, RLS = multi-tenant + collaborators in the DB, managed, TS/RN SDKs | Firebase (NoSQL, weaker relational/RLS), Xano |
| API runtime + framework | **Supabase Edge Functions (Deno)** + **Hono + zod** (ADR-5) | Nothing to host, next to the DB, keys server-side; one router + shared middleware (MF-2 authz) + typed; Hono portable Deno↔Node so runtime is reversible | Self-hosted Node service (Hono/Fastify on Fly/Railway/Render) |
| Language | **TypeScript everywhere**, one monorepo | Client+web+API+jobs one language; shared types/zod; solo-dev fluency | — |
| Object storage | **Supabase Storage (P1 — DECISION 7, LOCKED 2026-07-16)** | One vendor (Spike A is all-Supabase), TUS resumable + background support, integrated auth; P1 is voice-first so egress isn't the cost driver yet. **R2 = P1.5** egress optimization; `RemoteStorage` abstracts issuance/resume/part-state/checksum/finalize (not just `put()`) so the swap is bounded | Cloudflare R2 (deferred to P1.5), S3 |
| Processing jobs | **Trigger.dev / Inngest** (ADR-3) | Durable, idempotent, retriable multi-step AI pipeline; solo-friendly | Supabase Edge Fns + pgmq |
| Transcription | **OpenAI gpt-4o-mini-transcribe** | $0.003/min, multilingual/Spanish | Deepgram, Gladia |
| LLM (translate/structure) | **Gemini 2.5 Flash-Lite** / GPT-5 nano | Cheapest for high-volume, good enough w/ confirm UX | Llama on Groq, Haiku |
| Signatures/identity | **Twilio Verify** + signed JWT links | Binding SMS-OTP; no-login counterparty | Authgear, custom OTP |
| Push notifications | **OneSignal** (or FCM/APNs) | Free/cheap in-app notify | Expo Push (if RN) |
| Media processing | **ffmpeg** (in the job runtime) | audio + keyframe extraction | Mux/Cloudflare Stream |
| CI / distribution | **GitHub Actions** (Supabase CLI `functions deploy` on merge) + **EAS** (RN app builds) | Solo-friendly pipelines; Edge Functions deploy from CI, app via EAS | Fastlane |

---

## 5. Key decisions (ADRs)

**ADR-1 — React Native + Expo over Flutter (RESOLVED 2026-07-15).** *Context:* capture-heavy, offline-first, solo AI-assisted — and **hadar is strongest in TypeScript/React and wants a web surface (office back-office, feed) that shares code with mobile.** *Decision:* **React Native + Expo.** The deciding factors are the builder's TS/React strength (AI codegen is most reliable where the dev is fluent) and **code-sharing with a React/Next web app** (shared types, zod validation, business logic, API client) — a shared TS monorepo that Flutter can't match for web. PowerSync, Supabase, and every other component have first-class TS/RN SDKs, so the rest of the architecture is unchanged. *Trade-off accepted:* RN's native-media/background bits need more care than Flutter's (see C3 background-upload work in §11) — Expo config plugins + `react-native-background-upload`/`expo-background-task` cover it. *Confidence: high, given the builder profile.*

**ADR-2 — Supabase (raw Postgres) + APPEND-ONLY owned sync for P1 (RESOLVED 2026-07-16, hadar; was reopened by Codex #6 / H1).** *The **Supabase raw Postgres** half stands. The sync half is resolved to **append-only sync** — option (b) of the reopened fork — not a generic two-way merge engine and not PowerSync for P1. **The append-only law:** media (audio/images) is **immutable** (never merged/edited — we never merge an audio file); the only merge is at the **derived text/decision record** level after transcription (much simpler); originals are retained as **tamper-proof evidence**; and once a record is **digitally approved it is frozen** — changes are **new appended records/versions**, never in-place edits. So every sync operation is an **append of a new immutable row** (a capture receipt or a new version), never a mutation of an approved record. This dissolves most of Codex C5/H2 (no oplog-merge, no base/overlay reconciliation of mutable rows) — the pull becomes "give me new rows since checkpoint X," with tombstones only for windowing/revocation, not for edits. **PowerSync stays a P1.5+ option** if multi-device *mutable* relational sync ever earns it. The rest of this ADR is the original rationale for Postgres + owning the capture path:*  *Context:* device SQLite ↔ cloud Postgres, offline-first, solo AI-assisted, and a hard "never lose a capture" mandate. *Decision:* **Supabase raw Postgres** for the cloud (Auth, RLS, Edge Fns, Storage — Postgres + RLS models the multi-tenant/collaborator/relational reality far better than Firestore), and for P1 **a simple owned sync queue** (write-ahead capture journal → durable resumable upload queue → reconnect push/pull) rather than PowerSync's streaming engine. *Why not PowerSync for P1:* the ezQuotePro post-mortem (`CRITIC-REVIEW-05`) proved the never-lost failure mode is a **cloud-first capture path**, not a weak sync engine — so the durable thing to own is the *local-commit-before-network* transaction, which an owned queue makes fully debuggable by a solo dev with no experimental-API dependency (PowerSync Attachments is marked experimental). Owning the queue also **dissolves** the PowerSync-specific review findings (Sync-Rules↔RLS parity, sync-rule re-replication cost). *Trade-off accepted:* we hand-build queue durability, idempotency, and merge for P1 — a small, well-understood surface, and the one we most need control over. *Deferred:* **PowerSync to P1.5+**, reconsidered only when multi-device conflict-free *relational* sync (the collaborator feed at scale) actually earns it; the exit evidence is the foundation spike's kill/airplane/disk-pressure results. *Confidence: high, given the mandate and the builder profile.*

**ADR-3 — Managed durable jobs (Trigger.dev/Inngest) for the pipeline.** The processing chain is multi-step, must be idempotent + resumable + observable, and a solo dev shouldn't hand-roll a queue/worker/retry system. *Confidence: high; pick one after a small spike.*

**ADR-4 — Client stays thin (no on-device ML in v1).** Follows the locked process-on-reconnect decision; keeps the app small, cheap, cross-platform, and buildable. Revisit only if on-site-offline structured output becomes a hard requirement (U7).

**ADR-5 — TypeScript everywhere; API on Supabase Edge Functions (Deno) with Hono + zod (RESOLVED 2026-07-15, hadar).** *Context:* the client is TS (ADR-1) and a solo dev benefits from one language + one shared monorepo. *Decision:* **TypeScript across client, web, API, and jobs**, in one monorepo (RN/Expo app · Next web · shared packages for types/zod/the auth predicate · `supabase/`). The **API runs on Supabase Edge Functions (Deno)** — "nothing to host," endpoints next to the DB, and keys stay server-side as Edge Function secrets (the direct fix to ezQuotePro's client-side Deepgram key). The **API is structured with Hono + zod** — one router, shared middleware, typed end-to-end, optional OpenAPI — so it stays *manageable* as endpoints grow; **the single authorization predicate (MF-2) is implemented as shared Hono middleware** every route runs through, rather than a check copy-pasted into each function. *External LLM/STT calls:* Deno `fetch` reaches any external API; a **short single-shot** call may run in an Edge Function (LLM latency is I/O — the 2s **CPU** limit doesn't count waiting; wall-clock is 150s free / 400s paid), but the **multi-step capture-processing pipeline runs in the durable-jobs runtime (Node, ADR-3), never synchronously in an Edge Function**, because Edge Functions have no built-in retry/resume. *Trade-off accepted:* two runtimes (Deno API + Node jobs), both TypeScript. *Portability hedge (softened 2026-07-16 per Codex #6 H5):* Hono's **routing/handler code** runs on both Deno and Node, so the *route logic* is portable — but the claim of "no rewrite" was overstated: Deno environment APIs, Supabase bindings, deployment config, and background/queue semantics are runtime-specific and would need rework. So the runtime is *reduced-rewrite* reversible, not zero-rewrite. *Constraint (H5):* Edge Functions are acceptable only if the sync request is kept **small, bounded, and restartable** (256 MB / 2 s CPU / 150–400 s limits) — large pulls must page via stable cursors, mutations should apply via Postgres RPC/stored transactions, clients retry from persisted checkpoints. *Confidence: high on Supabase Postgres + TS; the runtime portability is a hedge, not a guarantee.*

---

## 6. Data-flow walkthroughs

**A. Offline capture → evidence → sync.** Tap → reserve capacity (or refuse loudly) → **commit `STARTED` journal + sidecar manifest before arming the recorder (REQ-CAP8)** → record (stream encrypted chunks to FS) → finalize + `fsync` file/dir → **verify** decodable+hash → **one SQLite txn** creates `Capture` + `Attachment` + outbound mutation → **`MEDIA_COMMITTED`** → *only now* audible+visual **"Saved on this phone ✓ — not backed up yet."** Offline: the **owned queue** holds the row + the attachment (the outbound mutation IS the queue entry, created in that same txn — no window where a capture is "saved" with no sync intent); status shows "waiting for Wi-Fi." On qualifying connection: the **client-encrypted ciphertext** uploads to **Supabase Storage** (TUS resumable), the push queue syncs the mutation to Postgres (idempotent, stable mutation ID), pipeline runs (transcribe→translate→structure→resolve), a pull brings results back, status → "Backed up ✓" then "ready." *(See `DURABILITY-DESIGN-v1.md` Artifact 1 for the full state machine + recovery table.)*

**B. Decision → binding signature.** Captured decision → structured draft → sender confirms numbers → sends to homeowner as a no-login signed link → homeowner opens the Page *in their language* → Twilio Verify OTP + typed name → server freezes `shown_content` + hash + trusted timestamp → immutable approval record → instigator notified (push).

**C. Cross-language search.** Spanish query → translated to English → Postgres FTS on `canonical_en` → results rendered back in Spanish from the translations cache. One English index; every user in their own language.

---

## 7. How this answers the critic's hard points
- **Never-lost + offline sync (U1/U-SYNC, H5):** owned local-first SQLite + capture journal + resumable upload queue; server-side dedup/merge on push for concurrent offline project creation.
- **Signature identity (C2):** Twilio Verify OTP + name + hash — a real binding artifact, not a naked link.
- **Erasure vs immutability (C3):** envelope encryption + crypto-shred + tombstone stub.
- **English-canonical authority (C1/M4):** frozen `shown_content` is the signed instrument; English is an index; translations cache exempts signed records.
- **Cost floor (pricing):** cheap STT/LLM, small media footprint (voice-first; on-device video extraction), push-not-SMS, per-tenant metering. *(R2 zero-egress = P1.5 lever.)*
- **Evidence integrity (M5):** server trusted timestamp + hash on upload.

---

## 8. Solo build order (aligns to P1 → P1.5)
1. **Skeleton + sync spine (ADR-2 spike / "Spike A"):** React Native (Expo) + Supabase (raw Postgres) + **the owned SQLite + queue** in a TS monorepo (shared with the web app); one row + one attachment round-trip offline→online **with native background upload proven on a real device** (C3), and the kill/airplane/disk-pressure durability tests that are this spike's exit gate. *This is the foundation everything rides on — do it first (matches SPEC M0).*
2. **Capture + local durable + confirm + fault recovery** (P1 M1/M-A) — the trust anchor.
3. **Media attachments queue + status/reason** (REQ-PROC6/7).
4. **Processing pipeline v1** (Trigger.dev spike): transcribe → English canonical → structure a decision draft. *Run the cheap AI-accuracy spikes here (U3/U4) since P1 now carries AI.*
5. **Project resolution** (GPS first; content detection next).
6. **Validation loop + no-login link + push** (needs the minimal delivery channel — critic H2).
7. **Then P1.5 handlers:** signature (Twilio Verify), change order/mini-CO, reports, collaborators (RLS grants), language cache + pivot search, metering + billing.

---

## 9. Open decisions · risks · what to validate
1. ~~**ADR-1: Flutter vs React Native**~~ **RESOLVED — React Native + Expo (ADR-1).** ~~**ADR-2: PowerSync vs owned queue**~~ **RESOLVED — Supabase raw Postgres + owned queue for P1, PowerSync deferred (ADR-2).** Both database forks are now closed.
2. ~~**Object storage:** start Supabase Storage (one vendor) or go straight to R2 (cheaper video)?~~ **✅ RESOLVED 2026-07-16 — DECISION 7: Supabase Storage for P1; R2 = P1.5 egress optimization.** See §3.3 / `DURABILITY-DESIGN-v1.md` Artifact 7.
3. **Jobs platform:** Trigger.dev vs Inngest vs Supabase-native (pgmq/Edge Fns) — pick after a spike. *(still open)*
4. **Risks:** owning the sync queue means we own its correctness — kill/airplane/disk-pressure durability + idempotent merge must be proven on a real device in Spike A (this is the point of doing it first); ffmpeg in serverless can be heavy (fallback: a small dedicated worker/container or Cloudflare Stream); background upload on iOS/Android has OS constraints (validate early — it's core to never-lose-it).
5. **Validate next (Spike A):** a **RN + Supabase + owned-SQLite/queue** offline→online round-trip with kill-tests; a Trigger.dev (or Edge Fn) transcribe→structure spike; iOS/Android background-upload behavior.
6. **P1.5+ trigger for PowerSync:** revisit only when multi-device conflict-free *relational* sync (the collaborator feed at scale) demonstrably strains the owned pull/push model.

---

## 10. Verification
Per the protocol: this architecture should get a **second-model (Codex) adversarial pass** before build — focused on the offline sync/dedup model, the RLS multi-tenant + collaborator policies, background-upload reliability, and the crypto-shred erasure design. External signal already pulled (PowerSync/Supabase maturity, Flutter/RN, AI + storage costs); the remaining validation is the three spikes in §9.

## 11. Critic reconciliation (v1.1 — after `CRITIC-REVIEW-02.md`)

The architecture claimed three things it didn't fully deliver; corrected here.

- **C2 — Authorization: the sync pull/push endpoints are the real client boundary, RLS is defense-in-depth.** In the P1 owned-queue model, what reaches a device is decided by the **sync Edge Functions** — which call the **single membership/grant predicate** — not by RLS (RLS never runs on-device). Every path (§3.2) is generated from or calls that one predicate so they can't drift; negative tests per role cover *collaborator-removed* and *homeowner*; `FORCE` RLS on **every** project-hung table as defense-in-depth. *(P1.5+ note: if PowerSync is adopted, its **Sync Rules** become the client boundary and must be generated from the same predicate, with a parity test diffing "what Sync Rules deliver" vs "what RLS permits" per role — the parity problem only exists in the PowerSync model.)*
- **C3 — Background upload is real native work, and the promise is honest until it's proven.** The attachment *queue* survives an app kill, but the *transfer* does not without **iOS background `URLSession` + Android `WorkManager`** (`react-native-background-upload` / `expo` background tasks) and **S3-multipart part-state** persisted locally for true resume on weak links. Until proven on real devices, the client says "**saved locally ✓; uploads when you next have connection and open the app**." This is the single most load-bearing native task — validated in the §8 step-1 spike.
- **H1 — Erasure = two data classes.** Blob → crypto-shred (destroy per-record key). Indexed plaintext (`canonical_en`, transcripts, payloads) → **hard-delete + tombstone in Postgres** + a **device-purge command** the owned pull delivers on next connect. **Documented residual:** data on devices that never reconnect (incl. a removed collaborator) can't be reached — keep collaborators *synced-with-purge-pending* rather than dropping the bucket at grant-end, and state the residual in the privacy policy.
- **H2 — Pipeline idempotency.** Idempotency key = `(capture_id, content_version)` on every external AI call and the disposition write (UPSERT); the durable-job platform key set to the same. Gate: "re-fire same capture twice → one disposition, one charge."
- **H3 — Merge is a server-owned job, not "PowerSync conflict handling."** A server merge uses a **tenant-scoped** clustering key (two different companies at one address must NOT merge), re-points children, and **reconciles the losing device**. Concurrent `Decision.current_value` edits **append both to `value_history` and surface a conflict** — never silent LWW.
- **H4 — Pipeline triggers on attachment-SYNCED, not row-sync.** Fire from the attachment queue's SYNCED transition (or a server-observed storage object), so step-1 never 404s on media still uploading; capture↔object-key linkage syncs atomically; an orphan sweep reconciles rows-without-media and objects-without-rows.
- **H5 — Twilio A2P 10DLC is on the critical path (lead-time, not code).** Register brand + campaign early; **email-OTP / authenticated-link fallback** so the binding signature isn't single-threaded on carrier approval.
- **M1 — Free-cap never rejects synced data.** Always accept synced captures; enforce the cap by **gating new local creation pre-emptively** when the device knows it's over cap, and **locking over-cap projects until upgrade** — data is never lost to a paywall.
- **M2/M5/M6 — smaller fixes:** timestamp via a storage-arrival event (or honestly = row-sync time); the homeowner Page is a **dedicated read model** with a field whitelist + one-disposition-scoped JWT (not a live-schema join); offline **jurisdiction** via a bundled on-device state-polygon lookup, defaulting to strictest (two-party) when unknown.

**C1 + M3 — RESOLVED by "don't store video" (hadar).** Video is a transient capture medium: on-device 2-step extraction → store only **audio + key stills**, discard the raw video (§3.1). Storage drops to near-zero (the free-user cost floor holds and video needn't be a paid-only feature), server-side ffmpeg for video is eliminated (M3 gone), and uploads shrink from tens-of-MB videos to a few MB of audio+stills — which also **eases C3** (background upload). Remaining C-series item resolved; only the on-device extraction reliability needs proving in the §8 spike. Evidentiary trade-off (accepted): the continuous video isn't kept; the record is audio + timestamped stills + transcript.

## 12. Greenlight-gate reconciliation (v1.2 — after `CRITIC-REVIEW-03.md`, the fable cross-model review)

**Verdict: FIX-FIRST → GO.** The seven must-fix items are now applied (this section + the edits above + SPEC/PRICING changes); the foundation spike is greenlit.

Applied in this document: **MF-1** envelope encryption + authorized reads, no presigned GET (§3.3) — ***reconciled 2026-07-16 to DECISION 4 (Option B): encryption is CLIENT-side with per-capture DEKs and ciphertext uploaded unchanged, NOT server-side-at-arrival; the original MF-1 "server encrypts / client never holds DEKs" wording is superseded*** · **MF-2** one authorization model across every path + negative tests + FORCE-RLS CI check (§3.2) — ***reconciled 2026-07-16 to Codex #6 C7: the canonical predicate lives in POSTGRES FUNCTIONS, not in shared TS middleware; Hono middleware is a convenience layer, not the root of trust*** · **MF-3** feed rendered from local synced data; `postgres_changes` banned (§3.2) · **MF-4** windowed working set from v1 (P1 owned queue; the near-immutable data-parameterized sync-rule form applies only if PowerSync is later adopted) (§3.1) · metering enforces transcription minutes + lazy Free processing (§3.10). Applied in SPEC: **MF-5** P1 delivery = email + SMS, 10DLC starts at kickoff (REQ-VAL8) · **MF-6** one-confirm-surface + unclassified-evidence degradation (REQ-VAL6/VAL4, §4) · **MF-7** P1 ES localization (REQ-X2) + consent at job creation, never capture-time (REQ-CON1) · send-path touch budget ≤3 (REQ-X1) · one collapsed status (REQ-X3). Applied in PRICING: honest repricing (~60–70% blended margin), Verify/R2/jobs/platform-floor lines, Free minute allowance.

**Fix-during-build register (scheduled into the build, tracked in CRITIC-REVIEW-03):** JWT link expiry/one-time/revoke-on-resend · SQLCipher + Keychain/Keystore + expo-secure-store · instant Sync-Rule revocation at grant-end + don't sync raw homeowner audio to collaborator devices · Twilio Fraud Guard + SIM-swap Lookup + per-tenant send caps · AI sub-processor DPAs + `tenant_id` asserted at every pipeline write + global-UUID capture_id · translations cache normalized to a child table with per-language buckets (not JSONB-on-row) · parked-jobs auto-drain (error taxonomy, wired Deepgram failover, bulk re-drive, rate-based alerts) · pipeline collapsed to 2–3 durable checkpoints · additive-only migrations + N-versions-back upload tolerance · first-capture-≤N-interactions first-run budget · free-cap lock = read-only + export always · "recorded agreement — not a signature" labeling · Expo Push as the OneSignal fallback.

**Evidence-grade register (before signatures carry legal dispute weight):** WORM/anchored audit substrate (RFC-3161/transparency-log anchoring of `shown_content` hashes) · independent homeowner identity association · offline-stamp divergence flags.

## Sources
- [PowerSync + Supabase offline-first](https://powersync.com/blog/offline-first-apps-made-simple-supabase-powersync) · [PowerSync Attachments (offline file uploads)](https://powersync.com/blog/building-offline-first-file-uploads-with-powersync-attachments-helper) · [Supabase + PowerSync guide](https://docs.powersync.com/integrations/supabase/guide)
- [Flutter vs React Native 2026](https://tech-insider.org/flutter-vs-react-native-2026/) · [Flutter for AI-powered apps](https://appmatictech.com/insights/flutter-vs-react-native-ai-apps/)
- Cost sources in `ezjobsite-pricing-strategy.md` (STT, LLM, storage, SMS).
