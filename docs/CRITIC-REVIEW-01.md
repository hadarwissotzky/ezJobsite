# Adversarial Critic Review #01 — full spec suite

*Same-model adversarial stand-in (NOT the real Codex cross-model check, which is still owed — see CLAUDE §4). Run 2026-07-15 over the full suite after ~13 layers were added. 3 Critical, 8 High, 8 Medium, 4 Low. Status column tracks reconciliation. This is the verification-layer artifact per instruction #2.*

**Legend:** ☐ open · ◐ partially fixed · ☑ fixed · → hadar decision needed

> **Reconciliation 2026-07-15 (see IMPLEMENTATION_NOTES §4 for detail):** Applied — C1, M4, M5, M6, M7, H5, H6, H8. hadar decisions — **H1: keep P1 as is** (broad, conscious); **C2: signature = SMS OTP + typed legal name + hash** (confirm stays no-identity); **C3+H4: crypto-shred + hash stub**, collaborator content licensed to host. Still open — **H2, H3 (P1 now carries AI risk — spike early), M8, M2, M3, L1–L3.**

## Critical
- **C1 — Three competing "authoritative" translated records.** English-canonical ("the legal record") vs. retained original ("the dispute tiebreaker") vs. the Page the counterparty actually signed in their own language. Cannot all govern. **Fix:** the exact rendered text the signer saw (`Disposition.counterparty_action.shown_content`) is frozen at signing and is the binding instrument for that act; English-canonical is demoted to internal index/working copy; original stays as corroboration. ◐ (applying now)
- **C2 — "Approval = binding digital signature" contradicts "no-login link, no account."** The identity mechanism that makes a signature binding is unresolved (U6), yet the no-login confirm ships in P1. **Fix:** split vocabulary — **confirm** (P1, no identity) vs **signature** (P1.5, *requires* identity binding: SMS-OTP / typed legal name + timestamp + shown_content hash). Don't let §7.1 signature inherit REQ-VAL3's no-login mechanism. → hadar
- **C3 — Immutability mandate vs. lawful erasure (CCPA/GDPR).** "Never destroy anything / history never dropped" vs. "support legally-mandated deletion." No reconciliation. **Fix:** define erasure model — crypto-shred/tombstone media while retaining a hash+metadata stub; specify whose consent covers whom; explicit carve-out for which immutability claims yield to erasure. → hadar (legal)

## High
- **H1 — P1 is no longer a thin slice.** P1 now includes durable video + timeline + conflict-safe offline sync + resolution(GPS+content)+dedup + offline project CRUD + language detect ≥95% + versioned decisions + scope delineation + full PM + two-kind consent. Violates "thin vertical slice" + criterion #6. **Fix:** cut P1 to the trust anchor — never-lost multimodal capture (U1) + evidence + GPS-resolution + one sync round-trip; push the rest to P1.5. → hadar (scope)
- **H2 — P1 validation loop depends on P1.5 layers.** VAL1-3 (P1) "send to counterparty's device" but Notifications (§7.1a) and in-language delivery (COMM-5) are P1.5. **Fix:** pull a minimal SMS/email delivery channel into P1, or move counterparty-confirm to P1.5. → hadar
- **H3 — "Structure a decision card" (P1) is AI extraction, contradicting "no AI spikes needed in P1."** Same for REQ-PROC5 language-detection ≥95% in P1. **Fix:** make P1 decision card human-filled/templated (no free extraction), or admit U4-class risk exists in P1 and gate it. → hadar
- **H4 — COLLAB5 "host keeps collaborator content forever" collides with erasure + cross-company data ownership + consent.** **Fix:** specify inter-company data controller + post-collaboration retention basis (license grant on contribution?); reconcile with erasure (C3). → hadar (legal)
- **H5 — Concurrent offline project creation breaks REQ-PROC7 "no duplicates."** Two offline devices create "123 Main St"; neither sees the other; dedup can't fire. **Fix:** server-side merge/dedup on sync; rewrite acceptance to "duplicates surfaced for one-tap merge," not "no duplicates"; add to ledger. ☑ (applying: acceptance reworded + ledger)
- **H6 — CLAUDE.md (read-first) points at the SUPERSEDED spec.** File map, mission, and the Codex command all name `SPEC-v1-change-order-wedge.md`. **Fix:** repoint to `SPEC-capture-core-v1.md`; list all layer docs; quarantine superseded files. ☑ (applying)
- **H7 — Cross-model verification never covered the current suite.** Only pass was a stand-in vs. "v0.1 / 4 files"; 9 of 13 layers added since. **Fix:** run adversarial pass on current suite (this review) + the real Codex run is still owed. ◐
- **H8 — Core-principle drift: user-facing classification leaked to a novice user.** who-directed (VAL4), scope-level project-vs-party (VAL6), responsibility assignment (VAL7), verify-vs-approve intent (COMM-2), Approval-Spectrum rung. A non-software drywaller can't reliably classify these. **Fix:** move classifications to system inference + single confirm/defaults; make "succeeds without training" an actual usability gate. → hadar

## Medium
- **M1 — Use-case count inconsistent (35 in SPEC/notes vs 73 header vs 87 by arithmetic).** Fix: recount, pick one, re-justify scope. ◐
- **M2 — Scope-gap/overlap detection (VAL7) has no metric.** Fix: add a U-unknown (precision/recall on labeled boundary set) or downgrade to manual review. ☐
- **M3 — Project detection accuracy (existing-vs-new, false-new rate) unmeasured; U-RES only measures GPS.** Fix: add false-new-project + false-merge rates. ☐
- **M4 — Translation-cache invalidation can silently mutate already-signed content.** Fix: freeze shown_content at signing; exempt signed dispositions from cache invalidation. ◐ (ties C1)
- **M5 — Device GPS+time "tamper-evident" isn't, offline (device clock/GPS user-alterable).** Fix: downgrade to "device-attested, server-corroborated on sync"; add trusted server timestamp. ☑ (applying)
- **M6 — Data-model duplication/orphans.** source_transcript vs original_text; Capture.resolution_status vs Resolution entity; Disposition vs Decision fields; Evidence row-or-implicit; Member.role (office/field) vs ProjectParty.role (trade) same name. Fix: dedupe + rename one `role`→`trade`. ◐ (rename applying)
- **M7 — `Project.target_language` orphan** from the killed "modular target" model; contradicts English-canonical + per-user. Fix: delete. ☑ (applying)
- **M8 — Mini change order "rough price, one-tap approve" vs. confirm/read-back mandates.** Fix: require sender-side number read-back before a mini-CO sends; "rough" = a confirmed NTE. ☐→ hadar

## Low
- **L1 — REQ-X1 handler/send flow has no touch budget number.** Fix: budget the priced-CO send path.
- **L2 — Several "locked" decisions are actually "hadar to confirm"** yet baked in as decided. Fix: mark provisional.
- **L3 — `[trace: hadar]` numeric targets asserted as pass bars, not hypotheses.** Fix: label target-hypotheses.
- **L4 — Superseded docs (`SPEC-v1-change-order-wedge.md`, `USE-CASE-CATALOG.md`) in the folder.** Fix: banner/archive. ◐

**Strengths:** the capture-never-lost invariant is rigorously specified; the disposition-type seam discipline is real (adding handlers needs no capture/timeline schema change).
