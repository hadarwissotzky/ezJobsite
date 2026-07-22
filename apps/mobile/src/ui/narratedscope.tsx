/**
 * R2 — "the structured scope shows each photo BESIDE THE TEXT IT EVIDENCES
 * (fallback: photo strip at end if alignment is ambiguous)."
 *
 * The extra record drew evidence as a bare grid of thumbnails with timestamps. That
 * grid is what a homeowner is shown to justify a charge, and it does not say what any
 * picture is OF — the sentence the contractor spoke while shooting it was computed
 * (autotag), reduced to a 48-character tag, and never rendered next to the photo.
 * This component renders the alignment instead.
 *
 * Layout is text-left / photos-right rather than a caption under a grid. The
 * narration is what the extra IS; the photos are what proves it. Reading down the
 * left column gives the scope in the contractor's own words with no pictures needed,
 * which is also how it has to degrade when the photos are gone (see below).
 *
 * MANDATE #1 SURVIVES THE REDESIGN: a photo whose file is missing renders as a
 * marked, labelled tile, never as a blank space. Same treatment as the record
 * screen's grid, for the same reason — silent loss is the unforgivable one.
 *
 * Every string is a key (mandate #5).
 */
import React from 'react';
import { Image, Text, View } from 'react-native';

import { t } from '../i18n';
import { offsetLabel, type Alignment } from '../photonarration';
import { C, F, T, label } from './theme';

export type ScopePhoto = {
  captureId: string;
  offsetSec: number;
  uri: string;
  /** False = the device does not have the file. It is SHOWN as missing. */
  present: boolean;
};

function Tile({ photo }: { photo: ScopePhoto }) {
  if (!photo.present) {
    return (
      <View style={{
        width: 86, height: 86, borderRadius: 10, backgroundColor: '#FBEAE7',
        borderWidth: 1, borderColor: C.danger, alignItems: 'center',
        justifyContent: 'center', padding: 4,
      }}>
        <Text style={{ fontFamily: F.dispSemi, fontSize: 9, color: C.danger, textAlign: 'center' }}>
          {t('erec.evidenceMissing')}
        </Text>
      </View>
    );
  }
  return (
    <Image
      source={{ uri: photo.uri }}
      style={{ width: 86, height: 86, borderRadius: 10, backgroundColor: C.line }}
    />
  );
}

export function NarratedScope({ alignment }: { alignment: Alignment<ScopePhoto> }) {
  const { blocks, strip, fallbackStrip } = alignment;
  if (!blocks.length && !strip.length) return null;

  return (
    <View style={T.card}>
      <Text style={label}>{t('r2.narrationTitle')}</Text>

      {blocks.map((b, i) => (
        <View
          key={i}
          style={{ flexDirection: 'row', gap: 10, marginTop: 12, alignItems: 'flex-start' }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ ...label, fontSize: 11, color: C.steel }}>{offsetLabel(b.startSec)}</Text>
            <Text style={[T.body, { marginTop: 2 }]}>{b.text}</Text>
          </View>
          {/* The photos taken WHILE that was being said. A block with none renders
              text at full width — narration is not padded out with empty frames. */}
          {b.photos.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, maxWidth: 184 }}>
              {b.photos.map((p) => <Tile key={p.captureId} photo={p} />)}
            </View>
          )}
        </View>
      ))}

      {/* R2's named fallback. Two different messages, because the two cases are
          different facts: nothing could be matched (usually: not transcribed yet)
          versus most of it matched and these few did not. Telling a contractor his
          walkthrough "couldn't be matched" when 8 of 9 photos did would be a lie. */}
      {strip.length > 0 && (
        <View style={{ marginTop: 14, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 12 }}>
          <Text style={label}>
            {t(fallbackStrip ? 'r2.narrationNoAlign' : 'r2.narrationStrip')}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {strip.map((p) => <Tile key={p.captureId} photo={p} />)}
          </View>
        </View>
      )}
    </View>
  );
}
