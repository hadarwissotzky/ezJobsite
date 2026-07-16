# EZjobsite — Architecture & Stack (v1)

> 🔷 **DATABASE DECISION LOCKED 2026-07-15 — read this before the PowerSync content below.** The sync engine is now settled and it is **NOT PowerSync for P1**. Locked: device store = **SQLite (encrypted)**; cloud = **Supabase (raw Postgres)** — Auth, RLS, Edge Functions, Storage; sync for P1 = **a simple owned queue** (device write-ahead capture journal per REQ-CAP8 → durable resumable upload queue → reconnect processing queue). **PowerSync is deferred to P1.5+**, adopted only if multi-device conflict-free *relational* sync (the collaborator feed) earns it. Throughout this document, wherever it says "PowerSync local SQLite / streaming sync / Sync Rules / Attachments," read the **owned-queue equivalent** for P1: our own SQLite + our own upload/sync queue, with authorization enforced by **Postgres RLS + Edge-Function checks + presign re-checks** (there are no client-side PowerSync Sync Rules in P1, so the "Sync-Rules↔RLS parity" findings are **dissolved**, not open). ADR-2, the §2 diagram, the §5 stack table, §3.1, and §3.2's feed have been updated to reflect this; deeper PowerSync-specific passages (C2 parity, sync-rule re-replication) are retained only as **P1.5+ notes** for the day PowerSync is reconsidered. Rationale + trade-off: `IMPLEMENTATION_NOTES.md` §2 (2026-07-15 DATABASE LOCKED) and `MVP-RECONCILIATION.md` §4. *[hadar, verified key decision]*

*Derived from the full use-case suite (`MASTER-USE-CASES.md`, 62+ use cases across ~13 layers) and the locked decisions. Optimized for: offline-first never-lose-it, process-on-reconnect, cheap to run, and buildable by a solo AI-assisted developer on managed services. Prepared 2026-07-15. External signal: Supabase(Postgres)+SQLite+owned-queue offline stack; RN+Expo for a shared TS web/mobile codebase (ADR-1). Stack choices are locked except where flagged.*

---

## 1. Architectural drivers (use cases → what the architecture must do)

| Requirement (source) | Architectural implication |
|---|---|
| Never lose a capture; offline-forward (mandate #1/#7, REQ-CAP/PROC) | **Local-first**: media to device filesystem + metadata to on-device SQLite *before* any network; durable resumable upload queue. The single dominant driver. |
| Process on reconnect, no heavy on-device ML (locked) | **Cloud processing pipeline** triggered by sync; client stays thin. Client does capture + display only. |
| Multimodal + timeline (REQ-CAP/TL) | Media files as attachments keyed to a `Capture`; timeline offsets as metadata rows; ffmpeg keyframe/audio extraction server-side. |
| English-canonical + per-user display + cache + pivot search (LANGUAGE) | Store `canonical_en` + `original` + `translations` cache in Postgres; FTS index on `canonical_en`; translate query→EN. |
| Handler model (Evidence/Approval/CO/Report/Checklist) | One `dispositions` table with a `type` + typed JSON payload; handlers are server functions, not new schemas. |
| Multi-tenant + collaborators + roles (PM) | Postgres **Row-Level Security** keyed by tenant + project membership; `author{user,org,role}` on every row; cross-org grants for collaborators. |
| Digital signature = SMS-OTP identity (locked C2) | Twilio Verify + typed legal name + frozen `shown_content` hash; no-login counterparty links via signed tokens. |
| Notifications (push + SMS) | Push for free/in-app; SMS reserved for binding OTP (cost control per pricing). |
| Cheap unit economics (pricing) | Cheapest AI models; R2/zero-egress media; meter decisions + SMS per tenant. |
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
 │ Postgres (RLS multi-tenant) · Auth · Edge Fns           │   │ Cloudflare R2         │
 │ tenants, projects, members, captures, dispositions,     │◀──│ (or Supabase Storage) │
 │ decisions, resolutions, translations-cache, usage       │   │ zero-egress media     │
 └───────┬─────────────────────────────────────────────────┘   └──────────────────────┘
         │ new capture / sync event
         ▼
 ┌──────────────── PROCESSING PIPELINE (durable jobs: Trigger.dev/Inngest) ─────────┐
 │ ingest → STT (gpt-4o-mini-transcribe) → detect lang → translate→canonical_en     │
 │ → structure into disposition draft (cheap LLM) → video: ffmpeg audio+keyframes   │
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
- **Capture layer:** native camera/mic plugins; stream audio/photo to device filesystem *as recorded* (chunked); write the `Capture` row to local SQLite immediately; enqueue the media file. Audible+visual save confirm fires on the local write, not the upload.
- **Video is transient — never stored (resolves C1).** Video is a *capture medium*, not a stored asset. On the device, a **2-step on-device extraction** runs after a video capture: (1) demux the **audio track** (→ transcription like any voice capture), (2) extract **key still images** (user-marked timeline frames + periodic/scene-sampled frames). Only the **audio + the stills** are stored and synced; the **raw video is discarded** once extraction completes. Result: storage drops from ~50–130 MB/min to a few MB, and uploads are small (helping C3). *Note: on-device extraction is cheap, deterministic media work (native/ffmpeg-lite) — it does **not** violate "no on-device ML"; transcription/translation/structuring still happen in the cloud. Evidentiary trade-off (accepted): the continuous video isn't retained; the record is audio + timestamped stills + transcript — cheaper and still strong (the CompanyCam photo+audio evidence model).* `[✅ hadar]`
- **Local store (P1 = owned SQLite, not PowerSync):** an **encrypted SQLite** database on device is the offline source of truth for all relational data (projects, captures, dispositions, decisions). Reads/writes are local and instant. Sync is **our own queue**, not a streaming engine: (1) a **write-ahead capture journal** (REQ-CAP8) records that a capture began before any media is finalized or any network call is made; (2) a **push queue** ships local mutations to Postgres via Edge-Function/REST endpoints on a qualifying connection, with idempotency keys + server-side dedup/merge; (3) a **pull** step refreshes the role-scoped working set (Active projects + last-N-days) on reconnect. This is the three-layer durability the spec already requires, owned end-to-end. *[PowerSync deferred to P1.5+ — see banner.]*
- **Windowed working set from v1.** The device holds only **Active projects + last-N-days of notifications/history**; cold/archived history is fetched on demand. This caps device SQLite growth and keeps pull cheap. *(P1.5+ note: if PowerSync is ever adopted, this becomes its windowed, data-parameterized sync rules — near-immutable, grants/roles via rows never rule text — because a sync-rule deploy re-replicates the whole DB; greenlight MF-4. Not applicable to the P1 owned queue, which has no global rule redeploy.)*
- **Media queue (owned):** a **durable resumable upload queue** — survives app kill, tracks per-file state → drives the REQ-PROC6 "saved / waiting for Wi-Fi / uploading" status. Built and owned (no dependency on PowerSync's experimental Attachments helper); uploads to R2/Supabase Storage via presigned/authorized issuance (§3.3).
- **Offline everything:** capture, project create, list/search/nearby all run against local SQLite (satisfies REQ-PROC7). Display renders in the user's `preferred_language` from the local cache.
- **Thin by design:** no ML on device; the client captures, stores, displays, and syncs. This is what keeps it buildable and cheap.

### 3.2 Backend — Supabase (Postgres-centric)
- **Postgres** is the system of record; the relational model (`Capture` / `Disposition` / `Decision` / `ProjectParty` / `Member` / `Resolution` / translations-cache) maps 1:1.
- **Auth:** Supabase Auth for owner/manager accounts (the paying users); **magic-link / signed-token** access for no-login counterparties (homeowners) and invited collaborators.
- **One authorization module for ALL access paths (greenlight MF-2).** A single membership/grant predicate is the sole source of authorization truth, and **every** path calls or is generated from it. In the P1 owned-queue model the paths are: the **sync pull/push endpoints** (the real client-side boundary — Edge Functions that call the predicate to decide what a device may read and write; there are **no** client-side PowerSync Sync Rules in P1, so the Sync-Rules↔RLS parity problem does not exist), **Postgres RLS** (defense-in-depth — `FORCE` on every tenant-bearing table, CI-checked), **all other Edge Functions** (which run service-role and bypass RLS — a missing check there is a full breach), **presign/upload issuance** (re-check membership on the specific object every time), the **homeowner read model** (dedicated whitelist read model, one-disposition-scoped JWT), and the media **authorizing endpoint** (§3.3). **Negative tests per path**: collaborator-removed, cross-tenant `capture_id`, object-key enumeration, homeowner over-fetch. This is how "office sees all / field sees theirs / collaborator sees one project" is actually enforced. *(P1.5+ note: if PowerSync is adopted, its Sync Rules become the client boundary and must be generated from this same predicate, with a parity test vs RLS — greenlight C2.)*
- **Feed:** rendered from **local synced data** (a role-scoped local SQLite query; office web renders from its own pulled working set) — **not** Supabase Realtime `postgres_changes`, which is single-threaded under RLS (collapses ~100–300 companies) and leaks DELETE events. No `postgres_changes` subscription anywhere; freshness comes from the owned pull on reconnect + push notifications, not a streaming subscription. `[greenlight MF-3]`
- **Edge Functions:** thin API endpoints (sign a no-login link, issue an OTP, create an invite) + pipeline triggers.

### 3.3 Media storage — Cloudflare R2, server-encrypted, authorized reads (revised per greenlight MF-1)
- **Uploads:** client → presigned PUT to a **quarantine prefix** → the ingest pipeline **encrypts server-side at arrival** (per-record DEK, wrapped and stored in a `media_keys` table; master key in a **real KMS** with rotation) and moves the object to its permanent key. The client never holds DEKs.
- **Reads:** **no direct presigned GET.** All media reads go through a short-lived **authorizing endpoint** (R2 behind a Worker) that re-checks the membership predicate (§ authz module below), decrypts, and streams. This is what makes **crypto-shred real**: destroy the wrapped DEK and the object is gone everywhere the key never went — which is everywhere.
- R2 for zero-egress; wired behind the `RemoteStorage` interface so the vendor stays swappable. *(The previous "presigned GET + envelope encryption" design was self-contradictory — greenlight review C1/B1.)*

### 3.4 Processing pipeline — durable jobs (Trigger.dev or Inngest — ADR-3)
Triggered when a capture syncs. A **durable, idempotent, resumable** multi-step function:
1. Ingest raw media (from R2).
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
| Object storage | **Cloudflare R2** (start on Supabase Storage) | Zero egress → cheap video; swappable behind RemoteStorage | S3, Supabase Storage |
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

**ADR-2 — Supabase (raw Postgres) + an owned sync queue for P1, over PowerSync and over Firebase (RESOLVED 2026-07-15, hadar).** *Context:* device SQLite ↔ cloud Postgres, offline-first, solo AI-assisted, and a hard "never lose a capture" mandate. *Decision:* **Supabase raw Postgres** for the cloud (Auth, RLS, Edge Fns, Storage — Postgres + RLS models the multi-tenant/collaborator/relational reality far better than Firestore), and for P1 **a simple owned sync queue** (write-ahead capture journal → durable resumable upload queue → reconnect push/pull) rather than PowerSync's streaming engine. *Why not PowerSync for P1:* the ezQuotePro post-mortem (`CRITIC-REVIEW-05`) proved the never-lost failure mode is a **cloud-first capture path**, not a weak sync engine — so the durable thing to own is the *local-commit-before-network* transaction, which an owned queue makes fully debuggable by a solo dev with no experimental-API dependency (PowerSync Attachments is marked experimental). Owning the queue also **dissolves** the PowerSync-specific review findings (Sync-Rules↔RLS parity, sync-rule re-replication cost). *Trade-off accepted:* we hand-build queue durability, idempotency, and merge for P1 — a small, well-understood surface, and the one we most need control over. *Deferred:* **PowerSync to P1.5+**, reconsidered only when multi-device conflict-free *relational* sync (the collaborator feed at scale) actually earns it; the exit evidence is the foundation spike's kill/airplane/disk-pressure results. *Confidence: high, given the mandate and the builder profile.*

**ADR-3 — Managed durable jobs (Trigger.dev/Inngest) for the pipeline.** The processing chain is multi-step, must be idempotent + resumable + observable, and a solo dev shouldn't hand-roll a queue/worker/retry system. *Confidence: high; pick one after a small spike.*

**ADR-4 — Client stays thin (no on-device ML in v1).** Follows the locked process-on-reconnect decision; keeps the app small, cheap, cross-platform, and buildable. Revisit only if on-site-offline structured output becomes a hard requirement (U7).

**ADR-5 — TypeScript everywhere; API on Supabase Edge Functions (Deno) with Hono + zod (RESOLVED 2026-07-15, hadar).** *Context:* the client is TS (ADR-1) and a solo dev benefits from one language + one shared monorepo. *Decision:* **TypeScript across client, web, API, and jobs**, in one monorepo (RN/Expo app · Next web · shared packages for types/zod/the auth predicate · `supabase/`). The **API runs on Supabase Edge Functions (Deno)** — "nothing to host," endpoints next to the DB, and keys stay server-side as Edge Function secrets (the direct fix to ezQuotePro's client-side Deepgram key). The **API is structured with Hono + zod** — one router, shared middleware, typed end-to-end, optional OpenAPI — so it stays *manageable* as endpoints grow; **the single authorization predicate (MF-2) is implemented as shared Hono middleware** every route runs through, rather than a check copy-pasted into each function. *External LLM/STT calls:* Deno `fetch` reaches any external API; a **short single-shot** call may run in an Edge Function (LLM latency is I/O — the 2s **CPU** limit doesn't count waiting; wall-clock is 150s free / 400s paid), but the **multi-step capture-processing pipeline runs in the durable-jobs runtime (Node, ADR-3), never synchronously in an Edge Function**, because Edge Functions have no built-in retry/resume. *Trade-off accepted:* two runtimes (Deno API + Node jobs), both TypeScript. *Portability hedge:* Hono runs on **both Deno and Node**, so if Edge Function limits ever bite, the same API code lifts into a self-hosted Node service (Fly/Railway/Render) with no rewrite — the runtime is reversible, which is why locking Edge Functions now is low-risk. *Confidence: high.*

---

## 6. Data-flow walkthroughs

**A. Offline capture → evidence → sync.** Tap → **write capture-journal entry (REQ-CAP8)** → record (stream to FS) → write `Capture` to local SQLite → audible+visual "saved ✓". Offline: the **owned queue** holds the row + the attachment; status shows "waiting for Wi-Fi." On qualifying connection: attachment uploads to R2, the push queue syncs the row to Postgres (idempotent + server dedup/merge), pipeline runs (transcribe→translate→structure→resolve), a pull brings results back, status → "ready."

**B. Decision → binding signature.** Captured decision → structured draft → sender confirms numbers → sends to homeowner as a no-login signed link → homeowner opens the Page *in their language* → Twilio Verify OTP + typed name → server freezes `shown_content` + hash + trusted timestamp → immutable approval record → instigator notified (push).

**C. Cross-language search.** Spanish query → translated to English → Postgres FTS on `canonical_en` → results rendered back in Spanish from the translations cache. One English index; every user in their own language.

---

## 7. How this answers the critic's hard points
- **Never-lost + offline sync (U1/U-SYNC, H5):** owned local-first SQLite + capture journal + resumable upload queue; server-side dedup/merge on push for concurrent offline project creation.
- **Signature identity (C2):** Twilio Verify OTP + name + hash — a real binding artifact, not a naked link.
- **Erasure vs immutability (C3):** envelope encryption + crypto-shred + tombstone stub.
- **English-canonical authority (C1/M4):** frozen `shown_content` is the signed instrument; English is an index; translations cache exempts signed records.
- **Cost floor (pricing):** cheap STT/LLM, R2 zero-egress, push-not-SMS, per-tenant metering.
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
2. **Object storage:** start Supabase Storage (one vendor) or go straight to R2 (cheaper video)? *(still open — decide in Spike A)*
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
- **H4 — Pipeline triggers on attachment-SYNCED, not row-sync.** Fire from the attachment queue's SYNCED transition (or a server-observed R2 object), so step-1 never 404s on media still uploading; capture↔object-key linkage syncs atomically; an orphan sweep reconciles rows-without-media and objects-without-rows.
- **H5 — Twilio A2P 10DLC is on the critical path (lead-time, not code).** Register brand + campaign early; **email-OTP / authenticated-link fallback** so the binding signature isn't single-threaded on carrier approval.
- **M1 — Free-cap never rejects synced data.** Always accept synced captures; enforce the cap by **gating new local creation pre-emptively** when the device knows it's over cap, and **locking over-cap projects until upgrade** — data is never lost to a paywall.
- **M2/M5/M6 — smaller fixes:** timestamp via an R2-arrival event (or honestly = row-sync time); the homeowner Page is a **dedicated read model** with a field whitelist + one-disposition-scoped JWT (not a live-schema join); offline **jurisdiction** via a bundled on-device state-polygon lookup, defaulting to strictest (two-party) when unknown.

**C1 + M3 — RESOLVED by "don't store video" (hadar).** Video is a transient capture medium: on-device 2-step extraction → store only **audio + key stills**, discard the raw video (§3.1). Storage drops to near-zero (the free-user cost floor holds and video needn't be a paid-only feature), server-side ffmpeg for video is eliminated (M3 gone), and uploads shrink from tens-of-MB videos to a few MB of audio+stills — which also **eases C3** (background upload). Remaining C-series item resolved; only the on-device extraction reliability needs proving in the §8 spike. Evidentiary trade-off (accepted): the continuous video isn't kept; the record is audio + timestamped stills + transcript.

## 12. Greenlight-gate reconciliation (v1.2 — after `CRITIC-REVIEW-03.md`, the fable cross-model review)

**Verdict: FIX-FIRST → GO.** The seven must-fix items are now applied (this section + the edits above + SPEC/PRICING changes); the foundation spike is greenlit.

Applied in this document: **MF-1** server-side envelope encryption + KMS + authorized reads, no presigned GET (§3.3) · **MF-2** one authz module for all ~6 paths + negative tests + FORCE-RLS CI check (§3.2) · **MF-3** feed rendered from local synced data; `postgres_changes` banned (§3.2) · **MF-4** windowed working set from v1 (P1 owned queue; the near-immutable data-parameterized sync-rule form applies only if PowerSync is later adopted) (§3.1) · metering enforces transcription minutes + lazy Free processing (§3.10). Applied in SPEC: **MF-5** P1 delivery = email + SMS, 10DLC starts at kickoff (REQ-VAL8) · **MF-6** one-confirm-surface + unclassified-evidence degradation (REQ-VAL6/VAL4, §4) · **MF-7** P1 ES localization (REQ-X2) + consent at job creation, never capture-time (REQ-CON1) · send-path touch budget ≤3 (REQ-X1) · one collapsed status (REQ-X3). Applied in PRICING: honest repricing (~60–70% blended margin), Verify/R2/jobs/platform-floor lines, Free minute allowance.

**Fix-during-build register (scheduled into the build, tracked in CRITIC-REVIEW-03):** JWT link expiry/one-time/revoke-on-resend · SQLCipher + Keychain/Keystore + expo-secure-store · instant Sync-Rule revocation at grant-end + don't sync raw homeowner audio to collaborator devices · Twilio Fraud Guard + SIM-swap Lookup + per-tenant send caps · AI sub-processor DPAs + `tenant_id` asserted at every pipeline write + global-UUID capture_id · translations cache normalized to a child table with per-language buckets (not JSONB-on-row) · parked-jobs auto-drain (error taxonomy, wired Deepgram failover, bulk re-drive, rate-based alerts) · pipeline collapsed to 2–3 durable checkpoints · additive-only migrations + N-versions-back upload tolerance · first-capture-≤N-interactions first-run budget · free-cap lock = read-only + export always · "recorded agreement — not a signature" labeling · Expo Push as the OneSignal fallback.

**Evidence-grade register (before signatures carry legal dispute weight):** WORM/anchored audit substrate (RFC-3161/transparency-log anchoring of `shown_content` hashes) · independent homeowner identity association · offline-stamp divergence flags.

## Sources
- [PowerSync + Supabase offline-first](https://powersync.com/blog/offline-first-apps-made-simple-supabase-powersync) · [PowerSync Attachments (offline file uploads)](https://powersync.com/blog/building-offline-first-file-uploads-with-powersync-attachments-helper) · [Supabase + PowerSync guide](https://docs.powersync.com/integrations/supabase/guide)
- [Flutter vs React Native 2026](https://tech-insider.org/flutter-vs-react-native-2026/) · [Flutter for AI-powered apps](https://appmatictech.com/insights/flutter-vs-react-native-ai-apps/)
- Cost sources in `ezjobsite-pricing-strategy.md` (STT, LLM, storage, SMS).
