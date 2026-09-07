/**
 * Session, company, and which screen is showing.
 *
 * THE COMPANY IS LOADED ONCE, HERE. Every screen needs the roster (to turn an owner_id
 * into a person's name) and the caller's role (to know whether to offer an editor the
 * database would refuse). Loading it per screen would mean four copies of the same
 * request and four chances for two screens to disagree about who somebody is.
 */
import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, signIn, signOut, takeAuthError } from './supabase.ts';
import { C, F } from './ui/theme.ts';
import { Button, Failed, Loading, Note } from './ui/kit.tsx';
import { Crumbs, Shell, useRoute } from './ui/shell.tsx';
import { useAsync } from './data/useAsync.ts';
import { loadMembers, loadMyCompany, loadProject } from './data/queries.ts';
import { Overview } from './screens/Overview.tsx';
import { JobSite } from './screens/JobSite.tsx';
import { Record } from './screens/Record.tsx';
import { ClientThread, CrewThread } from './screens/Threads.tsx';

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // getSession first, THEN subscribe. Subscribing alone leaves a returning visitor on
    // the sign-in screen until something happens to fire an auth event — which, on a
    // tab that already holds a valid token, is nothing.
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!ready) return <Splash>Checking your sign-in…</Splash>;
  if (!session) return <SignIn />;
  return <SignedIn session={session} />;
}

function SignedIn({ session }: { session: Session }) {
  const [route, go] = useRoute();
  const { loading, error, data, reload } = useAsync(async () => {
    const company = await loadMyCompany();
    if (!company) return null;
    return { company, members: await loadMembers(company.id) };
  }, [session.user.id]);

  // The breadcrumb needs the job's name, and only two routes carry a project id.
  const projectId = route.name === 'job' || route.name === 'client' || route.name === 'crew'
    ? route.projectId : null;
  const crumbJob = useAsync(
    async () => (projectId ? await loadProject(projectId) : null),
    [projectId],
  );

  if (loading) return <Splash>Loading your company…</Splash>;
  if (error) return <Failed error={error} retry={reload} />;

  if (!data) {
    // A real state, not an error: signed in, no company. It happens to anyone who opens
    // the console before finishing setup on their phone.
    return (
      <Splash>
        <div style={{ maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Note tone="neutral">
            <strong>You are signed in, but you are not on a company yet.</strong>
            <div style={{ marginTop: 8 }}>
              Companies are created in the EZjobsite app on your phone, and the crew joins
              by invite. Once that is done, this console will show their work.
            </div>
          </Note>
          <Button onClick={() => signOut()}>Sign out</Button>
        </div>
      </Splash>
    );
  }

  const { company, members } = data;
  const userName = members.find((m) => m.user_id === session.user.id)?.display_name
    ?? session.user.email ?? 'You';

  const jobName = crumbJob.data?.name ?? 'Job';
  const trail: Array<{ label: string; go?: () => void }> =
    route.name === 'overview' ? [{ label: company.name }]
    : route.name === 'job' ? [{ label: 'Job sites', go: () => go({ name: 'overview' }) }, { label: jobName }]
    : route.name === 'record' ? [
        { label: 'Job sites', go: () => go({ name: 'overview' }) },
        { label: 'Change order' },
      ]
    : route.name === 'client' ? [
        { label: jobName, go: () => go({ name: 'job', projectId: route.projectId }) },
        { label: 'The client' },
      ]
    : [
        { label: jobName, go: () => go({ name: 'job', projectId: route.projectId }) },
        { label: 'The crew' },
      ];

  return (
    <Shell
      route={route} go={go} companyName={company.name} userName={userName}
      onSignOut={() => signOut()}
      breadcrumb={
        <>
          <Crumbs trail={trail} onBack={route.name === 'overview' ? undefined
            : () => window.history.back()} />
          <span style={{ marginLeft: 'auto', fontSize: 13.5, color: C.muted }}>
            {company.name} · {company.role === 'owner' ? 'Owner' : `${company.role} · read-mostly`}
          </span>
        </>
      }
    >
      {route.name === 'overview' && <Overview company={company} members={members} go={go} />}
      {route.name === 'job' && <JobSite projectId={route.projectId} members={members} go={go} />}
      {route.name === 'record' && (
        <Record changeOrderId={route.changeOrderId} company={company} members={members}
          userId={session.user.id} go={go} />
      )}
      {/* KEYED BY ROUTE IDENTITY (code review 2026-09-07): crew->crew or
          client->client route changes reconciled the same component in place, so
          state survived the jump -- CrewThread's `onCo` could hold project A's
          change order while send() posted it with project B's projectId, writing
          an append-only co_comment whose two ids belong to different projects
          (co_comment has no FK on change_order_id and no cross-check). A key makes
          a different project a different component: fresh state, no carry-over.
          ClientThread's carried `draft` was the same class on a client-facing
          message. */}
      {route.name === 'client' && (
        <ClientThread key={`${route.projectId}:${route.changeOrderId ?? ''}`}
          projectId={route.projectId} changeOrderId={route.changeOrderId}
          company={company} userId={session.user.id} go={go} />
      )}
      {route.name === 'crew' && (
        <CrewThread key={route.projectId} projectId={route.projectId} members={members}
          userId={session.user.id} go={go} />
      )}
    </Shell>
  );
}

function SignIn() {
  // Read once, on mount. `takeAuthError` strips the params as it reads them, so calling
  // it during render would return the message the first time and null on every
  // re-render — the notice would flash and vanish.
  const [problem, setProblem] = useState<string | null>(() => takeAuthError());
  const [going, setGoing] = useState(false);

  async function attempt(provider: 'google' | 'apple') {
    setProblem(null);
    setGoing(true);
    try {
      await signIn(provider);
      // On success the browser is already leaving for the provider. If it is still
      // here a moment later, the redirect did not happen and silence is the wrong
      // answer — that is the state this whole screen was failing to report.
      window.setTimeout(() => setGoing(false), 4000);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
      setGoing(false);
    }
  }
  return (
    <Splash>
      <div style={{ maxWidth: 380, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h1 style={{ margin: 0, fontSize: 30, fontWeight: 800, letterSpacing: -0.5 }}>
            EZjobsite, from the office
          </h1>
          <p style={{ margin: 0, fontSize: 16, lineHeight: '24px', color: C.steel }}>
            Sign in with the same account you use on your phone. Nothing is captured here
            — this is where you read what the crew captured, price it, and answer the
            client.
          </p>
        </div>
        {problem && <Note tone="danger">{problem}</Note>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          <Button kind="primary" onClick={() => attempt('google')} disabled={going}>
            {going ? 'Opening Google…' : 'Continue with Google'}
          </Button>
          <Button onClick={() => attempt('apple')} disabled={going}>Continue with Apple</Button>
        </div>
        {going && (
          <span style={{ fontSize: 13.5, lineHeight: '19px', color: C.muted }}>
            If nothing opened, or you came straight back here, this address is probably
            not on the project's allowed redirect list yet.
          </span>
        )}
      </div>
    </Splash>
  );
}

function Splash({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: '100vh', background: C.paper, color: C.ink, fontFamily: F.body,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32,
      textWrap: 'pretty',
    }}>
      {typeof children === 'string' ? <Loading what={children} /> : children}
    </div>
  );
}
