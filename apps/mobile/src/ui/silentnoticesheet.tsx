/**
 * "Nothing was said in that recording" — the bottom sheet.
 *
 * hadar, 2026-08-19: the inline version "is too subtle". This is the same fact, raised to
 * an interruption, for the one case where nothing more is coming: the pipeline finished,
 * the recording carried no speech, and the change order has no scope of work — so it sits
 * looking almost-done and will stay that way until a person acts.
 *
 * ─── IT LEADS WITH WHAT SURVIVED ────────────────────────────────────────────────
 * The photos are committed, stamped and safe, and saying so first is the difference
 * between "something went wrong" and "here is where you are". A contractor who reads
 * "we heard nothing" alone reasonably assumes he lost the lot.
 *
 * ─── IT DOES NOT SAY "FAILED" ───────────────────────────────────────────────────
 * A recording with no speech is a legitimate thing to have made — he may have been
 * shooting photos and never meant to talk. `extradraft.tsx` reached the same conclusion
 * for the inline block and the reasoning carries: the sheet states what happened and
 * offers the two things that actually help.
 *
 * ─── TWO WAYS FORWARD, NEITHER OF THEM "OK" ─────────────────────────────────────
 * Say it again, or write it yourself. Dismissing is possible (the ✕ and the scrim) but is
 * not offered as a button, because "OK" on a state that cannot resolve itself is a button
 * that does nothing at all.
 */
import React from 'react';
import { Text, View } from 'react-native';
import { t } from '../i18n';
import { BottomSheet, Button } from './kit';
import { C, F } from './theme';

export function SilentNoticeSheet(props: {
  /** The extra's title, so he knows WHICH one — he may have made three today. */
  scope: string;
  /** Photos safely committed on this extra. Leads the copy when there are any. */
  photos: number;
  /** Record another voice note onto this same extra. */
  onRecordAgain: () => void;
  /** Open the description editor on this extra. */
  onWriteItMyself: () => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet visible title={t('silent.title')} onClose={props.onClose}>
      <View style={{ paddingBottom: 4 }}>
        <Text style={{ fontFamily: F.bodySemi, fontSize: 15, color: C.ink }}
          numberOfLines={2}>
          {props.scope}
        </Text>

        {/* WHAT SURVIVED, first. */}
        {props.photos > 0 && (
          <Text style={{ fontFamily: F.body, fontSize: 15, color: C.ink,
            lineHeight: 22, marginTop: 10 }}>
            {t({ k: props.photos === 1 ? 'silent.photosOne' : 'silent.photosN',
                 p: { n: String(props.photos) } } as any)}
          </Text>
        )}

        <Text style={{ fontFamily: F.body, fontSize: 15, color: C.steel,
          lineHeight: 22, marginTop: 10 }}>
          {t('silent.body')}
        </Text>

        <View style={{ gap: 10, marginTop: 18 }}>
          <Button label={t('silent.recordAgain')} icon="microphone" onPress={props.onRecordAgain} />
          <Button label={t('silent.writeItMyself')} icon="edit" variant="secondary"
            onPress={props.onWriteItMyself} />
        </View>
      </View>
    </BottomSheet>
  );
}
