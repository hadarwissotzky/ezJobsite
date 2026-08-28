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
import { ActivityIndicator, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { addressFromHere, type AddressHit, suggestAddresses } from '../geocode';
import { t as T } from '../i18n';
import { Icon } from './icon';

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
      {/* THE BUTTON LIVES IN THE FIELD (hadar, 2026-08-27: "use my local need to be a
          more notisable button can add it inside the edit box to the right").

          It was a bare green text link UNDER the field with about 20pt of tap area —
          the least noticeable thing on a form whose hardest question it answers. A
          contractor standing on the job should not be typing an address he is
          currently stood at, so this is the fast path and it now looks like one.

          THE BORDER MOVED to the wrapper. The field and the button share one outline,
          which is what makes the button read as part of the input rather than a
          control that happens to sit near it. */}
      <View style={st.field}>
        <TextInput
          style={st.input}
          value={value}
          onChangeText={onType}
          placeholder={placeholder ?? T('job.address')}
          placeholderTextColor="#8c959f"
          autoCapitalize="words"
          // A labelled way OUT of the keyboard (hadar 2026-08-12: "it doesn't retract").
          // The default return key on a one-line field reads as a newline, so nobody
          // presses it; "Done" says what it does. Blurring also closes the suggestion
          // list, which is the other thing covering the form.
          returnKeyType="done"
          onSubmitEditing={() => { setOpen(false); Keyboard.dismiss(); }}
        />
        <Pressable style={st.hereBtn} onPress={useHere} disabled={locating}
          accessibilityRole="button" accessibilityLabel={T('addr.useLocation')}
          hitSlop={8}>
          {locating ? <ActivityIndicator color="#fff" size="small" />
            : (
              <>
                {/* The real pin, not the 📍 emoji it used to draw: an emoji renders in
                    the system font at a size we do not control and cannot be recoloured
                    to sit on a filled button. */}
                <Icon name="mapPin" size={15} color="#fff" />
                {/* THE LABEL GOES WHEN THE FIELD FILLS. Worded out it is ~154pt in
                    English and ~169 in Spanish, which leaves under 200pt of a 390pt
                    screen to read an address in — and the first thing this button does
                    is put an address there. So: labelled while the field is empty,
                    where it has to be found; a bare pin once there is something to
                    read, where it only has to be recognised. */}
                {!value.trim() && (
                  <Text style={st.hereT} numberOfLines={1}>{T('addr.useLocation')}</Text>
                )}
              </>
            )}
        </Pressable>
      </View>
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
  // The outline is HERE now, not on the TextInput — one box holding the field and its
  // button, so the two read as one control.
  field: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderColor: '#D5D0C7', borderWidth: 1, borderRadius: 10,
    paddingRight: 6,
  },
  // `minWidth: 0` matters: without it a long value refuses to shrink and pushes the
  // button off the right edge instead of scrolling inside the field.
  input: {
    flex: 1, minWidth: 0,
    paddingHorizontal: 14, paddingVertical: 14, fontSize: 17, color: '#151A1E',
  },
  // FILLED, not a link. 44pt tall inside a ~52pt field, plus hitSlop — the old link
  // was about 20pt of target for the one control that saves the most typing.
  hereBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0,
    minHeight: 44, paddingHorizontal: 12, borderRadius: 8, backgroundColor: '#4E6243',
  },
  hereT: { color: '#fff', fontSize: 14, fontWeight: '700' },
  list: { backgroundColor: '#fff', borderColor: '#D5D0C7', borderWidth: 1, borderRadius: 10,
    marginTop: 2, overflow: 'hidden' },
  row: { paddingHorizontal: 14, paddingVertical: 13 },
  rowDivider: { borderBottomColor: '#D5D0C7', borderBottomWidth: 1 },
  rowT: { color: '#151A1E', fontSize: 15 },
});
