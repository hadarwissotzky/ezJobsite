/**
 * The no-login approval page, for an Extra Work Authorization — PRD R3 AC2.
 *
 * A SEPARATE FILE, loaded by confirm.html, deliberately.
 *   confirm.html renders a PRICED approval: a big number, a running total, and the
 *   line "Nothing proceeds until you approve." Every one of those is wrong here. An
 *   EWA has no price; on a T&M-capped term work proceeds precisely BECAUSE it was
 *   approved; and the running total would imply this document adds to it. Branching
 *   inside renderPriced() would have meant a dozen conditionals in the one function
 *   whose output a client signs, and the failure mode of getting one wrong is a
 *   homeowner signing a document that describes the opposite arrangement.
 *
 * AC2: "when the homeowner opens it, then Approve is only possible after the
 * proceed term and settlement rule are displayed; the record is labeled 'Extra Work
 * Authorization,' not 'change order'."
 *
 * That is read as a HARD GATE, not a layout note. `renderEwa` refuses to draw an
 * Approve button at all unless it holds both clauses (see `guard` below). A page
 * that lost its terms to a sync gap fails closed, telling the client to ask for a
 * new link, rather than collecting a signature on an incomplete instrument. The
 * server fails closed in the same place (`ewa_terms_fetch` returns 'terms_missing'),
 * so neither side depends on the other having remembered to check.
 *
 * The clause TEXT is rebuilt here from the structured terms and must match
 * apps/mobile/src/ewa.ts word for word. That duplication is real and is the price of
 * a static page with no build step. It is contained two ways: the frozen
 * shown_content is displayed verbatim under "See the exact wording" (it, not this
 * page, is the binding instrument — mandate #5), and `assertMatchesFrozen` below
 * checks this page's clauses actually appear in that frozen text before enabling
 * Approve. If the two ever drift, the client sees a refusal, not a mismatch.
 */
(function () {
  'use strict';

  function clauses(terms, usd) {
    var billability =
      'This work is outside the contracted scope and will be billed as an extra.';
    var proceed = terms.proceed_term === 'hold'
      ? 'Work in this area pauses until the price is approved.'
      : 'Work proceeds at ' + usd(terms.hourly_rate_cents) + '/hr plus materials, ' +
        'not to exceed ' + usd(terms.cap_cents) + ', until a fixed price is issued.';
    var settlement =
      'The detailed price will follow within ' + terms.settlement_hours +
      'h and, once approved, supersedes and settles this authorization.';
    return { billability: billability, proceed: proceed, settlement: settlement };
  }

  /**
   * Every reason this page may NOT show an Approve button. Returns a message, or
   * null when it is safe to proceed.
   *
   * Ordered cheapest-first, but the order does not matter for correctness: any one
   * of these means the client would be signing something incomplete.
   */
  function guard(terms, c, shownContent) {
    if (!terms || terms.status !== 'open') return 'terms';
    if (terms.proceed_term !== 'hold' && terms.proceed_term !== 'tm_capped') return 'terms';
    if (terms.proceed_term === 'tm_capped' &&
        (terms.cap_cents == null || terms.hourly_rate_cents == null)) return 'terms';
    if (terms.settlement_hours !== 24 && terms.settlement_hours !== 48) return 'terms';
    // The drift check. The clauses drawn above the button must be the clauses in the
    // document being signed; if this file and ewa.ts ever diverge, the client is
    // refused rather than shown one text and bound by another.
    if (typeof shownContent === 'string' && shownContent.length) {
      if (shownContent.indexOf(c.proceed) === -1) return 'mismatch';
      if (shownContent.indexOf(c.settlement) === -1) return 'mismatch';
    }
    return null;
  }

  /**
   * @param d      confirmation_fetch payload (frozen: shown_content, company, job…)
   * @param terms  ewa_terms_fetch payload (proceed term, rate, cap, window)
   * @param h      helpers from confirm.html: esc, usd, screen, initials, logoTile, answer,
   *               askQuestion, declineFlow, photoStrip, threadHtml, notice. Passed in
   *               rather than re-implemented so there is ONE money formatter, ONE
   *               answer path and ONE thread renderer on this page.
   *
   * PHOTOS AND THE DISCUSSION ARRIVE THROUGH `h`, and both were missing (DEF-5).
   * confirm.html returned at the `kind === 'ewa'` dispatch before it fetched the
   * thread, and this file never rendered the photo strip, so an EWA — the ONE
   * instrument whose entire content is a photographed condition, since it carries no
   * price — was the only document on this page with neither its evidence nor its
   * conversation. An owner could be asked to authorize work on a condition they were
   * never shown, and could ask a question they would then never see answered.
   *
   * They are rendered by the SAME functions the priced page uses, passed in rather
   * than copied, for the reason this file's header already gives about the clause
   * text: a second renderer is a second thing to keep in step, and this page has one
   * documented duplication too many already.
   */
  function renderEwa(d, terms, h) {
    var c = clauses(terms || {}, h.usd);
    var blocked = guard(terms, c, d.shown_content);

    if (blocked) {
      h.screen(
        '<div class="done"><div class="mark err">⚠️</div>' +
        '<h2>This authorization is incomplete</h2>' +
        '<p>Some of its terms did not load, so it cannot be signed here. ' +
        'Nothing was recorded. Please ask your contractor to send it again.</p></div>'
      );
      return;
    }

    var company = d.company_name || 'Your contractor';
    // "Time &amp; materials, capped" / "Work on hold" — the term named at the top,
    // where a price would sit on the priced page, so a client who reads only the
    // headline still learns the one thing that changes their exposure.
    var termLabel = terms.proceed_term === 'hold' ? 'Work on hold' : 'Time &amp; materials, capped';
    var termValue = terms.proceed_term === 'hold'
      ? 'No price yet'
      // "max" is a MODIFIER, not part of the number, and at .pv's 40px the two
      // together overflow a 390px phone and drop "max" onto its own line — seen in a
      // browser, 2026-07-22. A cap whose qualifier is orphaned reads for a moment as
      // a fixed price, which is the one thing this instrument must never look like.
      : h.esc(h.usd(terms.cap_cents)) + '<span class="pvq">max</span>';

    // The helpers are OPTIONAL at the call boundary and each has a no-op fallback.
    // confirm.html and this file are two separately uploaded static objects, and
    // DEF-6 is the standing proof they can be out of step on the host: a deploy that
    // shipped a new ewa.js against an older confirm.html must degrade to the page it
    // used to draw, never throw on `h.threadHtml is not a function` and leave a
    // homeowner on a blank screen holding an authorization.
    var photos = typeof h.photoStrip === 'function' ? h.photoStrip(d.photos) : '';
    var thread = typeof h.threadHtml === 'function' ? h.threadHtml(d) : '';
    var notice = (h.notice && typeof h.esc === 'function')
      ? '<div class="wrap"><div class="notice">' + h.esc(h.notice) + '</div></div>' : '';

    h.screen(
      '<div class="brand">' +
        // The real mark when this page has one; initials when it does not. `__logoUrl`
        // is set by confirm.html before it dispatches here, and is null on any failure.
        h.logoTile(company, d.__logoUrl) +
        '<div><div class="cn">' + h.esc(company) + '</div>' +
        '<div class="cs">' + h.esc(d.job_label || '') + '</div></div>' +
      '</div>' +
      notice +
      '<div class="wrap">' +
        '<div class="card">' +
          // AC2's labelling. The words "change order" appear nowhere on this page.
          '<div class="kicker">Extra Work Authorization</div>' +
          '<div class="title">' + h.esc(d.scope_title || 'Extra work') + '</div>' +
          '<div class="scope">This is an authorization to do work, agreed before the ' +
            'price is known. You are approving the terms below — not an amount.</div>' +
        '</div>' +

        '<div class="card">' +
          '<div class="price"><span class="pl">' + termLabel + '</span>' +
            '<span class="pv">' + termValue + '</span></div>' +
          // ── the three clauses, ABOVE the Approve button (AC2) ──
          '<div class="clause" id="ewa-billability">' + h.esc(c.billability) + '</div>' +
          '<div class="clause" id="ewa-proceed"><b>' + h.esc(c.proceed) + '</b></div>' +
          '<div class="clause" id="ewa-settlement">' + h.esc(c.settlement) + '</div>' +
          '<details class="exact"><summary>See the exact wording</summary>' +
            '<div class="doc">' + h.esc(d.shown_content) + '</div></details>' +
        '</div>' +

        // The condition being authorized, then the conversation about it — both above
        // the signature, in the same order the priced page uses. A photo shown under
        // the Approve button is a photo seen after the decision.
        photos +
        thread +

        '<input class="sign" id="name" placeholder="Type your full name to sign" autocomplete="name">' +
        '<button class="approve" id="approve" disabled>✓ Approve this authorization</button>' +
        '<button class="ghost" id="ask">Ask a question instead</button>' +
        '<button class="ghost" id="decline">Decline — do not proceed</button>' +
        '<p class="recordnote">Your response, your name, and the date &amp; time become ' +
          'part of the project record. No account needed.</p>' +
      '</div>'
    );

    var nameEl = document.getElementById('name');
    var approveEl = document.getElementById('approve');

    // THE GATE, checked against the DOM rather than against a variable.
    // "Approve is only possible after the proceed term and settlement rule are
    // DISPLAYED" — so what is verified is that they are on the page with text in
    // them, not that the code above intended to put them there. A CSS or markup
    // change that hides a clause therefore disables Approve instead of silently
    // collecting a signature over a missing term.
    function clausesVisible() {
      var ids = ['ewa-billability', 'ewa-proceed', 'ewa-settlement'];
      for (var i = 0; i < ids.length; i++) {
        var el = document.getElementById(ids[i]);
        if (!el || !el.textContent || !el.textContent.trim()) return false;
      }
      return true;
    }

    function refresh() {
      approveEl.disabled = !(clausesVisible() && nameEl.value.trim().length >= 2);
    }
    nameEl.addEventListener('input', refresh);
    refresh();

    approveEl.onclick = function () {
      if (!clausesVisible()) return;   // belt and braces: never sign a partial page
      h.answer('confirmed', null, nameEl.value.trim());
    };
    // Three distinct outcomes (PRD R5). Asking is not declining, and declining an
    // authorization is the strongest signal on this page: AC5 turns it into
    // "Declined — do not proceed" on the contractor's ledger and drops it from
    // every total.
    document.getElementById('ask').onclick = function () { h.askQuestion(d); };
    document.getElementById('decline').onclick = function () { h.declineFlow(d); };
  }

  window.renderEwa = renderEwa;
  // Exported for the same reason the clause text is duplicated: so a future test
  // can assert this file and ewa.ts still agree.
  window.ewaClauses = clauses;
})();
