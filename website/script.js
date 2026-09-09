const button = document.querySelector('.menu-button');
const nav = document.querySelector('#site-nav');

button?.addEventListener('click', () => {
  const open = nav.classList.toggle('open');
  button.setAttribute('aria-expanded', String(open));
});

nav?.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => {
    nav.classList.remove('open');
    button?.setAttribute('aria-expanded', 'false');
  });
});

const spanish = new Map(Object.entries({
  'Menu': 'Menú', 'How it works': 'Cómo funciona', 'Why it pays': 'Por qué conviene',
  'Your language': 'Tu idioma', 'Questions': 'Preguntas', 'Download the app': 'Descarga la app',
  'Built for small residential contractors': 'Hecho para pequeños contratistas residenciales',
  'The change starts with a conversation': 'El cambio empieza con una conversación',
  'CAPTURE IT BEFORE THE DETAILS': 'REGÍSTRALO ANTES DE QUE LOS DETALLES',
  'Record the client or GC’s request while you’re standing there. Add notes and photos. EZChangeOrder turns it into a clear change order ready for approval.': 'Graba la solicitud del cliente o del contratista general mientras estás ahí. Agrega notas y fotos. EZChangeOrder la convierte en una orden de cambio clara y lista para aprobación.',
  'Add details': 'Agrega detalles',
  'Recording conversation': 'Grabando conversación',
  'Client or GC request · 00:18': 'Solicitud del cliente o contratista general · 00:18',
  'Record + notes + photos': 'Grabación + notas + fotos',
  'Change order ready for approval.': 'Orden de cambio lista para aprobación.',
  'The value': 'El valor',
  'KEEP MORE OF THE WORK YOU ALREADY DO.': 'CONSERVA MÁS DEL VALOR DEL TRABAJO QUE YA HACES.',
  'Small changes are still real labor, real materials, and real money. EZChangeOrder helps you turn what happened in the field into what gets approved and paid.': 'Los cambios pequeños también representan mano de obra, materiales y dinero reales. EZChangeOrder te ayuda a convertir lo que pasó en la obra en trabajo aprobado y pagado.',
  'GET PAID FOR THE SMALL STUFF.': 'COBRA POR LAS COSAS PEQUEÑAS.',
  'Every extra outlet, trim run, and return trip has a price. Capture it before it disappears into the original job.': 'Cada tomacorriente adicional, tramo de moldura y visita de regreso tiene un precio. Regístralo antes de que desaparezca dentro del trabajo original.',
  'GET THE YES BEFORE THE WORK.': 'OBTÉN EL SÍ ANTES DEL TRABAJO.',
  'Put the scope, price, and timing in front of the client or GC while the request is still fresh.': 'Pon el alcance, el precio y el plazo frente al cliente o contratista general mientras la solicitud está fresca.',
  'STOP REBUILDING THE STORY.': 'DEJA DE RECONSTRUIR LA HISTORIA.',
  'When billing day comes, you are not searching texts or arguing from memory. The field record is already there.': 'Cuando llegue el día de facturar, no estarás buscando mensajes ni discutiendo de memoria. El registro de obra ya estará listo.',
  'GET YOUR EVENINGS BACK.': 'RECUPERA TUS NOCHES.',
  'Turn jobsite details into a draft before they become more office work after dinner.': 'Convierte los detalles de la obra en un borrador antes de que se vuelvan más trabajo de oficina después de cenar.',
  'MORE CAPTURED WORK.': 'MÁS TRABAJO REGISTRADO.',
  'FASTER DECISIONS.': 'DECISIONES MÁS RÁPIDAS.',
  'FEWER PAYMENT ARGUMENTS.': 'MENOS DISCUSIONES DE PAGO.',
  'LESS ADMIN.': 'MENOS ADMINISTRACIÓN.',
  'DON’T DO EXTRA WORK ON A': 'NO HAGAS TRABAJO EXTRA CON UN', 'VERBAL YES.': 'SÍ VERBAL.',
  'Capture the request while you’re standing on the job. Price it, send it, and get approval before the work starts.': 'Registra la solicitud en la obra. Ponle precio, envíala y obtén la aprobación antes de comenzar el trabajo.',
  'See how it works': 'Mira cómo funciona', 'Record': 'Graba', 'Review': 'Revisa', 'Send': 'Envía',
  'Approved · $3,850': 'Aprobado · $3,850', '“Can you also move that?”': '“¿También puedes mover eso?”',
  'Put it in writing before it becomes free work.': 'Ponlo por escrito antes de que se convierta en trabajo gratis.',
  'Create account': 'Crear cuenta', 'Create your account': 'Crea tu cuenta', 'Create your account →': 'Crea tu cuenta →',
  'Get the app': 'Descarga la app',
  'VOICE FIRST': 'PRIMERO LA VOZ', 'SPANISH FIRST': 'PRIMERO EL ESPAÑOL', 'NO TRAINING': 'SIN CAPACITACIÓN',
  'The simple jobsite solution': 'La solución sencilla para la obra',
  'IF YOU CAN SEND A VOICE MESSAGE, YOU CAN USE EZCHANGEORDER.': 'SI PUEDES ENVIAR UN MENSAJE DE VOZ, PUEDES USAR EZCHANGEORDER.',
  'IF YOU CAN SEND A VOICE MESSAGE, YOU CAN USE': 'SI PUEDES ENVIAR UN MENSAJE DE VOZ, PUEDES USAR',
  'HABLA EN ESPAÑOL.': 'HABLA EN ESPAÑOL.', 'SEND IT IN ENGLISH.': 'ENVÍALO EN INGLÉS.',
  'Record the client conversation, add your notes and photos, and review what we build. No complicated forms. No new software to learn.': 'Graba la conversación con el cliente, agrega tus notas y fotos, y revisa lo que creamos. Sin formularios complicados. Sin programas nuevos que aprender.',
  'Talk first. Edit after.': 'Habla primero. Edita después.',
  'THE FASTEST WAY FROM “WHILE YOU’RE HERE…” TO APPROVED.': 'LA FORMA MÁS RÁPIDA DE “YA QUE ESTÁS AQUÍ…” A APROBADO.',
  'Say what changed': 'Di qué cambió',
  'Record it in your own words while the details are fresh. Add photos when they help.': 'Grábalo con tus propias palabras mientras recuerdas los detalles. Agrega fotos cuando ayuden.',
  'Review the draft': 'Revisa el borrador',
  'Check the scope, price, exclusions, and schedule impact before anything goes out.': 'Revisa el alcance, el precio, las exclusiones y el impacto en el calendario antes de enviarlo.',
  'Get a real approval': 'Obtén una aprobación real',
  'Your client sees one clear change order and approves it in writing.': 'Tu cliente ve una orden de cambio clara y la aprueba por escrito.',
  'Your work has a price': 'Tu trabajo tiene un precio',
  'A VERBAL YES IS EASY TO FORGET. AN APPROVED PRICE ISN’T.': 'UN SÍ VERBAL SE OLVIDA FÁCIL. UN PRECIO APROBADO NO.',
  'No digging through texts. No rebuilding the story at invoice time. No awkward argument about what the homeowner thought was included.': 'Sin buscar entre mensajes. Sin reconstruir la historia al facturar. Sin discutir sobre lo que el propietario creyó que estaba incluido.',
  'Scope and exclusions in one place': 'Alcance y exclusiones en un solo lugar',
  'Price visible before approval': 'Precio visible antes de aprobar',
  'Clear record of what was sent and seen': 'Registro claro de lo enviado y visto',
  'Guest bathroom · Plumbing reroute': 'Baño de visitas · Desvío de plomería',
  'Schedule impact': 'Impacto en el calendario', '+2 working days': '+2 días laborables',
  'Approved by': 'Aprobado por', 'Homeowner': 'Propietario',
  '✓ Approved before work started': '✓ Aprobado antes de empezar',
  'Work in your native language': 'Trabaja en tu idioma', 'SPEAK IN SPANISH.': 'HABLA EN ESPAÑOL.',
  'SEND IT IN ENGLISH.': 'ENVÍALO EN INGLÉS.',
  'Explain the change the way you naturally speak. EZChangeOrder creates a clear English draft for your client, without making you translate the jobsite conversation yourself.': 'Explica el cambio como hablas naturalmente. EZChangeOrder crea un borrador claro en inglés para tu cliente, sin que tengas que traducir la conversación de la obra.',
  'Speak naturally': 'Habla con naturalidad', 'Review before sending': 'Revisa antes de enviar',
  'Your client gets clear English': 'Tu cliente recibe inglés claro', 'VOICE NOTE · 00:18': 'NOTA DE VOZ · 00:18',
  'CHANGE ORDER DRAFT': 'BORRADOR DE ORDEN', 'Reroute plumbing line': 'Desviar línea de plomería',
  'Move the plumbing line before closing the wall. This work is outside the original scope.': 'Mueva la línea de plomería antes de cerrar la pared. Este trabajo está fuera del alcance original.',
  'Ready to review ✓': 'Listo para revisar ✓', 'Clear for you. Clear for them.': 'Claro para ti. Claro para ellos.',
  'THE HOMEOWNER SEES EXACTLY WHAT THEY’RE APPROVING.': 'EL PROPIETARIO VE EXACTAMENTE LO QUE ESTÁ APROBANDO.',
  'Scope, photos, price, and schedule impact arrive in one simple review page. They can approve or ask a question without downloading another app.': 'El alcance, las fotos, el precio y el impacto en el calendario llegan en una sola página. Pueden aprobar o preguntar sin descargar otra app.',
  'Nothing is final until you send it.': 'Nada es definitivo hasta que lo envías.',
  'Your change-order tool goes where you go': 'Tu herramienta va contigo',
  'GET THE YES.': 'OBTÉN EL SÍ.', 'GET IT IN WRITING.': 'PONLO POR ESCRITO.', 'GET PAID.': 'COBRA.',
  'Capture the change before you leave the room. EZChangeOrder is designed for quick, one-handed use on real residential jobsites.': 'Registra el cambio antes de salir del cuarto. EZChangeOrder está diseñado para usarse rápido y con una mano en obras residenciales reales.',
  'GET THE APP FOR': 'DESCARGA PARA', 'Tap above and we’ll send you the download link.': 'Toca arriba y te enviaremos el enlace de descarga.',
  'Record it': 'Grábalo', 'on the job': 'en la obra', 'Approved': 'Aprobado', 'in writing': 'por escrito',
  'Straight answers': 'Respuestas claras',
  'MADE FOR THE WAY SMALL JOBS ACTUALLY RUN.': 'HECHO PARA COMO REALMENTE FUNCIONAN LOS TRABAJOS PEQUEÑOS.',
  'Do I have to type the whole change order?': '¿Tengo que escribir toda la orden de cambio?',
  'No. Start by talking. EZChangeOrder turns your explanation into a draft you can review and edit.': 'No. Empieza hablando. EZChangeOrder convierte tu explicación en un borrador que puedes revisar y editar.',
  'Can I add jobsite photos?': '¿Puedo agregar fotos de la obra?',
  'Yes. Add photos of the condition, the requested change, or anything else your client should see.': 'Sí. Agrega fotos de la condición, el cambio solicitado o cualquier cosa que tu cliente deba ver.',
  'Does the homeowner need the app?': '¿El propietario necesita la app?',
  'No. They receive a simple client page where they can review the change, ask a question, and approve.': 'No. Reciben una página sencilla donde pueden revisar el cambio, hacer una pregunta y aprobar.',
  'The next “small favor” isn’t free': 'El próximo “pequeño favor” no es gratis',
  'GET THE YES': 'OBTÉN EL SÍ', 'THAT GETS YOU PAID.': 'QUE TE AYUDA A COBRAR.',
  'Document the change before the extra work begins.': 'Documenta el cambio antes de comenzar el trabajo extra.',
  'EZChangeOrder is a Hilo Ventures Studio product.': 'EZChangeOrder es un producto de Hilo Ventures Studio.',
  'Preview onboarding': 'Ver registro',
  'See it happen': 'Míralo en acción',
  'THREE JOBSITE MOMENTS. NINE SECONDS EACH.': 'TRES MOMENTOS EN LA OBRA. NUEVE SEGUNDOS CADA UNO.',
  '01 · PROTECT THE PRICE': '01 · PROTEGE EL PRECIO',
  'Turn “can you also?” into an approved change order.': 'Convierte “¿también puedes?” en una orden de cambio aprobada.',
  '02 · USE YOUR LANGUAGE': '02 · USA TU IDIOMA',
  'Speak naturally. Send your client clear English.': 'Habla con naturalidad. Envía inglés claro a tu cliente.',
  '03 · THE CLIENT PORTAL': '03 · EL PORTAL DEL CLIENTE',
  'Your client reviews the scope, photos, price, and approval in one place.': 'Tu cliente revisa el alcance, las fotos, el precio y la aprobación en un solo lugar.',
  'DON’T LET THE CHANGE': 'NO DEJES QUE EL CAMBIO',
  'GET LOST.': 'SE PIERDA.',
  'Record the client conversation, add field notes, and take as many photos as you need. EZChangeOrder turns it all into a change order you can review and send for approval.': 'Graba la conversación con el cliente, agrega notas de campo y toma todas las fotos que necesites. EZChangeOrder convierte todo en una orden de cambio que puedes revisar y enviar para aprobación.',
  'Capture': 'Captura', 'Build': 'Crea', 'Approve': 'Aprueba',
  'Conversation + notes + photos': 'Conversación + notas + fotos',
  'One complete change order.': 'Una orden de cambio completa.',
  'Capture it all. We organize it.': 'Captúralo todo. Nosotros lo organizamos.',
  'EVERY CONVERSATION. EVERY NOTE. EVERY PHOTO. ONE CHANGE ORDER.': 'CADA CONVERSACIÓN. CADA NOTA. CADA FOTO. UNA ORDEN DE CAMBIO.',
  'Client conversation': 'Conversación con el cliente', 'Field notes': 'Notas de campo',
  'Jobsite photos': 'Fotos de la obra', 'Change order': 'Orden de cambio',
  'Capture the client conversation': 'Captura la conversación con el cliente',
  'Record the conversation with permission, add your own field notes, and take as many photos as you need.': 'Graba la conversación con permiso, agrega tus notas de campo y toma todas las fotos que necesites.',
  'We build the change order': 'Creamos la orden de cambio',
  'EZChangeOrder organizes everything into a clear scope, exclusions, price, and schedule impact.': 'EZChangeOrder organiza todo en un alcance claro, exclusiones, precio e impacto en el calendario.',
  'You review and send': 'Tú revisas y envías',
  'Make any edits, then send the client their portal to ask questions and approve in writing.': 'Haz los cambios necesarios y envía al cliente su portal para preguntar y aprobar por escrito.',
  'Recording · 00:18': 'Grabando · 00:18',
  'The request happens on site': 'La solicitud sucede en la obra',
  'CAPTURE THE CONVERSATION WHILE YOU’RE STANDING THERE.': 'REGISTRA LA CONVERSACIÓN MIENTRAS ESTÁS AHÍ.',
  'The homeowner points to one more thing. Record the conversation, add a quick note, and take photos before you leave. We keep the whole request together and turn it into a change order.': 'El propietario señala una cosa más. Graba la conversación, agrega una nota rápida y toma fotos antes de irte. Mantenemos toda la solicitud junta y la convertimos en una orden de cambio.',
  'The homeowner points to one more thing. Record it, add a note and photos, and keep the whole request together before you leave.': 'El propietario señala una cosa más. Grábala, agrega una nota y fotos, y mantén toda la solicitud junta antes de irte.',
  '“Can you move this bed over and add pavers here?”': '“¿Puedes mover este jardín y agregar adoquines aquí?”',
  'Record with permission where required.': 'Graba con permiso cuando sea necesario.',
  'Nothing falls through the cracks': 'Nada se pierde',
  'THE CONVERSATION MOVES ON. THE DETAILS SHOULD NOT.': 'LA CONVERSACIÓN SIGUE. LOS DETALLES NO DEBEN PERDERSE.',
  'A change may come up while you are walking the job, opening a wall, or answering three questions at once. Keep the whole story together from the start.': 'Un cambio puede surgir mientras recorres la obra, abres una pared o respondes tres preguntas a la vez. Mantén toda la historia junta desde el principio.',
  'Conversations, notes, and photos stay together': 'Las conversaciones, notas y fotos permanecen juntas',
  'A clear draft is built from the field information': 'La información de campo se convierte en un borrador claro',
  'The client sees exactly what they are approving': 'El cliente ve exactamente lo que está aprobando',
  'Small requests add up': 'Las solicitudes pequeñas se acumulan',
  'NO REQUEST IS TOO SMALL TO CAPTURE.': 'NINGUNA SOLICITUD ES DEMASIADO PEQUEÑA PARA REGISTRAR.',
  'Big changes get documented because they are impossible to miss. Lost revenue hides in the quick requests that feel too small to record, then quietly turn into hours or days of extra work.': 'Los cambios grandes se documentan porque son imposibles de ignorar. Los ingresos perdidos se esconden en solicitudes rápidas que parecen demasiado pequeñas para registrar y terminan convirtiéndose en horas o días de trabajo extra.',
  '“While you’re here, can you also…”': '“Ya que estás aquí, ¿también puedes…?”',
  '“It should only take a minute…”': '“Solo debería tomar un minuto…”',
  '“Can you come back and finish one more thing?”': '“¿Puedes volver y terminar una cosa más?”',
  'SMALL FIELD REQUESTS': 'SOLICITUDES PEQUEÑAS EN OBRA',
  'NOT YET CAPTURED': 'AÚN SIN REGISTRAR',
  '“While you’re here…”': '“Ya que estás aquí…”',
  'Move one outlet': 'Mover un tomacorriente', '1.5 hr': '1.5 h',
  'Patch the opened wall': 'Reparar la pared abierta', '3 hr': '3 h',
  'Add a little more trim': 'Agregar un poco más de moldura', '2.5 hr': '2.5 h',
  'Install extra blocking': 'Instalar refuerzo adicional', '2 hr': '2 h',
  'Material run': 'Viaje por materiales', 'Return and finish': 'Regresar y terminar', '5 hr': '5 h',
  '16 HOURS': '16 HORAS', '= 2 extra working days': '= 2 días extra de trabajo',
  'Built for subcontractors, too': 'Hecho también para subcontratistas',
  'THE WALL CLOSES. YOUR PROOF SHOULDN’T.': 'LA PARED SE CIERRA. TU PRUEBA NO DEBE DESAPARECER.',
  'The GC asks you to reroute a circuit or add another outlet after rough-in. You do the work now, but weeks later the direction is disputed or the approval is still “coming.” Record the conversation, notes, and photos before the work gets covered, then send a clear change order for approval.': 'El contratista general te pide desviar un circuito o agregar otro tomacorriente después de la instalación inicial. Haces el trabajo ahora, pero semanas después cuestionan la instrucción o la aprobación todavía está “por llegar”. Graba la conversación, las notas y las fotos antes de que cubran el trabajo, y luego envía una orden de cambio clara para aprobación.',
  'The GC asks for a reroute after rough-in. Capture the direction before drywall covers the work, then send the change order for approval.': 'El contratista general pide un desvío después de la instalación inicial. Registra la instrucción antes de que el panel de yeso cubra el trabajo y luego envía la orden de cambio para aprobación.',
  'THE FIELD PROMISE': 'LA PROMESA EN OBRA',
  '“Do it now. We’ll sort out the change order later.”': '“Hazlo ahora. Después arreglamos la orden de cambio.”',
  'That is where payment gets delayed or denied.': 'Ahí es cuando el pago se retrasa o se rechaza.',
  'EXTRA ELECTRICAL WORK': 'TRABAJO ELÉCTRICO ADICIONAL',
  'Captured before drywall': 'Registrado antes del panel de yeso',
  'SEE THE WHOLE CHANGE-ORDER FLOW IN MOTION.': 'MIRA TODO EL PROCESO DE LA ORDEN DE CAMBIO EN MOVIMIENTO.',
  'THE CLIENT GETS A PORTAL. YOU GET A CLEAR APPROVAL.': 'EL CLIENTE RECIBE UN PORTAL. TÚ RECIBES UNA APROBACIÓN CLARA.',
  'Every change order opens in a simple client portal with the reason for the change, scope, exclusions, photos, price, schedule impact, questions, and approval. The client does not need to download an app.': 'Cada orden de cambio se abre en un portal sencillo con el motivo, alcance, exclusiones, fotos, precio, impacto en el calendario, preguntas y aprobación. El cliente no necesita descargar una app.',
  'CAPTURE IT.': 'CAPTÚRALO.', 'TURN IT INTO A CO.': 'CONVIÉRTELO EN UNA ORDEN.', 'SEND IT.': 'ENVÍALO.',
  'Bring the entire field record with you: the client conversation, your notes, and every useful photo. EZChangeOrder is designed for quick, one-handed use on real residential jobsites.': 'Lleva contigo todo el registro de campo: la conversación con el cliente, tus notas y cada foto útil. EZChangeOrder está diseñado para usarse rápido y con una mano en obras residenciales reales.',
  'Can I record the conversation with my client?': '¿Puedo grabar la conversación con mi cliente?',
  'Yes. With permission where required, you can capture the client conversation, then add your own notes and photos before reviewing the draft.': 'Sí. Con permiso cuando sea necesario, puedes capturar la conversación, agregar tus notas y fotos, y luego revisar el borrador.',
  'From field conversation to client approval': 'De la conversación en obra a la aprobación del cliente',
  'CAPTURE THE CHANGE.': 'CAPTURA EL CAMBIO.', 'WE’LL BUILD THE CO.': 'NOSOTROS CREAMOS LA ORDEN.',
  'Review it, send it, and keep the whole jobsite story together.': 'Revísala, envíala y mantén toda la historia de la obra junta.'
  ,'01 · CAPTURE THE CONVERSATION': '01 · CAPTURA LA CONVERSACIÓN'
  ,'Keep the client request, your notes, and jobsite photos together.': 'Mantén juntas la solicitud del cliente, tus notas y las fotos de la obra.'
  ,'01 · NO REQUEST IS TOO SMALL': '01 · NINGUNA SOLICITUD ES DEMASIADO PEQUEÑA'
  ,'Capture every “while you’re here,” before the small asks add up.': 'Registra cada “ya que estás aquí” antes de que las pequeñas solicitudes se acumulen.'
  ,'Never leave a change unaccounted for': 'Nunca dejes un cambio sin registrar'
  ,'CAPTURE EVERY CHANGE.': 'REGISTRA CADA CAMBIO.'
  ,'BIG OR SMALL.': 'GRANDE O PEQUEÑO.'
  ,'We turn the field conversation, your notes, and your photos into a change order ready to send.': 'Convertimos la conversación en obra, tus notas y tus fotos en una orden de cambio lista para enviar.'
}));

const originalText = new WeakMap();
const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
  acceptNode(node) {
    return node.parentElement?.closest('script, style') || !node.nodeValue.trim()
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
  }
});
const textNodes = [];
while (walker.nextNode()) {
  originalText.set(walker.currentNode, walker.currentNode.nodeValue);
  textNodes.push(walker.currentNode);
}

function setLanguage(lang) {
  document.documentElement.lang = lang;
  textNodes.forEach((node) => {
    const source = originalText.get(node);
    const key = source.trim();
    node.nodeValue = lang === 'es' && spanish.has(key)
      ? source.replace(key, spanish.get(key)) : source;
  });
  document.querySelectorAll('.lang-button').forEach((item) => {
    const active = item.dataset.lang === lang;
    item.classList.toggle('active', active);
    item.setAttribute('aria-pressed', String(active));
  });
  document.title = lang === 'es'
    ? 'EZChangeOrder | No pierdas dinero por un sí verbal'
    : 'EZChangeOrder | Never lose money on a verbal yes';
  localStorage.setItem('ezco-language', lang);
}

document.querySelectorAll('.lang-button').forEach((item) => {
  item.addEventListener('click', () => setLanguage(item.dataset.lang));
});

setLanguage(localStorage.getItem('ezco-language') === 'es' ? 'es' : 'en');

const shortVideos = document.querySelectorAll('.short-card video');
const videoObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) entry.target.play().catch(() => {});
    else entry.target.pause();
  });
}, { threshold: 0.35 });
shortVideos.forEach((video) => videoObserver.observe(video));

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if (!reduceMotion) {
  document.documentElement.classList.add('motion-ready');
  const revealGroups = [
    ['.section-heading, .field-conversation-copy, .money-copy, .subcontractor-copy, .language-copy, .client-copy, .download-copy', 'from-left'],
    ['.workflow-image, .field-conversation-photo, .money-card, .subcontractor-photo, .translation-demo, .client-image, .phone-stage', 'from-right'],
    ['.steps li, .faq-list details, .short-card, .value-card', '']
  ];
  const revealItems = [];
  revealGroups.forEach(([selector, direction]) => {
    document.querySelectorAll(selector).forEach((item, index) => {
      item.classList.add('reveal-item');
      if (direction) item.classList.add(direction);
      item.style.setProperty('--reveal-delay', `${Math.min(index % 4, 3) * 85}ms`);
      revealItems.push(item);
    });
  });
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.14, rootMargin: '0px 0px -7% 0px' });
  revealItems.forEach((item) => observer.observe(item));
}
