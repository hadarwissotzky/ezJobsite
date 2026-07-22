/**
 * PRD R7 — the quick-add job card. Three fields, one button.
 *
 * This replaces a project SETUP SCREEN (name + address + a typeahead + a
 * "use my location" button + an explanatory paragraph), which R7 says outright
 * must not exist. What is left is the smallest thing that can produce a job and
 * the person who approves its extras: client name, phone, job label.
 *
 * WHY THE ADDRESS FIELD IS GONE and the job is not worse off: resolution runs on
 * lat/lng, never on the typed string (projects.ts `resolveProject` reads
 * `p.lat/p.lng` only), and the pin comes from where he is standing — for free,
 * without a keyboard. The address string was display text bought with three
 * screens of typing. It is still filled in when the OS hands it over.
 *
 * All copy goes through t(). No English in this file.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';

import { t as T } from '../i18n';
import { stampNow } from '../stamp';
import { C, F } from './theme';
import { validateQuickAdd, type QuickAddErrors } from '../quickadd';
import { quickAddJob } from '../quickaddjob';

export function QuickAddJob({
  db, ownerId, lat, lng, address, onCreated, onCancel,
}: {
  db: AbstractPowerSyncDatabase;
  ownerId: string;
  lat?: number | null;
  lng?: number | null;
  /** Reverse-geocoded, when the OS gave us one. Never asked for. */
  address?: string | null;
  /** The caller owns what happens next — filing captures, navigating, refreshing. */
  onCreated: (projectId: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [clientName, setClientName] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [jobLabel, setJobLabel] = React.useState('');
  // Errors appear only after a submit attempt. Marking a field invalid before the
  // user has finished typing it is how a form starts shouting at someone who is
  // doing nothing wrong.
  const [errs, setErrs] = React.useState<QuickAddErrors | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState<string | null>(null);

  const create = async () => {
    const bad = validateQuickAdd({ clientName, phone, jobLabel });
    setErrs(bad);
    if (Object.keys(bad).length) return;
    setBusy(true);
    setFailed(null);
    try {
      // PIN IT TO HERE when the caller did not already have a fix. This is what
      // makes later captures file themselves (projects.ts resolves on lat/lng and
      // never on the address text), and it costs the user nothing — he is standing
      // on the job as he creates it. stampNow never blocks longer than its own
      // timeout and returns nulls rather than failing, so no-GPS still creates the
      // job; it just will not auto-resolve.
      let pinLat = lat ?? null;
      let pinLng = lng ?? null;
      if (pinLat == null || pinLng == null) {
        const st = await stampNow();
        pinLat = pinLat ?? st.lat;
        pinLng = pinLng ?? st.lng;
      }
      // NO NETWORK ON THIS PATH. createProject writes locally and PowerSync carries
      // the row up whenever there is a connection, so a job can be created in a
      // basement (mandate #7). Nothing here waits on a server.
      const r = await quickAddJob(db, {
        ownerId, clientName, phone, jobLabel, lat: pinLat, lng: pinLng, address,
      });
      if (!r.ok) {
        setFailed(typeof r.reason === 'string' ? r.reason : T(r.reason));
        return;
      }
      await onCreated(r.projectId);
    } finally {
      setBusy(false);
    }
  };

  const field = (
    key: keyof QuickAddErrors, value: string, onChange: (v: string) => void,
    labelKey: string, placeholderKey: string, extra?: object
  ) => (
    <View style={s.field}>
      <Text style={s.label}>{T(labelKey)}</Text>
      <TextInput
        style={[s.input, errs?.[key] && s.inputBad]}
        value={value}
        onChangeText={(v) => { onChange(v); if (errs) setErrs(null); }}
        placeholder={T(placeholderKey)}
        placeholderTextColor="#8c959f"
        {...extra}
      />
      {errs?.[key] && <Text style={s.err}>{T(errs[key] as string)}</Text>}
    </View>
  );

  const ready = clientName.trim().length > 0 && jobLabel.trim().length > 0;

  return (
    <View style={s.card}>
      {/* Reuses the existing key rather than minting a second "New job" string:
          two keys for one word is two things to keep translated in step. */}
      <Text style={s.head}>{T('job.newTitle')}</Text>

      {field('clientName', clientName, setClientName,
        'quick.clientLabel', 'quick.clientHint', { autoFocus: true })}
      {field('phone', phone, setPhone,
        'quick.phoneLabel', 'quick.phoneHint', { keyboardType: 'phone-pad' })}
      {field('jobLabel', jobLabel, setJobLabel,
        'quick.jobLabel', 'quick.jobHint')}

      {/* Show the composed name back before it exists. This string becomes the job's
          identity everywhere, including the frozen text the client signs, so it is
          read once here rather than discovered later on a legal document. */}
      {ready && (
        <Text style={s.preview}>
          {T({ k: 'quick.willBeCalled', p: { name: `${clientName.trim()} — ${jobLabel.trim()}` } })}
        </Text>
      )}

      {failed && <Text style={s.err}>{failed}</Text>}

      <Pressable
        style={[s.create, (!ready || busy) && s.off]}
        disabled={!ready || busy}
        accessibilityLabel={T('quick.create')}
        onPress={create}>
        <Text style={s.createT}>{T(busy ? 'quick.creating' : 'quick.create')}</Text>
      </Pressable>
      <Pressable style={s.cancel} onPress={onCancel}>
        <Text style={s.cancelT}>{T('common.cancel')}</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: C.card, borderColor: C.line, borderWidth: 1,
    borderRadius: 16, padding: 16, marginBottom: 10,
  },
  head: {
    fontFamily: F.disp, fontSize: 22, color: C.ink,
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14,
  },
  field: { marginBottom: 12 },
  label: {
    fontFamily: F.dispSemi, fontSize: 12, color: C.steel,
    textTransform: 'uppercase', letterSpacing: 1.6, marginBottom: 5,
  },
  input: {
    backgroundColor: '#fff', borderColor: C.line, borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 14,
    fontFamily: F.body, fontSize: 17, color: C.ink,
  },
  inputBad: { borderColor: C.danger, borderWidth: 1.5 },
  err: { fontFamily: F.body, fontSize: 13, color: C.danger, marginTop: 5 },
  preview: { fontFamily: F.body, fontSize: 13, color: C.steel, marginBottom: 12 },
  // 58px is the gloves floor used everywhere else in this app.
  create: {
    backgroundColor: C.ink, borderRadius: 14, minHeight: 58,
    alignItems: 'center', justifyContent: 'center', marginTop: 4,
  },
  off: { opacity: 0.4 },
  createT: {
    fontFamily: F.disp, fontSize: 19, color: '#fff',
    textTransform: 'uppercase', letterSpacing: 1,
  },
  cancel: { paddingVertical: 14, alignItems: 'center' },
  cancelT: {
    fontFamily: F.dispSemi, fontSize: 15, color: C.steel,
    textTransform: 'uppercase', letterSpacing: 1,
  },
});
