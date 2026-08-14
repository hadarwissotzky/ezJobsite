import { registerRootComponent } from 'expo';

import App from './App';

/**
 * DEV-ONLY ERROR CAPTURE (2026-08-12).
 *
 * WHY IT EXISTS. I have been verifying on-device builds by reading `__EZ_BUILD__` back
 * over the Metro inspector, and that check CANNOT SEE A RED SCREEN — a LogBox error
 * leaves the JS context perfectly alive, so the marker reads fine while the user is
 * looking at a full-screen crash. The badge regression got reported to me by
 * screenshot, and the screenshot cut the call stack off at the frame that would have
 * named the culprit.
 *
 * This records the last fatal, with its FULL stack, somewhere the inspector can read it
 * — so "is the screen actually clean?" becomes a question I can answer from here
 * instead of one the user has to answer for me.
 *
 * It CHAINS to the existing handler rather than replacing it: LogBox must still show
 * the error to the developer. Recording is all this does.
 */
if (__DEV__) {
  const EU = (globalThis as any).ErrorUtils;
  if (EU?.getGlobalHandler && EU?.setGlobalHandler) {
    const prev = EU.getGlobalHandler();
    EU.setGlobalHandler((e: any, isFatal?: boolean) => {
      (globalThis as any).__LASTERR__ =
        `${isFatal ? 'FATAL ' : ''}${String(e?.message ?? e)}\n${String(e?.stack ?? '')}`;
      prev?.(e, isFatal);
    });
  }
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
