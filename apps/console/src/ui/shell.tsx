/**
 * The frame every screen sits in: the rail, the top bar, and the router.
 *
 * ROUTING IS THE URL HASH, and there is no router library. Five screens, each
 * identified by at most two ids — a dependency to parse that would be more code to
 * audit than the twenty lines below, and the hash keeps the back button, bookmarks and
 * a copy-pasteable link to one change order working for free.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { C, F, radii } from './theme.ts';
import { Avatar, Icon, PATH } from './kit.tsx';

export type Route =
  | { name: 'overview' }
  | { name: 'job'; projectId: string }
  | { name: 'record'; changeOrderId: string }
  | { name: 'client'; projectId: string; changeOrderId?: string }
  | { name: 'crew'; projectId: string };

export function toHash(r: Route): string {
  switch (r.name) {
    case 'overview': return '#/';
    case 'job': return `#/job/${encodeURIComponent(r.projectId)}`;
    case 'record': return `#/co/${encodeURIComponent(r.changeOrderId)}`;
    case 'client': return `#/client/${encodeURIComponent(r.projectId)}`
      + (r.changeOrderId ? `/${encodeURIComponent(r.changeOrderId)}` : '');
    case 'crew': return `#/crew/${encodeURIComponent(r.projectId)}`;
  }
}

/** An unreadable hash lands on the overview rather than a blank page. */
function parseHash(hash: string): Route {
  const p = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (p[0] === 'job' && p[1]) return { name: 'job', projectId: p[1] };
  if (p[0] === 'co' && p[1]) return { name: 'record', changeOrderId: p[1] };
  if (p[0] === 'client' && p[1]) return { name: 'client', projectId: p[1], changeOrderId: p[2] };
  if (p[0] === 'crew' && p[1]) return { name: 'crew', projectId: p[1] };
  return { name: 'overview' };
}

export function useRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return [route, (r: Route) => { window.location.hash = toHash(r); }];
}

function RailItem({ icon, label, active, onClick }: {
  icon: string; label: string; active?: boolean; onClick?: () => void;
}) {
  return (
    <button type="button" onClick={onClick} title={label}
      style={{
        width: 44, height: 44, borderRadius: 11, cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: active ? C.brandSoft : 'transparent',
        border: active ? `1px solid ${C.brandLine}` : '1px solid transparent',
      }}>
      <Icon d={icon} size={20} color={active ? C.brandDark : C.steel} width={active ? 1.9 : 1.8} />
    </button>
  );
}

export function Shell({
  route, go, companyName, userName, onSignOut, breadcrumb, children,
}: {
  route: Route; go: (r: Route) => void;
  companyName: string; userName: string; onSignOut: () => void;
  breadcrumb: ReactNode; children: ReactNode;
}) {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', background: C.paper, color: C.ink,
      fontFamily: F.body, textWrap: 'pretty',
    }}>
      <nav style={{
        width: 68, flexShrink: 0, background: C.surfaceMuted,
        borderRight: `1px solid ${C.line}`, display: 'flex', flexDirection: 'column',
        alignItems: 'center', gap: 6, padding: '18px 0', position: 'sticky', top: 0,
        height: '100vh',
      }}>
        <div style={{
          width: 34, height: 34, borderRadius: 9, background: C.brand, marginBottom: 12,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} title={companyName}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={C.card}
            strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 20V9l8-5 8 5v11" /><path d="M9 20v-6h6v6" />
          </svg>
        </div>
        <RailItem icon={PATH.grid} label="Overview" active={route.name === 'overview'}
          onClick={() => go({ name: 'overview' })} />
        <RailItem icon={PATH.pin} label="Job sites" active={route.name === 'job'}
          onClick={() => go({ name: 'overview' })} />
        <RailItem icon={PATH.doc} label="Change orders" active={route.name === 'record'} />
        <RailItem icon={PATH.chat} label="Conversations"
          active={route.name === 'client' || route.name === 'crew'} />
        <div style={{ marginTop: 'auto' }} title={`${userName} — sign out`}>
          <button type="button" onClick={onSignOut}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            <Avatar name={userName} size={32} />
          </button>
        </div>
      </nav>

      <div style={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <header style={{
          height: 66, flexShrink: 0, borderBottom: `1px solid ${C.line}`, background: C.card,
          display: 'flex', alignItems: 'center', gap: 10, padding: '0 30px',
          position: 'sticky', top: 0, zIndex: 2,
        }}>{breadcrumb}</header>
        <main style={{ flexGrow: 1, minWidth: 0 }}>{children}</main>
      </div>
    </div>
  );
}

/** The breadcrumb, with the crumbs clickable and the last one plain. */
export function Crumbs({ trail, onBack }: {
  trail: Array<{ label: string; go?: () => void }>; onBack?: () => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
      {onBack && (
        <button type="button" onClick={onBack} title="Back"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}>
          <Icon d={PATH.back} size={17} color={C.ink} width={2} />
        </button>
      )}
      {trail.map((c, i) => (
        <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          {i > 0 && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.disabled}
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9.5 5 16.5 12l-7 7" />
            </svg>
          )}
          {c.go ? (
            <button type="button" onClick={c.go} style={{
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              font: 'inherit', fontSize: 14.5, color: C.muted,
            }}>{c.label}</button>
          ) : (
            <span style={{
              fontSize: 14.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>{c.label}</span>
          )}
        </span>
      ))}
    </div>
  );
}

/** A rounded pill used for filters and counts. */
export function Pill({ children, active, onClick }: {
  children: ReactNode; active?: boolean; onClick?: () => void;
}) {
  return (
    <button type="button" onClick={onClick} style={{
      height: 32, padding: '0 12px', borderRadius: radii.pill, cursor: onClick ? 'pointer' : 'default',
      background: active ? C.ink : C.card, color: active ? C.card : C.steel,
      border: `1px solid ${active ? C.ink : C.line}`, font: 'inherit', fontSize: 13.5,
      fontWeight: active ? 700 : 600,
    }}>{children}</button>
  );
}
