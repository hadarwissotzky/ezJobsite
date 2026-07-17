import '@azure/core-asynciterator-polyfill';
import 'react-native-get-random-values';

import { OPSqliteOpenFactory } from '@powersync/op-sqlite';
import { PowerSyncDatabase } from '@powersync/react-native';
import * as FS from 'expo-file-system/legacy';
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppSchema } from './src/AppSchema';
import { SupabaseConnector } from './src/connector';
import {
  applyDurabilityProfile,
  assertDurabilityProfile,
  ensureAppOwnedSchema,
  exportCapture,
  failpoint,
  listCommittedCaptures,
  performCapture,
  recoverySweep,
  savedEvents,
  type Boundary,
} from './src/durability';

// Which identity this instance runs as. Device 2 is launched with a different
// value so two simulators can observe convergence (Q2).
const DEVICE = process.env.EXPO_PUBLIC_DEVICE ?? 'device1';
const EMAIL = `${DEVICE}@example.com`;
const PASSWORD = 'bakeoff-spike-pw-2026';

const STATUS_FILE = FS.documentDirectory + 'status.json';
const COMMAND_FILE = FS.documentDirectory + 'command.json';
// DURABLE command watermark. Without this, `lastCmdSeq` is process-local and
// resets to -1 on relaunch, so the app RE-EXECUTES the stale command sitting in
// command.json. Observed: 4 capture_commit rows from one requested capture.
// Every K-boundary trial is arm -> capture -> kill -> relaunch -> assert, so the
// relaunch would silently perform a SECOND capture before the assertions ran and
// both (0,0) and (1,1) would become unreliable. Same class as Codex #9's restart
// check that could not fail: a harness artifact manufacturing the state it claims
// to observe.
const CMD_WATERMARK_FILE = FS.documentDirectory + 'cmd-watermark.json';

// Per-PROCESS identity. Codex #9 CRITICAL: the old restart check waited for
// status.json to *exist* — but it already existed before termination, so a
// relaunched app that crashed instantly would have "passed". The harness now
// requires a NEW boot_id + a newer statusSeq, which only a live new process
// can produce.
const BOOT_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
let STATUS_SEQ = 0;
let DB_INIT_OK = false;
let DURABILITY: any = { ok: false, report: [], writeReport: [], poolDisagrees: false };
let RECOVERY: { tmpDeleted: number; orphansDeleted: number; integrityErrors: string[] } = {
  tmpDeleted: 0, orphansDeleted: 0, integrityErrors: [],
};
let LAST_CAPTURE: any = null;
let LAST_EXPORT: any = null;

// op-sqlite native adapter, passed EXPLICITLY. The bare `{ dbFilename }` form
// does NOT auto-detect op-sqlite — it falls back to @journeyapps/react-native-quick-sqlite
// and throws at runtime. (The docs' "detects which peer is present" claim did not
// hold for @powersync/op-sqlite 0.9.15 + @powersync/react-native 1.35.x.)
//
// NOT the Expo Go sql-js adapter: that one has no SQLite consistency guarantees
// (full DB rewrite per write, corruptible on kill), which would invalidate every
// durability claim Q1 depends on.
export const db = new PowerSyncDatabase({
  schema: AppSchema,
  database: new OPSqliteOpenFactory({ dbFilename: `bakeoff-${DEVICE}.db` }),
});

const connector = new SupabaseConnector();

export default function App() {
  const [log, setLog] = React.useState<string[]>([]);
  const say = React.useCallback(
    (m: string) => setLog((l) => [...l.slice(-14), `${new Date().toISOString().slice(11, 23)} ${m}`]),
    []
  );

  React.useEffect(() => {
    let stop = false;
    let lastCmdSeq = -1;

    (async () => {
      try {
        await db.init();
        // Durability profile FIRST (spec §3): apply, then assert by readback.
        // If the readback fails we must not arm the recorder — the app is
        // usable for sync but performCapture() will refuse.
        await applyDurabilityProfile(db);
        await ensureAppOwnedSchema(db);
        DURABILITY = await assertDurabilityProfile(db);
        DB_INIT_OK = true;
        say(`db init boot=${BOOT_ID} durability=${DURABILITY.ok ? 'OK' : 'FAILED'}`);
        if (!DURABILITY.ok) {
          say('DURABILITY ASSERTION FAILED — capture will refuse: ' +
            DURABILITY.writeReport.filter((r: any) => !r.ok).map((r: any) => `${r.name}=${r.got}`).join(','));
        }
        // Recovery sweep on every launch (spec §4).
        RECOVERY = await recoverySweep(db);
        say(`recovery: tmp=${RECOVERY.tmpDeleted} orphans=${RECOVERY.orphansDeleted} integrityErr=${RECOVERY.integrityErrors.length}`);
        await connector.login(EMAIL, PASSWORD);
        say(`signed in ${EMAIL}`);
        // connect() is fire-and-forget by design.
        db.connect(connector);
        say('connect() issued');
      } catch (e: any) {
        say(`FATAL ${e?.message ?? e}`);
      }

      // Load the durable command watermark (see CMD_WATERMARK_FILE).
      try {
        const wm = await FS.getInfoAsync(CMD_WATERMARK_FILE);
        if (wm.exists) {
          lastCmdSeq = JSON.parse(await FS.readAsStringAsync(CMD_WATERMARK_FILE)).seq ?? -1;
          say(`cmd watermark restored: ${lastCmdSeq}`);
        }
      } catch { /* first boot */ }

      // Status writer + command poller. 500ms is fast enough for the harness to
      // catch a checkpoint transition without hammering SQLite.
      while (!stop) {
        try {
          const s = db.currentStatus;

          // Codex #9 HIGH: bucket state and rows were read in SEPARATE queries,
          // so the harness could publish a cross-checkpoint mixture. Read both
          // inside ONE read transaction so the snapshot is internally consistent.
          //
          // Q1 ORACLE, honestly labelled: ps_buckets.last_op is PowerSync's
          // persisted PER-BUCKET operation cursor. It is NOT the protocol's
          // "checkpoint_complete" message. Its advancement plus the row being
          // present in the materialised `capture` view is evidence a checkpoint
          // was applied and stored — but the harness must ASSERT the
          // advancement, not merely record it.
          const snap = await db.readTransaction(async (tx) => {
            let buckets: any[] = [];
            try {
              buckets = (await tx.getAll(
                `SELECT name, last_op, target_op FROM ps_buckets ORDER BY name`
              )) as any[];
            } catch {
              /* table absent before first sync */
            }
            // `payload` is returned so the harness can recompute SHA-256 itself.
            // Codex #9 HIGH: comparing the payload_sha256 COLUMN to the server's
            // payload_sha256 COLUMN is circular — a transport that corrupted
            // `payload` but preserved the hash column would pass.
            const captures = (await tx.getAll(
              `SELECT id, seq, label, trial, payload, payload_sha256 FROM capture ORDER BY seq`
            )) as any[];
            const opstate = (await tx.getAll(
              `SELECT id, capture_id, processing_state, resolution_status FROM capture_op_state ORDER BY id`
            )) as any[];
            const projects = (await tx.getAll(
              `SELECT id, name, status FROM project ORDER BY id`
            )) as any[];
            let pendingCrud = -1;
            try {
              const p = (await tx.getAll(`SELECT count(*) AS n FROM ps_crud`)) as any[];
              pendingCrud = p[0]?.n ?? -1;
            } catch {
              /* ignore */
            }
            return { buckets, captures, opstate, projects, pendingCrud };
          });

          // --- app-owned commitment authority (spec §1). capture_commit is the
          // ONLY thing that means "committed". Read it separately from the
          // PowerSync projections so the two can never be conflated.
          let commits: any[] = [], outbox: any[] = [];
          try {
            commits = await db.getAll(
              `SELECT capture_id, attachment_id, mutation_id, media_relpath, media_sha256,
                      media_bytes, request_sha256 FROM capture_commit ORDER BY committed_at_ms`);
            outbox = await db.getAll(
              `SELECT mutation_id, capture_id, attempt_count, last_error_code FROM capture_outbox`);
          } catch { /* tables absent pre-init */ }

          const status = {
            device: DEVICE,
            // Per-process identity: only a live NEW process can change these.
            bootId: BOOT_ID,
            statusSeq: ++STATUS_SEQ,
            dbInitOk: DB_INIT_OK,
            // Spec §3 — the gate. If false, performCapture refuses.
            durabilityOk: DURABILITY.ok,
            durabilityReport: DURABILITY.report,
            durabilityWriteReport: DURABILITY.writeReport,
            durabilityPoolDisagrees: DURABILITY.poolDisagrees,
            recovery: RECOVERY,
            // Spec §1 — the commitment authority, and delivery status separately.
            captureCommits: commits,
            captureOutbox: outbox,
            // Spec §5 — the acknowledged set. Nonce-bound.
            savedEvents,
            // Spec §5 — the failpoint contract: the harness must observe this
            // exact tuple before it terminates us.
            failpointArmed: failpoint.armed,
            failpointReached: failpoint.reached,
            failpointParked: failpoint.parked,
            lastCapture: LAST_CAPTURE,
            lastExport: LAST_EXPORT,
            ts: new Date().toISOString(),
            connected: s.connected,
            hasSynced: s.hasSynced,
            lastSyncedAt: s.lastSyncedAt?.toISOString() ?? null,
            downloading: s.dataFlowStatus?.downloading ?? null,
            uploading: s.dataFlowStatus?.uploading ?? null,
            ...snap,
            rejectedWrites: connector.rejected,
          };
          await FS.writeAsStringAsync(STATUS_FILE, JSON.stringify(status, null, 1));

          // Command channel: the harness drops a JSON file; we execute once per seq.
          const info = await FS.getInfoAsync(COMMAND_FILE);
          if (info.exists) {
            const cmd = JSON.parse(await FS.readAsStringAsync(COMMAND_FILE));
            if (typeof cmd.seq === 'number' && cmd.seq > lastCmdSeq) {
              lastCmdSeq = cmd.seq;
              // Persist BEFORE running. A command that dies mid-execution must
              // not replay on relaunch -- replaying `do_capture` is exactly the
              // defect this fixes.
              await FS.writeAsStringAsync(CMD_WATERMARK_FILE, JSON.stringify({ seq: cmd.seq }));
              say(`cmd#${cmd.seq} ${cmd.action}`);
              // FIRE-AND-FORGET, deliberately. `await` here parked the STATUS
              // WRITER as well as the capture: a failpoint would pause the
              // capture thread and thereby prevent the app from ever publishing
              // that it had paused. The harness could never observe
              // {trialNonce, captureId, boundary}, so every trial voided --
              // the observer and the observed shared a loop.
              // Codex's spec says "pause the capture thread"; this keeps the
              // status loop alive so a parked capture is still visible.
              void runCommand(cmd, say).catch((e: any) => say(`cmd err ${e?.message ?? e}`));
            }
          }
        } catch (e: any) {
          say(`loop err ${e?.message ?? e}`);
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    })();

    return () => {
      stop = true;
    };
  }, [say]);

  return (
    <View style={styles.c}>
      <Text style={styles.h}>bakeoff · {DEVICE}</Text>
      <ScrollView>
        {log.map((l, i) => (
          <Text key={i} style={styles.l}>
            {l}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
}

async function runCommand(cmd: any, say: (m: string) => void) {
  switch (cmd.action) {
    case 'disconnect':
      // Simulates going offline WITHOUT clearing the database — Q1 forbids any
      // reset/reinstall/DB-clear of the checkpointed device.
      await db.disconnect();
      say('disconnected (db intact)');
      break;
    case 'connect':
      db.connect(connector);
      say('reconnected');
      break;
    case 'edit_resolution':
      // CLIENT-owned field. Pending offline edit must survive and win.
      await db.execute(
        `UPDATE capture_op_state SET resolution_status = ?, updated_at = ? WHERE capture_id = ?`,
        [cmd.value, new Date().toISOString(), cmd.capture_id]
      );
      say(`local resolution_status=${cmd.value}`);
      break;
    case 'edit_processing':
      // SERVER-owned field. This write MUST be refused at the DB boundary.
      // It applies to the local DB (PowerSync is local-first) and then fails on
      // upload with 42501 — which is exactly the assertion Q2 wants.
      await db.execute(
        `UPDATE capture_op_state SET processing_state = ?, updated_at = ? WHERE capture_id = ?`,
        [cmd.value, new Date().toISOString(), cmd.capture_id]
      );
      say(`local processing_state=${cmd.value} (expect server refusal)`);
      break;
    // ---- capture durability suite (docs/CAPTURE-DURABILITY-ARCH-v1-CODEX.md)
    case 'arm_failpoint':
      // Spec §5: arm BEFORE the capture. The failpoint parks the capture thread
      // and publishes {trialNonce, captureId, boundary}; the harness kills only
      // after observing that exact tuple.
      failpoint.armed = (cmd.boundary as Boundary) ?? null;
      failpoint.trialNonce = cmd.trialNonce ?? null;
      failpoint.reached = null;
      failpoint.parked = false;
      say(`armed ${failpoint.armed} nonce=${failpoint.trialNonce}`);
      break;

    case 'do_capture': {
      // Deterministic fixture bytes so the harness can hash them independently.
      const size = cmd.size ?? 4096;
      const seed = cmd.fixtureSeed ?? 'fixture';
      const bytes = new Uint8Array(size);
      let h = 2166136261 >>> 0;
      for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
      for (let i = 0; i < size; i++) { h ^= i; h = Math.imul(h, 16777619) >>> 0; bytes[i] = h & 0xff; }
      const r = await performCapture(db, {
        ownerId: cmd.ownerId ?? 'owner', projectId: cmd.projectId ?? 'proj-bakeoff-1',
        payloadBytes: bytes, mimeType: 'application/octet-stream',
        trialNonce: cmd.trialNonce ?? null,
      });
      say(r.ok ? `capture ok ${r.captureId}` : `capture refused: ${r.reason}`);
      LAST_CAPTURE = r;
      break;
    }

    case 'export_capture': {
      const dest = FS.documentDirectory + `export-${cmd.capture_id}.bin`;
      const r = await exportCapture(db, cmd.capture_id, dest);
      LAST_EXPORT = r;
      say(`export ${cmd.capture_id}: ${r.ok ? `ok ${r.length}B` : r.reason}`);
      break;
    }

    default:
      say(`unknown action ${cmd.action}`);
  }
}

const styles = StyleSheet.create({
  c: { flex: 1, paddingTop: 60, paddingHorizontal: 12, backgroundColor: '#0b0b0c' },
  h: { color: '#7ee787', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  l: { color: '#c9d1d9', fontFamily: 'Menlo', fontSize: 10, marginBottom: 2 },
});
