/**
 * The console's shared pieces. One definition each, for the reason `extracard.tsx`
 * gives on the phone: the same object drawn three different ways is three chances to
 * be wrong and one chance to be consistent.
 *
 * Styles are inline objects rather than a stylesheet. The design canvas these screens
 * come from is authored the same way, so a value can be carried across without being
 * translated into a class name and back.
 */
import type { CSSProperties, ReactNode } from 'react';
import { C, CHIP_LABEL, F, chipStyle, radii, shadow, tint, type Tone } from './theme.ts';

export function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{
      background: C.raised, border: `1px solid ${C.line}`, borderRadius: radii.lg,
      boxShadow: shadow.card, ...style,
    }}>{children}</div>
  );
}

/** A small uppercase field label. Condensed, letterspaced — the phone's `label`. */
export function Label({ children, color = C.steel }: { children: ReactNode; color?: string }) {
  return (
    <span style={{
      fontFamily: F.disp, fontSize: 12, fontWeight: 600, letterSpacing: 1.6,
      textTransform: 'uppercase', color,
    }}>{children}</span>
  );
}

/**
 * The status chip.
 *
 * Takes the DERIVED status (`LedgerRow.display`), never the stored one. Colour never
 * carries the state alone — the word is always there, per tokens.ts.
 */
export function Chip({ status }: { status: string }) {
  const s = chipStyle(status);
  return (
    <span style={{
      padding: '3px 8px', borderRadius: 4, background: s.bg, color: s.fg,
      border: s.line ? `1px solid ${s.line}` : undefined,
      fontFamily: F.disp, fontSize: 11, fontWeight: 600, letterSpacing: 0.6,
      textTransform: 'uppercase', whiteSpace: 'nowrap',
    }}>{CHIP_LABEL[status] ?? status}</span>
  );
}

/**
 * Money. Tabular figures so digits do not jitter, and the loudest thing on a card.
 *
 * `cents === null` is NOT rendered as $0. A change order with no price yet and one
 * priced at nothing are different facts, and "$0" tells a client the work is free —
 * the same reasoning `erec.errPriceFirst` gives on the phone.
 */
/**
 * A JOB's status, which is not a change order's and must not borrow its chip.
 *
 * `project.status` is ('active' | 'lead' | 'in_progress' | 'complete' | 'archived')
 * — 378's vocabulary, a different set of words about a different thing. Running it
 * through `Chip` rendered an in-progress job as "Draft", which is a change order's
 * word for a change order's state and says something untrue about a job.
 */
export function JobChip({ status }: { status: string }) {
  const skin = status === 'complete'
    ? { bg: C.brandSoft, fg: C.brandDark, line: C.brandLine, text: 'Complete' }
    : status === 'lead'
      ? { bg: C.surfaceMuted, fg: C.steel, line: C.line, text: 'Lead' }
      : { bg: C.surfaceMuted, fg: C.ink, line: C.line, text: 'In progress' };
  return (
    <span style={{
      padding: '4px 9px', borderRadius: 4, background: skin.bg, color: skin.fg,
      border: `1px solid ${skin.line}`, fontFamily: F.disp, fontSize: 11.5,
      fontWeight: 600, letterSpacing: 0.6, textTransform: 'uppercase', whiteSpace: 'nowrap',
    }}>{skin.text}</span>
  );
}

export function Money({ cents, size = 26, muted }: { cents: number | null; size?: number; muted?: boolean }) {
  if (cents === null || cents === undefined) {
    return (
      <span style={{ fontFamily: F.disp, fontSize: size * 0.72, fontWeight: 700, color: C.muted }}>
        No price yet
      </span>
    );
  }
  return (
    <span style={{
      fontFamily: F.disp, fontSize: size, fontWeight: 700, lineHeight: 1,
      fontVariantNumeric: 'tabular-nums', color: muted ? C.steel : C.ink,
    }}>{formatMoney(cents)}</span>
  );
}

/** Whole dollars when it is whole, cents when it is not. Never a float in the maths. */
export function formatMoney(cents: number): string {
  const whole = cents % 100 === 0;
  return `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2,
  })}`;
}

export function Avatar({ name, size = 34, bg = C.ink }: { name: string; size?: number; bg?: string }) {
  return (
    <span style={{
      width: size, height: size, flexShrink: 0, borderRadius: 999, background: bg,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: F.disp, fontSize: size * 0.38, fontWeight: 700, color: C.card,
    }}>{initials(name)}</span>
  );
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

type ButtonKind = 'primary' | 'brand' | 'ghost';

export function Button({
  children, onClick, kind = 'ghost', disabled, title,
}: {
  children: ReactNode; onClick?: () => void; kind?: ButtonKind;
  disabled?: boolean; title?: string;
}) {
  const skin: Record<ButtonKind, CSSProperties> = {
    primary: { background: C.ink, color: C.card, border: `1px solid ${C.ink}` },
    brand: { background: C.brand, color: C.card, border: `1px solid ${C.brand}` },
    ghost: { background: C.card, color: C.ink, border: `1px solid ${C.line}` },
  };
  return (
    <button
      type="button" onClick={onClick} disabled={disabled} title={title}
      style={{
        height: 40, padding: '0 15px', borderRadius: radii.md, fontFamily: F.body,
        fontSize: 14.5, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1, display: 'inline-flex', alignItems: 'center',
        gap: 8, ...skin[kind],
      }}
    >{children}</button>
  );
}

/** A coloured state box. One tint triple per family — never a screen's own amber. */
export function Note({ tone, children }: { tone: Tone; children: ReactNode }) {
  const t = tint[tone];
  return (
    <div style={{
      background: t.soft, border: `1px solid ${t.line}`, borderRadius: 14,
      padding: '13px 15px', color: t.ink, fontSize: 14, lineHeight: '20px',
    }}>{children}</div>
  );
}

/**
 * What the screen says while it is working, and when it has nothing.
 *
 * Separate states on purpose. "Loading" that silently becomes "nothing here" is how a
 * failed query reads as an empty company — which is the failure mode CLIENT-PORTAL.md
 * spends its first section on.
 */
export function Loading({ what }: { what: string }) {
  return <div style={{ padding: 40, color: C.muted, fontSize: 15 }}>Loading {what}…</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div style={{
      padding: '28px 24px', color: C.steel, fontSize: 15, lineHeight: '22px',
      background: C.surfaceMuted, border: `1px solid ${C.line}`, borderRadius: radii.lg,
    }}>{children}</div>
  );
}

/** An error with its text visible. Never a spinner that goes on forever. */
export function Failed({ error, retry }: { error: unknown; retry?: () => void }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div style={{ padding: 24 }}>
      <Note tone="danger">
        <div style={{ fontWeight: 700, marginBottom: 6 }}>That did not load.</div>
        <div style={{ marginBottom: retry ? 12 : 0 }}>{message}</div>
        {retry && <Button onClick={retry}>Try again</Button>}
      </Note>
    </div>
  );
}

/** Stroke icons on a 24 grid. No emoji, ever — they are not the brand's. */
export function Icon({ d, size = 18, color = C.steel, width = 1.8 }: {
  d: string; size?: number; color?: string; width?: number;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth={width} strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0 }}>
      <path d={d} />
    </svg>
  );
}

export const PATH = {
  grid: 'M3 3h7v8H3zM14 3h7v5h-7zM14 11h7v10h-7zM3 14h7v7H3z',
  pin: 'M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11z',
  doc: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4',
  people: 'M12 8a3.6 3.6 0 1 1-7.2 0 3.6 3.6 0 0 1 7.2 0M1.4 20c0-3.5 3.1-5.6 7-5.6s7 2.1 7 5.6',
  chat: 'M20 14a3 3 0 0 1-3 3H8l-4 3.5V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3z',
  send: 'M4 12l16-8-6 16-2.5-6.5z',
  check: 'M5 12.5 10 17.5 19.5 7',
  clock: 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18M12 7.5V12l3 2',
  eye: 'M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12M14.8 12a2.8 2.8 0 1 1-5.6 0 2.8 2.8 0 0 1 5.6 0',
  pencil: 'M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17zM14 6.5 17.5 10',
  lock: 'M4.5 10.5h15v10h-15zM8 10.5V7.5a4 4 0 0 1 8 0v3',
  back: 'M14.5 5 7.5 12l7 7',
  down: 'M12 3v12M7.5 10.5 12 15l4.5-4.5M4 19h16',
  warn: 'M12 4 2.5 20h19zM12 10v4M12 17v.1',
};
