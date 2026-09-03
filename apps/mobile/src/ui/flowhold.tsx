/**
 * THE HALF-SECOND BETWEEN TWO STEPS OF THE CREATE FLOW.
 *
 * hadar, 2026-09-03: "when i move between the steps it keeps displaying the home screen
 * between next and rendering the next screens — that should not be the case — it should
 * only display the screens in the progress."
 *
 * Each step of the sequence is a screen chosen by its own piece of state, and moving
 * between two of them is an async handler: commit the captures, read the roster, mint
 * the extra. For the length of that await the old state is cleared and the new one is
 * not set, nothing in the chain matches, and the app falls through to Home. So a man
 * making one change order watched his dashboard flash at him four times.
 *
 * THIS IS NOT A SPINNER SCREEN. It is the step he is arriving at, drawn before its data
 * is ready: same paper, same rail, same position on the rail. Nothing about it says
 * "loading", because nothing has gone wrong and he is not waiting for a decision — he
 * is walking from one room to the next and this is the corridor.
 *
 * The rail carries the step being ENTERED, so the count goes up rather than resetting,
 * which is the whole reason the flash read as a collapse rather than a delay.
 */
import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { FlowRail, type FlowStep } from './flowrail';
import { C } from './theme';

export function FlowHoldScreen({ step }: { step: FlowStep }) {
  return (
    <View style={st.screen}>
      <FlowRail step={step} />
      {/* Low-contrast and well down the page: it exists so a slow hand-off does not
          look frozen, and it must not compete with the rail for the eye. On a fast
          connection nobody ever sees it. */}
      <View style={st.wait}>
        <ActivityIndicator color={C.muted} />
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  // 54pt of clearance, matching step 5 — the rail must not move a pixel between the
  // hold and the screen that replaces it, or the corridor becomes another flash.
  screen: { flex: 1, backgroundColor: C.paper, paddingTop: 54, paddingHorizontal: 18 },
  wait: { marginTop: 90, alignItems: 'center' },
});
