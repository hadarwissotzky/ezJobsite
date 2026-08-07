# The client portal — send to owner, approve, communicate, negotiate

**Written 2026-08-06 · Status: authoritative for the counterparty-facing surface**

*The product ask, verbatim (hadar): "send to client (owner). That sends the user an SMS
with a link to a portal that they have access to via the link. Where they can approve,
communicate, negotiate."*

**Governed by `CLAUDE.md`'s ten mandates and by `docs/SPEC-extra-lifecycle-v1.md`.**
Where this document and either of those appear to conflict, they win and the conflict
is a defect here. In particular this document owns **none** of the lifecycle: the
statuses, the transitions, the seal and `shown_content` are `SPEC-extra-lifecycle-v1`'s
and are only *referenced* below.

**What this document owns:** the counterparty's side of the loop — what the SMS says,
what the page at the end of the link does, what the token is and is not, what an
attacker holding a link can do, and what the contractor sees when the client acts.

---

## 1. The finding that outranks everything else in this document

**Before this pass, every approval link in production stopped at "Loading…" and
rendered nothing.** Not slowly — never.

`confirm.html` fired its open-logging RPC as `supabase.rpc(…).catch(…)`. What
`supabase-js` returns from `rpc()` is a `PostgrestFilterBuilder`: a **thenable**, with
a `.then()` and **no `.catch()`**. So the line threw `supabase.rpc(...).catch is not a
function` synchronously inside `load()`, which was invoked bare at the bottom of the
module — making it an unhandled rejection with nowhere to go.

The failure was invisible from every angle a person would look from:

| Where you would look | What you saw |
|---|---|
| The page | A spinner. No error, no timeout, no message. |
| The browser console | Nothing. An unhandled rejection is not a console error. |
| The network tab | `confirmation_fetch`, `confirmation_state`, `confirmation_photos` all **200 OK**. |
| The database | A perfectly good `confirmation_request` row. |

So it read as a slow server rather than a dead product. Reproduced against the live
database and the real token in `confirmation_request` on 2026-08-06, **on the page as
committed, before any change in this pass**, then fixed and re-verified.

**The cause is version drift on an unpinned CDN import**, and the fix does not remove
it. The page imports `https://esm.sh/@supabase/supabase-js@2` — an unpinned major
range, resolved at page load, off a third-party host. The builder used to extend
`Promise`; in 2.112 it does not. A patch release **on someone else's server disabled
the entire client-facing half of this product** with no commit, no deploy and no
signal. See §8.

Two changes, both in `confirm.html`:
* `Promise.resolve(supabase.rpc(…)).catch(…)` — correct against both shapes.
* `load().catch(…)` renders an honest recovery screen. **Nothing may leave a client on
  "Loading…" forever again**; the outage lasted as long as it did because the failure
  had a message and nowhere to put it.

---

## 2. The flow, end to end

```
CONTRACTOR                          SERVER                        CLIENT (no account)
──────────                          ──────                        ───────────────────
Send preview (mandate #2)
  │ human confirms recipient
  ▼
sendForConfirmation()
  renderCard() ──► shown_content ──► confirmation_create
  160-bit token                       · freezes shown_content + sha256
  │                                   · freezes price, scope, company, job, total
  │                                   · 230: change_order draft ──► sent
  │                                   · 250: any prior live link is RETIRED
  ▼
publishApprovalPhotos() ──────────► approval_photo (bound to THIS token)
  │
  ├─ automatic SMS (Twilio, via the send-sms Edge Function)
  └─ or the OS share sheet — the always-works fallback
                                                        ────────► SMS with the link
                                                                        │
                                                                        ▼
                                                              confirm.html?t=TOKEN
  push "Opened" ◄───── notification_outbox ◄── confirmation_opened (60s coalesced)
                                                                        │
                                                   ┌────────────────────┼─────────────┐
                                                   ▼                    ▼             ▼
                                            confirmation_ask      confirmation_respond
                                            (unsigned, repeatable)  (SIGNED, terminal)
                                                   │                    │
  push "Question" ◄── notification_outbox ◄────────┤                    │
  (395_client_portal_loop — NEW)                   │                    │
                                                   │                    │
  postReply ──► r5b_outbox ──► ingest_r5b_v1 ──► confirmation_reply     │
                                                   │                    │
                                          the portal polls and          │
                                          shows it in place ◄───────────┤
                                                                        ▼
                                                              230: sent ──► approved
                                                              379: push "Approved ✓"
                                                              395: push, for a plain
                                                                   decision with no
                                                                   change order
```

### The three moves the client has, and the line between them

| Move | Signed? | Terminal? | Writes | Rule |
|---|---|---|---|---|
| **Ask** | No | No | `confirmation_question` | Commits nobody. Repeatable. Approve stays live — R5b, "the Approve button remains pinned at every point in the thread". |
| **Approve** | **Yes** — typed legal name, ≥2 chars | Yes | `confirmation_response(action='confirmed')` | Mandate #2. `grade='typed_link'` (REQ-LC45). |
| **Decline** | **Yes** | Yes | `confirmation_response(action='declined')` | Signed for the same reason: unsigned, anyone holding the link could halt a job. Reason optional — demanding an explanation to say no is how you get no answer. |

**Negotiation is Ask, repeated, and it never moves money.** R5b's standing rule —
"price changes resolve only through revision + fresh approval, never through thread
agreement" — means a number typed in the discussion by either party changes nothing.
The portal now **states that on the page** rather than leaving it to be discovered:

> *If the price or the work needs to change, they send you a new version to approve.
> Agreeing to a number in this discussion does not change what you are signing above.*

Without that sentence a homeowner who negotiates $1,500 in the thread reasonably
believes they have agreed $1,500, and the next thing they see is a bill for $1,850.
That is the dispute this product exists to prevent, produced by the product.

---

## 3. What already existed

Most of the portal was built. The survey found it substantially complete and
substantially unreachable.

| Piece | Where | State |
|---|---|---|
| Token mint, 160-bit | `confirmations.ts:newToken` | ✓ |
| Frozen instrument + hash at send | `renderCard` + `confirmation_create` | ✓ |
| Link shape `…/confirm.html?t=…` | `sendForConfirmation` | ✓ |
| The page: brand, scope, price, NTE clause, running total, photos | `confirm.html` | ✓ |
| Typed-signature approve, signed decline, ask | `confirm.html` | ✓ |
| Superseded link → forwards to the live version | `confirmation_state.live_token` | ✓ |
| Answered link → the frozen wording, forever | `already_answered` branch | ✓ |
| EWA as a separate instrument | `ewa.js`, gated on its clauses being on screen | ✓ |
| 30-day expiry, one live link, first-answer-wins, signature required | `020` `230` `250` `210` | ✓ |
| Open logging, 60s coalescing, contractor push | `366`, `notify_on_open` | ✓ |
| Both-sides thread, walking the revision lineage | `confirmation_thread` (308) | ✓ |
| Contractor's side: pull, reply, outbox, local notify | `discussionstore.ts`, `notifystore.ts` | ✓ |
| Automatic SMS via Twilio | `sms.ts` + `send-sms` Edge Function | ✓ (secrets unset — refuses loudly, by design) |
| Reminder scheduler, caps, loud failure | `388` | ✓ schema; **worker step unwritten** |

---

## 4. What was missing, and what was built

### 4.1 The page never loaded at all
§1. Fixed in `confirm.html`.

### 4.2 The scope and the terms were silently dropped from the page
`docSection()` — added 2026-08-05 specifically so the client sees the scope of work
and the terms before the price — built its regex from an ordinary string containing
`'[\s\S]'`. `\s` is not a recognised string escape, so the literal collapsed to `sS`
and the expression compiled as `([sS]*?)`: a class matching only the letter s. It
matched nothing on every real document, returned `null` on both calls, and the two
fallbacks quietly took over.

Net effect: **a client could approve a priced change order having seen a title, a
number, and nothing about what is excluded, when payment is due, or what it does to
the schedule.** Those were inside the collapsed raw wording — exactly where they were
before the fix that was supposed to bring them out. Nothing threw; the page looked
deliberate. Reproduced by running the old expression against a real `shown_content`,
fixed to `[\\s\\S]`, and verified in a browser against a full instrument.

### 4.3 Asking a question was a dead end
A sent question ended on a terminal screen with **no way back to the document, no way
to ask a second thing, and no way to approve**. Every route onward was outside the
app: find the text again, tap the link again, read the whole document again. Each of
those is a place a non-technical homeowner stops.

Since "negotiate" is by definition more than one message, this made the third of
hadar's three verbs unreachable. A sent question now **returns to the document** with
the thread refetched — so the client's own words are on the page, which is the proof
the terminal screen was really for — and Approve, Decline and Ask all live again. A
green banner carries the acknowledgement.

### 4.4 The conversation was invisible on two of the three documents (DEF-5)
The thread fetch sat *between* the EWA dispatch and the priced render:

* an **EWA** returned above it, so an owner holding an authorization could not see a
  single message either side had written about it;
* an **answered** link returned earlier still, so the moment a client signed, the
  discussion that led to the signature vanished from the only copy they have;
* a **plain decision confirm** never rendered a thread at all, while still offering
  the "Ask a question instead" button — so a client could ask, then never see their
  own question, the answer, or any evidence either happened.

The fetch is hoisted above every branch and all three render it. REQ-LC33 is
two-sided, and the party with the least access and the most at stake is the one who
signed. The answered card additionally renders the **photos** (REQ-LC43 puts them
inside the instrument by a different mechanism) and uses **closed-thread copy** — it
does not invite a reply the server would refuse (REQ-LC23; this is DEF-4's shape, not
repeated on the client side).

The EWA also never rendered its **photo strip** — the one instrument whose entire
content is a photographed condition, since it carries no price. Both now arrive
through helpers passed from `confirm.html`, not copied, each with a no-op fallback so
a version-skewed pair of static objects degrades instead of throwing.

### 4.5 The client could never learn that the contractor replied
The client has no account, no app and no push. The portal was static once drawn, so a
reply landed in the database and stayed there. Their only route back was a text
message they had no reason to re-open — and most people simply wait, which the
contractor reads as being ignored.

`watchForReplies()` re-reads the thread on `visibilitychange` (they locked the phone,
or switched to Messages, and came back — when a reply has most likely landed) and on a
25s poll while the page is genuinely visible. **Only the `#thread` card is replaced**,
never the page: a re-render would wipe a half-typed signature out of the name field
under the client's thumb, and collecting that signature is what the page is for.
Verified: a reply lands, the card is replaced and highlighted "New reply", and
`#name` still holds `"Jane Ow"`. It stops on any answer — a terminal record does not
change.

*This is the weaker half of the fix.* The strong half is an SMS, and it is blocked —
see §7.

### 4.6 A client's question notified nobody (`395_client_portal_loop.sql`, new)
`notify_on_open` (366) pushes when a client **opens** a link. `notify_on_verdict`
(379) pushes when a change order is **approved or declined**. Between them sat the
thing the portal exists for — the client **asking something** — and nothing raised a
notification. Checked, not assumed: `confirmation_question` carried exactly two
triggers, neither of which writes to `notification_outbox`.

So the shipped loop was: the client is told *"you can approve once they reply"*, and
the contractor is told nothing. The question reached him only if he happened to open
the app on that project and the sync tick ran `pullThreads → runNotifications`. R5b
AC5's 48-hour "Awaiting your reply" flag then fired against him for a message he was
never shown.

`notify_on_question` pushes **every** question, not only the first — deliberately
unlike `notify_on_open`. An open is a repeatable non-event; a question is an
obligation, and the second one is a second thing owed. The body carries the client's
own words (truncated at 140, as `discussion.ts` truncates) and **never the price** —
`notificationFor`'s reasoning applies: a figure read on a lock screen, out of its
frozen context, is a hazard under mandate #6.

`notify_on_unlinked_answer` covers the second shape of the same hole: a plain decision
confirm (`change_order_id IS NULL`) that is answered notifies nobody, because
`notify_on_verdict` is a trigger on `change_order` and there is no change order to
move. It is **guarded on `change_order_id IS NULL`** so the priced path is never
double-announced.

Verified in rolled-back transactions against the live database: a question produces
one `notification_outbox` row with the client's words; a **priced** answer produces
exactly one row (`Approved ✓`, from 379); an **unlinked** answer produces one row from
the new trigger.

*Duplication, stated rather than hidden:* `notifystore.runNotifications` also raises a
**local** notification for a pulled question, so both can fire. That is the trade this
repo already made for approvals (379 + `pendingApprovals` both announce one approval),
and `notifystore.ts`'s own header states the direction of error: *"A notification
shown twice is a nuisance; one never shown is mandate #1."* The push is the one that
works with the app closed, which is every case that matters here.

### 4.7 The SMS was the entire contract (`clientsms.ts`, new — NOT WIRED, §7)
The one SMS path sends `${shownContent}\n\n${url}`: the whole frozen instrument as the
message body. The 391 layout opens with an em dash, which is not in GSM-7, so the
message is encoded UCS-2 at 67 characters per concatenated segment — **seven
chargeable segments** for a one-line-scope instrument plus a Storage link (measured in
`clientsms.test.ts`, not estimated), growing with the scope and the terms.

Cost is the least of it. What arrives is a wall of contract text in a message bubble
with the link — the only actionable thing in it — below the fold, under a price and a
not-to-exceed clause the reader cannot act on from there. The person this product is
built for reads the first line, does not scroll, and never opens the approval.

`clientSmsBody()` composes **who is asking, what kind of thing it is, what it costs,
and the link** — two segments, GSM-7, link above the fold — and:

* **checks every fact against the frozen instrument before using it.** REQ-LC40 names
  the SMS body explicitly. A company name, job label or price not literally present in
  `shown_content` is **omitted**, never guessed. A shorter honest message beats a
  fuller one that can disagree with what is signed.
* **never summarises the scope.** Summarising means truncating; a truncated scope is
  not verbatim, so REQ-LC40 forbids it, and mandate #6's reasoning about numbers read
  out of context applies to work descriptions too.
* **never gives an EWA the priced document's closing line.** "Nothing proceeds until
  you approve" is false on a T&M-capped authorization, where work proceeds precisely
  *because* it was approved — `ewa.ts` refuses that sentence for the same reason.
* **stays inside GSM-7**, asserted by test, because one stray em dash from a later copy
  edit more than doubles the piece count invisibly.

`replyNoticeSmsBody()` is written and tested for §4.5's strong half. It deliberately
**does not quote the reply**: a reply routinely carries the negotiation ("I can do
1,500 if we skip the trim"), and a number reaching a client outside the instrument
reads as an offer — an offer read as agreed is the dispute this product prevents.

### 4.8 `ewa.js` was never uploaded by `scripts/deploy-web.sh` (DEF-6, remaining half)
Stated precisely so it is not read as a bigger fix than it is: the **live** deploy is
`.github/workflows/deploy-confirm-page.yml` (GitHub Pages — Supabase Storage refuses
to serve HTML), and that workflow has copied `ewa.js` since it was written. **The
production path was never broken.** `deploy-web.sh` is the second, hand-run path to
the `public-web` bucket, and it was still shipping a page whose EWA renderer could not
be there. Two deploy paths disagreeing about what a deploy contains is the same
one-object-two-owners problem the SQL checker exists for. They now agree, `ewa.js`
goes first, and a partial failure leaves the pairing that `ewa.js`'s own fallbacks are
written for.

---

## 5. The security model of the token

**REQ-VAL3: the counterparty never makes an account. The token IS the credential.**
That trade is deliberate and is the only reason this loop closes at all — a homeowner
standing in a doorway will not sign up for a contractor's app. It is stated plainly
rather than dressed up, in `confirmations.ts`'s header, on the page, and here.

| Property | Value | Enforced by |
|---|---|---|
| Entropy | 160 bits, `crypto.getRandomValues`, hex | `newToken()` |
| Lifetime | **30 days** from creation | `confirmation_request.expires_at` default; checked in `confirmation_fetch`, `_ask`, `_respond`, `_photos` |
| Revocation | **Only by supersession.** A new `confirmation_request` for the same change order sets `superseded_at` on the prior one | `confirmation_request_supersedes` (250) |
| Reuse after answering | Read-only forever. The answered page renders the frozen wording, photos and thread | `already_answered` branch (REQ-LC33) |
| Second answer | Refused. First terminal answer wins | PK on `confirmation_response.token`; `230:112` |
| Answering a retired link | Refused | `confirmation_response_not_superseded` (250) |
| Asking on a retired link | Refused | `confirmation_question_not_superseded` (270) |
| Replying after an answer | Refused | `confirmation_reply_thread_open` (308) |
| Unsigned priced approval | Refused | `confirmation_response_require_signature` (210) |
| Transport | HTTPS only — the custom-domain requirement in the deploy workflow exists for this, not for vanity | GitHub Pages + `CNAME` |

### What someone holding a link can do

Everything the intended recipient can, because there is no way to tell them apart.
Named honestly:

* **read** the frozen instrument, the scope, the price, the terms, the company, the
  job label, the running total of extras approved on that job, every attached photo at
  full resolution, and the entire discussion — including the contractor's replies,
  across the revision lineage;
* **approve** it, binding the owner to the price, under any typed name;
* **decline** it, halting the work;
* **ask** questions that push a notification to the contractor's phone.

**What they cannot do**, and these are the load-bearing limits:

* reach any other token, project, change order or customer — every anon RPC takes one
  token and returns only that token's row. `anon` holds **no table grants at all**,
  only `EXECUTE` on the `confirmation_*` / `ewa_terms_fetch` functions;
* change the instrument. `shown_content`, the price, the scope and the change-order
  link are frozen by `confirmation_request_guard`; media is immutable;
* answer twice, answer a retired link, or move an approved record;
* enumerate. 160 bits is not guessable, and there is no listing endpoint.

**Identity is a SIGNAL, never a proof, and the code says so in those words.** What is
recorded is the typed legal name, the timestamp, the user agent and the open history —
`grade = 'typed_link'` (REQ-LC45). Nothing fabricates `otp_verified_at`. **Whether a
typed name alone clears ESIGN/UETA is a BLOCKING legal question (REQ-LC45, Fable Q1)
and nothing here should be described to a customer as legally binding until it is
answered.**

### Residual risks, named

1. **A forwarded or intercepted SMS is a full credential.** Anyone who sees the message
   can approve. No mitigation exists in v1 and none is claimed. Practical bound: the
   link is single-use for answering and expires in 30 days.
2. **Wrong-number sends are unrecoverable by the sender.** There is no "revoke this
   link" — only supersede, which needs a *new* version. A contractor who texts the
   wrong person cannot retire the link without issuing a revision. **Gap, not fixed.**
3. **Photos are served by signed URL and are readable by anyone with the page.** That
   is intended (the client must see the evidence), but the signed URLs outlive the page
   view.
4. **The anon key is public by design.** RLS plus the RPC grants are the boundary. It
   identifies the project; it authorises nothing.
5. **The page loads code from a third party at run time.** §8.

---

## 6. The contractor's side of the loop

Verified end to end, since "make sure the loop closes" was the brief:

| The client does | The contractor gets | Where |
|---|---|---|
| Opens the link | Push "Opened", first open only | `notify_on_open` (366) → `notification_outbox` → worker |
| Asks a question | **Push with their words** — NEW | `notify_on_question` (395) |
| Asks a question | Row in the thread on the extra, local notification, "Awaiting your reply" at 48h | `pullThreads` → `runNotifications`, `threadState` |
| Approves / declines a priced extra | `change_order` moves; push "Approved ✓" / "Declined" | `confirmation_response_settles_co` (230) → `notify_on_verdict` (379) |
| Approves / declines a plain decision | **Push naming the signer** — NEW | `notify_on_unlinked_answer` (395) |
| Reads a contractor reply | Nothing yet — see §7 | |

The contractor replies through `postReply` → `r5b_outbox` → `ingest_r5b_v1` →
`confirmation_reply`, and the portal shows it. **No change was needed on that path**;
it works.

---

## 7. Owed — the exact diffs, and why they are not here

Everything below is blocked on files another workstream held open during this pass
(`App.tsx`). Each is small and each is written out so nobody has to re-derive it.

### O1 — record the destination on the send (BLOCKS the reminder scheduler)
Every send today passes `channel: 'link'` with **`destination` left null** — verified
against the live table. So the server holds **no way to reach the counterparty at
all**: `claim_reminders_v1` (388) returns rows whose `destination` is null, and D5's
automated reminders can never be delivered even once Twilio is configured. It is a
call-site gap, not a schema gap — `sendForConfirmation` already accepts `destination`
and `confirmation_create` already stores it.

```diff
   const r = await sendForConfirmation(connector.client, {
     kind: 'confirm', decisionId: c.decision_id, projectId,
     …
-    channel: 'link', whenMs: Date.now(), linkBase: CONFIRM_BASE,
+    // The number the link is actually sent to. Without it the server can never
+    // reach the client: 388's scheduler claims a reminder and has nowhere to send
+    // it. `channel` follows the destination — 'sms' when there is one to text.
+    channel: to?.phone ? 'sms' : 'link',
+    destination: to?.phone ?? null,
+    whenMs: Date.now(), linkBase: CONFIRM_BASE,
```
(and the matching pair in the `sendEwa` branch above it.)

### O2 — use the composed SMS body
```diff
+import { clientSmsBody } from './src/clientsms';
   const r = await sendSms(connector.client, sentLink.phone as string,
-    `${sentLink.shown}\n\n${sentLink.url}`);
+    clientSmsBody({
+      kind: sentLink.isEwa ? 'ewa' : 'confirm',
+      shownContent: sentLink.shown, url: sentLink.url,
+      companyName: sentLink.companyName ?? null,
+      jobLabel: sentLink.jobName ?? null,
+      amountText: sentLink.amount ?? null,
+    }));
```
`setSentLink({…})` needs `companyName` and an `isEwa` flag added at both call sites;
both values are already in scope there. `clientsms.ts` is listed in `verify.mjs`'s
`KNOWN_UNWIRED` **as a debt** — delete that entry when this lands.

### O3 — text the client when the contractor replies
Depends on O1. `replyNoticeSmsBody()` is written and tested. The send site is
`drainR5bOutbox` (`discussionstore.ts`), which already holds the Supabase client:
after `ingest_r5b_v1` returns `ok`, look up the live token's `destination` and send.
It must follow `388`'s discipline exactly — **claim, attempt, record the outcome, and
never mark it delivered before the transport confirms** — and a failure must be
visible on the extra, in the contractor's own words. A new RPC is needed to return the
live token + destination for a change order, because the device does not hold either.

### O4 — the reminder worker step
`388` built the schema, the caps and the loud-failure discipline. **Nothing calls
`claim_reminders_v1`.** Blocked on `apps/worker/**`, and on O1 for a destination.

### O5 — the record screen does not render `reminder_failed`
`388`'s own header says so. REQ-LC25's "visible in the app, on the extra, in the
contractor's own words" is half met until it does.

---

## 8. Open questions — not decided here

1. **Pin `supabase-js`?** §1 is the evidence: an unpinned CDN range took the whole
   client-facing product down with no deploy. Pinning trades that for missing security
   fixes silently instead. A third option — vendor the client into `apps/web/` and
   deploy it with the page, removing the third-party host from the request path
   entirely — is stronger on both counts and costs a build step this page deliberately
   does not have. **This is a real decision and it needs hadar, not a cleanup commit.**
2. **The portal is English only.** Mandate #5 gives every *user* a preferred display
   language, and the counterparty has no profile to hold one. A Spanish-speaking
   homeowner reads an English page today. The instrument itself is English-canonical
   and must stay so (it is the binding text), but the *chrome* — buttons, headings,
   the negotiation note — could follow `Accept-Language` or a `&lang=` on the link.
   Which of those, and whether a translated chrome around an English instrument is
   honest or misleading, is a `LANGUAGE-LAYER` question this document should not
   settle alone.
3. **No way to revoke a link sent to the wrong person** (§5, risk 2). The mechanism
   would be a `superseded_at` write with no successor — `confirmation_state` already
   handles `live_token = null` and says "the contractor withdrew this request". So the
   page is ready and the affordance does not exist. Whether a contractor may retire a
   live instrument without issuing a replacement is a **lifecycle** decision
   (REQ-LC20 says his Stage-2 move set is exactly Reply · Remind · Revise & Resend,
   with no fourth move) and belongs to `SPEC-extra-lifecycle-v1`, not here.
4. **Poll interval and battery.** 25s while visible is a guess, not a measurement. It
   has no field data behind it.
5. **A second person on the link.** D4 allows others to view and ask but not approve.
   The portal cannot tell who is holding it, so **anyone with the link can approve** —
   the token is the credential. D4's restriction is therefore real on the contractor's
   roster and unenforceable on this page. Named because a reader could otherwise
   believe it is enforced.

---

## 9. What was tested, and how

| | |
|---|---|
| `clientsms.test.ts` | 16 cases under `node --test`: literal goldens; a price/company/job absent from the frozen text is dropped rather than sent; the document is never quoted; an EWA never inherits "Nothing proceeds"; every producible message is GSM-7; segment arithmetic at the boundaries; the reply notice carries no digits |
| `395_client_portal_loop.sql` | Applied to the live database. Both triggers driven in **rolled-back transactions**: a question → one outbox row with the client's words; a **priced** answer → exactly one row (from 379, not two); an **unlinked** answer → one row from the new trigger |
| `docSection` | The broken and fixed expressions run against a real `shown_content`: `null`/`null` before, both sections after |
| The portal | Loaded in a real browser against the **live** database and the real token — dead before, rendering after. Then driven through a stubbed client (so no unremovable rows were written to a live append-only table): ask → return to the document with the question on it and Approve live → ask again → contractor replies → poller replaces `#thread` in place, highlighted, **with a half-typed signature intact** → approve → re-open the same address and get the frozen wording, the photos and the closed discussion |
| The EWA path | Same drive: clauses, photo strip and thread all present; survives ask-and-return and back-out-of-decline as an authorization rather than being redrawn as a priced approval |
| `node scripts/verify.mjs` | 471 unit tests, typecheck, worker, i18n parity, schema agreement, migration numbering, web assets, module reachability — all pass. Three pre-existing failures remain and are untouched: `sql single-ownership` (5 objects, none new), `i18n coverage` (9 keys, none new), `rpc callers` (3 RPCs, none new) |

**Not tested:** the SMS itself (Twilio secrets are unset — the Edge Function refuses
loudly, which is D5's design and must stay); the push delivery path end to end (the
worker drains `notification_outbox`, and it was out of scope for this pass); any
reminder, automated or manual, since no worker step exists (O4).
