/**
 * Every read the console makes.
 *
 * ONE PLACE, and the column lists live here rather than at the call sites, because a
 * PostgREST select is a string: a typo is not a type error, it is a 400 at runtime on
 * whichever screen happened to hold the typo.
 *
 * SHAPE OF THE LOAD. The signals a ledger row needs — open questions, state times, the
 * open signal, the thread — are all PROJECT-scoped RPCs, by deliberate design: "the app
 * hydrates a project at a time, and one round trip per extra on one bar is the whole
 * perceived load time" (385). The console has a desk's connection, not a bar's, but the
 * RPCs are what exist and per-row calls would be N+1 against functions that were never
 * granted per-row. So the overview loads the company's projects, then fans out one set
 * of signal calls PER PROJECT and joins in memory.
 */
import { supabase } from '../supabase.ts';
import { displayStatus } from '../shared/extrastatus.ts';
import type {
  ChangeOrder, Company, LedgerRow, Member, OpenQuestion, OpenSignal,
  Project, StateTimes, TeamComment, ThreadMessage,
} from './types.ts';

/** Server-side columns only. See the note in types.ts about `signed_by`. */
const CO_COLS =
  'id, project_id, owner_id, co_number, scope, scope_of_work, line_items, amount_cents,'
  + ' nte_cents, is_mini, who_directed, extra_type, status, billing_timing,'
  + ' schedule_effect, schedule_days, exclusions, superseded_by, created_at';

const PROJECT_COLS = 'id, name, address, client_ref, status, label, last_used_ms';

function fail(where: string, error: { message: string } | null): void {
  if (error) throw new Error(`${where}: ${error.message}`);
}

/**
 * The company this person belongs to, and what they are in it.
 *
 * Returns null rather than throwing when there is no membership: that is a real and
 * ordinary state (someone who signed in on the web before ever setting up a company on
 * their phone), and it deserves an explanatory screen, not an error boundary.
 */
export async function loadMyCompany(): Promise<Company | null> {
  const { data, error } = await supabase
    .from('company_member')
    .select('company_id, role, status, company:company_id ( id, name )')
    .eq('status', 'active')
    // DETERMINISTIC, not arbitrary (code review 2026-09-07): the schema allows a
    // person on two companies' crews (376's unique is per-pair), and an unordered
    // limit(1) handed back whichever membership PostgREST felt like -- a different
    // company per session, the other one unreachable, and a role that can mislead
    // the edit gate. Oldest membership (joined_at, id tie-break) wins until the console grows the company
    // CHOICE the mobile app already models (company.ts: active_company_id).
    .order('joined_at', { ascending: true }).order('id', { ascending: true })
    .limit(1);
  fail('loadMyCompany', error);
  const row = data?.[0] as
    | { company_id: string; role: Company['role']; company: { id: string; name: string } | null }
    | undefined;
  if (!row) return null;
  return { id: row.company_id, name: row.company?.name ?? 'My company', role: row.role };
}

/** The roster. `revoked` members are excluded — a removed person is not on the crew. */
export async function loadMembers(companyId: string): Promise<Member[]> {
  const { data, error } = await supabase
    .from('company_member')
    .select('id, user_id, role, status, display_name')
    .eq('company_id', companyId)
    .eq('status', 'active');
  fail('loadMembers', error);

  // Owner, then crew, then subs — the ordering `company.ts` uses on the phone, so the
  // roster does not reshuffle between the two surfaces. Sorted HERE and not with
  // `.order('role')`, which sorts the text and would give crew · owner · sub.
  const rank: Record<string, number> = { owner: 0, crew: 1, sub: 2 };
  return ((data ?? []) as unknown as Member[]).sort(
    (a, b) => (rank[a.role] ?? 3) - (rank[b.role] ?? 3)
      || (a.display_name ?? '').localeCompare(b.display_name ?? ''),
  );
}

/**
 * The company's jobs. Archived ones are left out, matching `listProjects` on the phone
 * (`COALESCE(status,'in_progress') <> 'archived'`).
 */
export async function loadProjects(companyId: string): Promise<Project[]> {
  const { data, error } = await supabase
    .from('project')
    .select(PROJECT_COLS)
    .eq('company_id', companyId)
    .neq('status', 'archived')
    .order('last_used_ms', { ascending: false, nullsFirst: false });
  fail('loadProjects', error);
  return (data ?? []) as unknown as Project[];
}

export async function loadProject(projectId: string): Promise<Project | null> {
  const { data, error } = await supabase
    .from('project').select(PROJECT_COLS).eq('id', projectId).maybeSingle();
  fail('loadProject', error);
  return (data ?? null) as unknown as Project | null;
}

export async function loadChangeOrders(projectIds: string[]): Promise<ChangeOrder[]> {
  if (projectIds.length === 0) return [];
  const { data, error } = await supabase
    .from('change_order')
    .select(CO_COLS)
    .in('project_id', projectIds)
    .order('created_at', { ascending: false });
  fail('loadChangeOrders', error);
  // Through `unknown`: supabase-js types an untyped client's select as
  // GenericStringError[] and cannot narrow a hand-written column list. The shape is
  // asserted by CO_COLS above, which is the one place it is written down.
  return (data ?? []) as unknown as ChangeOrder[];
}

export async function loadChangeOrder(id: string): Promise<ChangeOrder | null> {
  const { data, error } = await supabase
    .from('change_order').select(CO_COLS).eq('id', id).maybeSingle();
  fail('loadChangeOrder', error);
  return (data ?? null) as unknown as ChangeOrder | null;
}

// ── the three project-scoped signal RPCs ────────────────────────────────────────

export async function loadOpenQuestions(projectId: string): Promise<OpenQuestion[]> {
  const { data, error } = await supabase.rpc('extra_questions_v1', { p_project_id: projectId });
  fail('extra_questions_v1', error);
  return (data ?? []) as OpenQuestion[];
}

export async function loadStateTimes(projectId: string): Promise<StateTimes[]> {
  const { data, error } = await supabase
    .rpc('change_order_state_times_v1', { p_project_id: projectId });
  fail('change_order_state_times_v1', error);
  return (data ?? []) as StateTimes[];
}

export async function loadOpenSignals(projectId: string): Promise<OpenSignal[]> {
  const { data, error } = await supabase.rpc('extra_open_signal_v1', { p_project_id: projectId });
  fail('extra_open_signal_v1', error);
  return (data ?? []) as OpenSignal[];
}

/** The client conversation for a whole project, both sides, in time order. */
export async function loadThreads(projectId: string): Promise<ThreadMessage[]> {
  const { data, error } = await supabase.rpc('discussion_threads', { p_project_id: projectId });
  fail('discussion_threads', error);
  return (data ?? []) as ThreadMessage[];
}

/** Internal messages on the crew's side. Company-visible by 380's own policy. */
export async function loadTeamComments(projectId: string): Promise<TeamComment[]> {
  const { data, error } = await supabase
    .from('co_comment')
    .select('id, change_order_id, project_id, author_id, author_name, body, at_ms')
    .eq('project_id', projectId)
    .order('at_ms', { ascending: true });
  fail('loadTeamComments', error);
  return (data ?? []) as unknown as TeamComment[];
}

/**
 * Assemble the ledger for a set of projects: the rows, plus every signal, joined.
 *
 * THE DERIVED STATUS IS COMPUTED HERE AND NOWHERE ELSE. Screens read `row.display`.
 * If a screen ever calls `displayStatus` itself it will eventually be handed a
 * different question count than this function used, and the same change order will
 * carry two different chips on two screens — which is the exact confusion the shared
 * module exists to prevent.
 */
export async function loadLedger(projects: Project[]): Promise<LedgerRow[]> {
  const cos = await loadChangeOrders(projects.map((p) => p.id));
  if (cos.length === 0) return [];

  // Only the projects that actually carry a change order. On a company with a long
  // tail of finished jobs this is the difference between four round trips and forty.
  const live = projects.filter((p) => cos.some((c) => c.project_id === p.id));

  const signals = await Promise.all(live.map(async (p) => {
    // Independent reads, one round trip of latency instead of three per project
    // (code review 2026-09-07) -- Record.tsx already batches these the same way.
    const [questions, times, opened] = await Promise.all([
      loadOpenQuestions(p.id), loadStateTimes(p.id), loadOpenSignals(p.id),
    ]);
    return { questions, times, opened };
  }));

  const questions = signals.flatMap((s) => s.questions);
  const times = new Map(signals.flatMap((s) => s.times).map((t) => [t.change_order_id, t]));
  const opened = new Map(signals.flatMap((s) => s.opened).map((o) => [o.change_order_id, o]));
  const byProject = new Map(projects.map((p) => [p.id, p]));

  const rows: LedgerRow[] = [];
  for (const co of cos) {
    const project = byProject.get(co.project_id);
    // A change order whose project did not come back is not a row to guess at: the
    // project is archived, or RLS withheld it. Dropping it is honest; rendering it
    // under a placeholder job name would invent a fact about where work happened.
    if (!project) continue;
    const mine = questions.filter((q) => q.change_order_id === co.id);
    rows.push({
      co,
      project,
      display: displayStatus(co.status, { openQuestions: mine.length }),
      openQuestions: mine,
      times: times.get(co.id) ?? null,
      opened: opened.get(co.id) ?? null,
    });
  }
  return rows;
}
