/**
 * Address input with assist — good UX wherever an address is typed. A normal text
 * field PLUS: debounced typeahead suggestions (OSM/Nominatim, keyless) and a
 * "use my location" button (OS reverse-geocode). Picking either fills the address
 * AND the lat/lng, so the job is pinned for the static map + GPS resolution.
 *
 * Offline-forward (mandate #7): no network → no suggestions and no location, but the
 * plain field still works. Assist is an enhancement, never a gate.
 */
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { addressFromHere, type AddressHit, suggestAddresses } from '../geocode';
import { t as T } from '../i18n';

export function AddressInput({
  value, onChangeText, onPick, placeholder,
}: {
  value: string;
  onChangeText: (v: string) => void;
  onPick: (h: AddressHit) => void;
  placeholder?: string;
}) {
  const [hits, setHits] = React.useState<AddressHit[]>([]);
  const [open, setOpen] = React.useState(false);
  const [locating, setLocating] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const picked = React.useRef(false);   // suppress the suggest fired by a programmatic set

  const onType = (v: string) => {
    onChangeText(v);
    if (picked.current) { picked.current = false; return; }
    if (timer.current) clearTimeout(timer.current);
    if (v.trim().length < 3) { setHits([]); setOpen(false); return; }
    // Debounce — Nominatim asks for ≤1 req/s.
    timer.current = setTimeout(async () => {
      const r = await suggestAddresses(v);
      setHits(r); setOpen(r.length > 0);
    }, 450);
  };

  const choose = (h: AddressHit) => {
    picked.current = true;
    onChangeText(h.label);
    onPick(h);
    setOpen(false); setHits([]);
  };

  const useHere = async () => {
    setLocating(true);
    try {
      const h = await addressFromHere();
      if (h) choose(h);
    } finally {
      setLocating(false);
    }
  };

  return (
    <View>
      <TextInput
        style={st.input}
        value={value}
        onChangeText={onType}
        placeholder={placeholder ?? T('job.address')}
        placeholderTextColor="#8c959f"
        autoCapitalize="words"
      />
      <Pressable style={st.hereBtn} onPress={useHere} disabled={locating}>
        {locating ? <ActivityIndicator color="#0969da" />
          : <Text style={st.hereT}>📍 {T('addr.useLocation')}</Text>}
      </Pressable>
      {open && (
        <View style={st.list}>
          {hits.map((h, i) => (
            <Pressable key={i} style={[st.row, i < hits.length - 1 && st.rowDivider]} onPress={() => choose(h)}>
              <Text style={st.rowT} numberOfLines={2}>{h.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  input: {
    backgroundColor: '#fff', borderColor: '#d0d7de', borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 14, fontSize: 17, color: '#1f2328',
  },
  hereBtn: { alignSelf: 'flex-start', paddingVertical: 10, paddingHorizontal: 2 },
  hereT: { color: '#0969da', fontSize: 15, fontWeight: '700' },
  list: { backgroundColor: '#fff', borderColor: '#d0d7de', borderWidth: 1, borderRadius: 10,
    marginTop: 2, overflow: 'hidden' },
  row: { paddingHorizontal: 14, paddingVertical: 13 },
  rowDivider: { borderBottomColor: '#eaeef2', borderBottomWidth: 1 },
  rowT: { color: '#1f2328', fontSize: 15 },
});
