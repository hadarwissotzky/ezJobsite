/**
 * The extra record screen — PRD R6b, the prototype's c5.
 *
 * Order is the requirement: identity/state → plain-language state line → people →
 * description → evidence → decision summary (R6c) → full history.
 *
 * Every string comes from i18n (mandate #5). The first version baked English into
 * the component, which put an English legal-record screen in front of a reader who
 * had chosen Spanish.
 *
 * R6c (the derived decision summary) is a CARD, not a section of this file: it is
 * passed in already assembled and renders nothing when null, which is R6c's second
 * AC made structural rather than remembered. See ui/decisionsummarycard.tsx.
 */
import React from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import type { ExtraRecord, RecordPerson } from '../record';
import type { DecisionSummary } from '../decisionsummary';
import { DecisionSummaryCard } from './decisionsummarycard';
import type { ApprovalPanel } from '../eventlog';
import { RecordApproval } from './recordapproval';
import { t } from '../i18n';
import { C, F, T, chipStyle, display, label } from './theme';
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';
import { MoneyLine, PeopleCard, TypeLine, useRecordFacts } from './recordfacts';

function chipKind(status: string) {
  if (status === 'approved') return 'approved' as const;
  if (status === 'declined') return 'declined' as const;
  if (status === 'sent') return 'pending' as const;
  return 'discuss' as const;
}

function avatarColor(kind: RecordPerson['kind']) {
  return kind === 'approver' ? C.approve : kind === 'crew' ? C.orange : C.ink;
}

export function RecordScreen(props: {
  rec: ExtraRecord;
  /** R6b item 3 reads stored actor facts. Local SQLite only — see recordfacts.tsx
   *  for why the read lives in a hook here and not in the caller. */
  db: AbstractPowerSyncDatabase;
  /** R6c. Null renders nothing — the record is complete without it (R6c AC2). */
  summary?: DecisionSummary | null;
  /** R6 AC2: the FROZEN instrument + "opened 3 times · no answer yet". Null when
   *  the events have not reached this device; the record renders without it. */
  approval?: ApprovalPanel | null;
  onBack: () => void;
  onCapture?: () => void;
  /** R6 / R5b AC3 — write the approval document and open the share sheet. */
  onShare?: () => void;
}) {
  const { rec } = props;
  const chip = chipStyle(chipKind(rec.status));
  const facts = useRecordFacts(props.db, rec.id, rec.status);

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 120 }}>
        <Pressable onPress={props.onBack} hitSlop={10} style={{ paddingVertical: 8 }}>
          <Text style={{ ...label, color: C.orange }}>‹ {t('erec.back')}</Text>
        </Pressable>

        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
          <Text style={{ ...display(22), flex: 1 }} numberOfLines={3}>{rec.title}</Text>
          <View style={[T.chip, { backgroundColor: chip.bg }]}>
            <Text style={[T.chipText, { color: chip.fg }]}>{rec.status}</Text>
          </View>
        </View>

        {/* R6b item 1: type (Extra/Decision), then the money block. Mandate #6: the
            price is the CONTRACTOR'S, read back and confirmed by a human. A Decision
            renders "No cost change" and no figure anywhere (R6b AC2 / R10). */}
        <TypeLine facts={facts} />
        <MoneyLine rec={rec} facts={facts} />

        <View style={{
          marginTop: 12, borderRadius: 12, padding: 12,
          backgroundColor: '#FFF3EA', borderWidth: 1, borderColor: '#FFD9C2',
        }}>
          <Text style={{ fontFamily: F.bodyMed, fontSize: 14, color: '#7A3A12', lineHeight: 20 }}>
            {t({ k: rec.stateLineKey, p: rec.stateLineParams } as any)}
          </Text>
        </View>

        {!rec.synced && (
          <Text style={{ ...T.bodySteel, fontSize: 12, marginTop: 8 }}>{t('erec.onPhone')}</Text>
        )}

        {/* R6b item 3: the approver (name + role label, R5c), captured-by and
            priced/sent-by, each with its timestamp. Rows come only from stored
            facts — where nothing was recorded, nothing is shown. */}
        <PeopleCard facts={facts} />

        <View style={T.card}>
          <Text style={label}>{t('erec.description')}</Text>
          <Text style={[T.body, { marginTop: 6 }]}>{rec.description}</Text>
        </View>

        {/* Evidence. Mandate #1: a file the row promises but the device does not
            have is SHOWN as missing. A blank tile would be silent loss. */}
        {rec.photos.length > 0 && (
          <View style={T.card}>
            <Text style={label}>
              {t({ k: 'erec.evidence', p: { n: rec.photos.length } } as any)}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
              {rec.photos.map((p) => (
                <View key={p.captureId}>
                  {!p.present ? (
                    <View style={{
                      width: 86, height: 86, borderRadius: 10, backgroundColor: '#FBEAE7',
                      borderWidth: 1, borderColor: C.danger, alignItems: 'center',
                      justifyContent: 'center', padding: 4,
                    }}>
                      <Text style={{
                        fontFamily: F.dispSemi, fontSize: 9, color: C.danger, textAlign: 'center',
                      }}>
                        {t('erec.evidenceMissing')}
                      </Text>
                    </View>
                  ) : p.modality === 'photo' ? (
                    <MaybeImage uri={p.uri} />
                  ) : (
                    <View style={{
                      width: 86, height: 86, borderRadius: 10, backgroundColor: C.ink,
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Text style={{ fontFamily: F.dispSemi, fontSize: 10, color: '#fff' }}>
                        {p.modality.toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <Text style={{ ...T.bodySteel, fontSize: 10, marginTop: 3 }}>{p.at}</Text>
                </View>
              ))}
            </View>
            {rec.photosTruncated > 0 && (
              <Text style={{ ...T.bodySteel, fontSize: 12, marginTop: 8 }}>
                {t({ k: 'erec.evidenceMore', p: { n: rec.photosTruncated } } as any)}
              </Text>
            )}
          </View>
        )}

        {/* Full history — chronological; events with no recorded time sit last and
            say so, rather than being given an invented position. */}
        {/* R6b position 6. The summary and the history are never alternatives: the
            summary is the fast read, the history is the evidence, and both are
            always on this screen. */}
        {/* R6 AC2 BEFORE the summary: the exact wording the client signed outranks
            any derived narrative about it. The summary is a reading aid; this is
            the instrument. */}
        <RecordApproval approval={props.approval ?? null} />
        <DecisionSummaryCard summary={props.summary ?? null} />
        <Text style={{ ...label, marginTop: 16, marginBottom: 8 }}>{t('erec.history')}</Text>
        <View style={{ borderLeftWidth: 2, borderLeftColor: C.line, paddingLeft: 14 }}>
          {rec.history.map((h, i) => (
            <View key={i} style={{ paddingBottom: 14 }}>
              <Text style={{
                fontFamily: F.dispSemi, fontSize: 11.5, letterSpacing: 1,
                textTransform: 'uppercase', color: h.hot ? C.orange : C.steel,
              }}>
                {h.at}
              </Text>
              <Text style={[T.body, { fontSize: 14.5, marginTop: 1 }]}>{h.what}</Text>
            </View>
          ))}
        </View>
        <Text style={{ ...T.bodySteel, fontSize: 11.5, marginTop: 2 }}>
          {t('erec.deliveryNote')}
        </Text>
      </ScrollView>

      {props.onCapture && (
        <Pressable
          onPress={props.onCapture}
          accessibilityLabel={t('erec.capture')}
          style={{
            position: 'absolute', bottom: 26, alignSelf: 'center',
            width: 72, height: 72, borderRadius: 36, backgroundColor: C.orange,
            alignItems: 'center', justifyContent: 'center',
            shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 12,
            shadowOffset: { width: 0, height: 6 }, elevation: 8,
          }}>
          <Text style={{ fontFamily: F.disp, fontSize: 12, color: '#fff', letterSpacing: 1 }}>
            {t('erec.capture').toUpperCase()}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

/** A photo that admits when it cannot be decoded, instead of showing a grey square.
 *  The file existed at query time; decode can still fail (truncated write, codec). */
function MaybeImage({ uri }: { uri: string }) {
  const [failed, setFailed] = React.useState(false);
  if (failed) {
    return (
      <View style={{
        width: 86, height: 86, borderRadius: 10, backgroundColor: '#FBEAE7',
        borderWidth: 1, borderColor: C.danger, alignItems: 'center', justifyContent: 'center',
      }}>
        <Text style={{ fontFamily: F.dispSemi, fontSize: 9, color: C.danger, textAlign: 'center' }}>
          {t('erec.evidenceMissing')}
        </Text>
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      onError={() => setFailed(true)}
      style={{
        width: 86, height: 86, borderRadius: 10,
        backgroundColor: '#D8D2C6', borderWidth: 1, borderColor: C.line,
      }}
      resizeMode="cover"
    />
  );
}
