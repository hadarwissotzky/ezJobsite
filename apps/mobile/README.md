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
