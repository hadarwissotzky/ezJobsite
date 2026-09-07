/**
 * One job site: who is on it, what has been raised there, and what happened last.
 */
import { useMemo, useState } from 'react';
import { C, F, radii } from '../ui/theme.ts';
import { Avatar, Button, Card, Failed, Icon, JobChip, Label, Loading, Note, PATH, formatMoney } from '../ui/kit.tsx';
import { CoRow, daysAgo, shortDate } from '../ui/corow.tsx';
import { Pill } from '../ui/shell.tsx';
import { useAsync } from '../data/useAsync.ts';
import { loadLedger, loadProject } from '../data/queries.ts';
import { isAwaiting } from '../shared/extrastatus.ts';
import type { Member } from '../data/types.ts';
import type { Route } from '../ui/shell.tsx';

type Filter = 'all' | 'unpriced' | 'out' | 'settled';

export function JobSite({ projectId, members, go }: {
  projectId: string; members: Member[]; go: (r: Route) => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');

  const { loading, error, data, reload } = useAsync(async () => {
    const project = await loadProject(projectId);
    if (!project) return { project: null, rows: [] };
    return { project, rows: await loadLedger([project]) };
  }, [projectId]);

  const totals = useMemo(() => {
    const rows = data?.rows ?? [];
    return {
      approved: rows.filter((r) => r.display === 'approved')
        .reduce((n, r) => n + (r.co.amount_cents ?? 0), 0),
      awaiting: rows.filter((r) => isAwaiting(r.display))
        .reduce((n, r) => n + (r.co.amount_cents ?? 0), 0),
    };
  }, [data]);

  if (loading) return <Loading what="this job" />;
  if (error) return <Failed error={error} retry={reload} />;

  const project = data?.project;
  if (!project) {
    // Not an error page. RLS returning nothing and the job not existing are the same
    // shape from here, and both mean the same thing to the person reading it.
    return (
      <div style={{ padding: 32 }}>
        <Note tone="neutral">
          This job is not in your company, or it has been archived. Nothing was loaded.
        </Note>
      </div>
    );
  }

  const rows = data.rows;
  const shown = rows.filter((r) => {
    switch (filter) {
      case 'unpriced': return r.display === 'draft' && r.co.amount_cents === null;
      case 'out': return isAwaiting(r.display);
      case 'settled': return r.display === 'approved' || r.display === 'declined';
      case 'all': return true;
    }
  });

  // Who has actually raised something here. The membership roster is company-wide; a
  // job's crew is the people whose work is on it, which is the honest derivation from
  // what the database holds. Nothing records an assignment.
  const onSite = members.filter((m) => rows.some((r) => r.co.owner_id === m.user_id));

  const events = rows
    .flatMap((r) => [
      ...r.openQuestions.map((q) => ({
        at: q.asked_at_ms, dot: C.danger,
        text: `The client asked on ${label(r.co.co_number)} — “${q.note}”`,
      })),
      ...(r.times?.approved_at_ms
        ? [{ at: r.times.approved_at_ms, dot: C.approve, text: `${label(r.co.co_number)} signed` }] : []),
      ...(r.times?.sent_at_ms
        ? [{ at: r.times.sent_at_ms, dot: C.brand, text: `${label(r.co.co_number)} sent for approval` }] : []),
    ])
    .sort((a, b) => b.at - a.at)
    .slice(0, 5);

  return (
    <div style={{ padding: '24px 32px 40px 32px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Card style={{ padding: 18, display: 'flex', gap: 20 }}>
        <div style={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, letterSpacing: -0.4, lineHeight: '30px' }}>
              {project.name}
            </h1>
            <JobChip status={project.status} />
          </div>
          <span style={{ fontSize: 15, color: C.steel }}>
            {project.address ?? 'No address on file'}
            {project.client_ref && <> · Client: <strong style={{ color: C.ink }}>{project.client_ref}</strong></>}
          </span>
          <div style={{ display: 'flex', gap: 34, paddingTop: 4 }}>
            <Stat label="Approved extras" value={formatMoney(totals.approved)} color={C.approve} />
            <Stat label="Out for approval" value={formatMoney(totals.awaiting)} color={C.caution} />
            <Stat label="Raised here" value={String(rows.length)} />
          </div>
        </div>
        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8, width: 214 }}>
          <Button kind="primary" onClick={() => go({ name: 'crew', projectId })}>
            <Icon d={PATH.chat} size={16} color={C.card} width={1.9} /> Message the crew
          </Button>
          <Button onClick={() => go({ name: 'client', projectId })}>
            <Icon d={PATH.chat} size={16} color={C.ink} width={1.9} /> The client conversation
          </Button>
        </div>
      </Card>

      <div style={{
        display: 'grid', gridTemplateColumns: 'minmax(0, 1.72fr) minmax(0, 1fr)',
        gap: 20, alignItems: 'start',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, paddingBottom: 2 }}>
            <Pill active={filter === 'all'} onClick={() => setFilter('all')}>All {rows.length}</Pill>
            <Pill active={filter === 'unpriced'} onClick={() => setFilter('unpriced')}>
              Needs a price {rows.filter((r) => r.display === 'draft' && r.co.amount_cents === null).length}
            </Pill>
            <Pill active={filter === 'out'} onClick={() => setFilter('out')}>
              Out for approval {rows.filter((r) => isAwaiting(r.display)).length}
            </Pill>
            <Pill active={filter === 'settled'} onClick={() => setFilter('settled')}>
              Settled {rows.filter((r) => r.display === 'approved' || r.display === 'declined').length}
            </Pill>
          </div>

          {shown.length === 0 && (
            <Note tone="neutral">
              {rows.length === 0
                ? 'Nothing has been captured on this job yet. Change orders are raised on the phone, at the site.'
                : 'Nothing in this filter.'}
            </Note>
          )}

          {shown.map((row) => (
            <CoRow
              key={row.co.id}
              row={row}
              meta={`${nameOf(members, row.co.owner_id)} · ${new Date(row.co.created_at)
                .toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}`}
              onOpen={() => go({ name: 'record', changeOrderId: row.co.id })}
            />
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            <Label>Crew who raised work here</Label>
            <Card style={{ padding: '4px 15px' }}>
              {onSite.length === 0 && (
                <div style={{ padding: '12px 0', fontSize: 14, color: C.muted }}>Nobody yet.</div>
              )}
              {onSite.map((m, i) => (
                <div key={m.id} style={{
                  display: 'flex', alignItems: 'center', gap: 11, padding: '13px 0',
                  borderBottom: i === onSite.length - 1 ? 'none' : `1px solid ${C.lineSoft}`,
                }}>
                  <Avatar name={m.display_name ?? '?'} size={38}
                    bg={m.role === 'owner' ? C.ink : m.role === 'crew' ? C.brand : C.savedLocal} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flexGrow: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ fontSize: 15, fontWeight: 700 }}>{m.display_name ?? 'Unnamed'}</span>
                      <span style={{
                        padding: '2px 6px', borderRadius: 4, background: C.surfaceMuted,
                        fontFamily: F.disp, fontSize: 10.5, fontWeight: 600, letterSpacing: 0.5,
                        textTransform: 'uppercase', color: C.steel,
                      }}>{m.role}</span>
                    </div>
                    <span style={{ fontSize: 12.5, color: C.muted }}>
                      {rows.filter((r) => r.co.owner_id === m.user_id).length} raised on this job
                    </span>
                  </div>
                </div>
              ))}
            </Card>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            <Label>Last thing that happened</Label>
            <Card style={{ padding: '16px 17px', display: 'flex', flexDirection: 'column', gap: 15 }}>
              {events.length === 0 && (
                <span style={{ fontSize: 14, color: C.muted }}>Nothing has moved on this job yet.</span>
              )}
              {events.map((e, i) => (
                <div key={i} style={{ display: 'flex', gap: 11 }}>
                  <span style={{
                    width: 9, height: 9, borderRadius: 999, background: e.dot,
                    flexShrink: 0, marginTop: 5,
                  }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 14.5, lineHeight: '20px' }}>{e.text}</span>
                    <span style={{ fontSize: 12.5, color: C.muted }}>
                      {shortDate(e.at)} · {daysAgo(e.at)}
                    </span>
                  </div>
                </div>
              ))}
            </Card>
          </div>

          <div style={{
            background: C.surfaceMuted, border: `1px solid ${C.line}`, borderRadius: radii.md,
            padding: '13px 15px', display: 'flex', gap: 10, alignItems: 'flex-start',
          }}>
            <Icon d={PATH.clock} size={17} color={C.steel} width={1.9} />
            <span style={{ fontSize: 13.5, lineHeight: '19px', color: C.steel }}>
              Nothing is captured from this desk. Everything here arrived from a phone on
              the site, stamped where and when it happened.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Label>{label}</Label>
      <span style={{
        fontFamily: F.disp, fontWeight: 700, fontSize: 26, lineHeight: '28px',
        fontVariantNumeric: 'tabular-nums', color: color ?? C.ink,
      }}>{value}</span>
    </div>
  );
}

export function nameOf(members: Member[], userId: string): string {
  return members.find((m) => m.user_id === userId)?.display_name ?? 'A crew member';
}

function label(n: number | null): string {
  return n ? `#${n}` : 'a change order';
}
