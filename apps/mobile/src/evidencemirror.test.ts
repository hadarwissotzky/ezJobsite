/**
 * Pulling the evidence behind an extra onto a device that did not capture it.
 *   cd apps/mobile && node --test src/evidencemirror.test.ts
 *
 * The failure this guards against is not a crash — it is a screen that renders
 * perfectly while showing nothing, which is what hadar saw on 2026-08-21. So the
 * cases below are about what gets WRITTEN and, just as much, what must not be:
 * `capture_commit` is the local-durability record and a pulled capture has no
 * business in it.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { extOf, hydrateEvidence, mirrorRelpath } from './evidencemirror.ts';

/* ----------------------------------------------------------------- fakes -- */

type Row = Record<string, any>;

function fakeDb(o: { ownCaptures?: string[] } = {}) {
  const writes: Array<{ table: string; args: any[] }> = [];
  const own = o.ownCaptures ?? [];
  return {
    writes,
    rowsFor: (t: string) => writes.filter((w) => w.table === t),
    db: {
      getAll: async (sql: string) => {
        if (/FROM capture_commit/.test(sql)) return own.map((capture_id) => ({ capture_id }));
        return [];
      },
      execute: async (sql: string, args: any[] = []) => {
        const m = /INSERT OR IGNORE INTO (\w+)/.exec(sql);
        if (!m) return { rowsAffected: 0 };
        writes.push({ table: m[1], args });
        return { rowsAffected: 1 };
      },
    } as any,
  };
}

/** PostgREST-shaped, one canned response per table. */
function fakeSupabase(tables: Record<string, Row[] | { error: string }>) {
  const asked: string[] = [];
  const build = (t: string) => {
    const v = tables[t];
    const res = async () => (Array.isArray(v) || v === undefined)
      ? { data: (v ?? []) as Row[], error: null }
      : { data: null, error: { message: (v as any).error } };
    // `.eq(...)` and `.in(...)` are both terminal here — awaiting the builder is what
    // supabase-js does, and the code under test awaits after one of them.
    const chain: any = { eq: () => res(), in: () => res(), then: undefined };
    return { select: () => { asked.push(t); return chain; } };
  };
  return { asked, client: { from: (t: string) => build(t) } as any };
}

const DECISION = {
  id: 'dec-1', project_id: 'p-1', subject: 'Extra outlets',
  scope_level: 'project', assignee: null, created_at_ms: 1_700_000_000_000,
};
const VERSION = {
  id: 'dv-1', decision_id: 'dec-1', value: 'four outlets',
  capture_id: 'cap-1', directed_by: 'Ray', created_at_ms: 1_700_000_000_000,
};
const CAPTURE = {
  id: 'cap-1', project_id: 'p-1', owner_id: 'u-1',
  payload: 'u-1/cap-1/abc123.jpg', payload_sha256: 'abc123',
  modality: 'photo', client_created_at: '2026-08-19T10:00:00Z',
  gps_lat: 37.77, gps_lng: -122.45,
};

/* ------------------------------------------------------------- the paths -- */

test('the object key decides the cached file extension', () => {
  // Storage is the ONLY place the mime survives — the ingest RPC accepts p_media_mime
  // and has no column to put it in (sql/060). Getting this wrong writes a ".bin" that
  // no image view will render, which is the bug uploader.ts already hit once.
  assert.equal(extOf('u-1/cap-1/abc.jpg'), 'jpg');
  assert.equal(extOf('u-1/cap-1/abc.HEIC'), 'heic');
  assert.equal(extOf('u-1/cap-1/abc'), 'bin');
});

test('a cached path is scoped by capture and digest', () => {
  const rel = mirrorRelpath('cap-1', 'u-1/cap-1/abc123.jpg', 'abc123');
  assert.equal(rel, 'capture-remote/cap-1/abc123.jpg');
  assert.ok(rel.startsWith('capture-remote/'),
    'never capture-media/ — recoverySweep walks that directory and these are not its evidence');
});

/* ------------------------------------------------------------- the pull -- */

test('the whole chain lands: decision, version, capture', async () => {
  const { db, rowsFor } = fakeDb();
  const sb = fakeSupabase({
    decision: [DECISION], decision_version: [VERSION],
    capture: [CAPTURE], attachment: [{ capture_id: 'cap-1', ciphertext_len: 91234 }],
  });

  const r = await hydrateEvidence(db, sb.client, 'p-1', 'u-1');

  assert.deepEqual(r, { decisions: 1, versions: 1, captures: 1, offline: false });
  assert.equal(rowsFor('decision').length, 1);
  assert.equal(rowsFor('decision_version').length, 1);
  assert.equal(rowsFor('capture_mirror').length, 1);
});

test('a pulled capture NEVER lands in capture_commit', async () => {
  // The single most important assertion in this file. `capture_commit` means "this
  // device durably holds these bytes" — mandate #1 rests on it, and record.ts reads a
  // row without its file as EVIDENCE THAT HAS BEEN LOST. A pulled capture would make
  // the app cry lost-evidence over a photo sitting safely in Storage.
  const { db, rowsFor } = fakeDb();
  const sb = fakeSupabase({
    decision: [DECISION], decision_version: [VERSION], capture: [CAPTURE], attachment: [],
  });

  await hydrateEvidence(db, sb.client, 'p-1', 'u-1');

  assert.equal(rowsFor('capture_commit').length, 0);
});

test('a mirrored capture starts with NO local path', async () => {
  // Null relpath is the difference between "not downloaded yet" and "lost", and it is
  // the reason the mirror is a separate table. The photo queries filter on it.
  const { db, rowsFor } = fakeDb();
  const sb = fakeSupabase({
    decision: [DECISION], decision_version: [VERSION], capture: [CAPTURE], attachment: [],
  });

  await hydrateEvidence(db, sb.client, 'p-1', 'u-1');

  const args = rowsFor('capture_mirror')[0].args;
  assert.equal(args[3], 'u-1/cap-1/abc123.jpg', 'the object key is stored verbatim');
  assert.equal(args[4], 'abc123');
  assert.equal(args[5], null, 'no attachment row -> null bytes, never a fabricated size');
});

test("captures this device took itself are not mirrored", async () => {
  // capture_commit holds the real bytes and is the better record. Two rows for one
  // photo would double it everywhere the queries UNION them.
  const { db, rowsFor } = fakeDb({ ownCaptures: ['cap-1'] });
  const sb = fakeSupabase({
    decision: [DECISION], decision_version: [VERSION], capture: [CAPTURE], attachment: [],
  });

  const r = await hydrateEvidence(db, sb.client, 'p-1', 'u-1');

  assert.equal(r.captures, 0);
  assert.equal(rowsFor('capture_mirror').length, 0);
});

test('a capture with no object key is skipped, not stored half-formed', async () => {
  const { db, rowsFor } = fakeDb();
  const sb = fakeSupabase({
    decision: [DECISION], decision_version: [VERSION],
    capture: [{ ...CAPTURE, payload: null }], attachment: [],
  });

  const r = await hydrateEvidence(db, sb.client, 'p-1', 'u-1');

  assert.equal(r.captures, 0);
  assert.equal(rowsFor('capture_mirror').length, 0,
    'a mirror row with no key can only ever fail to download');
});

test('a refused decision pull reports offline and writes nothing', async () => {
  // Offline is the NORMAL case (mandate #7). It must be distinguishable from "this
  // project genuinely has no decisions", or the caller cannot tell a dead network
  // from an empty job.
  const { db, writes } = fakeDb();
  const sb = fakeSupabase({ decision: { error: 'network' } });

  const r = await hydrateEvidence(db, sb.client, 'p-1', 'u-1');

  assert.equal(r.offline, true);
  assert.equal(writes.length, 0);
});

test('a project with decisions but no versions is not an error', async () => {
  const { db } = fakeDb();
  const sb = fakeSupabase({ decision: [DECISION], decision_version: [] });
  const r = await hydrateEvidence(db, sb.client, 'p-1', 'u-1');
  assert.deepEqual(r, { decisions: 1, versions: 0, captures: 0, offline: false });
});

test('versions with no capture skip the capture query entirely', async () => {
  const { db } = fakeDb();
  const sb = fakeSupabase({
    decision: [DECISION], decision_version: [{ ...VERSION, capture_id: null }],
  });

  const r = await hydrateEvidence(db, sb.client, 'p-1', 'u-1');

  assert.equal(r.captures, 0);
  assert.ok(!sb.asked.includes('capture'), 'no capture ids -> no round trip');
});

test('the version pull happens after the decision pull', async () => {
  // decision_version.decision_id REFERENCES decision(id). Versions first would be
  // rejected row by row, and the FK error is not obviously an ordering problem.
  const { db } = fakeDb();
  const sb = fakeSupabase({
    decision: [DECISION], decision_version: [VERSION], capture: [CAPTURE], attachment: [],
  });

  await hydrateEvidence(db, sb.client, 'p-1', 'u-1');

  assert.ok(sb.asked.indexOf('decision') < sb.asked.indexOf('decision_version'));
});
