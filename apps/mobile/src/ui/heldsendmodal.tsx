/**
 * "SAVED — WAITING TO SEND." The prompt hadar asked for (2026-08-17: "queue it — but
 * needs to prompt the user letting them know that they cannot send if they don't have
 * credits").
 *
 * ─── WHY THIS IS NOT QuotaModal ─────────────────────────────────────────────────
 * QuotaModal is a WALL. It says no, and the only way past it is to pay. This says YES —
 * the change order is saved, it is queued, and it goes out on its own the moment a credit
 * exists. Reusing the wall would tell a contractor his work was refused when it was
 * accepted, which is the opposite fact, so it gets its own copy, its own icon and its own
 * primary action.
 *
 * ─── THE TWO SENTENCES ARE BOTH LOAD-BEARING ────────────────────────────────────
 * The first says what happened ("out of change orders, so this is waiting"). The second
 * says what un-blocks it AND that he does not have to redo anything. A queue nobody is
 * told about is worse than a refusal, because he walks away believing the client has it.
 *
 * ─── THE BUY BUTTON CAN BE ABSENT, AND THAT IS CORRECT ──────────────────────────
 * `onBuy` is null when the web rail has no address — `purchaseUrl` returns null without a
 * checkout token or a company id. A button that opens a 404, or worse a checkout that
 * attaches the purchase to an anonymous customer the app cannot read, costs more than a
 * missing one. The message still stands on its own: it tells him the truth about his
 * change order either way.
 */
import React from 'react';
import { Modal, Pressable, Text } from 'react-native';
import { t } from '../i18n';
import { C, F } from './theme';

export function HeldSendModal(props: {
  /** How many are waiting in total, this one included. */
  held: number;
  /** Opens the checkout. Null when there is no web rail to open — see above. */
  onBuy: (() => void) | null;
  onClose: () => void;
}) {
  return (
    <Modal visible transparent animationType="fade" onRequestClose={props.onClose}>
      <Pressable onPress={props.onClose}
        style={{ flex: 1, backgroundColor: 'rgba(15,23,30,0.55)',
          alignItems: 'center', justifyContent: 'center', padding: 28 }}>
        <Pressable onPress={() => {}}
          style={{ width: '100%', maxWidth: 380, backgroundColor: '#fff', borderRadius: 18, padding: 22 }}>
          {/* An hourglass, not a padlock. Nothing here is locked. */}
          <Text style={{ fontSize: 40, textAlign: 'center', marginBottom: 6 }}>⏳</Text>
          <Text style={{ fontFamily: F.dispSemi, fontSize: 20, color: C.ink, textAlign: 'center' }}>
            {t('gate.queuedTitle')}
          </Text>
          <Text style={{ fontFamily: F.body, fontSize: 15, color: C.ink, textAlign: 'center',
            lineHeight: 21, marginTop: 10 }}>
            {t('gate.queuedNoCredits')}
          </Text>
          <Text style={{ fontFamily: F.body, fontSize: 15, color: C.steel, textAlign: 'center',
            lineHeight: 21, marginTop: 8 }}>
            {t('gate.fixBuyCredits')}
          </Text>
          {/* Only once there is more than this one waiting. Saying "1 change order is
              waiting" directly under a message about this change order is noise. */}
          {props.held > 1 && (
            <Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: C.steel,
              textAlign: 'center', marginTop: 12 }}>
              {t({ k: 'gate.queuedN', p: { n: String(props.held) } } as any)}
            </Text>
          )}

          {props.onBuy && (
            <Pressable onPress={props.onBuy}
              style={{ marginTop: 20, minHeight: 50, borderRadius: 12, backgroundColor: C.orange,
                alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontFamily: F.dispSemi, fontSize: 16, color: '#fff', letterSpacing: 0.5 }}>
                {t('gate.addCredits')}
              </Text>
            </Pressable>
          )}
          <Pressable onPress={props.onClose}
            style={{ marginTop: 10, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 15, color: C.steel }}>
              {t('gate.queuedOk')}
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
