/**
 * The ONE capture screen — REQ-CAP-FUSED. Consolidates image + voice onto a single
 * surface (the user's directive, matching their E-Z Smart Recorder + Timemark refs):
 * a live camera you can snap MULTIPLE times while ONE continuous voice narration runs.
 * The whole walk is ONE jobsite decision moment ("the atomic unit is the decision
 * moment, not the photo") — "here's the kitchen… [snap]… water heater's cracked,
 * four-fifty… [snap]".
 *
 * On one screen: live preview · flip · flash · a running timer + audio level ("speak
 * louder" when too quiet) · a Timemark-style GPS/time stamp BAKED onto each photo ·
 * and the "remember to mention" coaching from the estimate recorder.
 *
 * Durability stays in capture.ts: this screen only produces BYTES (N baked photos +
 * one audio clip) + a stamp. App.tsx commits the group and fires "saved" ONLY after
 * ALL commit (mandate #1). A partial group is never acknowledged.
 */
import { CameraView, useCameraPermissions, type CameraType } from 'expo-camera';
import React from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { readRecordingBytes, requestMic, RecordingPresets, useAudioRecorder, useAudioRecorderState } from '../recorder';
import { stampNow, type Stamp } from '../stamp';
import { t as T } from '../i18n';

export type FusedPhoto = { bytes: Uint8Array; mime: string; atMs: number };
export type FusedArtifacts = {
  photos: FusedPhoto[];
  audioBytes: Uint8Array | null; audioMime: string;
  stamp: Stamp;
};

function two(n: number) { return n < 10 ? '0' + n : '' + n; }
function clockLine(ms: number): string {
  const d = new Date(ms);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${two(d.getHours())}:${two(d.getMinutes())} · ${days[d.getDay()]} ${mon[d.getMonth()]} ${d.getDate()}`;
}

/**
 * The stamp burned onto every photo. NEVER shows raw coordinates: "37.76543, -122.45678"
 * is unreadable to the person holding the phone and worthless as evidence to a client
 * later. It shows a resolved PLACE — the street address, or the job we're standing on —
 * and says so honestly when neither could be resolved (offline, no fix).
 */
function StampBlock({ place, now }: { place: string | null; now: number }) {
  return (
    <View style={st.stamp}>
      <Text style={st.stampTime}>{clockLine(now)}</Text>
      <Text style={st.stampWhere}>📍 {place ?? T('cap.noLoc')}</Text>
    </View>
  );
}

export function FusedCapture({
  projectName, onCapture, onClose, resolveLabel,
}: {
  projectName: string;
  onCapture: (a: FusedArtifacts) => Promise<void>;
  onClose: () => void;
  /**
   * Turn a fix into words a person can check. Returns the street address (best
   * evidence) and/or the job we resolved to (best context). Owned by App, which has
   * the database; this screen never sees a coordinate it would be tempted to print.
   */
  resolveLabel: (s: Stamp) => Promise<{ place: string | null; job: string | null }>;
}) {
  const [perm, requestPerm] = useCameraPermissions();
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const recState = useAudioRecorderState(recorder);
  const camRef = React.useRef<CameraView>(null);
  const bakeRef = React.useRef<View>(null);

  const [stamp, setStamp] = React.useState<Stamp | null>(null);
  // Resolved from the fix: `place` is what gets burned onto the photo (address, else
  // the job); `job` is shown live so the user knows where this will file.
  const [place, setPlace] = React.useState<string | null>(null);
  const [job, setJob] = React.useState<string | null>(null);
  const [now, setNow] = React.useState(Date.now());
  const [micOn, setMicOn] = React.useState(false);
  const [facing, setFacing] = React.useState<CameraType>('back');
  const [flash, setFlash] = React.useState<'off' | 'on'>('off');
  const [shots, setShots] = React.useState<{ uri: string; atMs: number }[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [bakeShot, setBakeShot] = React.useState<{ uri: string; atMs: number } | null>(null);
  const bakeResolve = React.useRef<(() => void) | null>(null);

  React.useEffect(() => {
    if (!perm) return;
    if (!perm.granted) { requestPerm(); return; }
    let live = true;
    (async () => {
      const fix = await stampNow();
      setStamp(fix);
      // Resolve the fix into words BEFORE the shutter, so the stamp is ready to bake and
      // the user can see which job this will file to while they are still framing.
      resolveLabel(fix)
        .then((r) => { if (live) { setPlace(r.place); setJob(r.job); } })
        .catch(() => { /* unresolved stays honest: the stamp says so */ });
      if (await requestMic()) {
        try {
          await recorder.prepareToRecordAsync();
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

  const secs = Math.floor((recState.durationMillis ?? 0) / 1000);
  // metering is dBFS (~-60 silence .. 0 loud). Map to a 0..1 bar; warn if too quiet.
  const level = recState.metering == null ? 0 : Math.max(0, Math.min(1, (recState.metering + 60) / 55));
  const tooQuiet = micOn && recState.metering != null && recState.metering < -42 && secs >= 1;

  const snap = async () => {
    try {
      const atMs = Date.now();
      const pic = await camRef.current?.takePictureAsync({ quality: 0.8 });
      if (pic?.uri) setShots((s) => [...s, { uri: pic.uri, atMs }]);
    } catch { /* a dropped frame must not end the walk */ }
  };

  const bakeOne = (shot: { uri: string; atMs: number }): Promise<Uint8Array> =>
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
    if (saving || (!shots.length && !micOn)) return;   // voice-only is allowed (photos optional)
    setSaving(true);
    try { await recorder.stop(); } catch { /* noop */ }
    try {
      const photos: FusedPhoto[] = [];
      for (const shot of shots) {
        photos.push({ bytes: await bakeOne(shot), mime: 'image/jpeg', atMs: shot.atMs });
      }
      let audioBytes: Uint8Array | null = null;
      if (micOn && recorder.uri) {
        try { audioBytes = await readRecordingBytes(recorder.uri); } catch { audioBytes = null; }
      }
      await onCapture({
        photos, audioBytes, audioMime: 'audio/m4a',
        stamp: stamp ?? { capturedAtMs: Date.now(), lat: null, lng: null,
          accuracyM: null, fixAgeMs: null, status: 'unavailable' },
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
        <Pressable onPress={onClose} hitSlop={16}><Text style={st.icon}>✕</Text></Pressable>
        <Text style={st.project} numberOfLines={1}>{job ?? projectName}</Text>
        <View style={st.topRight}>
          <Pressable onPress={() => setFlash((f) => (f === 'off' ? 'on' : 'off'))} hitSlop={12}>
            <Text style={st.icon}>{flash === 'on' ? '⚡' : '🚫'}</Text>
          </Pressable>
          <Pressable onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))} hitSlop={12}>
            <Text style={st.icon}>🔄</Text>
          </Pressable>
        </View>
      </View>

      {/* "Remember to mention" coaching (E-Z Smart Recorder) — until the first snap. */}
      {shots.length === 0 && (
        <View style={st.remind}>
          <Text style={st.remindTitle}>{T('cap.remindTitle')}</Text>
          <Text style={st.remindLine}>✓ {T('cap.remind1')}</Text>
          <Text style={st.remindLine}>✓ {T('cap.remind2')}</Text>
          <Text style={st.remindLine}>✓ {T('cap.remind3')}</Text>
          <Text style={st.remindLine}>✓ {T('cap.remind4')}</Text>
        </View>
      )}

      <StampBlock place={place} now={now} />

      {micOn && (
        <View style={st.meterRow}>
          <View style={st.recDot} />
          <View style={st.meterTrack}>
            <View style={[st.meterFill, { width: `${Math.round(level * 100)}%` },
              tooQuiet && st.meterLow]} />
          </View>
          <Text style={st.timer}>{two(Math.floor(secs / 60))}:{two(secs % 60)}</Text>
          {shots.length > 0 && <Text style={st.count}>📸 {shots.length}</Text>}
        </View>
      )}
      {tooQuiet && <Text style={st.louder}>⚠️ {T('cap.speakLouder')}</Text>}

      <View style={st.bottom}>
        <Text style={st.hint}>
          {shots.length === 0
            ? (micOn ? T('cap.talkWalk') : T('cap.tapSnap'))
            : T({ k: 'cap.keepGoing', p: { n: shots.length } })}
        </Text>
        <View style={st.shutterRow}>
          <View style={st.side} />
          <Pressable style={st.shutterOuter} onPress={snap} disabled={saving}>
            <View style={st.shutterInner} />
          </Pressable>
          {(shots.length > 0 || micOn) ? (
            <Pressable style={st.done} onPress={finish} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={st.doneT}>{T('cap.done')}</Text>}
            </Pressable>
          ) : <View style={st.side} />}
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
  btn: { backgroundColor: '#0969da', borderRadius: 12, paddingVertical: 16, paddingHorizontal: 40 },
  btnT: { color: '#fff', fontSize: 18, fontWeight: '800' },
  link: { paddingVertical: 16 }, linkT: { color: '#adbac7', fontSize: 15 },
  topBar: { position: 'absolute', top: 56, left: 16, right: 16, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'space-between' },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  icon: { color: '#fff', fontSize: 22, fontWeight: '600' },
  project: { color: '#fff', fontSize: 16, fontWeight: '700', flex: 1, textAlign: 'center', marginHorizontal: 8 },
  remind: { position: 'absolute', top: 108, left: 20, right: 20, backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 12, padding: 14 },
  remindTitle: { color: '#fff', fontSize: 15, fontWeight: '800', marginBottom: 6 },
  remindLine: { color: '#e6edf3', fontSize: 14, lineHeight: 22 },
  stamp: { position: 'absolute', left: 16, bottom: 205, backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  stampTime: { color: '#fff', fontSize: 22, fontWeight: '800' },
  stampWhere: { color: '#e6edf3', fontSize: 14, marginTop: 2 },
  meterRow: { position: 'absolute', left: 16, right: 16, bottom: 172, flexDirection: 'row', alignItems: 'center' },
  recDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#cf222e', marginRight: 10 },
  meterTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.25)', overflow: 'hidden' },
  meterFill: { height: 6, borderRadius: 3, backgroundColor: '#3fb950' },
  meterLow: { backgroundColor: '#d29922' },
  timer: { color: '#fff', fontSize: 15, fontWeight: '700', marginLeft: 10 },
  count: { color: '#fff', fontSize: 15, fontWeight: '700', marginLeft: 8 },
  louder: { position: 'absolute', bottom: 150, alignSelf: 'center', color: '#d29922',
    fontSize: 15, fontWeight: '800' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 40, alignItems: 'center' },
  hint: { color: '#fff', fontSize: 15, marginBottom: 14, fontWeight: '600', textAlign: 'center' },
  shutterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    width: '100%', paddingHorizontal: 36 },
  side: { width: 92 },
  shutterOuter: { width: 78, height: 78, borderRadius: 39, borderWidth: 5, borderColor: '#fff',
    alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#fff' },
  done: { width: 92, backgroundColor: '#1f883d', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  doneT: { color: '#fff', fontSize: 17, fontWeight: '800' },
  savingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center', justifyContent: 'center' },
  savingT: { color: '#fff', fontSize: 17, fontWeight: '700', marginTop: 16 },
});
