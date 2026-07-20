import {
  AbstractPowerSyncDatabase,
  PowerSyncBackendConnector,
  UpdateType,
} from '@powersync/react-native';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

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

  async login(email: string, password: string) {
    const { error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  /**
   * Registration. Returns whether a session came back immediately: with email
   * confirmation OFF, signUp logs the user straight in (session present); with it
   * ON, no session yet and the caller must tell the user to check their email.
   */
  async signUp(email: string, password: string): Promise<{ needsEmailConfirm: boolean }> {
    const { data, error } = await this.client.auth.signUp({ email, password });
    if (error) throw error;
    return { needsEmailConfirm: !data.session };
  }

  async signOut() {
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
