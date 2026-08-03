# SPEC: over-the-air updates — v1
**Owner: Hadar | Written 2026-08-03 | Status: DESIGN — implement after §2 is read**

*How the app ships JavaScript changes to installed phones without an App Store release, and —
more importantly — the conditions under which it must refuse to.*

**Governed by `CLAUDE.md`'s ten mandates, which override everything here.** Two bind hard:
mandate #1 (never lose a capture) and mandate #7 (offline-forward is paramount). An update
mechanism that can interrupt a capture or delay a launch is a defect, not a feature.

**What this owns:** when the app checks, when it applies, what may ship this way, what may not,
how a bad update is undone, and what the user can see about which version they run.

**What it does NOT own:** the native release path (TestFlight / App Store), signing, or the
capture-commit state machine itself (`SPEC-capture-core-v1`, `DURABILITY-DESIGN-v1`).

`REQ-OTA*` namespace. Each carries an `Accept:` clause and a `[trace: …]`.

---

## 1. What exists today

| | |
|---|---|
| **eas.json** | Already declares `development` · `preview` · `production` **channels** — these exist for EAS Update. `[trace: eas.json]` |
| **expo-updates** | **Not installed.** No runtime, so nothing can be delivered. `[trace: package.json]` |
| **app.json** | No `updates` block, no `runtimeVersion`. `[trace: app.json]` |
| **Schema migrations** | Run at startup, inside the same JS that would be updated. `[trace: App.tsx:2195]` |
| **In-flight signals** | `capture_outbox`, `decision_outbox`, `change_order_outbox` are countable. `[trace: capture.ts:168 · decisions.ts:400 · changeorder.ts:864]` |

So the *intent* to do OTA was recorded in `eas.json` and never wired.

---

## 2. The design

### 2.1 The shape

```
launch → boot from the bundle already on disk (ALWAYS)
       → in background: ask "is there a newer bundle for my runtimeVersion?"
       → if yes: download it quietly
       → apply it at the NEXT cold start, or when the user taps "Restart to update"
```

**The app never waits on the network to start, and never swaps its own code mid-session.**
Those two sentences are the whole design; everything below defends them.

### 2.2 Why not apply immediately

Applying an update means reloading the JS runtime. Every in-memory thing dies: the open capture
session, the recorder, un-flushed state, the screen the user is standing on. Doing that while
someone is recording on a ladder is precisely the loss mandate #1 forbids — and it would be
*self-inflicted*, which is worse than a crash.

So an update is a thing that becomes true at a **cold start**, never during one.

### 2.3 Requirements

**REQ-OTA1 — The update check must never delay launch.**
`fallbackToCacheTimeout: 0`. The app renders from the embedded or cached bundle immediately; the
check happens after, in the background, and its failure is silent and harmless.
- **Accept:** with the device in airplane mode, cold-start time is unchanged from today. A launch
  that hangs on a network call is a release-blocking defect.
- `[trace: mandate #7 — "the network is opportunistic, never a precondition"]`

**REQ-OTA2 — An update is never applied while work is in flight.**
`Updates.reloadAsync()` is called only from an explicit user action, and only when no capture draft
is `open` **and every owned outbox is empty**. Otherwise the offer is withheld and the update waits
for the next natural cold start.

> **Corrected 2026-08-03.** This requirement first named *three* outboxes. There are **eleven**.
> The three-table version would have let an update reload the app with an unsent note, tag,
> transcript, or negotiation reply still queued — the quiet tables, which are exactly the ones
> nobody checks afterwards. The authoritative list is `OUTBOX_TABLES` in `ota.ts`, and it is
> enforced by a test that greps the source for `CREATE TABLE … *_outbox` and fails when the list
> falls behind. Two of the eleven (`r5b_outbox`, `r5c_outbox`) were found by that test, not by me.

- **Accept:** with a pending row in ANY outbox, no "Restart to update" affordance appears; and
  `ota.test.ts`'s completeness test passes, proving the list still covers the source.
- `[trace: mandate #1 · ota.ts OUTBOX_TABLES · ota.test.ts]`

**REQ-OTA3 — `runtimeVersion` uses the `fingerprint` policy.**
A JS bundle built against different native code must never load. Fingerprint derives the version
from the actual native dependency set, so a mismatch is impossible to create by forgetting to bump
a number.
- **Accept:** adding a native module changes the fingerprint; the old binary stops receiving new
  updates rather than crashing on them.
- `[trace: expo-updates contract — a mismatched runtime version is silently ignored, which is the
  single most common "why is my update not arriving"]`

**REQ-OTA4 — An update carrying a schema migration is a ONE-WAY DOOR and must be marked as such.**
Migrations run at startup inside the updated JS. Rolling the JS back does **not** roll the schema
back, so the previous bundle then meets a database from the future. Rollback for such an update is
**roll-forward only**.
- **Accept:** the release checklist asks "does this update change SQLite schema?" — if yes, the
  rollback plan is a new update, never a republish of the old one.
- `[trace: App.tsx:2195 · mandate #1 (append-only evidence must survive both directions)]`
- **This is the most dangerous property of OTA for this app** and the reason the release step is a
  checklist rather than a single command.

**REQ-OTA5 — The running version must be visible to the user.**
Settings → About shows the native version *and* the update id. Support cannot diagnose "it's broken
on my phone" without knowing which of the two layers the phone is actually running.
- **Accept:** the About section shows both, and they differ after an OTA update lands.
- `[trace: settingsscreen.tsx:331 (About already exists)]`

**REQ-OTA6 — Native changes must never be assumed shippable.**
A new native module, permission string, pod, or SDK bump does **not** travel this way. Shipping the
JS half alone produces a bundle that calls into something the binary does not contain.
- **Accept:** the release checklist names the native-change test; when it trips, the answer is a
  store build, not an update.
- `[trace: expo-updates contract]`

**REQ-OTA7 — A bad update must be undoable in one command.**
`eas update:republish` promotes a known-good prior update to the channel. Subject to REQ-OTA4.
- **Accept:** a rehearsed rollback exists before the first production update is published.

### 2.4 What this does and does not buy

**Ships this way:** screens, i18n, business logic, pricing/format rules, bug fixes — everything
changed in this session's UI and lifecycle work.

**Does not:** the capture plumbing when it touches native (audio, SQLite, PowerSync), and nothing
at all about the **7-day dev-certificate expiry**. OTA updates the JS inside an installed app; it
cannot stop the binary's signature expiring. That still needs TestFlight.

---

## 3. Build order

1. `npx expo install expo-updates`
2. `eas init` → project id
3. `app.json`: `updates.url`, `fallbackToCacheTimeout: 0`, `runtimeVersion.policy: "fingerprint"`
4. `src/ota.ts` — the safety layer: exposes `updateReady`, and a `canApplyNow()` that enforces
   REQ-OTA2 by counting the three outboxes
5. Settings → About: version + update id (REQ-OTA5), and a "Restart to update" row that appears
   only when `updateReady && canApplyNow()`
6. **One native rebuild and install** — the updates URL is baked into the binary
7. Publish a no-op update and confirm it arrives on the next cold start

Steps 1–5 are code. Step 6 is the one unavoidable store-or-cable round trip; after it, JS changes
need neither.

---

## 4. Open items

- EAS account/login not yet verified on this machine (`eas whoami`).
- Cost: EAS Update free tier limits unmeasured for our expected device count.
- Self-hosting the update endpoint is possible (the protocol is open) and unevaluated; it removes
  the vendor dependency at the cost of running the server.
