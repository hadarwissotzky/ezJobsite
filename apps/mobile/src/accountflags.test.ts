/**
 * Rebuilding "have I seen this before" from the account.
 *   cd apps/mobile && node --test src/accountflags.test.ts
 *
 * Both errors here are bad and only one of them is loud:
 *   - too timid → an established contractor is walked through setup and the guided
 *     first change order after a reinstall (hadar, 2026-08-21). Visible, insulting,
 *     and it reads as "the app lost my work".
 *   - too eager → a genuinely new user is marked as onboarded and never gets setup,
 *     so they have no profile and no idea what the app is. Silent.
 *
 * The second is why nothing here may infer from an ABSENCE. These tests pin that:
 * only positive evidence moves a flag.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { restoreAccountFlags } from './accountflags.ts';

/* ----------------------------------------------------------------- fakes -- */

/** A device_settings key/value store plus the two content tables the probe reads. */
function fakeDb(o: { settings?: Record<string, string>; changeOrders?: number; projects?: string[] } = {}) {
  const settings: Record<string, string> = { ...(o.settings ?? {}) };
  const cos = o.changeOrders ?? 0;
  const projects = o.projects ?? [];
  return {
    settings,
    db: {
      getAll: async (sql: string, args: any[] = []) => {
        if (/FROM device_settings/.test(sql)) {
          const v = settings[args[0]];
          return v === undefined ? [] : [{ v }];
        }
        if (/FROM change_order/.test(sql)) {
          return cos > 0 ? [{ id: 'co-1' }] : [];
        }
        if (/FROM project/.test(sql)) {
          return projects.filter((p) => p !== args[0]).map((id) => ({ id }));
        }
        throw new Error('unexpected query: ' + sql);
      },
      execute: async (sql: string, args: any[] = []) => {
        const ins = /INSERT INTO device_settings \(k, v\) VALUES \(\?, '?(yes)?'?\)?/.test(sql);
        if (ins) {
          // Both shapes appear: `VALUES (?, ?)` and `VALUES (?, 'yes')`.
          settings[args[0]] = args.length > 1 ? String(args[1]) : 'yes';
          return;
        }
        throw new Error('unexpected write: ' + sql);
      },
    } as any,
  };
}

/** PostgREST-shaped responses, including the failure case that must NOT be read as "no". */
function fakeSupabase(o: { changeOrders?: number; projects?: number; fail?: boolean } = {}) {
  let calls = 0;
  const table = (n: number) => ({
    select: () => ({
      limit: async () => o.fail
        ? { data: null, error: { message: 'offline' } }
        : { data: Array.from({ length: n }, (_, i) => ({ id: `x${i}` })), error: null },
      neq: () => ({
        limit: async () => o.fail
          ? { data: null, error: { message: 'offline' } }
          : { data: Array.from({ length: n }, (_, i) => ({ id: `x${i}` })), error: null },
      }),
    }),
  });
  return {
    calls: () => calls,
    client: {
      from: (t: string) => {
        calls += 1;
        return table(t === 'change_order' ? (o.changeOrders ?? 0) : (o.projects ?? 0));
      },
    } as any,
  };
}

const NEW_USER = { user_metadata: {} } as any;
const RETURNING = {
  user_metadata: {
    full_name: 'Ray Kowalski', is_solo: false, company_name: 'Kowalski Bros',
    trade: 'remodeling', lang: 'es',
  },
} as any;

/* ------------------------------------------------------------- the profile -- */

test('a reinstalled contractor keeps his profile — no setup flow', async () => {
  // The whole complaint. `saveProfile` has always mirrored this to the account so it
  // "follows the account across devices"; nothing ever read it back.
  const { settings, db } = fakeDb();
  const sb = fakeSupabase();

  const r = await restoreAccountFlags(db, sb.client, RETURNING);

  assert.equal(r.profile, true);
  assert.equal(settings.profile_done, 'yes');
  assert.equal(settings.profile_name, 'Ray Kowalski');
  assert.equal(settings.profile_is_solo, 'no');
  assert.equal(settings.profile_company, 'Kowalski Bros');
});

test('the display language comes back with the profile', async () => {
  // Otherwise a Spanish-speaking contractor reinstalls into an English app and has to
  // find the toggle in a language he does not read.
  const { settings, db } = fakeDb();
  await restoreAccountFlags(db, fakeSupabase().client, RETURNING);
  assert.equal(settings.preferred_language, 'es');
});

test('an account with no name is left alone — setup runs, correctly', async () => {
  // Supabase populates `user_metadata` on its own, so metadata EXISTING proves
  // nothing. A name proves somebody completed setup.
  const { settings, db } = fakeDb();
  const r = await restoreAccountFlags(db, fakeSupabase().client, NEW_USER);
  assert.equal(r.profile, false);
  assert.equal(settings.profile_done, undefined);
});

test('a device that already has a profile is not overwritten', async () => {
  const { settings, db } = fakeDb({ settings: { profile_done: 'yes', profile_name: 'Local' } });
  await restoreAccountFlags(db, fakeSupabase().client, RETURNING);
  assert.equal(settings.profile_name, 'Local', 'the local cache is the source of truth for the UI');
});

/* ------------------------------------------------------------- the content -- */

test('an account with change orders never sees the guided first extra', async () => {
  const { settings, db } = fakeDb();
  const r = await restoreAccountFlags(db, fakeSupabase({ changeOrders: 1 }).client, RETURNING);
  assert.equal(r.content, true);
  assert.equal(settings.first_run_done, 'yes');
  // BOTH, together: marking only first_run_done would skip setup and then still open
  // the walkthrough over an account with sixty extras.
  assert.equal(settings.first_extra_seen, 'yes');
});

test('an account with a real job counts, even with no change orders yet', async () => {
  const { settings, db } = fakeDb();
  const r = await restoreAccountFlags(db, fakeSupabase({ changeOrders: 0, projects: 1 }).client, RETURNING);
  assert.equal(r.content, true);
  assert.equal(settings.first_extra_seen, 'yes');
});

test('a genuinely new account is NOT marked onboarded', async () => {
  // The silent failure. Marking here would leave a real new user with no profile and
  // no walkthrough, and nothing would ever ask again.
  const { settings, db } = fakeDb();
  const r = await restoreAccountFlags(db, fakeSupabase({ changeOrders: 0, projects: 0 }).client, NEW_USER);
  assert.equal(r.content, false);
  assert.equal(settings.first_run_done, undefined);
  assert.equal(settings.first_extra_seen, undefined);
});

test('a failed query is not read as "no content"', async () => {
  // "Nothing came back" from a dead network and "this account is new" are the same
  // shape. Only the second may move a flag.
  const { settings, db } = fakeDb();
  const r = await restoreAccountFlags(db, fakeSupabase({ fail: true }).client, NEW_USER);
  assert.equal(r.content, false);
  assert.equal(r.offline, true, 'the caller must be able to tell "no" from "could not ask"');
  assert.equal(settings.first_run_done, undefined);
});

test('the profile still restores with no signal at all', async () => {
  // `user_metadata` rides inside the token. This is the reinstall-in-a-basement case,
  // and it is the reason the profile half does not depend on the probe.
  const { settings, db } = fakeDb();
  const r = await restoreAccountFlags(db, fakeSupabase({ fail: true }).client, RETURNING);
  assert.equal(r.profile, true);
  assert.equal(settings.profile_done, 'yes');
});

/* -------------------------------------------------- the mandate-#7 guard -- */

test('a device that already holds content never asks the server', async () => {
  // A network round-trip sits in front of `setSession`, so it must not happen on the
  // ordinary cold start — that is the 30-second-splash regression, re-run.
  const { settings, db } = fakeDb({ changeOrders: 1 });
  const sb = fakeSupabase({ changeOrders: 1 });

  const r = await restoreAccountFlags(db, sb.client, RETURNING);

  assert.equal(r.content, true);
  assert.equal(r.offline, false);
  assert.equal(sb.calls(), 0, 'the local answer settled it — no probe');
  assert.equal(settings.first_extra_seen, 'yes');
});

test('the local inbox alone does not count as content', async () => {
  // `ensureProjectSchema` creates the inbox for every user on every device before
  // anything else happens. Counting it would mean nobody ever sees the guided start.
  const { db } = fakeDb({ projects: ['inbox'] });
  const sb = fakeSupabase({ changeOrders: 0, projects: 0 });
  const r = await restoreAccountFlags(db, sb.client, NEW_USER);
  assert.equal(r.content, false);
  assert.ok(sb.calls() > 0, 'an inbox-only device still has to ask the server');
});
