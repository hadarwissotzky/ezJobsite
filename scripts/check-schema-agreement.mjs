#!/usr/bin/env node
/**
 * Does the PowerSync schema agree with Postgres?
 *
 * WHY THIS EXISTS: the two schemas are ONE CONTRACT IN TWO FILES and nothing
 * checked they agreed. AppSchema.ts declared `created_at_ms`; Postgres had only
 * `created_at`. The client sent a column the server did not have, PostgREST
 * answered PGRST204, the connector threw, tx.complete() never ran, and THE ENTIRE
 * UPLOAD QUEUE STALLED PERMANENTLY AND SILENTLY. The app said "saved ✓" for a
 * whole session while nothing reached the cloud.
 *
 * That cost hours to find and would have taken this check seconds. It is the
 * cheapest possible guard against the most expensive class of bug in this
 * codebase: the kind that looks like success.
 *
 * WHAT IT CHECKS, and what each direction means:
 *   client column missing on server -> FATAL. This is the stall. The client will
 *     send it, PostgREST will refuse the whole statement, and the queue dies.
 *   server column missing on client -> WARN. The client simply will not see it.
 *     Usually fine (server-owned bookkeeping), sometimes a forgotten feature.
 *
 * Run it in CI and before a deploy. It needs only .env.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

function env(key) {
  const line = readFileSync(root + '.env', 'utf8')
    .split('\n').find((l) => l.startsWith(key + '='));
  return line ? line.slice(key.length + 1).replace(/^['"]|['"]$/g, '').trim() : '';
}

/** Parse the PowerSync tables out of AppSchema.ts. */
function clientSchema() {
  const src = readFileSync(root + 'apps/mobile/src/AppSchema.ts', 'utf8');
  const tables = {};
  // const <name> = new Table({ ... })  — the SDK's own shape.
  const re = /const\s+(\w+)\s*=\s*new\s+Table\(\s*\{([\s\S]*?)\}\s*(?:,|\))/g;
  let m;
  while ((m = re.exec(src))) {
    const cols = [...m[2].matchAll(/^\s*(\w+)\s*:\s*column\./gm)].map((c) => c[1]);
    if (cols.length) tables[m[1]] = cols;
  }
  return tables;
}

function serverColumns(table) {
  const url = env('EXPO_PUBLIC_SUPABASE_URL');
  const ref = url.match(/https:\/\/([^.]+)\./)?.[1];
  const conn = `postgresql://postgres.${ref}@${env('SUPABASE_DB_HOST')}:5432/postgres`;
  const out = execFileSync('psql', [conn, '-At', '-c',
    `select column_name from information_schema.columns
      where table_schema='public' and table_name='${table}'`],
    { env: { ...process.env, PGPASSWORD: env('SUPABASE_DB_PASSWORD') } }).toString();
  return out.split('\n').filter(Boolean);
}

const client = clientSchema();
let fatal = 0, warn = 0;

for (const [table, cols] of Object.entries(client)) {
  const server = serverColumns(table);
  if (!server.length) {
    console.log(`FATAL  ${table}: table does not exist on the server`);
    fatal++;
    continue;
  }
  // `id` is implicit in PowerSync and never declared client-side.
  const missingOnServer = cols.filter((c) => !server.includes(c));
  const missingOnClient = server.filter((c) => c !== 'id' && !cols.includes(c));

  for (const c of missingOnServer) {
    // THE STALL. Not a style note: this wedges the queue for every user, forever.
    console.log(`FATAL  ${table}.${c}: client sends it, server has no such column`);
    console.log(`       -> PostgREST PGRST204 -> uploadData throws -> UPLOAD QUEUE STALLS`);
    fatal++;
  }
  for (const c of missingOnClient) {
    console.log(`warn   ${table}.${c}: on the server, not in AppSchema (client cannot see it)`);
    warn++;
  }
  if (!missingOnServer.length && !missingOnClient.length) {
    console.log(`ok     ${table}: ${cols.length} columns agree`);
  }
}

console.log(`\n${fatal} fatal, ${warn} warnings`);
if (fatal) {
  console.log('A fatal mismatch means the upload queue will stall SILENTLY in production.');
  process.exit(1);
}
