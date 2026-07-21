/**
 * The extra record screen — PRD R6b, the prototype's c5.
 *
 * Order is the requirement, not a preference: identity/state → plain-language state
 * line → people → description → photos → [summary: R6c, unbuilt] → full history.
 * A contractor opens this to answer "where is this and who touched it", and the
 * answer has to be readable before the timeline is.
 *
 * R6c (the derived decision summary) is NOT here yet. R6c itself says the record must
 * render complete without it, so its absence is a specified state, not a hole.
 */
import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { ExtraRecord, RecordPerson } from '../record';
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
        {/* ---- 1. identity + state ---- */}
        <Pressable onPress={props.onBack} hitSlop={10} style={{ paddingVertical: 8 }}>
          <Text style={{ ...label, color: C.orange }}>‹ Job</Text>
        </Pressable>

        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
          <Text style={{ ...display(22), flex: 1 }} numberOfLines={3}>{rec.title}</Text>
          <View style={[T.chip, { backgroundColor: chip.bg }]}>
            <Text style={[T.chipText, { color: chip.fg }]}>{rec.status}</Text>
          </View>
        </View>

        {/* Mandate #6: the price is the contractor's, confirmed by a human — say so.
            `mini` is a SMALL change order, not a price-less one; it still shows money. */}
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 9, marginTop: 8 }}>
          <Text style={{ ...moneyStyle, fontSize: 30, color: C.ink }}>{rec.amount}</Text>
          <Text style={T.bodySteel}>
            {rec.nte ? `Not to exceed ${rec.nte}` : 'Fixed'}{rec.isMini ? ' · mini' : ''} · your price
          </Text>
        </View>

        {/* ---- 2. what is true now, and what is owed ---- */}
        <View style={{
          marginTop: 12, borderRadius: 12, padding: 12,
          backgroundColor: '#FFF3EA', borderWidth: 1, borderColor: '#FFD9C2',
        }}>
          <Text style={{ fontFamily: F.bodyMed, fontSize: 14, color: '#7A3A12', lineHeight: 20 }}>
            {rec.stateLine}
          </Text>
        </View>

        {!rec.synced && (
          <Text style={{ ...T.bodySteel, fontSize: 12, marginTop: 8 }}>
            On this phone · not backed up yet
          </Text>
        )}

        {/* ---- 3. people ---- */}
        <View style={T.card}>
          <Text style={label}>People on this record</Text>
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
                    {p.role}{p.when ? ` · ${p.when}` : ''}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* ---- 4. description ---- */}
        <View style={T.card}>
          <Text style={label}>Description</Text>
          <Text style={[T.body, { marginTop: 6 }]}>{rec.description}</Text>
        </View>

        {/* ---- 5. photos (only when evidence exists) ---- */}
        {rec.photos.length > 0 && (
          <View style={T.card}>
            <Text style={label}>Evidence · {rec.photos.length}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
              {rec.photos.map((p) => (
                <View key={p.captureId} style={{
                  width: 74, height: 74, borderRadius: 10, backgroundColor: '#D8D2C6',
                  alignItems: 'center', justifyContent: 'flex-end', padding: 4,
                }}>
                  <Text style={{ fontFamily: F.dispSemi, fontSize: 9, color: C.ink }}>
                    {p.modality.toUpperCase()}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ---- 7. full history (6 = R6c summary, not built) ---- */}
        <Text style={{ ...label, marginTop: 16, marginBottom: 8 }}>Full history</Text>
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
          Delivery and open events are recorded on the server and appear in the evidence
          bundle; they are not yet merged into this list.
        </Text>
      </ScrollView>

      {/* R1: capture stays one tap away on secondary screens. */}
      {props.onCapture && (
        <Pressable
          onPress={props.onCapture}
          accessibilityLabel="Capture an extra"
          style={{
            position: 'absolute', bottom: 26, alignSelf: 'center',
            width: 72, height: 72, borderRadius: 36, backgroundColor: C.orange,
            alignItems: 'center', justifyContent: 'center',
            shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 6 },
            elevation: 8,
          }}>
          <Text style={{ fontFamily: F.disp, fontSize: 12, color: '#fff', letterSpacing: 1 }}>
            CAPTURE
          </Text>
        </Pressable>
      )}
    </View>
  );
}
