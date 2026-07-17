/**
 * Static UI localization — REQ-X2. Spanish is the minimum, not a stretch goal.
 *
 * "the primary persona must be able to read the product"
 *
 * That line is the whole justification. This product is for crews where the
 * person holding the phone may not read English, and every string I have written
 * tonight — the record button, "saved ✓", every failure, every consent screen —
 * is English-only. A capture tool the user cannot read is not a capture tool.
 *
 * THE ARCHITECTURAL POINT, which is why this is not just a dictionary:
 * functions like resolveProject() and canRecordAudio() were returning ENGLISH
 * PROSE from the data layer — `why: "You're near 2 jobs — tap to say which"`.
 * A module that returns a baked sentence CANNOT be localized; the language is
 * welded into the logic. They now return a KEY + PARAMS, and only the render
 * layer turns that into words. That is the difference between a product that can
 * be translated and one where translation is a rewrite.
 *
 * STATIC, not the content pipeline. LANGUAGE-LAYER.md's translate-once cache is
 * for CONTENT (what people said). This is app chrome, it ships in the bundle, and
 * it works with no signal — which matters, because the moment a user most needs to
 * read an error is the moment there is no network to fetch a translation.
 *
 * es-419 (Latin American Spanish) is the target: the trades vocabulary here is
 * Mexican/Central American, not Castilian. " Present tense, plain words" is the
 * register — this is read on a ladder, not in an office.
 */
export type Lang = 'en' | 'es';

export type Msg = { k: string; p?: Record<string, string | number> };

/** Make a message. Modules return these instead of sentences. */
export const msg = (k: string, p?: Record<string, string | number>): Msg => ({ k, p });

const EN: Record<string, string> = {
  // --- capture ---
  'rec.record': 'RECORD',
  'rec.stop': 'STOP',
  'rec.saving': 'SAVING…',
  'rec.ready': 'Ready',
  'rec.unavailable': 'UNAVAILABLE',
  'cap.photo': 'PHOTO',
  'cap.video': 'VIDEO',
  'cap.pick': 'PICK',
  'cap.orType': 'Or type it',
  'cap.whatDecided': 'What was decided?',
  'cap.save': 'SAVE',
  'cap.saved': 'Saved ✓',
  'cap.notSaved': 'Not saved: {why}',

  // --- consent (REQ-CON1) ---
  'consent.notSetTitle': 'Recording isn’t set up for this job',
  'consent.notSetBody': 'One tap to set it. Photos and typed notes work now — only voice and video wait.',
  'consent.needed': 'Recording isn’t set up for this job yet. Set it in job setup — it takes one tap.',
  'consent.no_recording': 'This job is set to no recording. Type it or take a photo instead.',
  'consent.title': 'Recording on this job',
  'consent.once': 'Decided once, here. The record button will never stop to ask you.',
  'consent.where': 'Where is this job? (2-letter state)',
  'consent.everyone': 'EVERYONE HAS AGREED',
  'consent.imPart': 'I’M PART OF THE CONVERSATION',
  'consent.none': 'No recording on this job',
  'consent.notAdvice': 'This records what you chose. It is not legal advice — recording rules differ by state and by who is in the room.',

  // --- upload / status (REQ-PROC6) ---
  'up.waitingConn': 'Saved ✓ — will upload when you have a connection',
  'up.waitingWifi': 'Saved ✓ — waiting for Wi-Fi (turn on cellular upload to send now)',

  // --- project resolution (REQ-P1/P2) ---
  'res.atJob': 'You’re at {name}',
  'res.nearN': 'You’re near {n} jobs — tap to say which',
  'res.notAtAny': 'Not at any job — nearest is {name}, {km} km away',
  'res.noJobsYet': 'No jobs yet — saved to your Inbox',
  'res.noLocationInbox': 'No location — saved to your Inbox, tap to file it',
  'res.onlyJob': 'Saved to {name} — your only job',
  'res.lastUsed': 'No location — saved to {name} (the job you were just on)',
  'res.noPinned': 'No job has a location yet — saved to your Inbox',

  // --- inbox (REQ-P2) ---
  'inbox.needJob': '{n} capture(s) need a job →',
  'inbox.safe': 'Saved and safe — just not filed yet',
  'inbox.title': 'Needs a job ({n})',
  'inbox.body': 'These saved fine — we just couldn’t tell which job. Tap a job to file it.',

  // --- jobs ---
  'job.pick': 'No job — tap to pick',
  'job.change': 'tap to change',
  'job.which': 'Which job?',
  'job.new': '+ NEW JOB',
  'job.newTitle': 'New job',
  'job.name': 'What do you call it?',
  'job.address': 'Address (optional)',
  'job.pinNote': 'We’ll pin this job to where you are now, so captures here file themselves. You can add the address later.',
  'job.create': 'CREATE JOB',
  'job.notPinned': 'not pinned — captures here won’t file themselves',
  'job.needsName': 'A job needs a name',
  'job.needsUser': 'Not signed in yet — a job can’t be created until the app has a user',

  // --- errors that must never be silent (mandate #1) ---
  'err.refusedTitle': '{n} item(s) the server refused',
  'err.refusedBody': 'These are saved on this phone but will not reach the cloud. Send this screen to support — nothing is lost until this phone is.',
  'err.cantStart': 'EZjobsite couldn’t start safely',
  'err.micDenied': 'microphone permission denied',
  'err.needsPermission': '{what} needs permission — enable it in Settings',

  // --- money (mandate #6) ---
  'co.check': 'Check the number',
  'co.yes': 'YES — {amount}',
  'co.enterPrice': 'ENTER A PRICE',
  'co.nothingSent': 'Nothing is sent until you agree with this figure.',
  'co.noPriceHeard': 'No price heard. Type it.',
  'co.unsure': 'Heard a number but not sure it’s the price. Type it.',
  'co.linesDisagree': 'Lines add up to {sum} but the change order says {total}',
  'co.lineBad': 'Line {n} does not add up',

  'st.savedNotBacked': 'Saved on this phone ✓ — not backed up yet',
  'st.starting': 'Starting…',
  'st.onThisPhone': 'Saved on this phone ({n})',
  'st.waiting': ' · {n} waiting to back up',
  'st.failedCount': ' · {n} failed to back up',
  'st.failedBody': '{n} captures are saved here but could not be backed up. Still on this phone — not lost. Needs attention.',

  'common.close': 'Close',
  'common.cancel': 'Cancel',
  'common.back': 'Back',
};

/**
 * es-419. Written for someone reading on a ladder: short, present tense, no
 * officialese. "Guardado" not "Se ha guardado correctamente".
 *
 * NOT machine-translated word-for-word. Two examples of why that matters:
 *  - "RECORD" -> "GRABAR" (the verb), not "REGISTRO" (a record/document). The
 *    button is an instruction, not a noun.
 *  - "job" -> "trabajo" (the work/site), not "empleo" (employment). A contractor's
 *    "job" is a place, not a position.
 * These are exactly the errors a translation API makes, and they are the ones that
 * make a crew stop trusting the app.
 */
const ES: Record<string, string> = {
  'rec.record': 'GRABAR',
  'rec.stop': 'PARAR',
  'rec.saving': 'GUARDANDO…',
  'rec.ready': 'Listo',
  'rec.unavailable': 'NO DISPONIBLE',
  'cap.photo': 'FOTO',
  'cap.video': 'VIDEO',
  'cap.pick': 'ELEGIR',
  'cap.orType': 'O escríbelo',
  'cap.whatDecided': '¿Qué se decidió?',
  'cap.save': 'GUARDAR',
  'cap.saved': 'Guardado ✓',
  'cap.notSaved': 'No se guardó: {why}',

  'consent.notSetTitle': 'La grabación no está configurada para este trabajo',
  'consent.notSetBody': 'Un toque para configurarla. Las fotos y las notas escritas ya funcionan — solo la voz y el video esperan.',
  'consent.needed': 'La grabación aún no está configurada para este trabajo. Configúrala — es un solo toque.',
  'consent.no_recording': 'Este trabajo no permite grabar. Escríbelo o toma una foto.',
  'consent.title': 'Grabación en este trabajo',
  'consent.once': 'Se decide una vez, aquí. El botón de grabar nunca te va a preguntar.',
  'consent.where': '¿Dónde está este trabajo? (estado, 2 letras)',
  'consent.everyone': 'TODOS ESTÁN DE ACUERDO',
  'consent.imPart': 'YO PARTICIPO EN LA CONVERSACIÓN',
  'consent.none': 'No grabar en este trabajo',
  'consent.notAdvice': 'Esto guarda lo que elegiste. No es asesoría legal — las reglas de grabación cambian según el estado y quién está presente.',

  'up.waitingConn': 'Guardado ✓ — se subirá cuando haya conexión',
  'up.waitingWifi': 'Guardado ✓ — esperando Wi-Fi (activa la subida por datos para enviarlo ahora)',

  'res.atJob': 'Estás en {name}',
  'res.nearN': 'Estás cerca de {n} trabajos — toca para decir cuál',
  'res.notAtAny': 'No estás en ningún trabajo — el más cercano es {name}, a {km} km',
  'res.noJobsYet': 'Todavía no hay trabajos — guardado en tu Bandeja',
  'res.noLocationInbox': 'Sin ubicación — guardado en tu Bandeja, toca para archivarlo',
  'res.onlyJob': 'Guardado en {name} — tu único trabajo',
  'res.lastUsed': 'Sin ubicación — guardado en {name} (el trabajo donde estabas)',
  'res.noPinned': 'Ningún trabajo tiene ubicación todavía — guardado en tu Bandeja',

  'inbox.needJob': '{n} captura(s) necesitan un trabajo →',
  'inbox.safe': 'Guardadas y seguras — solo falta archivarlas',
  'inbox.title': 'Necesitan un trabajo ({n})',
  'inbox.body': 'Se guardaron bien — solo no supimos de cuál trabajo son. Toca un trabajo para archivarla.',

  'job.pick': 'Sin trabajo — toca para elegir',
  'job.change': 'toca para cambiar',
  'job.which': '¿Cuál trabajo?',
  'job.new': '+ TRABAJO NUEVO',
  'job.newTitle': 'Trabajo nuevo',
  'job.name': '¿Cómo le dices?',
  'job.address': 'Dirección (opcional)',
  'job.pinNote': 'Vamos a fijar este trabajo donde estás ahora, para que las capturas se archiven solas. La dirección la puedes agregar después.',
  'job.create': 'CREAR TRABAJO',
  'job.notPinned': 'sin ubicación — las capturas aquí no se archivan solas',
  'job.needsName': 'El trabajo necesita un nombre',
  'job.needsUser': 'Aún no has iniciado sesión — no se puede crear un trabajo sin usuario',

  'err.refusedTitle': 'El servidor rechazó {n} elemento(s)',
  'err.refusedBody': 'Están guardados en este teléfono pero no van a llegar a la nube. Manda esta pantalla a soporte — no se pierde nada mientras tengas el teléfono.',
  'err.cantStart': 'EZjobsite no pudo iniciar de forma segura',
  'err.micDenied': 'permiso de micrófono denegado',
  'err.needsPermission': '{what} necesita permiso — actívalo en Ajustes',

  'co.check': 'Revisa el número',
  'co.yes': 'SÍ — {amount}',
  'co.enterPrice': 'ESCRIBE UN PRECIO',
  'co.nothingSent': 'No se manda nada hasta que estés de acuerdo con esta cifra.',
  'co.noPriceHeard': 'No se escuchó un precio. Escríbelo.',
  'co.unsure': 'Se escuchó un número pero no estamos seguros de que sea el precio. Escríbelo.',
  'co.linesDisagree': 'Las líneas suman {sum} pero la orden de cambio dice {total}',
  'co.lineBad': 'La línea {n} no cuadra',

  'st.savedNotBacked': 'Guardado en este teléfono ✓ — todavía sin respaldo',
  'st.starting': 'Iniciando…',
  'st.onThisPhone': 'Guardado en este teléfono ({n})',
  'st.waiting': ' · {n} esperando respaldo',
  'st.failedCount': ' · {n} sin respaldo',
  'st.failedBody': '{n} capturas están guardadas aquí pero no se pudieron respaldar. Siguen en este teléfono — no se perdieron. Necesitan atención.',

  'common.close': 'Cerrar',
  'common.cancel': 'Cancelar',
  'common.back': 'Atrás',
};

const DICT: Record<Lang, Record<string, string>> = { en: EN, es: ES };

let current: Lang = 'en';
export function setLang(l: Lang) { current = l; }
export function getLang(): Lang { return current; }

/**
 * Render a message.
 *
 * A MISSING KEY RETURNS THE KEY, loudly and visibly, rather than falling back to
 * English. A silent English fallback is how half-translated apps ship: nobody
 * ever sees what is missing, because it looks fine to the person who wrote it.
 * 'res.atJob' on screen is ugly, and ugly gets fixed.
 */
export function t(m: Msg | string, lang: Lang = current): string {
  const { k, p } = typeof m === 'string' ? { k: m, p: undefined } : m;
  const s = DICT[lang]?.[k];
  if (s === undefined) return k;
  if (!p) return s;
  return s.replace(/\{(\w+)\}/g, (_, name) =>
    p[name] !== undefined ? String(p[name]) : `{${name}}`);
}

/** Which keys are missing from a language. Used by the coverage test. */
export function missingKeys(lang: Lang): string[] {
  return Object.keys(EN).filter((k) => DICT[lang][k] === undefined);
}
