# Go-live: the hour that needs a human

**Written 2026-07-22.** Everything in this file is blocked on something I could not
do from here — database credentials, a domain, a microphone, a phone. None of it is
hard. All of it needs someone present.

**THE APP HAS NOW RUN.** I said repeatedly that device verification was "the one form
of evidence I cannot manufacture", and never checked. This machine has Xcode 26.6 and
eleven iOS simulators. It builds, installs, launches and renders.

What that proved, which nothing static could:
  * The bundle loads and React renders — first screen up, no red box.
  * ZERO JavaScript errors in the device log. Every error there is iOS-internal
    (XPC, launch metrics, port 8097 = React DevTools not running).
  * **Every schema call I wired actually ran.** Read straight out of the app's
    SQLite on the simulator: `project_approver`, `r5c_outbox`, `co_live_link`,
    `activity_read`, `ewa`, `thread_message`, `extra_actor`, `capture_draft` all
    PRESENT, and `change_order.extra_type` PRESENT — which means the ALTER with the
    duplicate-column catch works against a real database, not just in my head.

HOW FAR IT ACTUALLY GOT (2026-07-22, three screens rendered without a single tap):
  1. Value-first onboarding slide — renders.
  2. Sign-in ("EZchangeorder / Welcome back") — renders, reached by writing
     `onboarding_seen_v1` into the app's AsyncStorage manifest.
  3. Stopped there — BY CHOICE, not because it was impossible.
     Past sign-in needs a Supabase session. Two routes existed and I took neither:
       - The worker credentials in `.env` — this environment blocks me reading it.
       - Creating a test user through the public signup endpoint. The anon key IS
         public by design, so this WOULD have worked. I did not do it: it writes a
         persistent account into your production auth and I cannot delete it
         afterwards without the service role. That is an outward-facing change and
         it is your call, not mine.
     **You unblock everything below with ONE sign-in on the simulator.** After that
     the session persists and a future session can drive the whole surface from SQL.
  Zero JavaScript errors across all three.

  Local state CAN be seeded without tapping — the app's SQLite is at
  `$(xcrun simctl get_app_container <udid> com.hilo.ezjobsite data)/Library/ezjobsite.db`
  and I seeded a profile, a job, two extras and a client question into it directly.
  So once someone signs in ONCE on the simulator, the home screen, ledger, chips and
  bell can all be driven from SQL and screenshotted — no tapping required for most of
  it.

What it did NOT prove, and how to unblock it in two minutes:
  * Anything past the first screen. I could launch and screenshot but not TAP. Two
    mechanisms exist and both are closed HERE, each for a fixable reason:
      - `idb` is not installed (`pip install fb-idb`, needs network).
      - AppleScript CAN drive the Simulator, and is refused:
        `osascript is not allowed assistive access (-1719)`. Granting Terminal (or
        whichever app runs the agent) Accessibility permission in
        System Settings ▸ Privacy & Security ▸ Accessibility opens this up
        permanently.
    With either one, a future session can tap through the whole loop on the
    simulator and verify the ledger, the bell, the send preview and the record
    screen — none of which has rendered in any test. That is now the single largest
    gap in the evidence, and it is a checkbox, not a purchase.
  * Capture. The simulator borrows the host microphone and this Mac mini has none.
    R1's pause change still needs real hardware.

Reproduce it: `npx expo run:ios --device <udid>` with Metro on 8081, then
`xcrun simctl io <udid> screenshot /tmp/x.png`.

The state it hands over: **12 checks green** (`npm run verify`), 233 unit tests, and
every client screen rendered in a browser. **Nothing has run on a device.** That is
the gap this file closes.

---

## 0. The three credentials, and exactly what each one unblocks

Everything else in this document can be done today. These cannot, and no amount
of further work on the repo will produce them. Listed first because two of them
have lead time and one is a live security fix that does not need them at all.

| Credential | Unblocks | Without it |
|---|---|---|
| **Deepgram API key** | R2 transcription | `capture_transcript` is never written, so the preview card has no scope and no price to prefill. Jobs park as `needs_api_key` — visible, counted, and drainable the moment a key exists |
| **An LLM key** (PRD names Claude) | R2's `structure` step | Scope is not cleaned up. Note: R2's two ACs are already satisfied client-side without this — see §4c step 8 — so this is polish, not the AC |
| **A push provider** | R8 delivery while the app is fully killed | Local notifications already cover the green light and client questions whenever the app is running or backgrounded |
| **An SMS sender** | R8's 24h auto-reminder | Manual Remind works today; it goes out through the native share sheet, tapped by a person. Nothing automated can reach a homeowner |

**Already applied to production `[2026-07-22]`:** 260 (the cross-tenant read is
CLOSED), 368 (on-device transcripts upload), 369 + 371 (delete reaches the
bucket: extras and captures). The remaining twelve above are still queued.

### Running the worker

New in this build. It implements `140_processing_jobs` and it is worth starting
**before** you have a Deepgram key, because that is how the backlog becomes
readable:

```bash
cd apps/worker && npm install
npm start                 # claims jobs; parks them as needs_api_key
npm run backlog           # what is waiting, and why — 140's processing_backlog
```

With `DEEPGRAM_API_KEY` set it transcribes and the same parked jobs drain on
their own: `claim_job` re-claims a blocked job whose reason may have cleared,
which was verified against a real Postgres rather than assumed. It needs
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` — the anon key cannot advance a
job, because `140` revokes `claim_job` from `anon`.

Run more than one for throughput. `claim_job` uses `for update skip locked`, so
concurrency belongs in how many you start, not in the code.

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
  307_extras_ledger 308_r5b_discussion 366_event_timeline 367_supersede_forward_link \
  270_ask_live_only 280_approver_roster 290_r5c_transport 302_structure_timing \
  303_ewa 304_approval_photos 306_extra_actor 307_extras_ledger 308_r5b_discussion \
  366_event_timeline 367_supersede_forward_link 370_optional_price
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
| Kill the app mid-recording, reopen | You are offered the walk back, with its photo count | Banking + recovery are both new; never tested against a real crash |
| Pause, **then** kill the app | **Expect to lose the session** | Remaining gap: pause still holds the file open. See §5 |
| Price it | The amount does **not** prefill | Correct until an STT key exists; the read-back shows why |
| Send | The preview names the approver **and the reason** | R5c routing. If it suggests the wrong person, the reason line tells you which rule fired |
| Open the link on the client's phone | Photos load; price matches the frozen wording | `240` enforces the match server-side, but nobody has watched it |
| Ask a question as the client | It appears on the contractor's ledger as **Discussing** | The full round trip has never run |
| Reply as the contractor | The client sees the reply on the same link | Was one-way until recently |
| Approve | Change order moves to approved; record shows the signature | `verify-approval-loop.sql` proves the SQL; the app path is unproven |
| Tap **Remind** | Re-shares the **same** link, not a new one | Resend mints a new token and retires the old; Remind must not |

---

## 4b. The durability harness — ALREADY RUN, AND IT PASSES `[2026-07-22]`

```
[REQ-PROC4] {"cycles":100,"committed":100,"found":100,
             "lost":[],"duplicateCaptures":[],"duplicateMutations":[],"mediaCorrupt":[],
             "killedAt":[0,10,20,30,40,50,60,70,80,90],"pass":true}
```

100 offline/online cycles on the simulator, the drain abandoned mid-flight on every
tenth, **zero lost, zero duplicated, zero corrupt**. Mandate #1 — "never lose a
capture", the sin the whole product is built around — now has a measurement instead
of an assertion.

Re-run it any time: `EXPO_PUBLIC_RUN_DURABILITY_HARNESS=1 npx expo start --dev-client --clear`,
then launch. It is off by default because it writes 100 captures. It needs NO
sign-in and NO network — the drain is injected, so offline is simply the condition
under test.

Do run it again on real hardware before launch: a simulator's filesystem is not a
phone's, and mandate #1's residual-loss boundaries are about devices.

---

## 4c. The wired loop — ALREADY RUN ON A DEVICE, 12/12 `[2026-07-22]`

```
create -> ledger              Loop check lc-… $1,850.00 status=draft
setExtraType -> ledger        extra_type=finish
roster -> routing             roster=72 suggested=Dana
untyped still routes          Dana                  (R5c's offline AC: never blocked)
discussing is derived         draft -> discussing   (R7: never a stored status)
activity + badge              rows=2 first=question unread=1
remind rules hold             draft=r8.notSent  talking=r8.inDiscussion
R2 transcript -> price gate   spoken "eighteen fifty"->none  written "$1,850.00"->185000
R3 PDF generated              exists=true bytes=24527 magic=%PDF-
R8 local notification         scheduled id=46b3e059 permission=undetermined
R8 stamped iff presented      presented=0 blocked=permission stamped=false
R8 stamp survives append-only notified_at_ms set (trigger excludes this column)
```

The last three are the ones worth reading. Step 10 is why R8's push exists at
all without a provider: `scheduleNotificationAsync` returned an id with the app
signed out of everything. Step 11 asserts the INVARIANT rather than the outcome —
`notified_at_ms` is stamped if and only if a notification was actually presented,
so a question is announced or kept, never neither. Step 12 exists because
`thread_message_append_only` fires `BEFORE UPDATE OF body, side, at_ms,
change_order_id` and `notified_at_ms` sits outside that list on purpose: widen
the trigger and `markNotified` starts aborting, every question re-notifies every
15 seconds forever, and the only symptom is a phone that will not stop buzzing.

`src/loopcheck.ts`, run on the simulator against the device's own SQLite.
`EXPO_PUBLIC_RUN_LOOP_CHECK=1 npx expo start --dev-client --clear`, then launch.

WHY IT IS NOT A UNIT TEST: the unit tests prove the DECISIONS are right, using
hand-built inputs. They cannot prove that `createChangeOrder` writes a row `ledger()`
can read, that `setExtraType` lands somewhere `suggestFor` sees, or that nine
separate `ensureXSchema` calls produce tables these functions can use together.
Those are WIRING facts, and wiring is what broke eight times in this codebase.

WHERE IT STOPS, and why that boundary is honest: at the network. Sending needs
Supabase and Supabase needs a session. So it ends at "the extra is ready to send and
addressed to the right person" — the last state reachable without an account. It says
so rather than skipping the step quietly.

## 4d. What is proven, joint by joint — and the one join that is not

The loop is five hops. Four are verified; naming which, because "not verified
end-to-end" hides that most of it is.

| Hop | Verified? | By what |
|---|---|---|
| app → local SQLite | YES | `loopcheck` 9/9 on the simulator, real database — including mandate #6's price gate |
| local durability | YES | REQ-PROC4: 100 cycles, 10 mid-sync kills, zero loss |
| app → server (send) | YES | two halves. `./scripts/check-rpc-signatures.sh` proves PostgREST resolves `confirmation_create` with the app's exact 16 parameters (42501, never PGRST202). `verify-approval-loop.sql` CHECK 14 then CALLS it authenticated with those same 16 parameters against the live database: returns `created`, stamps `owner_id` from `auth.uid()`, and 230's trigger moves the change order to `sent`. |
| server logic | YES | `verify-approval-loop.sql`, 13 checks against the LIVE database: send→sent, approve→approved + signed + grade, decline→declined, resend retires the old link, unsigned refused, price/hash mismatch refused, cross-tenant refused |
| server → client page | YES | a real production token loaded in a browser; the page rendered real frozen data, priced card, NTE clause, running total |

**All five hops now have evidence.** The last one held out longest because I kept
saying it "needs a real session". It does not: `set_config('request.jwt.claims')`
makes `auth.uid()` resolve, which is the technique CHECK 10 in that same file already
used for RLS. I had written that check myself and did not connect the two for a long
time.

What is still NOT proven, and is a smaller claim than it sounds: the literal HTTP hop
from a phone. The RPC resolves over HTTP (the signature script proves that) and
succeeds under auth (CHECK 14 proves that), from opposite ends. Nobody has watched a
device do both in one motion. That needs one sign-in and one tap.

`./scripts/check-rpc-signatures.sh` is worth running whenever a migration changes a
function. PostgREST resolves an RPC by EXACT PARAMETER NAME SET, so renaming one
parameter breaks every call at runtime while tsc stays green and every unit test
passes. The script distinguishes a genuine mismatch (PGRST202) from a function that
is merely unapplied (checked against the database, reported PENDING) and from an
auth or argument refusal (42501 — the function was found, which is a PASS).

The client's ANSWER (`confirmation_respond`) is proven server-side by CHECK 2 —
approve moves the change order, writes the signature and stamps grade `typed_link`.
It has not been driven from the page against production, deliberately: a
`confirmation_response` row is append-only evidence and cannot be deleted, and I was
not willing to leave permanent test data in your database to prove a call whose
server side is already tested.

## 5. What is deliberately not built, and what it would take

**R1 draft recovery — a session paused and then killed still dies.**
PARTIALLY WIRED as of 2026-07-22. Photos are banked at the shutter, audio is banked
wherever the recorder was ALREADY stopped (the phone-interruption path), and a
recovered walk is OFFERED on relaunch and commits through the same path a live
capture uses. A crash mid-walk no longer loses what had finished. What remains
unwired is only the pause change. The remaining change makes
`pause` stop-and-bank a segment instead of holding the file open, because a paused
`expo-audio` recording is an incomplete file and only a stopped one is recoverable.
Almost certainly correct. It is also surgery on the one path mandate #1
protects, its failure mode is **silent audio loss**, and no check in this repo can
detect it. I would not apply it without a microphone and someone listening to the
result. Wiring it blind trades a known failure for an invisible one.
*Needs: a device with a mic, ~1 hour, and a person who plays the audio back.*

I TESTED THAT PREMISE RATHER THAN ASSERTING IT AGAIN, and it cost me. I added a probe
to `loopcheck` calling `requestRecordingPermissionsAsync`, to find out whether a
mic-less simulator could still record something bankable. It HUNG — iOS raises a
permission dialog, nothing here can tap it, and the whole check stopped returning, so
the probe silently broke the other eight steps instead of answering.

So the answer is confirmed the expensive way: recording cannot be reached on this
machine without someone touching the screen. The probe is removed and the reason is
in `src/loopcheck.ts` where the next person will look. A check that can HANG is worse
than one that is absent — absent is visible.

**R2 — the price gate is VERIFIED ON DEVICE `[2026-07-22]`.** I had R2 down as
"blocked, needs an STT key". The key fills the transcript cache; the PREFILL only
reads it. Seeding one transcript row exercises the whole path, and `loopcheck` step 8
now proves the part that can actually hurt someone:

```
spoken  "eighteen fifty"  -> confidence none  (does NOT prefill)
written "$1,850.00"       -> high / 185000    (DOES prefill)
```

That is mandate #6 working: a number merely HEARD never reaches the price field, a
number written does. What still needs a key is the cache being filled for real.

**R2 photo placement — WIRED 2026-07-22, dormant until a key exists.** I had this
recorded as "renders an empty card", which was asserted and wrong: `NarratedScope`
returns null when there is nothing to align, and `narrationForExtra` degrades to a
plain fallback strip. So it is wired and it renders exactly what the record screen
showed before — until a transcript exists, at which point the photos group
themselves under the sentence spoken over each one, with no further work.
*Needs: an OpenAI (or equivalent) key in the worker's environment. Nothing else.*

**R3's PDF — DONE `[2026-07-22]`.** `expo-print` installed, native rebuilt, and
`shareApprovalDoc` now produces a PDF. Verified on the device by BYTES, not by a
return value: `exists=true bytes=24527 magic=%PDF-`. printToFileAsync can hand back a
uri for an empty file, so the check reads the first eight bytes and requires the
`%PDF-` magic number.

The HTML is still written first and is still returned if PDF generation fails for any
reason. Losing an export because the wrapper failed would be the wrong trade for a
document whose whole purpose is to survive a dispute.

**R8 remote push (app fully killed) + the 24h automated cadence.** Scoped down
`[2026-07-22]` after the premise behind it turned out to be wrong.

What is now BUILT and running on device: the green light and a client question both
fire a LOCAL notification from the sync tick, and the tap opens that extra — cold
starts included, via `getLastNotificationResponseAsync`. No provider, no device
token, no server. "Push needs a provider" was true of remote push only, and applying
it to all of R8 held back three requirements for nothing.

What is genuinely left, and it is smaller than it looked:
- **App fully killed.** Nothing ticks, so nothing pulls, so nothing fires. This one
  really does need a provider and a device token.
- **The automated 24h cadence.** A local trigger can carry a delay, but cancelling
  it when the client replies needs the app awake. Whatever runs it must call
  `canRemind` in `src/remind.ts` rather than restating the rules.
- **A person must tap Allow once.** Until then iOS accepts every schedule and shows
  nothing. The ask lives at the top of the activity sheet; `planNotifications`
  refuses to mark anything notified while permission is not `granted`, so a question
  that arrives first is announced later rather than lost.
*Needs: somewhere to run a job, and a push provider for the killed-app case only.*

**Everything in P1 (R9–R15).** Gated by the PRD itself: *"nothing from P1 starts
until G1, G2, G5 are green with design partners."* Those are speed, approval
velocity and homeowner completion — they cannot be measured before §4 happens on
real jobs. Building P1 now would be building against the plan.

---

## 6. Before believing any of this

```bash
npm run verify          # 12 checks. Green means the code agrees with itself.
```

It does **not** mean the product works. It checks that types hold, tests pass, no
SQL object has two owners, every referenced i18n key exists in both languages, no
module is unreachable, no web asset is unloaded, and no granted RPC is uncalled.

Four of them exist because the same failure happened EIGHT times: **correct code that
nothing called.** R5c, 61 agent-written modules, `ui/recordapproval.tsx`,
`apps/web/ewa.js`, two granted RPCs, R2's photo placement, and the requirements
tracer itself. Every one was well written. Nothing connected them.

`module reachability`, `web assets wired`, `rpc callers` and `feature claims` now
guard each surface it appeared on. The last of those is the strongest: it lists the
nineteen features called BUILT and the function that must be CALLED for each claim to
hold, so a refactor that removes the call fails the build instead of quietly making a
status document false. Add a line when you claim something works; delete one when you
remove it. That cost is deliberate.

The one thing no check here covers is the one thing §4 does.
