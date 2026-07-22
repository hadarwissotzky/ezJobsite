/**
 * R6 AC2 on the contractor's side — the frozen instrument, shown as the instrument.
 *
 * THE HOLE THIS FILLS: the record screen rendered `change_order.scope` under the
 * heading "Description". That is the MUTABLE local row. AC2 says either party
 * opening the record later sees the identical immutable snapshot, and the
 * contractor's copy was the one thing on the loop that was not reading
 * `shown_content`. In the only moment this screen matters — a dispute — he would
 * have been reading the app's current summary of the work while the client held a
 * frozen document, and neither would know they were looking at different things.
 *
 * So this renders the frozen text VERBATIM, monospaced-in-spirit, in a bordered
 * block that does not look like app chrome. It is quoting a document, not
 * describing one, and it is deliberately not styled to be pretty: the moment it
 * reads as "the app's version of events" rather than "the exact wording", it has
 * stopped being evidence.
 *
 * It also carries R6's actionable signal — "opened 3 times · no answer yet" —
 * because that belongs beside the thing that was opened, not buried in the
 * chronological list where it has to be counted off by eye.
 */
import React from 'react';
import { Text, View } from 'react-native';
import type { ApprovalPanel } from '../eventlog';
import { t } from '../i18n';
import { C, F, T, label } from './theme';

export function RecordApproval({ approval }: { approval: ApprovalPanel | null }) {
  if (!approval) return null;
  const { signal, snapshot } = approval;
  if (!signal && !snapshot) return null;

  return (
    <>
      {signal && (
        <View style={{
          marginTop: 12, borderRadius: 12, padding: 12,
          backgroundColor: '#F1F4F7', borderWidth: 1, borderColor: '#DDE3EA',
        }}>
          <Text style={{ fontFamily: F.bodySemi, fontSize: 14.5, color: C.inkSoft }}>
            {t({ k: signal.k, p: signal.p } as any)}
          </Text>
        </View>
      )}

      {snapshot && (
        <View style={T.card}>
          <Text style={label}>{t('erec.snapshot')}</Text>
          <Text style={{ ...T.bodySteel, fontSize: 12.5, marginTop: 4 }}>
            {t('erec.snapshotSub')}
          </Text>

          {/* Verbatim. Never re-wrapped into the app's own words. */}
          <View style={{
            marginTop: 10, borderRadius: 10, padding: 12,
            backgroundColor: '#F3F4F2', borderWidth: 1, borderColor: C.line,
          }}>
            <Text selectable style={{
              fontFamily: F.body, fontSize: 14.5, lineHeight: 22, color: C.inkSoft,
            }}>
              {snapshot.content}
            </Text>
          </View>

          {/* Mandate #1's shape applied to a document instead of a photo: a copy
              that does not match its frozen hash SAYS so, loudly. Silence here
              would be a tampered instrument rendered as a good one. */}
          <Text style={{
            ...T.bodySteel, fontSize: 12.5, marginTop: 8,
            color: snapshot.verified ? C.approve : C.danger,
            fontFamily: snapshot.verified ? F.body : F.bodySemi,
          }}>
            {t(snapshot.verified ? 'erec.snapVerified' : 'erec.snapMismatch')}
          </Text>

          {snapshot.signedName && snapshot.signedAt && (
            <Text style={{ ...T.bodySteel, fontSize: 12.5, marginTop: 2 }}>
              {t({
                k: snapshot.action === 'declined' ? 'erec.snapDeclinedBy' : 'erec.snapSignedBy',
                p: { name: snapshot.signedName, when: snapshot.signedAt },
              } as any)}
            </Text>
          )}

          {snapshot.superseded && (
            <Text style={{ ...T.bodySteel, fontSize: 12.5, marginTop: 2, color: C.orange }}>
              {t('erec.snapSuperseded')}
            </Text>
          )}
        </View>
      )}
    </>
  );
}
