# Sync bakeoff — live progress state (resume file)

> Working notes for the throwaway spike. Not a deliverable. The deliverable is `docs/BAKEOFF-RESULT.md`.
> Predeclared parameters (frozen before any run): `docs/BAKEOFF-PREDECLARATION.md`.

## Decisions taken (hadar, 2026-07-16)
1. **Q3 DEFERRED** to a dedicated device session — no usable physical device.
2. **Q3 plan when it runs:** test STOCK PowerSync upload behaviour first (expect whole-file restart at byte zero), record honestly, THEN add our own TUS to the adapter and measure the cost of owning it.
3. **Authorized:** edit `service.yaml` + deploy to the **Development** instance only.

## Environment facts (verified, not assumed)
| Thing | Value |
|---|---|
| Supabase project ref | `wwhfgsijnlpajvdiopfd`, Postgres **17.6**, `wal_level=logical` |
| DB access (local harness) | pooler **session mode only**: `aws-0-us-west-1.pooler.supabase.com:5432`, user `postgres.<ref>` |
| ⚠️ `.env` bug | `SUPABASE_DB_USER=postgres` is **WRONG** for the pooler — must be `postgres.<ref>`. `spike/bin/pg.sh` derives it correctly; nothing else should read that key. |
| ⚠️ `.env` bug | `SUPABASE_SERVICE_ROLE_KEY` and `EXPO_PUBLIC_POWERSYNC_DEV_TOKEN` are literal `<angle bracket>` placeholders. Sourcing `.env` in zsh **fails at line 17** because `<` is a redirect. Never `source .env`; use the `getval` awk helper. |
| Supabase anon key | REAL — new format `sb_publishable_…` (short by design, not a placeholder) |
| PowerSync org | `hadarwissotzky` id `6a591702f8d7250007cddab6` |
| PowerSync project | `ezjobsite-sync-bakeoff` id `6a591747d7c81f0007a1de52` |
| **Development instance (AUTHORIZED)** | id `6a5917477f33bac37ef768b8` — provisioned, linked in `powersync/cli.yaml` |
| **Production instance (DO NOT TOUCH)** | id `6a5917487f33bac37ef768ba` — not provisioned |
| PowerSync service version | **1.23.3** |
| Replication slot | `powersync_6a5917477f33bac37ef768b8_1_9f25`, logical/pgoutput, **active=true, streaming** |
| Physical iOS | iPhone 13 mini @ **iOS 26.3.1**; Xcode **16.4** = iOS 18.5 SDK → **cannot deploy**. Needs Xcode 26.x. |
| Physical Android | **No SDK at all**; `$ANDROID_HOME` points at a deleted dir |
| iOS Simulator | iPhone 16 Pro, iOS 18.6 — available |

## Done
- [x] `docs/BAKEOFF-PREDECLARATION.md` — Q1 N=20 (**mechanism determination, explicitly NOT a rate bound**), Q2 field ownership, Q6 workload, void-trial rules. **Frozen — do not retune after a run.**
- [x] `spike/sql/001_schema.sql` — project / capture (immutable, `seq bigint DEFAULT nextval`) / capture_op_state / attachment + RLS + **column-level UPDATE grants** (the real enforcement for Q2's server-owned fields).
- [x] `spike/sql/002_publication.sql` — scoped `powersync` publication to the 4 bakeoff tables (was `FOR ALL TABLES`, which was replicating `auth.users`, `storage.objects`, etc.).
- [x] `spike/sql/003_denorm.sql` — `project_id` on child tables so sync queries filter on one CTE.
- [x] `powersync/sync-config.yaml` — Sync Streams edition 3, single `bakeoff` stream (one bucket/user → one checkpoint to reason about for Q1).
- [x] `powersync/service.yaml` — removed the `uri:` line (pull writes back a literal `[HIDDEN_PASSWORD]`), enabled `client_auth.supabase`. Backup: `spike/backup/service.yaml.orig`.
- [x] Deployed to Development. **Replication verified streaming, lag 0.**

## Findings already banked (evidence, not verdicts)
1. **Q6 POSITIVE — no IPv4 add-on needed.** Supabase's direct host is IPv6-only (AAAA, no A) and Supavisor cannot carry logical replication, so PowerSync *must* use IPv6. `powersync validate` → **Test Connections ✓**, and replication is streaming. PowerSync Cloud egresses IPv6 fine. This kills a potential **~$29/mo** adoption cost (IPv4 add-on ~$4 + Pro ~$25).
2. **Q3/Q5 — PowerSync has NO resumable upload.** `RemoteStorageAdapter.uploadFile(fileData: ArrayBuffer, attachment)` takes the whole buffer in one call. No TUS, no chunking, no offset. A killed upload restarts at byte zero next sync interval. **The Q3 resume bar in `SPIKE-SYNC-BAKEOFF.md:71-72` presupposes TUS the helper does not implement.** Any resumability is ours to build and own.
3. **Q5 — attachments are alpha AND the package moved.** `@powersync/attachments` is **deprecated**; attachments are now built into `@powersync/react-native`. Docs mark the built-in helper **alpha** across all platforms. The bakeoff's "production-ready but evolving" gloss is more generous than the docs.
4. **Q3 — attachments table is LOCAL-ONLY**, not synced. Only the FK in the data model syncs. So Option B wrapped-key material must travel in *our* synced `capture`/`attachment` row, not in the attachment record.
5. **Q7 — windowing is only half expressible.** Sync Streams have **no server-side `now()`/`current_date`**, so "Active projects" works as a CTE but **"last-N-days" cannot be expressed server-side**. It needs a client-supplied parameter (client can lie → needs an auth guard) or a server-maintained flag column. Real fit finding.
6. **Doc gaps blocking bars as written:** `N` in "last-N-days" is never defined anywhere; `REQ-MEMBER-5` is cited 4× and defined 0× (`PM-LAYER.md` does not contain it despite `IMPLEMENTATION_NOTES.md:50` claiming so); Option B is *selected, not designed* (no wrapped-DEK location) so Q3's "production unwrap path" has no path to exercise; `DURABILITY-DESIGN-v1` Artifact 1 **step 6 is marked NOT ATOMIC — OPEN GAP** by its own author, which is exactly what Q4 tests.

## Backend readiness gate: **MET** (all verified, not assumed)
- [x] Instance exists + provisioned (Development)
- [x] Source DB connection configured — `powersync status` → **connected**
- [x] Sync config deployed — stream `bakeoff` registered
- [x] Client auth configured — **Supabase ES256 JWT accepted end-to-end**
- [x] Instance URL available
- [x] Replication/publication complete — slot active, **streaming**, lag 0

### Auth path proven (2026-07-16)
Two confirmed users exist: `device1@example.com` / `device2@example.com`, password `bakeoff-spike-pw-2026`
(created via `spike/sql/004_users.sql` + `005_users_fix.sql` — the signup API rejects `.test` TLDs and
rate-limits confirmation emails; direct insert is deterministic for a throwaway spike).

- `device1` sub = `2c4684ad-06d2-4a25-a4d1-44b0abe65040`
- `device2` sub = `ae897049-c54d-4da8-ab96-ffe9968b462d`

⚠️ **GoTrue gotcha for anyone re-creating users:** `auth.users` token columns
(`confirmation_token`, `recovery_token`, `email_change*`, `phone_change*`, `reauthentication_token`)
must be `''`, **not NULL** — GoTrue scans them into non-nullable Go strings and NULL yields
`"Database error querying schema"` on the password grant. `005_users_fix.sql` fixes this.

**Raw protocol smoke test passes** — `POST $EXPO_PUBLIC_POWERSYNC_URL/sync/stream` with a Supabase
`Bearer` JWT returns HTTP 200:
```
{"checkpoint":{"last_op_id":"0","buckets":[],"streams":[{"name":"bakeoff","is_default":true,"errors":[]}]}}
{"checkpoint_complete":{"last_op_id":"0"}}
```
Supabase issues **ES256** tokens via a JWKS endpoint with one EC key (`kid` `0c975d3a…`); PowerSync's
`client_auth.supabase: true` auto-configured against it with **no legacy JWT secret** — matching the
guide's "new keys" path. This endpoint is also a useful low-level oracle for Q1 checkpoint inspection.

## Next
- [ ] Expo app (iOS Simulator) + PowerSync client, Supabase auth
- [ ] Q1 harness (`spike/bin/pg.sh` gives session-mode psql; **never use :6543** — transaction pooling breaks session advisory locks + `pg_stat_activity`)
- [ ] Q2 conflict test
- [ ] `docs/BAKEOFF-RESULT.md`

## Hard rules for this spike
- **Do NOT flip ADR-2. Do NOT edit ARCHITECTURE.md.** Result goes to `docs/BAKEOFF-RESULT.md` only.
- Never commit `.env`; never print secret values.
- A pass counts only if it meets the tightened bar for that question. Record assertions, not verdicts.
