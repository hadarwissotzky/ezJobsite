/**
 * REQ-PROC8 — the proposal review surface. The screen the pipeline was writing into
 * a void without.
 *
 * A capture is structured by the model into `capture_structured`; this screen renders
 * that proposal so a HUMAN turns it into a Decision. It is the mandate #2 gate made
 * visible: the model proposes, a person disposes.
 *
 * The rules it enforces on screen (not just in comments):
 *  - **low/none confidence arrives EMPTY**, with the reason shown, so the human writes
 *    it rather than nodding at a confident-looking guess (`prefillFrom`).
 *  - **The price is read back, never asserted.** `parseMoney` only trusts an explicit
 *    currency marker; "four fifty" is refused on purpose. What it heard is shown as
 *    CONTEXT for the person, and is not written into the decision as money — the priced,
 *    sendable change order is a separate instrument (mandate #6).
 *  - **Provenance is visible** — which engine, which model, and the exact transcript it
 *    was given. A proposal you can't argue with can't be improved.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';
import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { money, parseMoney } from '../changeorder';
import { recordDecision } from '../decisions';
import { fetchProposal, prefillFrom, type Proposal } from '../proposals';
import { C, F, T, display, label, money as moneyType } from './theme';

export function ReviewScreen({
  db, client, captureId, projectId, projectName, ownerId, onDone, onClose,
}: {
  db: AbstractPowerSyncDatabase;
  client: SupabaseClient;
  captureId: string;
  projectId: string;
  projectName: string;
  ownerId: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const [loading, setLoading] = React.useState(true);
  const [prop, setProp] = React.useState<Proposal | null>(null);
  const [subject, setSubject] = React.useState('');
  const [value, setValue] = React.useState('');
  const [who, setWho] = React.useState('');
  const [why, setWhy] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    (async () => {
      try {
        const p = await fetchProposal(client, captureId);
        setProp(p);
        const f = prefillFrom(p);
        setSubject(f.subject); setValue(f.value); setWho(f.whoDirected); setWhy(f.why);
      } catch (e: any) {
        setErr(e?.message ?? String(e));
      } finally { setLoading(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureId]);

  // Mandate #6: read back what was HEARD; never let the model assert a number.
  const heard = prop?.fromTranscript ? parseMoney(prop.fromTranscript) : null;

  const canSave = subject.trim().length > 0 && value.trim().length > 0 && !saving;

  const confirm = async () => {
    if (!canSave) return;
    setSaving(true); setErr(null);
    try {
      await recordDecision(db, {
        projectId, ownerId, captureId,
        subject: subject.trim(), value: value.trim(),
        directedBy: who.trim() || undefined,
        scopeLevel: prop?.scope ?? 'project',
      });
      onDone();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setSaving(false);
    }
  };

  return (
    <View style={T.screen}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                     paddingHorizontal: 18, paddingTop: 54, paddingBottom: 8 }}>
        <Pressable onPress={onClose} hitSlop={14}>
          <Text style={[T.btnGhostText, { fontSize: 15 }]}>Back</Text>
        </Pressable>
        <Text style={display(20)}>EZ<Text style={{ color: C.orange }}>jobsite</Text></Text>
        <View style={{ width: 44 }} />
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={C.orange} size="large" />
          <Text style={[T.bodySteel, { marginTop: 14 }]}>Reading what the recording said…</Text>
        </View>
      ) : (
        <>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 20 }}>
            <Text style={[display(24), { marginBottom: 12 }]}>Review before it counts</Text>

            {/* No proposal yet — say so plainly rather than showing an empty form. */}
            {!prop && (
              <View style={[T.card, { backgroundColor: '#FFF7E0', borderColor: '#F0DE9E' }]}>
                <Text style={[T.body, { color: '#6B5300' }]}>
                  Nothing structured yet. Either the recording is still being processed, or
                  it had no words to work from. You can still write the decision yourself.
                </Text>
              </View>
            )}

            {/* Confidence was low/none: fields deliberately empty + the reason. */}
            {why && (
              <View style={[T.card, { backgroundColor: '#FFF7E0', borderColor: '#F0DE9E' }]}>
                <Text style={label}>Not filled in on purpose</Text>
                <Text style={[T.body, { color: '#6B5300', marginTop: 4 }]}>{why}</Text>
              </View>
            )}

            <View style={T.card}>
              <Text style={label}>Job</Text>
              <Text style={[T.body, { fontFamily: F.bodySemi, marginTop: 4 }]}>{projectName}</Text>
            </View>

            <View style={T.card}>
              <Text style={label}>What was decided</Text>
              <TextInput
                style={[T.body, { marginTop: 6, paddingVertical: 4 }]}
                value={subject} onChangeText={setSubject}
                placeholder="e.g. subfloor under tub" placeholderTextColor="#8c959f"
              />
            </View>

            <View style={T.card}>
              <Text style={label}>The decision</Text>
              <TextInput
                style={[T.body, { marginTop: 6, paddingVertical: 4, minHeight: 66 }]}
                value={value} onChangeText={setValue} multiline
                placeholder="e.g. replace the rotted section before tile"
                placeholderTextColor="#8c959f"
              />
            </View>

            <View style={T.card}>
              <Text style={label}>Who it's directed to (optional)</Text>
              <TextInput
                style={[T.body, { marginTop: 6, paddingVertical: 4 }]}
                value={who} onChangeText={setWho}
                placeholder="e.g. the tile sub" placeholderTextColor="#8c959f"
              />
            </View>

            {/* MANDATE #6 — the money read-back. Heard, not asserted. */}
            {heard && heard.cents !== null && (
              <View style={[T.card, { borderColor: C.orange, borderWidth: 2 }]}>
                <Text style={label}>A number was said out loud</Text>
                <Text style={[moneyType, { fontSize: 34, color: C.ink, marginTop: 2 }]}>
                  {money(heard.cents)}
                </Text>
                <Text style={[T.bodySteel, { marginTop: 6 }]}>
                  {heard.confidence === 'high'
                    ? 'Heard clearly in the recording.'
                    : 'Heard, but not clearly — check it against what you said.'}
                  {' '}This is not a price yet: a priced change order is a separate,
                  signed instrument.
                </Text>
              </View>
            )}

            {/* Provenance — a proposal you can't argue with can't be improved. */}
            {prop && (
              <View style={T.card}>
                <Text style={label}>What the recording said</Text>
                <Text style={[T.bodySteel, { marginTop: 6, fontStyle: 'italic' }]}>
                  “{prop.fromTranscript ?? '—'}”
                </Text>
                <Text style={[T.bodySteel, { marginTop: 8, fontSize: 12 }]}>
                  Proposed by {prop.engine}{prop.engineModel ? ` · ${prop.engineModel}` : ''} ·
                  confidence {prop.confidence}. A proposal, not a record — it counts when you confirm it.
                </Text>
              </View>
            )}

            {err && <Text style={[T.body, { color: C.danger, marginTop: 6 }]}>{err}</Text>}
          </ScrollView>

          <View style={{ paddingHorizontal: 18, paddingBottom: 30 }}>
            <Pressable style={[T.btn, T.btnOrange, !canSave && T.btnOff]} disabled={!canSave} onPress={confirm}>
              {saving ? <ActivityIndicator color="#fff" />
                : <Text style={T.btnText}>Confirm decision</Text>}
            </Pressable>
            <Pressable style={[T.btn, T.btnGhost, { marginTop: 4 }]} onPress={onClose}>
              <Text style={T.btnGhostText}>Not now</Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}
