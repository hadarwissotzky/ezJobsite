# EZjobsite — Pricing & Packaging Strategy

*Free / Core / Crew / Enterprise. Goal: the cheapest, most democratic option in the category — adopted from the ground up by small trades (subs, remodelers, HVAC, flooring, painters, carpenters, handymen) to communicate with homeowners and GCs so they stop losing money on the jobsite — while staying profitable. Built on live 2026 competitor + cost research. Prepared 2026-07-15. Prices are recommendations to confirm.*

---

## 1. Strategy in one paragraph

Give away the **capture + evidence + native-language** core (it's cheap to run and it's the adoption hook), **meter the things that cost money** (structured decisions, SMS signatures) to shape the free→paid upgrade, **never charge per field seat** (crew + homeowners are always free — that's the whole growth loop), and price the paid tiers **well below CompanyCam/Jobber** so a margin-squeezed solo trade can say yes without thinking. The variable cost per user is so low (cents) that even aggressive pricing keeps 60–85% gross margins.

---

## 2. Market context (live 2026 pricing)

| Product | Entry paid | Model | Notable | Free tier? |
|---|---|---|---|---|
| **CompanyCam** | **$63/mo** (1 user) +$29/user; Crew $129 (3 users), Scale $199, Enterprise 50+ | Per-seat | Tiers literally named Core/Crew/Scale; 3-user lock-in; AI credits gated | Trial only |
| **Jobber** | **$29–49/mo** (1 user) +$29/user; up to $399–499 | Per-seat | Suite (quote→invoice→pay); no native change order | Trial only |
| **QuoteIQ** | **$29.99/mo** flat (1 user, 500 AI credits) → $699 unlimited | **Flat per-account** + AI credits | No per-seat; "price-lock guarantee" | Trial only |
| **Contractor Foreman** | **$49/user/mo** → $332 | Per-seat | Small-mid contractors | No |
| **TaskTag** | **$16/manager/mo**; Enterprise custom | **Pay managers only; crew free forever** | Free plan = **3 active projects**, 2GB | **Yes — 3 projects** |

**Takeaways that shape our pricing:**
- **Per-seat pricing is the #1 resentment** in the category (CompanyCam/Jobber/Contractor Foreman all punished for +$29/user). Don't do it for field crew.
- **The winning democratic model already exists**: TaskTag = crew free forever, pay only for managers, free tier capped by **project count**. We do that, plus the transaction/language layer they lack.
- **Flat + metered-AI works** (QuoteIQ). Meter the expensive unit, not the people.
- **Economic pressure is real "especially now":** residential net margins are **~6–10%**, interest rates elevated, cost sensitivity high in 2026. A $63–199/mo tool is a hard sell to a solo painter; a $19 one isn't. Being the affordable option *is* the strategy.

---

## 3. Unit economics — the cost floor (why we can be this cheap)

Per **structured decision** (the metered unit — a ~2-min voice capture → transcribed → structured → translated):

| Cost driver | Rate (2026) | Per decision |
|---|---|---|
| Transcription | gpt-4o-mini-transcribe **$0.003/min** (Whisper $0.006) | ~**$0.006** |
| Structuring + translation | cheap LLM (Gemini Flash-Lite $0.10/$0.40 per M tok) | ~**$0.001** |
| Media storage | Cloudflare **R2 $0.015/GB/mo, zero egress** | ~**$0.00** (negligible) |
| In-app / push notification | free | **$0** |
| **Subtotal (no SMS)** | | **~$0.007–0.015** |
| **Binding signature** (Verify OTP + SMS) | Twilio Verify **$0.05/verification + ~$0.01 SMS + carrier fees** | **~$0.06–0.08 each** *(repriced per greenlight review)* |

**The punchline: AI is nearly free; SMS/Verify is the only per-event cost that matters.** Translation is basically free (and cached per the spec). So the cost-control levers are: use `gpt-4o-mini-transcribe` + a cheap LLM, keep notifications **in-app/push** (SMS only for the homeowner's binding OTP signature), store media on **R2**, and cap SMS-signature allowances per tier.

**Resulting per-user monthly cost:** a Free user (30 decisions, no SMS) costs **< $0.50/mo**. A busy Core solo (200 decisions + 30 SMS signatures) costs **~$3–6/mo** against a $19–24 price → **~75% margin**.

---

## 4. The four tiers

**Who pays, always:** only the **owner/manager**. **Field crew and homeowners are free on every tier, forever** (the adoption + growth loop). Invited collaborators (subs/GCs) are free too.

**What's metered on Free:** **projects (horizontal) × decisions per project (vertical)** — your explicit design, and it maps exactly to cost + creates the upgrade trigger (volume is the real migration driver).

| | **Free** | **Core** | **Crew** | **Enterprise** |
|---|---|---|---|---|
| **Price (rec.)** | **$0** | **~$19/mo** (annual) / $24 monthly · 1 owner | **~$49/mo** (annual, 3 seats) · +$12/mgr | **Custom** |
| **Who it's for** | Try it on a job | Solo pro, **no office** | Small team | Multi-crew / franchise / white-label |
| **Limits** | **2 active projects × 15 decisions each**; in-app notify only; typed-name confirm (no SMS signature); basic export | **Unlimited** projects + decisions; SMS-signature allowance | Unlimited; higher SMS/AI allowance | Custom limits |
| Multimodal capture (voice/photo/video/text), offline, never-lose-it | ✅ | ✅ | ✅ | ✅ |
| Auto-organize + project resolution | ✅ | ✅ | ✅ | ✅ |
| **Native-language capture → English record + read in your language** | ✅ | ✅ | ✅ | ✅ |
| Evidence / paper trail + basic retrieval | ✅ | ✅ | ✅ | ✅ |
| Decision-of-record + lightweight confirm (to homeowner/GC) | ✅ (capped) | ✅ | ✅ | ✅ |
| Invite homeowner / GC to view + confirm (+ reverse invite) | ✅ | ✅ | ✅ | ✅ |
| **Digital-signature approval (SMS-OTP, binding)** | — | ✅ | ✅ | ✅ |
| **Change order + mini change order** | — | ✅ | ✅ | ✅ |
| **Reports** (walkthrough, daily/weekly) + clean export | — | ✅ | ✅ | ✅ |
| Basic checklists | — | ✅ | ✅ | ✅ |
| **Team roles + company feed** | — | — | ✅ | ✅ |
| **Collaborators / cross-company** + scope delineation + assignment | — | limited | ✅ | ✅ |
| Per-party scope review · back-office digest · report cadence | — | — | ✅ | ✅ |
| Integrations (QuickBooks / Jobber push) | — | — | ✅ | ✅ |
| SSO · multi-company hub · white-label/API · priority support | — | — | — | ✅ |

*Note on Enterprise: EZjobsite is deliberately **not** built for large GCs, so Enterprise is intentionally light — it exists for the larger of the small operators (multi-crew subs, a remodeler with an office, franchise/white-label, and Hilo-portfolio plays), not to chase big-GC deals. Don't over-invest here early.*

---

## 5. The Free tier as the growth engine

Free isn't charity — it's the funnel, and its limits are chosen to (a) cost us < $0.50/user/mo and (b) let a real user prove value on a real job, then hit a wall exactly when their business is working.

- **Horizontal cap — 2 active projects:** enough to run a job + a bid; a working sub juggling 3–5 concurrent jobs hits it fast. (TaskTag uses 3; we can start at 2–3 and tune.)
- **Vertical cap — ~15 decisions/project:** enough to feel the "nothing got lost / I got it approved" magic; a busy job blows past it.
- **The wall is the pitch:** "You're getting real value and you've hit the free limit — keep everything unlimited for less than the cost of one disputed change order." Upgrade is $19, framed against the money a single undocumented change costs them.
- **Crew + homeowner free** means the *paying* owner brings non-paying users who become the network — and some of those subs become paying owners on their own jobs (the collaborator growth loop).

---

## 6. Profitability check

*(Repriced 2026-07-15 per the greenlight review — the original table understated Verify, cumulative R2, the jobs platform (~$300–500/mo at target), and the managed-platform floor (~$1.2–1.8k/mo at ~1k companies: Supabase compute, PowerSync Team tier, push). Honest blended picture:)*

| Tier | Price/mo | Est. variable cost/mo | Gross margin |
|---|---|---|---|
| Free | $0 | < $0.50 **with the minute allowance + lazy processing** (unbounded voice capture would otherwise run $2–3) | funnel (acceptable CAC) |
| Core | ~$19–24 | ~$4–7 | **~65–75%** |
| Crew | ~$49–59 (3 seats) | ~$15–22 | **~55–65%** |
| Enterprise | custom | custom | negotiated |

**Blended at target (~1k companies / 10k users): ~60–70% gross margin** after the platform floor — healthy, honest, and it holds only with **transcription-minute metering enforced** (Free: lazy-process — audio stored durably at capture, transcribed on first view; monthly minute allowance; captures never rejected). hadar decision: **accept 60–70% and keep $19/$49** — the democratic pricing is the strategy.

Healthy SaaS margins even at aggressive prices — because the cost floor is cents. **The margin risk is SMS**, not AI: control it with per-tier SMS-signature allowances (overage or pass-through for heavy users) and in-app/push for everything that isn't a binding signature. Storage risk is now moot — **video is never stored** (extracted on-device to audio + key stills, raw video discarded — see `ARCHITECTURE.md §3.1`), so storage stays negligible on every tier; R2 holds only the small audio/image footprint. This keeps the free-user cost floor intact and means video can be a normal feature, not a paid-only one.

---

## 7. Decisions

### Confirmed 2026-07-15 `[✅ hadar]`
1. **Core = $19/mo** (annual) — the anchor. (Ladder: Free $0 / Core $19 / Crew ~$49, 3 seats +$12/mgr / Enterprise custom.)
2. **Free = 2 active projects × 15 decisions** each.
3. **Enterprise = stubbed** ("contact us"); build effort goes to **Free → Core → Crew** (the small-trades ICP). Add Enterprise only when a real deal pulls for it.

### Still to settle (defaults applied, change anytime)
4. **Metered "decision" unit** — *default:* count **structured decisions** as the Free-limit unit (change orders/reports on Free are off anyway since they're Core+). Revisit if we want a tighter cost cap.
5. **SMS on Free** — *default (recommended):* Free uses **typed-name confirm only (no SMS)**; **SMS-OTP signatures start at Core**. Controls the one real variable cost.
6. **Annual discount + price-lock** — *default:* ~2 months free on annual + a **price-lock guarantee** (matches QuoteIQ; builds trust with skeptical trades). Confirm when we finalize billing.

---

## Sources
- [CompanyCam pricing](https://companycam.com/pricing) · [Jobber pricing](https://www.getjobber.com/pricing/) · [QuoteIQ pricing](https://myquoteiq.com/pricing/) · [Contractor Foreman pricing (Capterra)](https://www.capterra.com/p/166113/Contractor-Foreman/pricing/) · [TaskTag pricing](https://tasktag.com/pricing)
- [OpenAI transcription pricing (CostGoat)](https://costgoat.com/pricing/openai-transcription) · [LLM API pricing (TLDL)](https://www.tldl.io/resources/llm-api-pricing) · [Twilio US SMS pricing](https://www.twilio.com/en-us/sms/pricing/us) · [Cloud storage pricing (BuildMVPFast)](https://www.buildmvpfast.com/api-costs/cloud-storage)
- [2026 construction profit margins (Siana)](https://www.sianamarketing.com/resources/average-construction-profit-margin-2026)
