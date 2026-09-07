/**
 * The shapes the console reads. Hand-written against the migrations in
 * `apps/mobile/sql`, not generated — and every field below is one that exists on the
 * SERVER.
 *
 * That distinction cost something to learn and is worth stating: the device's SQLite
 * schema (`AppSchema.ts`) is not the Postgres schema. `change_order.signed_by` is a
 * local column the phone keeps and the database has never had, so selecting it here
 * would return a PostgREST 400 on every load of every screen — the kind of failure
 * that looks like "the console is broken" rather than "one word is wrong".
 */
import type { LedgerStatus, StoredStatus } from '../shared/extrastatus.ts';

export type MemberRole = 'owner' | 'crew' | 'sub';

export type Company = {
  id: string;
  name: string;
  /** The caller's role in it. Decides whether the console is read-only. */
  role: MemberRole;
};

export type Member = {
  id: string;
  user_id: string;
  role: MemberRole;
  status: 'active' | 'revoked';
  display_name: string | null;
};

export type Project = {
  id: string;
  name: string;
  address: string | null;
  client_ref: string | null;
  /** Server-owned (the connector strips it from device uploads). */
  status: string;
  label: string | null;
  last_used_ms: number | null;
};

/** One line of a cost breakdown. Cents, always — money in floats is a bug with a lawyer. */
export type LineItem = {
  description: string;
  qty: number;
  unit_cents: number;
  total_cents: number;
};

export type ChangeOrder = {
  id: string;
  project_id: string;
  owner_id: string;
  co_number: number | null;
  scope: string;
  /** The AI/edited long-form scope, when there is one. `scope` is the one-liner. */
  scope_of_work: string | null;
  line_items: LineItem[] | null;
  amount_cents: number | null;
  nte_cents: number | null;
  is_mini: number;
  who_directed: string;
  extra_type: string | null;
  status: StoredStatus;
  billing_timing: string | null;
  schedule_effect: string | null;
  schedule_days: number | null;
  exclusions: string | null;
  superseded_by: string | null;
  created_at: string;
};

/** One open question from the client, from `extra_questions_v1`. */
export type OpenQuestion = {
  change_order_id: string;
  question_id: number;
  note: string;
  asked_at_ms: number;
};

/** From `change_order_state_times_v1`. Every field is null until that thing happened. */
export type StateTimes = {
  change_order_id: string;
  sent_at_ms: number | null;
  approved_at_ms: number | null;
  declined_at_ms: number | null;
  superseded_at_ms: number | null;
};

/** From `extra_open_signal_v1`. `viewed` is THE derivation — nothing else computes it. */
export type OpenSignal = {
  change_order_id: string;
  open_count: number;
  viewed: boolean;
  first_opened_at_ms: number | null;
  last_opened_at_ms: number | null;
};

/** One message in the client conversation, from `discussion_threads`. */
export type ThreadMessage = {
  id: string;
  change_order_id: string;
  side: 'client' | 'contractor';
  body: string;
  at: string;
};

/** One internal message on a change order. Company-visible, append-only (380). */
export type TeamComment = {
  id: string;
  change_order_id: string;
  project_id: string;
  author_id: string;
  author_name: string | null;
  body: string;
  at_ms: number;
};

/**
 * A change order with everything the list rows and the record header need, assembled
 * client-side from the row plus the three project-scoped signal RPCs.
 *
 * `display` is the DERIVED status — `displayStatus(status, {openQuestions})` — and is
 * the only status any screen is allowed to render. The stored one decides what may be
 * done; the derived one decides what is said. Mixing them up is how a signed approval
 * ends up labelled "In discussion".
 */
export type LedgerRow = {
  co: ChangeOrder;
  project: Project;
  display: LedgerStatus;
  openQuestions: OpenQuestion[];
  times: StateTimes | null;
  opened: OpenSignal | null;
};
