/**
 * The extra record — now a STAGE DISPATCHER, not a screen.
 *
 * SPEC-extra-lifecycle-v1 D1: an extra has exactly three stages, and each one has a
 * different job. This file used to be one 686-line flat scroll that tried to serve
 * all three by hiding and showing rows, which is how a screen ends up offering
 * Remind on a draft and a reply box on a signed record. `stageOf()` — the single
 * authority (extralifecycle.ts) — now picks the screen, and this file does two
 * things only: map the record onto that screen's props, and own the chrome that
 * has to sit ABOVE whichever screen is showing.
 *
 * WHY `stageOf` AND THEN ONE MORE TEST FOR 'approved'. REQ-LC2 maps `declined` and
 * `superseded` onto the same 'locked' stage as `approved`, and is emphatic that
 * they are deliberately NOT Stage 3: Stage 3 is defined by the existence of an
 * approval. `ExtraLockedScreen` is Stage 3 rendered — a green banner, an APPROVED
 * chip, "approved by X". Sending a decline through it would print a false status on
 * the one screen whose entire job is being accurate about status. So a terminal row
 * that nobody signed renders through the negotiation screen, which already states
 * that it renders a terminal status truthfully with every move closed down.
 *
 * WHAT THIS FILE STILL OWNS, and why each is here rather than in a stage screen:
 *   the photo lightbox   one modal for the whole record, so a tile in Stage 1 and a
 *                        tile in the Photos & proof subscreen open the same viewer
 *                        (exported for that second mount point).
 *   the capture FAB      appending evidence is a record-level act, not a section's.
 *                        NOT rendered on a sealed record: REQ-LC30 seals Stage 3 and
 *                        kit.tsx already omits `onAddMore` there for the same reason.
 *   the successor bar    a superseded version must still be able to hand the reader
 *                        to the version that replaced it (`erec.viewCurrent`). The
 *                        negotiation screen has no such move, and losing it would
 *                        strand a reader on a retired price.
 *
 * Every string still comes from i18n (mandate #5); every stage screen is handed
 * already-translated words, never slugs.
 */
import React from 'react';
import {
  FlatList, Image, Modal, Pressable, Text, View, useWindowDimensions,
} from 'react-native';
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';
import type { ExtraRecord } from '../record';
import type { ApprovalPanel } from '../eventlog';
import type { ThreadMessage } from '../discussion';
import { threadState } from '../discussion';
import type { RemindVerdict } from '../remind';
import type { ProcState } from '../status';
import type { SendReadiness } from '../sendreadiness';
import { stageOf } from '../extralifecycle';
import { createdLabel } from '../changeorder';
import { roleLabel } from '../approvers';
import { isApproverRole } from '../approverrouting';
import { t } from '../i18n';
import { C, F } from './theme';
import { useRecordFacts } from './recordfacts';
import { Button } from './kit';
import { ExtraDraftScreen, type PriceMode } from './extradraft';
import type { CaptureDelivery } from '../uploader';
import {
  ExtraNegotiationScreen,
  type ExtraDetailField,
  type NegotiationPerson,
} from './extranegotiation';
import { ExtraLockedScreen } from './extralocked';

/**
 * Everything the three stage screens need that `ExtraRecord` does not carry.
 *
 * It arrives as ONE nullable object rather than fifteen props because it is loaded
 * by one hydration layer in `openRecord` and it is either all there or none of it
 * is. Null is a real state, not an error: mandate #7 says a layer that has not
 * landed degrades the screen, it never blanks the app — so a null lifecycle renders
 * the paper background for the tick it takes the local read to return, rather than
 * guessing a price mode or a readiness verdict it does not have.
 */
export type RecordLifecycle = {
  /** REQ-LC12. `recordFacts` states the derivation: reaching a change_order row
   *  means this is an extra — R10's Decision has no change order and cannot arrive
   *  here — so this is 'extra' by construction, not by a guess about the row. */
  kind: 'extra' | 'decision';
  /** REQ-LC11's content gate, computed by the caller from the same row. */
  readiness: SendReadiness;
  /** REQ-LC13's pipeline gate input — orthogonal to `readiness` and both must pass. */
  proc: ProcState;
  priceMode: 'fixed' | 'nte';
  /** The four flow terms, RAW (`next_invoice` · `adds_days` · …). Raw so that NULL
   *  keeps its one meaning: nobody answered. */
  billingTiming: string | null;
  scheduleEffect: string | null;
  scheduleDays: number | null;
  exclusions: string | null;
  /** `who_directed` — who ASKED for the work (REQ-VAL4). Never the approver. */
  requestedBy: string | null;
  /** REQ-LC3's derived open signal. Never stored, never a status. */
  openCount: number;
  lastOpenedAtMs: number | null;
  /** `canRemind(...)` at load time. A refusal carries its reason so the button is
   *  never silently dead. */
  remind: RemindVerdict;
  /** The live client link, so the waiting card can offer it for an email (2026-08-24).
   *  Null before the extra is sent. */
  linkUrl?: string | null;
  /** Which version this row is (1 = original), derived from the supersession lineage
   *  by `versionNumber` — never stored. */
  version: number;
};

export type RecordScreenProps = {
  /** Arrived here from the capture flow, so the DRAFT screen draws the progress rail.
   *  Passed straight through: this screen decides nothing about it and reads it once. */
  inFlow?: boolean;
  /**
   * A COUNTER THAT MEANS "LAND ON THE CONVERSATION" (2026-08-25). Bumped by App when a
   * client-message push is tapped, so the record opens with the message sheet already
   * up. A counter rather than a boolean because two questions in a row must open it
   * twice; passed straight through to the negotiation screen, which owns the sheet.
   */
  openMessages?: number;
  /** Unseen messages on this record, for the badge on the Messages tab (2026-08-25). */
  unreadMessages?: number;
  /** Mark this record's unseen messages read once the conversation is opened. */
  onMessagesSeen?: () => void;
  rec: ExtraRecord;
  /** R6b item 3 reads stored actor facts. Local SQLite only — see recordfacts.tsx
   *  for why the read lives in a hook here and not in the caller. */
  db: AbstractPowerSyncDatabase;
  lifecycle: RecordLifecycle | null;
  /** R6 AC2: the FROZEN instrument + its open signal. Null when the events have not
   *  reached this device; the record renders without it. */
  approval?: ApprovalPanel | null;
  /** R5b: the discussion, lineage-walked (threadFor). Null when not loaded. */
  thread?: ThreadMessage[] | null;
  /** Open client questions on THIS version — the ledger's own signal (R7), NOT
   *  derived from `thread`, which deliberately carries prior versions' messages. */
  openQuestions?: number;
  /** Reply ids still in the outbox (mandate #1: an undelivered reply says so). */
  undelivered?: ReadonlySet<string>;
  onBack: () => void;
  /** Capture INTO this extra (augment). One act, one prop: capturing from inside an
   *  extra always means adding to it — never starting a new one. */
  onCapture?: () => void;
  /** Open the R5c send preview. Always passed; the draft screen composes all three
   *  gates itself and disables its own button, so no caller-side condition here. */
  onSend: () => void;
  /** Re-run the write-up. Replaces Send on a draft the pipeline has not finished. */
  onGenerate?: () => void;
  /** 396 — the read-back of a spoken price, composed by the caller (which owns
   *  `parseMoney`). Null when there is nothing to confirm. */
  priceHeard?: {
    words: string; label: string; onUse: () => void;
    breakdown?: { title: string; amount: string }[];
  } | null;
  /** Upload state for THIS extra's captures — the evidence behind the stuck-extra
   *  diagnosis. Null while it is being read. */
  delivery?: CaptureDelivery | null;
  /** Grant cellular uploading from the screen it is blocking. */
  onAllowCellular?: () => void;
  /** Whether the SERVER has been asked for this extra's write-up yet — see
   *  ExtraDraftProps. Passed straight through; this screen makes no judgement. */
  writeUp?: 'unknown' | 'absent';
  /** A reply is a MESSAGE: it commits nothing and prices nothing. REQ-LC23's
   *  `canReply` is enforced inside the screen by `threadState`, so this is passed
   *  unconditionally — the old caller-side status test was a second copy of it. */
  onReply: (text: string, captureIds: readonly string[]) => Promise<void>;
  /** Take one photo for a MESSAGE and commit it; returns its capture id, or null
   *  if the shutter was cancelled. */
  onSnapPhoto?: () => Promise<string | null>;
  /** R8 manual remind — same link, never a new token. Resolves with the verdict so
   *  a refusal is SHOWN; this screen has no other status surface. */
  onRemind: () => Promise<{ ok: boolean; why?: string }>;
  /** REQ-LC22 Revise & resend. Passed unconditionally; `threadState.canRevise`
   *  (which is `canSupersede`) decides inside the screen. */
  onRevise: () => void;
  /** Withdraw a sent extra (421). Passed through to Stage 2; absent elsewhere. */
  onWithdraw?: () => void;
  /** Open one collapsed field / the detail subscreens (extradetails.tsx). */
  onOpenDetail: (field: ExtraDetailField) => void;
  /** Tapping one of the three pricing modes under the price on a draft. */
  onPickPriceMode?: (mode: PriceMode) => void;
  /** Rename from the header, in place. Stage 1 only — passed straight to the draft
   *  screen, which gates it on `isDraft`. */
  onRetitle?: (next: string) => void;
  /** Open the client drawer (Stage 1). */
  onEditClient?: () => void;
  /** The client's type on this job, already translated. */
  clientTypeLabel?: string | null;
  /** Record a voice note onto this extra — its own act, not the camera's. */
  /** Add ANOTHER person on the chain (architect, inspector, the GC above you) without
   *  changing who this extra is for. Offered once a client exists — before that, the
   *  thing to do is name the client, not collect bystanders. */
  onAddContact?: () => void;
  onPickPhoto?: () => Promise<string | null>;
  onViewHistory: () => void;
  /** The whole price + terms composer — the draft screen's secondary action. */
  onEditDetails: () => void;
  /** D6 / REQ-LC31: a NEW INDEPENDENT extra linked by origin. The origin row is
   *  never written to. */
  onCreateLinkedExtra: () => void;
  /** Write the approval document and open the OS share sheet. Mandate #2: this
   *  transmits nothing to a client and must never be changed to. */
  onViewSignedApproval: () => void;
  /** On a superseded record: open the version that replaced it. */
  onOpenCurrent?: () => void;
  /** The job's other people, already translated — passed straight to the draft
   *  screen, which explains why it shows them. Display only. */
  jobPeople?: readonly { id: string; name: string; role: string }[];
  /** Take somebody off the job. Passed to the draft screen, which owns the gesture. */
  onRemovePerson?: (id: string, name: string) => void;
  /** REQ-LC14 / T5: legal in Stage 1 only. `canDelete` is re-checked inside the
   *  draft screen; the caller offers it or does not. */
  onDelete?: () => void;
};

/* The draft bar's height constant lived here, twice guessed (160, then 212) so a
 * floating capture button could be pinned clear of it. Both guesses were arithmetic
 * over a bar composed in another file, and both were wrong in the field. The button
 * moved into the content, so there is no longer anything to clear and nothing to
 * keep in sync — see the note where it used to render. */

export function RecordScreen(props: RecordScreenProps) {
  const { rec, lifecycle } = props;
  const stage = stageOf(rec.status);
  const messages = props.thread ?? [];
  // The photo the lightbox is showing, or null. Tapping a thumbnail sets it.
  const [zoom, setZoom] = React.useState<string | null>(null);
  const facts = useRecordFacts(props.db, rec.id, rec.status);

  // D4: exactly ONE approver. It comes from the stored actor facts, never from
  // `who_directed` — record.ts's header records that this screen once labelled who
  // ASKED for the extra as who could approve it, which is how a priced document
  // reaches someone with no authority to sign it.
  const approver: NegotiationPerson | null = React.useMemo(() => {
    const p = facts?.people.find((x) => x.kind === 'approver');
    if (!p) return null;
    // The design labels the approver "<role> / Approver" (e.g. "Homeowner / Approver"):
    // the role they hold AND that they are the one who signs. Falls back to just the
    // "Approver" word when no role slug is on record.
    const role = isApproverRole(p.roleSlug)
      ? `${roleLabel(p.roleSlug)} / ${t('erec.approverRole')}`
      : t('erec.approverRole');
    return { name: p.name, role };
  }, [facts]);
  const contributors: NegotiationPerson[] = React.useMemo(
    () => (facts?.people ?? [])
      .filter((x) => x.kind !== 'approver')
      .map((x) => ({ name: x.name, role: contributionRole(x.contributions) })),
    [facts]);

  // Stage 3 is SEALED (REQ-LC30) and a retired or refused version is sealed by the
  // same rules (REQ-LC2), so nothing may be appended to any of them. kit.tsx omits
  // its own "add" tile on a frozen record for this reason; the FAB is the same act
  // at record level and follows the same rule.
  const mayAppend = stage !== 'locked' && !!props.onCapture;
  const successorBar = rec.status === 'superseded' && !!props.onOpenCurrent;

  const body = (() => {
    if (lifecycle === null) {
      // The lifecycle layer has not landed (or failed). Paper, not a spinner and
      // not a guess: every value it carries decides whether a priced document may
      // be sent, and none of them has a safe default.
      return <View style={{ flex: 1, backgroundColor: C.paper }} />;
    }
    if (stage === 'draft') {
      return (
        <ExtraDraftScreen
          rec={rec}
          inFlow={props.inFlow}
          kind={lifecycle.kind}
          // No extra is numbered within its job anywhere in this build, so the
          // kicker carries kind + job only. A number invented here would be the
          // first place two screens could disagree about which extra this is.
          extraNo={null}
          version={lifecycle.version}
          readiness={lifecycle.readiness}
          proc={lifecycle.proc}
          priceMode={lifecycle.priceMode}
          billingTiming={lifecycle.billingTiming}
          scheduleEffect={lifecycle.scheduleEffect}
          scheduleDays={lifecycle.scheduleDays}
          exclusions={lifecycle.exclusions}
          requestedBy={lifecycle.requestedBy}
          capturedWith={capturedWith(rec)}
          onBack={props.onBack}
          onRetitle={props.onRetitle}
          onEditClient={props.onEditClient}
          clientTypeLabel={props.clientTypeLabel}
          onAddContact={props.onAddContact}
          onEditDescription={() => props.onOpenDetail('scope')}
          onEditCost={() => props.onOpenDetail('cost')}
          // Every mode opens the SAME cost editor. Two of the three need a number and
          // the third means dropping one, so none of them may be applied by a single
          // tap on this screen — the editor is where a figure meets its read-back.
          onPickPriceMode={(m) => props.onPickPriceMode?.(m)}
          onEditBilling={() => props.onOpenDetail('billing')}
          onEditSchedule={() => props.onOpenDetail('schedule')}
          onEditExclusions={() => props.onOpenDetail('exclusions')}
          onEditDetails={props.onEditDetails}
          onAddPhotos={props.onCapture ?? (() => props.onOpenDetail('photos'))}
          onPressPhoto={(uri) => setZoom(uri)}
          onSend={props.onSend}
          onGenerate={props.onGenerate}
          priceHeard={props.priceHeard}
          delivery={props.delivery}
          onAllowCellular={props.onAllowCellular}
          writeUp={props.writeUp}
          jobPeople={props.jobPeople}
          onRemovePerson={props.onRemovePerson}
          onDelete={props.onDelete}
        />
      );
    }
    if (stage === 'locked' && rec.status === 'approved') {
      return (
        <ExtraLockedScreen
          rec={rec}
          kicker={kicker(rec)}
          agreed={{
            billingTiming: lifecycle.billingTiming,
            scheduleEffect: lifecycle.scheduleEffect,
            scheduleDays: lifecycle.scheduleDays,
            exclusions: lifecycle.exclusions,
          }}
          approval={props.approval ?? null}
          // KNOWN DEGRADATION, stated rather than hidden: the screen asks for the
          // steps that LED to the approval, and `history` is the whole timeline.
          // Its own header says a wholesale history degrades to one redundant
          // "time not recorded" line under the signed step — redundant, not wrong —
          // and the alternative would be guessing which merged rows are the
          // signature, which is a worse failure on the record that settles disputes.
          version={lifecycle.version}
          // THE CONTRACT SAYS "do NOT include the approval itself", and this passed
          // the whole timeline — so the sealed screen rendered the signature twice:
          // once from the frozen snapshot and once from `co.approved_at_ms`, which can
          // be a different time or "time not recorded". Two signature times stacked on
          // an approval record is the exact failure that screen exists to prevent.
          chain={rec.history.filter((e) => e.kind !== 'signed')}
          approver={approver}
          // The same list the negotiation screen gets, so the people section reads
          // identically either side of the seal (hadar, 2026-08-14).
          contributors={contributors}
          onBack={props.onBack}
          onViewSignedApproval={props.onViewSignedApproval}
          onViewFullHistory={props.onViewHistory}
          onCreateLinkedExtra={props.onCreateLinkedExtra}
          // The same single lightbox the other two stages use. Looking at evidence is
          // not editing it, and a sealed record whose photos cannot be enlarged is
          // the least useful version of the one screen built for a dispute.
          onPressPhoto={(uri) => setZoom(uri)}
        />
      );
    }
    // `sent` — and every terminal status nobody signed. See the header for why a
    // decline and a retired version render here and not through the locked screen.
    return (
      <ExtraNegotiationScreen
        rec={rec}
        kicker={kicker(rec)}
        terms={{
          billingTiming: billingSentence(lifecycle.billingTiming),
          scheduleEffect: scheduleSentence(lifecycle.scheduleEffect, lifecycle.scheduleDays),
          exclusions: lifecycle.exclusions?.trim() || null,
        }}
        approver={approver}
        contributors={contributors}
        openCount={lifecycle.openCount}
        lastOpenedAtMs={lifecycle.lastOpenedAtMs}
        openQuestions={props.openQuestions ?? 0}
        thread={threadState({ coStatus: rec.status, messages, nowMs: Date.now() })}
        undelivered={props.undelivered}
        remind={lifecycle.remind}
        linkUrl={lifecycle.linkUrl ?? null}
        openMessages={props.openMessages}
        unreadMessages={props.unreadMessages}
        onMessagesSeen={props.onMessagesSeen}
        formatAt={createdLabel}
        onBack={props.onBack}
        onReply={props.onReply}
        onRemind={props.onRemind}
        onRevise={props.onRevise}
        onWithdraw={props.onWithdraw}
        onOpenDetail={props.onOpenDetail}
        onAddContact={props.onAddContact}
        version={lifecycle.version}
        // The SAME single lightbox the other two stages use — one viewer for the
        // whole record. Legal on a frozen extra: looking at evidence is not editing it.
        onPressPhoto={(uri) => setZoom(uri)}
        onViewHistory={props.onViewHistory}
        // DELIBERATELY ABSENT on every status that reaches this screen. REQ-LC31
        // rule 1 lets an origin link point only at an APPROVED row, and
        // `createLinkedExtra` re-reads the status and refuses anything else — so
        // offering the button on a `sent`, `declined` or `superseded` record would
        // be a control that cannot work. (REQ-LC26 says a retry after a DECLINE is
        // also "a new extra linked by origin", which rule 1 forbids; that conflict
        // is flagged in changeorder.ts and is not resolved by hiding a button.)
        onNewLinkedExtra={undefined}
        // Same gate the removed FAB carried: capture is offered only where the
        // record may still grow, so a locked one is never handed the callback.
        onCapture={mayAppend ? props.onCapture : undefined}
        // The MESSAGE camera, distinct from onCapture (which files evidence onto
        // the change order). Gated on the same `mayAppend`: a sealed record takes
        // no new bytes at all, by any door.
        onSnapPhoto={mayAppend ? props.onSnapPhoto : undefined}
        // Same gate for the roll: a sealed record takes no new bytes by ANY door, and
        // the library is a door.
        onPickPhoto={mayAppend ? props.onPickPhoto : undefined}
      />
    );
  })();

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      {body}

      {/* A retired version must still hand the reader forward. This is the one row
          of the old bottom bar that no stage screen carries, and dropping it would
          strand a reader on a price that is no longer live. */}
      {successorBar && (
        <View style={{
          borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.card,
          padding: 12, paddingBottom: 22,
        }}>
          <Button label={t('erec.viewCurrent')} icon="history"
            onPress={props.onOpenCurrent!} />
        </View>
      )}

      {/* THE FLOATING CAPTURE BUTTON IS GONE, and its absence is the fix rather than
          a regression. A 72pt circle pinned over a ScrollView occludes whatever the
          viewport is showing: it covered the third photo of the evidence grid on the
          draft and the approver's row on the negotiation screen — the one line that
          says who you are waiting on. Scroll padding cannot fix that, because the
          occlusion happens MID-scroll, not at the end; padding only buys clearance
          once you have reached the bottom.
          Capture did not go away, it moved into the content where the design has it:
          the draft's "+ Add more" tile inside the evidence grid (already wired to
          this same `onCapture`), and the negotiation screen's "Add photo or voice
          note" under the conversation. Both are reachable without covering anything.
          `mayAppend` still governs WHETHER capture is offered — a locked record must
          never grow — it is now enforced by which screen receives the callback. */}
      <PhotoLightbox uri={zoom} uris={rec.photos.filter((p) => p.present).map((p) => p.uri)}
        onClose={() => setZoom(null)} />
    </View>
  );
}

/**
 * The photo lightbox — ONE viewer for the whole record, exported because the
 * Photos & proof subscreen is a sibling early-return in App.tsx's cascade and would
 * otherwise grow a second one. Closed by a glove-sized bottom button (hadar,
 * 2026-07-23: a corner ✕ is exactly the target the field-UX numbers forbid);
 * tapping the photo itself still closes too.
 */
/**
 * The full-screen photo viewer.
 *
 * IT TAKES THE WHOLE SET, NOT ONE PICTURE (hadar, 2026-08-12: "once in lightbox mode
 * need to swipe left and right to load other images"). It used to take a single
 * `uri`, so looking at the second of six photos meant closing, finding the next
 * thumbnail and opening again — six times, on a phone, with gloves. Evidence is read
 * in sequence: what the wall looked like before, during, after.
 *
 * A PAGING FlatList rather than a gesture library: horizontal, snapped to the screen,
 * `initialScrollIndex` so it opens on the one that was tapped. No new dependency and
 * the OS handles the physics.
 *
 * THE COUNTER IS NOT DECORATION. "3 of 6" is the only thing telling a reader there
 * are more, because a photo that fills the screen gives no hint that anything sits
 * beside it. Without it the swipe is a feature nobody discovers.
 */
export function PhotoLightbox({
  uri, uris, onClose,
}: {
  /** The photo tapped. Kept as the entry point so every existing caller still works. */
  uri: string | null;
  /** The set it belongs to, in display order. Omitted -> a single-photo viewer. */
  uris?: readonly string[];
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  // The tapped photo must exist in the set, or the viewer would open on the wrong
  // picture. If it does not (a stale list), fall back to showing just that one.
  const all = React.useMemo(
    () => (uris && uri && uris.includes(uri) ? [...uris] : uri ? [uri] : []),
    [uris, uri]);
  const start = Math.max(0, uri ? all.indexOf(uri) : 0);
  const [at, setAt] = React.useState(start);
  // Re-sync when a different thumbnail opens the viewer while it is mounted.
  React.useEffect(() => { setAt(start); }, [start, uri]);

  return (
    <Modal visible={uri !== null} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.94)' }}>
        <FlatList
          data={all}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(u, i) => `${i}:${u}`}
          initialScrollIndex={start}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          onMomentumScrollEnd={(e) =>
            setAt(Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width)))}
          renderItem={({ item }) => (
            // Tapping the picture closes, as it did before. The Pressable is INSIDE
            // the page rather than wrapping the list, because wrapping it swallowed
            // the horizontal drag and the swipe never started.
            <Pressable onPress={onClose} style={{ width, height }}>
              <Image source={{ uri: item }} style={{ width, height }} resizeMode="contain" />
            </Pressable>
          )}
        />
        {all.length > 1 && (
          <View style={{ position: 'absolute', top: 58, alignSelf: 'center',
            backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 999,
            paddingHorizontal: 14, paddingVertical: 6 }}>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: '#fff' }}>
              {t({ k: 'erec.photoOf', p: { n: at + 1, total: all.length } } as any)}
            </Text>
          </View>
        )}
        <Pressable onPress={onClose}
          accessibilityLabel={t('common.close')}
          style={{
            position: 'absolute', left: 18, right: 18, bottom: 34,
            minHeight: 64, borderRadius: 14, backgroundColor: '#fff',
            alignItems: 'center', justifyContent: 'center',
          }}>
          <Text style={{ fontFamily: F.dispSemi, fontSize: 17, letterSpacing: 1.2,
            textTransform: 'uppercase', color: C.ink }}>
            {t('common.close')}
          </Text>
        </Pressable>
      </View>
    </Modal>
  );
}

/** "Extra · Miller — Hall Bath". Each segment is dropped when its fact is missing
 *  rather than replaced: a made-up job name is a worse answer than a shorter one. */
/** A crew member's People-card role is their CONTRIBUTION ("Captured", "Priced & sent"),
 *  in the fixed captured→priced→sent order — the design labels the contractor side by
 *  what each person DID, not a generic "Crew". Returns undefined (→ the "Crew" fallback)
 *  when no contribution is on record. */
const CONTRIB_ORDER = ['erec.capturedBy', 'erec.pricedBy', 'erec.sentBy'] as const;
const CONTRIB_SHORT: Record<string, string> = {
  'erec.capturedBy': 'erec.roleCaptured',
  'erec.pricedBy': 'erec.rolePriced',
  'erec.sentBy': 'erec.roleSent',
};
function contributionRole(contribs: { roleKey: string }[]): string | undefined {
  const keys = CONTRIB_ORDER.filter((k) => contribs.some((c) => c.roleKey === k));
  if (keys.length === 0) return undefined;
  // Later labels are stored lower-case so a join reads "Priced & sent"; capitalise the
  // first character so a single "sent" still renders "Sent".
  const s = keys.map((k) => t(CONTRIB_SHORT[k])).join(' & ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function kicker(rec: ExtraRecord): string {
  const word = t('erec.kindExtra');
  // The REAL per-job number (`change_order.co_number`), replacing the static "#4" that
  // stood in before the column existed. A row with no number yet prints none — a
  // made-up number on the line that identifies the document is worse than a short line.
  const head = rec.extraNo != null ? `${word} #${rec.extraNo}` : word;
  return rec.jobName ? `${head} · ${rec.jobName}` : head;
}

/** How this extra was captured, for the draft screen's stored-fact row. A stored
 *  fact that is absent is OMITTED (record.ts's rule), never shown as "Not set" —
 *  "Not set" invites him to fill a field, and this one is evidence, not a field. */
function capturedWith(rec: ExtraRecord): string | null {
  if (rec.voices.length > 0) return `${t('erec.voice')} · ${rec.voices[0].at}`;
  return rec.capturedAt;
}

/**
 * The stored enum → the sentence for it, IN THE READER'S LANGUAGE.
 *
 * Deliberately not `flowterms.ts:flowTermLines`, and the negotiation screen's own
 * header says why: that function composes the ENGLISH-CANONICAL instrument
 * (mandate #5), and wiring it here would put English terms in front of a
 * Spanish-reading contractor. Same facts, two audiences, two renderings.
 *
 * An unrecognised value renders ITSELF rather than a guess or a blank — flowterms's
 * rule, for its reason: claiming "not set" over a value that exists is the same lie
 * as inventing one.
 */
export function billingSentence(v: string | null): string | null {
  if (!v) return null;
  if (v === 'next_invoice') return t('co.billNext');
  if (v === 'when_completed') return t('co.billDone');
  if (v === 'other') return t('co.billOther');
  return v;
}

export function scheduleSentence(v: string | null, days: number | null): string | null {
  if (!v) return null;
  if (v === 'no_change') return t('co.schedNo');
  // 'not_sure' IS a complete answer (FLOW decision 3) and reads to the owner as
  // "to be confirmed", so it is shown as an answer, never as a gap.
  if (v === 'not_sure') return t('co.schedUnsure');
  if (v === 'adds_days') {
    return days != null && days > 0
      ? t({ k: 'draft.schedDays', p: { n: days } } as any)
      : t('co.schedAdds');
  }
  return v;
}
