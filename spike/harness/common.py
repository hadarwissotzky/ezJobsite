"""Shared harness plumbing for the sync bakeoff.

Rules encoded here (from docs/BAKEOFF-PREDECLARATION.md §5):
  * Postgres connections MUST use the pooler in SESSION mode (:5432). Transaction
    mode (:6543) multiplexes backends and would silently break session advisory
    locks and pg_stat_activity assertions -> a false pass.
  * Never source .env in a shell: it contains angle-bracket placeholders and zsh
    parses `<` as a redirect. Parse it here instead.
  * Never print secret values.
"""
import hashlib
import json
import pathlib
import subprocess
import time

import psycopg

ROOT = pathlib.Path(__file__).resolve().parents[2]
ENV_FILE = ROOT / ".env"
BUNDLE_ID = "dev.ezjobsite.bakeoff"


def env(key: str) -> str:
    for line in ENV_FILE.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        if k.strip() == key:
            return v.strip().strip('"').strip("'")
    raise KeyError(f"{key} not in .env")


def project_ref() -> str:
    return env("EXPO_PUBLIC_SUPABASE_URL").split("//")[1].split(".")[0]


def conninfo() -> str:
    # user MUST be tenant-qualified for the pooler; .env's SUPABASE_DB_USER=postgres
    # is wrong and is deliberately NOT used here.
    return (
        f"host={env('SUPABASE_DB_HOST')} port=5432 dbname=postgres "
        f"user=postgres.{project_ref()} password={env('SUPABASE_DB_PASSWORD')} "
        f"sslmode=require"
    )


def connect(autocommit: bool = True) -> psycopg.Connection:
    return psycopg.connect(conninfo(), autocommit=autocommit)


# ---------------------------------------------------------------- device I/O

def app_container(udid: str) -> pathlib.Path:
    out = subprocess.run(
        ["xcrun", "simctl", "get_app_container", udid, BUNDLE_ID, "data"],
        capture_output=True, text=True, check=True,
    )
    return pathlib.Path(out.stdout.strip())


def status_path(udid: str) -> pathlib.Path:
    return app_container(udid) / "Documents" / "status.json"


def read_status(udid: str) -> dict | None:
    p = status_path(udid)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text())
    except (json.JSONDecodeError, ValueError):
        return None  # caught mid-write; caller retries


# Monotonic across harness runs. The app now persists a command watermark and
# only executes `seq > watermark`, so a per-run counter starting at 0 would make
# the app SILENTLY SKIP every command after the first run. Seeding from the clock
# keeps it strictly increasing without the harness having to read app state.
_cmd_seq = {"n": int(time.time() * 1000)}


def send_command(udid: str, action: str, **kw) -> None:
    _cmd_seq["n"] += 1
    p = app_container(udid) / "Documents" / "command.json"
    p.write_text(json.dumps({"seq": _cmd_seq["n"], "action": action, **kw}))


def clear_command(udid: str) -> None:
    """Belt-and-braces: remove the pending command before a kill.

    The durable watermark in the app is the real fix; this just means a
    relaunched app does not even see a stale command to consider.
    """
    p = app_container(udid) / "Documents" / "command.json"
    if p.exists():
        p.unlink()


def restart_app(udid: str, timeout: float = 90.0) -> dict:
    """Terminate + relaunch WITHOUT clearing the database, and PROVE a new
    process produced the post-restart observation.

    Q1 forbids reset/resnapshot/reinstall/DB-clear of the checkpointed device;
    this is a process restart only, so the on-disk SQLite (and its persisted
    ps_buckets cursor) survives untouched.

    Codex #9 CRITICAL: the previous version waited only for status.json to
    EXIST. It already existed before termination, so the check passed even if
    the relaunched app never opened SQLite or crashed instantly — the assertion
    could not fail. We now require a DIFFERENT bootId, a RESET statusSeq from
    the new process, and dbInitOk from that same process.

    Returns the first status dict produced by the NEW process.
    Raises TimeoutError / RuntimeError rather than silently passing.
    """
    before = read_status(udid) or {}
    old_boot = before.get("bootId")

    subprocess.run(["xcrun", "simctl", "terminate", udid, BUNDLE_ID],
                   capture_output=True, text=True)
    time.sleep(1.5)
    subprocess.run(["xcrun", "simctl", "launch", udid, BUNDLE_ID],
                   capture_output=True, text=True, check=True)

    def fresh():
        st = read_status(udid)
        if not st:
            return None
        # A new process => new bootId. Nothing else can forge this.
        if st.get("bootId") in (None, old_boot):
            return None
        if not st.get("dbInitOk"):
            return None  # process is up but SQLite never opened
        return st

    st = wait_for(fresh, timeout, 0.4, "a NEW app process (new bootId + dbInitOk)")
    if st.get("bootId") == old_boot:
        raise RuntimeError("restart did not produce a new process")
    return st


def wait_for(fn, timeout: float = 60.0, interval: float = 0.4, what: str = "condition"):
    """Poll fn() until truthy. Returns its value, or raises TimeoutError."""
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = fn()
        if last:
            return last
        time.sleep(interval)
    raise TimeoutError(f"timed out after {timeout}s waiting for {what}")


def device_captures(udid: str) -> dict[str, dict]:
    st = read_status(udid) or {}
    return {c["id"]: c for c in st.get("captures", [])}


def sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def checkpoint(udid: str, bucket_prefix: str = "1#bakeoff") -> dict | None:
    """PowerSync's persisted PER-BUCKET operation cursor.

    HONEST LABELLING (Codex #9 HIGH): `last_op` is NOT the protocol's
    "checkpoint_complete" message. It is the per-bucket op cursor stored in the
    client's local SQLite. Its ADVANCEMENT, combined with the row being present
    in the materialised `capture` view, is evidence that a checkpoint was
    applied and durably stored. It is not, by itself, a named checkpoint-complete
    event. Callers must ASSERT advancement rather than merely record it.

    The `$local` bucket is excluded — it tracks local writes, not downloads.
    """
    st = read_status(udid) or {}
    bs = [b for b in (st.get("buckets") or []) if str(b.get("name", "")).startswith(bucket_prefix)]
    if not bs:
        return None
    # Sum across data buckets so a per-project split doesn't hide advancement.
    return {
        "buckets": bs,
        "last_op_total": sum(int(b.get("last_op") or 0) for b in bs),
        "names": [b.get("name") for b in bs],
    }


def is_idle(udid: str) -> bool:
    st = read_status(udid) or {}
    return bool(st.get("connected")) and st.get("downloading") is False


def is_ready(udid: str) -> bool:
    """Step-1 precondition: fully synchronized, DB open, first sync complete.

    Codex #9: the old check was only `connected && !downloading`, which never
    asserted hasSynced or that the local scope was actually settled.
    """
    st = read_status(udid) or {}
    return (
        bool(st.get("dbInitOk"))
        and bool(st.get("connected"))
        and bool(st.get("hasSynced"))
        and st.get("downloading") is False
    )
