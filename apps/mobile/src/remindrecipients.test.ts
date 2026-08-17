/**
 * Who a reminder is texted to.
 *   cd apps/mobile && node --test src/remindrecipients.test.ts
 *
 * Against a REAL SQLite database, because every guarantee here is in the SQL: a join
 * that stopped matching, or a de-dup that stopped firing, would both pass a mocked test
 * and then text a client twice — or text nobody — on a phone.
 *
 * hadar, 2026-08-14: "a reminder is the act of resending the same CO to the same people
 * again." The failure this file exists to prevent is the app deciding "the same people"
 * means somebody else: an inspector who never got the original link, or a homeowner who
 * was replaced when the extra was revised.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { APPROVER_DDL } from './approverddl.ts';
import { EXTRA_ACTOR_DDL } from './recordactors.ts';
import { reachable, remindTargets } from './remindrecipients.ts';

const T0 = 1_760_000_000_000;
const HOUR = 3_600_000;

function freshDb() {
  const raw = new DatabaseSync(':memory:');
  for (const stmt of [...APPROVER_DDL, ...EXTRA_ACTOR_DDL]) raw.exec(stmt);
  return {
    raw,
    getAll: async (sql: string, args: any[] = []) => raw.prepare(sql).all(...args) as any[],
  } as any;
}

function addPerson(db: any, o: {
  id: string; name: string; phone?: string | null; project?: string; status?: string;
}) {
  db.raw.prepare(
    `INSERT INTO project_approver (id, project_id, name, role, phone_e164, status,
                                   created_at_ms)
     VALUES (?,?,?,'owner',?,?,?)`
  ).run(o.id, o.project ?? 'p1', o.name, o.phone ?? null, o.status ?? 'active', T0);
}

function addAsked(db: any, o: {
  id: string; coId: string; name: string; approverId: string | null; atMs?: number;
}) {
  db.raw.prepare(
    `INSERT INTO extra_actor (id, subject_kind, subject_id, act, name, approver_id,
                              at_ms, created_at_ms)
     VALUES (?, 'change_order', ?, 'approver', ?, ?, ?, ?)`
  ).run(o.id, o.coId, o.name, o.approverId, o.atMs ?? T0, o.atMs ?? T0);
}

/* --------------------------------------------------------------- the people -- */

test('the person the extra was sent to is the person reminded', async () => {
  const db = freshDb();
  addPerson(db, { id: 'ap1', name: 'Sarah Miller', phone: '+14155550101' });
  addAsked(db, { id: 'a1', coId: 'co1', name: 'Sarah Miller', approverId: 'ap1' });

  const t = await remindTargets(db, 'co1');
  assert.equal(t.length, 1);
  assert.equal(t[0].name, 'Sarah Miller');
  assert.equal(t[0].phone, '+14155550101');
  assert.equal(t[0].isApprover, true);
});

test('somebody on the JOB who was never sent this extra is not texted', async () => {
  const db = freshDb();
  addPerson(db, { id: 'ap1', name: 'Sarah Miller', phone: '+14155550101' });
  // On the same project, with a number, and completely uninvolved in this extra.
  addPerson(db, { id: 'ap2', name: 'City Inspector', phone: '+14155550202' });
  addAsked(db, { id: 'a1', coId: 'co1', name: 'Sarah Miller', approverId: 'ap1' });

  const t = await remindTargets(db, 'co1');
  // The whole point: a roster is not a recipient list. Texting an inspector a
  // homeowner's price is worse than sending no reminder at all.
  assert.deepEqual(t.map((x) => x.name), ['Sarah Miller']);
});

test('another extra\'s recipient is not borrowed', async () => {
  const db = freshDb();
  addPerson(db, { id: 'ap1', name: 'Sarah Miller', phone: '+14155550101' });
  addPerson(db, { id: 'ap2', name: 'Dave Kern', phone: '+14155550202' });
  addAsked(db, { id: 'a1', coId: 'co1', name: 'Sarah Miller', approverId: 'ap1' });
  addAsked(db, { id: 'a2', coId: 'co2', name: 'Dave Kern', approverId: 'ap2' });

  assert.deepEqual((await remindTargets(db, 'co1')).map((x) => x.name), ['Sarah Miller']);
  assert.deepEqual((await remindTargets(db, 'co2')).map((x) => x.name), ['Dave Kern']);
});

/* ------------------------------------------------------------------ dedupe -- */

test('a revised-and-resent extra texts its client ONCE, not once per send', async () => {
  const db = freshDb();
  addPerson(db, { id: 'ap1', name: 'Sarah Miller', phone: '+14155550101' });
  addAsked(db, { id: 'a1', coId: 'co1', name: 'Sarah Miller', approverId: 'ap1', atMs: T0 });
  addAsked(db, { id: 'a2', coId: 'co1', name: 'Sarah Miller', approverId: 'ap1',
                 atMs: T0 + HOUR });

  const t = await remindTargets(db, 'co1');
  assert.equal(t.length, 1, 'one human, one text');
});

test('the same human through two roster rows is still one recipient', async () => {
  const db = freshDb();
  // One person legitimately has one row per job (approvers.ts). Two sends can name
  // her through different rows, and id-matching alone would text her twice.
  addPerson(db, { id: 'ap1', name: 'Sarah Miller', phone: '+14155550101', project: 'p1' });
  addPerson(db, { id: 'ap2', name: 'sarah  miller', phone: '+14155550101', project: 'p2' });
  addAsked(db, { id: 'a1', coId: 'co1', name: 'Sarah Miller', approverId: 'ap1', atMs: T0 });
  addAsked(db, { id: 'a2', coId: 'co1', name: 'sarah  miller', approverId: 'ap2',
                 atMs: T0 + HOUR });

  assert.equal((await remindTargets(db, 'co1')).length, 1);
});

/* --------------------------------------------------------------- reachable -- */

test('a recipient with no number is RETURNED, not dropped', async () => {
  const db = freshDb();
  addPerson(db, { id: 'ap1', name: 'Sarah Miller', phone: null });
  addAsked(db, { id: 'a1', coId: 'co1', name: 'Sarah Miller', approverId: 'ap1' });

  const t = await remindTargets(db, 'co1');
  // "Nobody was asked" and "one person, no number on file" are different facts, and
  // only the second one has a fix the contractor can act on.
  assert.equal(t.length, 1);
  assert.equal(t[0].phone, null);
  assert.equal(reachable(t).length, 0);
});

test('a blank number is not a number', async () => {
  const db = freshDb();
  addPerson(db, { id: 'ap1', name: 'Sarah Miller', phone: '   ' });
  addAsked(db, { id: 'a1', coId: 'co1', name: 'Sarah Miller', approverId: 'ap1' });
  assert.equal(reachable(await remindTargets(db, 'co1')).length, 0);
});

test('a RETIRED roster row is still reminded — they hold the live link', async () => {
  const db = freshDb();
  addPerson(db, { id: 'ap1', name: 'Sarah Miller', phone: '+14155550101',
                  status: 'removed' });
  addAsked(db, { id: 'a1', coId: 'co1', name: 'Sarah Miller', approverId: 'ap1' });

  const t = await remindTargets(db, 'co1');
  /**
   * THE REGRESSION THIS PINS (hadar, 2026-08-15). The first cut of this query joined
   * `AND pa.status = 'active'`, which read as prudent and was wrong: change order #18
   * had been sent to a client whose roster row was later retired, so the phone came
   * back NULL, nobody was reachable, and Remind silently opened the share sheet for a
   * person holding a live signing link.
   *
   * Retiring somebody stops them being SUGGESTED for new extras. It cannot un-send the
   * one they already have. The remedy for the wrong recipient is Revise & Resend, which
   * retires the instrument itself.
   */
  assert.equal(t[0].name, 'Sarah Miller');
  assert.equal(t[0].phone, '+14155550101');
  assert.equal(reachable(t).length, 1);
});

test('an extra nobody was asked about has no recipients', async () => {
  const db = freshDb();
  assert.deepEqual(await remindTargets(db, 'co1'), []);
});

test('an actor row with no roster link still names the person', async () => {
  const db = freshDb();
  // `who_directed` typed into the composer: a real recipient with no roster row, so
  // there is a name and no way to text it. Dropping the row would report "nobody was
  // asked", which is false.
  addAsked(db, { id: 'a1', coId: 'co1', name: 'Hadar Wissotzky', approverId: null });
  const t = await remindTargets(db, 'co1');
  assert.equal(t[0].name, 'Hadar Wissotzky');
  assert.equal(t[0].phone, null);
});
