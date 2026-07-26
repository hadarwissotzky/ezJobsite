/**
 * R1 — the "Send to" field on the preview card.
 *
 * PRD R1: "if one known project is within range, 'Send to' is pre-filled with a
 * visible '📍 Detected — you're at the [name] job' marker; if two or more are
 * within range, a picker is shown; if none, recents. The suggestion is always one
 * tap to override, and Send always displays the recipient name."
 *
 * WHY THE MARKER IS NOT DECORATION. A pre-filled recipient that does not say
 * where it came from is indistinguishable from a recipient the contractor chose,
 * and mandate #2 turns on that difference: a field a human read and tapped past
 * is a confirmation, a field they never noticed is an automated send. So the
 * marker is rendered next to the name, always, and the reason line under it is
 * the routing's own words rather than a generic "suggested".
 *
 * THE COMPONENT NEVER PICKS. Everything it shows comes from `sendToPrefill()`,
 * and when that returns `selectedId: null` — two jobs in range, or nothing in
 * range — this renders a list with no highlighted row. There is no "default to
 * the first option" anywhere below, because that would put the duplex decision
 * back into the code that the pure module deliberately refuses to make.
 */
import React from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { t } from '../i18n';
import { canSend, displayPhone, type SendToPrefill, type SendToProject } from '../sendto';
import { C, F, T as TT, display, label } from './theme';

function distanceLabel(m: number | null): string {
  if (m == null) return '';
  return m < 950 ? t({ k: 'r1.sendto.metres', p: { n: m } })
                 : t({ k: 'r1.sendto.km', p: { n: (m / 1000).toFixed(1) } });
}

export function SendToCard({
  prefill, value, onChange, onQuickAdd,
}: {
  prefill: SendToPrefill;
  /** The project actually selected. Null until a human picks, whenever the
   *  prefill declined to have an opinion. */
  value: string | null;
  onChange: (project: SendToProject) => void;
  /** Returns a problem key on failure so the message stays translatable. `quotaBlocked`
   *  means a free-tier cap fired and its own modal is showing — don't render a form error. */
  onQuickAdd: (o: { name: string; phone: string }) => Promise<{ ok: boolean; problemKey?: string; quotaBlocked?: boolean }>;
}) {
  // Open by default whenever nothing is selected: the picker IS the question in
  // that case, and hiding it behind "Change" would make the two-in-range AC take
  // two taps instead of one.
  const [open, setOpen] = React.useState(value == null);
  const [adding, setAdding] = React.useState(false);
  const [name, setName] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [problem, setProblem] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const selected = prefill.options.find((o) => o.id === value) ?? null;
  const detected = prefill.kind === 'detected' && value != null && value === prefill.selectedId;

  const submitQuickAdd = async () => {
    setSaving(true);
    try {
      const r = await onQuickAdd({ name, phone });
      // A free-tier cap fired: its modal is already up, so clear any stale error and
      // leave the form as-is (the user can dismiss and pick an existing job).
      if (r.quotaBlocked) { setProblem(null); return; }
      if (!r.ok) { setProblem(r.problemKey ?? 'r1.quickadd.badPhone'); return; }
      setAdding(false); setOpen(false); setName(''); setPhone(''); setProblem(null);
    } finally { setSaving(false); }
  };

  return (
    <View style={[TT.card, { padding: 14, gap: 10 }]}>
      <Text style={label}>{t('r1.sendto.label')}</Text>

      {selected ? (
        <View style={{ gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Text style={display(21)} numberOfLines={1}>{selected.name}</Text>
            {detected && (
              <View style={{ backgroundColor: '#EAF4EE', borderRadius: 999,
                             paddingHorizontal: 9, paddingVertical: 3 }}>
                <Text style={{ fontFamily: F.dispSemi, fontSize: 11, color: C.approve,
                               textTransform: 'uppercase', letterSpacing: 1.2 }}>
                  📍 {t('r1.sendto.detectedBadge')}
                </Text>
              </View>
            )}
          </View>
          {detected && (
            <Text style={{ fontFamily: F.body, fontSize: 14, color: C.steel }}>
              {t({ k: prefill.reasonKey, p: prefill.reasonParams as any })}
            </Text>
          )}
          {/* Send always displays the recipient — and says plainly when there is
              nobody to send TO. A job with no number produces a link that goes
              nowhere, and finding that out at Send time explains nothing. */}
          <Text style={{ fontFamily: F.body, fontSize: 14,
                         color: canSend(selected.phoneE164) ? C.steel : C.danger }}>
            {canSend(selected.phoneE164)
              ? displayPhone(selected.phoneE164)
              : t('r1.sendto.noPhone')}
          </Text>
        </View>
      ) : (
        <Text style={{ fontFamily: F.bodySemi, fontSize: 15, color: C.ink, lineHeight: 21 }}>
          {t({ k: prefill.reasonKey, p: prefill.reasonParams as any })}
        </Text>
      )}

      {selected && !open && (
        <Pressable onPress={() => setOpen(true)} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={{ fontFamily: F.bodySemi, fontSize: 15, color: C.orange }}>
            {t('r1.sendto.change')}
          </Text>
        </Pressable>
      )}

      {open && (
        <View style={{ gap: 8 }}>
          {prefill.options.map((o) => {
            const isSel = o.id === value;
            return (
              <Pressable
                key={o.id}
                accessibilityRole="button"
                onPress={() => { onChange(o); setOpen(false); }}
                style={{ minHeight: 54, borderRadius: 12, borderWidth: isSel ? 2 : 1,
                         borderColor: isSel ? C.orange : C.line, paddingHorizontal: 12,
                         flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 16, color: C.ink }} numberOfLines={1}>
                    {o.name}
                  </Text>
                  <Text style={{ fontFamily: F.body, fontSize: 13, color: C.steel }} numberOfLines={1}>
                    {o.distanceM != null ? `📍 ${distanceLabel(o.distanceM)}` : displayPhone(o.phoneE164)}
                  </Text>
                </View>
                <Text style={{ fontSize: 20, color: C.steel }}>›</Text>
              </Pressable>
            );
          })}

          {!adding ? (
            <Pressable onPress={() => setAdding(true)}
              style={{ minHeight: 50, alignItems: 'center', justifyContent: 'center',
                       borderRadius: 12, borderWidth: 1, borderColor: C.line, borderStyle: 'dashed' }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 15, color: C.ink }}>
                ＋ {t('r1.sendto.quickAdd')}
              </Text>
            </Pressable>
          ) : (
            <View style={{ gap: 8 }}>
              <TextInput
                value={name} onChangeText={(v) => { setName(v); setProblem(null); }}
                placeholder={t('r1.quickadd.namePh')} placeholderTextColor={C.steel}
                style={{ borderWidth: 1, borderColor: C.line, borderRadius: 12, minHeight: 50,
                         paddingHorizontal: 12, fontFamily: F.body, fontSize: 16, color: C.ink }} />
              <TextInput
                value={phone} onChangeText={(v) => { setPhone(v); setProblem(null); }}
                placeholder={t('r1.quickadd.phonePh')} placeholderTextColor={C.steel}
                keyboardType="phone-pad"
                style={{ borderWidth: 1, borderColor: C.line, borderRadius: 12, minHeight: 50,
                         paddingHorizontal: 12, fontFamily: F.body, fontSize: 16, color: C.ink }} />
              {problem && (
                <Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: C.danger }}>
                  {t(problem)}
                </Text>
              )}
              <Pressable disabled={saving} onPress={submitQuickAdd}
                style={{ minHeight: 52, borderRadius: 12, backgroundColor: C.ink,
                         alignItems: 'center', justifyContent: 'center', opacity: saving ? 0.6 : 1 }}>
                <Text style={[display(16), { color: '#fff' }]}>{t('r1.quickadd.save')}</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}
    </View>
  );
}
