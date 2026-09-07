/**
 * THE CONSOLE'S COPIES OF THE SHARED RULES MUST BE THE MOBILE APP'S COPIES.
 *
 * WHY VENDORED AND NOT IMPORTED. The obvious thing is `import { displayStatus } from
 * '../../../mobile/src/extrastatus.ts'`, and it would work locally and break the
 * deploy: this app builds with `rootDir: apps/console` on Render, so nothing above
 * that directory exists at build time. `apps/worker` hit this first and its `money.ts`
 * header says so out loud — "IT IS VENDORED, NOT IMPORTED, BY THE WORKER … a relative
 * import across apps would break the DEPLOY rather than fail a test."
 *
 * So the copy is deliberate, and this file is the price of it. It reads both files off
 * disk and compares them byte for byte. The one thing that must never happen is the
 * console saying "Sent" about a change order the phone calls "Discussing" — a status
 * that means two things is exactly the confusion `extracard.tsx` was written to end,
 * and a second implementation is how it comes back.
 *
 * WHEN THIS FAILS, DO NOT EDIT THE COPY BY HAND. Re-copy the mobile file:
 *
 *   cp apps/mobile/src/extrastatus.ts apps/console/src/shared/extrastatus.ts
 *
 * and read what changed before shipping — a status rule moving is a product decision,
 * not a merge conflict.
 *
 * Run: cd apps/console && npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { displayStatus, isAwaiting, STORED_STATUSES } from './extrastatus.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const MOBILE = join(HERE, '../../../mobile/src');

/** Every file this app vendors, and where it came from. */
const VENDORED = ['extrastatus.ts', 'money.ts'];

test('the vendored files are byte-for-byte the mobile app files', () => {
  for (const name of VENDORED) {
    const upstream = join(MOBILE, name);

    // A missing upstream is INCONCLUSIVE dressed as a pass if we skip it, and this
    // repo's verify.mjs is explicit that a check which inspected nothing must never
    // report a pass. Fail loudly instead: either the mobile file moved (and this list
    // is stale) or the checkout is partial (and the comparison proved nothing).
    assert.ok(
      existsSync(upstream),
      `cannot compare ${name}: ${upstream} does not exist. The mobile file moved, or `
        + 'this is a partial checkout — either way nothing was verified.',
    );

    assert.equal(
      readFileSync(join(HERE, name), 'utf8'),
      readFileSync(upstream, 'utf8'),
      `${name} has drifted from apps/mobile/src/${name}. Re-copy it; do not hand-edit.`,
    );
  }
});

/**
 * A handful of behavioural anchors, so a copy that is byte-identical to a mobile file
 * somebody broke still gets caught here. These are the three the console's own screens
 * depend on and would silently misdraw.
 */
test('a terminal answer outranks an open question', () => {
  // The console's queue counts "the client is waiting on you" off `discussing`. If a
  // signed approval ever rendered as discussing, that queue would nag forever about a
  // change order that is settled and billable.
  assert.equal(displayStatus('approved', { openQuestions: 2 }), 'approved');
  assert.equal(displayStatus('declined', { openQuestions: 1 }), 'declined');
});

test('an open question on a live row is the contractor s turn', () => {
  assert.equal(displayStatus('sent', { openQuestions: 1 }), 'discussing');
  assert.equal(displayStatus('sent', { openQuestions: 0 }), 'sent');
});

test('discussing still counts as money awaiting an answer', () => {
  // The job header's "Out for approval" total sums these. Dropping a discussing row
  // would make the figure fall the moment a client asked a question.
  assert.equal(isAwaiting('discussing'), true);
  assert.equal(isAwaiting('sent'), true);
  assert.equal(isAwaiting('approved'), false);
});

test('the console knows every status the database can store', () => {
  // The console renders a chip per stored status. A status added to the database and
  // not here would fall through to the 'draft' label — telling a manager a withdrawn
  // change order is an editable draft.
  assert.deepEqual(
    [...STORED_STATUSES].sort(),
    ['approved', 'cancelled', 'declined', 'draft', 'sent', 'superseded'],
  );
});
