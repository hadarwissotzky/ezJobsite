/**
 * R1 — "given a paused session, when the app is killed or the phone dies, then
 * the partial session is recovered on next open as a draft."
 *
 * This is the "on next open" half. It renders above the home screen so it cannot
 * be walked past, because the alternative — a badge somewhere on the jobs list —
 * is the design where a recovered walk sits unnoticed for a week and then gets
 * swept.
 *
 * TWO ACTIONS AND NO DISMISS, on purpose. "Later" would be a third state that
 * nothing ever resolves, and a draft in that state is indistinguishable from
 * lost. Keep commits the walk down the ordinary capture path; Discard is an
 * explicit, confirmed throw-away. Both are decisions; neither is a delay.
 *
 * Discard requires a second tap. It is the only control in the app that destroys
 * unsent captures, and mandate #1 says the cost of a mis-tap here is a walk
 * nobody can get back.
 */
import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { t } from '../i18n';
import type { DraftSummary } from '../capturesession';
import { C, F, T as TT, display, label } from './theme';

function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function when(atMs: number, now: number): string {
  const mins = Math.floor((now - atMs) / 60_000);
  if (mins < 1) return t('r1.draft.justNow');
  if (mins < 60) return t({ k: 'r1.draft.minsAgo', p: { n: mins } });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t({ k: 'r1.draft.hrsAgo', p: { n: hrs } });
  return t({ k: 'r1.draft.daysAgo', p: { n: Math.floor(hrs / 24) } });
}

export function DraftRecoveryCard({
  drafts, onKeep, onDiscard, busyId,
}: {
  /** Newest first, from `recoverableDrafts()`. Every one is shown — see the note
   *  in capturesession.ts about why recovery is not "the most recent draft". */
  drafts: DraftSummary[];
  onKeep: (d: DraftSummary) => void;
  onDiscard: (d: DraftSummary) => void;
  /** The draft currently being committed; its buttons lock so a double tap
   *  cannot file the same walk twice. */
  busyId?: string | null;
}) {
  const [confirming, setConfirming] = React.useState<string | null>(null);
  const now = Date.now();
  if (!drafts.length) return null;

  return (
    <View style={{ backgroundColor: C.paper, paddingTop: 14 }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 12, gap: 12 }}>
        <Text style={[label, { color: C.danger }]}>{t('r1.draft.heading')}</Text>
        <Text style={{ fontFamily: F.body, fontSize: 15, color: C.steel, lineHeight: 21 }}>
          {t('r1.draft.blurb')}
        </Text>

        {drafts.map((d) => {
          const busy = busyId === d.draftId;
          return (
            <View key={d.draftId} style={[TT.card, { padding: 14, gap: 10 }]}>
              <Text style={display(19)}>
                {d.photos > 0 ? t({ k: 'r1.draft.photos', p: { n: d.photos } }) : ''}
                {d.photos > 0 && d.audioSegments > 0 ? '  ·  ' : ''}
                {d.audioSegments > 0 ? t({ k: 'r1.draft.audio', p: { mmss: clock(d.recordedMs) } }) : ''}
              </Text>
              <Text style={{ fontFamily: F.body, fontSize: 14, color: C.steel }}>
                {when(d.startedAtMs, now)}
              </Text>

              <Pressable
                accessibilityRole="button"
                disabled={busy}
                style={{ backgroundColor: C.orange, borderRadius: 12, minHeight: 54,
                         alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.6 : 1 }}
                onPress={() => onKeep(d)}>
                <Text style={[display(17), { color: '#fff' }]}>
                  {busy ? t('r1.draft.keeping') : t('r1.draft.keep')}
                </Text>
              </Pressable>

              {confirming === d.draftId ? (
                <View style={{ gap: 8 }}>
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: C.danger }}>
                    {t('r1.draft.confirmDiscard')}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Pressable
                      style={{ flex: 1, minHeight: 48, borderRadius: 12, borderWidth: 1,
                               borderColor: C.line, alignItems: 'center', justifyContent: 'center' }}
                      onPress={() => setConfirming(null)}>
                      <Text style={display(15)}>{t('r1.draft.keepInstead')}</Text>
                    </Pressable>
                    <Pressable
                      disabled={busy}
                      style={{ flex: 1, minHeight: 48, borderRadius: 12, backgroundColor: C.danger,
                               alignItems: 'center', justifyContent: 'center' }}
                      onPress={() => { setConfirming(null); onDiscard(d); }}>
                      <Text style={[display(15), { color: '#fff' }]}>{t('r1.draft.discardYes')}</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <Pressable
                  disabled={busy}
                  style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
                  onPress={() => setConfirming(d.draftId)}>
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: C.steel }}>
                    {t('r1.draft.discard')}
                  </Text>
                </Pressable>
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}
