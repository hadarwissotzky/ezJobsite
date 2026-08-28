import {
  AbstractPowerSyncDatabase,
  PowerSyncBackendConnector,
  UpdateType,
} from '@powersync/react-native';
import { createClient, SupabaseClient, type Session } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { forgetPushToken } from './push.ts';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
const POWERSYNC_URL = process.env.EXPO_PUBLIC_POWERSYNC_URL!;

// Postgres error codes that mean "this write will NEVER succeed". Returning
// without throwing DISCARDS the operation and unblocks the queue. Throwing on
// these would stall the upload queue forever (the documented 4xx footgun).
/**
 * Errors a retry can NEVER fix. The payload is wrong, not the moment.
 *
 * The list matters more than it looks. PowerSync's contract is blunt: a 4xx from
 * uploadData blocks the upload queue PERMANENTLY, and tx.complete() must run or
 * the queue stalls forever. So any permanent error NOT in this set does not get
 * discarded -- it throws, complete() never runs, and EVERY LATER WRITE STOPS,
 * silently, while the app keeps saying "saved ✓".
 *
 * That is not hypothetical: 22P02 was missing, a project was written with the
 * placeholder owner 'owner-local' instead of a UUID, and the queue sat at 17 ops
 * and climbing. Jobs and consent stopped reaching the cloud with no error anywhere
 * a user could see.
 *
 * The DATA-ERROR class below is the fix, and the principle is: if a retry in an
 * hour would fail identically, discard it with evidence rather than wedge
 * everything behind it. One bad row must never take the queue down with it.
 */
const FATAL_PG_CODES = new Set([
  '42501', // insufficient_privilege  <- Q2: client write to a SERVER-owned column
  '23514', // check_violation
  '23503', // foreign_key_violation
  '23505', // unique_violation
  // --- data errors: the value itself is invalid and will be next time too ---
  '22P02', // invalid_text_representation  <- 'owner-local' into a uuid column
  '22001', // string_data_right_truncation
  '22003', // numeric_value_out_of_range
  '22007', // invalid_datetime_format
  '22008', // datetime_field_overflow
  '23502', // not_null_violation
  '42703', // undefined_column   <- client sending a field the server does not have
  '42P01', // undefined_table
  // PostgREST's OWN column-cache miss. When a client ships a column (e.g. project
  // .label from 377) before the migration is applied, PostgREST rejects with
  // PGRST204 and NEVER reaches Postgres, so the 42703 above is never surfaced. Left
  // out, PGRST204 falls through to `throw` and STALLS the whole upload queue
  // silently (review 2026-07-25, database lens). Discard-with-evidence instead.
  'PGRST204', // column not in PostgREST schema cache (client/server schema skew)
]);

/**
 * Columns the SERVER owns. The client may READ them (they are in AppSchema so they
 * sync down) but must never write them.
 *
 * Keep this in step with the GRANTs. The two together are one rule stated twice --
 * the grant is what actually enforces it; this is what stops us tripping over the
 * enforcement.
 */
const SERVER_OWNED: Record<string, string[]> = {
  project: ['status'],
};

function stripServerOwned(table: string, data: Record<string, any> | undefined) {
  if (!data) return data;
  const owned = SERVER_OWNED[table];
  if (!owned?.length) return data;
  const out = { ...data };
  for (const c of owned) delete out[c];
  return out;
}

/**
 * Rows PowerSync will never deliver, kept where a human can find them.
 *
 * Local-only and deliberately NOT synced: the whole point is that syncing is what
 * failed. Keyed by table:id so a retried-and-refused row does not pile up.
 */
export const REJECT_DDL = [
  `CREATE TABLE IF NOT EXISTS sync_rejected (
      row_key  TEXT NOT NULL PRIMARY KEY,
      tbl      TEXT NOT NULL,
      op       TEXT NOT NULL,
      row_id   TEXT NOT NULL,
      code     TEXT,
      message  TEXT,
      fields   TEXT,
      at_ms    INTEGER NOT NULL
   ) STRICT`,
];

export class SupabaseConnector implements PowerSyncBackendConnector {
  readonly client: SupabaseClient;
  /**
   * Q2 oracle: writes the DATABASE refused.
   *
   * Codex #9 HIGH: the old record carried no row id, field, or timestamp, so
   * "any 42501 during this app's lifetime" satisfied the assertion. Each entry
   * now identifies WHICH row and WHICH fields were refused and WHEN, so the
   * harness can baseline the list and require a NEW, MATCHING rejection.
   */
  readonly rejected: Array<{
    table: string;
    op: string;
    rowId: string;
    fields: string[];
    code?: string;
    message: string;
    at: string;
  }> = [];

  constructor() {
    this.client = createClient(SUPABASE_URL, SUPABASE_ANON, {
      auth: {
        // Persist the session across app restarts. Without a storage adapter,
        // supabase-js falls back to localStorage (undefined in React Native) and
        // the token is lost on every cold start -- so "valid token -> main screen"
        // could never work. AsyncStorage is the documented Expo/Supabase adapter.
        storage: AsyncStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  }

  /**
   * Sign in with Google or Apple, via the system browser rather than a native SDK.
   *
   * WHY THE BROWSER FLOW. The native SDK would mean another native module, a reversed
   * client id in Info.plist, and a rebuild every time that changes. This needs neither:
   * Supabase mints the consent URL, iOS opens it in an ASWebAuthenticationSession, and
   * the app's own scheme (`ezjobsite://`) catches the redirect. Fewer moving native
   * parts is worth a great deal in a project where every rebuild costs a cable.
   *
   * The caller supplies the opener so this file stays free of UI imports and remains
   * testable; `authscreen` passes expo-web-browser's session opener.
   */
  async signInWithOAuth(o: {
    provider: 'google' | 'apple';
    redirectTo: string;
    openAuth: (url: string, redirectTo: string) => Promise<{ type: string; url?: string }>;
  }): Promise<void> {
    const { data, error } = await this.client.auth.signInWithOAuth({
      provider: o.provider,
      options: { redirectTo: o.redirectTo, skipBrowserRedirect: true },
    });
    if (error) throw error;
    if (!data?.url) throw new Error('oauth_no_url');

    const res = await o.openAuth(data.url, o.redirectTo);
    // The user closed the sheet. NOT an error — say nothing and leave them where
    // they were, rather than showing a failure for a decision they made.
    if (res.type !== 'success' || !res.url) return;

    // Supabase returns either a PKCE `code` or a token fragment, depending on flow.
    const url = res.url;
    const code = /[?&]code=([^&]+)/.exec(url)?.[1];
    if (code) {
      const { error: e2 } = await this.client.auth.exchangeCodeForSession(decodeURIComponent(code));
      if (e2) throw e2;
      return;
    }
    const at = /[#&]access_token=([^&]+)/.exec(url)?.[1];
    const rt = /[#&]refresh_token=([^&]+)/.exec(url)?.[1];
    if (at && rt) {
      const { error: e3 } = await this.client.auth.setSession({
        access_token: decodeURIComponent(at), refresh_token: decodeURIComponent(rt),
      });
      if (e3) throw e3;
      return;
    }

    /**
     * NO CODE AND NO TOKEN — SO READ WHY, INSTEAD OF INVENTING A WORD FOR IT.
     *
     * hadar, 2026-08-27, on a Google sign-in: the screen said `oauth_no_session` and
     * nothing else. That string is ours, it means only "neither branch above matched",
     * and it was hiding the actual answer: when Supabase or the provider refuses, it
     * redirects back WITH `error`, `error_code` and `error_description` — in the query
     * on the PKCE flow and in the fragment on the implicit one — and this function read
     * past all of them to throw a name it made up.
     *
     * The commonest cause of landing here is a redirect URI that is not on the
     * project's allow-list; the description says so in words, and we were discarding
     * the one sentence that would have ended the guesswork.
     */
    const grab = (k: string) =>
      new RegExp(`[?#&]${k}=([^&]+)`).exec(url)?.[1];
    const code0 = grab('error_code');
    const desc = grab('error_description');
    const err = grab('error');

    // THE USER SAID NO. Google's own cancel comes back as `access_denied`, and it is
    // the same decision as closing the sheet — which the branch above already treats
    // as silence. Failing loudly here would scold somebody for changing their mind.
    if (err === 'access_denied') return;

    if (err || desc || code0) {
      const said = decodeURIComponent(desc ?? err ?? code0 ?? '').replace(/\+/g, ' ');
      throw new Error(said || String(err));
    }
    throw new Error('oauth_no_session');
  }

  /**
   * The session already on disk, WITHOUT a network round-trip.
   *
   * WHY THIS EXISTS (hadar 2026-08-04: "it takes 30 seconds ... until the home page is
   * displayed", already logged in). `getSession()` does not just read storage — with an
   * expired access token it REFRESHES over the network, and the app's auth gate renders
   * nothing until it resolves. On a weak jobsite connection that single call is the
   * whole cold start: everything local is ready and the user stares at a splash.
   *
   * That is mandate #7 inverted. The network is supposed to be opportunistic; here it
   * was a precondition to seeing your own data. This reads the persisted session
   * directly so a logged-in user is in immediately, and the refresh happens behind them.
   *
   * Returns null when there is nothing stored, which is the honest answer for a
   * logged-out device — it does NOT fabricate a session, and an expired token still
   * gets refreshed by supabase-js in the background before any request uses it.
   */
  async storedSession(): Promise<Session | null> {
    try {
      const key = `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`;
      const raw = await AsyncStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      // supabase-js has stored this under two shapes across versions; accept both
      // rather than silently returning null on the one we did not expect.
      const sess = parsed?.currentSession ?? parsed?.session ?? parsed;
      return sess?.access_token ? (sess as Session) : null;
    } catch {
      return null;   // unreadable/corrupt -> fall back to the network path
    }
  }

  /**
   * Email a sign-in LINK — no password anywhere in this app (hadar, 2026-08-03).
   *
   * `shouldCreateUser: true` makes this one call cover both sign-in and sign-up:
   * an unknown address gets an account, a known one gets a session. The user is
   * never asked to know which they are, which is the same reasoning as the phone
   * path (REQ-ID2).
   *
   * OPERATIONAL BOUNDARY, stated because it WILL bite: Supabase's built-in SMTP is
   * rate-limited to a handful of messages per hour. That is survivable for testing
   * and unusable as a production login path — custom SMTP (Resend/SendGrid) is
   * required before real users, or people will be locked out by a quota.
   */
  async sendEmailLink(email: string, redirectTo: string): Promise<void> {
    const { error } = await this.client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
    });
    if (error) throw error;
  }

  /**
   * Turn a redirect URL into a session. Used by BOTH the OAuth sheet and the
   * deep-link handler that catches an emailed link — one parser, because two would
   * be two places for the token formats to drift.
   *
   * Returns false when the URL carries no credentials at all (a stray deep link),
   * so callers can ignore it rather than surface a failure the user did not cause.
   */
  async sessionFromUrl(url: string): Promise<boolean> {
    const code = /[?&]code=([^&]+)/.exec(url)?.[1];
    if (code) {
      const { error } = await this.client.auth.exchangeCodeForSession(decodeURIComponent(code));
      if (error) throw error;
      return true;
    }
    const at = /[#&]access_token=([^&]+)/.exec(url)?.[1];
    const rt = /[#&]refresh_token=([^&]+)/.exec(url)?.[1];
    if (at && rt) {
      const { error } = await this.client.auth.setSession({
        access_token: decodeURIComponent(at), refresh_token: decodeURIComponent(rt),
      });
      if (error) throw error;
      return true;
    }
    return false;
  }

  /**
   * Send a 6-digit code by SMS. NO LONGER the way in — this now backs the
   * skippable phone-verification step, not login.
   *
   * THERE IS NO SEPARATE REGISTRATION (REQ-ID2). `signInWithOtp` creates the account
   * on first use and returns a session on every use after, so the user never has to
   * know whether they are signing up or signing in — a distinction that means nothing
   * to someone who does not think in software, and which the old two-mode screen made
   * them choose from before they had done anything.
   *
   * `phone` MUST already be E.164 (`toE164` in sendto.ts). This method does not parse:
   * the number has to be shown back to the user before a code is sent (REQ-ID4), which
   * means parsing has to happen where it can be displayed, not here.
   */
  async startPhoneAuth(phoneE164: string): Promise<void> {
    const { error } = await this.client.auth.signInWithOtp({ phone: phoneE164 });
    if (error) throw error;
  }

  /**
   * Exchange the code for a session. On success `onAuthStateChange` in App swaps the
   * screen — this returns nothing, so there is one source of truth for "logged in"
   * rather than two.
   */
  async verifyPhoneCode(phoneE164: string, code: string): Promise<void> {
    const { error } = await this.client.auth.verifyOtp({
      phone: phoneE164, token: code, type: 'sms',
    });
    if (error) throw error;
  }

  /**
   * THE TOKEN GOES BEFORE THE SESSION DOES, and that order is the whole point:
   * `push_token`'s RLS lets a user delete only their OWN row, so once `signOut()`
   * has run there is no longer anybody who is allowed to remove this handset's
   * registration. Doing it after would be doing it never — and the row left behind
   * keeps delivering this user's approvals and client questions to a phone that has
   * since been handed to somebody else. See `forgetPushToken` for the full argument.
   *
   * Awaited, not fired-and-forgotten, for the same reason: the session must still be
   * alive when the DELETE reaches PostgREST. It is best-effort internally, so a
   * basement sign-out is not blocked by it.
   */
  async signOut() {
    await forgetPushToken(this.client);
    await this.client.auth.signOut();
  }

  async fetchCredentials() {
    const { data, error } = await this.client.auth.getSession();
    if (error) throw error;
    if (!data.session) return null;
    return { endpoint: POWERSYNC_URL, token: data.session.access_token };
  }

  async uploadData(database: AbstractPowerSyncDatabase) {
    const tx = await database.getNextCrudTransaction();
    if (!tx) return;

    try {
      for (const op of tx.crud) {
        const table = this.client.from(op.table);
        // STRIP SERVER-OWNED COLUMNS BEFORE WRITING.
        //
        // PowerSync sends every local column, and an upsert UPDATES every column in
        // the payload. `project.status` is server-owned (predeclaration §2) and has
        // no UPDATE grant -- so including it made Postgres refuse the WHOLE
        // statement with 42501. Because 42501 is in the fatal set, the connector
        // then DISCARDED the row: the job existed on the phone, the app said saved,
        // and it never reached the cloud. No error, no queue backlog, nothing to
        // notice. That is the worst shape a bug can take here.
        //
        // Column-level grants alone cannot fix it: the client must not ATTEMPT the
        // write. Stripping is the fix; the grant is the belt.
        const data = stripServerOwned(op.table, op.opData);
        let result: any;

        // A PATCH that touched ONLY server-owned columns (e.g. a local status echo,
        // where status is stripped) has nothing left to send. Issuing `.update({})`
        // is a no-op whose PostgREST response is not in our fatal set — it would
        // `throw` and STALL the whole queue (review 2026-07-25). There is genuinely
        // nothing to upload, so drop the op cleanly.
        if (op.op === UpdateType.PATCH && (!data || Object.keys(data).length === 0)) {
          continue;
        }

        switch (op.op) {
          case UpdateType.PUT:
            result = await table.upsert({ ...data, id: op.id });
            break;
          case UpdateType.PATCH:
            result = await table.update(data ?? {}).eq('id', op.id);
            break;
          case UpdateType.DELETE:
            result = await table.delete().eq('id', op.id);
            break;
        }

        if (result?.error) {
          const code = result.error.code;
          if (FATAL_PG_CODES.has(code)) {
            // Permanent rejection. Record it as evidence and DISCARD, so the
            // queue keeps moving. This is exactly the Q2 "server-owned field"
            // enforcement firing: 42501 = the column-level UPDATE grant refused.
            //
            // NOTE (Codex #9): this proves the DATABASE refused the write in this
            // run — the error came back from PostgREST, not from us. But it also
            // means the discard POLICY is ours. PowerSync leaves asynchronous
            // validation and discard policy to the application; a Q2 pass must
            // not be read as "PowerSync supplies safe rejection handling."
            this.rejected.push({
              table: op.table,
              op: String(op.op),
              rowId: String(op.id),
              fields: Object.keys(op.opData ?? {}),
              code,
              message: result.error.message,
              at: new Date().toISOString(),
            });
            // DURABLE, AND VISIBLE. `this.rejected` is an in-memory array: it dies
            // with the process and no user ever sees it. That is how EVERY job
            // created on this device was discarded on 42501 while the app said
            // "saved ✓" -- silent, permanent loss with a clean queue and no error.
            //
            // A discard is the app deciding a row will NEVER reach the cloud. That
            // is exactly the fact mandate #1 says must never be silent. The owned
            // outboxes park-and-surface; ps_crud had no equivalent, so this is it.
            // Best-effort: a failure to record the failure must not also stall the
            // queue.
            try {
              await database.execute(
                `INSERT OR REPLACE INTO sync_rejected
                   (row_key, tbl, op, row_id, code, message, fields, at_ms)
                 VALUES (?,?,?,?,?,?,?,?)`,
                [`${op.table}:${op.id}`, op.table, String(op.op), String(op.id), code,
                 result.error.message, JSON.stringify(Object.keys(data ?? {})), Date.now()]
              );
            } catch { /* never let bookkeeping take the queue down */ }
            continue;
          }
          throw result.error; // transient -> retry
        }
      }
      // Mandatory: without complete() the upload queue stalls permanently.
      await tx.complete();
    } catch (err: any) {
      const code = err?.code;
      if (FATAL_PG_CODES.has(code)) {
        this.rejected.push({
          table: '?', op: '?', rowId: '?', fields: [],
          code, message: err.message ?? String(err), at: new Date().toISOString(),
        });
        await tx.complete();
        return;
      }
      throw err;
    }
  }
}
