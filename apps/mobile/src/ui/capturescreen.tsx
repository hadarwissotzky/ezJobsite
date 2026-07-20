/**
 * The ONE capture screen — REQ-CAP-FUSED. The goal of this screen is to capture a
 * CHANGE ORDER: walk the site, talk, snap photos along the way, tap Done. Everything
 * else is in service of that.
 *
 * What it must survive (the user's spec, 2026-07-20):
 *  - DISRUPTION. Pause/resume as a first-class control, and a phone call stealing the
 *    microphone must not destroy the walk: recording rolls into a new SEGMENT and the
 *    audio continues after the call. Segments commit as one pair, ordered.
 *  - SILENCE. A user who taps the button and says nothing produces nothing. The screen
 *    coaches ("say what you found…"), warns when it has heard nothing, and refuses a
 *    Done with no speech and no photos — refusing loudly beats saving emptiness.
 *  - EVIDENCE. Photos snap without stopping audio, each carrying its own timestamp so
 *    it can later be tied to the sentence being spoken (the transcript segments). A
 *    thumbnail strip confirms what was taken. Gallery picks are allowed but are NEVER
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
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { readRecordingBytes, requestMic, RecordingPresets, useAudioRecorder, useAudioRecorderState } from '../recorder';
import { stampNow, type Stamp } from '../stamp';
import { t as T } from '../i18n';

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
 */
function StampBlock({ place, now }: { place: string | null; now: number }) {
  return (
    <View style={st.stamp}>
      <Text style={st.stampTime}>{clockLine(now)}</Text>
      <Text style={st.stampWhere}>📍 {place ?? T('cap.noLoc')}</Text>
    </View>
  );
}

type Shot = { uri: string; atMs: number; fromLibrary: boolean };

export function FusedCapture({
  projectName, onCapture, onClose, resolveLabel,
}: {
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
  const [job, setJob] = React.useState<string | null>(null);
  const [now, setNow] = React.useState(Date.now());
  const [micOn, setMicOn] = React.useState(false);
  const [facing, setFacing] = React.useState<CameraType>('back');
  const [flash, setFlash] = React.useState<'off' | 'on'>('off');
  const [shots, setShots] = React.useState<Shot[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [paused, setPaused] = React.useState(false);        // user tapped pause
  const [interrupted, setInterrupted] = React.useState(false); // something ELSE stopped us
  const [warnEmpty, setWarnEmpty] = React.useState(false);
  const [bakeShot, setBakeShot] = React.useState<Shot | null>(null);
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

  React.useEffect(() => {
    if (!perm) return;
    if (!perm.granted) { requestPerm(); return; }
    let live = true;
    (async () => {
      const fix = await stampNow();
      setStamp(fix);
      resolveLabel(fix)
        .then((r) => { if (live) { setPlace(r.place); setJob(r.job); } })
        .catch(() => { /* unresolved stays honest */ });
      if (await requestMic()) {
        try {
          await recorder.prepareToRecordAsync();
          segmentStartedAt.current = Date.now();
          recorder.record();
          if (live) setMicOn(true);
        } catch { /* mic optional: photos-only is still a capture */ }
      }
    })();
    return () => { live = false; try { recorder.stop(); } catch { /* noop */ } };
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

  if (!perm) return <View style={st.c} />;
  if (!perm.granted) {
    return (
      <View style={[st.c, st.center]}>
        <Text style={st.msg}>{T('cap.needCamera')}</Text>
        <Pressable style={st.btn} onPress={requestPerm}><Text style={st.btnT}>{T('cap.allowCamera')}</Text></Pressable>
        <Pressable style={st.link} onPress={onClose}><Text style={st.linkT}>{T('terms.later')}</Text></Pressable>
      </View>
    );
  }

  const secs = baseSecs.current + Math.floor((recState.durationMillis ?? lastDurMs.current) / 1000);
  const level = recState.metering == null ? 0 : Math.max(0, Math.min(1, (recState.metering + 60) / 55));
  const recordingNow = micOn && recState.isRecording && !paused;
  // Coach the user who tapped and went quiet: nothing has been heard, nothing snapped.
  const coach = micOn && !spoke && !paused && !interrupted && shots.length === 0 && secs >= 3;

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
    try {
      const atMs = Date.now();
      const pic = await camRef.current?.takePictureAsync({ quality: 0.8 });
      if (pic?.uri) { setShots((s) => [...s, { uri: pic.uri, atMs, fromLibrary: false }]); setWarnEmpty(false); }
    } catch { /* a dropped frame must not end the walk */ }
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
      setWarnEmpty(false);
    } catch { /* picker failure must not end the walk */ }
  };

  const bakeOne = (shot: Shot): Promise<Uint8Array> =>
    new Promise((resolve) => {
      bakeResolve.current = async () => {
        bakeResolve.current = null;
        try {
          const uri = await captureRef(bakeRef, { format: 'jpg', quality: 0.9, result: 'tmpfile' });
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
    if (!shots.length && !spokeRef.current) { setWarnEmpty(true); return; }
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
      });
    } finally { setSaving(false); }
  };

  return (
    <View style={st.c}>
      <CameraView ref={camRef} style={st.fill} facing={facing} flash={flash} />

      {bakeShot && (
        <View ref={bakeRef} collapsable={false} style={[st.fill, st.baker]}>
          <Image source={{ uri: bakeShot.uri }} style={st.fill} resizeMode="cover"
            onLoad={() => bakeResolve.current?.()} />
          <StampBlock place={place} now={bakeShot.atMs} />
        </View>
      )}

      <View style={st.topBar}>
        <Pressable onPress={onClose} hitSlop={16} style={st.topBtn}>
          <Text style={st.topIcon}>✕</Text>
        </Pressable>
        <Text style={st.project} numberOfLines={1}>{job ?? projectName}</Text>
        {/* Flip + flash: labelled, ≥48px, on scrims — visible over any scene. */}
        <View style={st.topRight}>
          <Pressable onPress={() => setFlash((f) => (f === 'off' ? 'on' : 'off'))} style={st.topBtn}>
            <Text style={st.topIcon}>{flash === 'on' ? '⚡' : '⚡'}</Text>
            <Text style={[st.topLab, flash === 'on' && st.topLabOn]}>
              {flash === 'on' ? T('cap.flashOn') : T('cap.flashOff')}
            </Text>
          </Pressable>
          <Pressable onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))} style={st.topBtn}>
            <Text style={st.topIcon}>🔄</Text>
            <Text style={st.topLab}>{T('cap.flip')}</Text>
          </Pressable>
        </View>
      </View>

      {/* Coaching: first-open instructions until the first snap or first heard speech. */}
      {shots.length === 0 && !spoke && !coach && !interrupted && (
        <View style={st.remind}>
          <Text style={st.remindTitle}>{T('cap.remindTitle')}</Text>
          <Text style={st.remindLine}>✓ {T('cap.remind1')}</Text>
          <Text style={st.remindLine}>✓ {T('cap.remind2')}</Text>
          <Text style={st.remindLine}>✓ {T('cap.remind3')}</Text>
          <Text style={st.remindLine}>✓ {T('cap.remind4')}</Text>
        </View>
      )}
      {coach && (
        <View style={[st.remind, st.coach]}>
          <Text style={st.coachT}>🎙 {T('cap.sayWhat')}</Text>
          <Text style={st.coachEx}>{T('cap.sayWhatEx')}</Text>
        </View>
      )}
      {interrupted && (
        <Pressable style={[st.remind, st.interruptBox]} onPress={resumeAfterInterruption}>
          <Text style={st.interruptT}>📞 {T('cap.interrupted')}</Text>
          <Text style={st.interruptS}>{T('cap.tapToResume')}</Text>
        </Pressable>
      )}
      {warnEmpty && (
        <View style={[st.remind, st.warnBox]}>
          <Text style={st.warnT}>{T('cap.nothingYet')}</Text>
        </View>
      )}

      {/* THE state indicator. A camcorder-red REC pill, blinking, with the running
          time — visible from arm's length in sun. Grey PAUSED when paused. */}
      {micOn && !interrupted && (
        <View style={[st.recPill, paused && st.recPillPaused]}>
          <View style={[st.recPillDot, (paused || now % 2000 < 1000) && st.recPillDotDim]} />
          <Text style={st.recPillT}>
            {paused ? T('cap.pause').toUpperCase() : 'REC'} {two(Math.floor(secs / 60))}:{two(secs % 60)}
          </Text>
        </View>
      )}

      <StampBlock place={place} now={now} />

      {micOn && (
        <View style={st.meterRow}>
          <View style={[st.recDot, (paused || interrupted) && st.recDotOff]} />
          <View style={st.meterTrack}>
            <View style={[st.meterFill, { width: `${Math.round(level * 100)}%` }]} />
          </View>
          <Text style={st.timer}>{two(Math.floor(secs / 60))}:{two(secs % 60)}</Text>
          {shots.length > 0 && <Text style={st.count}>📸 {shots.length}</Text>}
        </View>
      )}

      {/* What has been taken so far — visible proof, not a hidden counter. */}
      {shots.length > 0 && (
        <ScrollView horizontal style={st.thumbRow} contentContainerStyle={{ gap: 6 }}
          showsHorizontalScrollIndicator={false}>
          {shots.map((sh, i) => (
            <Image key={i} source={{ uri: sh.uri }} style={st.thumb} />
          ))}
        </ScrollView>
      )}

      <View style={st.bottom}>
        <Text style={st.hint}>
          {saving ? '' :
            interrupted ? T('cap.tapToResume') :
            paused ? T('cap.pausedHint') :
            shots.length === 0 ? (micOn ? T('cap.talkWalk') : T('cap.tapSnap'))
              : T({ k: 'cap.keepGoing', p: { n: shots.length } })}
        </Text>
        <View style={st.shutterRow}>
          <View style={st.sideCol}>
            <Pressable style={st.sideBtn} onPress={pickFromGallery} disabled={saving}>
              <Text style={st.sideIcon}>🖼</Text>
              <Text style={st.sideLab}>{T('cap.gallery')}</Text>
            </Pressable>
            {micOn && (
              <Pressable style={st.sideBtn} onPress={togglePause} disabled={saving || interrupted}>
                <Text style={st.sideIcon}>{paused ? '▶️' : '⏸'}</Text>
                <Text style={st.sideLab}>{paused ? T('cap.resume') : T('cap.pause')}</Text>
              </Pressable>
            )}
          </View>
          <Pressable style={st.shutterOuter} onPress={snap} disabled={saving}>
            <View style={[st.shutterInner, recordingNow && st.shutterRec]} />
          </Pressable>
          <View style={st.sideCol}>
            <Pressable
              style={[st.done, (!shots.length && !spoke) && st.doneDim]}
              onPress={finish} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={st.doneT}>{T('cap.done')}</Text>}
            </Pressable>
          </View>
        </View>
      </View>

      {saving && (
        <View style={st.savingOverlay}>
          <ActivityIndicator color="#fff" size="large" />
          <Text style={st.savingT}>{T({ k: 'cap.savingN', p: { n: shots.length } })}</Text>
        </View>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  c: { flex: 1, backgroundColor: '#000' },
  fill: { ...StyleSheet.absoluteFillObject },
  baker: { opacity: 0.01 },
  center: { alignItems: 'center', justifyContent: 'center', padding: 28 },
  msg: { color: '#fff', fontSize: 18, textAlign: 'center', marginBottom: 22, lineHeight: 25 },
  btn: { backgroundColor: '#FF5A00', borderRadius: 12, paddingVertical: 18, paddingHorizontal: 40 },
  btnT: { color: '#fff', fontFamily: 'BarlowCondensed_700Bold', fontSize: 19, textTransform: 'uppercase', letterSpacing: 1 },
  link: { paddingVertical: 16 }, linkT: { color: '#adbac7', fontSize: 15 },

  topBar: { position: 'absolute', top: 52, left: 12, right: 12, flexDirection: 'row',
    alignItems: 'flex-start', justifyContent: 'space-between' },
  topRight: { flexDirection: 'row', gap: 8 },
  // Field UX: ≥48px targets, icon + LABEL, on a scrim so they read over any scene.
  topBtn: { minWidth: 52, minHeight: 52, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 5 },
  topIcon: { fontSize: 20, color: '#fff' },
  topLab: { fontFamily: 'BarlowCondensed_600SemiBold', fontSize: 10.5, color: '#D7DBDF',
    textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 1 },
  topLabOn: { color: '#F5B000' },
  project: { color: '#fff', fontFamily: 'Barlow_600SemiBold', fontSize: 15, flex: 1,
    textAlign: 'center', marginHorizontal: 8, marginTop: 14 },

  remind: { position: 'absolute', top: 118, left: 20, right: 20,
    backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 12, padding: 14 },
  remindTitle: { color: '#fff', fontFamily: 'Barlow_700Bold', fontSize: 15, marginBottom: 6 },
  remindLine: { color: '#e6edf3', fontFamily: 'Barlow_400Regular', fontSize: 14, lineHeight: 22 },
  coach: { backgroundColor: 'rgba(255,90,0,0.92)' },
  coachT: { color: '#fff', fontFamily: 'Barlow_700Bold', fontSize: 17, lineHeight: 23 },
  coachEx: { color: '#FFE3D2', fontFamily: 'Barlow_400Regular', fontSize: 14, lineHeight: 20, marginTop: 6 },
  interruptBox: { backgroundColor: 'rgba(198,40,28,0.94)' },
  interruptT: { color: '#fff', fontFamily: 'Barlow_700Bold', fontSize: 16 },
  interruptS: { color: '#FFD9D4', fontFamily: 'Barlow_400Regular', fontSize: 14, marginTop: 4 },
  warnBox: { backgroundColor: 'rgba(245,176,0,0.95)' },
  warnT: { color: '#0D0F12', fontFamily: 'Barlow_700Bold', fontSize: 15, lineHeight: 21 },

  stamp: { position: 'absolute', left: 16, bottom: 236, backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  stampTime: { color: '#fff', fontFamily: 'BarlowCondensed_700Bold', fontSize: 22 },
  stampWhere: { color: '#e6edf3', fontFamily: 'Barlow_400Regular', fontSize: 14, marginTop: 2 },

  recPill: { position: 'absolute', top: 112, alignSelf: 'center', flexDirection: 'row',
    alignItems: 'center', backgroundColor: '#C6281C', borderRadius: 999,
    paddingHorizontal: 14, paddingVertical: 7 },
  recPillPaused: { backgroundColor: 'rgba(0,0,0,0.55)' },
  recPillDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#fff', marginRight: 8 },
  recPillDotDim: { opacity: 0.25 },
  recPillT: { color: '#fff', fontFamily: 'BarlowCondensed_700Bold', fontSize: 17, letterSpacing: 1.5 },
  meterRow: { position: 'absolute', left: 16, right: 16, bottom: 208, flexDirection: 'row', alignItems: 'center' },
  recDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#C6281C', marginRight: 10 },
  recDotOff: { backgroundColor: '#5C6570' },
  meterTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.25)', overflow: 'hidden' },
  meterFill: { height: 6, borderRadius: 3, backgroundColor: '#3fb950' },
  timer: { color: '#fff', fontFamily: 'BarlowCondensed_700Bold', fontSize: 16, marginLeft: 10 },
  count: { color: '#fff', fontFamily: 'BarlowCondensed_700Bold', fontSize: 15, marginLeft: 8 },

  thumbRow: { position: 'absolute', left: 16, right: 16, bottom: 148, maxHeight: 52 },
  thumb: { width: 52, height: 52, borderRadius: 8, borderWidth: 2, borderColor: 'rgba(255,255,255,0.85)' },

  bottom: { position: 'absolute', left: 0, right: 0, bottom: 36, alignItems: 'center' },
  hint: { color: '#fff', fontFamily: 'Barlow_600SemiBold', fontSize: 14, marginBottom: 12, textAlign: 'center' },
  shutterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    width: '100%', paddingHorizontal: 26 },
  sideCol: { width: 96, gap: 8, alignItems: 'center' },
  sideBtn: { minWidth: 92, minHeight: 50, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 12, paddingVertical: 5 },
  sideIcon: { fontSize: 19, color: '#fff' },
  sideLab: { fontFamily: 'BarlowCondensed_600SemiBold', fontSize: 11, color: '#D7DBDF',
    textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 1 },
  shutterOuter: { width: 82, height: 82, borderRadius: 41, borderWidth: 5, borderColor: '#fff',
    alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: '#fff' },
  shutterRec: { backgroundColor: '#FF5A00' },
  done: { width: 96, backgroundColor: '#0E8A4C', borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  doneDim: { opacity: 0.55 },
  doneT: { color: '#fff', fontFamily: 'BarlowCondensed_700Bold', fontSize: 17,
    textTransform: 'uppercase', letterSpacing: 1 },
  savingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center', justifyContent: 'center' },
  savingT: { color: '#fff', fontFamily: 'Barlow_600SemiBold', fontSize: 17, marginTop: 16 },
});
