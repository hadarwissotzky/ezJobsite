# EZjobsite — mobile

**Source of truth lives here.** The build runs from a space-free working copy.

## Why the build isn't run from this directory
Expo's `expo-constants` build script is not space-safe, and this repo's path
contains a space (`/Volumes/Operational Disk/HiLo Venture Group/…`). Building
here fails with `No such file or directory: /Volumes/Operational`.

**Proper fix: move the repo to a path without spaces.** Every RN/Xcode
toolchain has this bug somewhere; fighting it forever costs more than moving once.
Until then:

```bash
rsync -a --exclude node_modules --exclude ios --exclude android \
  "apps/mobile/" ~/ezjobsite-build/
cd ~/ezjobsite-build && npm install && npx expo prebuild --platform ios && npx expo run:ios
```

Edit here. Sync to build. Never edit the build copy.

## The one file that matters
`src/capture.ts` — the capture-commit path. It exists to make sure the app
**never says "saved" for a capture it is about to lose** (CLAUDE.md mandate #1;
it is how ezQuotePro died).

- `capture_commit` is the commitment authority. **One row = committed.**
- The media file, `capture_outbox`, `ps_crud`, and the PowerSync `capture` row
  mean **nothing** about whether we may say "saved".
- `capture_commit` is deliberately **not** a PowerSync table: PowerSync can
  revert its own rows when the server rejects a write, so the cloud could
  un-save something the user was told was saved.
- **Local is the real record. The cloud is a copy.**

Architecture: `docs/CAPTURE-DURABILITY-ARCH-v1-CODEX.md` (authored by Codex).
Do not change the safety model here — raise it with the architect.

## Known-open
- Blocker 2 is **OPEN**. The K0–K7 fault suite has been validated (8/8, one trial
  per boundary) but the predeclared run (20/boundary) has not been executed.
- No uploader yet. `capture_outbox` fills and nothing drains it, so captures
  save locally and never reach the cloud. That is the next build.
- `connector.ts` is carried over from the spike and is known-buggy for the
  delivery path (sends Capture and Attachment as separate requests, discards
  permanent failures). It must be replaced by one Postgres RPC before it drains
  anything.

## STATUS 2026-07-16 — builds, does not run

`Build Succeeded`, app installs, **JS bundle fails at startup**:
`[runtime not ready]: Error: Cannot find native module 'ExpoAsset'`

Two facts that go together and point at the cause:
1. The native module `ExpoAsset` is missing from the binary even after
   `expo prebuild --clean` + a full rebuild.
2. The bundle id builds as **`org.name.EZjobsite`** while `app.json` says
   `com.hilo.ezjobsite`.

**A wrong bundle id AND missing autolinked modules, after a clean prebuild, means
the build is not reading the config being edited.** That is a build-configuration
problem, not a product problem — the capture code has never been reached.

Do NOT debug this by guessing (three attempts already failed that way). Check, in
order:
- Is there an `app.config.js`/`app.config.ts` shadowing `app.json`? Expo prefers
  the JS config and silently ignores `app.json` when one exists.
- Is `expo-asset` actually in `package.json` dependencies, or only transitive?
- Does `~/ezjobsite-build/package.json` still carry the bakeoff app's field set?
  This package.json was **copied from the throwaway app**, and that shortcut is
  the most likely culprit — it was never a clean `create-expo-app`.

**Likely correct fix: scaffold clean** (`npx create-expo-app`) into a space-free
path and move `src/` + `App.tsx` in, rather than inheriting the spike's
package.json/app.json. The product code is good; its packaging is inherited junk.

## STATUS 2026-07-16 (updated) — IT RUNS

The app builds, installs as `com.hilo.ezjobsite`, and **runs**: RECORD button,
"Ready", "Saved on this phone (0)". No red screen.

**Root cause of the earlier failure (found, not guessed):** `expo prebuild` was
**crashing** in `withIosIcons → generateUniversalIconAsync` because `app.json`
referenced `./assets/icon.png` and **`assets/` had never been copied**. A crashed
prebuild leaves a half-written `ios/` with the DEFAULT bundle id and **no config
plugins applied** — so nothing was autolinked, hence `Cannot find native module
'ExpoAsset'`. One cause, both symptoms. `expo-asset` was also missing from
dependencies. Both fixed; prebuild now exits 0 and emits `com.hilo.ezjobsite`.

**Verified working in the product app:**
- The durability gate PASSES — no gate banner, so the write connection has
  `synchronous=FULL`, `fullfsync`, `foreign_keys` (the assertion runs inside
  `writeTransaction`, which is the only connection whose profile means anything).
- App-owned schema created, recovery sweep runs on launch, saved list reads
  exclusively from `capture_commit`.
- Offline is handled as normal, not an error.

## THE ONE THING NOT PROVEN: real microphone capture

`prepareToRecordAsync` fails on the iOS Simulator:
`Calling the 'prepareToRecordAsync' function has failed`

Adding `setAudioModeAsync({allowsRecording:true, playsInSilentMode:true})` — which
IS required on iOS and is now in `recorder.ts` — did not fix it. Two attempts, no
convergence, so stopping rather than guessing a third time.

**Most likely: the Simulator has no usable audio input.** That is a simulator
limitation, not a product bug — but it is UNPROVEN. Do not assume it.

Next diagnostic, in order:
- Check Simulator > Settings > Microphone, and macOS mic permission for Simulator.app.
- Try `RecordingPresets.LOW_QUALITY` — the HIGH_QUALITY preset may request a
  format the simulator cannot supply.
- If it is the simulator, this needs the physical iPhone — which needs **Xcode
  26.x** (installed Xcode 16.4 ships the iOS 18.5 SDK; the device runs iOS 26.3.1).
  That has blocked physical-device work all day and is the same blocker as Q3.

`performCapture()` itself is NOT implicated: it was exercised 8/8 across every
kill boundary in the spike with synthetic bytes. What is unproven is the
recorder feeding it, not the saving.


## STATUS — capture reaches the cloud (verified server-side)

Full round trip works: **3 captures, 3 attachments, 3 ledger rows**, media in
Storage under content-addressed owner-scoped keys.

```
capture   : cap-mrodypni-4wn6iwt7
  object  : <owner>/cap-.../e7b0703…e59c.txt   (60 bytes, in Storage)
  state   : uploaded
  mutation: mut-6lf8okfi9bu
drain: {"attempted":1,"uploaded":1,"parked":0,"retryable":0}
```

**The three properties that make retry safe, each tested against the real RPC:**
| Property | Result |
|---|---|
| Replay same `mutation_id` + same digest | `{"status":"already_applied"}` — **no duplicate** (3 rows before and after) |
| Replay same `mutation_id` + **different** digest | `ERROR: mutation_id … replayed with a different payload digest` |
| Different user submits for another owner | `ERROR: owner mismatch` |

Direct `INSERT` on capture/attachment is **revoked** for `authenticated` — the
RPC is the only door, so a client cannot recreate the partial-accept bug.

### Microphone: BLOCKED BY HARDWARE, not code
`system_profiler` shows one audio device — *Mac mini Speakers*, **output only,
zero inputs**. The simulator has no input to forward, so `prepareToRecordAsync`
fails natively (`ERR_AUDIO_RECORDING`). **No code change fixes this.** Needs a USB
mic on the Mac mini, or the physical iPhone (Xcode 26). Text capture (REQ-CAP2)
proves the path meanwhile.
