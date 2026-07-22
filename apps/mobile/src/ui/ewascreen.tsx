/**
 * R3 step one — the screen where a contractor writes an Extra Work Authorization.
 *
 * WHAT THIS SCREEN IS FOR: the price is not knowable on site. He has opened a wall,
 * found something, and needs the client to commit to billability and to a proceed
 * term BEFORE anyone can price it. Every control here is one of R3's terms and
 * nothing else — there is deliberately no amount field, because the moment this
 * screen offers one it stops being step one.
 *
 * THE SHAPE OF THE DECISION, and why it is three taps and not a form:
 *   proceed term (2 options) → settlement window (2 options) → confirm.
 *   T&M adds a rate and a cap, because those two numbers ARE the term. R3 offers no
 *   third proceed term and no free-text window, so neither does this.
 *
 * MANDATE #2 — nothing here sends anything. `onCreated` hands the new EWA back and
 * the caller runs the same send-preview flow a priced change order goes through, so
 * the recipient is still chosen by a human who can see who it is.
 *
 * MANDATE #6 — the rate and cap go through the same read-back as any other price:
 * shown back BIG in the exact wording the client will see, and confirmed by tapping
 * a button that states them. `createEwa` stamps numbers_confirmed_at from that tap.
 *
 * MANDATE #5 — every label goes through t(). The PREVIEW, however, is deliberately
 * NOT translated: it is the English-canonical instrument, and showing the contractor
 * a Spanish preview of a document that will be signed in English would be showing
 * him something other than what he is about to send.
 */
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';
import React from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { centsFromInput, money } from '../changeorder';
import {
  PROCEED_TERMS, SETTLEMENT_HOURS, ewaClauses, validateEwaTerms,
  type EwaTerms, type ProceedTerm, type SettlementHours,
} from '../ewa';
import { createEwa, type EwaRow } from '../ewastore';
import { t } from '../i18n';
import { C, F, T, display, label, money as moneyType } from './theme';

const newEwaId = () =>
  `co-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export function EwaScreen({
  db, decisionId, projectId, projectName, ownerId, scope, whoDirected, onCreated, onClose,
}: {
  db: AbstractPowerSyncDatabase;
  decisionId: string;
  projectId: string;
  projectName: string;
  ownerId: string;
  /** The condition, in plain language. Comes from the decision the capture became. */
  scope: string;
  whoDirected: string;
  /** Handed the new EWA's change_order id. The CALLER sends it — see mandate #2. */
  onCreated: (ewaChangeOrderId: string) => void;
  onClose: () => void;
}) {
  const [proceed, setProceed] = React.useState<ProceedTerm>('hold');
  const [hours, setHours] = React.useState<SettlementHours>(24);
  const [rateText, setRateText] = React.useState('');
  const [capText, setCapText] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const rate = centsFromInput(rateText);
  const cap = centsFromInput(capText);

  // Built on every render from what is actually on screen, so the preview below can
  // never describe a term the contractor has since changed. A cached `terms` object
  // is how a preview and a payload come to disagree.
  const terms: EwaTerms = proceed === 'tm_capped'
    ? { proceed, hourlyRateCents: rate, capCents: cap, settlementHours: hours }
    : { proceed, settlementHours: hours };

  const problem = validateEwaTerms(terms);
  const clauses = problem ? null : ewaClauses(terms,
    proceed === 'tm_capped' ? { hourlyRate: money(rate!), cap: money(cap!) } : undefined);

  const create = async () => {
    if (problem || busy) return;
    setBusy(true); setErr(null);
    const r = await createEwa(db, {
      id: newEwaId(), decisionId, projectId, ownerId, scope, whoDirected, terms,
      // The read-back happened HERE: the contractor is looking at the exact clauses
      // above this button. That tap is what the timestamp attests to.
      numbersConfirmedAt: new Date(),
    });
    setBusy(false);
    if (r.ok) onCreated(r.id);
    // A refusal key from ewa.ts, rendered through t(). It is never raw English:
    // the person reading it may not read English, and "capBelowRate" is the one
    // message that stops an authorization going out with the numbers swapped.
    else setErr(t(r.reason));
  };

  return (
    <View style={T.screen}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 120 }}>
        <Pressable onPress={onClose} hitSlop={10} style={{ paddingVertical: 8 }}>
          <Text style={{ ...label, color: C.orange }}>‹ {t('common.cancel')}</Text>
        </Pressable>

        <Text style={display(22)}>{t('ewa.title')}</Text>
        <Text style={[T.bodySteel, { marginTop: 4 }]}>{t('ewa.whenToUse')}</Text>

        <View style={[T.card, { marginTop: 14 }]}>
          <Text style={label}>{t('ewa.condition')}</Text>
          <Text style={[T.body, { marginTop: 4 }]}>{scope}</Text>
          <Text style={[T.bodySteel, { marginTop: 8 }]}>{projectName}</Text>
        </View>

        {/* ── ONE proceed term. R3 is explicit that it is one, not a combination. ── */}
        <Text style={[label, { marginTop: 18, marginBottom: 6 }]}>{t('ewa.proceedTerm')}</Text>
        {PROCEED_TERMS.map((p) => (
          <Pressable
            key={p}
            accessibilityRole="radio"
            accessibilityState={{ selected: proceed === p }}
            onPress={() => {
              setProceed(p);
              // Clearing the figures is not tidiness. `hold` states no numbers in the
              // frozen text, so carrying a stale rate into a hold authorization would
              // store a figure the signed document never mentions (mandate #5) — and
              // validateEwaTerms refuses exactly that, so this keeps the button live.
              if (p === 'hold') { setRateText(''); setCapText(''); }
            }}
            style={[T.card, proceed === p && { borderColor: C.orange, borderWidth: 2 }]}
          >
            <Text style={{ fontFamily: F.bodySemi, fontSize: 16, color: C.ink }}>
              {t(`ewa.term.${p}`)}
            </Text>
            <Text style={[T.bodySteel, { marginTop: 4 }]}>{t(`ewa.term.${p}.why`)}</Text>
          </Pressable>
        ))}

        {proceed === 'tm_capped' && (
          <View style={T.card}>
            <Text style={label}>{t('ewa.hourlyRate')}</Text>
            <TextInput
              style={inputStyle}
              value={rateText}
              onChangeText={setRateText}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={C.steel}
              accessibilityLabel={t('ewa.hourlyRate')}
            />
            <Text style={[label, { marginTop: 12 }]}>{t('ewa.cap')}</Text>
            <TextInput
              style={inputStyle}
              value={capText}
              onChangeText={setCapText}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={C.steel}
              accessibilityLabel={t('ewa.cap')}
            />
            {/* The cap read back BIG, mandate #6. It is the only number bounding
                what the client has agreed to pay, and it is the one figure the DB
                will insist appears verbatim in the signed text. */}
            <Text style={{ ...moneyType, fontSize: 34, color: C.ink, marginTop: 12 }}>
              {money(cap)}
            </Text>
            <Text style={T.bodySteel}>{t('ewa.capReadback')}</Text>
          </View>
        )}

        {/* ── the settlement promise ── */}
        <Text style={[label, { marginTop: 18, marginBottom: 6 }]}>{t('ewa.settlementWindow')}</Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {SETTLEMENT_HOURS.map((h) => (
            <Pressable
              key={h}
              accessibilityRole="radio"
              accessibilityState={{ selected: hours === h }}
              onPress={() => setHours(h)}
              style={[T.card, { flex: 1, alignItems: 'center' },
                      hours === h && { borderColor: C.orange, borderWidth: 2 }]}
            >
              <Text style={display(20)}>{t({ k: 'ewa.hoursN', p: { n: h } })}</Text>
            </Pressable>
          ))}
        </View>
        {/* Said out loud, because the window is a PROMISE the app will hold him to:
            miss it and the extra is flagged "Unpriced — send price" (AC4). A
            contractor who did not know that would read 24h as the friendlier
            option rather than the stricter one. */}
        <Text style={T.bodySteel}>{t('ewa.windowIsAPromise')}</Text>

        {/* ── what the client will actually sign ── */}
        <Text style={[label, { marginTop: 18, marginBottom: 6 }]}>{t('ewa.theyWillSee')}</Text>
        <View style={[T.card, { borderColor: C.ink }]}>
          {clauses
            ? clauses.map((c, i) => (
                <Text key={i} style={[T.body, i > 0 && { marginTop: 8 }]}>{c}</Text>
              ))
            : <Text style={[T.body, { color: C.danger }]}>{t(problem!.k)}</Text>}
        </View>
        <Text style={T.bodySteel}>{t('ewa.noPriceHere')}</Text>

        {err && <Text style={[T.body, { color: C.danger, marginTop: 10 }]}>{err}</Text>}

        <Pressable
          disabled={!!problem || busy}
          onPress={create}
          style={[T.btn, T.btnOrange, { marginTop: 18 }, (!!problem || busy) && T.btnOff]}
        >
          <Text style={T.btnText}>{busy ? t('ewa.saving') : t('ewa.create')}</Text>
        </Pressable>
        {/* Nothing has left the phone. Say so, in the same voice the priced card
            uses ("co.nothingSent"), so the two flows do not appear to differ on the
            one point where they must not. */}
        <Text style={[T.bodySteel, { marginTop: 8 }]}>{t('ewa.nothingSentYet')}</Text>
      </ScrollView>
    </View>
  );
}

const inputStyle = {
  borderWidth: 1, borderColor: C.line, borderRadius: 10,
  paddingHorizontal: 12, minHeight: 52,
  fontFamily: F.bodyMed, fontSize: 20, color: C.ink,
} as const;

/**
 * AC4 — "the EWA is flagged 'Unpriced—send price' prominently".
 *
 * PROMINENTLY is the requirement, so this is a full-width danger banner at the top
 * of the ledger, not a chip on a row the contractor has to scroll to. It is his own
 * late promise; burying it would be the app protecting him from a fact the client
 * already has in writing.
 *
 * It offers ONE action, and that action is "price it" — not "remind the client".
 * AC4 is explicit that the reminder goes to the contractor, and chasing the client
 * for a price the contractor has not produced would blame the wrong party.
 */
export function UnpricedEwaBanner({
  rows, onPrice,
}: {
  rows: EwaRow[];
  onPrice: (ewa: EwaRow) => void;
}) {
  const flagged = rows.filter((r) => r.unpriced.flagged);
  if (!flagged.length) return null;
  return (
    <View style={{
      backgroundColor: C.danger, borderRadius: 14, padding: 14, marginBottom: 12,
    }}>
      {/* display() infers its default colour as a literal type, so an override has
          to be applied as a style rather than passed in. Same result, and it keeps
          theme.ts untouched. */}
      <Text style={[display(16), { color: '#fff' }]}>
        {t({ k: 'ewa.unpricedTitle', p: { n: flagged.length } })}
      </Text>
      {flagged.map((r) => (
        <Pressable
          key={r.id}
          onPress={() => onPrice(r)}
          accessibilityLabel={t('ewa.sendPrice')}
          style={{ marginTop: 10 }}
        >
          <Text style={{ fontFamily: F.bodySemi, fontSize: 15, color: '#fff' }}
                numberOfLines={2}>
            {r.scope}
          </Text>
          <Text style={{ fontFamily: F.body, fontSize: 13, color: '#fff', opacity: 0.9 }}>
            {t({ k: 'ewa.overdueBy', p: { h: Math.floor(r.unpriced.overdueByMs / 3_600_000) } })}
            {r.capCents != null ? ` · ${t({ k: 'ewa.capIs', p: { cap: money(r.capCents) } })}` : ''}
          </Text>
          <Text style={{ ...label, color: '#fff', marginTop: 4 }}>
            {t('ewa.sendPrice')} →
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
