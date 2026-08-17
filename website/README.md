# `website/` — the public site

The marketing and legal pages served at **`approve.ezchangeorders.com`**: the landing
page, the privacy policy, and the terms.

## Why this is not `apps/web/`

`apps/web/` is reserved for the **web version of the app** (ADR-5: "one shared monorepo
— RN/Expo app · Next web · shared packages · `supabase/`"). That is product surface: it
will need a build step, a framework, and an auth session.

This is not that. These are three static files with no build, no dependencies and no
session, and they are read by two audiences the app has nothing to do with: a carrier
compliance reviewer, and a homeowner who trimmed an approval link back to the domain.
Mixing them into the web app would mean a Next build standing between a legal page and
being reachable — for pages whose whole job is to load, always, for anyone.

## What is served, and from where

The public site is assembled from **two** directories, because they are owned
differently and that is deliberate:

| Source | Files | Why it lives there |
|---|---|---|
| `website/` | `index.html`, `privacy.html`, `terms.html` | The public face. Owned here. |
| `apps/web/` | `confirm.html`, `ewa.js` | The no-login approval page — client-facing **product**. `docs/CLIENT-PORTAL.md`, `docs/SPEC-extra-lifecycle-v1.md` (DEF-6) and `scripts/deploy-web.sh` all reference it at that path; moving it would break four documents to tidy one folder. |

`scripts/deploy-site.sh` copies both into the `gh-pages` branch and pushes. **That
branch is generated — never edit it directly.** An edit there is invisible here and is
overwritten by the next deploy.

## Hosting

GitHub Pages, from the `gh-pages` branch of this repo, with the custom domain
`approve.ezchangeorders.com`.

That subdomain is also `EXPO_PUBLIC_CONFIRM_BASE`, so one host serves both the legal
pages and every approval link the app sends (`/confirm.html?t=<token>`). Query strings
need no rewrite rules, which is why a static host is enough.

**DNS:** `approve` → `CNAME` → `hadarwissotzky.github.io.`

## The three clauses that must not be edited out

`privacy.html` carries three statements required for A2P 10DLC campaign approval, marked
in the source with `TCR-REQUIRED`:

1. mobile numbers are never shared or sold, and never shared for marketing;
2. message frequency;
3. "message and data rates may apply".

Remove any one of them and the carriers can revoke the campaign — at which point the app
stops being able to text anybody, which is how this was discovered in the first place
(carrier error 30034, 2026-08-17).
