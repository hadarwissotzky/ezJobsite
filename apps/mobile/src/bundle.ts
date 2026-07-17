/**
 * Dispute bundle export — §7.3 / EVID-3.
 *
 * The moment this exists for: someone says "I never agreed to that", and a
 * contractor has to answer. Everything else in this codebase -- the append-only
 * triggers, the frozen shown_content, the GPS stamps, the media hashes -- is
 * scaffolding for this artefact.
 *
 * TWO RULES:
 *
 * 1. ASSEMBLE, NEVER RE-RENDER. Every value comes from the row it was written to.
 *    shown_content is the frozen text the signer actually read, not the change
 *    order re-rendered as it stands today. A bundle that regenerates its evidence
 *    proves nothing in the only moment it is used.
 *
 * 2. SAY WHAT IT CANNOT PROVE, FIRST. The limitations go at the TOP of the
 *    document, before the evidence. A bundle that overclaims gets a contractor
 *    humiliated by the first person who asks what it actually establishes -- and
 *    that is worse than having no bundle, because they relied on it.
 */
import { SupabaseClient } from '@supabase/supabase-js';
import * as FS from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

export type BundleResult =
  | { ok: true; json: any; path: string; htmlPath: string }
  | { ok: false; reason: string };

/** Assemble from the server: it is the only place that holds every party's acts. */
export async function buildDisputeBundle(
  supabase: SupabaseClient, projectId: string
): Promise<BundleResult> {
  const { data, error } = await supabase.rpc('dispute_bundle', { p_project_id: projectId });
  if (error) return { ok: false, reason: error.message };
  if (!data) return { ok: false, reason: 'empty bundle' };

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = `${FS.documentDirectory}bundle-${projectId}-${stamp}`;
  const path = `${base}.json`;
  const htmlPath = `${base}.html`;

  // JSON is the record. HTML is for reading. Both, because a bundle nobody can
  // read is filed and forgotten, and a bundle that is only prose cannot be checked.
  await FS.writeAsStringAsync(path, JSON.stringify(data, null, 2));
  await FS.writeAsStringAsync(htmlPath, renderBundleHtml(data));
  return { ok: true, json: data, path, htmlPath };
}

const esc = (s: any) =>
  String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/**
 * A document a person can read. Deliberately plain: this may be printed, emailed
 * to a lawyer, or read on a phone in a truck. No cleverness.
 */
export function renderBundleHtml(b: any): string {
  const decisions = (b.decisions ?? []).map((d: any) => `
    <section>
      <h3>${esc(d.subject)}</h3>
      <p class="now">Currently: <strong>${esc(d.current_value)}</strong></p>
      <table>
        <tr><th>Value</th><th>Directed by</th><th>When</th></tr>
        ${(d.history ?? []).map((h: any, i: number) => `
          <tr class="${i === 0 ? 'current' : 'superseded'}">
            <td>${esc(h.value)}</td><td>${esc(h.directed_by ?? '—')}</td>
            <td>${esc(h.at)}</td>
          </tr>`).join('')}
      </table>
      ${(d.history ?? []).length > 1
        ? `<p class="note">This decision changed ${(d.history.length - 1)} time(s).
             Superseded values are shown because they are part of the record.</p>`
        : ''}
    </section>`).join('');

  const cos = (b.change_orders ?? []).map((c: any) => `
    <section>
      <h3>${esc(c.scope)} — ${esc(c.amount)}</h3>
      <p class="meta">${esc(c.status)} · directed by ${esc(c.who_directed)}
        ${c.nte ? ` · not to exceed ${esc(c.nte)}` : ''}</p>
      ${(c.line_items ?? []).length ? `
        <table>
          <tr><th>Item</th><th>Qty</th><th>Each</th><th>Total</th></tr>
          ${c.line_items.map((li: any) => `
            <tr><td>${esc(li.description)}</td><td>${esc(li.qty)}</td>
                <td>${money(li.unit_cents)}</td><td>${money(li.total_cents)}</td></tr>`).join('')}
        </table>
        <p class="${c.lines_agree_with_total ? 'ok' : 'bad'}">
          ${c.lines_agree_with_total
            ? 'The line items add up to the total.'
            : 'WARNING: the line items do NOT add up to the total.'}
        </p>` : ''}
      <p class="meta">Figure confirmed by a person at ${esc(c.numbers_confirmed_at)}</p>
      ${(c.approvals ?? []).map((a: any) => `
        <div class="approval">
          <p><strong>${a.action === 'approved' ? 'APPROVED' : 'DECLINED'}</strong>
             by ${esc(a.legal_name ?? a.signer_label)} at ${esc(a.signed_at)}</p>
          <p class="meta">Identity: code verified to ${esc(a.phone_e164)} at
             ${esc(a.otp_verified_at)} · ${esc(a.user_agent ?? 'unknown device')}</p>
          <p class="meta">This is the exact text they were shown and signed
             (SHA-256 ${esc(String(a.shown_sha256).slice(0, 16))}…):</p>
          <pre>${esc(a.shown_content)}</pre>
        </div>`).join('')}
      ${!(c.approvals ?? []).length ? '<p class="meta">No signature on this change order.</p>' : ''}
    </section>`).join('');

  // REQ-VAL7 for a READER. The JSON carried this a commit ago; the HTML is what a
  // person actually opens, and "nobody said who owned this" is the sentence the
  // whole section exists to put in front of them.
  const resp = (b.responsibility ?? []).map((r: any) => `
    <section class="${r.nobody_owns_this ? 'gap' : ''}">
      <h3>${esc(r.subject)}</h3>
      <p class="${r.nobody_owns_this ? 'bad' : 'ok'}">
        ${r.nobody_owns_this
          ? 'NOBODY was recorded as owning this.'
          : `Assigned to <strong>${esc(r.assigned_to)}</strong>`}
      </p>
      ${(r.trades ?? []).length
        ? `<p class="meta">Trades that touch it: ${(r.trades ?? []).map(esc).join(', ')}</p>` : ''}
      ${(r.history ?? []).length > 1 ? `
        <table>
          <tr><th>Assigned to</th><th>By</th><th>When</th></tr>
          ${r.history.map((h: any, i: number) => `
            <tr class="${i === 0 ? 'current' : 'superseded'}">
              <td>${esc(h.assigned_to)}</td><td>${esc(h.by ?? '—')}</td><td>${esc(h.at)}</td>
            </tr>`).join('')}
        </table>
        <p class="note">This changed ${r.history.length - 1} time(s). Earlier answers are
          shown because they are part of the record.</p>` : ''}
    </section>`).join('');

  const parties = (b.parties ?? []).map((p: any) => `
    <tr><td>${esc(p.name)}</td><td>${esc(p.trade)}</td>
        <td>${esc(p.scope_of_work ?? '—')}</td></tr>`).join('');

  const confs = (b.confirmations ?? []).map((c: any) => `
    <section>
      <h3>${esc(c.kind)} — ${esc(c.counterparty)}</h3>
      <p class="meta">sent ${esc(c.sent_at)} via ${esc(c.channel)} · delivery: ${esc(c.delivery_state)}</p>
      <pre>${esc(c.shown_content)}</pre>
      <p>${c.response
        ? `<strong>${esc(c.response.action)}</strong> at ${esc(c.response.at)}
           ${c.response.note ? `— “${esc(c.response.note)}”` : ''}`
        : 'No response recorded.'}</p>
    </section>`).join('');

  const caps = (b.captures ?? []).map((c: any) => `
    <tr>
      <td>${esc(c.modality ?? '—')}</td>
      <td>${esc(c.captured_at)}</td>
      <td>${c.location
        ? `${Number(c.location.lat).toFixed(5)}, ${Number(c.location.lng).toFixed(5)}
           (±${esc(c.location.accuracy_m)}m)`
        : `<span class="none">${esc(c.location_status)}</span>`}</td>
      <td class="hash">${esc(String(c.media_sha256).slice(0, 16))}…</td>
    </tr>`).join('');

  return `<!doctype html><html><head><meta charset="utf-8">
<title>Evidence bundle — ${esc(b.project_id)}</title>
<style>
  body { font: 15px/1.5 -apple-system, system-ui, sans-serif; max-width: 820px;
         margin: 24px auto; padding: 0 16px; color: #111; }
  h1 { font-size: 22px; } h2 { font-size: 18px; margin-top: 32px;
       border-bottom: 2px solid #111; padding-bottom: 4px; }
  h3 { font-size: 16px; margin-bottom: 4px; }
  section { border: 1px solid #ddd; border-radius: 6px; padding: 12px 14px; margin: 12px 0; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 14px; }
  th, td { border: 1px solid #ddd; padding: 5px 7px; text-align: left; }
  th { background: #f4f4f4; }
  tr.superseded td { color: #777; text-decoration: line-through; }
  tr.current td { font-weight: 600; }
  pre { background: #f6f6f6; border: 1px solid #e0e0e0; padding: 10px;
        white-space: pre-wrap; font-size: 13px; border-radius: 4px; }
  .meta, .note { color: #666; font-size: 13px; }
  .approval { border-left: 3px solid #111; padding-left: 10px; margin: 10px 0; }
  .ok { color: #1a7f37; } .bad { color: #b00; font-weight: 700; }
  .none { color: #999; font-style: italic; }
  .hash { font-family: ui-monospace, monospace; font-size: 12px; }
  .limits { background: #fff8e5; border: 1px solid #e0c060; border-radius: 6px;
            padding: 12px 14px; }
  .limits li { margin-bottom: 8px; }
  /* A gap is the expensive thing on the page. It gets the only accent that is not
     already spoken for -- and the limitations at the top explain what it means. */
  section.gap { border-left: 4px solid #b8860b; background: #fffdf5; }
</style></head><body>
<h1>Evidence bundle</h1>
<p class="meta">Project ${esc(b.project_id)} · assembled ${esc(b.assembled_at)}</p>

<!-- FIRST, not in a footnote. The reader meets the limits before the evidence,
     not after they have already over-relied on it. -->
<div class="limits">
  <h2 style="margin-top:0;border:0">What this does and does not establish</h2>
  <ul>${(b.limitations ?? []).map((l: string) => `<li>${esc(l)}</li>`).join('')}</ul>
</div>

<h2>Decisions</h2>${decisions || '<p class="none">None recorded.</p>'}
<h2>Change orders</h2>${cos || '<p class="none">None recorded.</p>'}
<h2>Who was on this job</h2>
${parties ? `<table><tr><th>Company</th><th>Trade</th><th>Scope they agreed to</th></tr>${parties}</table>`
  : '<p class="none">No parties recorded.</p>'}

<h2>Who owns what</h2>${resp || '<p class="none">No boundaries recorded.</p>'}

<h2>Confirmations sent</h2>${confs || '<p class="none">None sent.</p>'}
<h2>Captures</h2>
<table><tr><th>Type</th><th>When</th><th>Where</th><th>Content hash</th></tr>${caps}</table>
<p class="note">Each hash is the SHA-256 of the stored media. It shows the file in
storage is the file that was captured; it does not establish what the file depicts.</p>
</body></html>`;
}

function money(cents: number | null) {
  if (cents == null) return '—';
  const s = Math.abs(cents).toString().padStart(3, '0');
  return `$${s.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${s.slice(-2)}`;
}

/**
 * Hand the bundle to whoever needs it -- email, Files, AirDrop, a lawyer.
 * The share sheet is the right surface: it means we do not have to guess where a
 * contractor keeps their evidence, and we never become the only copy.
 */
export async function shareBundle(htmlPath: string): Promise<{ ok: boolean; reason?: string }> {
  if (!(await Sharing.isAvailableAsync())) {
    // The files are still on disk. Say where, rather than pretend nothing happened.
    return { ok: false, reason: `Sharing unavailable. The bundle is saved at ${htmlPath}` };
  }
  await Sharing.shareAsync(htmlPath, {
    mimeType: 'text/html', dialogTitle: 'Evidence bundle',
  });
  return { ok: true };
}

/**
 * Send a no-login confirmation link — REQ-VAL8.
 *
 * NO EMAIL PROVIDER, on purpose. The user is a solo operator who already texts
 * this client. Their phone holds every channel the client actually reads, and a
 * link that arrives from a number the client recognises gets opened; one we send
 * from a no-reply address lands in spam. Sending it ourselves would also make us
 * a delivery liability -- bounces, blocklists, a provider bill -- to do worse than
 * the phone already does.
 *
 * The message carries the frozen text as well as the link, so the recipient can
 * see what is being asked before deciding whether to tap a URL from a builder.
 */
export async function shareLink(url: string, shownContent: string): Promise<{ ok: boolean; reason?: string }> {
  if (!url || url.startsWith('/')) {
    return { ok: false, reason: 'No confirmation page is configured (EXPO_PUBLIC_CONFIRM_BASE)' };
  }
  try {
    const { Share } = await import('react-native');
    const r = await Share.share({ message: `${shownContent}\n\n${url}` });
    return { ok: r.action !== Share.dismissedAction };
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? String(e) };
  }
}

/**
 * Client progress update — REP-2. The dispute bundle's opposite.
 *
 * The bundle is written for a fight: complete, hedged, every superseded value
 * shown, six limitations at the top. Send that to a homeowner on a Friday and you
 * have told her you are preparing to sue her.
 *
 * This is the Friday. Same data, different job: what changed, what it cost, what
 * is waiting on her. No hashes, no GPS, no history of what the colour used to be.
 * A client does not want an audit trail; she wants to know if the kitchen is on
 * budget. If it ever comes to a fight, the bundle exists and says all of it.
 *
 * IT IS TEXT, NOT HTML. A progress update is READ IN A TEXT MESSAGE — that is how
 * this contractor already talks to this client. An attachment is a thing she has
 * to decide to open; a message is a thing she has already read by the time she
 * decides.
 */
export async function buildProgressUpdate(
  supabase: SupabaseClient, projectId: string, sinceDays = 7
): Promise<{ ok: true; text: string; json: any } | { ok: false; reason: string }> {
  const { data, error } = await supabase.rpc('progress_update', {
    p_project_id: projectId, p_since_days: sinceDays,
  });
  if (error) return { ok: false, reason: error.message };
  return { ok: true, text: renderProgressText(data), json: data };
}

/** Plain words. Written to be read on a phone, by someone who is not in the trade. */
export function renderProgressText(p: any): string {
  const lines: string[] = [];
  lines.push(`${p.project} — update`);
  lines.push('');

  const decisions = p.decisions ?? [];
  if (decisions.length) {
    lines.push('What we settled:');
    for (const d of decisions) lines.push(`  • ${d.subject}: ${d.now}`);
    lines.push('');
  }

  const recent = p.approved_recently ?? [];
  if (recent.length) {
    lines.push('Approved and under way:');
    for (const c of recent) lines.push(`  • ${c.what} — ${c.amount}`);
    lines.push('');
  }

  const waiting = p.waiting_on_you ?? [];
  if (waiting.length) {
    // The ask goes LAST and alone. Everything above is news; this is the one thing
    // she has to do, and burying it in the middle is how it gets missed.
    lines.push(waiting.length === 1 ? 'Waiting on you:' : `Waiting on you (${waiting.length}):`);
    for (const c of waiting) lines.push(`  • ${c.what} — ${c.amount}`);
    lines.push('');
  }

  lines.push(`Approved so far: ${p.approved_total}`);
  if (p.photos_taken) lines.push(`${p.photos_taken} photo${p.photos_taken > 1 ? 's' : ''} on file.`);

  // No "generated automatically" footer. It is from the contractor; a machine
  // stamp makes it junk mail, and junk mail does not get answered.
  return lines.join('\n');
}

/** Send it the way this contractor already talks to this client. */
export async function shareProgressUpdate(text: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    const { Share } = await import('react-native');
    const r = await Share.share({ message: text });
    return { ok: r.action !== Share.dismissedAction };
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? String(e) };
  }
}
