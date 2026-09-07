import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The console is a static bundle. It has no server of its own and never will:
// every read and write goes straight to PostgREST under the signed-in user's JWT,
// and RLS is what decides what comes back. A server in the middle would need the
// service-role key to be useful, and that key can read every customer's evidence —
// so the safest place for it is nowhere near a web tier.
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: true },
  server: {
    /**
     * 3000, NOT Vite's 5173, and it is not arbitrary.
     *
     * Supabase validates `redirect_to` AFTER the provider hands the browser back, and
     * when the address is not on the project's redirect allowlist it silently sends the
     * person to the project's SITE URL instead. That is set to `http://localhost:3000`,
     * so signing in from 5173 dropped you on a port with nothing behind it — no session,
     * no error, no clue.
     *
     * The Site URL is always an allowed redirect target, so serving from the port it
     * already names makes sign-in work with no dashboard change at all.
     *
     * THIS IS THE LOCAL CONVENIENCE, NOT THE FIX. The deployed console will be on a
     * Render hostname, which has to be added to Authentication -> URL Configuration ->
     * Redirect URLs regardless. Adding `http://localhost:3000/**` there too is worth
     * doing so this does not depend on the Site URL keeping its current value.
     */
    port: 3000,
    // Fail rather than silently walking to 3001 — a port that quietly moved is exactly
    // how the redirect stops matching again, with the same symptom and no message.
    strictPort: true,
  },
});
