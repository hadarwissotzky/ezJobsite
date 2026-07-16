import {
  AbstractPowerSyncDatabase,
  PowerSyncBackendConnector,
  UpdateType,
} from '@powersync/react-native';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
const POWERSYNC_URL = process.env.EXPO_PUBLIC_POWERSYNC_URL!;

// Postgres error codes that mean "this write will NEVER succeed". Returning
// without throwing DISCARDS the operation and unblocks the queue. Throwing on
// these would stall the upload queue forever (the documented 4xx footgun).
const FATAL_PG_CODES = new Set([
  '42501', // insufficient_privilege  <- Q2: client write to a SERVER-owned column
  '23514', // check_violation
  '23503', // foreign_key_violation
  '23505', // unique_violation
]);

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
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
  }

  async login(email: string, password: string) {
    const { error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw error;
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
        let result: any;

        switch (op.op) {
          case UpdateType.PUT:
            result = await table.upsert({ ...op.opData, id: op.id });
            break;
          case UpdateType.PATCH:
            result = await table.update(op.opData ?? {}).eq('id', op.id);
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
