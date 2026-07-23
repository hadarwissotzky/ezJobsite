/**
 * R6b items 1 and 3, rendered — the type line, the money block and the People card.
 *
 * These are separate components rather than more JSX inside recordscreen.tsx for
 * one reason: they need a database read (the actor facts), and the record screen is
 * otherwise a pure function of the record it is handed. Keeping the read in one
 * hook here means the screen's other sections cannot start depending on it by
 * accident, and it matches the precedent of ReviewScreen taking `db` as a prop.
 *
 * Every string goes through t() with a key. The record screen is a legal artifact
 * and mandate #5 puts it in the reader's language, not the author's.
 */
import React from 'react';
import { Text, View } from 'react-native';
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';
import { createdLabel } from '../changeorder';
import { roleLabel, typeLabel } from '../approvers';
import { isApproverRole, isExtraType } from '../approverrouting';
import { t } from '../i18n';
import { recordFacts, type RecordFacts } from '../recordactors';
import { APPROVER_KEY, KIND_KEY, moneyBlock, type Item, type PersonRow } from '../recordpeople';
import { C, F, T, label, money as moneyStyle } from './theme';

/**
 * Load the actor facts for the open record.
 *
 * `statusKey` is in the dependency list, not the record object: App.tsx re-derives
 * the whole ExtraRecord on every refresh tick, so depending on the object would
 * re-query every few seconds forever. Status is what actually changes the answer --
 * a send adds the approver row and the sender row.
 *
 * Local SQLite only. No network, so this works in a basement (mandate #7), and a
 * failure leaves `null`, which every consumer below treats as "say nothing" rather
 * than as an error worth interrupting a legal record with.
 */
export function useRecordFacts(
  db: AbstractPowerSyncDatabase, coId: string, statusKey: string
): RecordFacts | null {
  const [facts, setFacts] = React.useState<RecordFacts | null>(null);
  React.useEffect(() => {
    let live = true;
    setFacts(null);
    (async () => {
      try {
        const f = await recordFacts(db, coId);
        if (live) setFacts(f);
      } catch { /* the record renders without it; the history is the source */ }
    })();
    return () => { live = false; };
  }, [db, coId, statusKey]);
  return facts;
}

/**
 * R6b item 1: "item title, type (Extra/Decision), status chip".
 *
 * The R5c type rides along on the same line when it is set, because it answers the
 * next question down ("what kind of extra keeps happening on this job") and an
 * untyped extra is a normal extra — no placeholder, the segment is simply absent.
 */
export function TypeLine({ facts, job }: { facts: RecordFacts | null; job?: string | null }) {
  if (!facts) return null;
  const type = isExtraType(facts.extraType) ? typeLabel(facts.extraType) : null;
  return (
    <Text style={{ ...label, marginTop: 6 }}>
      {t(KIND_KEY[facts.kind])}{type ? ` · ${type}` : ''}{job ? ` · ${job}` : ''}
    </Text>
  );
}

/**
 * R6b item 1's money block, and R6b's second AC: "Given an item of type Decision,
 * when its record renders, then no price is shown anywhere on the screen and the
 * money block reads 'No cost change'."
 *
 * NOTHING renders until the facts have loaded. That is the AC held by construction:
 * the alternative — show the price now, correct it when the kind arrives — puts a
 * dollar figure on a Decision for a frame, and "no price anywhere" does not have a
 * frame's exemption. The cost is that a priced extra's amount appears one tick
 * after the title, from a local query.
 *
 * Mandate #6 is the reason for the label: the amount is the CONTRACTOR'S price,
 * read back and confirmed by a human. The system never authors one.
 */
export function MoneyLine(
  { rec, facts }: { rec: { amount: string; priced: boolean; nte: string | null; isMini: boolean };
                    facts: RecordFacts | null }
) {
  if (!facts) return null;
  const item: Item = facts.kind === 'decision'
    ? { kind: 'decision' }
    // `priced` gates the amount because money() renders a null price as the
    // STRING '—' — moneyBlock's null-check can never see a dash, so an unpriced
    // extra showed "— Fixed · the price you set" instead of "No price given
    // yet" (hadar, on device 2026-07-22).
    : { kind: 'extra', amount: rec.priced ? rec.amount : null, nte: rec.nte, isMini: rec.isMini };
  const b = moneyBlock(item);

  if (b.show === 'noCost') {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 9, marginTop: 8 }}>
        <Text style={{ ...moneyStyle, fontSize: 24, color: C.ink }}>{t('erec.noCostChange')}</Text>
      </View>
    );
  }
  // An extra that costs money with no price stated yet. Rendered at the same size
  // as a price so it reads as the answer to "how much", not as a missing field —
  // and never as "no cost change", which would tell the homeowner it is free.
  if (b.show === 'priceToCome') {
    return (
      <View style={{ marginTop: 8 }}>
        <Text style={{ ...moneyStyle, fontSize: 24, color: C.steel }}>
          {t('erec.priceToCome')}
        </Text>
      </View>
    );
  }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 9, marginTop: 8 }}>
      <Text style={{ ...moneyStyle, fontSize: 30, color: C.ink }}>{b.amount}</Text>
      <Text style={T.bodySteel}>
        {b.nte ? t({ k: 'erec.nte', p: { amount: b.nte } }) : t('erec.fixed')}
        {b.isMini ? ` · ${t('erec.mini')}` : ''} · {t('erec.yourPrice')}
      </Text>
    </View>
  );
}

/**
 * R6b item 3: "the approver (name + role label), captured by, and priced/sent by,
 * each with its timestamp".
 *
 * Rows come from `assemblePeople`, which only ever emits stored facts. An empty
 * list renders NOTHING — no "unknown", no placeholder avatar. record.ts's rule:
 * where a fact is not stored the line is omitted, never filled in with a plausible
 * substitute.
 */
export function PeopleCard({ facts }: { facts: RecordFacts | null }) {
  if (!facts || !facts.people.length) return null;
  return (
    <View style={T.card}>
      <Text style={label}>{t('erec.people')}</Text>
      <View style={{ marginTop: 8, gap: 11 }}>
        {facts.people.map((p, i) => <PersonLine key={`${p.kind}-${i}`} p={p} />)}
      </View>
    </View>
  );
}

function PersonLine({ p }: { p: PersonRow }) {
  const role = isApproverRole(p.roleSlug) ? roleLabel(p.roleSlug) : null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
      <View style={{
        width: 34, height: 34, borderRadius: 17, alignItems: 'center',
        justifyContent: 'center', backgroundColor: p.kind === 'approver' ? C.approve : C.ink,
      }}>
        <Text style={{ fontFamily: F.disp, fontSize: 13, color: '#fff' }}>{initials(p.name)}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: F.bodySemi, fontSize: 15, color: C.ink }}>{p.name}</Text>
        {/* One line per contribution: what they did, and when. R5c's AC wants the
            approver's ROLE beside the name — "who was entitled to approve this" is
            part of the record, not just who did. */}
        {p.contributions.map((c) => (
          <Text key={c.roleKey} style={{ ...T.bodySteel, fontSize: 12.5 }}>
            {t(c.roleKey)}
            {c.roleKey === APPROVER_KEY && role ? ` · ${role}` : ''}
            {/* No time recorded is SAID, never guessed at. The signature's real
                timestamp is authored server-side (record.ts's KNOWN GAP). */}
            {c.atMs != null ? ` · ${createdLabel(c.atMs)}` : ` · ${t('erec.noTime')}`}
          </Text>
        ))}
      </View>
    </View>
  );
}

/** Initials for the avatar. Same rule as the screen's other roster tiles. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
