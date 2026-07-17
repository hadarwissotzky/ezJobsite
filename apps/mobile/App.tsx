import '@azure/core-asynciterator-polyfill';
import 'react-native-get-random-values';

import { OPSqliteOpenFactory } from '@powersync/op-sqlite';
import { PowerSyncDatabase } from '@powersync/react-native';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppSchema } from './src/AppSchema';
import { SupabaseConnector } from './src/connector';
import {
  applyDurabilityProfile,
  assertDurabilityProfile,
  ensureAppOwnedSchema,
  listCommittedCaptures,
  performCapture,
  recoverySweep,
} from './src/capture';
import { RecordingPresets, readRecordingBytes, requestMic, useAudioRecorder } from './src/recorder';
import { textCapture, voiceCapture } from './src/modality';

export const db = new PowerSyncDatabase({
  schema: AppSchema,
  // op-sqlite passed EXPLICITLY. The bare { dbFilename } form does not
  // auto-detect it and falls back to quick-sqlite, which throws at runtime.
  database: new OPSqliteOpenFactory({ dbFilename: 'ezjobsite.db' }),
});

const connector = new SupabaseConnector();

/**
 * The three states a capture can be in, from the user's point of view.
 * "Saved" is the ONLY one that makes a promise, and it is only ever shown
 * after the local commit returns.
 */
type UiState =
  | { k: 'idle' }
  | { k: 'arming' }
  | { k: 'recording' }
  | { k: 'saving' }
  | { k: 'saved'; id: string }
  | { k: 'refused'; why: string };

export default function App() {
  const [ui, setUi] = React.useState<UiState>({ k: 'idle' });
  const [ready, setReady] = React.useState(false);
  const [gate, setGate] = React.useState<string | null>(null);
  const [initError, setInitError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState<any[]>([]);
  const [note, setNote] = React.useState('');
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const refresh = React.useCallback(async () => {
    try { setSaved(await listCommittedCaptures(db)); } catch { /* pre-init */ }
  }, []);

  React.useEffect(() => {
    (async () => {
     try {
      await db.init();
      await applyDurabilityProfile(db);
      await ensureAppOwnedSchema(db);

      // THE GATE. If the write connection cannot promise durability we do not
      // arm the recorder at all. Refusing loudly beats saying "saved" and lying.
      const prof = await assertDurabilityProfile(db);
      if (!prof.ok) {
        setGate(prof.writeReport.filter((r: any) => !r.ok).map((r: any) => `${r.name}=${r.got}`).join(', '));
      }

      // Recovery runs before anything else can be recorded.
      const rec = await recoverySweep(db);
      if (rec.integrityErrors.length) {
        console.warn('captures with unreadable media:', rec.integrityErrors);
      }

      try {
        await connector.login('device1@example.com', 'bakeoff-spike-pw-2026');
        db.connect(connector);
      } catch (e) {
        // Offline is normal and is NOT an error. Capture must work regardless.
        console.log('not signed in / offline — capture still works', e);
      }
      await refresh();
      setReady(true);
     } catch (e: any) {
       // A failure here means we cannot promise a save. Say so, loudly, with the
       // reason -- never sit on "Starting..." forever. Silent init failure is the
       // same sin as a silent save failure.
       console.log('INIT FAILED:', e?.message ?? String(e), e?.stack);
       setInitError(e?.message ?? String(e));
       setReady(true);
     }
    })();
  }, [refresh]);

  const onPress = async () => {
    if (gate) return;
    if (ui.k === 'idle' || ui.k === 'saved' || ui.k === 'refused') {
      setUi({ k: 'arming' });
      if (!(await requestMic())) { setUi({ k: 'refused', why: 'microphone permission denied' }); return; }
      await recorder.prepareToRecordAsync();
      recorder.record();
      setUi({ k: 'recording' });
      return;
    }
    if (ui.k === 'recording') {
      setUi({ k: 'saving' });
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) { setUi({ k: 'refused', why: 'recorder produced no file' }); return; }

      const bytes = await readRecordingBytes(uri);
      const r = await performCapture(db, {
        ownerId: 'owner-local', projectId: 'proj-bakeoff-1',
        input: voiceCapture(bytes),
      });
      if (r.ok) setUi({ k: 'saved', id: r.captureId });
      else setUi({ k: 'refused', why: r.reason });
      await refresh();
    }
  };

  // REQ-CAP2 text capture. Same commit path, different producer.
  const onSaveNote = async () => {
    if (gate || !note.trim()) return;
    setUi({ k: 'saving' });
    try {
      const r = await performCapture(db, {
        ownerId: 'owner-local', projectId: 'proj-bakeoff-1',
        input: textCapture(note),
      });
      if (r.ok) { setUi({ k: 'saved', id: r.captureId }); setNote(''); }
      else setUi({ k: 'refused', why: r.reason });
      await refresh();
    } catch (e: any) {
      setUi({ k: 'refused', why: e?.message ?? String(e) });
    }
  };

  const label =
    gate ? 'UNAVAILABLE' :
    ui.k === 'recording' ? 'STOP' :
    ui.k === 'saving' ? 'SAVING…' :
    ui.k === 'arming' ? '…' : 'RECORD';

  return (
    <View style={s.c}>
      <Text style={s.h}>EZjobsite</Text>

      {(gate || initError) && (
        <View style={s.gate}>
          <Text style={s.gateT}>{initError ? 'EZjobsite couldn’t start safely' : 'Can’t record safely on this device'}</Text>
          <Text style={s.gateS}>
            The database can’t guarantee a save would survive. Rather than tell you
            something is saved and lose it, recording is off.
          </Text>
          <Text style={s.mono}>{gate ?? initError}</Text>
        </View>
      )}

      <Pressable
        onPress={onPress}
        disabled={!ready || !!gate || !!initError || ui.k === 'saving' || ui.k === 'arming'}
        style={[s.btn, ui.k === 'recording' && s.btnRec, (!!gate || !!initError || !ready) && s.btnOff]}
      >
        <Text style={s.btnT}>{label}</Text>
      </Pressable>

      <Text style={s.state}>
        {ui.k === 'saved' ? 'Saved on this phone ✓ — not backed up yet'
          : ui.k === 'refused' ? `Not saved: ${ui.why}`
          : ui.k === 'recording' ? 'Recording…'
          : ui.k === 'saving' ? 'Finishing…'
          : ready ? 'Ready' : 'Starting…'}
      </Text>

      <Text style={s.sub}>Or type it</Text>
      <View style={s.noteRow}>
        <TextInput
          style={s.input}
          value={note}
          onChangeText={setNote}
          placeholder="What was decided?"
          placeholderTextColor="#6e7681"
          multiline
          editable={!gate && ui.k !== 'saving'}
        />
        <Pressable
          onPress={onSaveNote}
          disabled={!!gate || !note.trim() || ui.k === 'saving'}
          style={[s.save, (!note.trim() || !!gate) && s.btnOff]}
        >
          <Text style={s.saveT}>SAVE</Text>
        </Pressable>
      </View>

      <Text style={s.sub}>Saved on this phone ({saved.length})</Text>
      <ScrollView style={{ flex: 1 }}>
        {saved.slice().reverse().map((c) => (
          <View key={c.capture_id} style={s.row}>
            <Text style={s.rowT}>{c.capture_id}</Text>
            <Text style={s.rowS}>{c.modality} · {(c.media_bytes / 1024).toFixed(1)} KB · {c.media_sha256.slice(0, 12)}…</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  c: { flex: 1, paddingTop: 72, paddingHorizontal: 20, backgroundColor: '#0b0b0c' },
  h: { color: '#7ee787', fontSize: 26, fontWeight: '800', marginBottom: 18 },
  btn: { backgroundColor: '#238636', paddingVertical: 28, borderRadius: 18, alignItems: 'center' },
  btnRec: { backgroundColor: '#da3633' },
  btnOff: { backgroundColor: '#30363d' },
  btnT: { color: '#fff', fontSize: 24, fontWeight: '800', letterSpacing: 1 },
  state: { color: '#c9d1d9', fontSize: 15, marginTop: 14, marginBottom: 22, textAlign: 'center' },
  sub: { color: '#8b949e', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  row: { borderTopWidth: 1, borderTopColor: '#21262d', paddingVertical: 10 },
  rowT: { color: '#c9d1d9', fontSize: 13, fontFamily: 'Menlo' },
  rowS: { color: '#6e7681', fontSize: 11, fontFamily: 'Menlo', marginTop: 2 },
  noteRow: { flexDirection: 'row', gap: 8, marginBottom: 22 },
  input: { flex: 1, backgroundColor: '#161b22', borderColor: '#30363d', borderWidth: 1,
           borderRadius: 10, color: '#c9d1d9', padding: 12, minHeight: 54, fontSize: 15 },
  save: { backgroundColor: '#1f6feb', borderRadius: 10, paddingHorizontal: 18, justifyContent: 'center' },
  saveT: { color: '#fff', fontWeight: '800', letterSpacing: 1 },
  gate: { backgroundColor: '#3d1d1d', borderColor: '#da3633', borderWidth: 1, borderRadius: 10, padding: 14, marginBottom: 18 },
  gateT: { color: '#ff7b72', fontWeight: '700', marginBottom: 6 },
  gateS: { color: '#c9d1d9', fontSize: 13, lineHeight: 18 },
  mono: { color: '#8b949e', fontFamily: 'Menlo', fontSize: 10, marginTop: 8 },
});
