/**
 * "NO SIGNAL — AND NOTHING IS LOST." The bar that says so.
 *
 * hadar, 2026-08-31: "when the phone is off line or there is weak connection, we need
 * to have a bar that notify the user of this situation -- so they will know."
 *
 * ─── WHY THE TONE MATTERS MORE THAN THE BAR ─────────────────────────────────────
 * Mandate #7 says weak or no signal is the EXPECTED condition, not an error: a
 * crawlspace, a basement, the back of a panel. So this is not a warning. A red
 * "connection lost" banner over a man who is doing exactly what the product was built
 * for teaches him the app is failing at the moment it is working — and the next thing
 * he does is stop recording and go back to texting himself photos.
 *
 * It therefore leads with what is still TRUE ("everything still saves") and mentions
 * the wait second. The existing offline copy on the draft screen already sets that
 * voice — "Saved — waiting for signal" — and this matches it rather than inventing a
 * second register for the same fact.
 *
 * ─── WHAT IT COUNTS, AND WHY THAT IS THE USEFUL NUMBER ──────────────────────────
 * Not "you are offline" alone, which he can see from the status bar. The number that
 * is actually his is HOW MUCH IS WAITING — the queued rows across every owned outbox.
 * Offline with nothing pending is a non-event; offline with nine captures waiting is
 * the thing to know before he drives away from the job.
 *
 * ─── IT NEVER BLOCKS ANYTHING ───────────────────────────────────────────────────
 * `pointerEvents="none"`: it is information, not a control. A bar that can swallow a
 * tap on the screen beneath it would cost a capture, which is the one thing this app
 * may not do.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { t } from '../i18n';
import { Icon } from './icon';
import { C, F } from './theme';

export function OfflineBar({ connected, reachable, queued, struggling, topInset = 0 }: {
  /** False when the OS reports no network interface at all. */
  connected: boolean;
  /**
   * `isInternetReachable`. A phone can be CONNECTED and unreachable — a dead
   * hotspot, a captive portal, cell with a bar and no data — which is the exact
   * "weak connection" hadar asked about and which `connected` alone misses.
   * Undefined means the OS has not decided yet; that is not a failure.
   */
  reachable?: boolean | null;
  /** Rows waiting in the owned outboxes. */
  queued: number;
  /**
   * Rows that have failed twice or more and are on a backoff. This is how a bad
   * connection is detected honestly: iOS does not expose signal strength, so the
   * truthful measure is whether OUR OWN uploads are getting through.
   */
  struggling: number;
  /** Height of the status bar, so the text clears it. */
  topInset?: number;
}) {
  const down = !connected || reachable === false;
  // A connection that is up and reachable but cannot finish an upload. Only worth
  // saying while something is actually stuck — otherwise it is a claim about the
  // network with no consequence attached to it.
  const weak = !down && struggling > 0;

  // ONLINE AND MOVING IS SILENT. A bar that is always there stops being read, and
  // there is nothing to tell somebody whose phone is working.
  if (!down && !weak) return null;

  return (
    <View pointerEvents="none"
      style={[st.bar, { paddingTop: topInset + 8 },
              weak && { backgroundColor: C.syncing }]}
      accessibilityRole="alert">
      <Icon name={down ? 'offline' : 'sync'} size={16} color="#FFFFFF" />
      <Text style={st.text} numberOfLines={2}>
        {weak
          ? t({ k: 'net.weak', p: { n: String(struggling) } } as any)
          : queued > 0
            ? t({ k: 'net.offlineWaiting', p: { n: String(queued) } } as any)
            : t('net.offline')}
      </Text>
    </View>
  );
}

const st = StyleSheet.create({
  // `noSignal` is the palette's own charcoal for exactly this state — the design
  // system named it before anything drew it. Not red: see the header.
  bar: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 950,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.noSignal, paddingHorizontal: 16, paddingBottom: 9,
  },
  text: { flex: 1, fontFamily: F.bodySemi, fontSize: 13.5, lineHeight: 18, color: '#FFFFFF' },
});
