# The office console

The manager's surface. A company owner signs in with the same account they use on
their phone and sees every job, every change order the crew captured, and both
conversations — the client's and the crew's. They can price a draft, fix the wording a
client will read, answer a question, and message the crew.

**It cannot capture anything, and that is the design.** There is no record button
anywhere in it. Every record in this product is raised in the field, stamped where and
when it happened; a change order conjured at a keyboard would be the one row in the
table with no such origin. `sql/427` enforces this where it counts — the office is
granted `UPDATE` on `change_order` and deliberately not `INSERT`.

## It needs two migrations

Point nobody at this until both are applied:

```bash
./scripts/apply-migration.sh apps/mobile/sql/427_office_writes.sql
./scripts/apply-migration.sh apps/mobile/sql/428_office_reads.sql
```

- **427** lets a company OWNER edit and reply on a change order one of their crew
  raised. Before it, `co_own` (`owner_id = auth.uid()`) and `ingest_r5b_v1`'s "not your
  change order" made the console a read-only window.
- **428** widens the four project-scoped read RPCs to the company-wide rule 376 already
  chose for the tables. Without it the console shows **no questions at all**, and
  because `discussing` is derived from an open question count, a change order with a
  client waiting two days renders as a calm "Sent" — confidently wrong, in the
  direction of telling somebody nothing is owed.

## Running it

```bash
cp .env.example .env.local   # then fill in the two values from the repo root .env
npm install
npm run dev
```

Both variables are public by design — the anon key is the same one `confirm.html`
ships with, and RLS plus the RPC grants are the protection. **Never put
`SUPABASE_SERVICE_ROLE_KEY` here**: Vite inlines `VITE_*` into a JavaScript file that
anyone can read.

The build fails loudly if either is missing. That is on purpose: a console built
without an environment returns an empty list from every query and looks like a company
with no work in it, which is the `confirm.html` failure (`docs/CLIENT-PORTAL.md` §1)
wearing a different hat.

## Checks

```bash
npm test        # the vendored shared logic still matches the mobile app's
npm run build   # typecheck, then bundle
```

`npm test` is the important one. `src/shared/extrastatus.ts` and `src/shared/money.ts`
are **copies** of `apps/mobile/src/`, vendored rather than imported because Render
builds with `rootDir: apps/console` and a relative import across apps would break the
deploy rather than fail a test — the same constraint `apps/worker` hit first. The test
compares them byte for byte. When it fails, re-copy the mobile file; do not hand-edit
the copy.

## No server, on purpose

Every read and write goes straight to PostgREST under the signed-in user's JWT. A Node
tier in the middle would need the service-role key to be worth having, and that key
bypasses RLS and can read every customer's evidence. The safest place for it is nowhere
near a web port.

## What it does not do yet

- **Sending for approval.** The console can price and word a change order; the send
  still happens on the phone. Sending freezes a binding instrument stamped with whoever
  sent it, and doing that from a desk on somebody else's record needs its own pass —
  `confirmation_create` stamps `auth.uid()` as the asker, and the notification routing
  and the approver roster both read from that.
- **Evidence.** Photos, video and the voice note with its transcript are on the record
  in the database but not yet rendered here; the storage paths need signed URLs.
- **An audit line for office edits.** When the owner edits a crew member's draft, the
  change is saved but the history does not yet say the office made it. Worth adding
  before this is used by a company where that distinction would ever be argued about.
