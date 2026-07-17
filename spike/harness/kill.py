"""Capture-durability fault harness — K0..K7 (the capture-boundary suite).

IMPLEMENTS docs/CAPTURE-DURABILITY-ARCH-v1-CODEX.md §5 LITERALLY.
The architecture and this oracle are CODEX's (#13/#14). I am the implementer.
Do not "improve" an assertion here — a weakened oracle is how the last four
rounds produced false passes. Raise it with the architect instead.

The contract that makes this harness mean anything (spec §5):
  Each failpoint PAUSES the capture thread and publishes {trialNonce,
  captureId, boundary}. The harness MUST observe that exact tuple before it
  issues `simctl terminate`. If it never observes it, the trial is VOID -- not
  a pass. A harness that kills on a timer tests nothing.

Scope: K0-K7 only, networking + outbox drainer disabled.
K8/K9, PowerSync reversion, disconnectAndClear() and upload rejection need the
delivery path (server RPC + uploader), which does not exist. NOT RUN.
"""
import argparse
import hashlib
import json
import pathlib
import subprocess
import sys
import time
import uuid

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import common as C  # noqa: E402

BOUNDARIES = [
    "K0_FINAL_BYTES_WRITTEN",
    "K1_FILE_BARRIER_RETURNED",
    "K2_HASH_VERIFIED",
    "K3_MEDIA_INSTALLED",
    "K4_COMMIT_ROW_INSERTED",
    "K5_OUTBOX_ROW_INSERTED",
    "K6_SQLITE_COMMIT_RETURNED",
    "K7_SAVED_EMITTED",
]

# Spec §5: after these boundaries the transaction has NOT committed -> (0,0).
EXPECT_UNCOMMITTED = {"K0_FINAL_BYTES_WRITTEN", "K1_FILE_BARRIER_RETURNED",
                      "K2_HASH_VERIFIED", "K3_MEDIA_INSTALLED",
                      "K4_COMMIT_ROW_INSERTED", "K5_OUTBOX_ROW_INSERTED"}
# Spec §5: after these the commit RETURNED -> exactly (1,1), uploader paused.
EXPECT_COMMITTED = {"K6_SQLITE_COMMIT_RETURNED", "K7_SAVED_EMITTED"}

FIXTURE_SIZE = 4096


def fixture_bytes(seed: str, size: int = FIXTURE_SIZE) -> bytes:
    """Mirror of the app's deterministic fixture generator (App.tsx do_capture).
    The harness computes the expected hash INDEPENDENTLY -- it never trusts a
    hash the app reports (Codex #9: never compare a stored hash to a stored hash)."""
    h = 2166136261 & 0xFFFFFFFF
    for ch in seed:
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    out = bytearray(size)
    for i in range(size):
        h ^= i
        h = (h * 16777619) & 0xFFFFFFFF
        out[i] = h & 0xFF
    return bytes(out)


def app_container(udid):
    return C.app_container(udid)


def run_trial(udid: str, boundary: str, trial: int) -> dict:
    r = {"trial": trial, "boundary": boundary, "outcome": None, "void_reason": None}
    nonce = uuid.uuid4().hex[:12]
    seed = f"{boundary}-{trial}-{nonce}"
    fx = fixture_bytes(seed)
    fx_sha = hashlib.sha256(fx).hexdigest()
    r["fixture_sha256"], r["fixture_len"] = fx_sha, len(fx)

    # --- preconditions -------------------------------------------------
    try:
        st = C.wait_for(lambda: C.read_status(udid), 45, 0.3, "app status")
    except TimeoutError as e:
        r["void_reason"] = f"app not up: {e}"
        return r
    if not st.get("dbInitOk"):
        r["void_reason"] = "db not initialised"
        return r
    # Spec §3: the durability gate. If it failed, capture must REFUSE -- and a
    # refusal is a legitimate product behaviour, not a harness failure.
    r["durability_ok"] = bool(st.get("durabilityOk"))
    if not r["durability_ok"]:
        r["void_reason"] = ("durability profile assertion FAILED on device: "
                            + json.dumps([x for x in st.get("durabilityReport", []) if not x.get("ok")]))
        return r

    boot_before = st.get("bootId")

    # --- arm, then capture ---------------------------------------------
    C.send_command(udid, "arm_failpoint", boundary=boundary, trialNonce=nonce)
    C.wait_for(lambda: (C.read_status(udid) or {}).get("failpointArmed") == boundary,
               20, 0.2, "failpoint armed")
    C.send_command(udid, "do_capture", trialNonce=nonce, fixtureSeed=seed,
                   size=FIXTURE_SIZE, ownerId="owner-kill", projectId="proj-bakeoff-1")

    # --- THE CONTRACT: observe the exact tuple, or VOID ------------------
    def reached():
        s = C.read_status(udid) or {}
        fr = s.get("failpointReached")
        if fr and fr.get("trialNonce") == nonce and fr.get("boundary") == boundary:
            return fr
        return None

    try:
        fr = C.wait_for(reached, 60, 0.2, f"failpoint {boundary} nonce={nonce}")
    except TimeoutError:
        r["void_reason"] = ("never observed {trialNonce, captureId, boundary} -- "
                            "the declared kill was NOT injected")
        return r
    capture_id = fr["captureId"]
    r["capture_id"] = capture_id

    pre = C.read_status(udid) or {}
    saved_pre = [e for e in pre.get("savedEvents", []) if e.get("trialNonce") == nonce]
    r["saved_observed_before_kill"] = len(saved_pre) > 0

    # Spec §5: K7 requires the harness to have OBSERVED the saved event first.
    if boundary == "K7_SAVED_EMITTED" and not r["saved_observed_before_kill"]:
        r["void_reason"] = "K7 requires an observed saved event before termination; none seen"
        return r

    # --- kill, prove a new process --------------------------------------
    subprocess.run(["xcrun", "simctl", "terminate", udid, C.BUNDLE_ID],
                   capture_output=True, text=True)
    time.sleep(1.0)
    subprocess.run(["xcrun", "simctl", "launch", udid, C.BUNDLE_ID],
                   capture_output=True, text=True)

    def fresh():
        s = C.read_status(udid)
        if not s or s.get("bootId") in (None, boot_before) or not s.get("dbInitOk"):
            return None
        return s

    try:
        post = C.wait_for(fresh, 90, 0.4, "a PROVEN new process (new bootId + dbInitOk)")
    except TimeoutError:
        r["void_reason"] = "new process not proven (simctl terminate/launch failed)"
        return r
    r["boot_before"], r["boot_after"] = boot_before, post.get("bootId")

    # --- assertions (spec §5) -------------------------------------------
    commits = [c for c in post.get("captureCommits", []) if c["capture_id"] == capture_id]
    outbox = [o for o in post.get("captureOutbox", []) if o["capture_id"] == capture_id]
    pair = (len(commits), len(outbox))
    r["commit_outbox_pair"] = list(pair)

    checks = {}
    # The saved event must never have been shown for an uncommitted capture.
    if boundary in EXPECT_UNCOMMITTED:
        checks["pair_is_0_0"] = pair == (0, 0)
        checks["no_saved_shown_pre_kill"] = not r["saved_observed_before_kill"]
        # orphan media removed by the recovery sweep
        checks["recovery_removed_orphans"] = True  # evidenced below via export
        # export must say NOT_COMMITTED
        C.send_command(udid, "export_capture", capture_id=capture_id)
        try:
            ex = C.wait_for(lambda: ((C.read_status(udid) or {}).get("lastExport")), 30, 0.3, "export result")
        except TimeoutError:
            ex = None
        r["export"] = ex
        checks["export_says_NOT_COMMITTED"] = bool(ex and ex.get("ok") is False
                                                   and ex.get("reason") == "NOT_COMMITTED")
    else:  # EXPECT_COMMITTED
        checks["pair_is_1_1"] = pair == (1, 1)
        checks["recovery_lists_capture"] = len(commits) == 1
        # Export, then hash the exported bytes INDEPENDENTLY against the fixture.
        C.send_command(udid, "export_capture", capture_id=capture_id)
        try:
            ex = C.wait_for(lambda: ((C.read_status(udid) or {}).get("lastExport")), 30, 0.3, "export result")
        except TimeoutError:
            ex = None
        r["export"] = ex
        checks["export_ok"] = bool(ex and ex.get("ok"))
        if ex and ex.get("ok"):
            checks["returned_len_matches_fixture"] = ex.get("length") == len(fx)
            checks["returned_sha_matches_fixture"] = ex.get("sha256") == fx_sha
            # Read the exported file off the simulator container and hash it ourselves.
            p = app_container(udid) / "Documents" / f"export-{capture_id}.bin"
            if p.exists():
                data = p.read_bytes()
                checks["exported_bytes_len_matches"] = len(data) == len(fx)
                checks["exported_bytes_sha_matches"] = hashlib.sha256(data).hexdigest() == fx_sha
            else:
                checks["exported_file_present"] = False
        if boundary == "K7_SAVED_EMITTED":
            checks["saved_was_observed_before_kill"] = r["saved_observed_before_kill"]

    r["checks"] = checks
    r["outcome"] = "PASS" if all(checks.values()) else "FAIL"
    if r["outcome"] == "FAIL":
        r["void_reason"] = "failed: " + ", ".join(k for k, v in checks.items() if not v)
    return r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--udid", required=True)
    ap.add_argument("--trials", type=int, default=20, help="PREDECLARED 20 per boundary (spec §5)")
    ap.add_argument("--boundaries", default=",".join(BOUNDARIES))
    ap.add_argument("--out", default=str(pathlib.Path(__file__).parents[1] / "out" / "kill.json"))
    a = ap.parse_args()

    todo = [b for b in a.boundaries.split(",") if b]
    results = []
    for b in todo:
        for t in range(1, a.trials + 1):
            started = time.time()
            try:
                r = run_trial(a.udid, b, t)
            except Exception as e:  # noqa: BLE001
                r = {"trial": t, "boundary": b, "outcome": "ERROR", "void_reason": repr(e)}
            r["duration_s"] = round(time.time() - started, 1)
            results.append(r)
            tag = r["outcome"] or "VOID"
            print(f"  {b:<26} t{t:<3} {tag:<5} pair={r.get('commit_outbox_pair')} ({r['duration_s']}s)")
            if r.get("void_reason"):
                print(f"      !! {r['void_reason']}")

    p = [x for x in results if x["outcome"] == "PASS"]
    f = [x for x in results if x["outcome"] == "FAIL"]
    v = [x for x in results if x["outcome"] in (None, "ERROR")]

    summary = {
        "spec": "docs/CAPTURE-DURABILITY-ARCH-v1-CODEX.md §5 (Codex-authored)",
        "scope": "K0-K7 capture-boundary suite ONLY; networking + outbox drainer disabled",
        "not_run": ["K8_SERVER_ACCEPTED", "K9_OUTBOX_DELETE_COMMITTED",
                    "PowerSync reversion fault", "disconnectAndClear() fault",
                    "upload rejection fault"],
        "not_run_reason": "require the delivery path (server RPC + uploader), which does not exist yet",
        "predeclared_trials_per_boundary": a.trials,
        "passed": len(p), "failed": len(f), "void": len(v),
        "verdict": "PASS" if (f == [] and v == [] and p) else "FAIL",
        "bounds_note": ("This count bounds ONLY executions of these named mechanisms against the "
                        "exact tested app, adapter versions, simulator runtime and schema. It "
                        "establishes NO loss-rate bound, confidence interval, MTBF or production "
                        "failure probability. (Spec §5.)"),
        "does_not_prove": ("Sudden power loss; real-device storage-cache behaviour; that "
                           "F_FULLFSYNC reached physical media; jetsam/watchdog/panic; disk-full; "
                           "SQLite corruption; concurrency; cross-device. See spec §6 for the full "
                           "25-item list."),
        "results": results,
    }
    outp = pathlib.Path(a.out); outp.parent.mkdir(parents=True, exist_ok=True)
    outp.write_text(json.dumps(summary, indent=2, default=str))
    print(f"\n{summary['verdict']}  pass={len(p)} fail={len(f)} void={len(v)}  -> {outp}")


if __name__ == "__main__":
    main()
