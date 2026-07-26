/**
 * Quota-reached modal — the free tier's "you've hit the cap" popup (hadar 2026-07-25).
 * Shown when an add action (invite / new job / new extra) would exceed a FREE_LIMITS
 * cap. Kind-specific copy tells the user WHAT is capped and offers a plans route, so
 * a non-technical user (CLAUDE.md ICP) understands the wall and how past it.
 *
 * It never blocks a capture — by the time this shows, every captured byte is already
 * committed; this only declines to create the N+1th job/extra/member.
 */
import React from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { t } from '../i18n';
import type { QuotaKind } from '../quota';
import { C, F } from './theme';

export function QuotaModal(props: {
  kind: QuotaKind;
  limit: number;
  onClose: () => void;
  onSeePlans: () => void;
}) {
  const bodyKey = ('quota.body.' + props.kind) as any;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={props.onClose}>
      <Pressable onPress={props.onClose}
        style={{ flex: 1, backgroundColor: 'rgba(15,23,30,0.55)',
          alignItems: 'center', justifyContent: 'center', padding: 28 }}>
        {/* Inner pressable swallows taps so tapping the card doesn't dismiss. */}
        <Pressable onPress={() => {}}
          style={{ width: '100%', maxWidth: 380, backgroundColor: '#fff', borderRadius: 18, padding: 22 }}>
          <Text style={{ fontSize: 40, textAlign: 'center', marginBottom: 6 }}>🔒</Text>
          <Text style={{ fontFamily: F.dispSemi, fontSize: 20, color: C.ink, textAlign: 'center' }}>
            {t('quota.title')}
          </Text>
          <Text style={{ fontFamily: F.body, fontSize: 15, color: C.steel, textAlign: 'center',
            lineHeight: 21, marginTop: 10 }}>
            {t({ k: bodyKey, p: { limit: String(props.limit) } } as any)}
          </Text>

          <Pressable onPress={props.onSeePlans}
            style={{ marginTop: 20, minHeight: 50, borderRadius: 12, backgroundColor: C.orange,
              alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: F.dispSemi, fontSize: 16, color: '#fff', letterSpacing: 0.5 }}>
              {t('quota.seePlans')}
            </Text>
          </Pressable>
          <Pressable onPress={props.onClose}
            style={{ marginTop: 10, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 15, color: C.steel }}>{t('quota.notNow')}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
