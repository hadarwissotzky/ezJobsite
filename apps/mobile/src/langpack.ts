/**
 * EVERY WORD A CLIENT READS, IN EVERY LANGUAGE A SEND CAN CHOOSE.
 *
 * LANGUAGE-LAYER slice 2 (hadar, 2026-09-03: "when sent the user is asked what language
 * it should be sent as"). Until now the counterparty-facing chrome — the instrument's
 * headings, the terms sentences, the SMS — was English string literals scattered across
 * three files. A send in Spanish means every one of those words must exist in Spanish,
 * and scattering the Spanish beside each literal is how one of them gets missed and a
 * signed document comes out half-translated.
 *
 * ONE MODULE, NO IMPORTS, dependency-free on purpose (the same rule as money.ts): it is
 * read by confirmations.ts, flowterms.ts and clientsms.ts, all of which node --test
 * loads directly.
 *
 * THE LANGUAGES HERE ARE REVIEWED, exactly like SCOPE_HEADINGS in the worker: a send
 * language exists only when a human who speaks it has signed off on these sentences,
 * because they appear inside a frozen, signable instrument. Adding a key without adding
 * it to every language is a type error, not a runtime surprise.
 *
 * NUMBERS NEVER LIVE HERE. Every figure is interpolated from the same `money()` output
 * in every language (mandate #6) — the words around a number may change, the number may
 * not.
 */

export type SendLang = 'en' | 'es';
export const SEND_LANGS: SendLang[] = ['en', 'es'];

export function asSendLang(v: string | null | undefined): SendLang {
  return v === 'es' ? 'es' : 'en';
}

type Pack = {
  // ── the instrument (renderCard) ──
  coHeader: string;
  coSubheader: string;
  scopeHeading: string;
  fromHeading: string;
  jobLabel: string;
  directedByLabel: string;
  dateLabel: string;
  termsHeading: string;
  priceLabel: string;
  priceTm: string;          // suffix after a T&M price
  nteLabel: string;
  nteSentence: (nte: string) => string;
  nothingProceeds: string;
  confirmAsk: string;
  acknowledgeAsk: string;
  recordedLabel: string;
  // ── the terms lines (flowTermLines) ──
  notIncluded: (list: string) => string;
  billedNextInvoice: string;
  billedWhenCompleted: string;
  billedAsDiscussed: string;
  scheduleNoChange: string;
  scheduleAddsN: (n: number) => string;
  scheduleAdds: string;
  scheduleTbc: string;
  // ── the SMS (clientSmsBody) ──
  yourContractor: string;
  smsEwa: (who: string, amount: string) => string;
  smsAcknowledge: (who: string) => string;
  smsChangeOrder: (who: string, amount: string) => string;
  smsCheckConfirm: (who: string) => string;
  smsJob: (job: string) => string;
  smsCta: (url: string) => string;
  smsClosing: string;
};

export const LANG_PACK: Record<SendLang, Pack> = {
  en: {
    coHeader: 'CHANGE ORDER — APPROVAL REQUESTED',
    coSubheader: 'An extra outside the original scope.',
    scopeHeading: 'SCOPE OF WORK',
    fromHeading: 'FROM',
    jobLabel: 'Job',
    directedByLabel: 'Directed by',
    dateLabel: 'Date',
    termsHeading: 'TERMS',
    priceLabel: 'Price',
    priceTm: ' (time & materials)',
    nteLabel: 'Not to exceed',
    nteSentence: (nte) => `Work will not exceed ${nte} without a new approval.`,
    nothingProceeds: 'Nothing proceeds until you approve.',
    confirmAsk: 'Please confirm this is what we agreed.',
    acknowledgeAsk: 'Please acknowledge you directed this.',
    recordedLabel: 'Recorded',
    notIncluded: (l) => `Not included: ${l}`,
    billedNextInvoice: 'Billed on the next invoice.',
    billedWhenCompleted: 'Payment is due when the work is completed.',
    billedAsDiscussed: 'Payment timing as discussed.',
    scheduleNoChange: 'Schedule: no change.',
    scheduleAddsN: (n) => `Schedule: adds ${n} day${n === 1 ? '' : 's'}.`,
    scheduleAdds: 'Schedule: adds days.',
    scheduleTbc: 'Schedule impact: to be confirmed.',
    yourContractor: 'Your contractor',
    smsEwa: (who, amount) => `${who} sent you an extra work authorization to review and sign${amount}.`,
    smsAcknowledge: (who) => `${who} asked you to acknowledge something on your job.`,
    smsChangeOrder: (who, amount) => `${who} sent you a change order to approve${amount}.`,
    smsCheckConfirm: (who) => `${who} sent you something to check and confirm.`,
    smsJob: (job) => `\nJob: ${job}`,
    smsCta: (url) => `\n\nOpen it here. No app or account needed:\n${url}`,
    smsClosing: '\n\nNothing proceeds until you approve.',
  },
  es: {
    coHeader: 'ORDEN DE CAMBIO — SE SOLICITA APROBACIÓN',
    coSubheader: 'Un trabajo extra fuera del alcance original.',
    scopeHeading: 'ALCANCE DE TRABAJO',
    fromHeading: 'DE',
    jobLabel: 'Obra',
    directedByLabel: 'Solicitado por',
    dateLabel: 'Fecha',
    termsHeading: 'CONDICIONES',
    priceLabel: 'Precio',
    priceTm: ' (tiempo y materiales)',
    nteLabel: 'Tope máximo',
    nteSentence: (nte) => `El trabajo no excederá ${nte} sin una nueva aprobación.`,
    nothingProceeds: 'Nada procede hasta que usted apruebe.',
    confirmAsk: 'Por favor confirme que esto es lo que acordamos.',
    acknowledgeAsk: 'Por favor confirme que usted solicitó esto.',
    recordedLabel: 'Registrado',
    notIncluded: (l) => `No incluye: ${l}`,
    billedNextInvoice: 'Se factura en la próxima factura.',
    billedWhenCompleted: 'El pago se debe al completar el trabajo.',
    billedAsDiscussed: 'Plazo de pago según lo conversado.',
    scheduleNoChange: 'Cronograma: sin cambio.',
    scheduleAddsN: (n) => `Cronograma: agrega ${n} día${n === 1 ? '' : 's'}.`,
    scheduleAdds: 'Cronograma: agrega días.',
    scheduleTbc: 'Impacto en el cronograma: por confirmar.',
    yourContractor: 'Su contratista',
    /**
     * THE SMS SPANISH IS DELIBERATELY UNACCENTED. GSM-7's charset carries é, ñ, ü —
     * but NOT á, í, ó, ú, and one of those re-encodes the whole message as UCS-2,
     * cutting the per-segment budget from 153 to 67 characters. clientsms.ts fights
     * for a two-segment ceiling line by line; "envió" would cost a third segment on
     * every Spanish send. Unaccented Spanish is ordinary in SMS and reads fine; the
     * INSTRUMENT keeps its full accents because it is a web page, not a text message.
     */
    smsEwa: (who, amount) => `Tiene una autorizacion de trabajo extra de ${who} para revisar y firmar${amount}.`,
    smsAcknowledge: (who) => `${who} le pide confirmar algo en su obra.`,
    smsChangeOrder: (who, amount) => `Tiene una orden de cambio de ${who} para aprobar${amount}.`,
    smsCheckConfirm: (who) => `Tiene algo de ${who} para revisar y confirmar.`,
    smsJob: (job) => `\nObra: ${job}`,
    smsCta: (url) => `\n\nAbralo aqui. Sin app ni cuenta:\n${url}`,
    smsClosing: '\n\nNada procede hasta que usted apruebe.',
  },
};
