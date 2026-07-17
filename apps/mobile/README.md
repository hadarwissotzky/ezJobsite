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
