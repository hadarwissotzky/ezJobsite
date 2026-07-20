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
  'cap.snapTalk': 'Snap + Talk',
  'cap.noLoc': 'location unavailable',
  'cap.needCamera': 'EZchangeorder needs the camera to capture a jobsite decision.',
  'cap.allowCamera': 'Allow camera',
  'cap.remindTitle': 'Remember to mention:',
  'cap.remind1': 'WHO & WHERE — client name & address',
  'cap.remind2': 'COST — materials and labor',
  'cap.remind3': 'WHEN — start / finish dates',
  'cap.remind4': 'WHAT — the work to be done',
  'cap.speakLouder': 'Speak louder',
  'cap.talkWalk': 'Talk and walk — tap to snap',
  'cap.tapSnap': 'Tap to snap',
  'cap.keepGoing': '{n} captured — keep going or finish',
  'cap.done': 'Done ✓',
  'cap.savingN': 'Saving {n} photos + voice…',
  'rev.open': 'Review what it heard →',
  'cap.flip': 'Flip',
  'cap.flashOn': 'Flash on',
  'cap.flashOff': 'Flash off',
  'cap.gallery': 'Gallery',
  'cap.pause': 'Pause',
  'cap.resume': 'Resume',
  'cap.pausedHint': 'Paused — photos still work. Resume when ready.',
  'cap.interrupted': 'A call took the microphone',
  'cap.tapToResume': 'Tap here to keep recording',
  'cap.sayWhat': 'Say what you found — the app is listening.',
  'cap.sayWhatEx': '“Water heater’s cracked, needs replacing — about eighteen fifty.”',
  'cap.nothingYet': 'Nothing captured yet — say what happened, or snap a photo. Then tap Done.',
  'assign.saved': 'Saved on this phone',
  'assign.title': 'Which job is this for?',
  'assign.sub': 'Saved safe on this phone. A change order belongs to a job — pick one, or make it.',
  'assign.search': 'Search jobs or address',
  'assign.newHere': 'New job right here',
  'assign.newJobName': 'New job (no address yet)',
  'assign.later': 'Later — keep it in the Inbox',
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

  // --- Terms acceptance (personal-use consent model, 2026-07-17) ---
  'terms.title': 'One quick thing before you record',
  'terms.body': 'This app records the audio and video you capture on the job. By continuing you accept the Terms & Conditions, and confirm you are responsible for recording lawfully where you work. You only do this once.',
  'terms.reminder': 'You’re in {state}, where everyone in a conversation must be told they’re being recorded. Please let people know.',
  'terms.accept': 'I ACCEPT',
  'terms.later': 'Not now',

  // --- onboarding slideshow (pre-login intro) ---
  'ob.1t': 'Capture it in the moment',
  'ob.1b': 'Talk, snap a photo, or type. On the job, in the truck, wherever you are — the app does the filing.',
  'ob.2t': 'It becomes a priced change order',
  'ob.2b': 'What you said turns into a clear, priced change order you can send and approve with one tap.',
  'ob.3t': 'Works with no signal',
  'ob.3b': 'Everything saves on your phone first. Weak signal, no signal — nothing you capture is ever lost.',
  'ob.4t': 'Everyone stays aligned',
  'ob.4b': 'Fewer mix-ups, fewer arguments. You and the office see the same thing. Let’s set you up.',
  'ob.next': 'Next',
  'ob.start': 'Get started',
  'ob.skip': 'Skip',

  // --- auth (sign in / register) ---
  'auth.signInTitle': 'Welcome back',
  'auth.signUpTitle': 'Create your account',
  'auth.email': 'Email',
  'auth.password': 'Password',
  'auth.signIn': 'Sign in',
  'auth.createAccount': 'Create account',
  'auth.toSignUp': 'New here? Create an account',
  'auth.toSignIn': 'Have an account? Sign in',
  'auth.checkEmail': 'Check your email to confirm your account, then sign in.',

  // --- first-run profile (who you are) ---
  'fr.whoTitle': 'Let’s set you up',
  'fr.whoWhy': 'This is how your name and business show up on what you send. Takes a few seconds.',
  'fr.yourName': 'Your name',
  'fr.solo': 'I work solo',
  'fr.company': 'I have a company',
  'fr.companyName': 'Company name',
  'fr.continue': 'Continue',
  'fr.tradeTitle': 'What’s your trade?',
  'fr.tradeWhy': 'We’ll tune things to your work. You can change this later.',
  'fr.skip': 'Skip',
  'trade.roofing': 'Roofing',
  'trade.hvac': 'HVAC',
  'trade.plumbing': 'Plumbing',
  'trade.electrical': 'Electrical',
  'trade.painting': 'Painting',
  'trade.concrete': 'Concrete',
  'trade.landscaping': 'Landscaping',
  'trade.remodeling': 'Remodeling',
  'trade.general': 'General contractor',
  'trade.other': 'Other',

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
  'home.projects': 'Jobs',
  'home.search': 'Search jobs',
  'home.newProject': 'New job',
  'home.gotOne': 'Got a change?',
  'home.sayIt': 'Say it now — file it after.',
  'home.capture': 'Capture',
  'home.filesItself': 'It files itself to the right job',
  'home.yourJobs': 'Your jobs',
  'home.inbox': 'Inbox ({n})',
  'home.inboxSub': 'Captures we couldn’t match to a job',
  'home.noAddress': 'No address',
  'home.captures': '{n} captures',
  'home.notPinned': 'not pinned',
  'home.noMatch': 'No jobs match that.',
  'home.noProjects': 'No jobs yet — make your first one.',
  'detail.noCaptures': 'Nothing captured here yet. Tap record, snap a photo, or type a note.',
  'job.newTitle': 'New job',
  'job.name': 'What do you call it?',
  'job.address': 'Address (optional)',
  'addr.useLocation': 'Use my location',
  'job.pinNote': 'We’ll pin this job to where you are now, so captures here file themselves. You can add the address later.',
  'job.create': 'CREATE JOB',
  'job.notPinned': 'not pinned — captures here won’t file themselves',
  'job.needsName': 'A job needs a name',
  'job.needsUser': 'Not signed in yet — a job can’t be created until the app has a user',

  // --- errors that must never be silent (mandate #1) ---
  'err.refusedTitle': '{n} item(s) the server refused',
  'err.refusedBody': 'These are saved on this phone but will not reach the cloud. Send this screen to support — nothing is lost until this phone is.',
  'err.cantStart': 'EZchangeorder couldn’t start safely',
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

  // --- signing (§7.1) ---
  'sig.required': 'Signature required',
  'sig.ownersMobile': 'Owner’s mobile — you enter it, not them',
  'sig.sendCode': 'SEND CODE',
  'sig.noSms': 'No SMS provider yet — code would be texted to {phone}. For now: {code}',
  'sig.enterCode': '6-digit code',
  'sig.verify': 'VERIFY',
  'sig.verified': '✓ Phone verified',
  'sig.typeName': 'Type your full legal name to sign',
  'sig.legalName': 'Full legal name',
  'sig.sign': 'SIGN & APPROVE',
  'sig.decline': 'Decline',
  'sig.frozen': 'The words above are frozen — they are what gets signed, not whatever the change order says later.',

  // --- evidence viewer (REQ-EVID1) / notes (REQ-CAP3) ---
  'ev.recorded': 'Recorded',
  'ev.where': 'Where',
  'ev.hash': 'Content hash (SHA-256)',
  'ev.intact': '✓ The file on this phone still matches this hash — recomputed just now from the bytes on disk, not compared to a stored copy of itself.',
  'ev.tampered': '⚠ THE FILE NO LONGER MATCHES ITS HASH. Do not rely on this capture.',
  'ev.notes': 'Notes ({n})',
  'ev.addNote': 'Add a note about this',
  'ev.addNoteBtn': 'ADD NOTE',
  'ev.notesAppend': 'Notes are added, never replaced — an earlier note is never overwritten by a later one. The note is what someone said ABOUT this; it isn’t part of what was recorded.',
  'ev.play': '▶ PLAY',
  'ev.stop': '■ STOP',
  'ev.audioMeta': 'Audio · {kb} KB · plays from this phone, no signal needed',
  'ev.playFailed': 'This won’t play: {why}. The evidence can’t be examined — that matters.',

  // --- decisions / confirmations ---
  'dec.history': 'History — nothing is ever overwritten',
  'dec.notADecision': 'Not a decision',
  'dec.alreadySaved': 'Already saved either way — this just says what it means.',
  'dec.confirm': 'CONFIRM',
  'conf.created': 'Confirm request created',
  'conf.send': 'SEND IT →',
  'conf.noLogin': 'No login needed — anyone with this link can answer it.',

  // --- inbox / jobs, empties ---
  'inbox.noJobs': 'No jobs to file into yet. Create one first.',
  'job.noneYet': 'No jobs yet. Create one — it takes a name.',
  'inbox.appendOnly': 'Filing doesn’t rewrite the capture — the original stays exactly as it was recorded, and your choice is kept beside it.',

  'fr.jobTitle': 'What job are you on?',
  'fr.jobWhy': 'Everything you capture files itself to a job. You can add more later.',
  'fr.consentWhy': 'One question, once. Then the record button never asks you anything again.',
  'fr.ready': 'Ready — tap the green button',

  // REQ-X3: one status per item. Plain, and about what to DO.
  'st.needsJob': 'Needs a job',
  'st.wontBackUp': 'Won’t back up — needs attention',
  'st.waitingBackup': 'Waiting to back up',
  'st.backedUp': 'Backed up',
  'st.detail.waiting': 'not backed up yet',
  'st.detail.noLocation': 'no location recorded',
  'st.detail.unfiled': 'not filed to a job',
  'st.screen.needsYou': '{n} need a job →',
  'st.screen.notSafe': '{n} won’t back up — tap',
  'st.screen.waiting': '{n} waiting to back up',

  // REQ-VAL7
  'sc.title': 'Who owns what',
  'sc.gaps': '{n} nobody owns →',
  'sc.nobody': 'Nobody has said',
  'sc.addBoundary': 'What might fall between trades?',
  'sc.addBoundaryBtn': '+ ADD',
  'sc.addParty': 'Who’s on this job?',
  'sc.partyName': 'Company',
  'sc.partyTrade': 'Trade (e.g. electrical)',
  'sc.addPartyBtn': '+ ADD COMPANY',
  'sc.whoOwns': 'Who owns it?',
  'sc.changed': 'changed {n}×',
  'sc.noParties': 'Add the companies on this job first — then you can say who owns what.',
  'sc.note': 'Nothing here is guessed. If two trades both touch something, we ask — we don’t pick.',

  // REQ-PROC4 per-item pipeline state. Plain words -- "queued" is jargon.
  'st.proc.captured': 'saved on this phone',
  'st.proc.queued': 'waiting to send',
  'st.proc.uploaded': 'sent to the cloud',
  'st.proc.processed': 'processed',

  'rep.send': 'Send the client an update →',
  'rep.nothing': 'Nothing new to tell them yet',

  // REQ-P5 — propose, never auto-create.
  'res.newHereFar': 'New job here? The nearest is {name}, {km} km away.',
  'res.newHereNoJobs': 'New job here?',
  'p5.create': 'YES — NEW JOB HERE',
  'p5.notNew': 'No — it belongs to a job I already have',
  'p5.pinned': 'We’ll pin it where you’re standing.',

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
  'cap.snapTalk': 'Foto + Voz',
  'cap.noLoc': 'ubicación no disponible',
  'cap.needCamera': 'EZchangeorder necesita la cámara para capturar una decisión de obra.',
  'cap.allowCamera': 'Permitir cámara',
  'cap.remindTitle': 'Recuerda mencionar:',
  'cap.remind1': 'QUIÉN Y DÓNDE — nombre y dirección del cliente',
  'cap.remind2': 'COSTO — materiales y mano de obra',
  'cap.remind3': 'CUÁNDO — fechas de inicio / fin',
  'cap.remind4': 'QUÉ — el trabajo a realizar',
  'cap.speakLouder': 'Habla más fuerte',
  'cap.talkWalk': 'Habla y camina — toca para fotografiar',
  'cap.tapSnap': 'Toca para fotografiar',
  'cap.keepGoing': '{n} capturadas — sigue o termina',
  'cap.done': 'Listo ✓',
  'cap.savingN': 'Guardando {n} fotos + voz…',
  'rev.open': 'Revisa lo que escuchó →',
  'cap.flip': 'Girar',
  'cap.flashOn': 'Flash sí',
  'cap.flashOff': 'Flash no',
  'cap.gallery': 'Galería',
  'cap.pause': 'Pausa',
  'cap.resume': 'Seguir',
  'cap.pausedHint': 'En pausa — las fotos siguen funcionando. Continúa cuando quieras.',
  'cap.interrupted': 'Una llamada tomó el micrófono',
  'cap.tapToResume': 'Toca aquí para seguir grabando',
  'cap.sayWhat': 'Di lo que encontraste — la app te escucha.',
  'cap.sayWhatEx': '“El calentador está rajado, hay que cambiarlo — como mil ochocientos cincuenta.”',
  'cap.nothingYet': 'Aún no hay nada — di qué pasó o toma una foto. Luego toca Listo.',
  'assign.saved': 'Guardado en este teléfono',
  'assign.title': '¿De qué trabajo es esto?',
  'assign.sub': 'Guardado seguro en este teléfono. Un cambio pertenece a un trabajo — elige uno o créalo.',
  'assign.search': 'Busca trabajo o dirección',
  'assign.newHere': 'Nuevo trabajo aquí mismo',
  'assign.newJobName': 'Trabajo nuevo (sin dirección aún)',
  'assign.later': 'Después — déjalo en la bandeja',
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

  // --- Terms acceptance (personal-use consent model, 2026-07-17) ---
  'terms.title': 'Algo rápido antes de grabar',
  'terms.body': 'Esta app graba el audio y el video que captures en el trabajo. Al continuar, aceptas los Términos y Condiciones y confirmas que eres responsable de grabar de forma legal donde trabajas. Solo lo haces una vez.',
  'terms.reminder': 'Estás en {state}, donde se debe avisar a todos en una conversación que están siendo grabados. Por favor avísales.',
  'terms.accept': 'ACEPTO',
  'terms.later': 'Ahora no',

  // --- onboarding slideshow (pre-login intro) ---
  'ob.1t': 'Captúralo al instante',
  'ob.1b': 'Habla, toma una foto o escribe. En la obra, en la troca, donde estés — la app se encarga de organizarlo.',
  'ob.2t': 'Se convierte en una orden de cambio con precio',
  'ob.2b': 'Lo que dijiste se convierte en una orden de cambio clara y con precio que puedes enviar y aprobar con un toque.',
  'ob.3t': 'Funciona sin señal',
  'ob.3b': 'Todo se guarda primero en tu teléfono. Con poca señal o sin señal — nada de lo que captures se pierde.',
  'ob.4t': 'Todos en la misma página',
  'ob.4b': 'Menos malentendidos, menos discusiones. Tú y la oficina ven lo mismo. Vamos a configurarte.',
  'ob.next': 'Siguiente',
  'ob.start': 'Empezar',
  'ob.skip': 'Omitir',

  // --- auth (sign in / register) ---
  'auth.signInTitle': 'Bienvenido de nuevo',
  'auth.signUpTitle': 'Crea tu cuenta',
  'auth.email': 'Correo',
  'auth.password': 'Contraseña',
  'auth.signIn': 'Entrar',
  'auth.createAccount': 'Crear cuenta',
  'auth.toSignUp': '¿Nuevo aquí? Crea una cuenta',
  'auth.toSignIn': '¿Ya tienes cuenta? Entra',
  'auth.checkEmail': 'Revisa tu correo para confirmar tu cuenta y luego entra.',

  // --- first-run profile (who you are) ---
  'fr.whoTitle': 'Vamos a configurarte',
  'fr.whoWhy': 'Así aparecen tu nombre y tu negocio en lo que envías. Toma unos segundos.',
  'fr.yourName': 'Tu nombre',
  'fr.solo': 'Trabajo solo',
  'fr.company': 'Tengo una empresa',
  'fr.companyName': 'Nombre de la empresa',
  'fr.continue': 'Continuar',
  'fr.tradeTitle': '¿Cuál es tu oficio?',
  'fr.tradeWhy': 'Ajustaremos la app a tu trabajo. Puedes cambiarlo después.',
  'fr.skip': 'Omitir',
  'trade.roofing': 'Techado',
  'trade.hvac': 'Climatización',
  'trade.plumbing': 'Plomería',
  'trade.electrical': 'Electricidad',
  'trade.painting': 'Pintura',
  'trade.concrete': 'Concreto',
  'trade.landscaping': 'Jardinería',
  'trade.remodeling': 'Remodelación',
  'trade.general': 'Contratista general',
  'trade.other': 'Otro',

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
  'home.projects': 'Trabajos',
  'home.search': 'Buscar trabajos',
  'home.newProject': 'Nuevo trabajo',
  'home.gotOne': '¿Hay un cambio?',
  'home.sayIt': 'Dilo ahora — archívalo después.',
  'home.capture': 'Capturar',
  'home.filesItself': 'Se archiva solo en el trabajo correcto',
  'home.yourJobs': 'Tus trabajos',
  'home.inbox': 'Bandeja ({n})',
  'home.inboxSub': 'Capturas que no pudimos asignar a un trabajo',
  'home.noAddress': 'Sin dirección',
  'home.captures': '{n} capturas',
  'home.notPinned': 'sin ubicación',
  'home.noMatch': 'Ningún trabajo coincide.',
  'home.noProjects': 'Aún no hay trabajos — crea el primero.',
  'detail.noCaptures': 'Aún no hay nada aquí. Toca grabar, saca una foto o escribe una nota.',
  'job.which': '¿Cuál trabajo?',
  'job.new': '+ TRABAJO NUEVO',
  'job.newTitle': 'Trabajo nuevo',
  'job.name': '¿Cómo le dices?',
  'job.address': 'Dirección (opcional)',
  'addr.useLocation': 'Usar mi ubicación',
  'job.pinNote': 'Vamos a fijar este trabajo donde estás ahora, para que las capturas se archiven solas. La dirección la puedes agregar después.',
  'job.create': 'CREAR TRABAJO',
  'job.notPinned': 'sin ubicación — las capturas aquí no se archivan solas',
  'job.needsName': 'El trabajo necesita un nombre',
  'job.needsUser': 'Aún no has iniciado sesión — no se puede crear un trabajo sin usuario',

  'err.refusedTitle': 'El servidor rechazó {n} elemento(s)',
  'err.refusedBody': 'Están guardados en este teléfono pero no van a llegar a la nube. Manda esta pantalla a soporte — no se pierde nada mientras tengas el teléfono.',
  'err.cantStart': 'EZchangeorder no pudo iniciar de forma segura',
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

  'sig.required': 'Se requiere firma',
  'sig.ownersMobile': 'Celular del dueño — lo escribes tú, no él',
  'sig.sendCode': 'MANDAR CÓDIGO',
  'sig.noSms': 'Todavía no hay servicio de SMS — el código se mandaría a {phone}. Por ahora: {code}',
  'sig.enterCode': 'código de 6 dígitos',
  'sig.verify': 'VERIFICAR',
  'sig.verified': '✓ Teléfono verificado',
  'sig.typeName': 'Escribe tu nombre legal completo para firmar',
  'sig.legalName': 'Nombre legal completo',
  'sig.sign': 'FIRMAR Y APROBAR',
  'sig.decline': 'Rechazar',
  'sig.frozen': 'Las palabras de arriba están congeladas — eso es lo que se firma, no lo que la orden de cambio diga después.',

  'ev.recorded': 'Grabado',
  'ev.where': 'Dónde',
  'ev.hash': 'Huella del contenido (SHA-256)',
  'ev.intact': '✓ El archivo en este teléfono todavía coincide con esta huella — recalculada ahora mismo desde los bytes en el disco, no comparada con una copia guardada de sí misma.',
  'ev.tampered': '⚠ EL ARCHIVO YA NO COINCIDE CON SU HUELLA. No confíes en esta captura.',
  'ev.notes': 'Notas ({n})',
  'ev.addNote': 'Agrega una nota sobre esto',
  'ev.addNoteBtn': 'AGREGAR NOTA',
  'ev.notesAppend': 'Las notas se agregan, nunca se reemplazan — una nota anterior nunca se sobrescribe. La nota es lo que alguien dijo SOBRE esto; no es parte de lo que se grabó.',
  'ev.play': '▶ REPRODUCIR',
  'ev.stop': '■ PARAR',
  'ev.audioMeta': 'Audio · {kb} KB · se reproduce desde este teléfono, sin señal',
  'ev.playFailed': 'Esto no se reproduce: {why}. La evidencia no se puede examinar — eso importa.',

  'dec.history': 'Historial — nada se sobrescribe nunca',
  'dec.notADecision': 'No es una decisión',
  'dec.alreadySaved': 'Ya está guardado de todas formas — esto solo dice lo que significa.',
  'dec.confirm': 'CONFIRMAR',
  'conf.created': 'Solicitud de confirmación creada',
  'conf.send': 'MANDARLO →',
  'conf.noLogin': 'No necesita cuenta — cualquiera con este enlace puede responder.',

  'inbox.noJobs': 'Todavía no hay trabajos para archivar. Crea uno primero.',
  'job.noneYet': 'Todavía no hay trabajos. Crea uno — solo necesita un nombre.',
  'inbox.appendOnly': 'Archivar no reescribe la captura — el original queda exactamente como se grabó, y tu decisión se guarda junto a él.',

  'fr.jobTitle': '¿En cuál trabajo estás?',
  'fr.jobWhy': 'Todo lo que captures se archiva solo en un trabajo. Puedes agregar más después.',
  'fr.consentWhy': 'Una pregunta, una vez. Después el botón de grabar ya no te pregunta nada.',
  'fr.ready': 'Listo — toca el botón verde',

  'st.needsJob': 'Necesita un trabajo',
  'st.wontBackUp': 'No se va a respaldar — necesita atención',
  'st.waitingBackup': 'Esperando respaldo',
  'st.backedUp': 'Respaldado',
  'st.detail.waiting': 'todavía sin respaldo',
  'st.detail.noLocation': 'sin ubicación',
  'st.detail.unfiled': 'sin archivar en un trabajo',
  'st.screen.needsYou': '{n} necesitan un trabajo →',
  'st.screen.notSafe': '{n} no se van a respaldar — toca',
  'st.screen.waiting': '{n} esperando respaldo',

  'sc.title': 'Quién es responsable de qué',
  'sc.gaps': '{n} sin dueño →',
  'sc.nobody': 'Nadie ha dicho',
  'sc.addBoundary': '¿Qué puede quedar entre oficios?',
  'sc.addBoundaryBtn': '+ AGREGAR',
  'sc.addParty': '¿Quién está en este trabajo?',
  'sc.partyName': 'Empresa',
  'sc.partyTrade': 'Oficio (ej. eléctrico)',
  'sc.addPartyBtn': '+ AGREGAR EMPRESA',
  'sc.whoOwns': '¿Quién es el responsable?',
  'sc.changed': 'cambió {n}×',
  'sc.noParties': 'Primero agrega las empresas de este trabajo — después puedes decir quién es responsable de qué.',
  'sc.note': 'Aquí no se adivina nada. Si dos oficios tocan lo mismo, preguntamos — no elegimos.',

  'st.proc.captured': 'guardado en este teléfono',
  'st.proc.queued': 'esperando para enviar',
  'st.proc.uploaded': 'enviado a la nube',
  'st.proc.processed': 'procesado',

  'rep.send': 'Mandarle una actualización al cliente →',
  'rep.nothing': 'Todavía no hay nada nuevo que contarle',

  'res.newHereFar': '¿Trabajo nuevo aquí? El más cercano es {name}, a {km} km.',
  'res.newHereNoJobs': '¿Trabajo nuevo aquí?',
  'p5.create': 'SÍ — TRABAJO NUEVO AQUÍ',
  'p5.notNew': 'No — es de un trabajo que ya tengo',
  'p5.pinned': 'Lo fijamos donde estás parado.',

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
