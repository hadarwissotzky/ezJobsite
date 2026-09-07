/**
 * The two conversations: with the client, and with the crew.
 *
 * ONE FILE, TWO SCREENS, and they share a message list on purpose — but nothing else.
 * They are not the same conversation with a flag: one leaves the company and lands on a
 * stranger's phone under a link that is a credential, the other never leaves. The
 * chrome differs everywhere that difference matters, and the two composers say plainly
 * who is about to read what.
 */
import { useState } from 'react';
import { C, F, radii } from '../ui/theme.ts';
import { Avatar, Button, Card, Chip, Failed, Icon, Label, Loading, Money, Note, PATH } from '../ui/kit.tsx';
import { shortDate, timeOf } from '../ui/corow.tsx';
import { useAsync } from '../data/useAsync.ts';
import { loadLedger, loadProject, loadTeamComments, loadThreads } from '../data/queries.ts';
import { postClientReply, postTeamComment } from '../data/mutations.ts';
import type { Company, Member } from '../data/types.ts';
import type { Route } from '../ui/shell.tsx';
import { nameOf } from './JobSite.tsx';

// ── the client conversation ─────────────────────────────────────────────────────

export function ClientThread({ projectId, changeOrderId, company, userId, go }: {
  projectId: string; changeOrderId?: string; company: Company; userId: string;
  go: (r: Route) => void;
}) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [parked, setParked] = useState(false);

  const { loading, error, data, reload } = useAsync(async () => {
    const project = await loadProject(projectId);
    if (!project) return null;
    const [messages, rows] = await Promise.all([loadThreads(projectId), loadLedger([project])]);
    return { project, messages, rows };
  }, [projectId]);

  if (loading) return <Loading what="the conversation" />;
  if (error) return <Failed error={error} retry={reload} />;
  if (!data) return <div style={{ padding: 32 }}><Note tone="neutral">This job is not in your company.</Note></div>;

  const { project, messages, rows } = data;
  // Which change order this conversation is about: the one asked for, else the one
  // with an open question, else the most recent thing sent. Never "all of them" — a
  // reply has to land on ONE change order's live link (308) and the person typing has
  // to know which.
  const subject = rows.find((r) => r.co.id === changeOrderId)
    ?? rows.find((r) => r.openQuestions.length > 0)
    ?? rows.find((r) => r.display === 'sent')
    ?? rows[0];

  const shown = subject ? messages.filter((m) => m.change_order_id === subject.co.id) : [];

  async function send() {
    if (!subject) return;
    setBusy(true); setProblem(null); setParked(false);
    try {
      const outcome = await postClientReply(subject.co.id, draft, userId);
      if (outcome === 'no_live_link') {
        // Not an error, and not silence either. 308 returns this when the client has
        // already answered or the version was replaced while this was being typed;
        // there is nothing to retry towards, so the person needs to be told what
        // happened rather than watching a message vanish.
        setParked(true);
      } else {
        setDraft('');
      }
      reload();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const mayReply = company.role === 'owner' || subject?.co.owner_id === userId;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 66px)' }}>
      <div style={{
        flexShrink: 0, borderBottom: `1px solid ${C.line}`, background: C.card,
        display: 'flex', alignItems: 'center', gap: 13, padding: '14px 24px',
      }}>
        <Avatar name={project.client_ref ?? 'Client'} size={42} bg={C.approve} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 18, fontWeight: 700 }}>{project.client_ref ?? 'The client'}</span>
            <span style={{
              padding: '2px 7px', borderRadius: 4, background: C.surfaceMuted, fontFamily: F.disp,
              fontSize: 10.5, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase',
              color: C.steel,
            }}>No account · replies from the link</span>
          </div>
          <span style={{ fontSize: 13.5, color: C.muted }}>{project.name}</span>
        </div>
        <span style={{ marginLeft: 'auto' }} />
        <Button onClick={() => go({ name: 'job', projectId })}>Back to the job</Button>
      </div>

      <div style={{ flexGrow: 1, overflow: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {subject && (
          <Card style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 13 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flexGrow: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  fontFamily: F.disp, fontSize: 12, fontWeight: 700, letterSpacing: 0.8,
                  textTransform: 'uppercase', color: C.brand,
                }}>{subject.co.co_number ? `Change Order #${subject.co.co_number}` : 'Not numbered yet'}</span>
                <Chip status={subject.display} />
              </div>
              <span style={{
                fontSize: 14.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>{subject.co.scope}</span>
            </div>
            <Money cents={subject.co.amount_cents} size={24} />
            <Button onClick={() => go({ name: 'record', changeOrderId: subject.co.id })}>Open</Button>
          </Card>
        )}

        {shown.length === 0 && (
          <Note tone="neutral">
            Nothing has been said on this one yet. The client can ask a question from
            the approval link at any time, and it lands here.
          </Note>
        )}

        {shown.map((m) => {
          const at = new Date(m.at).getTime();
          const client = m.side === 'client';
          return (
            <div key={m.id} style={{
              display: 'flex', flexDirection: 'column', gap: 5, maxWidth: 620,
              alignSelf: client ? 'flex-start' : 'flex-end',
              alignItems: client ? 'flex-start' : 'flex-end',
            }}>
              <div style={{
                background: client ? C.raised : C.ink,
                color: client ? C.ink : C.card,
                border: client ? `1px solid ${C.line}` : 'none',
                borderRadius: client ? '4px 16px 16px 16px' : '16px 16px 4px 16px',
                padding: '13px 15px', fontSize: 16, lineHeight: '24px',
              }}>{m.body}</div>
              <span style={{ fontSize: 12.5, color: C.muted }}>
                {client ? (project.client_ref ?? 'The client') : 'This office'} ·{' '}
                {shortDate(at)}, {timeOf(at)}
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ flexShrink: 0, padding: '12px 24px 20px 24px' }}>
        {parked && (
          <div style={{ marginBottom: 10 }}>
            <Note tone="caution">
              <strong>That did not go out, and nothing was lost.</strong> This change
              order has no live link any more — the client answered it, or a newer
              version replaced it while you were typing. Open the record to see where it
              actually stands.
            </Note>
          </div>
        )}
        {problem && <div style={{ marginBottom: 10 }}><Note tone="danger">{problem}</Note></div>}
        {!mayReply ? (
          <Note tone="neutral">
            Only the company owner can answer the client on a teammate's change order.
            You can read the conversation.
          </Note>
        ) : (
          <Card style={{ padding: '13px 15px', display: 'flex', flexDirection: 'column', gap: 11 }}>
            <textarea
              value={draft} onChange={(e) => setDraft(e.target.value)} rows={3}
              placeholder={subject
                ? `Answer ${project.client_ref ?? 'the client'} about ${
                  subject.co.co_number ? `#${subject.co.co_number}` : 'this change order'}…`
                : 'Nothing to reply to yet'}
              disabled={!subject}
              style={{
                border: 'none', outline: 'none', resize: 'vertical', font: 'inherit',
                fontSize: 16, lineHeight: '24px', color: C.ink, background: 'transparent',
              }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Icon d={PATH.send} size={15} color={C.muted} width={1.9} />
              <span style={{ fontSize: 13, color: C.muted }}>
                Goes to their phone. They read it on the same link they would sign from.
              </span>
              <span style={{ marginLeft: 'auto' }} />
              <Button kind="primary" onClick={send} disabled={busy || !draft.trim() || !subject}>
                {busy ? 'Sending…' : `Send to ${project.client_ref ?? 'the client'}`}
              </Button>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

// ── the crew conversation ───────────────────────────────────────────────────────

export function CrewThread({ projectId, members, userId, go }: {
  projectId: string; members: Member[]; userId: string; go: (r: Route) => void;
}) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [onCo, setOnCo] = useState<string | null>(null);

  const { loading, error, data, reload } = useAsync(async () => {
    const project = await loadProject(projectId);
    if (!project) return null;
    const [comments, rows] = await Promise.all([
      loadTeamComments(projectId), loadLedger([project]),
    ]);
    return { project, comments, rows };
  }, [projectId]);

  if (loading) return <Loading what="the crew thread" />;
  if (error) return <Failed error={error} retry={reload} />;
  if (!data) return <div style={{ padding: 32 }}><Note tone="neutral">This job is not in your company.</Note></div>;

  const { project, comments, rows } = data;
  const target = onCo ?? rows[0]?.co.id ?? null;
  const me = members.find((m) => m.user_id === userId);

  async function send() {
    if (!target) return;
    setBusy(true); setProblem(null);
    try {
      await postTeamComment(target, projectId, userId, me?.display_name ?? null, draft);
      setDraft('');
      reload();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 66px)' }}>
      <div style={{
        flexShrink: 0, borderBottom: `1px solid ${C.line}`, background: C.card,
        display: 'flex', alignItems: 'center', gap: 13, padding: '14px 24px',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 18, fontWeight: 700 }}>{project.name} · the crew</span>
          <span style={{ fontSize: 13.5, color: C.muted }}>
            Everyone in the company sees this. The client does not.
          </span>
        </div>
        <span style={{ marginLeft: 'auto' }} />
        <Button onClick={() => go({ name: 'job', projectId })}>Back to the job</Button>
      </div>

      <div style={{ flexGrow: 1, overflow: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 15 }}>
        {rows.length > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
            <Label>Talking about</Label>
            {rows.slice(0, 6).map((r) => (
              <button key={r.co.id} type="button" onClick={() => setOnCo(r.co.id)}
                style={{
                  height: 30, padding: '0 11px', borderRadius: radii.pill, cursor: 'pointer',
                  font: 'inherit', fontSize: 13, fontWeight: target === r.co.id ? 700 : 500,
                  background: target === r.co.id ? C.ink : C.card,
                  color: target === r.co.id ? C.card : C.steel,
                  border: `1px solid ${target === r.co.id ? C.ink : C.line}`,
                }}>
                {r.co.co_number ? `#${r.co.co_number}` : 'Draft'} · {truncate(r.co.scope, 34)}
              </button>
            ))}
          </div>
        )}

        {comments.length === 0 && (
          <Note tone="neutral">
            Nothing said here yet. Messages are tied to a change order, so a year from
            now the conversation still sits with the work it was about.
          </Note>
        )}

        {comments.map((m) => {
          const mine = m.author_id === userId;
          const co = rows.find((r) => r.co.id === m.change_order_id);
          return (
            <div key={m.id} style={{
              display: 'flex', gap: 11, maxWidth: 640,
              alignSelf: mine ? 'flex-end' : 'flex-start',
              flexDirection: mine ? 'row-reverse' : 'row',
            }}>
              {!mine && <Avatar name={m.author_name ?? nameOf(members, m.author_id)} size={34} />}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
                <div style={{
                  display: 'flex', alignItems: 'baseline', gap: 8,
                  justifyContent: mine ? 'flex-end' : 'flex-start',
                }}>
                  <span style={{ fontSize: 14.5, fontWeight: 700 }}>
                    {mine ? 'You' : (m.author_name ?? nameOf(members, m.author_id))}
                  </span>
                  <span style={{ fontSize: 12.5, color: C.muted }}>
                    {shortDate(m.at_ms)}, {timeOf(m.at_ms)}
                  </span>
                </div>
                <div style={{
                  background: mine ? C.ink : C.raised, color: mine ? C.card : C.ink,
                  border: mine ? 'none' : `1px solid ${C.line}`,
                  borderRadius: mine ? '16px 16px 4px 16px' : '4px 16px 16px 16px',
                  padding: '13px 15px', fontSize: 16, lineHeight: '24px',
                }}>{m.body}</div>
                {co && (
                  <button type="button" onClick={() => go({ name: 'record', changeOrderId: co.co.id })}
                    style={{
                      background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                      font: 'inherit', fontSize: 12.5, color: C.brand,
                      textAlign: mine ? 'right' : 'left',
                    }}>
                    on {co.co.co_number ? `#${co.co.co_number}` : 'a draft'} · {truncate(co.co.scope, 44)}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ flexShrink: 0, padding: '12px 24px 20px 24px' }}>
        {problem && <div style={{ marginBottom: 10 }}><Note tone="danger">{problem}</Note></div>}
        {!target ? (
          <Note tone="neutral">
            Nothing has been captured on this job yet, so there is nothing to talk about
            here. A crew message is attached to a change order, never floating loose.
          </Note>
        ) : (
          <Card style={{ padding: '13px 15px', display: 'flex', flexDirection: 'column', gap: 11 }}>
            <textarea
              value={draft} onChange={(e) => setDraft(e.target.value)} rows={2}
              placeholder="Write to everyone on this job…"
              style={{
                border: 'none', outline: 'none', resize: 'vertical', font: 'inherit',
                fontSize: 16, lineHeight: '24px', color: C.ink, background: 'transparent',
              }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Icon d={PATH.people} size={15} color={C.muted} width={1.9} />
              <span style={{ fontSize: 13, color: C.muted }}>
                Lands on the crew's phones. Once sent it cannot be edited or deleted.
              </span>
              <span style={{ marginLeft: 'auto' }} />
              <Button kind="primary" onClick={send} disabled={busy || !draft.trim()}>
                {busy ? 'Sending…' : 'Send'}
              </Button>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
