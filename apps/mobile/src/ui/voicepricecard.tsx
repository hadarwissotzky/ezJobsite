/**
 * R2 — the part of the priced card that comes from the voice note.
 *
 * Three things the priced card could not previously show, because nothing computed
 * them: what the recording said about money, whether it was a price or a CAP, and
 * whether the narration sounds like more than one extra.
 *
 * PRESENTATIONAL ONLY. It fetches nothing, owns no state, and has no Send button.
 * The amount itself still lives in the existing read-back field in App.tsx — this
 * card sits above it and explains where the number in it came from. Keeping the
 * money input where it is was deliberate: that field is wired to `centsFromInput`,
 * `validateLines` and `numbersConfirmedAt`, and moving mandate #6's read-back into a
 * new component would mean two places that can decide a price is confirmed.
 *
 * MODE IS A SUGGESTION THE HUMAN OWNS. `modeHeard: false` renders differently on
 * purpose — the card says "nobody said a cap, so this is set to fixed" rather than
 * presenting a default as a finding. A default dressed as a transcription is how a
 * tired man taps past something he never said.
 *
 * Every string is a key (mandate #5). The banner is read on a Spanish phone too.
 */
import React from 'react';
import { Pressable, Text, View } from 'react-native';

import { t } from '../i18n';
import type { MultiExtraFlag } from '../multiextra';
import type { PriceMode, VoicePriceReading } from '../voiceprice';
import { C, F, T, label } from './theme';

/** Warning stock, matching the existing "not filled in on purpose" cards. */
const WARN = { backgroundColor: '#FFF7E0', borderColor: '#F0DE9E' } as const;

export function VoicePriceCard({
  reading, multi, mode, onModeChange, amountDisplay,
}: {
  /** null when this device has no transcript yet — offline, or not processed. */
  reading: VoicePriceReading | null;
  multi: MultiExtraFlag | null;
  /** The mode the CONTRACTOR has settled on. Owned by the caller, never by this card. */
  mode: PriceMode;
  onModeChange: (m: PriceMode) => void;
  /** The confirmed amount, already formatted by `money()`. '' while it is empty. */
  amountDisplay: string;
}) {
  return (
    <View>
      {/* R2: "structuring flags it — actual auto-split is P1". A flag, not a fork:
          there is no Split button because v1 cannot split, and offering an action the
          product will not perform is worse than saying plainly what to do instead. */}
      {multi?.flagged && (
        <View style={[T.card, WARN]}>
          {/* The module's OWN key, not one chosen here: the detector decides what it
              found, and a second key picked at render time is how a banner comes to
              say something the logic never concluded. */}
          <Text style={label}>{t({ k: multi.reasonKey, p: multi.reasonParams })}</Text>
          <Text style={[T.body, { color: '#6B5300', marginTop: 4 }]}>
            {t('r2.splitNotYet')}
          </Text>
          {multi.starts.map((s, i) => (
            <Text key={i} style={[T.bodySteel, { marginTop: 4, fontStyle: 'italic' }]}>
              {i + 1}. “{s}”
            </Text>
          ))}
        </View>
      )}

      {/* What the recording said about money. Shown for EVERY outcome, including
          "nothing" — silence about a missing price reads as a price that is fine. */}
      {reading && (
        <View style={[T.card, reading.prefill ? { borderColor: C.orange, borderWidth: 2 } : WARN]}>
          <Text style={label}>{t('r2.heardLabel')}</Text>
          <Text style={[T.body, { marginTop: 4, color: reading.prefill ? C.ink : '#6B5300' }]}>
            {t({ k: reading.reasonKey, p: reading.reasonParams })}
          </Text>
          {reading.heard && (
            <Text style={[T.bodySteel, { marginTop: 6, fontStyle: 'italic' }]}>
              “{reading.heard}”
            </Text>
          )}
          {reading.prefill && (
            <Text style={[T.bodySteel, { marginTop: 6 }]}>{t('r2.checkNumber')}</Text>
          )}
        </View>
      )}

      {/* R3's two modes. A closed pair, never a free-text box: "a bare range is never
          offered". The picker is always shown — the mode changes what the homeowner
          is asked to approve, so it is never decided silently. */}
      <View style={T.card}>
        <Text style={label}>{t('r2.modeLabel')}</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          {(['fixed', 'nte'] as PriceMode[]).map((m) => {
            const on = mode === m;
            return (
              <Pressable
                key={m}
                onPress={() => onModeChange(m)}
                // The repo's gloves floor is 58 (T.btn). A mode switch is not a
                // smaller decision than a button just because it is a segmented one.
                style={{
                  flex: 1, minHeight: 58, alignItems: 'center', justifyContent: 'center',
                  borderRadius: 10, borderWidth: on ? 2 : 1,
                  borderColor: on ? C.orange : C.line,
                  backgroundColor: on ? '#FFF3EA' : 'transparent',
                }}
              >
                {/* Weight via fontFamily, not fontWeight: these are Barlow files, and
                    fontWeight on a named family silently does nothing on Android. */}
                <Text style={[T.body, on && { fontFamily: F.bodySemi }]}>
                  {t(m === 'fixed' ? 'r2.modeFixed' : 'r2.modeNte')}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={[T.bodySteel, { marginTop: 8 }]}>
          {reading?.modeHeard && reading.mode === mode
            ? t('r2.modeFromVoice')
            : t('r2.modeYours')}
        </Text>

        {/* R3 makes this sentence mandatory on an NTE. It is previewed HERE, next to
            the switch that obliges it, so the cap and the promise about the cap can
            never be set independently. Shown with a placeholder until the number is
            confirmed — an NTE clause reading "$0.00" would be a lie on the record. */}
        {mode === 'nte' && (
          <View style={{ marginTop: 10, borderLeftWidth: 3, borderLeftColor: C.orange, paddingLeft: 10 }}>
            <Text style={[T.body, { color: C.ink }]}>
              {t({ k: 'r2.nteClause', p: { amount: amountDisplay || t('r2.nteAmountPending') } })}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}
