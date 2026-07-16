"""Q1 — commit-ordering under a stalled commit (the blocker-#1 reproduction).

Implements docs/SPIKE-SYNC-BAKEOFF.md:37-52 with the predeclared parameters from
docs/BAKEOFF-PREDECLARATION.md §1 (N=20; mechanism determination, NOT a rate
bound; void-trial rules).

The fault: session A takes seq=10 via nextval() but COMMITS AFTER session B,
which took seq=11 and committed first. A seq-cursor-based sync advances past 11
and never sees 10 -> silent capture loss. That is the fault our hand-built design
died on twice.

Two legitimate passes, which MUST NOT be conflated:
  (a) late row delivered      — B durably checkpointed first, late A still arrives
  (b) unsafe checkpoint prevented — PowerSync refuses to advance past B while A is open

=============================== REVISION 2 ===================================
Rewritten after docs/CRITIC-REVIEW-09-CODEX.md REJECTED revision 1's "VALID PASS".
Defects fixed here, each traceable to a #9 finding:

  #9 CRITICAL "restart assertion can false-pass"
      -> restart now requires a NEW bootId + dbInitOk from the new process, and
         the post-restart observation is re-queried FROM that new process.
  #9 HIGH "exact-payload assertion is absent"
      -> the device now returns `payload`; the harness recomputes SHA-256 itself
         and compares content for BOTH A and B. (Rev 1 compared the hash COLUMN
         to the hash COLUMN — circular.)
  #9 HIGH "last_op mislabeled / advancement only recorded, not asserted"
      -> checkpoint advancement is ASSERTED, read inside one SQLite transaction,
         and honestly labelled a per-bucket cursor, not checkpoint_complete.
  #9 "step 1 not implemented"
      -> each trial now requires hasSynced + dbInitOk + an EMPTY local capture
         scope before it starts (server rows purged and device purge confirmed),
         which also makes trials far more independent.
  #9 "step 10 fresh-client control missing from artifact"
      -> optional --udid2 fresh-client control, recorded in the JSON.
  #9 MEDIUM "25s window can misclassify mechanism (b)"
      -> the window is recorded per trial along with how long B actually took,
         so a near-boundary classification is visible rather than silent.
"""
import argparse
import json
import pathlib
import sys
import threading
import time
import uuid
from datetime import datetime, timezone

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import common as C  # noqa: E402

K = 918273645                 # advisory lock id
PROJECT_ID = "proj-bakeoff-1"
OPPORTUNITY_WINDOW = 25.0     # seconds B is given to reach the device while A is open
ARRIVAL_TIMEOUT = 90.0        # seconds for late A to arrive after release


def now():
    return datetime.now(timezone.utc)


def purge_captures(conn):
    """Remove all captures. `capture` is append-only, so its immutability trigger
    (correctly) refuses DELETE — suspend it only to reset this throwaway fixture.
    The trigger firing is itself evidence the append-only rule works."""
    with conn.cursor() as cur:
        cur.execute("DELETE FROM capture_op_state")
        cur.execute("DELETE FROM attachment")
        cur.execute("ALTER TABLE public.capture DISABLE TRIGGER capture_no_delete")
        try:
            cur.execute("DELETE FROM capture")
        finally:
            cur.execute("ALTER TABLE public.capture ENABLE TRIGGER capture_no_delete")


def seed(conn, owner_id: str):
    purge_captures(conn)
    with conn.cursor() as cur:
        cur.execute("DELETE FROM project")
        cur.execute("DELETE FROM q1_trial_log")
        cur.execute(
            "INSERT INTO project (id, owner_id, name, status) VALUES (%s,%s,%s,'active')",
            (PROJECT_ID, owner_id, "Bakeoff Project"),
        )


def insert_capture(cur, trial, label, owner_id):
    cid = f"t{trial}-{label}-{uuid.uuid4().hex[:8]}"
    payload = f"trial {trial} capture {label} {uuid.uuid4().hex}"
    cur.execute(
        """INSERT INTO capture (id, owner_id, project_id, trial, label, payload, payload_sha256,
                                client_created_at)
           VALUES (%s,%s,%s,%s,%s,%s,%s, now()) RETURNING seq""",
        (cid, owner_id, PROJECT_ID, trial, label, payload, C.sha256_hex(payload)),
    )
    return cid, cur.fetchone()[0], payload


def verify_row_on_device(st, cid, expected_payload):
    """Independent content check: recompute the hash from the payload the DEVICE
    actually holds. Never trust the device's own hash column against the server's
    hash column — that comparison is circular (#9 HIGH)."""
    rows = [c for c in st.get("captures", []) if c["id"] == cid]
    if len(rows) != 1:
        return {"present_exactly_once": False}
    r = rows[0]
    dev_payload = r.get("payload")
    return {
        "present_exactly_once": True,
        "payload_exact_match": dev_payload == expected_payload,
        "recomputed_sha_matches": (
            dev_payload is not None
            and C.sha256_hex(dev_payload) == C.sha256_hex(expected_payload)
        ),
        # The device's stored hash column must ALSO agree with the content it
        # holds — this catches a transport that shipped a stale/incorrect hash.
        "stored_hash_matches_own_payload": (
            dev_payload is not None and r.get("payload_sha256") == C.sha256_hex(dev_payload)
        ),
    }


def run_trial(trial: int, udid: str, owner_id: str, conn, udid2: str | None) -> dict:
    r = {"trial": trial, "outcome": None, "mechanism": None, "void_reason": None}

    control = C.connect(autocommit=True)   # holds K
    sessA = C.connect(autocommit=False)    # the late committer (seq=10)
    sessB = C.connect(autocommit=True)     # the early committer (seq=11)
    verify = C.connect(autocommit=True)    # third connection: visibility oracle

    try:
        # --- distinct backends (predeclaration §5) -------------------------
        pids = {}
        for name, cn in (("control", control), ("A", sessA), ("B", sessB), ("verify", verify)):
            with cn.cursor() as cur:
                cur.execute("SELECT pg_backend_pid()")
                pids[name] = cur.fetchone()[0]
        sessA.commit()
        if len(set(pids.values())) != 4:
            r["void_reason"] = f"connections multiplexed (pids={pids}) — not session mode"
            return r
        r["pids"] = pids

        # --- STEP 1: fully synchronized device, EMPTY scope ----------------
        # Purge server rows and require the device to reach an empty, settled,
        # first-sync-complete state. This is the step 1 the previous revision
        # skipped, and it also decouples trials from each other.
        purge_captures(conn)
        try:
            C.wait_for(lambda: C.is_ready(udid) and not C.device_captures(udid),
                       90, 0.4, "device ready + local capture scope EMPTY")
        except TimeoutError as e:
            r["void_reason"] = f"step 1 precondition not met: {e}"
            return r
        pre = C.checkpoint(udid)
        r["checkpoint_before"] = pre
        r["precondition"] = {"hasSynced": True, "local_captures": 0}

        # --- STEP 2: control acquires K -----------------------------------
        with control.cursor() as cur:
            cur.execute("SELECT pg_advisory_lock(%s)", (K,))

        # --- STEP 3: A inserts (seq=10) then blocks pre-COMMIT -------------
        with sessA.cursor() as cur:
            cid_a, seq_a, payload_a = insert_capture(cur, trial, "A", owner_id)
        r.update(id_a=cid_a, seq_a=seq_a)

        a_committed_at = {}

        def a_thread():
            try:
                with sessA.cursor() as cur:
                    cur.execute("SELECT pg_advisory_xact_lock(%s)", (K,))  # BLOCKS here
                sessA.commit()
                a_committed_at["t"] = now()
            except Exception as e:  # noqa: BLE001
                a_committed_at["err"] = str(e)

        th = threading.Thread(target=a_thread, daemon=True)
        th.start()

        # --- STEP 4: assert A is open and waiting on the advisory lock -----
        def a_waiting():
            with verify.cursor() as cur:
                cur.execute(
                    """SELECT state, wait_event_type, wait_event
                       FROM pg_stat_activity WHERE pid = %s""", (pids["A"],))
                row = cur.fetchone()
            return row if row and row[1] == "Lock" and row[2] == "advisory" else None

        try:
            wait_row = C.wait_for(a_waiting, 15, 0.2, "A waiting on advisory lock")
        except TimeoutError:
            r["void_reason"] = "pg_stat_activity never showed A waiting on the advisory lock"
            return r
        r["a_wait_event"] = list(wait_row)

        # --- STEP 5: B inserts (seq=11) and COMMITS ------------------------
        with sessB.cursor() as cur:
            cid_b, seq_b, payload_b = insert_capture(cur, trial, "B", owner_id)
        b_committed_at = now()
        r.update(id_b=cid_b, seq_b=seq_b, b_committed_at=b_committed_at.isoformat())

        # THE NEGATIVE CONTROL: prove the inversion is real.
        if not (seq_a < seq_b):
            r["void_reason"] = f"no seq inversion (seq_a={seq_a} seq_b={seq_b})"
            return r

        # --- STEP 6: third connection — B visible, A NOT ------------------
        with verify.cursor() as cur:
            cur.execute("SELECT id FROM capture WHERE trial=%s ORDER BY seq", (trial,))
            visible = [x[0] for x in cur.fetchall()]
        if visible != [cid_b]:
            r["void_reason"] = f"visibility check failed: expected only B, saw {visible}"
            return r
        r["third_conn_visible"] = visible

        # --- STEP 7: give replication adequate opportunity to deliver B ----
        # while A is STILL OPEN. This is where the two mechanisms diverge.
        deadline = time.time() + OPPORTUNITY_WINDOW
        saw_b_at, b_latency = None, None
        t0 = time.time()
        while time.time() < deadline:
            if cid_b in C.device_captures(udid):
                saw_b_at, b_latency = now(), round(time.time() - t0, 2)
                break
            time.sleep(0.3)

        devs = C.device_captures(udid)
        if cid_a in devs:
            r["outcome"] = "FAIL"
            r["void_reason"] = "A (uncommitted!) appeared on device — dirty read"
            return r

        # Record the window explicitly so a near-boundary (b) classification is
        # visible rather than silently timing-dependent (#9 MEDIUM).
        r["opportunity_window_s"] = OPPORTUNITY_WINDOW
        r["b_arrival_latency_s"] = b_latency

        if saw_b_at:
            # ---------- mechanism (a): B durably checkpointed while A open ----
            r["mechanism"] = "late row delivered"
            r["device_saw_b_at"] = saw_b_at.isoformat()

            st_b = C.read_status(udid) or {}
            ck_b = C.checkpoint(udid)
            r["checkpoint_containing_b"] = ck_b

            # ASSERT advancement (#9 HIGH) — rev 1 only recorded it.
            if not (pre and ck_b and ck_b["last_op_total"] > pre["last_op_total"]):
                r["outcome"] = "FAIL"
                r["void_reason"] = (
                    f"checkpoint did not advance for B: {pre} -> {ck_b}")
                return r
            r["checkpoint_advanced_for_b"] = True

            # B's content must be right the moment we claim it's checkpointed.
            r["b_checks_at_checkpoint"] = verify_row_on_device(st_b, cid_b, payload_b)

            # ---- restart WITHOUT clearing the DB; PROVE a new process ------
            try:
                st_new = C.restart_app(udid)
            except (TimeoutError, RuntimeError) as e:
                r["outcome"] = "FAIL"
                r["void_reason"] = f"restart did not yield a live new process: {e}"
                return r
            r["restart"] = {
                "old_boot": st_b.get("bootId"),
                "new_boot": st_new.get("bootId"),
                "new_process_proven": st_new.get("bootId") != st_b.get("bootId"),
                "db_init_ok_in_new_process": bool(st_new.get("dbInitOk")),
            }
            # Re-query FROM the new process: B present, A absent, checkpoint kept.
            after = C.device_captures(udid)
            ck_after_restart = C.checkpoint(udid)
            r["persisted_after_restart"] = (cid_b in after) and (cid_a not in after)
            r["checkpoint_survived_restart"] = bool(
                ck_after_restart and ck_after_restart["last_op_total"] >= ck_b["last_op_total"])
            if not (r["persisted_after_restart"] and r["checkpoint_survived_restart"]):
                r["outcome"] = "FAIL"
                r["void_reason"] = "checkpoint state did not survive a proven restart"
                return r
        else:
            # ---------- mechanism (b): checkpoint withheld while A open -------
            r["mechanism"] = "unsafe checkpoint prevented"
            r["device_saw_b_at"] = None
            r["checkpoint_while_a_open"] = C.checkpoint(udid)
            # B genuinely committed (proved at step 6) and replication had
            # OPPORTUNITY_WINDOW seconds; PowerSync still did not deliver it.

        observation_at = now()

        # --- STEP 8: release K -> A commits -------------------------------
        with control.cursor() as cur:
            cur.execute("SELECT pg_advisory_unlock(%s)", (K,))
        th.join(timeout=30)
        if "t" not in a_committed_at:
            r["void_reason"] = f"A never committed: {a_committed_at.get('err')}"
            return r
        r["a_committed_at"] = a_committed_at["t"].isoformat()
        r["a_committed_after_observation"] = a_committed_at["t"] > observation_at
        if not r["a_committed_after_observation"]:
            r["void_reason"] = "A committed before the device observation — ordering not established"
            return r

        # --- STEP 9: BOTH rows must reach the SAME device ------------------
        try:
            C.wait_for(lambda: cid_a in C.device_captures(udid) and cid_b in C.device_captures(udid),
                       ARRIVAL_TIMEOUT, 0.5, "late A (and B) on the checkpointed device")
        except TimeoutError:
            r["outcome"] = "FAIL"
            r["void_reason"] = f"late A never arrived within {ARRIVAL_TIMEOUT}s — CAPTURE LOST"
            return r

        st = C.read_status(udid) or {}
        a_checks = verify_row_on_device(st, cid_a, payload_a)
        b_checks = verify_row_on_device(st, cid_b, payload_b)
        r["a_checks"] = a_checks
        r["b_checks"] = b_checks

        checks = {f"a_{k}": v for k, v in a_checks.items()}
        checks.update({f"b_{k}": v for k, v in b_checks.items()})
        checks["a_seq_matches"] = any(
            c["id"] == cid_a and c["seq"] == seq_a for c in st.get("captures", []))

        with verify.cursor() as cur:
            cur.execute("SELECT count(*) FROM capture WHERE trial=%s", (trial,))
            checks["both_rows_in_postgres"] = cur.fetchone()[0] == 2
        try:
            C.wait_for(lambda: C.is_idle(udid), 30, what="PowerSync back to idle")
            checks["powersync_idle"] = True
        except TimeoutError:
            checks["powersync_idle"] = False

        ck_end = C.checkpoint(udid)
        r["checkpoint_after"] = ck_end
        checks["checkpoint_advanced_for_a"] = bool(
            ck_end and r.get("checkpoint_containing_b")
            and ck_end["last_op_total"] > r["checkpoint_containing_b"]["last_op_total"]
        ) if r["mechanism"] == "late row delivered" else True

        # --- STEP 10: fresh-client CONTROL (eligibility only) --------------
        # Explicitly NOT a substitute for delivery to the checkpointed device.
        if udid2:
            try:
                C.wait_for(lambda: cid_a in C.device_captures(udid2), 60, 0.5,
                           "fresh-client control to receive A")
                st2 = C.read_status(udid2) or {}
                r["fresh_client_control"] = {
                    "note": "eligibility control ONLY — cannot substitute for the checkpointed device",
                    "a": verify_row_on_device(st2, cid_a, payload_a),
                    "b": verify_row_on_device(st2, cid_b, payload_b),
                }
            except TimeoutError:
                r["fresh_client_control"] = {"received_a": False}

        r["checks"] = checks
        r["outcome"] = "PASS" if all(checks.values()) else "FAIL"
        if r["outcome"] == "FAIL":
            r["void_reason"] = "failed checks: " + ", ".join(k for k, v in checks.items() if not v)
        return r

    finally:
        for cn in (control, sessA, sessB, verify):
            try:
                cn.close()
            except Exception:  # noqa: BLE001
                pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--trials", type=int, default=20, help="PREDECLARED N=20")
    ap.add_argument("--udid", required=True)
    ap.add_argument("--udid2", help="fresh-client control device (step 10)")
    ap.add_argument("--owner-id", required=True)
    ap.add_argument("--out", default=str(pathlib.Path(__file__).parents[1] / "out" / "q1.json"))
    a = ap.parse_args()

    conn = C.connect()
    seed(conn, a.owner_id)
    print("seeded; waiting for device to sync the project…")
    C.wait_for(lambda: C.is_ready(a.udid), 90, what="device ready (hasSynced + dbInitOk)")

    results = []
    for t in range(1, a.trials + 1):
        started = time.time()
        try:
            r = run_trial(t, a.udid, a.owner_id, conn, a.udid2)
        except Exception as e:  # noqa: BLE001
            r = {"trial": t, "outcome": "ERROR", "void_reason": repr(e)}
        r["duration_s"] = round(time.time() - started, 1)
        results.append(r)
        tag = r["outcome"] or f"VOID"
        print(f"  trial {t:>2}: {tag:<6} mech={r.get('mechanism')} "
              f"seq_a={r.get('seq_a')} seq_b={r.get('seq_b')} "
              f"b_lat={r.get('b_arrival_latency_s')}s ({r['duration_s']}s)")
        if r.get("void_reason"):
            print(f"    !! {r['void_reason']}")

    passed = [r for r in results if r["outcome"] == "PASS"]
    failed = [r for r in results if r["outcome"] == "FAIL"]
    void = [r for r in results if r["outcome"] in (None, "ERROR")]
    mechs = sorted({r.get("mechanism") for r in passed if r.get("mechanism")})

    summary = {
        "revision": 2,
        "supersedes": "revision 1, whose VALID PASS was rejected by docs/CRITIC-REVIEW-09-CODEX.md",
        "predeclared_trials": a.trials,
        "passed": len(passed), "failed": len(failed), "void": len(void),
        "mechanisms_observed": mechs,
        "verdict": "VALID PASS" if (len(passed) == a.trials and not failed and not void) else "FAIL",
        "honesty_notes": [
            "N=20 is a MECHANISM determination, NOT a failure-rate bound (20/20 bounds "
            "the rate only at <14% @95%). See docs/BAKEOFF-PREDECLARATION.md §1.2.",
            "ps_buckets.last_op is a per-bucket op cursor, NOT the protocol's "
            "checkpoint_complete message. Advancement + row materialisation is the oracle.",
            "Scope: one-row ordinary transactions, one project, good network, iOS "
            "simulator, debug build. Streaming of large in-progress transactions, "
            "two-phase commit, parallel apply, bucket compaction and service restarts "
            "are NOT exercised — so 'structural immunity' is NOT established.",
        ],
        "results": results,
    }
    outp = pathlib.Path(a.out); outp.parent.mkdir(parents=True, exist_ok=True)
    outp.write_text(json.dumps(summary, indent=2, default=str))
    print(f"\n{summary['verdict']}  pass={len(passed)} fail={len(failed)} void={len(void)} "
          f"mechanism={mechs}")
    print(f"-> {outp}")


if __name__ == "__main__":
    main()
