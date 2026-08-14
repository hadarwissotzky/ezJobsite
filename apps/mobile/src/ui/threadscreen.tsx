/**
 * R5b — the discussion thread. The screen a push notification opens.
 *
 * The two moves R5b gives a contractor from a thread are REPLY and REVISE & RESEND,
 * and they are deliberately not equal here. Reply is the composer at the bottom,
 * always in reach. Revise is a separate, quieter control, because it issues a new
 * priced instrument and nothing that issues a price should be the easy tap next to
 * a text box (mandate #2).
 *
 * WHAT THIS SCREEN REFUSES TO DO: it never turns a message into an agreement. There
 * is no "accept this price" affordance anywhere in the thread, no matter what the
 * client typed. R5b: "'ok, $1,500' in chat is not an approval and the UI never
 * treats it as one." A price moves only through Revise, which lands on the priced
 * read-back field like every other price (mandate #6).
 *
 * Every string goes through t(). The record screen shipped English baked into the
 * component once already; a thread is the LAST place to repeat that, because it is
 * the surface where a Spanish-reading contractor is being asked to answer a question
 * about money.
 */
import React from 'react';
import * as FS from 'expo-file-system/legacy';
import { Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { t } from '../i18n';
import { clientMessageCount, threadState, type ThreadMessage } from '../discussion';
import { PHOTO_ONLY_BODY } from '../discussionstore';
// R7 owns what a status is CALLED. R5b owns whether the thread is open. Keeping the
// label in one module is why the chip on the ledger and the chip here can never
// disagree about the same extra.
import { chipKey, displayStatus, type LedgerStatus } from '../extrastatus';
import { C, F, T, chipStyle, display, label } from './theme';

function chipKind(s: LedgerStatus) {
  if (s === 'approved') return 'approved' as const;
  if (s === 'declined') return 'declined' as const;
  if (s === 'sent') return 'pending' as const;
  if (s === 'discussing') return 'discuss' as const;
  return 'ewa' as const;
}

/**
 * R5b AC3 — the discussion log on the record: "when either party views the approved
 * change's record/PDF, the discussion log appears with timestamps beneath the
 * approved snapshot".
 *
 * READ-ONLY and deliberately separate from ThreadScreen. The record is the legal
 * artifact and its job is to show what happened; putting a live composer on it
 * would invite someone to add to a record after it was signed. Timestamps are on
 * every line because a log without them cannot show who was waiting on whom.
 */
const msgAvatarStyle = { width: 30, height: 30, borderRadius: 15 } as const;
// A photo inside a bubble. Small enough that three fit a 82%-wide bubble on a 13
// mini, big enough to see what it is before tapping.
const msgShotStyle = { width: 92, height: 92, borderRadius: 10 } as const;

export function DiscussionLog(props: {
  messages: ThreadMessage[];
  formatAt: (ms: number) => string;
  /** Reply ids still in the outbox — same honesty rule as ThreadScreen. */
  undelivered?: ReadonlySet<string>;
  /** Tapping through to the live thread. Omitted on a closed record. */
  onOpen?: () => void;
  /** The client's display name — the heading becomes "Discussion with <name>" and
   *  the client's messages are labelled by name, not the generic "Client". */
  clientName?: string | null;
  /** The client's photo, when the roster has one; initials otherwise. */
  clientAvatar?: string | null;
  /** Open a photo sent in a message full-screen. Omitted where there is no lightbox
   *  — the tile then renders and simply does not respond, rather than opening a
   *  viewer this screen does not have. */
  onPressPhoto?: (uri: string) => void;
}) {
  if (!props.messages.length) return null;
  const clientName = props.clientName?.trim() || null;
  // The design labels the discussion by FIRST name ("Discussion with Sarah") and the
  // client avatar carries a SINGLE initial ("S"), not two.
  const clientFirst = clientName ? clientName.split(/\s+/)[0] : null;
  const clientInitials = clientFirst ? clientFirst[0].toUpperCase() : null;
  const heading = clientFirst ? t({ k: 'r5b.logHeadingWith', p: { name: clientFirst } }) : t('r5b.logHeading');
  return (
    <View style={T.card}>
      <Text style={label}>{heading}</Text>
      {/* Chat bubbles (hadar, 2026-07-24: "an extra becomes like a chat or slack
          channel"). Yours on the right, the client's on the left with their avatar
          and name beside each message; undelivered replies say so (mandate #1). */}
      <View style={{ marginTop: 10, gap: 12 }}>
        {props.messages.map((m) => {
          const mine = m.side === 'contractor';
          const undelivered = mine && props.undelivered?.has(m.id);
          const bubble = (
            <View style={{ maxWidth: '82%', alignItems: mine ? 'flex-end' : 'flex-start' }}>
              {/* Only YOUR messages carry a sender label ("You"), above-right. The
                  client's messages are identified by their avatar to the left. */}
              {mine && (
                <Text style={{
                  fontFamily: F.dispSemi, fontSize: 10.5, letterSpacing: 1,
                  textTransform: 'uppercase', color: C.steel, marginBottom: 3, marginRight: 4,
                }}>{t('r5b.fromYou')}</Text>
              )}
              <View style={{
                borderRadius: 16, paddingVertical: 9, paddingHorizontal: 13,
                backgroundColor: mine ? '#4E6243' : '#EFEBE3',
                borderBottomRightRadius: mine ? 4 : 16,
                borderBottomLeftRadius: mine ? 16 : 4,
              }}>
                {/* PHOTOS ABOVE THE WORDS. A message whose body is the photo-only
                    mark is a picture, and printing "📷" over the picture it stands
                    for would be a caption saying "image". */}
                {!!m.photos?.length && (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6,
                    marginBottom: m.text === PHOTO_ONLY_BODY ? 0 : 7 }}>
                    {m.photos.map((ph) => {
                      // Resolved once. `FS.documentDirectory` is typed nullable (it is
                      // null on web, where this screen never runs); a null base with a
                      // real relpath would render a file:// URI missing its root, so
                      // the tile falls back to the missing-evidence state rather than
                      // to a broken image.
                      const uri = ph.relpath && FS.documentDirectory
                        ? FS.documentDirectory + ph.relpath : null;
                      return uri ? (
                      <Pressable key={ph.captureId}
                        onPress={() => props.onPressPhoto?.(uri)}
                        accessibilityRole="imagebutton"
                        accessibilityLabel={t('r5b.photoInMessage')}>
                        <Image source={{ uri }} style={msgShotStyle} />
                      </Pressable>
                    ) : (
                      // The row survived, the file did not (a restore, a purge). The
                      // extra's grid draws the same tile for the same reason: a
                      // missing photo is a fact worth stating, not a broken image.
                      <View key={ph.captureId} style={[msgShotStyle, {
                        alignItems: 'center', justifyContent: 'center',
                        backgroundColor: '#EFEBE3' }]}>
                        <Text style={{ ...T.bodySteel, fontSize: 10, textAlign: 'center' }}>
                          {t('erec.evidenceMissing')}
                        </Text>
                      </View>
                    ); })}
                  </View>
                )}
                {m.text !== PHOTO_ONLY_BODY && (
                  <Text style={[T.body, { fontSize: 14.5, lineHeight: 20,
                    color: mine ? '#fff' : '#151A1E' }]}>{m.text}</Text>
                )}
              </View>
              {/* Time BELOW the bubble; your delivered messages get a ✓✓ read-receipt,
                  an undelivered one says so instead (mandate #1). */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3,
                marginRight: mine ? 4 : 0, marginLeft: mine ? 0 : 4 }}>
                <Text style={{ ...T.bodySteel, fontSize: 11.5 }}>{props.formatAt(m.atMs)}</Text>
                {mine && (undelivered
                  ? <Text style={{ ...T.bodySteel, fontSize: 11.5 }}>· {t('r5b.notSentYet')}</Text>
                  : <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.brand }}>✓✓</Text>)}
              </View>
            </View>
          );
          // The client's messages carry the client's avatar to the left; yours
          // sit flush right without one — the design draws the conversation as
          // "them, over there; you, over here".
          if (mine) {
            return <View key={m.id} style={{ alignItems: 'flex-end' }}>{bubble}</View>;
          }
          return (
            <View key={m.id} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
              {props.clientAvatar
                ? <Image source={{ uri: props.clientAvatar }} style={msgAvatarStyle} />
                : (
                  <View style={[msgAvatarStyle, { backgroundColor: C.approve, alignItems: 'center', justifyContent: 'center' }]}>
                    <Text style={{ fontFamily: F.dispSemi, fontSize: 12, color: '#fff' }}>{clientInitials ?? '·'}</Text>
                  </View>
                )}
              {bubble}
            </View>
          );
        })}
      </View>
      <Text style={{ ...T.bodySteel, fontSize: 11.5, marginTop: 10 }}>
        {t('r5b.partOfRecord')}
      </Text>
      {props.onOpen && (
        <Pressable onPress={props.onOpen} hitSlop={8} style={{ paddingTop: 10 }}>
          <Text style={{ ...label, color: C.orange }}>{t('r5b.openThread')} ›</Text>
        </Pressable>
      )}
    </View>
  );
}

export function ThreadScreen(props: {
  extra: {
    id: string;
    scope: string;
    /** Already formatted by money(). This screen never formats a price itself. */
    amount: string;
    /** The STORED status. The displayed one is derived from it plus the thread. */
    status: string;
  };
  messages: ThreadMessage[];
  /** "Revised: $1,850 → $1,500" — both sides pre-formatted by money(). */
  revision?: { priorAmount: string; newAmount: string } | null;
  /** Reply ids still sitting in the outbox. Mandate #1: a message that has not left
   *  the phone says so rather than looking delivered. */
  undelivered?: ReadonlySet<string>;
  /** True when the screen was opened from a push (R5b AC1: two taps from the lock
   *  screen means the keyboard is already up). */
  focusReply?: boolean;
  /** Injectable only so a test can pin the clock. */
  nowMs?: number;
  formatAt: (ms: number) => string;
  onBack: () => void;
  onReply: (text: string) => Promise<void>;
  /** Opens the priced revision flow. This screen never issues the price itself. */
  onRevise: () => void;
}) {
  const [draft, setDraft] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  // A failed reply's reason. Shown here because a reply that silently vanishes —
  // or silently stays — is the failure mode this repo refuses everywhere else.
  const [sendError, setSendError] = React.useState<string | null>(null);
  const now = props.nowMs ?? Date.now();
  const st = threadState({ coStatus: props.extra.status, messages: props.messages, nowMs: now });
  const shown = displayStatus(props.extra.status,
    { openQuestions: clientMessageCount(st.messages) });
  const chip = chipStyle(chipKind(shown));

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await props.onReply(text);
      // Cleared only after the write resolved. Clearing optimistically loses what
      // someone typed on the one path where the write failed.
      setDraft(''); setSendError(null);
    } catch (e: any) {
      setSendError(String(e?.message ?? e));
    } finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      {/* Same status-bar clearance fix as the record screen (2026-07-22): the
          back control sat under the iPhone clock. */}
      <ScrollView contentContainerStyle={{ padding: 18, paddingTop: 54, paddingBottom: 24 }}>
        <Pressable onPress={props.onBack} hitSlop={12}
          style={{ minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start', paddingRight: 24 }}>
          <Text style={{ ...label, fontSize: 15, color: C.orange }}>‹ {t('r5b.back')}</Text>
        </Pressable>

        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
          <Text style={{ ...display(20), flex: 1 }} numberOfLines={3}>{props.extra.scope}</Text>
          <View style={[T.chip, { backgroundColor: chip.bg }]}>
            <Text style={[T.chipText, { color: chip.fg }]}>{t(chipKey(shown))}</Text>
          </View>
        </View>

        <Text style={{ ...T.bodySteel, marginTop: 6 }}>{props.extra.amount}</Text>

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

        {/* R5b AC5. Amber, not red: he has to do something, nothing is broken. */}
        {st.awaitingReply && (
          <View style={{
            marginTop: 10, borderRadius: 12, padding: 12,
            backgroundColor: '#FFF8C5', borderWidth: 1, borderColor: '#D4A72C',
          }}>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: '#7D5E00' }}>
              ⚑ {t('r5b.awaitingReply')}
            </Text>
          </View>
        )}

        {/* R5b: "both parties see: this discussion is part of the project record".
            Stated before the messages, not in a footnote after them. */}
        <Text style={{ ...T.bodySteel, fontSize: 12.5, marginTop: 12 }}>
          {t('r5b.partOfRecord')}
        </Text>

        <View style={{ marginTop: 12, gap: 10 }}>
          {st.messages.map((m) => {
            const mine = m.side === 'contractor';
            const pending = mine && props.undelivered?.has(m.id);
            return (
              <View
                key={m.id}
                style={{
                  alignSelf: mine ? 'flex-end' : 'flex-start',
                  maxWidth: '88%',
                  backgroundColor: mine ? C.ink : C.card,
                  borderColor: mine ? C.ink : C.line, borderWidth: 1,
                  borderRadius: 14, padding: 12,
                }}>
                <Text style={{
                  fontFamily: F.dispSemi, fontSize: 10.5, letterSpacing: 1.2,
                  textTransform: 'uppercase', color: mine ? C.onDark : C.steel,
                }}>
                  {t(mine ? 'r5b.fromYou' : 'r5b.fromClient')} · {props.formatAt(m.atMs)}
                </Text>
                <Text style={{
                  fontFamily: F.body, fontSize: 15.5, lineHeight: 22, marginTop: 3,
                  color: mine ? '#fff' : C.ink,
                }}>
                  {m.text}
                </Text>
                {pending && (
                  <Text style={{
                    fontFamily: F.body, fontSize: 11.5, marginTop: 4,
                    color: mine ? C.onDark : C.steel,
                  }}>
                    {t('r5b.notSentYet')}
                  </Text>
                )}
              </View>
            );
          })}
          {!st.messages.length && (
            <Text style={T.bodySteel}>{t('r5b.noMessages')}</Text>
          )}
        </View>

        {/* The channel is open for `sent` and NOTHING ELSE (`discussion.ts`
            canReply → extralifecycle.ts, DEF-4/REQ-LC23). The 2026-07-24 note that
            used to sit here — "approved/declined stay open now" — was overturned:
            it widened the CLIENT of a two-sided contract without widening the
            server, and `308_r5b_discussion.sql:94` rejects a reply on an answered
            thread with 23514, which is PERMANENT. So the composer that note
            justified produced replies that parked forever while the UI showed them
            sent. A conversation after the answer is a new linked extra (REQ-LC31). */}
        {!st.canReply && (
          <View style={{
            marginTop: 14, borderRadius: 12, padding: 12,
            backgroundColor: '#F1F3F0', borderWidth: 1, borderColor: C.line,
          }}>
            <Text style={T.bodySteel}>{t('r5b.threadClosed')}</Text>
          </View>
        )}
      </ScrollView>

      {st.canReply && (
        <View style={{
          borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.card,
          padding: 12, gap: 10,
        }}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            autoFocus={!!props.focusReply}
            multiline
            placeholder={t('r5b.replyPlaceholder')}
            placeholderTextColor={C.steel}
            accessibilityLabel={t('r5b.replyPlaceholder')}
            style={{
              fontFamily: F.body, fontSize: 16, color: C.ink, minHeight: 58,
              borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 12,
            }}
          />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable
              onPress={send}
              disabled={!draft.trim() || busy}
              accessibilityLabel={t('r5b.send')}
              style={[T.btn, T.btnInk, { flex: 1 }, (!draft.trim() || busy) && T.btnOff]}>
              <Text style={T.btnText}>{busy ? t('r5b.sending') : t('r5b.send')}</Text>
            </Pressable>
            {st.canRevise && (
              <Pressable
                onPress={props.onRevise}
                accessibilityLabel={t('r5b.revise')}
                style={[T.btn, { flex: 1, borderWidth: 1.5, borderColor: C.orange }]}>
                <Text style={[T.btnText, { color: C.orange, fontSize: 16 }]}>
                  {t('r5b.revise')}
                </Text>
              </Pressable>
            )}
          </View>
          {sendError !== null && (
            <Text style={{ ...T.body, fontSize: 13, color: C.danger }}>{sendError}</Text>
          )}
          {/* Says the rule out loud, at the moment it could be broken: the contractor
              is one tap from typing "ok, $1,500" and calling it settled. */}
          <Text style={{ ...T.bodySteel, fontSize: 11.5 }}>{t('r5b.priceNeedsRevision')}</Text>
        </View>
      )}
    </View>
  );
}
