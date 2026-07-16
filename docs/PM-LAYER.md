# Hilo — Project Management Layer

*How projects are created, described, found, and how activity across them is surfaced — plus who captured what and cross-company sharing. Captured from hadar's list on 2026-07-15. ✅ = as you said it · ❓ = my interpretation / open decision. Extends the Project Resolution layer (auto-filing) in `SPEC-capture-core-v1.md §6.4` — resolution *files* captures into projects; this layer is how projects *exist and are managed* in the first place.*

---

## 1. Where this sits

Everything in Hilo lives under a **Project** — it's the container captures auto-file into (resolution) and the unit reports/decisions/change orders roll up to. So far the spec treated a "Job/Project" as a thin record (name, address, geofence, client). Your list makes it a **first-class managed layer** with creation, information, discovery surfaces, membership/attribution, and a company-wide activity view. Standardizing the term: **Project** (retiring "Job"). `[✅ hadar]`

---

## 2. The Project entity & its information

A Project carries: **name, description, address** (→ derived GPS/geofence for resolution), **client**, **status**, **members** (who's on it), and its stream of captures + dispositions. `[✅ hadar — "project information (description, address)"]`

- **REQ-PM1 — Project information.** A project stores description + address (+ geofence derived from address), client, and status. `[trace: hadar "project information"]`
  - Accept: a project can be viewed/edited with these fields; address change updates the geofence used by resolution.
- **REQ-PM2 — Address → geofence link.** The address anchors the resolution layer's geofence. `[trace: REQ-P1 resolution]`
  - Accept: a created project with an address is immediately resolvable by proximity. ❓ *Projects with no fixed address (service/mobile work) — supported as "no-geofence, resolve by other signals"? confirm.*

---

## 3. Creating & managing projects

- **REQ-PM3 — Create a project.** A project can be created with, at minimum, a name + address. `[trace: hadar "create project"; SET-2]`
  - Accept: **both field (quick-create on site) and office (create + edit/merge/cleanup) can create**; a field-created project is immediately usable for capture. `[✅ hadar — both, field quick-create + office cleanup]`
- **REQ-PM4 — Project status lifecycle.** A project has a status so lists/feeds can filter active vs. done. `[trace: hadar "projects list"]`
  - Accept: status is set and filterable; v1 = **Active + Archived** (minimum). `[✅ hadar]`
- **REQ-PM5 — Edit / archive a project.** Project info can be edited; a finished project can be archived (kept for warranty/retrieval, out of the active list). `[trace: EVID retrieval; companycam retention]`
  - Accept: edit + archive without losing history.

---

## 4. Discovery surfaces (how people find & see projects)

- **REQ-PM6 — Projects list.** The user sees their projects, filterable by status, sortable by recency. `[trace: hadar "projects list"]`
  - Accept: list shows the user's projects; filter active/archived; sort by recent activity.
- **REQ-PM7 — Search project.** Find a project by name, address, or client. `[trace: hadar "search project"]`
  - Accept: typing a name/address/client returns matching projects quickly. ❓ voice search too (ties to EXP-6 voice retrieval)?
- **REQ-PM8 — Nearby projects.** Surface projects near the user's current location — the browse/discovery counterpart to auto-resolution ("you're at / near these projects"). `[trace: hadar "near by projects"; powers REQ-P1]`
  - Accept: at a jobsite, the app shows the nearby project(s) at the top for one-tap selection; drives both capture-time resolution and manual pick. ❓ radius / how many shown?
- **REQ-PM9 — Company feed.** A company-wide activity stream: new captures, decisions, change orders, reports, approvals across all projects — the office's real-time window into the field. `[trace: hadar "company's feed"; companycam "field→office visibility"]`
  - Accept: the feed shows recent activity across projects, filterable by project / person / type; updates as the field captures. ❓ **who sees the whole company feed vs. only their projects** (roles — see Q's).

---

## 5. Attribution & cross-company sharing (the part that adds a new dimension)

Your note **"who took it (employee, shared by sub-contract)"** means every capture/disposition records its author, and authors come in two kinds: an **employee** of the company, or something **shared by a subcontractor** — i.e., a contributor outside your own company. That introduces **membership, roles, and cross-company sharing**, which the spec didn't have yet.

- **REQ-PM10 — Authorship on every item.** Every capture/disposition records **who took it** (person + their company/role). `[trace: hadar "who took it"; substantiation "who directed/captured it"]`
  - Accept: author (and their org) is shown on every capture, decision, CO, report.
- **REQ-PM11 — Project membership.** A project has members (the crew/office on it), so the feed, permissions, and attribution have a basis. `[trace: hadar feed + who-took-it]`
  - Accept: members can be added to a project; captures attribute to a member.
- **REQ-PM12 — Subcontractor sharing.** A subcontractor can contribute captures/decisions into a project they don't own. `[trace: hadar "shared by sub-contract"]`
  - Accept: a sub's capture appears in the project attributed to the sub. **Decision: Option C — labeled authorship in v1; cross-company sharing architected as a seam for later.** `[✅ hadar]`
- **REQ-PM13 — Role model.** Members have a role: **Office/Owner** (manages projects, sees the company-wide feed) or **Field** (captures, sees the projects they're on). **Sub** is a labeled author (external), not yet a full cross-company account. `[✅ hadar — office sees all, field sees theirs]`
  - Accept: role governs feed scope (office = company-wide; field = own projects) and project management rights; author's org/role shows on every item.
  - **Office is optional.** A **solo operator with no back office** is fully self-sufficient — one person holds field + office capabilities and still gets all information and can communicate to workers. The office role is never a requirement. `[✅ hadar — "even if you don't have an office"]`

### The pivotal decision: how deep is "subcontractor sharing"?
This single choice decides whether we're building a **single-company team app** or a **multi-company collaboration graph** — very different scope for a solo build.

- **Option A — Labeled authors (simplest).** Subs are just tagged authors inside *your* company's app (a sub captures on a GC-provided seat, or the GC records "shared by [sub]"). No separate accounts, no cross-company boundary. Smallest build.
- **Option B — Cross-company sharing.** Subs have their *own* Hilo accounts/companies and *share* captures/projects across a company boundary (like sharing a doc between orgs). Real multi-tenant sharing, permissions across orgs — much bigger.
- **Option C — Both, phased.** Ship A now (labeled), architect the data model so B (real cross-company sharing) drops in later.

**✅ Decided: Option C.** Labeled authorship in v1 (de-risk build stays single-tenant), cross-company sharing architected as a seam for later. The data model carries author + org from day one so the boundary can become real without a rewrite.

### Collaborators — the cross-company model (the "Option B" seam, now specified)
*Invite another company/sub into a specific project so every company's decisions, notes, and captures land in one place. Modeled on CompanyCam Project Collaboration; **free** is the point — it's both data-completeness and a growth loop.* `[✅ hadar]`

- **REQ-COLLAB1 — Invite a company to a project via link (either direction).** From web or mobile, generate a **project-scoped invite link** shareable by email/text/however. **Bidirectional:** a GC can invite a sub, **or a subcontractor can invite the GC / project owner** into the project so they get access to all the on-the-ground decisions. The inviter isn't necessarily the project's "owner." `[trace: hadar collaborator + reverse-invite]`
  - Accept: an invite link is generated per project and can be revoked; a sub-initiated invite gives the GC/owner access to that project's decisions.
- **REQ-COLLAB2 — Accept, free, existing-or-new.** The invited company accepts by **logging in** (existing) or **signing up free** (new company, basic tier); **free for both** the host and the collaborator, regardless of how many projects. `[trace: hadar "collaborators are free"]`
  - Accept: a brand-new company can accept and start contributing without paying.
- **REQ-COLLAB3 — Contribute alongside, attributed to their company.** Collaborators **capture, view, and comment on** the project's captures/decisions/notes alongside the host team; every contribution is **attributed to their company** (author{user, org}). `[trace: hadar; author+org seam]`
  - Accept: a collaborator's capture/decision/comment appears in the project tagged with their company.
- **REQ-COLLAB4 — Project-scoped access only.** A collaborator sees only the project(s) they're invited to — never the host's other projects or company. `[trace: roles/permissions; least-privilege]`
  - Accept: a collaborator cannot reach any project they weren't invited to.
- **REQ-COLLAB5 — End anytime; host keeps the content.** The host can **end the collaboration** at any time (access revoked) and **retains everything the collaborator contributed**; **reinvite** is supported. `[trace: hadar "you still keep any photos/comments they added"; immutable-evidence principle]`
  - Accept: ending revokes access but the collaborator's captures/decisions/comments remain in the host's project; a reinvite restores access.
  - **Data ownership across the boundary (resolves critic H4):** on contribution, collaborator content is **licensed to the host project** for retention (controller = the **capturing org**); post-collaboration retention runs under that license; a subject's or org's **erasure request is honored via crypto-shred + stub** (per CLAUDE #5). Recording consent for a collaborator's captures is the **capturing org's** responsibility. `[trace: critic H4]`
- **REQ-COLLAB6 — Cross-company + cross-language compose.** Each collaborating company works in its **own preferred language** (language layer), against one **English-canonical** record — cross-company *and* cross-language collaboration in one record. `[trace: LANGUAGE-LAYER; the edge over CompanyCam's English-only collaboration]`
  - Accept: a Spanish-preference collaborator and an English-preference host see the same project each in their language; canonical stays English.

- **REQ-COLLAB7 — Capture role + scope on invite; per-party scope review.** When a company is invited, define their **role (trade) and scope of work** on the project; the project can then **automatically review each party's role, scope, status, and what's assigned to them** — and catch boundary gaps/overlaps between trades (REQ-VAL7, the air-handler problem). `[trace: hadar "invite a company… their role so you can automatically review their state, role"]`
  - Accept: an invited company carries a role + scope-of-work on the project (`ProjectParty`); a per-party scope-review view shows each party's role, scope, assigned decisions, and status. *(Role+scope field = P1; gap/overlap review = P1.5.)*

**Phasing.** The **author+org seam is P1** (data model). The multi-tenant **invite / accept / scoped-access / free-tier build is P1.5** — and a candidate to pull toward the *front* of P1.5, because "free collaborators = every company's decisions in one place" is both a data-completeness win and a growth loop. `[❓ confirm P1.5 placement vs. later]`

---

## 6. How dispositions relate to projects

The things you listed — **report (daily/weekly), decision, change order** — are all **dispositions under a project** (from the handler model): they attach to a project, appear in its timeline, and surface in the company feed. Nothing new structurally; they're the Report / Validation / Change Order handlers, now shown to also be **project-scoped and feed-visible**. `[trace: MASTER handlers; core-concept §3]`

---

## 7. New use cases to add to the master catalog

| ID | Use case | Phase | Note |
|---|---|---|---|
| **PM-1** | Create a project (name + address → geofence) | P1 | Was SET-2; now first-class. |
| **PM-2** | Edit / archive a project | P1 | Status lifecycle. |
| **PM-3** | Projects list (filter/sort) | P1 | |
| **PM-4** | Search project (name/address/client) | P1 | Voice search → P2. |
| **PM-5** | Nearby projects | P1 | Browse counterpart to auto-resolution. |
| **PM-6** | Company feed (activity across projects) | P1.5 | Office real-time visibility; needs roles. |
| **PM-7** | Authorship on every item (who took it) | P1 | Employee vs. sub-shared. |
| **PM-8** | Project membership / roles | P1.5 | Basis for feed + permissions. |
| **PM-9** | Subcontractor sharing | P1.5 / P2 | Depth per the pivotal decision. |

*PM-1..5 and PM-7 are P1 (the core needs projects to exist, be found, and attribute captures). The feed, roles, and sub-sharing (PM-6/8/9) are P1.5+ because they layer on membership and permissions.*

---

## 8. Decisions

### Resolved 2026-07-15 `[✅ hadar]`
1. **Who creates** — **both**: field quick-creates on site, office edits/merges/cleans up.
2. **Sub-sharing depth** — **Option C**: labeled authors now, cross-company sharing architected for later.
3. **Roles & feed** — **role model**: Office/Owner sees the company-wide feed & manages; Field sees their own projects. (Sub = labeled author.)
4. **Project status** — **Active + Archived** in v1.

### Still open
5. **No-address projects** — must we support projects with no fixed address (service/mobile work), or is an address always required? *(Affects resolution fallbacks; low urgency — defaulting to "address strongly encouraged, resolve-by-other-signals if absent" unless you say otherwise.)*
