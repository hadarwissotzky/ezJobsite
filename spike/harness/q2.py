"""Q2 — mutable operational state, conflict edition.

Implements docs/SPIKE-SYNC-BAKEOFF.md:56 with the ownership + convergence rules
PREDECLARED in docs/BAKEOFF-PREDECLARATION.md §2. Those rules were frozen before
the run; they are not reinterpreted to fit the outcome.

  capture_op_state.processing_state  -> SERVER-owned. Client write MUST be refused
                                        at the DB boundary (column-level grant).
  capture_op_state.resolution_status -> CLIENT-owned. A pending OFFLINE edit must
                                        be PRESERVED and must WIN over a
                                        conflicting server edit (LWW by upload order).

=============================== REVISION 2 ===================================
Rewritten after docs/CRITIC-REVIEW-09-CODEX.md REJECTED revision 1's "VALID PASS".
Defects fixed, each traceable to a #9 finding:

  #9 HIGH "42501 attribution is not robust"
      -> the rejection list is BASELINED before the write, and the assertion now
         requires a NEW rejection matching THIS row id AND the server-owned field.
         Rev 1 accepted any 42501 from the app's whole lifetime.
  #9 HIGH "required server-owned convergence assertion is missing"
      -> we now assert the device's processing_state RETURNS to the authoritative
         server value. Rev 1 claimed a measured "silent revert" it never tested.
  #9 HIGH "the conflict test is a single favorable upload ordering"
      -> both orderings are run: server-edit-while-offline (download pending at
         reconnect) AND server-edit-after-reconnect. PG ending on the last write
         to arrive is expected in ordering A regardless of sync sophistication;
         what ordering A actually proves is that the offline CRUD entry SURVIVED.
  #9 MEDIUM "one trial is insufficient for a concurrency claim"
      -> --trials (default 5) per ordering.
"""
import argparse
import json
import pathlib
import sys
import time
import uuid

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import common as C  # noqa: E402

PROJECT_ID = "proj-bakeoff-q2"


def seed_capture(conn, owner_id):
    cid = f"q2-{uuid.uuid4().hex[:8]}"
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO project (id, owner_id, name, status) VALUES (%s,%s,%s,'active') "
            "ON CONFLICT (id) DO UPDATE SET status='active'",
            (PROJECT_ID, owner_id, "Q2 Project"),
        )
        cur.execute(
            """INSERT INTO capture (id, owner_id, project_id, payload, payload_sha256)
               VALUES (%s,%s,%s,'q2 payload','deadbeef')""",
            (cid, owner_id, PROJECT_ID),
        )
        cur.execute(
            """INSERT INTO capture_op_state
                 (id, capture_id, owner_id, project_id, processing_state, resolution_status)
               VALUES (%s,%s,%s,%s,'captured','unresolved')""",
            (cid, cid, owner_id, PROJECT_ID),
        )
    return cid


def op_state_on_device(udid, cid):
    st = C.read_status(udid) or {}
    for r in st.get("opstate", []):
        if r["capture_id"] == cid:
            return r
    return None


def op_state_in_pg(conn, cid):
    with conn.cursor() as cur:
        cur.execute(
            "SELECT processing_state, resolution_status FROM capture_op_state WHERE capture_id=%s",
            (cid,))
        row = cur.fetchone()
    return {"processing_state": row[0], "resolution_status": row[1]} if row else None


def rejections(udid):
    return (C.read_status(udid) or {}).get("rejectedWrites", []) or []


def run_conflict_trial(conn, udid1, udid2, owner_id, ordering: str) -> dict:
    """ordering:
       'server_edit_while_offline' — server commits its edit BEFORE the device
            reconnects, so a conflicting value is pending download at reconnect.
       'server_edit_after_reconnect' — the device uploads first, then the server
            edits. Server value is simply later; LWW says it wins.
    """
    cid = seed_capture(conn, owner_id)
    t = {"ordering": ordering, "capture_id": cid, "checks": {}, "evidence": {}}

    devices = [udid1] + ([udid2] if udid2 else [])
    for u in devices:
        C.wait_for(lambda u=u: op_state_on_device(u, cid) is not None, 90,
                   what=f"{u[:8]} to receive op_state")

    # Offline, then edit the CLIENT-owned field.
    C.send_command(udid1, "disconnect")
    C.wait_for(lambda: (C.read_status(udid1) or {}).get("connected") is False, 30,
               what="device1 offline")
    C.send_command(udid1, "edit_resolution", capture_id=cid, value="resolved")
    C.wait_for(lambda: (op_state_on_device(udid1, cid) or {}).get("resolution_status") == "resolved",
               30, what="local edit applied")
    pending = (C.read_status(udid1) or {}).get("pendingCrud", -1)
    t["evidence"]["pending_crud_while_offline"] = pending
    t["checks"]["local_edit_queued_while_offline"] = pending > 0

    if ordering == "server_edit_while_offline":
        with conn.cursor() as cur:
            cur.execute("UPDATE capture_op_state SET resolution_status='overridden', "
                        "updated_at=now() WHERE capture_id=%s", (cid,))
        t["evidence"]["pg_after_server_edit"] = op_state_in_pg(conn, cid)
        C.send_command(udid1, "connect")
        expected = "resolved"          # the pending client edit uploads last -> wins
    else:
        C.send_command(udid1, "connect")
        C.wait_for(lambda: (C.read_status(udid1) or {}).get("pendingCrud", 1) == 0, 60,
                   what="device1 upload queue to drain")
        time.sleep(1.0)
        with conn.cursor() as cur:
            cur.execute("UPDATE capture_op_state SET resolution_status='overridden', "
                        "updated_at=now() WHERE capture_id=%s", (cid,))
        t["evidence"]["pg_after_server_edit"] = op_state_in_pg(conn, cid)
        expected = "overridden"        # server edit is strictly later -> wins

    try:
        C.wait_for(lambda: (C.read_status(udid1) or {}).get("pendingCrud", 1) == 0, 60,
                   what="upload queue drained")
        t["checks"]["upload_queue_drained"] = True
    except TimeoutError:
        t["checks"]["upload_queue_drained"] = False

    # Converge.
    try:
        C.wait_for(lambda: op_state_in_pg(conn, cid)["resolution_status"] == expected
                   and all((op_state_on_device(u, cid) or {}).get("resolution_status") == expected
                           for u in devices),
                   60, 0.5, f"convergence to '{expected}'")
    except TimeoutError:
        pass

    final_pg = op_state_in_pg(conn, cid)
    t["evidence"]["pg_final"] = final_pg
    t["evidence"]["devices_final"] = {u[:8]: op_state_on_device(u, cid) for u in devices}
    t["evidence"]["expected_by_predeclared_rule"] = expected

    t["checks"]["pg_matches_predeclared_rule"] = final_pg["resolution_status"] == expected
    if ordering == "server_edit_while_offline":
        # The load-bearing assertion for this ordering: the offline edit SURVIVED.
        t["checks"]["pending_local_edit_not_clobbered"] = (
            (op_state_on_device(udid1, cid) or {}).get("resolution_status") == "resolved")
    t["checks"]["all_devices_converged"] = len({
        (op_state_on_device(u, cid) or {}).get("resolution_status") for u in devices}) == 1
    return t, cid


def run_server_owned_trial(conn, udid1, udid2, cid) -> dict:
    """Client writes a SERVER-owned field. Must be refused at the DB boundary,
    must not reach PG, and the device must converge BACK to the server value."""
    t = {"capture_id": cid, "checks": {}, "evidence": {}}
    devices = [udid1] + ([udid2] if udid2 else [])

    before_pg = op_state_in_pg(conn, cid)["processing_state"]
    baseline = rejections(udid1)                       # <-- #9 fix: BASELINE first
    t["evidence"]["rejections_baseline_count"] = len(baseline)

    C.send_command(udid1, "edit_processing", capture_id=cid, value="processed")
    C.wait_for(lambda: (op_state_on_device(udid1, cid) or {}).get("processing_state") == "processed",
               30, what="local (unauthorized) edit applied")

    # Require a NEW rejection that matches THIS row and THIS field.
    def new_matching():
        for r in rejections(udid1)[len(baseline):]:
            if (r.get("code") == "42501" and r.get("rowId") == cid
                    and "processing_state" in (r.get("fields") or [])):
                return r
        return None

    try:
        match = C.wait_for(new_matching, 60, 0.5,
                           "a NEW 42501 naming this row + processing_state")
    except TimeoutError:
        match = None
    t["evidence"]["new_matching_rejection"] = match
    t["checks"]["server_owned_write_refused_for_this_row"] = match is not None

    time.sleep(3)
    after_pg = op_state_in_pg(conn, cid)["processing_state"]
    t["evidence"]["processing_state_pg_before"] = before_pg
    t["evidence"]["processing_state_pg_after"] = after_pg
    t["checks"]["server_owned_write_did_not_reach_pg"] = before_pg == after_pg

    # #9 fix: the convergence-back the predeclaration requires and rev 1 claimed
    # but never asserted.
    try:
        C.wait_for(lambda: all(
            (op_state_on_device(u, cid) or {}).get("processing_state") == before_pg
            for u in devices), 60, 0.5, "device to converge back to the server value")
        t["checks"]["device_converged_back_to_server_value"] = True
    except TimeoutError:
        t["checks"]["device_converged_back_to_server_value"] = False
    t["evidence"]["devices_final_processing_state"] = {
        u[:8]: (op_state_on_device(u, cid) or {}).get("processing_state") for u in devices}
    return t


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--udid1", required=True)
    ap.add_argument("--udid2")
    ap.add_argument("--owner-id", required=True)
    ap.add_argument("--trials", type=int, default=5, help="per ordering")
    ap.add_argument("--out", default=str(pathlib.Path(__file__).parents[1] / "out" / "q2.json"))
    a = ap.parse_args()

    conn = C.connect()
    for u in [a.udid1] + ([a.udid2] if a.udid2 else []):
        C.wait_for(lambda u=u: C.is_ready(u), 90, what=f"{u[:8]} ready")

    conflict, owned = [], []
    for ordering in ("server_edit_while_offline", "server_edit_after_reconnect"):
        for i in range(1, a.trials + 1):
            t, cid = run_conflict_trial(conn, a.udid1, a.udid2, a.owner_id, ordering)
            t["trial"] = i
            conflict.append(t)
            ok = all(t["checks"].values())
            print(f"  conflict[{ordering}] {i}: {'PASS' if ok else 'FAIL'} "
                  f"pg={t['evidence']['pg_final']['resolution_status']} "
                  f"(expected {t['evidence']['expected_by_predeclared_rule']})")
            if ordering == "server_edit_while_offline" and i <= a.trials:
                o = run_server_owned_trial(conn, a.udid1, a.udid2, cid)
                o["trial"] = i
                owned.append(o)
                print(f"  server-owned    {i}: "
                      f"{'PASS' if all(o['checks'].values()) else 'FAIL'}")

    all_checks = [v for t in conflict + owned for v in t["checks"].values()]
    res = {
        "revision": 2,
        "supersedes": "revision 1, whose VALID PASS was rejected by docs/CRITIC-REVIEW-09-CODEX.md",
        "trials_per_ordering": a.trials,
        "conflict_trials": conflict,
        "server_owned_trials": owned,
        "checks_total": len(all_checks),
        "checks_passed": sum(1 for v in all_checks if v),
        "verdict": "VALID PASS" if all(all_checks) else "FAIL",
        "honesty_notes": [
            "The 42501 proves the DATABASE refused the write in this run — the error "
            "came back from PostgREST. But the discard POLICY is OURS: PowerSync "
            "leaves asynchronous validation and discard policy to the application. "
            "A pass here is NOT 'PowerSync supplies safe rejection handling'.",
            "LWW on resolution_status is a spike-local choice with a real cost: two "
            "crew members editing simultaneously means one edit is silently discarded. "
            "Semantic conflict resolution stays ours either way.",
            "In ordering 'server_edit_while_offline', PG ending on the client value is "
            "expected because it is the last write to ARRIVE. What that ordering "
            "actually proves is that the offline CRUD entry SURVIVED and uploaded.",
            "Both devices are separate stores but the SAME Supabase user — this is the "
            "'one contractor, two devices' case, not two independent actors.",
        ],
    }
    outp = pathlib.Path(a.out); outp.parent.mkdir(parents=True, exist_ok=True)
    outp.write_text(json.dumps(res, indent=2, default=str))
    print(f"\n{res['verdict']}  {res['checks_passed']}/{res['checks_total']} checks -> {outp}")


if __name__ == "__main__":
    main()
