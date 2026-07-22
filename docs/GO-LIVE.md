# Go-live: the hour that needs a human

**Written 2026-07-22.** Everything in this file is blocked on something I could not
do from here — database credentials, a domain, a microphone, a phone. None of it is
hard. All of it needs someone present.

The state it hands over: **11 checks green** (`npm run verify`), 233 unit tests, and
every client screen rendered in a browser. **Nothing has run on a device.** That is
the gap this file closes.

---

## 1. Apply the migrations — 10 minutes

**Order matters and the numeric order was wrong once already.** `305` read a column
`307` creates; applied in sequence it died and took two later migrations with it,
which would have left the database half-migrated. It is renumbered `308` and the
sequence is verified, but verify it again before you run it — that is the whole
point of the script.

```bash
cd apps/../                       # repo root
./scripts/check-migration-order.sh \
  260_approval_visibility 270_ask_live_only 280_approver_roster 290_r5c_transport \
  302_structure_timing 303_ewa 304_approval_photos 306_extra_actor \
  307_extras_ledger 308_r5b_discussion 366_event_timeline 367_supersede_forward_link
```

Expect: `ALL 12 APPLIED CLEANLY IN SEQUENCE`. It runs them in ONE transaction with
`ON_ERROR_STOP` and rolls back, so it proves the sequence without changing anything.

Then apply them for real, in that same order.

**The first one is not optional.** `260_approval_visibility` closes a live tenant
leak: `appr_read` on `approval` is currently `using (true)`, so any signed-in user
can read every approval in the database — the frozen document, the price, and the
client's typed signature, across every tenant. Verified live, not inferred:

```bash
./spike/bin/pg.sh -f scripts/verify-approval-loop.sql
```

`CHECK 10` currently **FAILS** and prints `alice reads bob's signature: Bob Client`.
After `260`, it passes. Checks 11, 12 and 13 currently SKIP and will start running.

---

## 2. Point the domain at the page — 20 minutes, mostly waiting

The page deploys on every push to `main` and has never been reachable. GitHub Pages
serves this repo at a **parked domain over plain HTTP**, and this page carries a
price and collects a signature — over HTTP anyone on the same wifi can rewrite the
number between the server and the client's eyes, which defeats
`240_shown_content_integrity` entirely.

1. **Namecheap → ezchangeorder.com → Advanced DNS**
   `CNAME` · host `approve` · value `hadarwissotzky.github.io` · TTL automatic
2. **GitHub → ezJobsite → Settings → Pages → Custom domain** → `approve.ezchangeorder.com`
3. Wait for the certificate, then tick **Enforce HTTPS**. Do not skip this.

---

## 3. Point the app at the domain — 2 minutes

```
EXPO_PUBLIC_CONFIRM_BASE=https://approve.ezchangeorder.com
```

Until this is set, `sendForConfirmation` **refuses every send**. That is deliberate:
it used to mint a token and hand back a relative URL that could never open.

---

## 4. Send one real extra — the part that matters

Build to the phone and do the whole loop once, on a real job, with a real phone
number. Everything below has been type-checked, unit-tested, or rendered in a
browser. **None of it has been executed by a person.**

Watch these in particular, because they are where I have the least evidence:

| Step | What to check | Why this one |
|---|---|---|
| Record a walkthrough | Audio survives a phone call mid-recording | The interruption path rolls a new segment; never exercised with a real call |
| Pause, then kill the app | **Expect to lose the session** | Known gap. R1's fix is written and deliberately unwired — see §5 |
| Price it | The amount does **not** prefill | Correct until an STT key exists; the read-back shows why |
| Send | The preview names the approver **and the reason** | R5c routing. If it suggests the wrong person, the reason line tells you which rule fired |
| Open the link on the client's phone | Photos load; price matches the frozen wording | `240` enforces the match server-side, but nobody has watched it |
| Ask a question as the client | It appears on the contractor's ledger as **Discussing** | The full round trip has never run |
| Reply as the contractor | The client sees the reply on the same link | Was one-way until recently |
| Approve | Change order moves to approved; record shows the signature | `verify-approval-loop.sql` proves the SQL; the app path is unproven |
| Tap **Remind** | Re-shares the **same** link, not a new one | Resend mints a new token and retires the old; Remind must not |

---

## 5. What is deliberately not built, and what it would take

**R1 draft recovery — a paused session dies with the app.**
The fix exists (`capturesession.ts`, unit-tested) and is **not wired**. It changes
`pause` to stop-and-bank a segment instead of holding the file open, because a
paused `expo-audio` recording is an incomplete file and only a stopped one is
recoverable. Almost certainly correct. It is also surgery on the one path mandate #1
protects, its failure mode is **silent audio loss**, and no check in this repo can
detect it. I would not apply it without a microphone and someone listening to the
result. Wiring it blind trades a known failure for an invisible one.
*Needs: a device with a mic, ~1 hour, and a person who plays the audio back.*

**R2 photo placement.** Aligning a photo to the sentence spoken over it needs
transcript segments. No STT key ⇒ it renders an empty card on every record.
*Needs: an OpenAI (or equivalent) key in the worker's environment.*

**R3's PDF.** The approval document generator exists, is wired, and works today —
it writes HTML and shares it through `expo-sharing`. Only the PDF container is
missing: `expo-print`'s `printToFileAsync` takes exactly the HTML this produces.
*Needs: `npx expo install expo-print` and a dev-client rebuild.*

**R8 push + the 24h automated cadence.** The in-app half is built: bell, unread
count, activity list, manual Remind with its rate rules. Push needs a provider and a
device token; the automated cadence needs a scheduler. Both should call `canRemind`
in `src/remind.ts` rather than restating the rules.
*Needs: `expo-notifications`, an `app.json` scheme, a native rebuild, and somewhere
to run a job.*

**Everything in P1 (R9–R15).** Gated by the PRD itself: *"nothing from P1 starts
until G1, G2, G5 are green with design partners."* Those are speed, approval
velocity and homeowner completion — they cannot be measured before §4 happens on
real jobs. Building P1 now would be building against the plan.

---

## 6. Before believing any of this

```bash
npm run verify          # 11 checks. Green means the code agrees with itself.
```

It does **not** mean the product works. It checks that types hold, tests pass, no
SQL object has two owners, every referenced i18n key exists in both languages, no
module is unreachable, no web asset is unloaded, and no granted RPC is uncalled.

Those last three exist because the same failure happened five times: **correct code
that nothing called.** R5c, 61 agent-written modules, `ui/recordapproval.tsx`,
`apps/web/ewa.js`, and two RPCs. Every one was well written. Nothing connected them.
If you add a module and `verify` goes red on reachability, that is the check doing
its job — wire it, delete it, or record why not.

The one thing no check here covers is the one thing §4 does.
