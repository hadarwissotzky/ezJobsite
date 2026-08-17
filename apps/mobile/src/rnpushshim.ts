/**
 * DISARM `react-native`'s `PushNotificationIOS` GETTER, BEFORE ANYTHING TOUCHES IT.
 *
 * ─── THE FAILURE ────────────────────────────────────────────────────────────────
 * Full-screen red box, reported by screenshot 2026-08-14:
 *
 *     Uncaught Error: `new NativeEventEmitter()` requires a non-null argument.
 *       invariant                    browser.js:38
 *       constructor                  NativeEventEmitter.js:57
 *       <global>                     PushNotificationIOS.js:67   ← module scope
 *       loadModuleImplementation     require.js:248
 *
 * `PushNotificationIOS` was extracted from React Native core. RN 0.81 still exposes it
 * as a DEPRECATED GETTER on the `react-native` module object (index.js:273), and that
 * getter `require`s a module whose top level does:
 *
 *     new NativeEventEmitter(NativeModules.PushNotificationManager)
 *
 * This app does not link that native module — push runs through `expo-notifications` —
 * so the argument is null and the module THROWS AT MODULE SCOPE. Merely READING the
 * property is enough. Nobody has to call anything.
 *
 * ─── WHY A SHIM AND NOT A FIX AT THE CALL SITE ──────────────────────────────────
 * There is no call site to fix. Nothing in this repo names `PushNotificationIOS`, and a
 * full `grep` of `node_modules` finds it only inside react-native itself and in a Babel
 * preset's lazy-import list. Whatever reaches it does so by ENUMERATING the module —
 * a star-interop copy, an `Object.keys`, a devtools walk — which means the trigger can
 * move between library versions and cannot be pinned by editing our own imports.
 *
 * So the fix is applied to the failing primitive instead of to whoever trips it: the
 * property is redefined as a plain `undefined` before the first module that could touch
 * it is loaded. The getter is declared in an object literal, so it is `configurable`
 * and this is legal — verified against react-native 0.81.5's index.js.
 *
 * `undefined` IS THE HONEST VALUE. The module genuinely is not in this build. Any
 * consumer reaching for an API that was removed from core years ago must already
 * tolerate its absence, and a fake object with no-op methods would be worse: it would
 * claim a push channel exists and then silently deliver nothing.
 *
 * ─── WHAT THIS DOES NOT FIX ─────────────────────────────────────────────────────
 * The app badge is still parked (see App.tsx's note at `cards`). That was the same
 * error from the same getter, and this shim removes the reason it was parked — but
 * turning the badge back on is a behaviour change and needs its own verification on a
 * device, not a side effect of this file.
 *
 * IMPORT IT FIRST, above every other import in `index.ts`. ES module imports run in
 * source order, and running second is the same as not running at all.
 */
const RN = require('react-native');

const d = Object.getOwnPropertyDescriptor(RN, 'PushNotificationIOS');
// Only touch it when it is still the LAZY GETTER. If a future react-native drops the
// property, or ships it as a real value, leave it alone — a shim that overwrites a
// working module is a worse bug than the one it was written for. Reading `d.get`
// rather than `RN.PushNotificationIOS` on purpose: reading the value is the crash.
if (d?.configurable && typeof d.get === 'function') {
  Object.defineProperty(RN, 'PushNotificationIOS', {
    value: undefined,
    writable: false,
    enumerable: false,   // so an enumerating consumer does not even see it
    configurable: true,
  });
}

export {};
