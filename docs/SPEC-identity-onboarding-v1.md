# SPEC: identity & onboarding — phone-code verification — v1
**Owner: Hadar | Written 2026-08-01 | Status: PROPOSED — not authoritative until §2 is signed off**

*This document proposes replacing email+password with phone-code (SMS OTP) verification as the
app's credential, and defines where verification sits relative to capture, how attribution
survives a shared device, and what happens to accounts that already exist.*

**Governed by `CLAUDE.md`'s ten mandates, which override everything here.** Where this spec and a
mandate appear to conflict, the mandate wins and the conflict is a defect in this spec.

**Status is PROPOSED deliberately.** `CLAUDE.md` §3 requires that a decision materially shaping the
build be stated with its trade-off and given explicit human sign-off. §2 is that decision set.
Nothing in §3–§7 should be built until §2 is signed. **P4 and P6 were answered by Hadar on
2026-08-01 and are now DECIDED (§5, §6). P1/P2/P3/P5 still await sign-off.**

**What this document owns:** the credential, the onboarding step order, the offline posture of a
session, attribution rules for a shared device, and the migration path for existing accounts.

**What it does NOT own, and must never restate:** the capture commit state machine
(`SPEC-capture-core-v1` + `DURABILITY-DESIGN-v1`), the extra lifecycle (`SPEC-extra-lifecycle-v1`),
the language pivot (`LANGUAGE-LAYER`), seats/pricing (`PRICING-STRATEGY`), the company roster and
invite RPCs (`376_company_membership`).

**Requirement IDs** are in the `REQ-ID*` namespace, stable, never renumbered. Each carries an
`Accept:` clause and a `[trace: …]`. **A requirement with no trace is an assumption and is marked
as one.**

---

## 1. What is true today (verified, not assumed)

| | |
|---|---|
| **Credential** | Email + password, via `signInWithPassword` / `signUp`. `[trace: connector.ts:131-145]` |
| **Auth is a hard gate** | `session === null` → `AuthScreen`. There is no path into the app, and therefore **no path to capture**, without a session. `[trace: App.tsx:3267-3275]` |
| **Onboarding carries no account step** | 4 slides, then sign-in. "No account, no data, no permissions here." `[trace: onboarding.tsx:1-9]` |
| **Why email was chosen** | The file says so outright: *"the only method that works without an SMS/email-delivery provider we do not yet have."* It was a provider constraint, never a judgement that email suits this user. `[trace: authscreen.tsx:1-3]` |
| **Attribution** | `owner_id` on `capture`, `project`, `attachment`; roles `owner · crew · sub` on `company_member`. `[trace: AppSchema.ts:70-83, 57-68 · company.ts:37-49]` |
| **Phone is already the routing address** | Change orders reach clients by phone. `[trace: sendto.ts phoneE164/displayPhone]` |

**The nuance that changes the argument.** Sign-in is *already* a network call behind a hard gate, so
onboarding already requires connectivity — SMS does not introduce that dependency, it inherits it.
Mandate #7 governs **capture**, and capture only happens post-auth. So the real exposure is not
"OTP breaks offline capture"; it is **(a)** SMS adds a second failure mode (carrier delivery) on top
of the network one, and **(b)** an already-signed-in user must never be bounced back to the gate
while offline. (b) is REQ-ID5 and is the load-bearing requirement in this spec.

---

## 2. Proposed decisions — REQUIRE SIGN-OFF

| | Decision | Trade-off being accepted |
|---|---|---|
| **P1** | **Phone OTP REPLACES email+password.** It is not added alongside it. | Two credentials would double the failure modes and reduce nothing the user must learn. Cost: a real SMS bill and real deliverability failures where email was free. |
| **P2** | **Identity is the E.164 phone number.** `auth.users.phone` becomes the account key. | Consistent with how the product already addresses people. Cost: number changes become an account-recovery problem (P5). |
| **P3** | **Email is retained ONLY as an optional recovery channel**, never as a login method, and never required. | Keeps a recovery path that does not depend on holding the SIM. Cost: one optional field in profile setup. |
| **P4** | **DECIDED (hadar, 2026-08-01): one phone, one user.** A phone number binds to exactly one account and an account to exactly one number. Shared-device crew mode is NOT supported. | Attribution is exact and `owner_id` keeps its evidentiary meaning. Cost: a crew sharing one handset cannot hand off without sign-out + OTP, which needs signal. See §5. |
| **P5** | **Number change must have a recovery path** that does not require the old SIM. **P4 makes this sharper, not softer** — with one number per account and no password, a changed number is total loss of access. | Without it, a contractor who switches carriers is locked out of their own evidence permanently. |
| **P6** | **DECIDED (hadar, 2026-08-01): no migration.** All existing account data is test/fake. Clean cutover. | Removes the whole re-parenting problem. Cost: none — nothing real is discarded. See §6. |

---

## 3. Requirements

### 3.1 The credential

**REQ-ID1 — Phone number + 6-digit SMS code is the only login method offered.**
`signInWithOtp({ phone })` then `verifyOtp({ phone, token, type: 'sms' })` replace
`signInWithPassword` and `signUp`. No password field exists anywhere in the app after this lands.
- **Accept:** `connector.ts` exports no method taking a password; `authscreen.tsx` renders no
  `secureTextEntry` input; grep for `signInWithPassword` returns nothing.
- `[trace: P1 · connector.ts:131-145 · CLAUDE.md §1 "phones and software are not second nature"]`

**REQ-ID2 — There is no separate "sign up" step.** A number that has not been seen before creates
an account on first successful verification; a number that has creates a session. The user never
chooses between "sign in" and "create account".
- **Accept:** `authscreen.tsx` has no `mode` state and no sign-in/sign-up toggle.
- `[trace: authscreen.tsx:18,85-87 (the toggle being removed) · CLAUDE.md §1 "would someone who
  doesn't think in software succeed here without being taught?"]`

**REQ-ID3 — The code is auto-filled, not typed, wherever the OS allows it.**
The code input sets `textContentType="oneTimeCode"` (iOS) / `autoComplete="sms-otp"` (Android), so
the OS offers the code as a single tap from the notification.
- **Accept:** on a real device, receiving the SMS surfaces a one-tap fill; the flow completes
  without the keyboard being used.
- `[trace: mandate #3 (touch budget) — this is not a capture flow so the budget does not bind, but
  the same reasoning applies: every avoidable touch is one the user must be taught]`

**REQ-ID4 — The phone number is read back before the code is sent.**
The number is displayed in full, formatted, with an explicit "is this right?" confirmation, before
any SMS is dispatched.
- **Accept:** no code is requested from a screen that has not displayed the parsed E.164 number.
- `[trace: mandate #6 — a mistyped digit here sends the code to a stranger and is unrecoverable
  without support; the number is exactly the high-risk field mandate #6 describes]`

### 3.2 The offline posture — the load-bearing requirement

**REQ-ID5 — A verified session must survive indefinitely offline. Being offline must NEVER return a
signed-in user to the verification screen.**
Once verified, the session persists via the existing AsyncStorage adapter and token refresh; a
refresh failure caused by no connectivity leaves the user signed in and working, and is retried,
never escalated to a logout.
- **Accept:** with the device in airplane mode for the full token lifetime, the app still opens to
  the main screen and every capture modality still works. A forced logout while offline is a
  release-blocking defect.
- `[trace: mandate #7 (offline-forward is paramount) · mandate #1 (never lose a capture — a capture
  the user cannot start is a capture lost) · connector.ts:117-128 (persistSession/autoRefreshToken)]`

**REQ-ID6 — Verification failure states name the cause and the remedy, in the user's language.**
Three distinct states, never collapsed into one error: *no network* (retry when you have signal),
*code did not arrive* (resend, with the carrier delay stated), *code is wrong* (re-enter). The
Spanish strings ship in the same commit as the English ones.
- **Accept:** EN/ES key parity gate passes; each of the three states has its own key pair.
- `[trace: mandate #5 (per-user display language) · authscreen.tsx:8-9 "a login that fails silently
  is the same sin as a save that fails silently"]`

**REQ-ID7 — Rate limiting and resend are explicit, not silent.**
Resend is available on a visible countdown. Provider rate-limit rejections surface as REQ-ID6's
"code did not arrive" state with the wait stated — never as a generic failure.
- **Accept:** tapping resend before the countdown expires is impossible, not merely ignored.
- `[trace: assumption — Supabase/Twilio rate-limit behaviour is not yet measured. Flagged per
  CLAUDE.md §3 "if you can't trace it, flag it as an assumption".]`

### 3.3 Attribution

**REQ-ID8 — `owner_id` is always a verified user id. It is never inferred from the device.**
No capture, project, or attachment is ever written with an owner derived from anything other than
the authenticated session.
- **Accept:** every write site takes the id from the session; grep finds no device-id fallback.
- `[trace: AppSchema.ts:70-83 · App.tsx:1816 "Nothing that syncs may be written with a…" ·
  mandate #9 (evidence) — an unattributed capture is not evidence]`

**REQ-ID9 — One phone number, one account. The binding is exclusive in both directions.**
A number already bound to an account can never create or attach to a second one; an account carries
exactly one number. There is no crew/shared-device mode, and no "who is using this phone right now"
prompt — the signed-in user IS the author, always.
- **Accept:** attempting to verify a number already bound to another account returns that account's
  session, never a new one. No screen anywhere asks who is holding the device.
- `[trace: P4 (hadar, 2026-08-01) · REQ-ID8 — exclusivity is what lets `owner_id` mean "who
  captured this" without a second lookup]`

---

## 4. Step order

The account step joins onboarding **after** the slides and **before** profile setup, which is where
`AuthScreen` already sits:

```
splash → 4 slides (once) → [phone → read back → code] → profile setup → main
                            ^^^^^^^^^^^^^^^^^^^^^^^^^
                            replaces AuthScreen
```

No change to the surrounding gate at `App.tsx:3267-3275`; `AuthScreen` is swapped for the two-step
phone screen and `onAuthStateChange` continues to be the single source of truth for "logged in".

---

## 5. Shared devices — DECIDED: one phone, one user (P4)

**Hadar, 2026-08-01: "only one phone can be used with a user."** Crew/shared-device mode is out of
scope. The signed-in user is the author of every capture on that handset, with no prompt and no
ambiguity. This is what makes REQ-ID8 meaningful rather than nominal: `owner_id` means "who captured
this" because nothing else can.

**The cost, stated so it is not discovered in the field.** A crew sharing one handset cannot hand
off without sign-out + a new OTP, and OTP needs signal. In a dead zone the handset stays signed in
as whoever last verified, and captures are attributed to them. Two consequences follow:

1. The product's answer to "my crew shares a phone" is **give each person their own account on their
   own phone** — consistent with the solo-operator framing in `CLAUDE.md` §1, where the office is a
   role and never a requirement.
2. Sign-out must therefore be **hard to do by accident**. Signing out in a dead zone strands the
   user outside the app entirely, and REQ-ID5 protects only the session that already exists — it
   cannot resurrect one the user threw away. *(Follow-on requirement, not yet written: sign-out
   should warn that it needs signal to undo.)*

---

## 6. Existing accounts — DECIDED: no migration (P6)

**Hadar, 2026-08-01: "all fake."** Every existing account and its data is test material. There is no
migration, no re-parenting, and no `auth.users` phone-binding step. The cutover is clean.

This removes the only requirement in this spec that would have touched append-only evidence, and
with it the mandate #1 tension described in the previous draft. The 74 captures / 21 change orders /
2 projects backed up from the test device on 2026-08-01 are development fixtures, not records; the
backup at `/Volumes/OperationalDisk/HiLoVentureGroup/EZJobsite/device-backup-2026-08-01` is retained
for convenience only and carries no evidentiary obligation.

---

## 7. Cost and risk, stated honestly

- **SMS is not free.** Per-message cost, and a provider (Twilio/MessageBird/Vonage) must be
  configured before any of this works. `authscreen.tsx:1-3` is explicit that this provider is the
  thing that did not exist.
- **Deliverability fails in ways email does not** — carrier filtering, delays, landlines, VoIP
  numbers. REQ-ID6/ID7 exist because of this.
- **SIM swap** is a real attack on phone-as-identity. Accepted for this threat model (change orders,
  not payments); revisit if the product ever moves money.
- **Foreign numbers.** A Spanish-speaking crew may carry non-US numbers; E.164 parsing and
  international SMS pricing must both handle it. Untested.

---

## 8. Verification gate

| | Gate | Status (2026-08-01) |
|---|---|---|
| 1 | A real device completes phone → code → main screen with the code auto-filled (REQ-ID3). | **NOT VERIFIED** — no SMS provider exists, so no code can be sent. The `textContentType`/`autoComplete` attributes are set but unproven. |
| 2 | Airplane mode for the full token lifetime does not log the user out (REQ-ID5). **The gate that matters most.** | **NOT VERIFIED** — untouched by this change (the existing `persistSession`/`autoRefreshToken` config carries it), but never actually tested. |
| 3 | EN/ES parity passes with all three failure states present (REQ-ID6). | **PASS** — 1085/1085 keys, no missing or extra. |
| 4 | A number already bound to one account cannot create a second (REQ-ID9). | **NOT VERIFIED** — enforced by Supabase's phone uniqueness, not by our code; needs a provider to test. |
| 5 | `tsc --noEmit` clean; no `signInWithPassword` reference survives. | **PASS** — typecheck clean, 418/418 tests pass, grep for `signInWithPassword`/`secureTextEntry`/`auth.password` returns nothing. |

**Built 2026-08-01:** `toE164` extracted in `sendto.ts` (one parser shared with quick-add, 15 existing
tests still pass) · `startPhoneAuth`/`verifyPhoneCode` replace `login`/`signUp` in `connector.ts` ·
`authscreen.tsx` rewritten as number → confirm → code · EN/ES strings. All three steps rendered and
visually confirmed on the simulator, including the `+1` read-back (REQ-ID4).

**What that means honestly:** the flow is complete and compiles, and everything that can be checked
without sending an SMS has been checked. Nothing that requires an actual code round-trip has been
verified at all.

---

## 9. Open items

- **P5 — number-change recovery is now the sharpest hole in this design.** With P4 (one number, one
  account) and no password, a user who changes their number and never set a recovery email has lost
  access to everything permanently. Not urgent while all data is fake (P6), but it must be answered
  before a real user exists.
- **Sign-out needs a guard** — §5.2. Signing out in a dead zone strands the user outside the app.
  Requirement not yet written.
- **REQ-ID7** rate-limit behaviour is an assumption until measured against the real provider.
- SMS provider not selected. Cost model unbuilt. This blocks everything.
