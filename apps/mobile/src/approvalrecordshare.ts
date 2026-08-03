/**
 * R6 / R5b AC3 / R6c AC3 — produce and share the approval document for one extra.
 *
 * The boring half of `approvalpdf.ts`: read local rows, translate the keys into the
 * reader's language, write the file, hand it to the OS share sheet. Every decision
 * about what the document CONTAINS lives in the pure module and is unit-tested
 * there; nothing here chooses what goes in the signed block.
 *
 * ─── HOW THIS DIFFERS FROM bundle.ts, WHICH ALREADY EXPORTS EVIDENCE ─────────
 * `bundle.ts` is the DISPUTE bundle (§7.3): every extra on a job, assembled
 * server-side because only the server holds every party's acts, and useless
 * offline. This is R6's per-extra artifact — "PDF generated to both parties
 * includes the discussion log beneath the approved snapshot" — which a contractor
 * hands over one item at a time, and which must work with no signal. Two documents,
 * two audiences, one shared rule: assemble, never re-render.
 *
 * ─── WHY THIS EMITS HTML AND NOT PDF BYTES, SAID PLAINLY ────────────────────
 * There is no PDF library in this app and adding a dependency is not this change's
 * call. `expo-print`'s `printToFileAsync({ html })` turns exactly this string into a
 * PDF; when it is added, the change is one import and one line in `writeApprovalDoc`
 * below, and nothing in `approvalpdf.ts` moves. Until then the document is real,
 * offline, shareable and printable from any phone — it is just not a .pdf, and this
 * file does not claim it is. bundle.ts already ships an .html artifact for the same
 * reason, so this is the existing answer rather than a new one.
 *
 * ─── MANDATE #2 ─────────────────────────────────────────────────────────────
 * Nothing here sends anything to a client. It writes a file and opens the OS share
 * sheet, which is a human choosing a recipient. There is no code path that
 * transmits, and there must never be one: this document carries a price.
 */
import { AbstractPowerSyncDatabase } from '@powersync/react-native';
import * as FS from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import { sha256 } from 'js-sha256';
import { createdLabel, money } from './changeorder';
import { versionNumber } from './ledgerstatus';
import { listRoster } from './approvers';
import { snapshotVerifies } from './eventtimeline';
import { decisionSummaryFor } from './decisionsummarydata';
import { threadFor } from './discussionstore';
import { readEventLog } from './eventlog';
import { t } from './i18n';
import {
  approvalDocument, renderApprovalHtml,
  type ApprovalDoc, type CoLineItem, type CoParty, type DiscussionEntry, type PdfLabels,
} from './approvalpdf';

/**
 * The schedule and payment terms as sentences.
 *
 * WORDED IDENTICALLY TO `flowTermLines`, deliberately. That function composes the
 * terms that go INTO the frozen instrument; this document prints them beside it. Two
 * wordings of one term is how a printed change order and the text somebody signed
 * start disagreeing — so if these ever need to change, change both.
 */
function scheduleSentenceFor(effect: string | null, days: number | null): string | null {
  if (effect === 'no_change') return 'No change to the schedule.';
  if (effect === 'adds_days') {
    return typeof days === 'number' && days > 0
      ? `Adds ${days} day${days === 1 ? '' : 's'} to the schedule.`
      : 'Adds days to the schedule.';
  }
  if (effect === 'not_sure') return 'Schedule impact: to be confirmed.';
  return null;
}

function billingSentenceFor(timing: string | null): string | null {
  if (timing === 'next_invoice') return 'Billed on the next invoice.';
  if (timing === 'when_completed') return 'Payment is due when the work is completed.';
  if (timing === 'other') return 'Payment timing as discussed.';
  return null;
}

/** Every heading, resolved in the reader's language at the moment of export
 *  (mandate #5). Built here rather than in the pure module because t() reads
 *  module-level state and the pure module may not import anything. */
function labels(signedName: string | null, traced: number): PdfLabels {
  return {
    signedHeading: t('r6c.pdfSigned'),
    unsignedHeading: t('r6c.pdfUnsigned'),
    signedByLine: signedName
      ? t({ k: 'r6c.pdfSignedBy', p: { name: signedName } } as any)
      : t('r6c.pdfUnsigned'),
    co: {
      docTitle: t('co.doc.title'),
      numberLabel: t('co.doc.number'),
      versionLabel: t('co.doc.version'),
      dateLabel: t('co.doc.date'),
      fromLabel: t('co.doc.from'),
      toLabel: t('co.doc.to'),
      projectLabel: t('co.doc.project'),
      descriptionHeading: t('co.doc.description'),
      itemsHeading: t('co.doc.items'),
      qtyLabel: t('co.doc.qty'),
      unitLabel: t('co.doc.unit'),
      amountLabel: t('co.doc.amount'),
      totalLabel: t('co.doc.total'),
      nteLabel: t('co.doc.nte'),
      includedHeading: t('co.doc.included'),
      excludedHeading: t('co.doc.excluded'),
      nothingExcluded: t('co.doc.nothingExcluded'),
      scheduleHeading: t('co.doc.schedule'),
      paymentHeading: t('co.doc.payment'),
      authHeading: t('co.doc.auth'),
      authBody: t('co.doc.authBody'),
      signContractor: t('co.doc.signContractor'),
      signClient: t('co.doc.signClient'),
      signDate: t('co.doc.signDate'),
      noPrice: t('co.doc.noPrice'),
    },
    integrityOk: t('r6c.pdfHashOk'),
    integrityFailed: t('r6c.pdfHashBad'),
    discussionHeading: t('r6c.pdfDiscussion'),
    clientLabel: t('r6c.pdfClient'),
    contractorLabel: t('r6c.pdfContractor'),
    summaryHeading: t('r6c.title'),
    derivedNote: t({ k: 'r6c.derived', p: { n: traced } } as any),
    owedLabel: t('r6c.owedLabel'),
    footer: t('r6c.pdfFooter'),
  };
}

/**
 * Assemble the document for one extra from what this device holds.
 *
 * LOCAL ONLY, and deliberately not hydrating first: `hydrateEventLog` is the
 * caller's job on the record screen, and making an export depend on a fetch would
 * mean a contractor standing in a basement cannot hand over the approval he is
 * being asked about. What is on the device is what goes in the document, and the
 * snapshot's integrity line says whether it still matches its frozen hash.
 */
export async function buildApprovalDoc(
  db: AbstractPowerSyncDatabase, changeOrderId: string
): Promise<{ doc: ApprovalDoc; labels: PdfLabels } | null> {
  const co = (await db.getAll<{
    scope: string; summary: string | null; line_items: string | null;
    amount_cents: number | null; nte_cents: number | null;
    billing_timing: string | null; schedule_effect: string | null;
    schedule_days: number | null; exclusions: string | null;
    who_directed: string; created_at_ms: number; project_id: string; co_number: number | null;
    job_name: string | null; job_address: string | null;
  }>(
    `SELECT c.scope, c.summary, c.line_items, c.amount_cents, c.nte_cents,
            c.billing_timing, c.schedule_effect, c.schedule_days, c.exclusions,
            c.who_directed, c.created_at_ms, c.project_id, c.co_number,
            (SELECT p.name FROM project p WHERE p.id = c.project_id) AS job_name,
            (SELECT p.address FROM project p WHERE p.id = c.project_id) AS job_address
       FROM change_order c WHERE c.id = ?`, [changeOrderId]))[0];
  if (!co) return null;

  const { snapshot } = await readEventLog(db, changeOrderId);
  const messages = await threadFor(db, changeOrderId);
  const summary = await decisionSummaryFor(db, changeOrderId);

  const discussion: DiscussionEntry[] = messages.map((m) => ({
    side: m.side, text: m.text, atLabel: createdLabel(m.atMs),
  }));

  // ── the parties ──
  // The contractor is the company on this device; the client is the roster row the
  // extra was directed to. Both are best-effort: a document that omits a phone number
  // it does not have is honest, one that prints an empty label is not.
  let contractorParty: CoParty | null = null;
  try {
    const c = (await db.getAll<{ name: string }>(
      `SELECT name FROM company LIMIT 1`))[0];
    if (c?.name) contractorParty = { name: c.name };
  } catch { /* no company row yet — the From block simply prints a dash */ }

  let clientParty: CoParty | null = null;
  try {
    const want = (co.who_directed ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (want) {
      const roster = await listRoster(db, co.project_id);
      const m = roster.find(
        (x) => x.name.trim().toLowerCase().replace(/\s+/g, ' ') === want);
      clientParty = m
        ? { name: m.name, phone: m.phone, email: m.email }
        // Named on the extra but not on the roster: still print the name. Who the
        // change is FOR is the one field a change order cannot be silent about.
        : { name: co.who_directed };
    }
  } catch { clientParty = co.who_directed ? { name: co.who_directed } : null; }

  // The extra's real number on its job (`co_number`). Omitted when a pre-migration row
  // has not been backfilled — the document prints no number rather than a wrong one.
  const extraNo: string | null = co.co_number == null ? null : String(co.co_number);

  // ── the change order's own face ──
  // Every field is taken from what is STORED. Nothing here is invented: a party we
  // have no phone for prints no phone line, and a price nobody gave prints in words.
  let items: CoLineItem[] = [];
  try {
    const raw = JSON.parse(co.line_items ?? '[]');
    if (Array.isArray(raw)) {
      items = raw.map((li: any) => ({
        description: String(li.description ?? ''),
        qty: Number(li.qty ?? 0),
        unit: money(Number(li.unit_cents ?? 0)),
        amount: money(Number(li.total_cents ?? 0)),
      }));
    }
  } catch { /* an unparseable breakdown prints as no breakdown, never as a wrong one */ }

  const client = clientParty ?? null;
  const version = await versionNumber(db, changeOrderId);

  const doc = approvalDocument({
    title: co.scope,
    co: {
      number: extraNo,
      version,
      dateLabel: createdLabel(co.created_at_ms),
      contractor: contractorParty,
      client,
      projectName: co.job_name,
      projectAddress: co.job_address,
      // The client-facing scope — the same text the instrument carries, which is why
      // it is read from `scope` and not from the mutable `summary`.
      description: co.scope,
      items,
      total: co.amount_cents == null ? null : money(co.amount_cents),
      nte: co.nte_cents == null ? null : money(co.nte_cents),
      // "Included" is the scope itself unless a breakdown says more; the app stores no
      // separate inclusions list, so it is not invented here.
      included: [co.scope],
      excluded: co.exclusions?.trim() ? [co.exclusions.trim()] : [],
      scheduleLine: scheduleSentenceFor(co.schedule_effect, co.schedule_days),
      paymentLine: billingSentenceFor(co.billing_timing),
    },
    snapshot: snapshot ? {
      content: snapshot.content,
      sha256: snapshot.sha256,
      signedName: snapshot.signedName,
      signedAtLabel: snapshot.answeredAtMs === null ? null : createdLabel(snapshot.answeredAtMs),
      action: snapshot.action,
      // Hashed HERE, on the exact bytes about to be written into the file, using
      // the same two functions the record screen uses (eventlog.withEventLog). A
      // document that asserted "matches the frozen copy" without checking would be
      // the worst possible line in this app: an integrity claim that is itself
      // unverified, printed on the page a dispute turns on.
      verified: snapshotVerifies(sha256(snapshot.content), snapshot.sha256),
    } : null,
    discussion,
    // R6c AC3 lives one line up, in approvalDocument: the summary goes in as a
    // non-binding block and cannot be constructed as anything else.
    summary: summary ? {
      lines: summary.clauses.map((c) => t({ k: c.k, p: c.p } as any)),
      owed: t({ k: summary.owed.k, p: summary.owed.p } as any),
    } : null,
  });

  return { doc, labels: labels(snapshot?.signedName ?? null, summary?.traced ?? 0) };
}

/** Render to a file in the app's document directory. Returns the path. */
export async function writeApprovalDoc(
  db: AbstractPowerSyncDatabase, changeOrderId: string
): Promise<string | null> {
  const built = await buildApprovalDoc(db, changeOrderId);
  if (!built) return null;
  const html = renderApprovalHtml(built.doc, built.labels);
  // Timestamped, never overwritten: two exports of the same extra a week apart are
  // two documents, and the older one may already be in somebody's inbox. Colons are
  // stripped because they are not legal in a filename on every platform.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = `${FS.documentDirectory}approval-${changeOrderId}-${stamp}.html`;
  await FS.writeAsStringAsync(path, html);
  return path;
}

/**
 * Write it and open the share sheet. Mirrors `bundle.shareBundle` down to the
 * failure message: when sharing is unavailable the file is still on disk and the
 * caller is told where, rather than being told nothing happened.
 */
export async function shareApprovalDoc(
  db: AbstractPowerSyncDatabase, changeOrderId: string
): Promise<{ ok: boolean; path?: string; reasonKey?: string }> {
  const htmlPath = await writeApprovalDoc(db, changeOrderId);
  if (!htmlPath) return { ok: false, reasonKey: 'r6c.pdfNoRecord' };

  // R3 AC1 / R6: a PDF, because that is what a client forwards to a lawyer and what
  // an office files. printToFileAsync takes exactly the HTML renderApprovalHtml
  // already produces, so nothing about the DOCUMENT changes here — only its
  // container.
  //
  // The HTML is still written first and still returned on failure. If PDF generation
  // is unavailable for any reason, the record is already on disk in a readable form
  // and the caller is told where. Losing the export because the wrapper failed would
  // be the wrong trade for a document whose whole purpose is to survive a dispute.
  let path = htmlPath;
  let mimeType = 'text/html';
  try {
    const { uri } = await Print.printToFileAsync({ html: await FS.readAsStringAsync(htmlPath) });
    if (uri) { path = uri; mimeType = 'application/pdf'; }
  } catch { /* keep the HTML; it is the same document in a plainer wrapper */ }

  if (!(await Sharing.isAvailableAsync())) {
    return { ok: false, path, reasonKey: 'r6c.pdfNoShare' };
  }
  await Sharing.shareAsync(path, { mimeType, dialogTitle: t('r6c.pdfDialog') });
  return { ok: true, path };
}
