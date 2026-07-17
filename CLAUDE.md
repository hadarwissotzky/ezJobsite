# CLAUDE.md — Hilo (working name) build operating contract

*This file governs how any AI assistant (Claude, Codex, etc.) works in this repo. Read it first, every session. Keep it short and current. Last updated 2026-07-14.*

---

## 0. Naming
**Product = EZjobsite** — a **jobsite-focused** product, one of **Hilo's** portfolio companies (Hilo = the venture group / parent). Earlier drafts used "Hilo" as the product working-name; the product is **EZjobsite**. Treat "Hilo" in these docs as referring to the parent, and the product as EZjobsite. (Doc filenames keep the `hilo-` prefix for continuity; they describe EZjobsite.)

## 1. What we are building

A **mobile-first, voice-led, multimodal field-capture app** for residential contractors, remodelers, and subs. A crew member on a jobsite captures a decision **in the moment** — by talking, or by snapping a photo/video, or typing — and the app turns it into a **structured, priced, one-tap-approvable change order** that is routed to the back office and the client. The atomic unit is the **jobsite decision moment**, not the photo.

**North star:** *"Don't make them learn the tool — make the tool learn them."* Capture must be frictionless enough to become a reflex.

**Who this is for (the core design test).** The user is someone for whom **phones and software are not second nature** — they collect information in the field, in their cars, in city offices, while shopping for materials. **Their only job is to provide the information (talk, snap); the system does 100% of the organization, structuring, filing, and routing in the backend so they never have to.** Every screen, flow, and default is judged against this: *would someone who doesn't think in software succeed here without being taught?* If not, it's wrong. This is not a nicety — it is the core requirement. **The goal underneath everything: protect contractors and subcontractors from miscommunication and errors by keeping all parties aligned — and it must work for a solo operator with no back office (the "office" is a role, never a requirement).**

**v1 mission (this phase):** *de-risk the hard parts.* We are NOT shipping a full product yet. We are building a thin end-to-end slice + a real-world test to prove the scary unknowns are solvable before committing to a full build. See **`SPEC-capture-core-v1.md`** (the authoritative spec; `SPEC-v1-change-order-wedge.md` is superseded → it's now the P1.5 Change Order handler).

---

## 2. Non-negotiable design mandates

These come from adversarially-verified research (see the claude.ai Project docs). Do not violate them without an explicit, logged decision.

1. **Never lose a capture — the honest invariant (reworded 2026-07-16 per Codex #6 C2).** *Never acknowledge a capture ("saved ✓") unless a **verified, recoverable copy + durable recovery intent** already exist on the device; and **refuse to start loudly** when capacity/permissions can't be reserved.* Capture is **local-first**, written to durable storage *before* any network call, and "saved" fires **only after** the capture-commit state machine reaches `MEDIA_COMMITTED` (media finalized+fsync'd+verified AND the local transaction committed) — not when a journal row is merely marked complete. Confirmed **audibly and visually**; recoverable after crash/kill. **Stated residual-loss boundaries** (outside any single-device guarantee): total device loss/destruction, app-data deletion, encryption-key loss, correlated filesystem destruction — named honestly, never hidden behind an absolute promise. Silent data loss is the single unforgivable sin in this category; a *dishonest* "saved" is the same sin. **Append-only immutability (2026-07-16):** media is immutable (never edited/merged); an approved record is **frozen and permanent** — never edited in place **nor deleted**, only augmented via a new appended record (its lawful-erasure exception = **hard-delete** + retained hash/metadata stub).
2. **Confirm, don't automate.** Anything carrying a **price or a commitment** requires a mandatory human confirmation step before it commits or sends. No silent auto-send. (LLM structuring hallucinates ~31% of the time in the closest studied domain — a dollar figure cannot ride on an unconfirmed transcript.) **"Approval" specifically means a digital signature** — a binding, verifiable sign-off — distinct from the lighter, unsigned verify/confirm step.
3. **Hands-free budget is a hard constraint.** Every core capture flow must be operable with gloves on, on a ladder, in noise, with the stated maximum number of deliberate physical touches. If a flow exceeds its budget, it is a bug.
4. **Transcription is a commodity; the structuring layer is the product.** Do not build a moat on "we have voice." Invest in voice → *structured priced transaction*, per-crew adaptation, and language.
5. **Language: English-canonical pivot, per-user display.** Auto-detect the spoken language; **English is the internal canonical working copy + search index** (not "the legal record" — fixes critic C1); keep the **original native content + source language + raw audio** immutably as corroboration; and for any **signed** act, the **frozen rendered text the signer actually saw (`shown_content`) is the binding instrument**. Retain per a defined, legally-bounded retention/erasure policy. **Erasure (GDPR/CCPA, resolves critic C3):** a valid erasure request **hard-deletes the content + media but retains a hash + metadata stub** — the evidence-chain skeleton survives while the personal data is destroyed. Deletion covers the Storage object, the Postgres row + FTS index, job payloads, caches, device local copies (purge command), and logs; **vendor retention and expired-backup windows are stated residual boundaries**. *(Revised 2026-07-16: this said "crypto-shred", which was the sole reason client-side media encryption existed. Dropped for v1 — the plaintext class was always hard-deleted anyway, so crypto-shred only ever covered the audio blob, and its one edge over deletion was already conceded. See `DURABILITY-DESIGN-v1` DECISION 4 for the chain and the revisit trigger.)* This is the **one carve-out** to the immutability/never-destroy rules; state it wherever "immutable" appears. Each user has a **preferred display language** (set at profile setup); content renders per-user via a **translate-once cache**; **search is English-pivot** (query→EN, results→preferred language). Numbers confirmed in any language; gate translated-scope fidelity on the English canonical before it's approvable. Full detail: `LANGUAGE-LAYER.md`.
6. **Numbers/prices/measurements/model-numbers are the highest-risk field.** Never trust them from the transcript. Read-back + on-screen tap-to-correct + domain biasing. Always.
7. **Phone-native, offline-forward (paramount).** Assume weak/no signal by default. **All four capture modalities — text, voice, image, video — must work fully using the device's internal capabilities with no connectivity;** the network is opportunistic, never a precondition to capture or safely store a decision. No wearables/headsets as a dependency in v1 (they threaten worker identity and adoption).
8. **Project resolution is a layer, not a chore.** Captures auto-assign to the right project (GPS/context) with zero manual filing; a secondary workflow handles ambiguity/no-match, and an unresolved capture is held durably, never lost.
9. **Every media capture is stamped** with GPS + time as tamper-evident evidence.
10. **Human-in-the-loop, always.** Every deployed bilingual/ambient precedent that works keeps a human editor in the loop. The editor is load-bearing, not optional polish.

---

## 3. How to work in this repo

- **Small steps.** Bias toward small, verifiable specs and small commits. Prefer a thin vertical slice that runs end-to-end over a broad half-built surface.
- **Verify key decisions explicitly.** When a decision materially shapes the build (stack, data model, a hard-part approach), state it, give the trade-off, and get explicit human sign-off. Do not silently guess.
- **Before any multistep build, write a verification plan.** See `VERIFICATION_PLAN.md` for the standing criteria; each milestone in the spec has its own test gate. No milestone is "done" until its gate passes.
- **Keep the notes current.** When you hit an edge case, a known, or an assumption, record it in `IMPLEMENTATION_NOTES.md` with how you handled it. That file is the project's memory of *why*.
- **Trace everything.** Every requirement must trace to a research finding or a logged human decision. If you can't trace it, flag it as an assumption — don't invent requirements.

### 3.1 Commit message rule — MANDATORY, every commit, no exceptions `[hadar, 2026-07-16]`

**A commit message that only says *what* changed is incomplete and must be rewritten before committing.** The subject line says *what*. **The description must always answer four things, under these exact headings:**

```
<subject: what changed, imperative, ≤72 chars>

WHY:
  The intent. What problem or need prompted this, and what breaks or stays
  broken without it. Not a restatement of the diff — the reason the diff
  exists. If it came from a review/decision/finding, name it (e.g. "Codex #11
  CRITICAL 2", "hadar 2026-07-16").

GOALS:
  What this change is trying to achieve, as outcomes. What is now true that
  wasn't. If it deliberately does NOT achieve something adjacent, say so.

COMPLETION:
  <N>% — and what the remaining % is. "100%" is a claim, not a default:
  it means nothing is owed. If anything is unfinished, unverified, deferred,
  or known-broken, it is not 100% and the gap gets named here.

BLAST RADIUS:
  Every other area this touches or could touch. Files/modules changed beyond
  the obvious one · docs whose claims this invalidates · decisions it
  supersedes · anything downstream that must now be re-checked. "None" is
  allowed only when it is actually true.
```

**Why this rule exists** (hadar, 2026-07-16, after four consecutive cross-model reviews found the same failure): *this project's recurring defect is not bad code — it is claims that outrun their evidence, and edits that land in one place while a contradiction survives in another.* `WHY` forces the intent to be traceable instead of reconstructed later. `COMPLETION` makes over-claiming a visible, dated, attributable act rather than a vibe. **`BLAST RADIUS` is the direct countermeasure to the withdraw-then-restate pattern** — the whole reason `MEDIA_COMMITTED` survived in `SPEC` REQ-CAP5/CAP8 after being removed from `DURABILITY-DESIGN` is that nobody was required to write down what else the change touched.

**Applies to every commit** — code, docs, config, spikes, throwaway work. **Applies to Codex and any other assistant, not just Claude.** A one-line commit is only acceptable when all four sections are genuinely trivial, and they must still be present.

**Do not inflate `COMPLETION`.** A commit that says `COMPLETION: 60% — the recovery sweep is unwritten` is worth more than one that says 100% and is wrong. The ledger rule applies here too: **☑ only when the edit exists.**

#### This is ENFORCED, not advisory `[hadar 2026-07-16: "we need to take it from here — especially as we get more into code"]`

`.githooks/commit-msg` **rejects** any commit missing a section, with an empty `WHY`/`GOALS`/`BLAST RADIUS`, or with a `COMPLETION` carrying no percentage. A convention honoured only when someone remembers is worth nothing exactly when code volume rises — which is when it was asked for.

**Enable once per clone** (git does not ship hooks on clone):
```bash
git config core.hooksPath .githooks
```
**Verify it is live:** `git config core.hooksPath` → `.githooks`. If that prints nothing, **you are not protected** and the rule is back to voluntary.

- **Exempt** (auto-generated or not-a-landed-change): `Merge …` · `Revert …` · `fixup!/squash! …` · `WIP:` checkpoints.
- **Bypass:** `git commit --no-verify`. It exists for emergencies. **Use it and you own the gap** — nothing else will catch it.
- A rejected message is preserved at `.git/COMMIT_EDITMSG.rejected`, so nothing you wrote is lost.
- **The hook checks structure, not honesty.** It cannot tell a real `BLAST RADIUS` from `none`. It removes the excuse of forgetting; it cannot remove the temptation to under-report. That part is still on whoever commits.

---

## 4. The verification layer (the user's instruction #2)

**Layer 1 — evaluation criteria.** The 8 criteria in `VERIFICATION_PLAN.md` define "high quality." Check work against them before calling anything done.

**Layer 2 — second-model critic.** For any complex build output (like the spec), run it past a **different model** (Codex) as an adversarial critic and reconcile disagreements. Codex is NOT installed in the cloud sandbox and has no key there, so run it **locally**:

```bash
# one-time: install the OpenAI Codex CLI locally and set your key
npm install -g @openai/codex          # or: brew install codex
export OPENAI_API_KEY=sk-...

# cross-check the spec (adversarial critic prompt)
codex exec --model gpt-5-codex \
  "You are an adversarial reviewer. Read SPEC-capture-core-v1.md, CORE-CONCEPT.md, \
   PM-LAYER.md, LANGUAGE-LAYER.md, COMMUNICATION-LAYER.md, MASTER-USE-CASES.md, \
   VERIFICATION_PLAN.md and CLAUDE.md in this folder. Find every place the \
   spec is wrong, unbuildable by a solo AI-assisted developer, internally \
   inconsistent, or missing a failure mode. Rank findings by severity. Do \
   not agree to be agreeable."
```

Log what Codex flags and how it was reconciled in `IMPLEMENTATION_NOTES.md` under "Cross-model review". Until Codex has been run locally, any in-session "critic pass" is a **same-model stand-in** and must be labeled as such — it is not the real cross-model check.

**Layer 3 — external signal.** Before locking a risky technical choice, pull real external context instead of trusting priors: current library/API docs (Context7), the live Xano workspace, real app-store reviews, and — for the hard unknowns — a real or proxy **field test** producing measured numbers (word-error rate, capture-loss rate, net-of-correction time). Priors are not evidence.

---

## 5. Stack (LOCKED 2026-07-15 — see ADRs in `ARCHITECTURE.md`)

- **Client (ADR-1):** **React Native + Expo** (Flutter fork closed). The risky native bits — audio capture, local durable storage, background upload — still need platform-specific care; budget for it. First build = **Spike A** (`SPIKE-A-BUILD-PLAN.md`).
- **Backend/API + data (LOCKED 2026-07-15; sync superseded 2026-07-16/17):** device store = **SQLite (encrypted)**; cloud = **PostgreSQL via Supabase (raw Postgres)** — Auth, RLS, Edge Functions (AI pipeline), Storage for blobs. Firebase rejected (NoSQL, weaker relational/RLS).

  **⚠️ SYNC — this section previously said "a simple owned queue, NOT PowerSync". THAT IS NO LONGER TRUE and contradicted `ARCHITECTURE.md`, where ADR-2 resolved to PowerSync on 2026-07-16.** A session reading this file first — as this file instructs — would have been told to rip out the sync engine the build depends on.

  **What the build actually does, and why it is a SPLIT rather than a winner:**

  | Data | Transport | Why |
  |---|---|---|
  | **Evidence** — captures, decisions, notes, scope boundaries, change orders | **Owned outbox** (11 modules) | These are **append-only** and carry SQLite triggers that refuse UPDATE/DELETE. A PowerSync-managed table is a **view** over `ps_data` and cannot carry them. More importantly: **PowerSync can revert its own rows** if the server rejects, so it cannot be the commitment authority for something mandate #1 says must never be lost. `capture_commit` is the authority; the outbox is transport, and deleting an outbox row never destroys a capture. |
  | **Mutable relational rows** — projects (name, address, geofence, recording consent) | **PowerSync** | A jobsite address is not evidence. It is a mutable row that must converge across devices — exactly what PowerSync exists for. |

  **This split was arrived at during the build, not designed up front, and it earned itself twice:**
  1. I first built an owned outbox for projects too, by pattern-matching. It failed loudly: `CREATE TABLE IF NOT EXISTS project` **silently did nothing** because PowerSync already defines `project`. The lesson was not "rename the table" — it was that I had built **a second sync engine beside the one we adopted**, with its own bugs.
  2. The evidence path kept working through an entire session in which **PowerSync's upload was silently dead** (see `IMPLEMENTATION_NOTES.md` §5.1). Captures, decisions and change orders were unaffected *because* they ride owned queues. That is not luck; it is the reason for the split.

  **⏳ THIS NEEDS HUMAN SIGN-OFF.** CLAUDE.md §3 says a decision that materially shapes the build must be stated with its trade-off and signed off, not silently guessed. The trade-off: two transports is more surface than one, and a developer must know which rule applies before adding a table. The rule is one line — **append-only evidence → owned outbox; mutable row → PowerSync** — but it is a rule someone has to hold. Recorded here rather than left implicit in 11 modules.

- **API runtime + language (LOCKED 2026-07-15, ADR-5):** **TypeScript everywhere**, one shared monorepo (RN/Expo app · Next web · shared packages · `supabase/`). **API on Supabase Edge Functions (Deno)**, structured with **Hono + zod** (one router, shared middleware, typed) — the **one authz predicate (MF-2) is shared Hono middleware**. **External LLM/STT** via server-side `fetch` (keys in Edge Function secrets, never client); short single-shot calls in an Edge Function, the **multi-step processing pipeline in the durable-jobs runtime (Node, ADR-3)** — never a synchronous Edge Function (no retry/resume there). Hono is Deno↔Node portable, so the runtime is reversible if Edge limits bite.
- **Speech/AI:** transcription is a commodity input — pick per accuracy-in-noise + on-device/offline support + Spanish/multilingual, benchmarked on *our own* field audio, not vendor claims. The structuring/extraction layer (voice → priced CO fields) is ours to own.
- **Do NOT build:** full CRM, scheduling, invoicing/payments, estimating suite. Integrate (QuickBooks/Jobber/CompanyCam) for those. Staying deep on capture + approval + language is the strategy.

---

## 6. File map

| File | Purpose |
|---|---|
| `CLAUDE.md` | This operating contract. Read first. |
| **`SPEC-capture-core-v1.md`** | **The authoritative v1 de-risk spec (capture core + handler model). Source of truth for *what* v1 is.** |
| `CORE-CONCEPT.md` | Why it matters, the capture model, the base+3 actions, core design principle. |
| `MASTER-USE-CASES.md` | The consolidated use-case baseline (the spec traces to it). |
| `PM-LAYER.md` · `LANGUAGE-LAYER.md` · `COMMUNICATION-LAYER.md` | The project-management, language, and communication layer specs. |
| `CRITIC-REVIEW-01.md` | Adversarial review findings + reconciliation status. |
| `SPEC-v1-change-order-wedge.md` | **SUPERSEDED** → now the P1.5 Change Order handler detail only. |
| `VERIFICATION_PLAN.md` | The 8 evaluation criteria + how each is verified + the de-risk exit criteria. |
| **`SPIKE-A-BUILD-PLAN.md`** | **The foundation-spike build plan — the first thing to build. Task-level plan for M0 + the durability front of M1, with the exit gate.** |
| `ezjobsite-architecture.md` (`ARCHITECTURE.md`) | Locked stack + ADR-1..5 + data model + hard-parts. |
| `IMPLEMENTATION_NOTES.md` | Living ledger: edge cases, knowns/known-unknowns/unknown-unknowns, decisions, cross-model review. Update as you build. |

Durable copies of the spec and research live in the claude.ai Project **"Hilo venturegroup - change order"**. The research (change-order pain, voice-first + language wedge, competitive analysis, app-store reviews) is the evidence base — consult it before adding requirements.

---

## 7. What comes after this phase (do not do yet)

The user has sequenced the work: **(1) this spec + build plan → (2) UX specification → (3) technical & architecture specification → (4) deployment.** Keep this doc at the *what + de-risk plan* altitude. Deep UX (incl. the hands-free interaction model — big-button vs. wake-word vs. headset), detailed architecture, and deployment are later phases. Do not pre-empt them; do leave clean seams for them.
