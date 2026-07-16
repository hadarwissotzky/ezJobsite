# Hilo — Language Layer (core feature)

*How the product bridges a multicultural workforce: everyone works in their own language, the system translates between them automatically, and one canonical record keeps everything consistent. Captured from hadar's spec 2026-07-15. Refines the earlier "modular target language" decision (`CORE-CONCEPT.md §4`) into a concrete **English-pivot** architecture. ✅ = as specified · ❓ = open.*

---

## 1. Philosophy

Construction is multicultural, and the product **celebrates that** rather than flattening it. Every person communicates in **their own language**; the system bridges between individuals automatically, so a Spanish-speaking crew, an English back office, and a Portuguese-speaking sub can all work off the same records, each in their own tongue. `[✅ hadar]`

---

## 2. The architecture — English as the canonical pivot

```
  Native capture           Canonical store            Per-user display
  (any language)           (always English)           (each user's preferred lang)
  ┌───────────────┐        ┌────────────────┐         ┌───────────────────────────┐
  │ "tíralo a la  │ detect │ PERMANENT       │ cache   │ Ana (ES) → Spanish        │
  │  altura de... "│──lang─▶│ RECORD =        │────────▶│ Joe (EN) → English (=store)│
  │ + original kept│  ▶ EN  │ ENGLISH         │ per-lang│ Paulo (PT)→ Portuguese    │
  └───────────────┘        └────────────────┘         └───────────────────────────┘
        │                         ▲                              ▲
        └─ original + source ─────┘        search: query→EN, run on EN index, results→pref lang
           language retained forever
```

Four moving parts:
1. **Canonical = English.** The **permanent record is always stored in English** — the single source of truth, the search index, the legal/working record. `[✅ hadar]`
2. **Original preserved.** The **original native-language content + which language it was** is stored on every record forever (celebration + ground truth + legal fallback). `[✅ hadar]`
3. **Per-user display language.** At profile setup each user picks a **preferred language**; the system always displays content to them in it. Two people see the *same record* each in their own language. Default = English. `[✅ hadar]`
4. **Translate-once cache + English-pivot search.** A record is translated to a given language **once and cached**; search is done in English on the back end (query translated in, results translated/cached out). `[✅ hadar]`

---

## 3. Requirements

- **LANG-1 — Canonical English record.** Every record's permanent, working, indexed form is **English**; native input is translated to English on processing. `[✅; P1.5 · gate U3/U8]`
  - Accept: the stored/searched record is English; a dispute/export can still reach the original.
- **LANG-2 — Preserve original + source language.** Every record retains the **original native content + detected source language**, immutably (per retention policy). `[✅; P1]`
  - Accept: original + source-language retrievable on every record.
- **LANG-3 — Per-user preferred display language.** Set at **profile setup**; all content renders in it for that user; different users see one record each in their own language; default English. `[✅; P1 (field) + P1.5 (rendering)]`
  - Accept: changing a user's preferred language changes what they see across the app; two users on one record see it in their two languages.
- **LANG-4 — Translate-once cache.** Each **(record × language)** translation is cached and reused; **invalidated when the record changes** (e.g., a decision's latest value updates). `[✅; P1.5]`
  - Accept: a record is translated to a language at most once until it changes; a change invalidates and re-translates.
- **LANG-5 — Cross-language search via English pivot.** A user searches in **their** language → the query is **translated to English** → search runs on the **English canonical index** → results are returned in the searcher's **preferred language** (from cache or translated on demand). `[✅; P1.5]`
  - Accept: a Spanish query finds an English-canonical record captured from Portuguese, shown back in Spanish.
- **LANG-6 — Auto-detect source language.** Detect the spoken/typed language automatically per capture; low confidence flags for confirmation. `[✅; P1]`
  - Accept: detection ≥95% on configured languages; low-confidence flagged not silently mistranslated.
- **LANG-7 — Client/counterparty language.** Client-facing surfaces (approval **Page**, shares, reports) render in the **recipient's** language; canonical English + original retained. `[✅ (implied) — CompanyCam parity "translate share to other languages"; ties to REQ-A2/decision-approval]`
  - Accept: an approval Page/share opens in the recipient's chosen language; the record stays English-canonical.
- **LANG-8 — Integrity across languages.** Numbers/prices/measurements are **confirmed regardless of language**; the **scope-fidelity check runs on the English canonical** (it's the legal record); original retained as ground truth. `[✅; carries mandates #5/#6; gate U8]`
  - Accept: numeric confirmation enforced in any input language; scope fidelity gated before a priced/approvable record sends.

---

## 4. Data-model additions

- **Member.preferred_language** — the display language (set at profile setup; default English).
- **Every translatable record** (Capture transcript, Disposition payload, Decision value, Report/Page, checklist item) carries: **canonical_en** (the English source of truth), **original_text + source_language** (immutable), **translations{lang → {text, translated_at, source_version}}** (the cache), and a **content_version** used to invalidate the cache on change.
- **Search index** is built on **canonical_en** only; queries are translated to English before matching.

---

## 5. Risks & notes (to the ledger)

- **Pivot double-translation.** A Portuguese reader sees Spanish→**English**→Portuguese (via the pivot), not a direct Spanish→Portuguese. Fine for display and the English legal record is unaffected, but fidelity can drift on the second hop. *Accept pivot now; direct-pair translation is a later optimization; the retained original is always the tiebreaker.* `[❓ confirm pivot is acceptable]`
- **Authority model (revised after critic C1 — one binding artifact per signed act).** English canonical is the **internal working copy + search index**, *not* "the legal record." For any **signed** act, the **exact text the signer saw, in their language, is frozen into `shown_content` at signing and is the binding instrument** (exempt from cache invalidation — critic M4). The **retained original native + audio corroborates**. No three-way ambiguity: index (English) ≠ what-was-signed (frozen shown_content) ≠ ground-truth (original).
- **Cache invalidation is load-bearing.** Because decisions are *versioned* (REQ-VAL5) and records change, every content change must bump `content_version` and invalidate stale cached translations — or users see outdated translations. 
- **Search across translation** loses idioms/jargon on the query hop; per-crew learned vocabulary (the "learns-them" moat) mitigates over time.
- **Always-English even for all-Spanish shops.** English is canonical regardless of whether anyone on the job reads English — it's the interlingua. `[❓ confirm — you specified default+permanent = English; assuming universal]`

---

## 6. Phasing

- **P1:** capture in native language, **store original + source language** (LANG-2), auto-detect (LANG-6), and the **preferred-language profile field** (LANG-3 setting). No translation quality bet yet.
- **P1.5 (gated by U3 multilingual + U8 scope-fidelity):** the translation pipeline — **native→English canonical** (LANG-1), per-user display rendering (LANG-3), **translate-once cache** (LANG-4), **English-pivot search** (LANG-5), client-language surfaces (LANG-7), cross-language integrity (LANG-8). Built once the AI spikes prove translation is good enough.

---

## 7. Open questions
1. **Pivot translation acceptable?** English-as-interlingua for display (Spanish→English→Portuguese), with direct-pair as a later optimization? (Assumed yes.)
2. **Universal English canonical** even when no English speaker is on the job? (Assumed yes, per your spec.)
3. **Preferred language granularity** — one per user, or can it differ per project/counterparty? (Assumed one per user; client picks their own on a share.)
