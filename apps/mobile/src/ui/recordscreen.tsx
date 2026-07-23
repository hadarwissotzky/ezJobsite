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
import { Image, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import type { ExtraRecord, RecordPerson, RecordVoice } from '../record';
import { playCapture, playbackState, stopPlayback } from '../annotate';
import type { DecisionSummary } from '../decisionsummary';
import { DecisionSummaryCard } from './decisionsummarycard';
import type { ApprovalPanel } from '../eventlog';
import { RecordApproval } from './recordapproval';
import { NarratedScope, type ScopePhoto } from './narratedscope';
import type { Alignment } from '../photonarration';
import { threadState, type ThreadMessage } from '../discussion';
import { chipKey, displayStatus, type LedgerStatus } from '../extrastatus';
import { DiscussionLog } from './threadscreen';
import { createdLabel } from '../changeorder';
import { t } from '../i18n';
import { C, F, T, chipStyle, display, label } from './theme';
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';
import { MoneyLine, PeopleCard, TypeLine, useRecordFacts } from './recordfacts';

/** Mirrors the ledger's colour semantics (coChip in App.tsx): discussing is
 *  orange — this app's "act on this" — because a question means the ball is in
 *  the contractor's court. Superseded and draft share ink; on this screen the
 *  state bar disambiguates them in words. */
function chipKind(s: LedgerStatus) {
  if (s === 'approved') return 'approved' as const;
  if (s === 'declined') return 'declined' as const;
  if (s === 'sent') return 'pending' as const;
  if (s === 'discussing') return 'ewa' as const;
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
  /** R2: photos grouped under the sentence spoken over them. Null, or an alignment
   *  with nothing in it, renders nothing and the plain evidence grid below stands. */
  narration?: Alignment<ScopePhoto> | null;
  /** R5b: the discussion, lineage-walked (threadFor). Null when not loaded — the
   *  record renders without it, same rule as every other optional layer here. */
  thread?: ThreadMessage[] | null;
  /** Open client questions on THIS version — the ledger's own signal (R7), NOT
   *  derived from `thread`: the thread deliberately carries prior versions'
   *  messages, and counting those would mark a fresh revision "discussing" here
   *  while the ledger says "sent" (Codex review, 2026-07-22). */
  openQuestions?: number;
  /** Reply ids still in the outbox (mandate #1: an undelivered reply says so). */
  undelivered?: ReadonlySet<string>;
  /** R5b's "Revised: $1,850 → $1,500" marker — set when THIS extra supersedes an
   *  older version. Both sides pre-formatted by money(). */
  revision?: { priorAmount: string; newAmount: string } | null;
  onBack: () => void;
  onCapture?: () => void;
  /** R6 / R5b AC3 — write the approval document and open the share sheet. */
  onShare?: () => void;
  /** R5b reply, straight from the record (prototype c5's reply bar). A reply is a
   *  message: it commits nothing, prices nothing, and may never move status. */
  onReply?: (text: string) => Promise<void>;
  /** R8 manual remind — same link, never a new token. Resolves with the verdict so
   *  a refusal is SHOWN here; the record screen has no other status surface. */
  onRemind?: () => Promise<{ ok: boolean; why?: string }>;
  /** R5b/R7 Revise & resend — hands off to the priced read-back composer.
   *  App.tsx passes it only when canSupersede(status). */
  onRevise?: () => void;
  /** Send a ready draft for approval (opens the R5c send preview). Passed only
   *  when the draft's readiness gate is green. */
  onSend?: () => void;
  /** On a superseded record: open the version that replaced it. */
  onOpenCurrent?: () => void;
  /** Offered ONLY while the extra is a draft — App.tsx passes undefined once it
   *  has been sent, because a client may have read it by then. */
  onDelete?: () => void;
  /** Where the extra's evidence is on its way to the cloud — an i18n key from
   *  canSendExtra, undefined once everything behind it is processed. hadar,
   *  from the device: "no indication even if it takes time that it was in the
   *  process of doing it". This is that indication, on the screen where he
   *  went looking for it. */
  readinessKey?: string;
}) {
  const { rec } = props;
  const messages = props.thread ?? [];
  // R7's derived vocabulary, the same way the ledger and the thread derive it:
  // the chip must never disagree with the list the contractor just came from.
  const st = threadState({ coStatus: rec.status, messages, nowMs: Date.now() });
  const shown = displayStatus(rec.status, { openQuestions: props.openQuestions ?? 0 });
  const chip = chipStyle(chipKind(shown));
  const facts = useRecordFacts(props.db, rec.id, rec.status);
  // The photo the lightbox is showing, or null. Tapping a thumbnail sets it.
  const [zoom, setZoom] = React.useState<string | null>(null);
  // Reply being typed, and the in-flight flag (same rules as ThreadScreen: clear
  // only after the write resolved; a failed write keeps the words).
  const [draft, setDraft] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  // A refused action's reason. This screen has no other status surface, and a
  // button that silently does nothing is the failure this repo names most often.
  const [actionNote, setActionNote] = React.useState<string | null>(null);
  // Measured height of the bottom bar, so the capture FAB sits above it instead
  // of covering the reply field's send button.
  const [barH, setBarH] = React.useState(0);

  // R6b item 2 with R5b folded in: when the thread says the ball moved, the state
  // line says so — the stored status alone would keep reading "Sent — remind them"
  // while the client sits waiting on an answer.
  const stateMsg = shown === 'discussing'
    ? { k: st.unansweredSinceMs !== null ? 'erec.stQuestion' : 'erec.stTheirTurn' }
    : { k: rec.stateLineKey, p: rec.stateLineParams };

  const composer = st.canReply && !!props.onReply;
  const terminal = shown === 'approved' || shown === 'declined' || shown === 'superseded';

  const sendReply = async () => {
    const text = draft.trim();
    if (!text || busy || !props.onReply) return;
    setBusy(true);
    try {
      await props.onReply(text);
      setDraft(''); setActionNote(null);
    } catch (e: any) {
      setActionNote(String(e?.message ?? e));
    } finally { setBusy(false); }
  };

  const remind = async () => {
    if (!props.onRemind) return;
    const r = await props.onRemind();
    setActionNote(!r.ok && r.why ? r.why : null);
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      {/* paddingTop 54 = this app's status-bar clearance (homeC, reviewscreen…).
          Without it the back control rendered UNDER the iPhone clock — hadar,
          from the device 2026-07-22: "no way to get back from it". */}
      <ScrollView contentContainerStyle={{ padding: 18, paddingTop: 54, paddingBottom: 120 }}>
        <Pressable onPress={props.onBack} hitSlop={12}
          style={{ minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start', paddingRight: 24 }}>
          <Text style={{ ...label, fontSize: 15, color: C.orange }}>‹ {t('erec.back')}</Text>
        </Pressable>

        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
          <Text style={{ ...display(22), flex: 1 }} numberOfLines={3}>{rec.title}</Text>
          <View style={[T.chip, { backgroundColor: chip.bg }]}>
            <Text style={[T.chipText, { color: chip.fg }]}>{t(chipKey(shown))}</Text>
          </View>
        </View>

        {/* R6b item 1: type (Extra/Decision), then the money block. Mandate #6: the
            price is the CONTRACTOR'S, read back and confirmed by a human. A Decision
            renders "No cost change" and no figure anywhere (R6b AC2 / R10). */}
        <TypeLine facts={facts} />
        <MoneyLine rec={rec} facts={facts} />

        {/* R5b: the thread carries across versions with a visible marker. */}
        {props.revision && (
          <View style={{
            marginTop: 10, borderRadius: 12, padding: 12,
            backgroundColor: '#F1F3F0', borderWidth: 1, borderColor: C.line,
          }}>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: C.ink }}>
              {t({ k: 'r5b.revisedFrom', p: {
                prior: props.revision.priorAmount, next: props.revision.newAmount } } as any)}
            </Text>
          </View>
        )}

        <View style={{
          marginTop: 12, borderRadius: 12, padding: 12,
          backgroundColor: '#FFF3EA', borderWidth: 1, borderColor: '#FFD9C2',
        }}>
          <Text style={{ fontFamily: F.bodyMed, fontSize: 14, color: '#7A3A12', lineHeight: 20 }}>
            {t(stateMsg as any)}
            {props.readinessKey ? `\n${t(props.readinessKey as any)}` : ''}
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

        {/* The voice narration — the source of the extra, with its own metadata and
            playback. The transcript (in the summary/description) is derived from it. */}
        {rec.voice && <VoicePlayer voice={rec.voice} />}

        {/* Evidence. Mandate #1: a file the row promises but the device does not
            have is SHOWN as missing. A blank tile would be silent loss. */}
        {/* R2: when the transcript is here, the photos are grouped under what was
            being said as each was taken. When it is not — offline, no STT key, not
            processed yet — this renders nothing and the plain grid below stands.
            Never both: the grid is the fallback, not a companion. */}
        {props.narration && <NarratedScope alignment={props.narration} />}
        {!props.narration && rec.photos.length > 0 && (
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
                    <Pressable onPress={() => setZoom(p.uri)}>
                      <MaybeImage uri={p.uri} />
                    </Pressable>
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
        {/* R5b AC3: the discussion log, with timestamps, beneath the snapshot.
            Read-only here — the live composer is the bar below, and only while
            the thread is open; a closed record shows the log alone. */}
        <DiscussionLog messages={messages} formatAt={createdLabel}
          undelivered={props.undelivered} />
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

        {/* Share, as a quiet row while the extra is still live. Once it is
            terminal the evidence bundle becomes the point of the record and the
            same action moves into the bar below as the primary. */}
        {props.onShare && !terminal && (
          <Pressable
            onPress={props.onShare}
            accessibilityLabel={t('erec.share')}
            style={{ marginTop: 24, paddingVertical: 14, alignItems: 'center' }}>
            <Text style={{ ...T.body, fontSize: 15, color: C.steel }}>
              {t('erec.share')}
            </Text>
          </Pressable>
        )}

        {/* Delete lives HERE, at the bottom of the record, because this is the
            screen someone opens when they have decided they do not want it. It
            was first put on the ledger row only, which is not where anyone
            looks. Last in the scroll on purpose: a destructive action should be
            reachable, never adjacent to the thumb by accident. */}
        {props.onDelete && (
          <Pressable
            onPress={props.onDelete}
            accessibilityLabel={t('discard.action')}
            style={{ marginTop: 28, marginBottom: 40, paddingVertical: 14, alignItems: 'center' }}>
            <Text style={{ ...T.body, fontSize: 15, color: C.danger }}>
              {t('discard.action')}
            </Text>
          </Pressable>
        )}
      </ScrollView>

      {/* The c5 bottom bar: reply, then the ONE action this state calls for.
          The primary follows the state, not the layout — while the extra is out
          the primary is Remind; a question makes the reply the primary path; a
          terminal record's primary is its evidence bundle. A static button pair
          cannot serve a screen whose job is "where does this stand". */}
      {(composer || props.onSend || props.onRemind || props.onRevise
        || props.onOpenCurrent || (terminal && props.onShare)) && (
        <View
          onLayout={(e) => setBarH(e.nativeEvent.layout.height)}
          style={{
            borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.card,
            padding: 12, paddingBottom: 22, gap: 10,
          }}>
          {composer && (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                multiline
                placeholder={t('r5b.replyPlaceholder')}
                placeholderTextColor={C.steel}
                accessibilityLabel={t('r5b.replyPlaceholder')}
                style={{
                  flex: 1, fontFamily: F.body, fontSize: 16, color: C.ink,
                  minHeight: 54, borderWidth: 1.5, borderColor: C.line,
                  borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
                  backgroundColor: '#fff',
                }}
              />
              <Pressable
                onPress={sendReply}
                disabled={!draft.trim() || busy}
                accessibilityLabel={t('r5b.send')}
                style={{
                  minWidth: 54, minHeight: 54, borderRadius: 12,
                  backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center',
                  opacity: !draft.trim() || busy ? 0.4 : 1,
                }}>
                <Text style={{ color: '#fff', fontSize: 20 }}>↑</Text>
              </Pressable>
            </View>
          )}

          <View style={{ flexDirection: 'row', gap: 8 }}>
            {shown === 'draft' && props.onSend && (
              <Pressable onPress={props.onSend} accessibilityLabel={t('erec.send')}
                style={[T.btn, T.btnInk, { flex: 1, minHeight: 60 }]}>
                <Text style={T.btnText}>{t('erec.send')}</Text>
              </Pressable>
            )}
            {shown === 'sent' && props.onRemind && (
              <Pressable onPress={() => { void remind(); }} accessibilityLabel={t('r8.remind')}
                style={[T.btn, T.btnInk, { flex: 1, minHeight: 60 }]}>
                <Text style={T.btnText}>{t('r8.remind')}</Text>
              </Pressable>
            )}
            {(shown === 'sent' || shown === 'discussing') && props.onRevise && (
              <Pressable onPress={props.onRevise} accessibilityLabel={t('r5b.revise')}
                style={[T.btn, { flex: 1, minHeight: 60, borderWidth: 1.5, borderColor: C.orange }]}>
                <Text style={[T.btnText, { color: C.orange, fontSize: 16 }]}>
                  {t('r5b.revise')}
                </Text>
              </Pressable>
            )}
            {shown === 'superseded' && props.onOpenCurrent && (
              <Pressable onPress={props.onOpenCurrent} accessibilityLabel={t('erec.viewCurrent')}
                style={[T.btn, T.btnInk, { flex: 1, minHeight: 60 }]}>
                <Text style={T.btnText}>{t('erec.viewCurrent')}</Text>
              </Pressable>
            )}
            {terminal && props.onShare && (
              <Pressable onPress={props.onShare} accessibilityLabel={t('erec.share')}
                style={shown === 'superseded' && props.onOpenCurrent
                  ? [T.btn, { flex: 1, minHeight: 60, borderWidth: 1.5, borderColor: C.ink }]
                  : [T.btn, T.btnInk, { flex: 1, minHeight: 60 }]}>
                <Text style={shown === 'superseded' && props.onOpenCurrent
                  ? [T.btnText, { color: C.ink, fontSize: 16 }]
                  : T.btnText}>
                  {t('erec.share')}
                </Text>
              </Pressable>
            )}
          </View>

          {actionNote !== null && (
            <Text style={{ ...T.body, fontSize: 13, color: C.danger }}>{actionNote}</Text>
          )}
          {/* Says the rule out loud where it could be broken (mandate #2 / R5b):
              a price never settles in chat. */}
          {composer && (
            <Text style={{ ...T.bodySteel, fontSize: 11.5 }}>{t('r5b.priceNeedsRevision')}</Text>
          )}
        </View>
      )}

      {props.onCapture && (
        <Pressable
          onPress={props.onCapture}
          accessibilityLabel={t('erec.capture')}
          style={{
            // Above the action bar when there is one — never covering the reply
            // field or the primary button — centered at the thumb otherwise.
            position: 'absolute', bottom: barH > 0 ? barH + 12 : 26,
            ...(barH > 0 ? { right: 16 } : { alignSelf: 'center' as const }),
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

      {/* Photo lightbox — tap a thumbnail to see it full-size, tap anywhere to close. */}
      <Modal visible={zoom !== null} transparent animationType="fade"
        onRequestClose={() => setZoom(null)}>
        <Pressable onPress={() => setZoom(null)}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.94)', alignItems: 'center', justifyContent: 'center' }}>
          {zoom && <Image source={{ uri: zoom }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />}
          <Text style={{ position: 'absolute', top: 54, right: 22, color: '#fff',
            fontFamily: F.disp, fontSize: 15, letterSpacing: 1 }}>✕ {t('common.close')}</Text>
        </Pressable>
      </Modal>
    </View>
  );
}

/** The voice narration: metadata + playback. The audio IS the record (the transcript
 *  is derived from it), so it gets a real player, not just a transcript. Uses the
 *  app's shared expo-audio player (annotate.ts) — one player, so starting a second
 *  clip stops the first, and leaving the screen stops playback. */
function VoicePlayer({ voice }: { voice: RecordVoice }) {
  const [playing, setPlaying] = React.useState(false);
  const [pos, setPos] = React.useState(0);
  const [dur, setDur] = React.useState(0);

  React.useEffect(() => () => { stopPlayback(); }, []);

  React.useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const st = playbackState();
      if (st.durationSec > 0) setDur(st.durationSec);
      setPos(st.positionSec);
      // expo-audio flips `playing` false at the tail; treat that as ended and reset.
      if (!st.playing && st.positionSec > 0) { stopPlayback(); setPlaying(false); setPos(0); }
    }, 250);
    return () => clearInterval(id);
  }, [playing]);

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  const toggle = async () => {
    if (playing) { stopPlayback(); setPlaying(false); setPos(0); return; }
    const r = await playCapture(voice.uri);
    if (r.ok) { setDur(r.durationSec || dur); setPlaying(true); }
  };

  const pct = dur > 0 ? Math.min(100, (pos / dur) * 100) : 0;

  return (
    <View style={T.card}>
      <Text style={label}>{t('erec.voice')}</Text>
      {!voice.present ? (
        <Text style={{ ...T.body, fontSize: 13.5, color: C.danger, marginTop: 6 }}>
          {t('erec.voiceMissing')}
        </Text>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 12 }}>
          <Pressable onPress={toggle} accessibilityLabel={t('erec.voicePlay')} style={{
            width: 52, height: 52, borderRadius: 26, backgroundColor: C.ink,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ color: '#fff', fontSize: 20 }}>{playing ? '❚❚' : '▶'}</Text>
          </Pressable>
          <View style={{ flex: 1 }}>
            <View style={{ height: 6, borderRadius: 3, backgroundColor: C.line, overflow: 'hidden' }}>
              <View style={{ width: `${pct}%`, height: 6, backgroundColor: C.orange }} />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
              <Text style={{ ...T.bodySteel, fontSize: 12 }}>{voice.at}</Text>
              <Text style={{ ...T.bodySteel, fontSize: 12, fontVariant: ['tabular-nums'] }}>
                {(playing || pos > 0) ? `${fmt(pos)} / ${fmt(dur)}` : (dur > 0 ? fmt(dur) : t('erec.voicePlay'))}
              </Text>
            </View>
          </View>
        </View>
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
