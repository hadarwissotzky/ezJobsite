/**
 * The ONE capture screen — REQ-CAP-FUSED. The goal of this screen is to capture a
 * CHANGE ORDER: walk the site, talk, snap photos along the way, tap Done. Everything
 * else is in service of that.
 *
 * REDESIGNED 2026-07-27 to hadar's mockup + the EZChangeOrders design system. What
 * changed is the CHROME, not the machinery: the screen used to be a black full-bleed
 * viewfinder with dark scrims, and is now the system's warm light theme — a cream top
 * bar, the camera as an inset band, cream cards over it, and a cream action panel. The
 * durability path below (segments, interruption recovery, draft banking, stamp baking,
 * the empty-Done guard) is byte-for-byte the old behaviour and must stay that way.
 *
 * ICONS: hadar's kit artwork, wired through `icon.tsx` (which prefers the kit PNG over
 * any same-named SVG). `play` is the one exception — the kit has pause but no play, so
 * the resumed state still uses a traced glyph.
 *
 * The design's own argument, which is why it is worth the churn: the ICP does not think
 * in software. The old screen showed him a viewfinder and trusted him to infer that the
 * mic was live. This one SAYS it — "Your voice is recording", "You do not need to hold
 * a button", "Saving voice, photos, time and location on this phone" — in sentences, at
 * a size readable at arm's length, in his language.
 *
 * What it must survive (the user's spec, 2026-07-20):
 *  - DISRUPTION. Pause/resume as a first-class control, and a phone call stealing the
 *    microphone must not destroy the walk: recording rolls into a new SEGMENT and the
 *    audio continues after the call. Segments commit as one pair, ordered.
 *  - SILENCE. A user who taps the button and says nothing produces nothing. The screen
 *    coaches ("say what you found…"), warns when it has heard nothing, and refuses a
 *    Done with no speech and no photos — refusing loudly beats saving emptiness.
 *  - EVIDENCE. Photos snap without stopping audio, each carrying its own timestamp so
 *    it can later be tied to the sentence being spoken (the transcript segments). The
 *    photo sheet confirms what was taken. Gallery picks are allowed but are NEVER
 *    stamped with today's stamp — a library photo was not taken here-and-now, and
 *    baking a fresh stamp onto it would be manufactured evidence.
 *
 * Durability stays in capture.ts: this screen only produces BYTES + a stamp. App.tsx
 * commits everything durably FIRST (Inbox if unresolved — mandate #1), then asks the
 * human where it belongs.
 */
import { CameraView, useCameraPermissions, type CameraType } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import React from 'react';
import { ActivityIndicator, Animated, Dimensions, Image, InputAccessoryView, Keyboard, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { readRecordingBytes, requestMic, RecordingPresets, useAudioRecorder, useAudioRecorderState } from '../recorder';
// R2 live view: words appear over the camera while he talks. An indicator, not
// evidence — the recording stays owned by expo-audio; this only listens along.
import { needsPermissionAsk, requestSpeechPermission, startLive, type LiveHandle } from '../ondevicestt';
import { checkPhotos, checkRecording } from '../quota';
import { FlowRail } from './flowrail';
import { logDiag } from '../diaglog';
import { signalFailed, signalShutter } from '../feedback';
import { stampNow, type Stamp } from '../stamp';
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';
import { useSessionDraft } from './sessiondraft';
import { t as T } from '../i18n';
import { C, F, T as TT } from './theme';
import { radii, shadows } from './tokens';
import { Icon } from './icon';

export type FusedPhoto = { bytes: Uint8Array; mime: string; atMs: number; fromLibrary: boolean };
export type FusedAudioSegment = { bytes: Uint8Array; mime: string; startedAtMs: number };
export type FusedArtifacts = {
  photos: FusedPhoto[];
  /** The narration, possibly in several files if a call interrupted it. Ordered. */
  audioSegments: FusedAudioSegment[];
  stamp: Stamp;
  /** The receipt: local thumbnail URIs + recorded seconds, so the NEXT screen can
   *  show what was just captured and the flow reads as one continuous workflow. */
  previewUris: string[];
  durationSecs: number;
  /** What the contractor TYPED, when he typed anything. Undefined when the summary was
   *  left as the recogniser wrote it — see the note at the call site. A text capture in
   *  its own right (REQ-CAP2), committed beside the audio and never instead of it. */
  typedText?: string;
};

function two(n: number) { return n < 10 ? '0' + n : '' + n; }
function clockLine(ms: number): string {
  const d = new Date(ms);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${two(d.getHours())}:${two(d.getMinutes())} · ${days[d.getDay()]} ${mon[d.getMonth()]} ${d.getDate()}`;
}

/**
 * The stamp burned onto every CAMERA photo. Never raw coordinates — a resolved place
 * a human can check, or an honest "location unavailable".
 *
 * This is EVIDENCE, not chrome: it keeps the dark scrim + white text of the old design
 * on purpose. It is composited onto a photograph of unknown brightness, where the light
 * theme would be unreadable half the time. Do not "modernise" it to match the screen.
 */
function StampBlock({ place, now }: { place: string | null; now: number }) {
  return (
    <View style={st.stamp}>
      <Text style={st.stampTime}>{clockLine(now)}</Text>
      <Text style={st.stampWhere}>📍 {place ?? T('cap.noLoc')}</Text>
    </View>
  );
}

/** The dense mockup waveform. Purely an indicator — it reads the live meter only. */
/** Ties the keyboard bar to the summary field. Any stable string; it only has to match. */
const SUMMARY_ACCESSORY = 'ezco-summary-kb';

/** Scopes the wake lock to this screen, so releasing it cannot free somebody else's. */
const KEEP_AWAKE_TAG = 'ezco-capture';

function Wave({ level, active }: { level: number; active: boolean }) {
  const bars = React.useMemo(() => Array.from({ length: 34 }, (_, i) => i), []);
  return (
    <View style={st.wave}>
      {bars.map((i) => {
        // A fixed per-bar shape so the wave looks like a voice, not a bar chart:
        // tallest in the middle, with a stable pseudo-random wobble per index.
        const centre = 1 - Math.abs(i - 16.5) / 17;
        const wobble = 0.45 + ((i * 37) % 11) / 11 * 0.55;
        const h = active ? 3 + Math.round(level * 26 * centre * wobble) : 3;
        return <View key={i} style={[st.waveBar, { height: Math.max(3, h) }]} />;
      })}
    </View>
  );
}

type Shot = { uri: string; atMs: number; fromLibrary: boolean };

/**
 * The size the stamped photo is rendered at before `captureRef` snapshots it.
 *
 * The screen's own dimensions, because that is what the bake view used to fill and the
 * stamp's type sizes were tuned against it. Read once at module scope: a rotation
 * mid-bake would otherwise resize the view between the `onLoad` and the snapshot.
 */
const BAKE = Dimensions.get('window');

export function FusedCapture({
  projectName, onCapture, onClose, resolveLabel, db, ownerId, coachPrompts, onQuota,
}: {
  /**
   * A FREE-PLAN CAP WAS HIT — raise the upgrade modal and refuse the act.
   *
   * WHY IT IS A PROP (hadar, 2026-09-03: "it keeps letting me ... take more pictures
   * although i am on the free plan and my quota is done"). `checkPhotos` and
   * `checkRecording` have existed in `quota.ts` since the plans were written, compute
   * correctly, and had ZERO call sites in every build ever shipped. The limits were
   * declared in `plans.ts`, the modal and its copy existed for both kinds, and nothing
   * ever asked. This screen is where the asking has to happen, and the modal lives in
   * App.tsx — so the screen reports and App decides what to show.
   *
   * REFUSED BEFORE THE ACT, NEVER AFTER. Mandate #1 forbids destroying a capture that
   * has been taken, so the gate sits in front of the shutter and in front of the record
   * button. A photo already on the card is evidence; refusing it then would be the
   * unforgivable failure wearing a billing excuse.
   */
  onQuota?: (kind: 'photos' | 'recordingMinutes', limit: number) => void;
  /**
   * THE FOUR PROMPTS, KEPT WITHIN REACH WHILE HE TALKS (hadar's storyboard step 3).
   *
   * Only passed by the guided first change order. WHY IT MATTERS: the coaching screen
   * before this one is read and then gone, and the moment the recorder opens is exactly
   * the moment a first-time user forgets what he was going to say. A strip of the same
   * four questions, on the recording screen, is the difference between nine unusable
   * words and something that can be priced.
   *
   * Undefined on every other path, and the strip does not render — an experienced user
   * capturing his fortieth extra does not need to be asked what a change order is.
   */
  coachPrompts?: { label: string }[];
  /** R1: the session becomes durable WHILE it happens, not at Done. */
  db: AbstractPowerSyncDatabase;
  ownerId: string;
  projectName: string;
  onCapture: (a: FusedArtifacts) => Promise<void>;
  onClose: () => void;
  resolveLabel: (s: Stamp) => Promise<{ place: string | null; job: string | null }>;
}) {
  const [perm, requestPerm] = useCameraPermissions();
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const recState = useAudioRecorderState(recorder);
  const camRef = React.useRef<CameraView>(null);
  const bakeRef = React.useRef<View>(null);

  const [stamp, setStamp] = React.useState<Stamp | null>(null);
  const [place, setPlace] = React.useState<string | null>(null);
  const [now, setNow] = React.useState(Date.now());
  const [micOn, setMicOn] = React.useState(false);
  const [facing, setFacing] = React.useState<CameraType>('back');
  const [flash, setFlash] = React.useState<'off' | 'on'>('off');

  /**
   * PINCH TO ZOOM (hadar, 2026-08-26: "the capture screen is missing a zoom -- can we
   * use the same gesture (fingures) to zoom in and out ? as the camera").
   *
   * The gesture every phone camera has, so there is nothing to learn — which is the
   * whole test in CLAUDE.md §1. It also costs NO new control on a screen whose touch
   * budget is a hard constraint (mandate #3): a pinch is not a button.
   *
   * WHY PanResponder AND NOT react-native-gesture-handler: that library is not a
   * dependency of this app, and adding it is a NATIVE change — it would need a new
   * build and could not reach a phone over the air. This ships in an update. The cost
   * is that the maths is ours; the benefit is that hadar gets it today.
   *
   * IT ONLY CLAIMS TWO-FINGER MOVES. `onMoveShouldSetPanResponder` returns false for a
   * single touch, so taps, the torch button and everything in the overlay above the
   * preview keep working exactly as they did. The shutter sits outside this band
   * entirely, so it was never at risk.
   */
  // `camZoom`, not `zoom`: this file already has a `zoom` — the photo lightbox's open
  // image. Two different subjects, one obvious name.
  const [camZoom, setCamZoom] = React.useState(0);
  /**
   * RECORDING MODE FIRST, CAMERA ON REQUEST (hadar, 2026-09-02: "rather than enter a
   * camera mode you enter a recording mode — you can talk, or you can write, up to you.
   * Add photos only if you need them").
   *
   * The screen opened as a viewfinder, which told every contractor that this product is
   * about photographs. It is not: the atomic unit is a spoken decision, and the camera
   * is corroboration. Opening on the recorder puts the primary input first and makes the
   * camera what it actually is — optional, and one tap away.
   *
   * NOTHING ABOUT THE CAPTURE MACHINERY CHANGES. Same recorder, same permissions, same
   * stamp, same commit, same live recognition. Only what is on screen when it opens.
   * `CameraView` is not merely hidden: it is not MOUNTED until asked for, so a
   * contractor who never needs a photo never spins up the camera, never warms the lens,
   * and never spends the battery on it.
   */
  const [camOpen, setCamOpen] = React.useState(false);
  // The live value, read inside the responder. State alone would be a stale closure —
  // the responder is created once and would keep pinching from whatever the zoom was
  // when the screen mounted.
  const zoomRef = React.useRef(0);
  const pinchFrom = React.useRef<{ dist: number; zoom: number } | null>(null);
  const pinch = React.useMemo(() => {
    const spread = (t: readonly { pageX: number; pageY: number }[]) =>
      Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);
    return PanResponder.create({
      // Never on a single finger, and never on touch-down: a tap must stay a tap.
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (e) => e.nativeEvent.touches.length === 2,
      onPanResponderGrant: (e) => {
        const t = e.nativeEvent.touches;
        if (t.length === 2) pinchFrom.current = { dist: spread(t), zoom: zoomRef.current };
      },
      onPanResponderMove: (e) => {
        const t = e.nativeEvent.touches;
        const from = pinchFrom.current;
        if (t.length !== 2 || !from || from.dist <= 0) return;
        // Proportional to how far the fingers moved RELATIVE to where they started, so
        // the same spread gives the same zoom wherever on the screen it happens.
        // 0.9 because a full 0→1 sweep of expo-camera's range across one hand-span is
        // far too twitchy to frame a crack in a wall with.
        const next = from.zoom + (spread(t) / from.dist - 1) * 0.9;
        // Rounded, and skipped when unchanged: this fires every frame and each change
        // re-renders the camera. Two decimals is finer than the preview can show.
        const clamped = Math.max(0, Math.min(1, Math.round(next * 100) / 100));
        if (clamped === zoomRef.current) return;
        zoomRef.current = clamped;
        setCamZoom(clamped);
      },
      onPanResponderRelease: () => { pinchFrom.current = null; },
      onPanResponderTerminate: () => { pinchFrom.current = null; },
    });
  }, []);

  /**
   * THE FRAME BLINK — hadar, 2026-08-26: "i need the screen to flash ... to let user
   * know that an image was taken".
   *
   * A white sheet over the preview for a blink, the way every camera app has done it
   * since the shutter was mechanical. It answers the one question a man asks after
   * pressing a button he cannot feel: did that do anything?
   *
   * NOT `flash` above — that is the LED/torch, a different thing with a confusingly
   * similar name. This never touches the lamp.
   *
   * `useNativeDriver` because it runs at the same moment the camera is encoding a
   * frame: an opacity animation on the JS thread would stutter exactly when the
   * device is busiest, and a stuttering confirmation reads as a fault.
   */
  const blink = React.useRef(new Animated.Value(0)).current;
  const flashFrame = React.useCallback(() => {
    blink.setValue(0.9);
    Animated.timing(blink, {
      toValue: 0, duration: 220, useNativeDriver: true,
    }).start();
  }, [blink]);
  /**
   * THE FRONT CAMERA HAS NO LAMP. Asking iOS for a torch on it does nothing, so the
   * button would go back to being the dead control this change is fixing — just on a
   * different camera. Derived rather than stored so flipping to the front cannot leave
   * a torch flag set behind it, and flipping back restores whatever was chosen.
   */
  const torchOn = flash === 'on' && facing === 'back';
  const [shots, setShots] = React.useState<Shot[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [paused, setPaused] = React.useState(false);        // user tapped pause
  const [interrupted, setInterrupted] = React.useState(false); // something ELSE stopped us
  const [warnEmpty, setWarnEmpty] = React.useState(false);
  const [bakeShot, setBakeShot] = React.useState<Shot | null>(null);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  /** The photo the viewer is showing, or null. Tapping a thumbnail sets it. */
  const [zoom, setZoom] = React.useState<string | null>(null);
  const bakeResolve = React.useRef<(() => void) | null>(null);

  // Interruption bookkeeping. Completed audio files (rolled when a call killed the
  // session) + the elapsed seconds they carry, so the timer never lies after a roll.
  const doneSegments = React.useRef<FusedAudioSegment[]>([]);
  const baseSecs = React.useRef(0);
  const segmentStartedAt = React.useRef(Date.now());
  const lastDurMs = React.useRef(0);
  // Has the mic heard actual speech yet? (metering peak, not just "is recording")
  const spokeRef = React.useRef(false);
  const [spoke, setSpoke] = React.useState(false);

  // R1: the session becomes durable WHILE it happens, not at Done. Photos are banked
  // at the shutter and audio wherever the recorder is ALREADY stopped, so a crash
  // mid-walk loses nothing that had finished.
  //
  // WHAT IS DELIBERATELY NOT CHANGED HERE: togglePause still calls recorder.pause().
  // The full R1 fix makes pause stop-and-bank instead, because a paused expo-audio
  // recording is an incomplete file on disk and only a stopped one is recoverable.
  // That is almost certainly right and it is the one part whose failure mode is
  // SILENT AUDIO LOSS, which no check in this repo can detect and no machine without
  // a microphone can test. So the additive half ships and the lifecycle change waits
  // for a device. Killed-while-PAUSED still loses the session; killed while
  // recording, or after an interruption, no longer does.
  const draft = useSessionDraft({ db, ownerId, stamp, enabled: !!perm?.granted });
  // The rough live transcript shown over the camera. Never stored; the real
  // transcript is made from the FILE after the session commits.
  const [liveText, setLiveText] = React.useState('');
  /**
   * THE WORDS HE CAN CHANGE — seeded by recognition, owned by him from the first keypress.
   *
   * `draftTouched` is what makes both true at once: until he types, the field mirrors
   * the live transcript and keeps updating as he keeps talking. The moment he edits, the
   * recogniser stops overwriting him. Without that flag either the field is frozen the
   * instant recognition starts, or it silently eats what he typed on the next partial —
   * and losing something a person typed is the same sin as losing a capture.
   *
   * IT IS NOT THE EVIDENCE. The audio is, and it is committed whatever this says. This
   * is the working copy: a correction of what the machine heard, saved beside the
   * recording rather than instead of it.
   */
  const [summary, setSummary] = React.useState('');
  const summaryTouched = React.useRef(false);
  /**
   * THE LAST THING RECOGNITION SAID, so the next callback can be read as a DELTA.
   *
   * hadar, 2026-09-02: "it should accumulate the recording text into the draft summary
   * field — it should not remove or erase the text."
   *
   * `startLive` reports the whole of the CURRENT recognition session each time, and a
   * session restarts on pause, on resume, and whenever the OS decides it has heard
   * enough silence. Assigning `t` straight into the field — which is what it did —
   * therefore replaced everything the moment recognition began again: pause to think,
   * speak again, and the first half of what you said was gone.
   */
  const lastLiveRef = React.useRef('');
  /** `paused` for the recognition callback, which closes over its first render. */
  const pausedRef = React.useRef(false);
  React.useEffect(() => { pausedRef.current = paused; }, [paused]);
  /** Is the summary field being typed in? Drives the Done affordance — see the header. */
  const [summaryFocused, setSummaryFocused] = React.useState(false);

  /**
   * THE SCREEN STAYS ON WHILE THE MIC IS OPEN (hadar, 2026-09-02: "when I am recording
   * the phone goes into hibernation mode — this should not be the case, keep the phone
   * alive").
   *
   * IT IS NOT A COMFORT FEATURE. This app has no `UIBackgroundModes: audio`, so when
   * iOS sleeps the handset it suspends the app and the recorder stops — mid-sentence,
   * with no warning, on the screen whose one promise is that it captured what he said.
   * A contractor describing a wall for ninety seconds without touching the glass is the
   * NORMAL case here, and the auto-lock default is thirty.
   *
   * Scoped to the recording, not the screen: it releases the moment the mic closes, so
   * a capture screen left open on a bench does not hold the display on until the battery
   * is flat.
   */
  React.useEffect(() => {
    if (!micOn) return;
    let held = false;
    /**
     * LOADED AT RUNTIME, NOT IMPORTED AT THE TOP, AND THAT IS NOT STYLE.
     *
     * `expo-keep-awake` is a NATIVE module. A static import ships in the JS bundle, and
     * this app updates over the air onto a binary that does not contain it — so the
     * import would resolve to nothing and take the capture screen down with it. The one
     * screen that must never fail is the one that records.
     *
     * So: ask for it, use it if the running binary has it, and carry on without it if
     * not. The wake lock arrives when the next build does; nothing waits for it and
     * nothing breaks before it.
     */
    void (async () => {
      try {
        const ka = await import('expo-keep-awake');
        await ka.activateKeepAwakeAsync(KEEP_AWAKE_TAG);
        held = true;
      } catch { /* older binary: the screen may sleep, everything else still works */ }
    })();
    return () => {
      if (!held) return;
      void (async () => {
        try {
          const ka = await import('expo-keep-awake');
          await ka.deactivateKeepAwake(KEEP_AWAKE_TAG);
        } catch { /* nothing to release */ }
      })();
    };
  }, [micOn]);
  /**
   * DISMISSED BY HAND, AND IT STAYS DISMISSED (hadar, 2026-08-18: "allow the user to
   * close the message screen so they can see the full camera screen").
   *
   * The card auto-collapses once he starts talking or snaps a photo, which covers the
   * common case and covers it well. It does not cover the one he hit: lining up a shot
   * BEFORE saying anything, with a three-line card sitting over the viewfinder and no
   * way to move it. Auto-behaviour that cannot be overridden is the app deciding it
   * knows better than the person holding the phone.
   *
   * Sticky for the session on purpose. A card that reappeared on the next state change
   * would have to be dismissed again mid-shot, which is worse than not offering it.
   *
   * DECLARED HERE, WITH THE OTHER HOOKS, AND NOT WHERE IT IS USED. It was first put next
   * to `expanded` further down — which sits AFTER the two permission early-returns at
   * `if (!perm)` and `if (!perm.granted)`. On the first render permission is still
   * resolving, the component returns early, and this hook never runs; on the next render
   * it does. React counts hooks positionally, so the screen died with "Rendered more
   * hooks than during the previous render" the moment permission resolved — every time,
   * for everyone. Hooks go above every conditional return, without exception.
   */
  const [cardDismissed, setCardDismissed] = React.useState(false);

  const liveRef = React.useRef<LiveHandle | null>(null);

  React.useEffect(() => {
    if (!perm) return;
    if (!perm.granted) { requestPerm(); return; }
    let live = true;
    (async () => {
      const fix = await stampNow();
      setStamp(fix);
      resolveLabel(fix)
        .then((r) => { if (live) setPlace(r.place); })
        .catch(() => { /* unresolved stays honest */ });
      /**
       * THE RECORDING CAP, ASKED BEFORE THE MIC OPENS (hadar, 2026-09-03).
       * `checkRecording` measures minutes already banked against the plan's allowance —
       * 30 on free. Asked before `prepareToRecordAsync` so nothing is ever captured and
       * then refused, which mandate #1 forbids.
       *
       * The screen stays usable when it refuses: he can still type the change and add
       * photos. A cap on the microphone is not a cap on the product.
       */
      try {
        const q = await checkRecording(db);
        if (!q.ok) { onQuota?.('recordingMinutes', q.limit); return; }
      } catch { /* unreadable — let him record; see the shutter for why */ }
      if (await requestMic()) {
        try {
          await recorder.prepareToRecordAsync();
          segmentStartedAt.current = Date.now();
          recorder.record();
          if (live) setMicOn(true);
          // Speech permission is asked HERE, once, right after the mic grant —
          // the one moment a dialog about listening cannot surprise anyone,
          // because they just granted the microphone. Then the live view
          // starts. Every failure is silent and costs only the moving text:
          // the recording is already running and nothing may touch it.
          const wantsAsk = await needsPermissionAsk();
          void logDiag(db, 'stt.ask', `needed=${wantsAsk}`);
          if (wantsAsk) {
            const got = await requestSpeechPermission();
            void logDiag(db, 'stt.ask', `-> ${got}`);
          }
          startLive(db, (t) => {
            if (!live) return;
            setLiveText(t);
            /**
             * APPEND THE NEW WORDS, NEVER REWRITE THE FIELD.
             *
             * `t` is cumulative within one recognition session, so the ordinary case is
             * that it EXTENDS what we last saw and the delta is the tail. When it does
             * not extend — a session restarted and `t` begins again — the whole of `t`
             * is new and the earlier words are already in the field.
             *
             * Either way this only ever ADDS. A man who paused, typed a correction and
             * carried on talking keeps the correction and gains the new sentence.
             */
            /**
             * PAUSED MEANS PAUSED — INCLUDING THE WRITING.
             *
             * hadar, 2026-09-02: "the recording is on pause but the draft summary keeps
             * on capturing text — that is wrong."
             *
             * `togglePause` pauses the RECORDER. On-device recognition is a separate
             * session and kept listening, so words spoken during a pause were written
             * into the summary while being absent from the audio. The text would then
             * describe work the recording does not contain — a document saying more than
             * its evidence, which is the shape of every dispute this product exists to
             * prevent.
             *
             * `lastLiveRef` still advances, so the words heard during the pause are
             * SWALLOWED rather than banked: on resume the delta starts from where
             * recognition actually is, and nothing said while the mic was off arrives
             * late in one lump.
             */
            if (pausedRef.current) { lastLiveRef.current = t; return; }
            const last = lastLiveRef.current;
            const delta = t.startsWith(last) ? t.slice(last.length) : t;
            lastLiveRef.current = t;
            if (!delta.trim()) return;
            setSummary((prev) => {
              const join = prev && !/\s$/.test(prev) && !/^\s/.test(delta) ? ' ' : '';
              return prev + join + delta;
            });
          })
            .then((h) => { liveRef.current = h; })
            .catch(() => { /* indicator only */ });
        } catch { /* mic optional: photos-only is still a capture */ }
      }
    })();
    return () => {
      live = false;
      // The recogniser lets go of the input BEFORE the recorder finalises.
      try { liveRef.current?.stop(); } catch { /* already stopped */ }
      liveRef.current = null;
      try { recorder.stop(); } catch { /* noop */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perm?.granted]);

  React.useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  // Track duration + speech while recording; DETECT INTERRUPTION: if we believe the
  // mic is on and nobody paused it, but the recorder stopped, something external
  // (a phone call, Siri, another app) took the session. Say so and offer resume —
  // silently losing the rest of the walk is exactly what this screen must not do.
  React.useEffect(() => {
    if (!micOn || saving) return;
    if (recState.isRecording) {
      lastDurMs.current = recState.durationMillis ?? lastDurMs.current;
      if ((recState.metering ?? -160) > -40 && !spokeRef.current) {
        spokeRef.current = true; setSpoke(true); setWarnEmpty(false);
      }
      if (interrupted) setInterrupted(false);
    } else if (!paused && !interrupted && (recState.durationMillis ?? 0) > 0) {
      setInterrupted(true);
    }
  }, [micOn, saving, paused, interrupted, recState.isRecording, recState.durationMillis, recState.metering]);

  if (!perm) return <View style={st.screen} />;
  if (!perm.granted) {
    return (
      <View style={[st.screen, st.center]}>
        <Text style={st.permMsg}>{T('cap.needCamera')}</Text>
        <Pressable style={[TT.btn, TT.btnOrange, st.permBtn]} onPress={requestPerm}>
          <Text style={TT.btnText}>{T('cap.allowCamera')}</Text>
        </Pressable>
        <Pressable style={st.permLink} onPress={onClose}>
          <Text style={TT.btnGhostText}>{T('terms.later')}</Text>
        </Pressable>
      </View>
    );
  }

  const secs = baseSecs.current + Math.floor((recState.durationMillis ?? lastDurMs.current) / 1000);
  const level = recState.metering == null ? 0 : Math.max(0, Math.min(1, (recState.metering + 60) / 55));
  const recordingNow = micOn && recState.isRecording && !paused;
  // Coach the user who tapped and went quiet: nothing has been heard, nothing snapped.
  const coach = micOn && !spoke && !paused && !interrupted && shots.length === 0 && secs >= 3;
  // The reassurance card is big on open — that is its whole job — and then gets out of
  // the way of the viewfinder once he is actually doing the thing (hadar, 2026-07-27).
  // Pausing re-expands it, because a paused mic is exactly when "what is it doing now?"
  // needs a full-size answer.

  // The reassurance card is big on open — that is its whole job — and then gets out of
  // the way of the viewfinder once he is actually doing the thing (hadar, 2026-07-27).
  // Pausing re-expands it, because a paused mic is exactly when "what is it doing now?"
  // needs a full-size answer.
  /**
   * IN RECORDING MODE THE CARD IS THE SCREEN, so it never collapses.
   *
   * hadar, 2026-09-02: "missing a button to pause and continue the recording." It was
   * there — inside this card — and the card hides itself the moment he has SPOKEN
   * (`!spoke`), which is precisely the moment a pause becomes useful. He talked, the
   * card shrank to the slim strip, and the only pause control on the screen went with
   * it. Recording mode has no action row to fall back on any more, so that left no way
   * to pause at all.
   *
   * The collapse exists to CLEAR THE VIEWFINDER — the card is an overlay competing with
   * a preview he is trying to frame. With no preview there is nothing to clear and
   * nothing to compete with; the card is the content.
   */
  const expanded = camOpen
    ? !cardDismissed && (paused || (!spoke && shots.length === 0))
    : true;

  /** Close the sheet AND drop the viewer, so reopening never lands mid-photo.
   *  Android's back gesture routes here too: it shuts the viewer first if one is
   *  open, which is what "back" means to the person looking at a photo. */
  const closeSheet = () => {
    if (zoom) { setZoom(null); return; }
    setSheetOpen(false);
  };

  const togglePause = async () => {
    if (!micOn) return;
    try {
      if (paused) { recorder.record(); setPaused(false); }
      else { await recorder.pause(); setPaused(true); }
    } catch { /* recorder in a weird state -> the interruption watcher will surface it */ }
  };

  /** Resume after a call took the mic. Try in place; if the session is dead, bank the
   *  finished file as a segment and start a fresh one — the walk continues. */
  const resumeAfterInterruption = async () => {
    try {
      recorder.record();
      setInterrupted(false);
      return;
    } catch { /* session gone — roll a new segment */ }
    try {
      try { await recorder.stop(); } catch { /* may already be stopped */ }
      if (recorder.uri) {
        try {
          doneSegments.current.push({
            bytes: await readRecordingBytes(recorder.uri),
            mime: 'audio/m4a', startedAtMs: segmentStartedAt.current,
          });
          baseSecs.current += Math.floor(lastDurMs.current / 1000);
          // R1: bank it too. This is where the recorder is ALREADY stopped and the
          // bytes ALREADY read — no new lifecycle behaviour, just writing down what
          // this path had until now kept only in memory.
          await draft.segment({ srcUri: recorder.uri, startedAtMs: segmentStartedAt.current,
                                durationMs: lastDurMs.current });
        } catch { /* an unreadable segment is lost audio we cannot invent */ }
      }
      await requestMic();
      await recorder.prepareToRecordAsync();
      segmentStartedAt.current = Date.now();
      lastDurMs.current = 0;
      recorder.record();
      setInterrupted(false);
    } catch { /* still held (call ongoing) — banner stays, user retries */ }
  };

  const snap = async () => {
    /**
     * NO CAMERA, NO CUE. `camRef.current` is null until the preview mounts, and a tap
     * in that window used to blink and click and take nothing — the outer catch
     * swallowed it. A confirmation for a photo that does not exist is the phantom-
     * "saved" fault at the shutter, and mandate #1 does not care that this one is only
     * a shutter cue: he walks away believing he has the shot.
     */
    const cam = camRef.current;
    if (!cam) return;
    /**
     * THE PHOTO CAP, ASKED BEFORE THE SHUTTER (hadar, 2026-09-03). `checkPhotos` counts
     * committed, undiscarded photos across every job; the free plan allows 30. Asked
     * HERE and not in the commit, because a photo that has been taken is evidence and
     * mandate #1 does not allow billing to destroy it.
     *
     * Fails OPEN: if the count cannot be read we take the picture. A quota is a
     * business rule and a capture is the product — when the two cannot both be
     * honoured, the capture wins.
     */
    try {
      const q = await checkPhotos(db);
      if (!q.ok) { onQuota?.('photos', q.limit); return; }
    } catch { /* unreadable count — never let bookkeeping cost him the shot */ }
    try {
      const atMs = Date.now();
      /**
       * FEEDBACK FIRST, BEFORE THE AWAIT — and that ordering is the point.
       *
       * `takePictureAsync` resolves after the image is encoded and written, which is
       * hundreds of milliseconds later. Waiting for it would put the blink and the
       * click a beat behind the thumb, and a confirmation that arrives late does not
       * read as a response to what you did — it reads as the app being slow.
       *
       * Honest, because of what this cue CLAIMS: the shutter fired, nothing more. The
       * capture's real confirmation is `signalSaved`, which fires only once the write
       * has committed. Firing that here would be the phantom-"saved" fault; firing
       * this here is just a camera behaving like a camera.
       *
       * AND IT IS TAKEN BACK IF NOTHING ARRIVES — see the catch. The cue is a promise
       * that a frame was grabbed; when the grab fails, saying so is the difference
       * between a slow camera and a lost photograph.
       */
      flashFrame();
      void signalShutter();
      const pic = await cam.takePictureAsync({ quality: 0.8 });
      if (!pic?.uri) throw new Error('no image returned');
      setShots((s) => [...s, { uri: pic.uri, atMs, fromLibrary: false }]);
      setWarnEmpty(false);
      // Durable within a second of the shutter. Fire-and-forget: banking must never
      // delay the next shot (mandate #3's touch budget) and a failed bank leaves the
      // photo exactly as safe as it was before — in React state, committed at Done.
      void draft.photo({ srcUri: pic.uri, atMs, mime: 'image/jpeg', fromLibrary: false });
    } catch (e: any) {
      /**
       * THE SHOT DID NOT HAPPEN, AND HE HAS ALREADY BEEN TOLD IT DID. A dropped frame
       * must not end the walk — that rule stands — but it must not pass as a photo
       * either. `signalFailed` is the file's own "unmistakably not the success sound",
       * and the trail says which tap it was so a pattern is findable afterwards.
       */
      void signalFailed();
      void logDiag(db, 'capture.snap', String(e?.message ?? e).slice(0, 160));
    }
  };

  /** Pick from the gallery mid-walk. atMs = NOW: you pick it while talking about it,
   *  so it ties to this moment of the narration like any snap. */
  const pickFromGallery = async () => {
    try {
      const p = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!p.granted) return;
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'], allowsMultipleSelection: true, quality: 0.8,
      });
      if (r.canceled || !r.assets?.length) return;
      const atMs = Date.now();
      setShots((s) => [...s, ...r.assets.map((a) => ({ uri: a.uri, atMs, fromLibrary: true }))]);
      for (const a of r.assets) {
        void draft.photo({ srcUri: a.uri, atMs, mime: a.mimeType ?? 'image/jpeg', fromLibrary: true });
      }
      setWarnEmpty(false);
    } catch { /* picker failure must not end the walk */ }
  };

  const bakeOne = (shot: Shot): Promise<Uint8Array> =>
    new Promise((resolve) => {
      bakeResolve.current = async () => {
        bakeResolve.current = null;
        try {
          // Two frames' settle after onLoad: decode-complete is not
          // composite-complete, and snapshotting mid-composite is how a bake
          // catches a half-drawn frame.
          await new Promise((r) => setTimeout(r, 64));
          const uri = await captureRef(bakeRef, { format: 'jpg', quality: 0.9, result: 'tmpfile' });
          // The STAMPED bake also goes to the camera roll (hadar, 2026-07-23):
          // a convenience COPY, add-only permission, never the record — the
          // app's committed file stays the evidence (mandate #1). Camera shots
          // only; a gallery pick never reaches bakeOne. Fire-and-forget: the
          // roll must not delay Done, and a refusal costs only the copy.
          void (async () => {
            try {
              const ML = await import('expo-media-library');
              await ML.saveToLibraryAsync(uri);
            } catch (e: any) {
              void logDiag(db, 'roll.save', String(e?.message ?? e).slice(0, 120));
            }
          })();
          resolve(await readRecordingBytes(uri));
        } catch {
          resolve(await readRecordingBytes(shot.uri));
        } finally { setBakeShot(null); }
      };
      setBakeShot(shot);
    });

  const finish = async () => {
    if (saving) return;
    // The empty-done guard: no photos and nothing HEARD -> there is nothing to build a
    // change order from. Refuse loudly and coach, instead of saving emptiness.
    /**
     * TYPING IS CAPTURING. Without `typed` here, a contractor who wrote instead of
     * speaking — because the site was too loud, or he was on a call, or he simply
     * preferred to — was told he had captured nothing and refused. That would make
     * "you can talk or you can write" false at the only moment it matters.
     */
    const typed = summaryTouched.current && summary.trim().length > 0;
    if (!shots.length && !spokeRef.current && !typed) { setWarnEmpty(true); return; }
    setSaving(true);
    try { await recorder.stop(); } catch { /* noop */ }
    try {
      const photos: FusedPhoto[] = [];
      for (const shot of shots) {
        // Camera shots get the stamp baked in. LIBRARY picks do not: the photo was not
        // taken here-and-now, and stamping it as if it were is manufactured evidence.
        const bytes = shot.fromLibrary
          ? await readRecordingBytes(shot.uri)
          : await bakeOne(shot);
        photos.push({ bytes, mime: 'image/jpeg', atMs: shot.atMs, fromLibrary: shot.fromLibrary });
      }
      const audioSegments = [...doneSegments.current];
      if (micOn && recorder.uri) {
        try {
          audioSegments.push({
            bytes: await readRecordingBytes(recorder.uri),
            mime: 'audio/m4a', startedAtMs: segmentStartedAt.current,
          });
        } catch { /* final segment unreadable; earlier segments still commit */ }
      }
      await onCapture({
        photos, audioSegments,
        stamp: stamp ?? { capturedAtMs: Date.now(), lat: null, lng: null,
          accuracyM: null, fixAgeMs: null, status: 'unavailable' },
        previewUris: shots.map((x) => x.uri),
        durationSecs: secs,
        /**
         * WHAT HE TYPED, and ONLY when he typed it.
         *
         * `summaryTouched` is the whole condition. Untouched, the field is a mirror of
         * the live recogniser — passing that back would commit a text capture that says
         * exactly what the audio already says, in a rougher form, and the pipeline would
         * then structure a transcript of a transcript.
         *
         * IT DOES NOT REPLACE THE AUDIO. Every segment above still commits; this is an
         * additional capture, and both are evidence of the same moment. A man who typed
         * because the site was too loud to speak gets a text capture and no audio; a man
         * who spoke and then fixed a word gets both, and the correction is the newer of
         * the two rather than an edit of the older.
         */
        typedText: summaryTouched.current && summary.trim() ? summary.trim() : undefined,
      });
    } finally { setSaving(false); }
  };

  return (
    <View style={st.screen}>
      {/* The bake view renders BEFORE everything, so an OPAQUE sibling hides it.
          It was hidden with opacity 0.01 instead — and captureRef snapshots the
          view AS RENDERED, so every camera photo was baked at 1% opacity: a valid,
          near-white JPEG with a ghost of the scene (hadar, on device 2026-07-23,
          "the squares are empty"). Never hide a view-shot source with opacity.
          Baking only happens inside finish(), i.e. while `saving` is true, and the
          saving overlay below is FULLY OPAQUE for exactly this reason — the old
          layout relied on the full-bleed camera to cover it, and the camera is no
          longer full-bleed. */}
      {bakeShot && (
        /**
         * OFF-SCREEN, NOT COVERED (hadar, 2026-08-24: "it still opens a white splash
         * screen ... it should open the location screen immediately").
         *
         * This view exists only to be photographed: `captureRef` snapshots it to bake
         * the GPS stamp into the JPEG. It used to be drawn at full size ON the screen,
         * which is why a fully opaque "Saving N photos" overlay had to sit on top of it
         * — the white flash he is describing.
         *
         * IT IS MOVED, NOT HIDDEN, AND THE DIFFERENCE IS THE WHOLE HISTORY OF THIS
         * BLOCK. Hiding it with `opacity: 0.01` is what produced photos baked at 1%
         * opacity — near-white JPEGs with a ghost of the scene — because captureRef
         * snapshots the view AS RENDERED and opacity is part of rendering. Position is
         * not: the view still renders at full size, still composites normally, and is
         * simply somewhere the screen does not reach. Explicit width/height because an
         * absolutely-positioned child needs them once it is no longer filling a parent.
         */
        <View pointerEvents="none"
          style={{ position: 'absolute', left: -BAKE.width * 2, top: 0,
                   width: BAKE.width, height: BAKE.height }}>
          <View ref={bakeRef} collapsable={false}
            style={{ width: BAKE.width, height: BAKE.height }}>
            <Image source={{ uri: bakeShot.uri }} style={st.fill} resizeMode="cover"
              onLoad={() => bakeResolve.current?.()} />
            <StampBlock place={place} now={bakeShot.atMs} />
          </View>
        </View>
      )}

      {/* ---------- TOP BAR ---------- */}
      {/* IN RECORDING MODE THERE IS NOTHING LEFT IN IT (hadar, 2026-09-02: "fix the
          header position — there is a gap on top"). Cancel moved to the foot, the title
          and the location went to the card, torch and flip belong to the camera. What
          remained was 56pt of status-bar padding plus 10pt of nothing, pushing the rail
          a third of the way down an empty screen.

          The bar is not rendered at all now; the band takes the status-bar clearance
          instead, so the rail sits where the header used to start. */}
      {camOpen && (
      <View style={st.topBar}>
        {/* AN ICON IS ENOUGH HERE (hadar: "the cancel button in the header takes too
            much space"). The word earns its place over a viewfinder, where the top bar
            is the only chrome and nothing else explains itself; on the recorder it is a
            labelled box competing with a rail and a heading for the top of the screen,
            to say what an ✕ already says. The accessible label keeps the word for anyone
            who needs it read aloud. */}
        {/* NOT IN THE HEADER ANY MORE (hadar, 2026-09-02: "the close X on top of the
            header still takes too much space — need to remove it from there and move it
            somewhere else").

            The recorder's top is a rail and a sentence, and a 44pt control beside them
            is a third element competing for the first thing he reads — on the screen
            whose whole instruction is "start talking". It moves to the FOOT, under the
            primary, as a quiet word: the same place and the same shape the review screen
            puts "Close for now", so leaving a flow looks the same wherever he is in it.
            It keeps the header over a viewfinder, where the top bar is the only chrome
            and there is nowhere else for it to go. */}
        {/* NO CANCEL HERE EITHER (hadar, 2026-09-02). The camera is a PANEL, and its
            primary button is "← Back to recording" — so there is already a way out, to
            the screen that owns cancelling. Two exits from a panel, one of which throws
            away the recording, is one exit too many next to a shutter.
            A spacer, not nothing: the title and the torch balance around it. */}
        <View style={st.topX} />

        {/* THE HEADER SAID EVERYTHING TWICE (hadar, 2026-09-02: "clean the top").
            "VOICE RECORDING · 00:16" over a card titled "Voice recording" carrying its
            own timer, and a location line under a screen that has not asked about
            location. In camera mode all of that is the ONLY place any of it appears, so
            it stays there. On the recorder the card says it, better, in the place he is
            already looking. */}
        {/* THE CAMERA HEADER IS FOR CAMERA CONTROLS (hadar: "remove voice paused and
            the address from the header of that screen").

            The mic state is on the card in the band, three centimetres below, with a
            wave and a timer. The where/when line was mandate #9 said in words — but it
            is also said by the GPS stamp BAKED INTO EVERY PHOTOGRAPH, which is the
            version that survives leaving this screen and the version that matters in a
            dispute. A caption repeating it over the viewfinder costs a line of a screen
            he is trying to aim. */}
        <View style={st.topMid} />

        {/* CAMERA CHROME BELONGS TO THE CAMERA. Torch and flip are meaningless while
            the lens is not even mounted, and two dead-looking controls in the corner of
            a recording screen are two more things to read past before talking. They
            appear with the camera and leave with it. */}
        <View style={st.topRight}>
          {/* Hidden, not disabled-looking, on the front camera: there is no lamp to
              turn on, and a greyed control still invites the tap that will do nothing. */}
          {camOpen && facing === 'back' && (
            <Pressable onPress={() => setFlash((f) => (f === 'off' ? 'on' : 'off'))}
              style={st.topBtn} accessibilityRole="button"
              accessibilityState={{ selected: torchOn }}>
              <Icon name="flash" size={22} color={torchOn ? C.caution : C.ink} />
              <Text style={[st.topLab, torchOn && st.topLabOn]}>
                {torchOn ? T('cap.flashOn') : T('cap.flashOff')}
              </Text>
            </Pressable>
          )}
          {camOpen && (
            <Pressable onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))} style={st.topBtn}>
              <Icon name="cameraFlip" size={22} color={C.ink} />
              <Text style={st.topLab}>{T('cap.flip')}</Text>
            </Pressable>
          )}
          {/* THE WAY BACK. A camera you can only leave by finishing is a mode, and this
              is meant to be a panel — he opened it for one photo and must be able to
              return to his words. Recording keeps running throughout: closing the lens
              is not stopping the mic. */}
          {/* The way back is the PRIMARY button now, at the bottom where the thumb
              already is. A second one up here was two controls for one act. */}
        </View>
      </View>
      )}

      {/* ---------- CAMERA BAND ---------- */}
      {/* BLACK BEHIND A LENS, PAPER BEHIND WORDS. The band is black because a viewfinder
          wants black around it; with the camera closed the same black would be a hole in
          a light screen, and every card on it would read as an overlay on nothing. */}
      <View style={[st.band, !camOpen && { backgroundColor: C.paper }]}>
        {/* THE LIGHT STAYS ON — `enableTorch`, not just `flash` (hadar 2026-08-13:
            "the flash doesn't run").
            `flash="on"` fires the LED for a few milliseconds at the shutter and does
            nothing before it. So the button lit up, the scene stayed dark, and the only
            evidence it had worked at all arrived after the photo was already taken —
            which reads, correctly, as a dead button.
            That is also the wrong behaviour for this product. The place a contractor
            reaches for this is a crawlspace or the back of a panel: he needs to SEE
            what he is pointing at, frame it, and talk about it while the light is on.
            A torch does that AND lights the photo; a shutter flash does neither until
            it is too late to aim.
            `mode="picture"` is set explicitly rather than left to the default, because
            the flash/torch configuration is applied per mode and an implicit default is
            not something to rely on for hardware that either turns on or does not. */}
        {/* MOUNTED ONLY WHEN ASKED FOR. Not hidden — absent. A contractor who only
            talks never starts the camera, and the recorder gets the screen it deserves
            as the primary input rather than as an overlay on a viewfinder. */}
        {camOpen ? (
          <CameraView ref={camRef} style={st.fill} mode="picture" facing={facing}
            flash={flash} enableTorch={torchOn} zoom={camZoom} />
        ) : (
          <View style={[st.fill, { backgroundColor: C.paper }]} />
        )}

        {/* THE PINCH SURFACE. Over the preview and UNDER the overlay cards, so the
            cards and the torch button still take their own touches first. It claims
            only two-finger moves, so a single tap passes straight through it. */}
        <View style={StyleSheet.absoluteFill} {...pinch.panHandlers} />

        {/* THE BLINK. Over the preview, under everything the user can touch, and
            `pointerEvents="none"` so it can never swallow the next shutter press —
            a confirmation that eats the following tap would cost the photo it was
            meant to reassure him about. */}
        <Animated.View pointerEvents="none" style={[st.blink, { opacity: blink }]} />

        {/* The cards sit in NORMAL FLOW inside an overlay, not absolutely positioned.
            They were absolute at first and it only worked on one screen height: the
            reassurance card grows with its state (the interruption copy is two lines,
            the coach card three) and a fixed `top` for the camera hint below it means
            a taller card lands on top of it. Flow + gap cannot overlap at any size. */}
        {/* THE STATUS-BAR CLEARANCE LIVES HERE, not on the band. `bandFlow` is an
            absolute fill, so it ignores its parent's padding entirely — putting the
            inset on the band would have looked right in the diff and moved nothing. */}
        <View style={[st.bandFlow, !camOpen && { paddingTop: 56 }]} pointerEvents="box-none">
          {/* THE SCREEN SAYS WHAT IT WANTS. A viewfinder needs no heading — it is
              obvious what a camera is for. A recorder is not: hadar's mockup opens with
              a sentence telling the contractor to talk, and that sentence is the
              difference between a man who starts speaking and one who looks for the
              button. Camera mode keeps its bare viewfinder. */}
          {!camOpen && (
            <View>
              {/* STEP 1 OF THE SAME FLOW (hadar: "it is missing the progress bar on top").
                  Record · Job · Client · Write-up · Review — this screen is the first of
                  them and was the only one not saying so, which made the journey look
                  like it started at the job picker. The rail is the same component the
                  other four draw, so the five cannot disagree about where he is. */}
              <FlowRail step={1} />
              <Text style={[st.askTitle, { marginTop: 18 }]}>{T('cap.askTitle')}</Text>
              <Text style={st.askSub}>{T('cap.askSub')}</Text>
            </View>
          )}
          {/* THE reassurance card. One card, one state at a time — an interruption or a
              refused Done REPLACES it rather than stacking another banner on top, so
              there is never more than one thing to read. */}
          {interrupted ? (
            <Pressable style={[st.card, st.cardAlarm]} onPress={resumeAfterInterruption}>
              <Text style={st.alarmT}>📞 {T('cap.interrupted')}</Text>
              <Text style={st.alarmS}>{T('cap.tapToResume')}</Text>
            </Pressable>
          ) : warnEmpty ? (
            <View style={[st.card, st.cardWarn]}>
              <Text style={st.warnT}>{T('cap.nothingYet')}</Text>
            </View>
          ) : coach ? (
            <View style={[st.card, st.cardCoach]}>
              <Text style={st.coachT}>{T('cap.sayWhat')}</Text>
              <Text style={st.coachEx}>{T('cap.sayWhatEx')}</Text>
            </View>
          ) : expanded ? (
            <View style={st.card}>
              {/* CLEAR THE VIEWFINDER. Top-right, 44pt, and it hides only this card —
                  the recording is untouched, which is the whole point: he is framing a
                  shot, not stopping. The mic state stays readable in the collapsed
                  strip that replaces this, so dismissing costs him no information. */}
              {camOpen && (
                <Pressable
                  onPress={() => setCardDismissed(true)}
                  accessibilityRole="button"
                  accessibilityLabel={T('cap.hideCard')}
                  hitSlop={8}
                  style={st.cardClose}>
                  <Text style={st.cardCloseT}>✕</Text>
                </Pressable>
              )}
              <View style={st.cardTop}>
                {/* THE 60pt MIC DISC IS CAMERA-MODE FURNITURE (hadar: "the your voice is
                    recording section is much too big — we can remove the icon and just
                    have the progress bar"). Over a viewfinder it is the only thing
                    saying the mic is live. On the recorder the card is already titled
                    "Voice recording", the wave is moving and the timer is counting, so a
                    third mic symbol costs a third of the card's height to repeat what
                    two other elements already say. */}
                {camOpen && (
                  <View style={[st.micDisc, paused && st.micDiscPaused]}>
                    <Icon name={paused ? 'pause' : 'microphone'} size={30} color="#fff" />
                  </View>
                )}
                <View style={st.cardTopText}>
                  {/* THE LABEL LEADS WITH A SMALL MIC, as the mockup draws it — the disc
                      is gone but the symbol is worth one line at 15pt. */}
                  {/* THE LABEL IS A LABEL, NOT A HEADING (hadar: "the your voice is
                      paused text is too big, and the icon to the right of it is too
                      small"). It sat at heading weight above a wave that says the same
                      thing louder, while the mic beside it was a 15pt afterthought. The
                      two swap emphasis: the symbol reads at a glance, the words explain
                      it. Camera mode keeps its own sizing — there the line is the only
                      thing on screen saying the mic is live. */}
                  <View style={st.cardTitleRow}>
                    {!camOpen && (
                      <Icon name={paused ? 'pause' : 'microphone'} size={19}
                        color={paused ? C.caution : C.brand} />
                    )}
                    <Text style={[st.cardTitle, !camOpen && st.cardTitleSm]}>
                      {paused ? T('cap.voiceIsPaused') : T('cap.voiceIsRecording')}
                    </Text>
                  </View>
                  {/* THE TIMER MOVED HERE WITH THE HEADER IT USED TO LIVE IN. Cleaning
                      the top took the only elapsed time on the recorder with it, and a
                      recording with no clock is a recording you cannot judge the length
                      of — the one number that tells him whether he has said enough. */}
                  <View style={st.waveRow}>
                    <View style={{ flex: 1 }}>
                      <Wave level={level} active={recordingNow} />
                    </View>
                    {!camOpen && (
                      <Text style={st.cardClock}>
                        {two(Math.floor(secs / 60))}:{two(secs % 60)}
                      </Text>
                    )}
                  </View>
                </View>
              </View>
              {/* "Explain what changed and what needs to be done" IS INSTRUCTION THE
                  RECORDER NO LONGER NEEDS (hadar, 2026-09-02: "remove the sentence").

                  The screen already opens with "Just tell us what happened. Talk first.
                  Edit after." — asked and answered, at the top, before he starts. A
                  second brief inside the live card repeats it at the one moment he is
                  doing the thing, which is when advice is least useful and most in the
                  way of the wave, the timer and his own words.

                  IT STAYS IN CAMERA MODE, where there is no heading and the card is the
                  only thing telling him what to say. The PAUSED line stays in both: that
                  is not advice, it is the state — photos still work, and a man who has
                  paused needs to know he has not ended anything. */}
              {(camOpen || paused) && (
                <Text style={st.cardBody}>
                  {paused ? T('cap.pausedHint') : T('cap.explainWhat')}
                </Text>
              )}
              {/* STOP, INSIDE THE CARD THAT IS RECORDING. In camera mode this lives in
                  the action row beside the shutter, where a thumb finds it without
                  looking. In recording mode the card IS the screen, and the control
                  belongs to the thing it controls rather than to a row at the bottom. */}
              {!camOpen && micOn && (
                <Pressable style={st.stopBtn} onPress={togglePause}
                  disabled={saving || interrupted} accessibilityRole="button">
                  {/* THE GLYPH HAS TO AGREE WITH THE WORD (hadar, 2026-09-02: "we need
                      a different button, one that will resemble a pause icon"). A filled
                      square is the universal STOP mark, and it sat next to the word
                      Pause — the icon saying one thing and the label another, on the
                      control that decides whether a recording survives. Two bars now,
                      drawn rather than iconised so they match the label's weight. */}
                  {paused
                    ? <Icon name="play" size={16} color={C.brandDark} />
                    : (
                      <View style={st.pauseGlyph}>
                        <View style={st.pauseBar} />
                        <View style={st.pauseBar} />
                      </View>
                    )}
                  {/* PAUSE, NOT STOP (hadar, 2026-09-02). "Stop recording" beside a
                      "Continue →" that ENDS the capture had the two words the wrong way
                      round: this is the reversible one, and the irreversible one was
                      wearing the gentler label. It pauses the microphone and starts it
                      again; nothing here ends anything. */}
                  <Text style={st.stopT}>
                    {paused ? T('cap.resumeRecording') : T('cap.pauseRecording')}
                  </Text>
                </Pressable>
              )}
              {/* "YOU DO NOT NEED TO HOLD A BUTTON" IS ANSWERING A QUESTION THIS
                  SCREEN NO LONGER RAISES (hadar, 2026-09-02: "remove the note").

                  It was written for a viewfinder, where the mic runs under a camera and
                  a contractor reasonably wonders whether it is listening. The recorder
                  says so itself now — a card titled "Voice recording", a moving wave, a
                  timer and his own words appearing underneath. Four pieces of evidence
                  make a fifth reassurance into clutter. It stays in camera mode, where
                  none of that is on screen. */}
              {/* THE HOLD-BUTTON REASSURANCE IS GONE FROM BOTH MODES (hadar, twice:
                  first from the recorder, now "remove the sentence you do not need to
                  hold the button from your voice is paused under the camera screen").
                  It answered a question about a hardware convention nobody has used in a
                  decade, on a card that already shows a live wave and a running clock. */}
            </View>
          ) : (
            // The collapsed strip: same information, one line, viewfinder free.
            //
            // TAPPABLE BOTH WAYS. Dismissing the big card is sticky, so without this the
            // only route back would be ending the recording — and pausing later would
            // leave a paused mic with no explanation anywhere on screen. Tapping the
            // strip restores the full card; the ✕ hides it again. He owns the state in
            // both directions and nothing reappears on its own.
            <Pressable style={[st.card, st.cardSlim]}
              onPress={() => setCardDismissed(false)}
              accessibilityRole="button"
              accessibilityLabel={T('cap.showCard')}>
              <View style={[st.micDot, paused && st.micDiscPaused]}>
                <Icon name={paused ? 'pause' : 'microphone'} size={18} color="#fff" />
              </View>
              {/* The wave needs a flexible BOX around it here: its own style is a fixed
                  height row, so as a direct child of this row it would size to zero. */}
              <View style={st.slimWave}><Wave level={level} active={recordingNow} /></View>
              <Text style={st.slimTime}>{two(Math.floor(secs / 60))}:{two(secs % 60)}</Text>
            </Pressable>
          )}

          {/* The live words, over the camera, while he talks. Rough by design and
              labelled so — it is never the stored transcript. `marginTop:'auto'` pins
              it to the bottom of the band without a magic offset. */}
          {/* WITH THE CAMERA OPEN this stays what it was: three read-only lines over a
              viewfinder, because there is nowhere to type and nothing to type on.
              With the camera CLOSED the same words become an editable field — the
              screen is a recorder, the words are the content, and a field he can fix is
              the whole point of showing them (hadar, 2026-09-02: "into an edit field
              that the user can read and edit"). */}
          {/* EDITING TAKES THE WHOLE SCREEN (hadar, 2026-09-02: "when I click to edit
              the text it should stretch to the top of the screen so I have access to the
              whole text and be able to edit it").

              Reading back ninety seconds of speech through a 190pt window, with a
              keyboard under it, is proofreading through a letterbox — and this is the
              text a client will read. On focus the card lifts out of the flow and fills
              the band, over the rail and the recording card, because while he is editing
              those are not what he is doing. It drops back the moment he is done.

              The recorder KEEPS RUNNING underneath. Editing is not an interruption, and
              a man who thinks of something else mid-correction should be able to say it. */}
          {!camOpen && (
            <View style={[st.draftBox, summaryFocused && st.draftBoxFull]}>
              <View style={st.draftHead}>
                <Text style={st.draftLabel}>{T('cap.draftSummary')}</Text>
                {/* "EDIT" IS A SIGNPOST; "DONE" IS A WAY OUT.
                    A box of text a machine wrote does not look touchable, so the label
                    invites the tap — but this is a MULTILINE field, where Return inserts
                    a newline and the keyboard has no close key of its own. hadar, 2026-09-02:
                    "if the keyboard has opened you cannot close it." The keyboard covered
                    Add photos and the primary, so opening it was a trap. Same slot, two
                    jobs, and only ever one of them on screen. */}
                {summaryFocused ? (
                  <Pressable onPress={() => Keyboard.dismiss()} hitSlop={10}
                    accessibilityRole="button" style={st.draftDone}>
                    <Text style={st.draftEditOn}>{T('cap.doneTyping')}</Text>
                  </Pressable>
                ) : (
                  <Text style={st.draftEdit}>{T('cap.editSummary')}</Text>
                )}
              </View>
              {/* IT SCROLLS RATHER THAN GROWS (hadar, 2026-09-02: "the draft field
                  needs to have a scroller so you can scroll down and read the text").

                  A minute of talking is a paragraph, and an unbounded multiline input
                  pushed the Add photos button and the primary off the bottom of the
                  screen — the longer he spoke, the less of the screen he could use.
                  `maxHeight` with `scrollEnabled` keeps the card a fixed object and
                  makes the text move inside it, which is also what lets him read back
                  the beginning of what he said. */}
              {/* A BAR THAT RIDES ON THE KEYBOARD ITSELF.
                  hadar, twice: "i still cannot close the keyboard once i am in the edit
                  field." My first attempt put Done in the card header — which the
                  keyboard covers on any screen where the card has scrolled up, so the
                  exit was behind the thing it was meant to escape. `InputAccessoryView`
                  is attached to the keyboard and rises with it, so it cannot be covered
                  by definition. iOS only; Android's back gesture already dismisses. */}
              {Platform.OS === 'ios' && (
                <InputAccessoryView nativeID={SUMMARY_ACCESSORY}>
                  <View style={st.kbBar}>
                    <Pressable onPress={() => Keyboard.dismiss()} hitSlop={10}
                      accessibilityRole="button" style={st.kbDone}>
                      <Text style={st.kbDoneT}>{T('cap.doneTyping')}</Text>
                    </Pressable>
                  </View>
                </InputAccessoryView>
              )}
              <TextInput
                style={[st.draftInput, summaryFocused && st.draftInputFull]}
                inputAccessoryViewID={Platform.OS === 'ios' ? SUMMARY_ACCESSORY : undefined}
                multiline
                scrollEnabled
                value={summary}
                onChangeText={(v: string) => { setSummary(v); summaryTouched.current = true; }}
                onFocus={() => setSummaryFocused(true)}
                onBlur={() => setSummaryFocused(false)}
                placeholder={T('cap.draftPlaceholder')}
                placeholderTextColor={C.disabled}
                textAlignVertical="top"
              />
            </View>
          )}
          {camOpen && liveText.length > 0 && (
            <View style={st.liveBox} pointerEvents="none">
              <Text style={st.liveLabel}>{T('r2.liveRough')}</Text>
              <Text style={st.liveText} numberOfLines={3}>{liveText}</Text>
            </View>
          )}
        </View>
      </View>

      {/* ---------- THE COACH STRIP (guided flow, step 3) ----------
           Sits directly above the controls, where his thumb already is, and only while
           the mic is live: before he starts it would compete with the reassurance card,
           and after he stops it is advice about a thing he has finished. Inert chips —
           tapping one would either interrupt the recording or navigate away from it, and
           both lose audio. They are a reminder, not a control. */}
      {!!coachPrompts?.length && recordingNow && (
        <View style={st.coachStrip}>
          <Text style={st.coachStripLab}>{T('cap.needHelp')}</Text>
          <View style={st.coachChips}>
            {coachPrompts.map((p) => (
              <View key={p.label} style={st.coachChip}>
                <Text style={st.coachChipT}>{p.label}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* ---------- ACTION PANEL ---------- */}
      <View style={st.panel}>
        {/* RECORDING MODE GETS ITS OWN CONTROLS, not the camera's three-across row.
            That row exists to put a shutter between two side buttons; with no lens it
            rendered an EMPTY BOX where the photo collection would be, a centred "Add
            photos", and a Pause off to the right — the layout hadar screenshotted and
            called not his design. Here the two things he can do get a full width each. */}
        {!camOpen ? (
          <View style={{ gap: 10 }}>
            <Pressable style={st.wideBtn} onPress={() => setCamOpen(true)} disabled={saving}
              accessibilityRole="button" accessibilityLabel={T('cap.addPhotos')}>
              <Icon name="camera" size={22} color={C.ink} />
              <Text style={st.wideBtnT}>{T('cap.addPhotos')}</Text>
              <Text style={st.wideBtnSub}>{T('cap.optional')}</Text>
              {shots.length > 0 && (
                <View style={st.countPill}><Text style={st.countPillT}>{shots.length}</Text></View>
              )}
            </Pressable>
            {/* The collection only when there IS one — an empty box was the placeholder
                that made the row look broken. */}
            {shots.length > 0 && (
              <Pressable style={st.wideBtn} onPress={() => setSheetOpen(true)} disabled={saving}>
                <Icon name="photo" size={22} color={C.ink} />
                <Text style={st.wideBtnT}>{T('cap.viewPhotos')}</Text>
              </Pressable>
            )}
          </View>
        ) : (
        <View style={st.actionRow}>
          {/* THE COLLECTION, once there is one. On a recording screen with no photos
              "View photos" is a control for a thing that does not exist; with the
              camera open it is how he checks what he has already got without leaving
              the lens. Shown whenever either is true, so a photo taken and then closed
              is still reachable from the recorder. */}
          {(camOpen || shots.length > 0) ? (
          <Pressable style={st.sideBtn} onPress={() => setSheetOpen(true)} disabled={saving}>
            <Icon name="photo" size={22} color={C.ink} />
            <View style={st.sideLabRow}>
              <Text style={st.sideLab}>{T('cap.viewPhotos')}</Text>
              {shots.length > 0 && (
                <View style={st.countPill}><Text style={st.countPillT}>{shots.length}</Text></View>
              )}
            </View>
          </Pressable>
          ) : <View style={st.sideBtn} />}

          {/* THE CENTRE BUTTON SUMMONS THE CAMERA BEFORE IT TAKES A PHOTO.
              Closed, it says "Add photos" and is marked optional — the honest label for
              a control on a screen whose job is a spoken decision. Open, it is the
              shutter it always was.
              ONE TAP TO GET THERE, not a mode buried behind a menu: the camera being
              optional must not make it hard, and mandate #3's budget counts every touch
              on a ladder. */}
          {camOpen ? (
            <Pressable style={st.shutter} onPress={snap} disabled={saving}>
              <View style={[st.shutterInner, recordingNow && st.shutterLive]}>
                <Icon name="camera" size={32} color="#fff" />
                <Text style={st.shutterT}>{T('cap.takePhoto')}</Text>
              </View>
            </Pressable>
          ) : (
            <Pressable style={st.shutter} onPress={() => setCamOpen(true)} disabled={saving}
              accessibilityRole="button" accessibilityLabel={T('cap.addPhotos')}>
              <View style={st.addPhotos}>
                <Icon name="camera" size={26} color={C.ink} />
                <Text style={st.addPhotosT}>{T('cap.addPhotos')}</Text>
                <Text style={st.addPhotosSub}>{T('cap.optional')}</Text>
              </View>
            </Pressable>
          )}

          {micOn ? (
            <Pressable style={st.sideBtn} onPress={togglePause} disabled={saving || interrupted}>
              <View style={st.sideDisc}>
                <Icon name={paused ? 'play' : 'pause'} size={18} color="#fff" />
              </View>
              <Text style={st.sideLab}>{paused ? T('cap.resumeVoice') : T('cap.pauseVoice')}</Text>
            </Pressable>
          ) : <View style={st.sideBtn} />}
        </View>
        )}

        {/* DONE sits at the very bottom of the panel now (hadar, 2026-07-27): the
            camera-hint card, the "this goes to …" line and the "saving on this phone"
            lock row were all removed to give the viewfinder more room, and Done is the
            last thing the thumb reaches. */}
        {/* Dimmed only when there is genuinely nothing: no photo, nothing said, and
            nothing typed. The button and the refusal above must agree. */}
        {/* THE PRIMARY MEANS DIFFERENT THINGS IN THE TWO MODES, and it must
            (hadar, 2026-09-02: "from the camera screen it should not be done
            explaining, it should take you back to the recorder page").

            The camera is a PANEL he opened for a photograph. Finishing the whole
            capture from inside it commits a change order from a screen whose subject is
            a lens — and it is the one button a thumb reaches without reading, so the
            mistake it invites is the expensive one. From the camera the primary goes
            BACK; from the recorder, where he can read what he said, it commits.

            RECORDING KEEPS RUNNING ACROSS THE HOP, so "back" costs him nothing and the
            two screens are one session rather than two steps. */}
        <Pressable style={[st.done,
          !camOpen && (!shots.length && !spoke && !(summaryTouched.current && summary.trim()))
            && st.doneDim]}
          onPress={() => { if (camOpen) setCamOpen(false); else void finish(); }}
          disabled={saving}>
          {saving ? <ActivityIndicator color="#fff" />
            : <Text style={st.doneT}>
                {camOpen ? T('cap.backToRecording') : T('cap.continueArrow')}
              </Text>}
        </Pressable>

        {/* THE WAY OUT, at the foot and quiet. Discarding a recording is not a thing to
            put a thumb's width from Continue, and it is not a thing to hide either — so
            it is findable, 44pt, and unmistakably the lesser of the two. */}
        {!camOpen && (
          <Pressable onPress={onClose} style={st.cancelLink} accessibilityRole="button">
            <Text style={st.cancelLinkT}>{T('cap.cancel')}</Text>
          </Pressable>
        )}
      </View>

      {/* ---------- PHOTO SHEET ---------- */}
      <Modal visible={sheetOpen} animationType="slide" transparent onRequestClose={closeSheet}>
        <View style={st.sheetWrap}>
          <View style={st.sheet}>
            <Text style={st.sheetTitle}>{T('cap.photosTitle')}</Text>
            {shots.length === 0 ? (
              <Text style={st.sheetEmpty}>{T('cap.noPhotosYet')}</Text>
            ) : (
              <ScrollView contentContainerStyle={st.sheetGrid} showsVerticalScrollIndicator={false}>
                {shots.map((sh, i) => (
                  <Pressable key={i} style={st.sheetCell} onPress={() => setZoom(sh.uri)}
                    accessibilityLabel={T('cap.viewPhotos')}>
                    <Image source={{ uri: sh.uri }} style={st.sheetThumb} />
                    {/* A library pick is labelled, because it is NOT stamped evidence
                        of this moment and the person reviewing it must be able to see
                        the difference without opening anything. */}
                    {sh.fromLibrary && (
                      <View style={st.sheetTag}><Text style={st.sheetTagT}>{T('cap.fromGalleryTag')}</Text></View>
                    )}
                    {/* REMOVE A SHOT BEFORE IT IS COMMITTED (hadar, 2026-09-02: "be able
                        to remove photos that were taken from the photos in this recording
                        list").

                        NOTHING IS BEING DESTROYED HERE, and that is what makes it a
                        simple ✕ rather than a confirmation. These are frames held in
                        memory for a capture that has not happened yet — a mis-framed
                        shot, a thumb over the lens, the same wall twice. Once Continue
                        is pressed they become committed evidence and mandate #1 takes
                        over; until then dropping one is the same act as not taking it.

                        A confirmation here would be the app treating a blurry photo as
                        gravely as a signed change order, which teaches him to tap past
                        the dialogs that do matter. */}
                    <Pressable style={st.sheetX} hitSlop={6}
                      onPress={() => setShots((prev) => prev.filter((_, n) => n !== i))}
                      accessibilityRole="button"
                      accessibilityLabel={T('cap.removePhoto')}>
                      <Icon name="close" size={15} color="#fff" />
                    </Pressable>
                  </Pressable>
                ))}
              </ScrollView>
            )}
            <Pressable style={st.sheetAdd} onPress={pickFromGallery}>
              <Icon name="photo" size={20} color={C.ink} />
              <Text style={st.sheetAddT}>{T('cap.addFromGallery')}</Text>
            </Pressable>
            <Pressable style={st.sheetClose} onPress={closeSheet}>
              <Text style={st.sheetCloseT}>{T('cap.closeSheet')}</Text>
            </Pressable>
          </View>

          {/* Photo viewer — tap a thumbnail to see it full-size. Same rules as the
              record screen's lightbox: closed by a GLOVE-SIZED bottom button, because
              a corner ✕ is exactly the target the field-UX numbers exist to forbid
              (hadar, 2026-07-23); tapping the photo itself closes too.
              Deliberately an in-sheet overlay rather than a nested <Modal> — a second
              Modal presented from inside this one is the flaky path on iOS, and an
              absolute fill inside a already-fullscreen transparent Modal covers exactly
              the same pixels with none of the risk. */}
          {zoom && (
            <View style={st.zoomWrap}>
              <Pressable style={st.zoomTap} onPress={() => setZoom(null)}>
                <Image source={{ uri: zoom }} style={st.zoomImg} resizeMode="contain" />
              </Pressable>
              <Pressable style={st.zoomClose} onPress={() => setZoom(null)}
                accessibilityLabel={T('common.close')}>
                <Text style={st.zoomCloseT}>{T('common.close')}</Text>
              </Pressable>
            </View>
          )}
        </View>
      </Modal>

      {/**
        * A QUIET BAR, NOT A SCREEN. It no longer has to be opaque — the bake view it
        * used to hide is off-screen now — so the last thing he sees before the job
        * picker is the walk he just took, dimmed, rather than a white page with a
        * spinner on it. The wait is the same; the flash is gone.
        */}
      {saving && (
        <View style={st.savingBar} pointerEvents="none">
          <ActivityIndicator color={C.card} />
          <Text style={st.savingBarT}>{T({ k: 'cap.savingN', p: { n: shots.length } })}</Text>
        </View>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.paper },
  fill: { ...StyleSheet.absoluteFillObject },
  center: { alignItems: 'center', justifyContent: 'center', padding: 28 },
  permMsg: { fontFamily: F.body, fontSize: 18, color: C.ink, textAlign: 'center',
    marginBottom: 22, lineHeight: 25 },
  permBtn: { paddingHorizontal: 40, alignSelf: 'stretch' },
  permLink: { paddingVertical: 16 },

  // ---- top bar ----
  topBar: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    paddingTop: 56, paddingBottom: 10, paddingHorizontal: 12, backgroundColor: C.paper, gap: 6 },
  topMid: { flex: 1, alignItems: 'center', paddingTop: 4 },
  // Field UX: ≥48px targets, icon + LABEL. Cards, not scrims — the chrome is light now.
  topRight: { flexDirection: 'row', gap: 6 },
  topBtn: { minWidth: 54, minHeight: 54, alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.card, borderColor: C.line, borderWidth: 1, borderRadius: radii.md,
    paddingHorizontal: 8, paddingVertical: 5 },
  topLab: { fontFamily: F.dispSemi, fontSize: 11, color: C.steel,
    textTransform: 'uppercase', letterSpacing: 0.9, marginTop: 2 },
  topLabOn: { color: C.caution },

  // ---- camera band ----
  band: { flex: 1, backgroundColor: '#000', overflow: 'hidden' },
  bandFlow: { ...StyleSheet.absoluteFillObject, padding: 14, gap: 12 },

  card: { backgroundColor: C.card, borderRadius: radii.lg, padding: 16, ...shadows.card },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  cardTopText: { flex: 1 },
  micDisc: { width: 64, height: 64, borderRadius: 32, backgroundColor: C.brand,
    alignItems: 'center', justifyContent: 'center' },
  micDiscPaused: { backgroundColor: C.steel },
  cardTitle: { fontFamily: F.bodyBold, fontSize: 25, color: C.ink, letterSpacing: -0.4 },
  cardBody: { fontFamily: F.body, fontSize: 16, color: C.ink, lineHeight: 22, marginTop: 12,
    textAlign: 'center' },

  // The dismiss control. Absolutely positioned so it does not reflow the card's
  // content, and 44pt of touch target (mandate #3) inside a much smaller glyph.
  cardClose: {
    position: 'absolute', top: 2, right: 2, width: 44, height: 44,
    alignItems: 'center', justifyContent: 'center', zIndex: 2,
  },
  cardCloseT: { fontFamily: 'Inter_600SemiBold', fontSize: 17, color: '#8A8F8B' },
  cardSlim: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  micDot: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.brand,
    alignItems: 'center', justifyContent: 'center' },
  slimWave: { flex: 1 },
  slimTime: { fontFamily: F.disp, fontSize: 17, color: C.ink, fontVariant: ['tabular-nums'] },

  cardAlarm: { backgroundColor: C.danger },
  alarmT: { fontFamily: F.bodyBold, fontSize: 18, color: '#fff' },
  alarmS: { fontFamily: F.body, fontSize: 15, color: '#FFE6E2', marginTop: 4 },
  cardWarn: { backgroundColor: C.caution },
  warnT: { fontFamily: F.bodyBold, fontSize: 16.5, color: C.ink, lineHeight: 23 },
  cardCoach: { backgroundColor: C.brand },
  coachT: { fontFamily: F.bodyBold, fontSize: 18, color: '#fff', lineHeight: 24 },
  coachEx: { fontFamily: F.body, fontSize: 15, color: C.brandSoft, lineHeight: 21, marginTop: 6 },

  wave: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 32, marginTop: 6 },
  waveBar: { flex: 1, borderRadius: 1.5, backgroundColor: C.brand },

  // LIFTED OFF THE BOTTOM EDGE (hadar, 2026-08-26: "it is too low and hidden under
  // the take came button"). `marginTop:'auto'` pins this to the bottom of the band,
  // and the shutter sits over that same edge — so the last line of what he had just
  // said was underneath the button he was pressing. The clearance is the fix; the
  // pinning is still right, because the words should track the bottom of the frame
  // rather than a fixed offset from the top.
  liveBox: { marginTop: 'auto', marginBottom: 20, backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: radii.sm, padding: 10 },
  liveLabel: { fontFamily: F.body, color: '#ffffff99', fontSize: 11, marginBottom: 2 },
  liveText: { fontFamily: F.body, color: '#fff', fontSize: 15, lineHeight: 20 },
  // The recording-mode summary. A CARD ON PAPER, not an overlay on a viewfinder: with
  // the camera closed this is the content of the screen, not an annotation on it.
  // Same footprint as the shutter it replaces, so the row does not jump when the camera
  // opens — the thumb keeps its target.
  // FULL WIDTH, ROW-SHAPED. The camera's controls are round targets in a three-across
  // row because a shutter must be reachable without looking; these are read before they
  // are pressed, so they are wide, labelled, and stacked.
  askTitle: { fontFamily: F.bodyBold, fontSize: 26, lineHeight: 30, color: C.ink,
    letterSpacing: -0.3 },
  askSub: { fontFamily: F.body, fontSize: 14.5, lineHeight: 20, color: C.steel, marginTop: 5 },
  // Brand-tinted, not the dark primary: stopping is routine and reversible, and a black
  // slab inside a card would outrank the Continue button at the bottom of the screen.
  stopBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    minHeight: 48, borderRadius: 12, backgroundColor: C.brandSoft, marginTop: 12 },
  // Sits ON the keyboard. Right-aligned because that is where iOS users look for Done,
  // and a full-width bar so the tap target is the whole right end rather than a word.
  kbBar: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center',
    backgroundColor: C.surfaceMuted, borderTopWidth: 1, borderTopColor: C.line,
    paddingHorizontal: 14, paddingVertical: 7 },
  kbDone: { minHeight: 34, justifyContent: 'center', paddingHorizontal: 14,
    borderRadius: 8, backgroundColor: C.brand },
  kbDoneT: { fontFamily: F.bodyBold, fontSize: 15, color: '#fff' },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  // Label weight, not heading weight: the wave and the timer carry the state; this names
  // it. Letterspaced small caps read as a caption rather than competing with the title
  // of the screen two lines above.
  cardTitleSm: { fontSize: 14.5, fontFamily: F.bodySemi, letterSpacing: 0.2 },
  // Square, icon-only, still 44pt of touch (mandate #3) without a labelled box.
  topX: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  cancelLink: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  cancelLinkT: { fontFamily: F.bodySemi, fontSize: 15, color: C.steel },
  waveRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  // Tabular-ish weight so the digits do not jitter the wave as they tick.
  cardClock: { fontFamily: F.bodyBold, fontSize: 16, color: C.ink,
    fontVariant: ['tabular-nums'] },
  pauseGlyph: { flexDirection: 'row', gap: 4 },
  pauseBar: { width: 4.5, height: 15, borderRadius: 1.5, backgroundColor: C.brand },
  stopT: { fontFamily: F.bodyBold, fontSize: 15.5, color: C.brandDark },
  draftEdit: { fontFamily: F.bodySemi, fontSize: 13.5, color: C.brand },
  // Bolder and boxed while typing: it is the only way off this keyboard, so it has to
  // read as a control rather than as the label it replaces. 44pt of touch via hitSlop.
  draftDone: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8,
    backgroundColor: C.brandSoft },
  draftEditOn: { fontFamily: F.bodyBold, fontSize: 13.5, color: C.brandDark },
  wideBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56,
    paddingHorizontal: 16, borderRadius: 14, borderWidth: 1, borderColor: C.line,
    backgroundColor: C.card },
  wideBtnT: { fontFamily: F.bodyBold, fontSize: 16, color: C.ink },
  wideBtnSub: { fontFamily: F.body, fontSize: 13.5, color: C.muted },
  addPhotos: { alignItems: 'center', justifyContent: 'center', gap: 2,
    borderWidth: 1.5, borderColor: C.line, borderRadius: 16, backgroundColor: C.card,
    paddingHorizontal: 18, paddingVertical: 12 },
  addPhotosT: { fontFamily: F.bodyBold, fontSize: 15, color: C.ink },
  addPhotosSub: { fontFamily: F.body, fontSize: 12, color: C.muted },
  // NO `marginTop: auto`. That pinned the summary to the bottom of a band sized for a
  // viewfinder and left half a screen of nothing between it and the recording card —
  // the gap in hadar's screenshot. It flows directly under what it summarises.
  // FLEX, NOT A FIXED CAP (hadar: "cap the height of the draft summary so it will not
  // hide under the add photos button"). A number that fits a 6.7" screen overflows a
  // 13 mini, and the band clips it — so the last lines of what he said disappear under
  // the panel with nothing to say they are there. Taking the remaining space instead
  // means the card ends exactly where the controls begin, on every handset.
  // `minHeight: 0` because a flex child in RN will not shrink below its content without
  // it, which is what lets the input scroll rather than push.
  // `minHeight: 0` let it collapse to nothing when the recording card was tall, and the
  // input's own minHeight then spilled its text OUT of the card — hadar's screenshot,
  // 2026-09-02: a hairline box with a sentence hanging below it. A floor of 150 keeps a
  // readable card; `flex: 1` still gives it everything left over when there is more.
  draftBox: { flex: 1, minHeight: 150, backgroundColor: C.card, borderRadius: 14,
    borderWidth: 1, borderColor: C.line, paddingHorizontal: 14, paddingTop: 12,
    paddingBottom: 10 },
  draftHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  draftLabel: { flex: 1, fontFamily: F.bodySemi, fontSize: 13.5, color: C.brand },
  // minHeight, not height: it grows with what he says rather than scrolling a field he
  // is trying to proofread.
  // maxHeight, not just minHeight: the card stays a fixed object on the screen and the
  // words move inside it. Without the cap a long recording pushed Add photos and the
  // primary button off the bottom.
  // Fills its card and scrolls inside it. No maxHeight: the CARD owns the height now,
  // and the field owning one too is how the two disagree.
  draftInput: { flex: 1, fontFamily: F.body, fontSize: 16, lineHeight: 22, color: C.ink,
    minHeight: 72, paddingTop: 2, paddingBottom: 6 },
  // FOCUSED: out of the flow and over everything, so the words get the screen. `flex: 1`
  // on the input rather than a taller maxHeight — the card is the height of the band and
  // the field should be the height of the card, whatever screen it lands on.
  draftBoxFull: { ...StyleSheet.absoluteFillObject, marginTop: 0 },
  draftInputFull: { flex: 1 },

  // The photo stamp keeps the dark treatment — it is burned onto a photograph.
  stamp: { position: 'absolute', left: 16, bottom: 40, backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  stampTime: { color: '#fff', fontFamily: F.disp, fontSize: 22 },
  stampWhere: { color: '#e6edf3', fontFamily: F.body, fontSize: 14, marginTop: 2 },

  // ---- action panel ----
  panel: { backgroundColor: C.paper, paddingHorizontal: 16, paddingBottom: 26 },
  actionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  sideBtn: { flex: 1, minHeight: 66, alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.card, borderColor: C.line, borderWidth: 1, borderRadius: radii.md,
    paddingVertical: 10, paddingHorizontal: 8, gap: 4 },
  sideDisc: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.brand,
    alignItems: 'center', justifyContent: 'center' },
  sideLabRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sideLab: { fontFamily: F.bodySemi, fontSize: 14, color: C.ink, textAlign: 'center' },
  countPill: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: C.brand,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  countPillT: { fontFamily: F.bodyBold, fontSize: 13, color: '#fff' },

  // The hero. Lifted over the panel edge exactly as drawn, and the biggest target
  // on the screen because it is the one a gloved hand hits without looking.
  // WHITE, not the app's cream. This is meant to read as a camera's frame blink, and
  // every camera anyone has used blinks white; a tinted one reads as a glitch.
  blink: { ...StyleSheet.absoluteFillObject, backgroundColor: '#fff' },
  shutter: { width: 118, height: 118, borderRadius: 59, backgroundColor: C.paper,
    alignItems: 'center', justifyContent: 'center', marginTop: -46 },
  shutterInner: { width: 106, height: 106, borderRadius: 53, backgroundColor: C.brand,
    alignItems: 'center', justifyContent: 'center', gap: 2 },
  shutterLive: { backgroundColor: C.brandDark },
  shutterT: { fontFamily: F.dispSemi, fontSize: 13, color: '#fff',
    textTransform: 'uppercase', letterSpacing: 0.9 },

  done: { minHeight: 66, borderRadius: radii.md, backgroundColor: C.brand,
    alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  doneDim: { opacity: 0.55 },
  doneT: { fontFamily: F.disp, fontSize: 24, color: '#fff',
    textTransform: 'uppercase', letterSpacing: 1.2 },

  // ---- photo sheet ----
  sheetWrap: { flex: 1, backgroundColor: 'rgba(21,26,30,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.paper, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl,
    padding: 18, paddingBottom: 30, maxHeight: '82%' },
  sheetTitle: { fontFamily: F.bodyBold, fontSize: 21, color: C.ink, letterSpacing: -0.3,
    marginBottom: 12 },
  sheetEmpty: { fontFamily: F.body, fontSize: 15.5, color: C.steel, lineHeight: 22,
    paddingVertical: 24, textAlign: 'center' },
  sheetGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 8 },
  // Top-right of the thumbnail, on a dark disc so it reads over any photograph. Small,
  // because it must not compete with the tap that opens the picture — and hitSlop gives
  // it the touch area the glyph does not.
  sheetX: { position: 'absolute', top: 5, right: 5, width: 24, height: 24, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(20,22,20,0.62)' },
  sheetCell: { width: 104, height: 104, borderRadius: radii.sm, overflow: 'hidden',
    backgroundColor: C.surfaceMuted },
  sheetThumb: { width: '100%', height: '100%' },
  sheetTag: { position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(21,26,30,0.72)', paddingVertical: 3, alignItems: 'center' },
  sheetTagT: { fontFamily: F.dispSemi, fontSize: 10, color: '#fff', letterSpacing: 0.8 },
  sheetAdd: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    minHeight: 58, borderRadius: radii.md, backgroundColor: C.card, borderWidth: 1,
    borderColor: C.line, marginTop: 12, paddingHorizontal: 12 },
  sheetAddT: { fontFamily: F.bodySemi, fontSize: 15.5, color: C.ink, flexShrink: 1 },
  sheetClose: { minHeight: 52, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  sheetCloseT: { fontFamily: F.bodySemi, fontSize: 16, color: C.steel },

  // The viewer goes near-black, not paper: a photo is judged against a neutral
  // surround, and the warm cream would tint every colour the person is checking.
  zoomWrap: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.94)' },
  zoomTap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  zoomImg: { width: '100%', height: '100%' },
  zoomClose: { position: 'absolute', left: 18, right: 18, bottom: 34, minHeight: 64,
    borderRadius: 14, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  zoomCloseT: { fontFamily: F.dispSemi, fontSize: 17, letterSpacing: 1.2,
    textTransform: 'uppercase', color: C.ink },

  savingBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0, paddingBottom: 34,
    paddingTop: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, backgroundColor: 'rgba(23,22,21,0.86)',
  },
  savingBarT: { fontFamily: F.bodySemi, fontSize: 16, color: C.card },
  // ── the guided flow's prompt strip ──
  coachStrip: { position: 'absolute', left: 0, right: 0, bottom: 208,
    paddingHorizontal: 16 },
  coachStripLab: { fontFamily: 'Inter_700Bold', fontSize: 12, color: '#fff',
    marginBottom: 8, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
  coachChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  coachChip: { backgroundColor: 'rgba(20,18,16,0.62)', borderRadius: 999,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)',
    paddingVertical: 7, paddingHorizontal: 12 },
  coachChipT: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: '#fff' },
});
