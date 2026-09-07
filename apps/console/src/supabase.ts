/**
 * The one Supabase client, and the sign-in the console uses.
 *
 * NO SERVER, ON PURPOSE. Every read and write below goes straight to PostgREST under
 * the signed-in user's JWT, and RLS decides what comes back — the same rules the phone
 * runs against, enforced in the same place. The alternative (a Node tier holding the
 * service-role key) would put a key that can read every customer's evidence behind a
 * web port to save writing a few policies, which is a bad trade in a product whose
 * whole value is that the evidence is trustworthy.
 *
 * `detectSessionInUrl: true` — the opposite of `connector.ts`, and correct here. The
 * phone catches the OAuth redirect on its own `ezjobsite://` scheme; a browser gets
 * the tokens back in the URL fragment and supabase-js has to read them out.
 */
import { createClient } from '@supabase/supabase-js';

// NOT named `URL`. It was, and it shadowed the global `URL` CONSTRUCTOR for this whole
// module — harmless until `takeAuthError` below was added months later and called
// `new URL(...)`, which resolved to this string and threw "URL is not a constructor"
// during render. React unmounted the tree and the page went white, with the real cause
// three functions away from the symptom. Module-scope names that collide with web
// globals are a trap laid for whoever edits the file next.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Fail LOUDLY and early on a bad build.
 *
 * This is the confirm.html lesson (CLIENT-PORTAL.md §1) applied before it can happen
 * again: that page shipped with a substitution that silently produced a client pointed
 * at nothing, and the only symptom anywhere was a spinner that never stopped. A build
 * whose environment was not set is broken in a way no amount of retrying fixes, so it
 * says so instead of rendering a console that will return an empty list from every
 * query and look like a company with no work in it.
 */
if (!SUPABASE_URL || !SUPABASE_ANON) {
  throw new Error(
    'The console was built without VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. '
      + 'It cannot reach a database. See apps/console/.env.example.',
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
});

/**
 * Sign in with the same two providers the app uses.
 *
 * Deliberately no email+password: adding a second credential kind means a second thing
 * to reset, phish and support, and the account already exists — the person signing in
 * here is the same person who set the company up on their phone. `redirectTo` is the
 * console's own origin so one deploy works without a per-environment allowlist entry
 * beyond the origin itself.
 */
export async function signIn(provider: 'google' | 'apple'): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: window.location.origin },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

/**
 * WHAT THE PROVIDER SAID WHEN IT SENT US BACK EMPTY-HANDED.
 *
 * A failed OAuth round trip does not throw anywhere a `try` can catch it. The browser
 * leaves for Google, comes back to this origin with `error=...` in the URL, and
 * supabase-js finds no session and says nothing — so the app renders the sign-in screen
 * again, unchanged, and the person is left to guess whether they mis-clicked or the
 * thing is broken. That is the confirm.html failure in a different costume: a real
 * error, with a real message, and nowhere to put it (CLIENT-PORTAL.md §1).
 *
 * Both places are read because the two flows differ: PKCE returns its error in the
 * QUERY string, the implicit flow in the HASH fragment.
 *
 * The params are stripped afterwards so a reload does not re-raise an error the person
 * has already read and moved on from.
 */
export function takeAuthError(): string | null {
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));

  const code = url.searchParams.get('error') ?? hash.get('error');
  if (!code) return null;

  const described = url.searchParams.get('error_description') ?? hash.get('error_description');
  const detail = described ? described.replace(/\+/g, ' ') : null;

  for (const key of ['error', 'error_code', 'error_description']) {
    url.searchParams.delete(key);
    hash.delete(key);
  }
  const rest = hash.toString();
  window.history.replaceState({}, '', `${url.origin}${url.pathname}${url.search}${rest ? `#${rest}` : ''}`);

  // `redirect_uri_mismatch` and friends are configuration, not something the person
  // signing in can do anything about, so the message says whose problem it is.
  const isConfig = /redirect|not allowed|unauthorized_client|invalid_client|provider/i
    .test(`${code} ${detail ?? ''}`);
  return isConfig
    ? `Sign-in was refused before it reached your account: ${detail ?? code}. This is a `
      + 'setup problem on the server, not something you did — this address has to be '
      + "listed in the project's allowed redirect URLs, and the provider has to be "
      + 'enabled for the web.'
    : `Sign-in did not complete: ${detail ?? code}`;
}
