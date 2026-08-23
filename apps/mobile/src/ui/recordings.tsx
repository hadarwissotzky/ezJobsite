/**
 * THE ORIGINAL RECORDINGS — on every stage of an extra (hadar, 2026-07-31).
 *
 * WHY THIS EXISTS, stated plainly because it is a repair: the raw audio used to be
 * reachable on a sent or approved extra through ONE door — the scope editor's "Raw"
 * tab. When that editor became a focused drawer the tabs went with it, and the audio
 * became unreachable on exactly the two stages where it matters most. On a voice-led
 * product the recording IS the record; a screen built to settle a dispute cannot hide
 * the evidence behind a door that no longer exists.
 *
 * WHAT IT SHOWS, and the three facts it refuses to blur:
 *   transcript present  → the words, selectable, so they can be quoted.
 *   no transcript yet   → "still being written down" — a WAIT (offline, no STT).
 *   audio missing       → said by `VoiceClip` itself — mandate #1's loss, never
 *                         dressed up as a wait.
 *
 * READ-ONLY BY CONSTRUCTION. There is no edit path here on any stage: the capture is
 * evidence, and evidence is what was said. It is legal on a frozen record for the same
 * reason the photo lightbox is — listening is not editing.
 *
 * Collapsed by default: two recordings rendered as two full players run ~220pt, which
 * is most of a 13 mini's screen. One tap opens them.
 */
import React from 'react';
import { Text, View } from 'react-native';
import type { RecordVoice } from '../record';
import { t } from '../i18n';
import { Row, Section, VoiceClip } from './kit';
import { T, label as labelStyle } from './theme';

export function RecordingsCard({ voices, startOpen }: {
  /** `ExtraRecord.voices` — oldest first. The first is the original; the rest were
   *  added later. */
  voices: readonly RecordVoice[];
  /** Open on mount. Used when nothing was transcribed, because then the collapsed row
   *  has nothing to show and the audio is the only copy of what was said. */
  startOpen?: boolean;
}) {
  const nothingTranscribed = voices.length > 0 && voices.every((v) => !v.transcript);
  const [open, setOpen] = React.useState(!!startOpen || nothingTranscribed);
  if (voices.length === 0) return null;

  return (
    <Section title={t('rec.sectionTitle')}>
      <Row
        icon="microphone"
        label={voices.length === 1
          ? t('rec.oneRecording')
          : t({ k: 'rec.nRecordings', p: { n: voices.length } })}
        // WHEN it was captured — what a contractor recognises the recording by.
        value={voices[0]?.at ?? undefined}
        chevron
        expanded={open}
        onPress={() => setOpen((o) => !o)}
        accessibilityLabel={open ? t('rec.hide') : t('rec.show')}
      />

      {open && voices.map((v, i) => (
        <View key={v.captureId} style={{ marginTop: 12 }}>
          {voices.length > 1 && (
            <Text style={labelStyle}>{t({ k: 'erec.voiceN', p: { n: i + 1 } })}</Text>
          )}
          <VoiceClip
            uri={v.uri}
            present={v.present}
            playLabel={t('erec.voicePlay')}
            missingLabel={t('erec.voiceMissing')}
          />
          {v.transcript
            ? <Text style={[T.body, { fontSize: 15, marginTop: 6 }]} selectable>{v.transcript}</Text>
            : v.present
              ? <Text style={[T.bodySteel, { fontSize: 13.5, marginTop: 6 }]}>
                  {t(v.silent ? 'erec.transcriptSilent' : 'erec.transcriptPending')}
                </Text>
              // The loss is stated by `VoiceClip` above rather than twice.
              : null}
        </View>
      ))}

      {open && (
        <Text style={[T.bodySteel, { fontSize: 12.5, marginTop: 12 }]}>
          {t('rec.whyRaw')}
        </Text>
      )}
    </Section>
  );
}
