/**
 * The change order itself — open, and editable while it is still a draft.
 *
 * THE EDITING RULE IS THE DATABASE'S, AND THIS SCREEN SAYS IT OUT LOUD. 383's trigger
 * freezes the seven terms the moment a change order is sent, and 427 grants the office
 * UPDATE without loosening that. So the fields here are editable exactly while the
 * stored status is 'draft', and once it is not, the screen explains what changed rather
 * than presenting inputs that would be refused on save.
 *
 * MANDATE #6 IS DRAWN, NOT DESCRIBED. "Numbers/prices/measurements are the highest-risk
 * field. Never trust them from the transcript. Read-back + on-screen tap-to-correct."
 * Editing the total raises a read-back the person has to confirm before it saves.
 */
import { useEffect, useState } from 'react';
import { C, F, radii } from '../ui/theme.ts';
import {
  Avatar, Button, Card, Chip, Failed, Icon, Label, Loading, Money, Note, PATH, formatMoney,
} from '../ui/kit.tsx';
import { shortDate, timeOf } from '../ui/corow.tsx';
import { useAsync } from '../data/useAsync.ts';
import {
  loadChangeOrder, loadOpenQuestions, loadOpenSignals, loadProject, loadStateTimes,
} from '../data/queries.ts';
import { savePrice, saveScope } from '../data/mutations.ts';
import { displayStatus } from '../shared/extrastatus.ts';
import type { Company, LineItem, Member } from '../data/types.ts';
import type { Route } from '../ui/shell.tsx';
import { nameOf } from './JobSite.tsx';

export function Record({ changeOrderId, company, members, userId, go }: {
  changeOrderId: string; company: Company; members: Member[]; userId: string;
  go: (r: Route) => void;
}) {
  const { loading, error, data, reload } = useAsync(async () => {
    const co = await loadChangeOrder(changeOrderId);
    if (!co) return null;
    const [project, questions, times, opens] = await Promise.all([
      loadProject(co.project_id),
      loadOpenQuestions(co.project_id),
      loadStateTimes(co.project_id),
      loadOpenSignals(co.project_id),
    ]);
    return {
      co, project,
      questions: questions.filter((q) => q.change_order_id === co.id),
      times: times.find((t) => t.change_order_id === co.id) ?? null,
      opened: opens.find((o) => o.change_order_id === co.id) ?? null,
    };
  }, [changeOrderId]);

  if (loading) return <Loading what="this change order" />;
  if (error) return <Failed error={error} retry={reload} />;
  if (!data) {
    return (
      <div style={{ padding: 32 }}>
        <Note tone="neutral">
          This change order is not in your company, or it has been removed. Nothing was loaded.
        </Note>
      </div>
    );
  }

  const { co, project, questions, times, opened } = data;
  const display = displayStatus(co.status, { openQuestions: questions.length });
  const isDraft = co.status === 'draft';
  // WHO MAY EDIT, matching the database rather than guessing at it. Two policies grant
  // UPDATE on a change_order and this is their union: `co_own` (030) for the person who
  // raised it, and `co_office_update` (427) for the company owner on any job of theirs.
  // Showing an editor to anyone else would be a lie with a save-button delay in it.
  const mayEdit = isDraft && (company.role === 'owner' || co.owner_id === userId);

  return (
    <div style={{ padding: '24px 30px 40px 30px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              fontFamily: F.disp, fontSize: 13, fontWeight: 700, letterSpacing: 1.1,
              textTransform: 'uppercase', color: C.brand,
            }}>
              {co.co_number ? `Change Order #${co.co_number}` : 'Not numbered yet'}
              {co.extra_type ? ` · ${co.extra_type}` : ''}
            </span>
            <Chip status={display} />
          </div>
          <h1 style={{
            margin: 0, fontSize: 28, fontWeight: 800, letterSpacing: -0.4,
            lineHeight: '33px', maxWidth: 760,
          }}>{co.scope}</h1>
        </div>
        <div style={{
          marginLeft: 'auto', flexShrink: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'flex-end', gap: 3,
        }}>
          <Label>{co.nte_cents ? 'Your quote · not to exceed' : 'Your quote · fixed price'}</Label>
          <Money cents={co.amount_cents} size={44} />
        </div>
      </div>

      {!isDraft && (
        <Note tone="neutral">
          <strong>This change order has left the office.</strong> Its wording, price and
          terms are frozen as the client saw them — that frozen copy is what a signature
          binds. A change from here goes out as a new version, and both stay on file.
        </Note>
      )}

      <div style={{
        display: 'grid', gridTemplateColumns: 'minmax(0, 1.62fr) minmax(0, 1fr)',
        gap: 20, alignItems: 'start',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <ScopeCard co={co} mayEdit={mayEdit} onSaved={reload} />
          <PriceCard co={co} mayEdit={mayEdit} onSaved={reload} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card style={{ padding: '17px 18px', display: 'flex', flexDirection: 'column', gap: 13 }}>
            <Label>Where it stands</Label>
            {questions.length > 0 ? (
              <Note tone="danger">
                <div style={{ fontWeight: 700, marginBottom: 6 }}>
                  {project?.client_ref ?? 'The client'} is waiting on you
                </div>
                <div style={{ marginBottom: 10 }}>
                  {questions.length === 1
                    ? `They asked: “${questions[0].note}”`
                    : `${questions.length} questions are unanswered.`}
                  {' '}Nothing moves until it is answered.
                </div>
                <Button kind="primary" onClick={() => project && go({
                  name: 'client', projectId: project.id, changeOrderId: co.id,
                })}>
                  <Icon d={PATH.chat} size={16} color={C.card} width={1.9} /> Open the conversation
                </Button>
              </Note>
            ) : (
              <span style={{ fontSize: 14, color: C.steel }}>
                {display === 'draft'
                  ? 'Not sent. Nobody outside this company has seen it.'
                  : 'No open questions.'}
              </span>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Step done={!!times?.sent_at_ms}
                text={times?.sent_at_ms
                  ? `Sent to the client · ${shortDate(times.sent_at_ms)}, ${timeOf(times.sent_at_ms)}`
                  : 'Sent to the client — not yet'} />
              <Step done={!!opened?.viewed}
                text={opened?.viewed && opened.first_opened_at_ms
                  ? `They opened it · ${shortDate(opened.first_opened_at_ms)}, ${timeOf(opened.first_opened_at_ms)}`
                  : 'They opened it — not yet'} />
              <Step done={!!times?.approved_at_ms}
                text={times?.approved_at_ms
                  ? `Signed · ${shortDate(times.approved_at_ms)}`
                  : times?.declined_at_ms
                    ? `Declined · ${shortDate(times.declined_at_ms)}`
                    : 'Signed — not yet'} />
            </div>
          </Card>

          <Card style={{ padding: '17px 18px', display: 'flex', flexDirection: 'column', gap: 13 }}>
            <Label>People on this record</Label>
            <Person name={nameOf(members, co.owner_id)} role="Captured it on site"
              when={`${shortDate(new Date(co.created_at).getTime())}, ${timeOf(new Date(co.created_at).getTime())}`}
              bg={C.ink} />
            {co.who_directed && (
              <Person name={co.who_directed} role="Directed this extra" bg={C.brand} />
            )}
            {project?.client_ref && (
              <Person name={project.client_ref} role="The one who signs" bg={C.approve} />
            )}
          </Card>

          {project && (
            <Card style={{ padding: '17px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Label>Talk about it</Label>
              <Button onClick={() => go({ name: 'client', projectId: project.id, changeOrderId: co.id })}>
                <Icon d={PATH.chat} size={16} color={C.ink} width={1.9} /> The client
              </Button>
              <Button onClick={() => go({ name: 'crew', projectId: project.id })}>
                <Icon d={PATH.people} size={16} color={C.ink} width={1.9} /> The crew
              </Button>
            </Card>
          )}

          <div style={{
            background: C.surfaceMuted, border: `1px solid ${C.line}`, borderRadius: radii.md,
            padding: '13px 15px', display: 'flex', gap: 10, alignItems: 'flex-start',
          }}>
            <Icon d={PATH.lock} size={17} color={C.steel} width={1.9} />
            <span style={{ fontSize: 13.5, lineHeight: '19px', color: C.steel }}>
              The moment this is signed it freezes. Anything changed after that goes out as
              a new version, and both stay on file.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The wording the client reads. Editable while it is a draft, and not after. */
function ScopeCard({ co, mayEdit, onSaved }: {
  co: { id: string; scope: string; scope_of_work: string | null };
  mayEdit: boolean; onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(co.scope);
  const [body, setBody] = useState(co.scope_of_work ?? '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // A reload that brings back different text must not be overwritten by stale state
  // sitting in this component from before the navigation.
  useEffect(() => { setTitle(co.scope); setBody(co.scope_of_work ?? ''); }, [co.id, co.scope, co.scope_of_work]);

  async function save() {
    setBusy(true); setProblem(null);
    try {
      await saveScope(co.id, title, body);
      setEditing(false);
      onSaved();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ padding: '17px 18px 18px 18px', display: 'flex', flexDirection: 'column', gap: 11 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Label>Summary of the change</Label>
        <span style={{ marginLeft: 'auto', fontSize: 13, color: C.muted }}>
          This is the text the client reads.
        </span>
      </div>

      {editing ? (
        <>
          <input value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="One line: what the work is"
            style={inputStyle} />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5}
            placeholder="The detail the client should read before they sign."
            style={{ ...inputStyle, resize: 'vertical', lineHeight: '25px' }} />
          {problem && <Note tone="danger">{problem}</Note>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{ marginLeft: 'auto' }} />
            <Button onClick={() => { setEditing(false); setProblem(null); }}>Cancel</Button>
            <Button kind="brand" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Keep this wording'}
            </Button>
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 16.5, lineHeight: '25px' }}>
            {co.scope_of_work?.trim() || co.scope}
          </div>
          {mayEdit && (
            <div style={{ display: 'flex' }}>
              <span style={{ marginLeft: 'auto' }} />
              <Button onClick={() => setEditing(true)}>
                <Icon d={PATH.pencil} size={15} color={C.ink} width={1.9} /> Edit the wording
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

/**
 * The price and its breakdown.
 *
 * The read-back is not a confirm dialog for its own sake. Mandate #6 exists because a
 * transcribed number is the single most likely thing on this record to be wrong, and
 * the cost of being wrong is a figure a client signs. So the number is shown back in
 * words the person has to agree with before it is stored.
 */
function PriceCard({ co, mayEdit, onSaved }: {
  co: { id: string; amount_cents: number | null; line_items: LineItem[] | null; nte_cents: number | null };
  mayEdit: boolean; onSaved: () => void;
}) {
  const lines = co.line_items ?? [];
  const [editing, setEditing] = useState(false);
  const [dollars, setDollars] = useState(co.amount_cents === null ? '' : (co.amount_cents / 100).toFixed(2));
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    setDollars(co.amount_cents === null ? '' : (co.amount_cents / 100).toFixed(2));
  }, [co.id, co.amount_cents]);

  const parsed = parseDollars(dollars);

  async function save() {
    if (parsed === null) return;
    setBusy(true); setProblem(null);
    try {
      // The breakdown has to keep adding up (070's constraint). Editing only the total
      // while lines exist would be refused by the database, so it is refused here with
      // a sentence that says which two numbers disagree.
      await savePrice(co.id, parsed, lines);
      setEditing(false); setConfirming(false);
      onSaved();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ padding: '17px 18px 18px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Label>How the price breaks down</Label>
        <span style={{ marginLeft: 'auto', fontSize: 13, color: C.muted }}>
          The client sees these lines too
        </span>
      </div>

      {lines.length === 0 ? (
        <span style={{ fontSize: 14.5, color: C.steel }}>
          One price for the whole job — no parts on this one.
        </span>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <Row head cells={['Part of the work', 'Qty', 'Each', 'Line total']} />
          {lines.map((l, i) => (
            <Row key={i} cells={[
              l.description, String(l.qty), formatMoney(l.unit_cents), formatMoney(l.total_cents),
            ]} />
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, paddingTop: 4 }}>
        <Label>Total</Label>
        {editing ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: F.disp, fontSize: 22, fontWeight: 700, color: C.steel }}>$</span>
            <input value={dollars} onChange={(e) => { setDollars(e.target.value); setConfirming(false); }}
              inputMode="decimal" placeholder="0.00"
              style={{ ...inputStyle, width: 160, fontFamily: F.disp, fontSize: 22, fontWeight: 700 }} />
          </div>
        ) : (
          <Money cents={co.amount_cents} size={28} />
        )}
        {co.nte_cents !== null && !editing && (
          <span style={{ fontSize: 13.5, color: C.steel }}>
            Not to exceed {formatMoney(co.nte_cents)}
          </span>
        )}
        <span style={{ marginLeft: 'auto' }} />
        {mayEdit && !editing && (
          <Button onClick={() => setEditing(true)}>
            {co.amount_cents === null ? 'Put a price on it' : 'Change the price'}
          </Button>
        )}
      </div>

      {editing && (
        <>
          {parsed === null && dollars.trim() !== '' && (
            <Note tone="danger">
              That is not a price. Type it in dollars and cents, like 1450 or 1450.00.
            </Note>
          )}
          {problem && <Note tone="danger">{problem}</Note>}

          {/* THE READ-BACK. Mandate #6: a price is never stored from a field the
              person has not agreed with, in words, one more time. */}
          {confirming && parsed !== null && (
            <Note tone="caution">
              <div style={{ fontWeight: 700, marginBottom: 4 }}>
                Read it back: {formatMoney(parsed)}.
              </div>
              This is the figure the client will be asked to sign. If it is wrong,
              it is wrong on the document that decides who pays.
            </Note>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{ marginLeft: 'auto' }} />
            <Button onClick={() => { setEditing(false); setConfirming(false); setProblem(null); }}>
              Cancel
            </Button>
            {confirming ? (
              <Button kind="brand" onClick={save} disabled={busy || parsed === null}>
                {busy ? 'Saving…' : 'Yes, that is the price'}
              </Button>
            ) : (
              <Button kind="primary" onClick={() => setConfirming(true)} disabled={parsed === null}>
                Save the price
              </Button>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

/**
 * Dollars typed by a person, to whole cents. Returns null for anything that is not a
 * price — deliberately not a lenient parse: `parseFloat('12abc')` is 12, and silently
 * accepting that would store a number nobody typed.
 */
export function parseDollars(s: string): number | null {
  const t = s.trim().replace(/[$,]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(parseFloat(t) * 100);
}

const inputStyle: React.CSSProperties = {
  border: `2px solid ${C.focus}`, borderRadius: radii.md, background: '#FFFFFF',
  padding: '11px 13px', font: 'inherit', fontSize: 16.5, color: C.ink, outline: 'none',
  width: '100%', boxSizing: 'border-box',
};

function Row({ cells, head }: { cells: string[]; head?: boolean }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 68px 108px 116px', gap: 10,
      alignItems: 'center', padding: head ? '0 4px 8px 4px' : '11px 4px',
      borderBottom: `1px solid ${head ? C.line : C.lineSoft}`,
    }}>
      {cells.map((c, i) => (
        <span key={i} style={head ? {
          fontFamily: F.disp, fontSize: 11.5, fontWeight: 600, letterSpacing: 1.4,
          textTransform: 'uppercase', color: C.muted, textAlign: i === 0 ? 'left' : 'right',
        } : {
          textAlign: i === 0 ? 'left' : 'right',
          fontVariantNumeric: 'tabular-nums',
          // The line total is the figure people scan for, so it carries the condensed
          // face and the extra two points. The rest is body type.
          fontFamily: i === 3 ? F.disp : F.body,
          fontWeight: i === 3 ? 700 : 400,
          fontSize: i === 3 ? 18 : 15,
          color: i === 0 || i === 3 ? C.ink : C.steel,
        }}>{c}</span>
      ))}
    </div>
  );
}

function Step({ done, text }: { done: boolean; text: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
      {done
        ? <Icon d={PATH.check} size={15} color={C.approve} width={2.4} />
        : <span style={{
            width: 15, height: 15, borderRadius: 999, border: `2px solid ${C.line}`, flexShrink: 0,
          }} />}
      <span style={{ fontSize: 14, color: done ? C.steel : C.disabled }}>{text}</span>
    </div>
  );
}

function Person({ name, role, when, bg }: {
  name: string; role: string; when?: string; bg: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11 }}>
      <Avatar name={name} size={36} bg={bg} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ fontSize: 15, fontWeight: 700 }}>{name}</span>
        <span style={{ fontSize: 13, color: C.muted }}>{role}{when ? ` · ${when}` : ''}</span>
      </div>
    </div>
  );
}
