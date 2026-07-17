# Capture durability — first run against the Codex-authored architecture

> **Spec:** `CAPTURE-DURABILITY-ARCH-v1-CODEX.md` (Codex authored, #14). Implementation is mine.
> **Status: the K0–K7 suite has NOT been run.** Two findings below stopped it, and one of them is a harness defect that would have made the whole suite meaningless. Recorded before running anything, not after.

## FINDING 1 — the durability gate works, and it caught a real refusal

`performCapture()` refused, loudly, with zero commits and zero `saved` events:

```
{"ok": false, "reason": "durability profile assertion failed:
  fullfsync=0!=1,checkpoint_fullfsync=0!=1,foreign_keys=0!=1"}
```

**This is the honest invariant (mandate #1) working for the first time in this project** — refuse loudly rather than acknowledge something you cannot back up. It is also the first time Codex's "runtime assertion, not configuration" rule earned its place: the pragmas were *set* and the engine reported them *off*.

## FINDING 2 — pooled reads and the write connection DISAGREE (neither model predicted this)

| Pragma | Pooled read (`db.getAll`) | **Write connection** (inside `writeTransaction`) |
|---|---|---|
| `journal_mode` | wal | wal |
| `synchronous` | 2 (FULL) | 2 (FULL) |
| **`fullfsync`** | **0** | **1** |
| **`checkpoint_fullfsync`** | **0** | **1** |
| **`foreign_keys`** | **0** | **1** |
| `wal_autocheckpoint` | 1000 | 1000 |

`poolDisagrees: true`.

**op-sqlite runs `PRAGMA query_only = true` on its read connections — it has a POOL.** `synchronous`, `fullfsync` and `foreign_keys` are **per-connection**. So:

- **The write connection — the one that actually commits — HAS the full profile.** op-sqlite configures it correctly.
- **Reading the profile through the pooled API tells you nothing about it.**
- My first assertion read the pooled connection and would have **refused every capture on a correctly-configured database**. A false negative — the *safe* direction, but wrong.

**Codex's cross-connection hazard (#11 C2) is REAL, but it cuts the opposite way from both our guesses.** We assumed PowerSync might silently *weaken* durability. In fact op-sqlite sets it correctly and the *observation path* was what lied.

**Consequence for the spec:** §1.0's "read the pragmas back and assert" is necessary but **underspecified — it must say WHICH CONNECTION.** Asserted on the pooled path it is worse than useless: it reports failure on a healthy database and would report success on a connection that never commits. **The assertion must run inside `writeTransaction`.** Now implemented that way; the spec should be amended by the architect.

Note `SqliteOptions` exposes only `journalMode`, `synchronous`, `journalSizeLimit`, `lockTimeoutMs`, `encryptionKey`, `temporaryStorage`, `cacheSizeKb` — **`fullfsync`, `checkpoint_fullfsync` and `foreign_keys` are not exposed at all.** They are correct on the write connection by op-sqlite's own doing, not by our configuration. **That is luck we are currently depending on**, and a version bump could remove it silently. The runtime assertion is the only thing that would catch that.

Also: op-sqlite's own docs say `synchronous` "Defaults to [SqliteSynchronous.normal], which is safe for WAL mode." **That comment is the exact misconception Codex C2 named** — NORMAL is safe against *corruption*, not against *losing a returned commit*. We observed 2 (FULL), so something set it; we did not verify what, and we should not rely on it.

## FINDING 3 — a harness defect that would have invalidated the entire suite

After `simctl launch`, the app re-reads `command.json` and **re-executes the stale command**, because `lastCmdSeq` is process-local and resets to `-1` on restart. Observed directly: 4 `capture_commit` rows from repeated relaunches, when only 1 capture was requested.

**Every K-boundary trial does exactly this**: arm → capture → kill → relaunch → assert. The relaunch would silently perform a SECOND capture before the assertions ran, so `(commits, outbox)` would be measured against a capture the trial never intended. **`(0,0)` and `(1,1)` would both become unreliable, and the suite would report confident nonsense.**

This is the same class as Codex #9's "restart check that could not fail": a harness artifact that manufactures the state it claims to observe. **Caught before the run, not after.**

**Fix required before K0–K7:** bind command execution to `bootId` (a command is executed once per `{seq, bootId}`), or have the harness clear `command.json` before terminating. Not yet implemented.

## What has NOT been run
K0–K7 (the whole capture-boundary suite) · K8/K9 · PowerSync reversion · `disconnectAndClear()` · upload rejection. **No trial count. No pass. No verdict.**

## What is built and working
Codex's `capture_commit` + `capture_outbox` schema (append-only triggers, STRICT, the FK) · the durability profile + write-connection assertion · the commit sequence with failpoints K0–K7 · `exportCapture` resolving exclusively through `capture_commit` and recomputing the hash from disk · the recovery sweep · `spike/harness/kill.py` implementing the §5 oracle.

Smoke evidence that the path works once the gate passes: `{"ok": true, "captureId": "cap-mro8p1ya-wuqkqp15"}`, exactly one `saved` event, commit row `sha=6f2bcdcb07c1c407… bytes=1024`.
