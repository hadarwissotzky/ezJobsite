/**
 * ONE ROW FOR ONE CHANGE ORDER — the overview and the job screen both use this.
 *
 * The same reasoning as `extracard.tsx` on the phone, which exists because the same
 * object was drawn three different ways: "Reading the same extra on two screens and
 * seeing two different objects is the exact confusion this card was designed to end.
 * And a fix applied to one copy silently did not reach the other two."
 *
 * WHAT THE CALLER DECIDES, AND WHAT IT DOES NOT. Layout, type and spacing are fixed
 * here. The META line is the caller's, because the two screens genuinely answer
 * different questions: inside one job every row shares the address, so the meta says
 * who raised it and when; on the overview the rows span jobs, so the job name has to
 * come first. Forcing one meta on both would make one of them lie by omission.
 */
import { C, F, radii, shadow } from './theme.ts';
import { Chip, Icon, Money, PATH } from './kit.tsx';
import type { LedgerRow } from '../data/types.ts';

export function CoRow({ row, meta, onOpen, action }: {
  row: LedgerRow;
  meta: string;
  onOpen: () => void;
  action?: React.ReactNode;
}) {
  const { co, display, openQuestions, opened, times } = row;

  // The kicker. A change order has no number until the server assigns one at send
  // (419), so a draft genuinely has none — and saying "Change Order #—" would invent
  // a shape for something that does not exist yet.
  const kicker = co.co_number ? `Change Order #${co.co_number}` : 'Not numbered yet';

  // The one line under the meta that says what is actually owed, and by whom. At most
  // one shows: a question the client is waiting on outranks the fact that they opened
  // the link, which outranks how long it has been sitting.
  const signal = openQuestions.length > 0
    ? { color: C.caution, icon: PATH.chat, text: openQuestions.length === 1
        ? 'The client asked a question — they are waiting on you'
        : `${openQuestions.length} questions from the client, unanswered` }
    : opened?.viewed && display === 'sent'
      ? { color: C.savedLocal, icon: PATH.eye, text: `Opened by the client${
          opened.first_opened_at_ms ? ` on ${shortDate(opened.first_opened_at_ms)}` : ''
        }, no answer yet` }
      : display === 'sent' && times?.sent_at_ms
        ? { color: C.muted, icon: PATH.clock, text: `Sent ${daysAgo(times.sent_at_ms)}, not opened` }
        : display === 'approved' && times?.approved_at_ms
          ? { color: C.approve, icon: PATH.check, text: `Signed ${shortDate(times.approved_at_ms)} — ready to bill` }
          : null;

  return (
    <div
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}
      style={{
        background: C.raised, border: `1px solid ${C.line}`, borderRadius: radii.lg,
        padding: 14, display: 'flex', gap: 14, boxShadow: shadow.card, cursor: 'pointer',
        // A retired row recedes rather than competing for the same attention as a live
        // one, and is still perfectly readable.
        opacity: display === 'superseded' || display === 'cancelled' ? 0.72 : 1,
      }}
    >
      <div style={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{
            fontFamily: F.disp, fontSize: 13, fontWeight: 700, letterSpacing: 0.8,
            textTransform: 'uppercase', color: C.brand,
          }}>{kicker}</span>
          <Chip status={display} />
          {co.is_mini === 1 && (
            <span style={{ fontSize: 12.5, color: C.muted }}>mini</span>
          )}
        </div>

        <span style={{
          fontSize: 17, fontWeight: 700, lineHeight: '22px', whiteSpace: 'nowrap',
          overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{co.scope}</span>

        <span style={{ fontSize: 13.5, color: C.muted }}>{meta}</span>

        {signal && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon d={signal.icon} size={15} color={signal.color} width={1.9} />
            <span style={{
              fontSize: 13.5, color: signal.color,
              fontWeight: signal.color === C.caution ? 600 : 400,
            }}>{signal.text}</span>
          </div>
        )}
      </div>

      <div style={{
        flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
        justifyContent: 'space-between', gap: 8, paddingLeft: 6,
      }}>
        <Money cents={co.amount_cents} size={28} />
        {action ?? (
          <span style={{ fontSize: 12.5, color: C.muted }}>
            {co.nte_cents ? `Not to exceed ${(co.nte_cents / 100).toLocaleString('en-US', {
              style: 'currency', currency: 'USD', maximumFractionDigits: 0,
            })}` : co.amount_cents !== null ? 'Fixed price' : ''}
          </span>
        )}
      </div>
    </div>
  );
}

export function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
}

export function timeOf(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** "4 days ago" / "yesterday" / "today". Plain words — this is read, not calculated. */
export function daysAgo(ms: number): string {
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'over a week ago';
  return `${Math.floor(days / 7)} weeks ago`;
}
