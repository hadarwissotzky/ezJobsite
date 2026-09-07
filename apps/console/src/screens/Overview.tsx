/**
 * The command centre — what is open right now, across every job.
 *
 * THE THREE QUEUES ARE ACTIONS, NOT STATISTICS. Each one is a set of change orders
 * somebody has to do something about, and each says who is blocked. A tile counting
 * "captures this week" would be the data slop this design deliberately has none of:
 * it looks like information and changes nothing about what happens next.
 */
import { useMemo } from 'react';
import { C, F, radii, shadow, tint } from '../ui/theme.ts';
import { Avatar, Button, Card, Failed, Icon, Label, Loading, PATH, formatMoney } from '../ui/kit.tsx';
import { CoRow } from '../ui/corow.tsx';
import { useAsync } from '../data/useAsync.ts';
import { loadLedger, loadProjects } from '../data/queries.ts';
import { isAwaiting } from '../shared/extrastatus.ts';
import type { Company, Member } from '../data/types.ts';
import type { Route } from '../ui/shell.tsx';

export function Overview({ company, members, go }: {
  company: Company; members: Member[]; go: (r: Route) => void;
}) {
  const { loading, error, data, reload } = useAsync(async () => {
    const projects = await loadProjects(company.id);
    return { projects, rows: await loadLedger(projects) };
  }, [company.id]);

  const view = useMemo(() => {
    const rows = data?.rows ?? [];
    const live = rows.filter((r) => r.display !== 'superseded' && r.display !== 'cancelled');
    return {
      discussing: live.filter((r) => r.display === 'discussing'),
      waiting: live.filter((r) => r.display === 'sent'),
      unpriced: live.filter((r) => r.display === 'draft' && r.co.amount_cents === null),
      live,
    };
  }, [data]);

  if (loading) return <Loading what="your company's work" />;
  if (error) return <Failed error={error} retry={reload} />;

  const projects = data?.projects ?? [];
  const openTotal = view.live
    .filter((r) => isAwaiting(r.display))
    .reduce((n, r) => n + (r.co.amount_cents ?? 0), 0);

  // The queue, in the order a person should work it: the people waiting on YOU first,
  // then what can be moved, then what is only waiting on someone else.
  const queue = [...view.discussing, ...view.unpriced, ...view.waiting].slice(0, 12);
  return (
    <div style={{ padding: '26px 32px 40px 32px', display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Label>{new Date().toLocaleDateString('en-US', {
            weekday: 'long', day: 'numeric', month: 'long',
          })}</Label>
          <h1 style={{
            margin: 0, fontSize: 28, fontWeight: 800, letterSpacing: -0.4, lineHeight: '32px',
          }}>{headline(view.live.length, view.discussing.length + view.unpriced.length)}</h1>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 14 }}>
        <Queue
          tone="caution"
          label="The client is waiting on you"
          count={view.discussing.length}
          unit={view.discussing.length === 1 ? 'question unanswered' : 'questions unanswered'}
          detail={view.discussing.length === 0
            ? 'Nothing is stuck on an answer from this office.'
            : 'Nothing moves on these until somebody replies.'}
        />
        <Queue
          label="Sent, no answer yet"
          count={view.waiting.length}
          unit={`change ${view.waiting.length === 1 ? 'order' : 'orders'} · ${formatMoney(
            view.waiting.reduce((n, r) => n + (r.co.amount_cents ?? 0), 0),
          )}`}
          detail={view.waiting.length === 0
            ? 'Nothing is out for approval right now.'
            : 'A nudge is one click from the record.'}
        />
        <Queue
          label="Captured, not priced"
          count={view.unpriced.length}
          unit={`${view.unpriced.length === 1 ? 'draft' : 'drafts'} from the field`}
          detail={view.unpriced.length === 0
            ? 'Everything the crew raised has a number on it.'
            : 'Put a number on it and it can go out.'}
        />
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: 'minmax(0, 1.62fr) minmax(0, 1fr)',
        gap: 20, alignItems: 'start',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <SectionHead label="Needs you first"
            right={`${formatMoney(openTotal)} open across ${projects.length} ${projects.length === 1 ? 'job' : 'jobs'}`} />
          {queue.length === 0 ? (
            <Empty />
          ) : queue.map((row) => (
            <CoRow
              key={row.co.id}
              row={row}
              meta={`${row.project.name}${row.project.address ? ` · ${row.project.address}` : ''}`}
              onOpen={() => go({ name: 'record', changeOrderId: row.co.id })}
              action={row.display === 'draft' && row.co.amount_cents === null
                ? <Button kind="primary" onClick={() => go({ name: 'record', changeOrderId: row.co.id })}>Price it</Button>
                : undefined}
            />
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <SectionHead label="Job sites" />
            <Card>
              {projects.length === 0 && (
                <div style={{ padding: 16, fontSize: 14.5, color: C.steel }}>
                  No jobs yet. They are created on the phone, at the site.
                </div>
              )}
              {projects.map((p, i) => {
                const open = view.live.filter((r) => r.project.id === p.id && r.display !== 'approved'
                  && r.display !== 'declined').length;
                return (
                  <div key={p.id}
                    onClick={() => go({ name: 'job', projectId: p.id })}
                    role="button" tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') go({ name: 'job', projectId: p.id }); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '13px 15px',
                      borderBottom: i === projects.length - 1 ? 'none' : `1px solid ${C.lineSoft}`,
                      cursor: 'pointer',
                    }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flexGrow: 1 }}>
                      <span style={{
                        fontSize: 15.5, fontWeight: 700, whiteSpace: 'nowrap',
                        overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>{p.name}</span>
                      <span style={{ fontSize: 13, color: C.muted }}>
                        {[p.address, p.client_ref].filter(Boolean).join(' · ') || 'No address on file'}
                      </span>
                    </div>
                    <span style={{
                      flexShrink: 0, minWidth: 24, textAlign: 'right', fontFamily: F.disp,
                      fontSize: 17, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                      color: open > 0 ? C.caution : C.disabled,
                    }}>{open > 0 ? open : '—'}</span>
                  </div>
                );
              })}
            </Card>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <SectionHead label="Who raised what" />
            <Card>
              {members.map((m, i) => {
                const raised = view.live.filter((r) => r.co.owner_id === m.user_id).length;
                return (
                  <div key={m.id} style={{
                    display: 'flex', alignItems: 'center', gap: 11, padding: '12px 15px',
                    borderBottom: i === members.length - 1 ? 'none' : `1px solid ${C.lineSoft}`,
                  }}>
                    <Avatar name={m.display_name ?? '?'} size={34}
                      bg={m.role === 'owner' ? C.ink : m.role === 'crew' ? C.brand : C.savedLocal} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flexGrow: 1 }}>
                      <span style={{ fontSize: 15, fontWeight: 700 }}>
                        {m.display_name ?? 'Unnamed'}
                        {m.role !== 'crew' && (
                          <span style={{ fontWeight: 500, color: C.muted }}> · {m.role}</span>
                        )}
                      </span>
                      <span style={{ fontSize: 12.5, color: C.muted }}>
                        {raised === 0 ? 'Nothing open' : `${raised} open`}
                      </span>
                    </div>
                  </div>
                );
              })}
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

function headline(live: number, onYou: number): string {
  if (live === 0) return 'Nothing is open. Every change order is settled.';
  const what = `${live} change ${live === 1 ? 'order is' : 'orders are'} open.`;
  if (onYou === 0) return `${what} None are waiting on you.`;
  return `${what} ${onYou === live ? 'All' : onYou} ${onYou === 1 ? 'is' : 'are'} on you.`;
}

function SectionHead({ label, right }: { label: string; right?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <Label>{label}</Label>
      <div style={{ flexGrow: 1, height: 1, background: C.line }} />
      {right && <span style={{ fontSize: 13, color: C.muted }}>{right}</span>}
    </div>
  );
}

function Queue({ label, count, unit, detail, tone }: {
  label: string; count: number; unit: string; detail: string; tone?: 'caution';
}) {
  // The caution tint is earned, not decorative: it appears only when the count is
  // non-zero AND the thing being counted is blocked on this office. A permanently
  // amber tile is a tile people stop seeing.
  const hot = tone === 'caution' && count > 0;
  const t = tint.caution;
  return (
    <div style={{
      background: hot ? t.soft : C.raised,
      border: `1px solid ${hot ? t.line : C.line}`,
      borderRadius: 16, padding: '17px 19px 18px 19px',
      display: 'flex', flexDirection: 'column', gap: 9, boxShadow: hot ? undefined : shadow.card,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <Icon d={hot ? PATH.warn : PATH.clock} size={17} color={hot ? t.ink : C.steel} width={2} />
        <Label color={hot ? t.ink : C.steel}>{label}</Label>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{
          fontFamily: F.disp, fontWeight: 700, fontSize: 40, lineHeight: '40px',
          fontVariantNumeric: 'tabular-nums', color: hot ? t.ink : C.ink,
        }}>{count}</span>
        <span style={{ fontSize: 15, fontWeight: 600, color: hot ? t.ink : C.ink }}>{unit}</span>
      </div>
      <span style={{ fontSize: 14, lineHeight: '20px', color: hot ? t.ink : C.steel }}>{detail}</span>
    </div>
  );
}

function Empty() {
  return (
    <div style={{
      padding: '28px 24px', borderRadius: radii.lg, background: C.surfaceMuted,
      border: `1px solid ${C.line}`, display: 'flex', gap: 12, alignItems: 'flex-start',
    }}>
      <Icon d={PATH.check} size={18} color={C.approve} width={2.2} />
      <div style={{ fontSize: 15, lineHeight: '22px', color: C.steel }}>
        <strong style={{ color: C.ink }}>Nothing is waiting on this office.</strong>{' '}
        Everything the crew has raised is priced and out, or already signed.
      </div>
    </div>
  );
}
