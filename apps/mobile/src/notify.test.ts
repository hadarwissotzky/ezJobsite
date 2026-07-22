import assert from 'node:assert/strict';
import test from 'node:test';
import { approvalNotificationFor, planNotifications } from './notify.ts';
import { parseThreadLink } from './discussion.ts';
import { t } from './i18n.ts';

const Q = { id: 'm1', changeOrderId: 'co-1', scope: 'Subfloor rot repair',
            body: 'Can you do it Thursday?' };
const A = { id: 'co-2', scope: 'Vanity height', amount: '$1,850.00',
            signedBy: 'Sarah Miller' };

test('a question fires and its id comes back to be stamped', () => {
  const p = planNotifications({ permission: 'granted', questions: [Q], approvals: [] });
  assert.equal(p.blocked, null);
  assert.equal(p.present.length, 1);
  assert.equal(p.present[0].body, 'Can you do it Thursday?');
  assert.deepEqual(p.ids.questions, ['m1']);
});

// The rule markNotified's comment states: stamping something we never showed
// loses it forever. Permission is the case where the OS accepts the schedule
// and shows nothing, so it is the case that would lose it silently.
test('no permission means nothing is presented AND nothing is stamped', () => {
  for (const permission of ['undetermined', 'denied']) {
    const p = planNotifications({ permission, questions: [Q], approvals: [A] });
    assert.equal(p.blocked, 'permission', permission);
    assert.deepEqual(p.present, [], permission);
    assert.deepEqual(p.ids.questions, [], permission);
    assert.deepEqual(p.ids.approvals, [], permission);
  }
});

test('questions outrank approvals, matching the bell', () => {
  const p = planNotifications({ permission: 'granted', questions: [Q], approvals: [A] });
  assert.equal(p.present.length, 2);
  assert.equal(t(p.present[0].title), 'Question about Subfloor rot repair');
  assert.equal(t(p.present[1].title), 'Approved: Vanity height');
});

test('the green light carries the bound figure and the signer', () => {
  const n = approvalNotificationFor({ changeOrderId: 'co-2', ...A });
  assert.equal(n.body, '$1,850.00 — Sarah Miller');
});

test('an unsigned approval does not invent a name', () => {
  const n = approvalNotificationFor({ changeOrderId: 'co-2', ...A, signedBy: null });
  assert.equal(n.body, '$1,850.00');
});

// The tap has to land somewhere real. A link the app cannot parse is a
// notification that opens the app to whatever was last on screen.
test('both notifications deep-link to a parseable thread', () => {
  const p = planNotifications({ permission: 'granted', questions: [Q], approvals: [A] });
  assert.deepEqual(parseThreadLink(p.present[0].link),
    { changeOrderId: 'co-1', focusReply: true });
  assert.deepEqual(parseThreadLink(p.present[1].link),
    { changeOrderId: 'co-2', focusReply: false });
});

test('both languages have the green-light wording', () => {
  const n = approvalNotificationFor({ changeOrderId: 'co-2', ...A });
  assert.equal(t(n.title, 'es'), 'Aprobado: Vanity height');
});
