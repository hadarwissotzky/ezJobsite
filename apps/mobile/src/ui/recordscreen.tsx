/**
 * The extra record screen — PRD R6b, the prototype's c5.
 *
 * Order is the requirement: identity/state → plain-language state line → people →
 * description → evidence → [summary: R6c, unbuilt] → full history.
 *
 * Every string comes from i18n (mandate #5). The first version baked English into
 * the component, which put an English legal-record screen in front of a reader who
 * had chosen Spanish.
 *
 * R6c (the derived decision summary) is NOT here. R6c itself requires the record to
 * render complete without it, so its absence is a specified state, not a hole.
 */
import React from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import type { ExtraRecord, RecordPerson } from '../record';
import { t } from '../i18n';
import { C, F, T, chipStyle, display, label, money as moneyStyle } from './theme';

function chipKind(status: string) {
  if (status === 'approved') return 'approved' as const;
  if (status === 'declined') return 'declined' as const;
  if (status === 'sent') return 'pending' as const;
  return 'discuss' as const;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function avatarColor(kind: RecordPerson['kind']) {
  return kind === 'approver' ? C.approve : kind === 'crew' ? C.orange : C.ink;
}

export function RecordScreen(props: {
  rec: ExtraRecord;
  onBack: () => void;
  onCapture?: () => void;
}) {
  const { rec } = props;
  const chip = chipStyle(chipKind(rec.status));

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

        {/* Mandate #6: the price is the contractor's, confirmed by a human. */}
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 9, marginTop: 8 }}>
          <Text style={{ ...moneyStyle, fontSize: 30, color: C.ink }}>{rec.amount}</Text>
          <Text style={T.bodySteel}>
            {rec.nte ? t({ k: 'erec.nte', p: { amount: rec.nte } } as any) : t('erec.fixed')}
            {rec.isMini ? ` · ${t('erec.mini')}` : ''} · {t('erec.yourPrice')}
          </Text>
        </View>

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

        {/* People — only roles actually stored. Where no name exists, the row states
            the EVENT and its real time and attributes it to nobody. */}
        {rec.people.length > 0 && (
          <View style={T.card}>
            <Text style={label}>{t('erec.people')}</Text>
            <View style={{ marginTop: 8, gap: 11 }}>
              {rec.people.map((p, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{
                    width: 34, height: 34, borderRadius: 17, alignItems: 'center',
                    justifyContent: 'center', backgroundColor: avatarColor(p.kind),
                  }}>
                    <Text style={{ fontFamily: F.disp, fontSize: 13, color: '#fff' }}>
                      {initials(p.name)}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: F.bodySemi, fontSize: 15, color: C.ink }}>{p.name}</Text>
                    <Text style={{ ...T.bodySteel, fontSize: 12.5 }}>
                      {t(p.roleKey)}{p.when ? ` · ${p.when}` : ''}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

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
