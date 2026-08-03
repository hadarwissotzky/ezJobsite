/**
 * THE SIGNED CHANGE ORDER, as a document, in a drawer (hadar, 2026-07-31).
 *
 * "View signed approval" used to go straight to the share sheet — it EXPORTED the
 * document without ever showing it. This renders it first.
 *
 * IT RENDERS THE SAME `ApprovalDoc` THE PDF DOES. `buildApprovalDoc` is the one
 * assembler; the HTML/PDF path and this screen are two containers for one document,
 * exactly as `shareApprovalDoc` already treats HTML and PDF ("nothing about the
 * DOCUMENT changes here — only its container"). A second assembler here would be a
 * second wording of a legal instrument waiting to drift, which `approvalpdf.ts` and
 * `recordapproval.tsx` both name as the thing to avoid.
 *
 * THE BINDING BLOCK IS QUOTED, NEVER RESTATED. `content` is `shown_content` — the
 * bytes the signer actually saw — printed verbatim with its own line breaks intact.
 * It is deliberately not prettified: the moment it reads as "the app's version of
 * events" rather than the exact wording, it has stopped being evidence. The
 * non-binding blocks (discussion, derived summary) are drawn DIFFERENTLY and say so,
 * because R6c bars the summary from the signed content and a reader must be able to
 * see which part they are looking at.
 *
 * The integrity line is not decoration either: a copy that no longer hashes to its
 * frozen value says so, loudly, on the page a dispute turns on.
 */
import React from 'react';
import { Text, View, StyleSheet } from 'react-native';
import type { ApprovalDoc, PdfLabels } from '../approvalpdf';
import { t } from '../i18n';
import { BottomSheet, Button } from './kit';
import { C, F, T } from './theme';

export function ApprovalDocSheet({ visible, doc, labels, onClose, onShare }: {
  visible: boolean;
  /** From `buildApprovalDoc`. Null while it loads, or when the record is not on this
   *  device — the sheet then says so rather than rendering an empty document. */
  doc: ApprovalDoc | null;
  labels: PdfLabels | null;
  onClose: () => void;
  /** Export the SAME document as a PDF (the existing `shareApprovalDoc` path). */
  onShare: () => void;
}) {
  return (
    <BottomSheet
      visible={visible}
      title={t('elock.viewApproval')}
      onClose={onClose}
      tall
      footer={<Button label={t('approvaldoc.share')} icon="doc" onPress={onShare} />}
    >
      {!doc || !labels ? (
        <Text style={T.bodySteel}>{t('approvaldoc.notOnDevice')}</Text>
      ) : (
        <>
          <Text style={st.docTitle}>{doc.title}</Text>

          {doc.blocks.map((b, i) => {
            if (b.kind === 'snapshot') {
              return (
                <View key={i} style={[st.block, st.binding]}>
                  <Text style={st.h2}>
                    {b.action ? labels.signedHeading : labels.unsignedHeading}
                  </Text>
                  {/* VERBATIM. `selectable` so a line can be quoted into a message or
                      an email without retyping it — retyping is how a quotation stops
                      matching the instrument. */}
                  <Text selectable style={st.instrument}>{b.content}</Text>

                  {b.signedName && (
                    <Text style={st.sig}>
                      {labels.signedByLine}
                      {b.signedAtLabel ? ` · ${b.signedAtLabel}` : ''}
                    </Text>
                  )}

                  <Text style={[st.integrity, b.verified ? st.ok : st.bad]}>
                    {b.verified ? labels.integrityOk : labels.integrityFailed}
                  </Text>
                  <Text selectable style={st.hash}>{b.sha256}</Text>
                </View>
              );
            }
            if (b.kind === 'co') {
              const L = labels.co;
              return (
                <View key={i} style={st.block}>
                  <Text style={st.h2}>{L.descriptionHeading}</Text>
                  <Text selectable style={st.li}>{b.description}</Text>
                  {b.items.length > 0 && (
                    <>
                      <Text style={[st.h2, { marginTop: 14 }]}>{L.itemsHeading}</Text>
                      {b.items.map((it, k) => (
                        <View key={k} style={st.itemRow}>
                          <Text style={st.itemDesc} numberOfLines={2}>{it.description}</Text>
                          <Text style={st.itemAmt}>{it.amount}</Text>
                        </View>
                      ))}
                    </>
                  )}
                  <View style={st.totalRow}>
                    <Text style={st.totalLabel}>{L.totalLabel}</Text>
                    <Text style={st.totalVal}>{b.total ?? L.noPrice}</Text>
                  </View>
                  <Text style={[st.h2, { marginTop: 14 }]}>{L.excludedHeading}</Text>
                  <Text style={st.li}>
                    {b.excluded.length ? b.excluded.join('\n') : L.nothingExcluded}
                  </Text>
                  {b.scheduleLine && (
                    <>
                      <Text style={[st.h2, { marginTop: 14 }]}>{L.scheduleHeading}</Text>
                      <Text style={st.li}>{b.scheduleLine}</Text>
                    </>
                  )}
                  {b.paymentLine && (
                    <>
                      <Text style={[st.h2, { marginTop: 14 }]}>{L.paymentHeading}</Text>
                      <Text style={st.li}>{b.paymentLine}</Text>
                    </>
                  )}
                </View>
              );
            }
            if (b.kind === 'discussion') {
              return (
                <View key={i} style={st.block}>
                  <Text style={st.h2}>{labels.discussionHeading}</Text>
                  {b.entries.map((e, j) => (
                    <View key={j} style={st.msg}>
                      <Text style={st.who}>
                        {e.side === 'client' ? labels.clientLabel : labels.contractorLabel}
                        <Text style={st.when}>{`  ${e.atLabel}`}</Text>
                      </Text>
                      <Text selectable style={st.msgText}>{e.text}</Text>
                    </View>
                  ))}
                </View>
              );
            }
            return (
              <View key={i} style={[st.block, st.derived]}>
                <Text style={st.h2}>{labels.summaryHeading}</Text>
                {/* SAYS IT IS NOT THE SIGNED TEXT. R6c bars this from the instrument;
                    the note is what stops a reader treating it as one. */}
                <Text style={st.note}>{labels.derivedNote}</Text>
                {b.lines.map((l, j) => (
                  <Text key={j} style={st.li}>{`•  ${l}`}</Text>
                ))}
                <Text style={st.owed}>{`${labels.owedLabel} ${b.owed}`}</Text>
              </View>
            );
          })}

          <Text style={st.footer}>{labels.footer}</Text>
        </>
      )}
    </BottomSheet>
  );
}

const st = StyleSheet.create({
  docTitle: { fontFamily: F.disp, fontSize: 24, color: C.ink, textTransform: 'uppercase',
    letterSpacing: 0.4, marginBottom: 14 },
  block: {
    borderWidth: 1, borderColor: C.line, borderRadius: 12,
    padding: 14, marginBottom: 14, backgroundColor: C.card,
  },
  // The signed block is drawn HEAVIER than everything else on the page. Which part is
  // binding must be visible before a word is read.
  binding: { borderWidth: 2, borderColor: C.ink, backgroundColor: C.raised },
  derived: { backgroundColor: C.surfaceMuted, borderStyle: 'dashed' },
  h2: {
    fontFamily: F.bodySemi, fontSize: 11.5, letterSpacing: 1.4,
    textTransform: 'uppercase', color: C.muted, marginBottom: 10,
  },
  instrument: { fontFamily: F.body, fontSize: 15, lineHeight: 23, color: C.ink },
  sig: { fontFamily: F.bodyBold, fontSize: 14, color: C.ink, marginTop: 14 },
  integrity: { fontFamily: F.body, fontSize: 12, marginTop: 10 },
  ok: { color: C.approve },
  bad: { color: C.danger, fontFamily: F.bodyBold },
  hash: { fontFamily: F.body, fontSize: 10.5, color: C.muted, marginTop: 2 },
  msg: { borderTopWidth: 1, borderTopColor: C.line, paddingVertical: 9 },
  who: { fontFamily: F.bodyBold, fontSize: 13, color: C.ink },
  when: { fontFamily: F.body, fontSize: 11.5, color: C.muted },
  msgText: { fontFamily: F.body, fontSize: 14.5, lineHeight: 21, color: C.ink, marginTop: 3 },
  note: { fontFamily: F.body, fontSize: 12, color: C.steel, marginBottom: 8 },
  li: { fontFamily: F.body, fontSize: 14, lineHeight: 21, color: C.ink },
  itemRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    borderBottomWidth: 1, borderBottomColor: C.line, paddingVertical: 7,
  },
  itemDesc: { flex: 1, minWidth: 0, fontFamily: F.body, fontSize: 13.5, color: C.ink },
  itemAmt: { fontFamily: F.bodySemi, fontSize: 13.5, color: C.ink },
  totalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline',
    borderTopWidth: 2, borderTopColor: C.ink, marginTop: 10, paddingTop: 8,
  },
  totalLabel: { fontFamily: F.bodySemi, fontSize: 11.5, letterSpacing: 1, color: C.muted,
    textTransform: 'uppercase' },
  totalVal: { fontFamily: F.disp, fontSize: 21, color: C.ink },
  owed: { fontFamily: F.bodyBold, fontSize: 14.5, color: C.ink, marginTop: 10 },
  footer: { fontFamily: F.body, fontSize: 11, color: C.muted, marginTop: 4, marginBottom: 8 },
});
