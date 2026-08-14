/**
 * App config = app.json, with ONE local-development override.
 *
 * WHY THIS FILE EXISTS (2026-08-12). `app.json` sets
 *   runtimeVersion: { policy: 'fingerprint' }
 * which is correct: it is what decides whether a published OTA update is allowed to
 * load on a given installed binary, and a fingerprint of the real inputs is the only
 * honest answer to that question.
 *
 * It is also unusable as a dev loop on this machine. Expo computes the fingerprint
 * before it can answer the manifest request expo-dev-client makes on connect, it does
 * not cache between requests, and on this project (external disk, large tree) that
 * measured 62 seconds — 23 after a .fingerprintignore, and back over a minute as the
 * tree grew. The dev-client times out first, so the launcher looks like it does
 * nothing when you tap a server. A whole day was lost to that symptom.
 *
 * ─── THE GATE, AND WHY IT IS AN EXPLICIT ENV VAR ────────────────────────────────
 * The override applies ONLY when EZJB_DEV_RUNTIME is set, and the only thing that
 * sets it is the local `expo start` command. Not NODE_ENV, not __DEV__, not "is a dev
 * server running" — those are all conditions a production build could satisfy by
 * accident, and the cost of being wrong is an incompatible bundle loading on a real
 * contractor's phone. An env var nothing in CI or EAS sets cannot leak.
 *
 * So: EAS builds, App Store builds and `eas update` all still compute the real
 * fingerprint. Nothing about update compatibility changes.
 */
const base = require('./app.json').expo;

module.exports = () => {
  const devRuntime = process.env.EZJB_DEV_RUNTIME;
  if (!devRuntime) return { expo: base };
  return {
    expo: {
      ...base,
      // A fixed string instead of the fingerprint policy. Only the local dev server
      // ever sees this, and the dev-client does not enforce runtime matching against
      // a Metro server the way expo-updates does against a published update.
      runtimeVersion: devRuntime,
    },
  };
};
