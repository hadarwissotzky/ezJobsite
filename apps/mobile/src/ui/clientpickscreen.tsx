/**
 * WHO IS THIS FOR — asked once, right after the job, on a NEW extra.
 *
 * hadar, 2026-08-23, stating the intended flow of a new change order: "... select
 * location (choose) -> popup to select owner -> preview CO". This is that popup, and it
 * was the one step of the sequence that did not exist.
 *
 * ─── WHY IT EARNS AN INTERRUPTION ───────────────────────────────────────────────
 * The client was previously asked for at SEND time, and on a device whose account has no
 * roster that is the worst possible moment to discover it: the contractor has written the
 * scope, set the price, answered the flow questions, tapped Send — and only then is told
 * there is nobody to send it to. On the live database right now the phone account owns
 * the job and ZERO approvers, while all 30 roster rows belong to the other account, so
 * this is not a hypothetical. Asking here turns a dead end at the finish line into one
 * tap at the start, and the extra carries its recipient from birth.
 *
 * ─── IT IS SKIPPABLE, AND THAT IS DELIBERATE ────────────────────────────────────
 * Mandate #3: this is a man on a ladder who has just finished talking. A modal he cannot
 * get out of, between the capture and the receipt, is exactly the friction that sends him
 * back to a text message. Skipping costs nothing — the send sheet still asks, as it
 * always has — so this is an EARLY chance to answer, never a new gate.
 *
 * ─── IT NEVER PRE-SELECTS ───────────────────────────────────────────────────────
 * Mandate #2 and the rule `openSendPrep` already follows: a router's suggestion arrives
 * as ordering, never as a decision. Every row here needs a tap. The list is simply the
 * roster, most-recently-used first, because the man who used a client an hour ago is
 * overwhelmingly likely to want them again.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { t } from '../i18n';
import { FlowRail } from './flowrail';
import { Icon } from './icon';
import { Button } from './kit';
import { C, F } from './theme';

/**
 * `role` is what the artboard's second line says ("Property Owner", "Contractor / You").
 * OPTIONAL, and rendered only when present: it is a real column on `project_approver`,
 * so a row that lacks it gets no subtitle rather than an invented one. Labelling
 * somebody's authority on a screen that decides who receives a priced document is
 * exactly the place not to guess — `listRoster` already drops rows whose role it does
 * not recognise for the same reason.
 */
export type ClientChoice = { id: string; name: string; role?: string; phone?: string | null };

/**
 * Tile colour and glyph per role, from the supplied kit's own mapping (README:
 * "Contractor/user: C.brand · Owner/hardhat: amber · Other client/contacts: blue").
 *
 * COLOUR IS NEVER THE ONLY CARRIER — the kit's standing rule and the reason each tile
 * sits beside a name and a written role. A contractor who cannot tell amber from green
 * in direct sun loses nothing.
 */
/**
 * The card's second line. `role.*` is the SAME vocabulary the send sheet and the record
 * screen print, so a man reads "Property owner" in one place and "Property owner" in the
 * other — two spellings of one fact is the drift this codebase keeps paying for.
 *
 * IT NO LONGER SAYS "/ YOU" (review, 2026-09-02). The artboard shows "Contractor / You"
 * under hadar's own name, and I implemented that as `role === 'general_contractor'` —
 * which is not an identity check, it is a guess that happens to be right on his device.
 * A sub's roster contains the GC he subs for, and the `known` list exists PRECISELY to
 * surface that person (App.tsx:2313 names them). So the screen that decides who receives
 * a priced document was labelling a third party "You".
 *
 * Nothing here knows who the signed-in user is; no profile is plumbed to this screen.
 * The honest move is to print the role and stop, rather than assert an identity from a
 * role name. When a real identity is available the suffix can come back with a real
 * check behind it — `clientpick.you` is kept for that day.
 */
function roleLine(role: string): string {
  return t(`role.${role}` as any);
}

function tileFor(role?: string): { bg: string; fg: string; icon: 'acUser' | 'acHardhat' } {
  if (role === 'owner' || role === 'property_manager') {
    return { bg: '#F7EBD6', fg: '#8A6A2F', icon: 'acHardhat' };
  }
  return { bg: '#E8EEE2', fg: '#4E6243', icon: 'acUser' };
}

export function ClientPickScreen(props: {
  /** The extra's title, so he knows WHICH one — he may have made three today. */
  scope: string;
  /** Active clients on this job, most recently used first. May be empty. */
  roster: readonly ClientChoice[];
  /** Tapped an existing client. */
  onPick: (c: ClientChoice) => void;
  /** Typed a new one. This screen never writes; the caller owns both saves. */
  onAdd: (name: string, phone: string) => void;
  /** Open the device contact picker and fill the form from it. */
  onPickContact?: () => Promise<{ name: string; phone: string } | null>;
  /**
   * EVERYONE THIS ACCOUNT KNOWS FROM ITS OTHER LOCATIONS (`listKnownPeople`), deduped,
   * minus the ones already on this one.
   *
   * WHY IT HAS TO BE HERE (hadar, 2026-09-02: "make sure we display potential clients
   * that are related to the location"). `roster` is scoped `WHERE project_id = ?`,
   * which is right — but a location he made ninety seconds ago on step 2 has NOBODY on
   * it, so the correct answer to "who is this for" was an empty list and a blank form.
   * The same homeowner on last month's job, the GC he subs for, the three owners on
   * that street: all already in the database, all invisible at the one moment he needs
   * them.
   *
   * IT IS A SEPARATE LIST AND STAYS ONE. These people are NOT on this location, and a
   * screen that mixed them into the roster would be asserting they are — the same
   * quiet relabelling `listRoster` refuses when it drops rows with unknown roles.
   * Suggestion, never decision (mandate #2): picking one COPIES them onto this
   * location, with their own role intact, and the copy is what `onPickKnown` does.
   */
  known?: readonly ClientChoice[];
  /** Copy someone from another location onto this one, then use them. */
  onPickKnown?: (c: ClientChoice) => void;
  /** Answer later. The send sheet asks again — see the header. */
  onSkip: () => void;
  busy?: boolean;
}) {
  // OPENS ON THE FORM ONLY WHEN THERE IS GENUINELY NOBODY — roster empty AND nothing
  // known from any other location. Before the known list existed this fired on every
  // freshly-made location, which is exactly when the account is most likely to already
  // know the person.
  // Shut on arrival; stays open for the rest of the visit once he asks for it.
  const [knownOpen, setKnownOpen] = React.useState(false);
  const [adding, setAdding] = React.useState(
    props.roster.length === 0 && (props.known ?? []).length === 0);
  const [name, setName] = React.useState('');
  const [phone, setPhone] = React.useState('');

  const canAdd = name.trim().length > 1;

  /**
   * `listKnownPeople` already excludes THIS project by id, but it dedupes on name+phone
   * across every other one — so the same homeowner can still arrive here while sitting
   * on this location under a different row. Filtering by name is the last guard against
   * the screen offering to add somebody it is already showing above.
   */
  const here = React.useMemo(
    () => new Set(props.roster.map((r) => r.name.trim().toLowerCase())),
    [props.roster]
  );
  const known = React.useMemo(
    () => (props.known ?? []).filter((k) => !here.has(k.name.trim().toLowerCase())),
    [props.known, here]
  );

  /**
   * A FULL SCREEN, NOT A SHEET (hadar, 2026-08-27: "During the co create sequence none
   * of these forms can be bottom popups — the sequence have to be the same (forms)").
   *
   * This was the only one of the four steps that arrived as a bottom sheet: record,
   * job and write-up are pages, and this slid up over a greyed-out copy of the last
   * one. A sheet says "a small aside you can flick away"; a page says "the next thing".
   * Halfway through a sequence the wrong one of those is actively misleading — and it
   * made the rail sit on a different-shaped screen each time, which is the opposite of
   * what the rail is for.
   *
   * The X is gone with it. Dismissing a step by flicking it away is a gesture a sheet
   * offers and a page does not; "Do it later" is the same escape, said in words, where
   * every other step keeps its escape.
   */
  return (
    <View style={st.screen}>
      <ScrollView
        contentContainerStyle={st.scroll}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets>
      <View style={{ paddingBottom: 4 }}>
        {/* Third of four. The rail replaced a one-line label here and my edit left it
            wrapped in that label's <Text> — a <View> inside a <Text>, which React
            Native lays out as inline text rather than as a row of bars. */}
        <View style={{ marginBottom: 20 }}><FlowRail step={3} /></View>
        {/* The question was the sheet's header bar; on a page it is the page's title.
            Matched to the job picker's `jpTitle` — same face, same size, same place —
            because "the sequence has to be the same" is the whole point of the move. */}
        <Text style={st.title}>{t('clientpick.title')}</Text>
        {/* THE SCOPE LINE IS GONE (the artboard, 2026-09-02). It printed the extra's
            own title here, and the reason was real when this screen was a SHEET that
            could surface at any time: "he may have made three today". Inside the flow
            it cannot — he recorded this one forty seconds ago on step 1 and has not
            left the sequence since. It was answering a question nobody standing here
            is asking, above the sentence that explains the screen.

            `props.scope` stays on the props, unread, deliberately: it is what this
            screen needs the moment it is ever shown outside the flow again. */}
        {/* THE WHY GETS THE GLYPH, not a bare paragraph (the artboard, 2026-09-02).
            It is the one sentence on the screen that explains the SCREEN rather than an
            option, and the small tile is what separates it from the options below. */}
        <View style={st.introRow}>
          <View style={st.introTile}>
            <Icon name="acClients" size={20} color="#4E6243" />
          </View>
          <Text style={st.introT}>{t('clientpick.why')}</Text>
        </View>

        {/* ── THE ROSTER, AS CARDS ────────────────────────────────────────────────
            Rows with a hairline rule became cards with a 72pt tile. Not decoration:
            this is a one-tap decision made with gloves on (mandate #3), and the old
            row put a 16pt name and a chevron inside 52pt of height. The card is 92,
            the whole card is the target, and the tile gives the eye something to aim
            at before it has read anything. */}
        {/* HEADINGS ONLY WHEN THERE ARE TWO GROUPS. One heading over one list is a
            label on the obvious; two lists with no labels is a lie about where these
            people stand. */}
        {!adding && !!props.roster.length && !!known.length && (
          <Text style={st.group}>{t('clientpick.onLocation')}</Text>
        )}
        {!adding && props.roster.map((r) => {
          const tile = tileFor(r.role);
          return (
            <Pressable
              key={r.id}
              onPress={() => props.onPick(r)}
              disabled={!!props.busy}
              style={({ pressed }) => [st.card, pressed && st.cardDown]}
              accessibilityRole="button"
            >
              <View style={[st.tile, { backgroundColor: tile.bg }]}>
                <Icon name={tile.icon} size={26} color={tile.fg} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={st.cardT} numberOfLines={2}>{r.name}</Text>
                {/* No role, no second line. See the note on ClientChoice.role. */}
                {!!r.role && (
                  <Text style={st.cardSub} numberOfLines={1}>{roleLine(r.role)}</Text>
                )}
              </View>
              <Icon name="acChevron" size={22} color="#6b625b" />
            </Pressable>
          );
        })}

        {/* ── PEOPLE FROM HIS OTHER LOCATIONS ─────────────────────────────────────
            Under their own heading, always, so the boundary is visible. The subtitle
            says what tapping does — it adds them HERE — because a man picking a name
            off a list is entitled to know he is about to put that name on this job. */}
        {!adding && !!known.length && (
          <>
            {/* COLLAPSED, AND SHUT BY DEFAULT (hadar, 2026-09-02: "from your other
                locations need to collapse so another client, add a client and i'll do
                this later will be visible").

                `listKnownPeople` returns up to 60. Sixty 92pt cards is five thousand
                pixels of suggestion sitting on top of the three things that are not
                suggestions — the contacts card, "add a client", and the way out. I gave
                this group the whole screen because it was new, and buried the actual
                controls under it.

                SHUT rather than capped at three, which is what step 2 does for recent
                locations. The two are not the same list: step 2's rows ARE the answer
                most of the time, so its top three earn their space. These people are on
                OTHER jobs — a genuinely useful shortcut, and still a guess. A guess
                announces itself with a count and opens when asked.

                The count is on the closed header so it is never a mystery drawer: he
                can see there are eleven people in there without opening it. */}
            <Pressable onPress={() => setKnownOpen((v) => !v)}
              accessibilityRole="button"
              accessibilityState={{ expanded: knownOpen }}
              style={({ pressed }) => [st.groupRow, pressed && st.cardDown]}>
              <Text style={st.groupInline}>{t('clientpick.knownHead')}</Text>
              <View style={st.groupCount}>
                <Text style={st.groupCountT}>{known.length}</Text>
              </View>
              <View style={{ flex: 1 }} />
              <Text style={[st.groupChev, knownOpen && st.groupChevOpen]}>⌄</Text>
            </Pressable>
            {knownOpen && known.map((k) => {
              const tile = tileFor(k.role);
              return (
                <Pressable
                  key={k.id}
                  onPress={() => props.onPickKnown?.(k)}
                  disabled={!!props.busy || !props.onPickKnown}
                  style={({ pressed }) => [st.card, pressed && st.cardDown]}
                  accessibilityRole="button"
                >
                  <View style={[st.tile, { backgroundColor: tile.bg }]}>
                    <Icon name={tile.icon} size={26} color={tile.fg} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={st.cardT} numberOfLines={2}>{k.name}</Text>
                    <Text style={st.cardSub} numberOfLines={1}>
                      {k.role ? roleLine(k.role) : t('clientpick.knownSub')}
                    </Text>
                  </View>
                  <Icon name="acChevron" size={22} color="#6b625b" />
                </Pressable>
              );
            })}
          </>
        )}

        {/* ── PICK FROM THE PHONE'S CONTACTS ──────────────────────────────────────
            Promoted out of the add-a-client form and onto the screen as its own card
            (the artboard). It was reachable only AFTER tapping "add a client", which
            put the fastest path — the client is already in his phone — behind the
            slowest one, typing a name. */}
        {!adding && !!props.onPickContact && (
          <Pressable
            onPress={async () => {
              const c = await props.onPickContact!();
              if (!c) return;
              setName(c.name); setPhone(c.phone); setAdding(true);
            }}
            disabled={!!props.busy}
            style={({ pressed }) => [st.card, pressed && st.cardDown]}
            accessibilityRole="button"
          >
            <View style={[st.tile, { backgroundColor: '#EAF0F6' }]}>
              <Icon name="acContacts" size={26} color="#3E5B7A" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={st.cardT}>{t('clientpick.contactsTitle')}</Text>
              <Text style={st.cardSub}>{t('clientpick.contactsSub')}</Text>
            </View>
            <Icon name="acChevron" size={22} color="#6b625b" />
          </Pressable>
        )}

        {/* DASHED, because it MAKES a client rather than choosing one — the same
            distinction step 2 draws for "new location right here", drawn the same way,
            so the two screens teach the contractor one rule instead of two. */}
        {!adding && (
          <Pressable onPress={() => setAdding(true)}
            style={({ pressed }) => [st.addCard, pressed && st.cardDown]}
            accessibilityRole="button">
            <View style={st.addPlus}>
              <Icon name="acPlus" size={20} color="#4E6243" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={st.addT}>{t('clientpick.addTitle')}</Text>
              <Text style={st.addSub}>{t('clientpick.addSub')}</Text>
            </View>
          </Pressable>
        )}

        {/* ── LATER, ON THE PAGE ──────────────────────────────────────────────────
            The footer button says the same words, and that is DELIBERATE, not a
            duplicate I missed. They are two different moments: this row is an option
            among the options, read while he is still choosing; the footer is the way
            out of the step, in the fixed place every step of this sequence keeps its
            way out. Removing either one makes the screen worse — the row would leave
            "later" looking like it is not a real answer, and dropping the footer would
            make step 3 the only step whose escape scrolls. */}
        {!adding && (
          <>
            <View style={st.rule} />
            <Pressable onPress={props.onSkip} disabled={!!props.busy}
              style={({ pressed }) => [st.laterRow, pressed && st.cardDown]}
              accessibilityRole="button">
              <View style={[st.tile, st.tileSm, { backgroundColor: '#F1EFEA' }]}>
                <Icon name="acCalendar" size={22} color="#6b625b" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={st.laterT}>{t('clientpick.later')}</Text>
                <Text style={st.cardSub}>{t('clientpick.laterSub')}</Text>
              </View>
              <Icon name="acChevron" size={22} color="#6b625b" />
            </Pressable>
          </>
        )}

        {adding && (
          <View style={{ marginTop: 12 }}>
            {props.onPickContact && (
              <Pressable
                onPress={async () => {
                  const c = await props.onPickContact!();
                  if (!c) return;
                  setName(c.name); setPhone(c.phone);
                }}
                style={{ paddingVertical: 12 }}
              >
                <Text style={{ fontFamily: F.bodySemi, fontSize: 16, color: C.brand }}>
                  {t('clientpick.fromContacts')}
                </Text>
              </Pressable>
            )}
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder={t('clientpick.namePh')}
              placeholderTextColor={C.steel}
              style={{ fontFamily: F.body, fontSize: 16, color: C.ink, paddingVertical: 12,
                borderBottomWidth: 1, borderBottomColor: C.line }}
            />
            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder={t('clientpick.phonePh')}
              placeholderTextColor={C.steel}
              keyboardType="phone-pad"
              style={{ fontFamily: F.body, fontSize: 16, color: C.ink, paddingVertical: 12,
                borderBottomWidth: 1, borderBottomColor: C.line }}
            />
            {/* THE PHONE IS OPTIONAL HERE AND SAYS SO. A client with no number cannot be
                texted, and the send sheet will refuse to send to them — but refusing to
                RECORD the name until a number is typed loses the one fact he has while
                he is standing there. Named, not hidden. */}
            <Text style={{ fontFamily: F.body, fontSize: 13, color: C.steel, marginTop: 8 }}>
              {t('clientpick.phoneWhy')}
            </Text>
            {props.roster.length > 0 && (
              <Pressable onPress={() => setAdding(false)} style={{ paddingVertical: 14 }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 15, color: C.steel }}>
                  {t('clientpick.backToList')}
                </Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
      </ScrollView>
      {/* The footer sits ON the page, in the same place step 2 and step 4 put theirs. */}
      <View style={st.foot}>
        {adding
          ? <Button
              label={t('clientpick.save')}
              onPress={() => props.onAdd(name.trim(), phone.trim())}
              disabled={!canAdd || !!props.busy}
            />
          : <Button label={t('clientpick.later')} variant="neutral" onPress={props.onSkip}
              /* BUSY BLOCKS THE FOOTER TOO (Codex, 2026-09-03). The inline "Later" row
                 already respected `busy`; this one did not. Tapping it while a client
                 write was still running started the processing screen anyway, and the
                 original handler then called `finish()` a second time — advancing a flow
                 that had already advanced, and settling a recipient onto a step that was
                 no longer on screen. */
              disabled={!!props.busy} />}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  // Matched to the job picker's `jpC` so steps 2 and 3 are the same shape of screen.
  screen: { flex: 1, backgroundColor: '#faf7f3', paddingTop: 54 },
  scroll: { paddingHorizontal: 18, paddingBottom: 24 },
  // Step 2's `jpTitle`, verbatim: Inter 29.5/34. Not the theme's Barlow — this whole
  // sequence is drawn in the 2026-08-07 Inter treatment, and matching the theme here
  // would make step 3 the odd screen again for a different reason.
  title: { fontFamily: 'Inter_700Bold', fontSize: 29.5, lineHeight: 34, color: '#131110',
           marginBottom: 14 },
  introRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 13, marginTop: 2 },
  introTile: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#E8EEE2',
    alignItems: 'center', justifyContent: 'center' },
  introT: { flex: 1, fontFamily: F.body, fontSize: 16, lineHeight: 23, color: C.steel,
    paddingTop: 3 },

  // 92pt tall and the WHOLE card is the target — well past the 48pt floor mandate #3
  // sets, because this is a one-tap decision taken with gloves on.
  card: { flexDirection: 'row', alignItems: 'center', gap: 15, minHeight: 92,
    backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e6e0d8', borderRadius: 14,
    paddingHorizontal: 15, paddingVertical: 14, marginTop: 14 },
  // The only press feedback on the screen. A card this large with no state change reads
  // as a panel rather than a control.
  cardDown: { opacity: 0.62 },
  tile: { width: 62, height: 62, borderRadius: 16, alignItems: 'center',
    justifyContent: 'center' },
  tileSm: { width: 52, height: 52, borderRadius: 14 },
  cardT: { fontFamily: 'Inter_700Bold', fontSize: 19, lineHeight: 24, color: '#131110' },
  cardSub: { fontFamily: F.body, fontSize: 15, color: C.steel, marginTop: 2 },

  addCard: { flexDirection: 'row', alignItems: 'center', gap: 15, minHeight: 84,
    borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#8FA383', borderRadius: 14,
    paddingHorizontal: 15, paddingVertical: 14, marginTop: 16 },
  addPlus: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#E8EEE2',
    alignItems: 'center', justifyContent: 'center' },
  addT: { fontFamily: 'Inter_700Bold', fontSize: 19, color: '#3d5236' },
  addSub: { fontFamily: F.body, fontSize: 15, color: '#5d6b56', marginTop: 2 },

  group: { fontFamily: 'Inter_600SemiBold', fontSize: 12.5, letterSpacing: 1.1,
    textTransform: 'uppercase', color: C.steel, marginTop: 26, marginBottom: -2 },
  // 48pt of height on the toggle (mandate #3) — it is a control, not a caption.
  groupRow: { flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 48,
    marginTop: 18 },
  // The same caption as `group`, minus the top margin — that margin belongs to the ROW
  // here, and leaving it on the text meant every sibling needed a matching offset to
  // sit level with it.
  groupInline: { fontFamily: 'Inter_600SemiBold', fontSize: 12.5, letterSpacing: 1.1,
    textTransform: 'uppercase', color: C.steel },
  groupCount: { minWidth: 24, height: 22, borderRadius: 11, paddingHorizontal: 7,
    backgroundColor: C.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
  groupCountT: { fontFamily: 'Inter_600SemiBold', fontSize: 12.5, color: C.steel },
  groupChev: { fontFamily: F.body, fontSize: 19, color: C.steel },
  groupChevOpen: { transform: [{ rotate: '180deg' }] },
  rule: { height: 1, backgroundColor: C.line, marginTop: 26 },
  laterRow: { flexDirection: 'row', alignItems: 'center', gap: 15, minHeight: 76,
    paddingVertical: 12, marginTop: 6 },
  laterT: { fontFamily: 'Inter_700Bold', fontSize: 18, color: '#131110' },

  foot: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 28 },
});
