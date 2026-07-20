/**
 * First-open intro — 4 slides, shown once to a logged-out newcomer before sign-in.
 *
 * Its only job is to set expectations for someone who was handed this app and has
 * never seen it: what it does, and that it works the way their day works (talk,
 * snap, no signal). No account, no data, no permissions here -- that all comes
 * later, at the moment each makes sense. Text is short and paired with one big
 * glyph, because the core user does not read screens, they glance at them.
 */
import React from 'react';
import { Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { t as T } from '../i18n';

const { width } = Dimensions.get('window');

type Slide = { icon: string; title: string; body: string };
const SLIDES: Slide[] = [
  { icon: '🎙️', title: 'ob.1t', body: 'ob.1b' },
  { icon: '🧾', title: 'ob.2t', body: 'ob.2b' },
  { icon: '📶', title: 'ob.3t', body: 'ob.3b' },
  { icon: '🤝', title: 'ob.4t', body: 'ob.4b' },
];

export function Onboarding({ onDone }: { onDone: () => void }) {
  const ref = React.useRef<ScrollView>(null);
  const [i, setI] = React.useState(0);
  const last = i === SLIDES.length - 1;

  const go = (n: number) => {
    if (n >= SLIDES.length) { onDone(); return; }
    ref.current?.scrollTo({ x: width * n, animated: true });
    setI(n);
  };

  return (
    <View style={st.c}>
      <ScrollView
        ref={ref}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setI(Math.round(e.nativeEvent.contentOffset.x / width))}
      >
        {SLIDES.map((sl) => (
          <View key={sl.title} style={[st.slide, { width }]}>
            <Text style={st.icon}>{sl.icon}</Text>
            <Text style={st.title}>{T(sl.title)}</Text>
            <Text style={st.body}>{T(sl.body)}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={st.dots}>
        {SLIDES.map((_, d) => (
          <View key={d} style={[st.dot, d === i && st.dotOn]} />
        ))}
      </View>

      <Pressable style={st.next} onPress={() => go(i + 1)}>
        <Text style={st.nextT}>{last ? T('ob.start') : T('ob.next')}</Text>
      </Pressable>
      {!last && (
        <Pressable style={st.skip} onPress={onDone}>
          <Text style={st.skipT}>{T('ob.skip')}</Text>
        </Pressable>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  c: { flex: 1, backgroundColor: '#ffffff', paddingBottom: 40, paddingTop: 60 },
  slide: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, flex: 1 },
  icon: { fontSize: 96, marginBottom: 28 },
  title: { fontSize: 26, fontWeight: '800', color: '#0D0F12', textAlign: 'center', marginBottom: 14 },
  body: { fontSize: 17, lineHeight: 25, color: '#5C6570', textAlign: 'center' },
  dots: { flexDirection: 'row', justifyContent: 'center', marginBottom: 22 },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#E4E5E1', marginHorizontal: 5 },
  dotOn: { backgroundColor: '#FF5A00', width: 22 },
  next: { marginHorizontal: 24, backgroundColor: '#FF5A00', borderRadius: 14, paddingVertical: 18, alignItems: 'center' },
  nextT: { color: '#fff', fontSize: 18, fontWeight: '800' },
  skip: { alignItems: 'center', paddingVertical: 14 },
  skipT: { color: '#5C6570', fontSize: 15, fontWeight: '600' },
});
