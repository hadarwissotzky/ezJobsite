# The no-login confirmation page (REQ-VAL1/2/3/8)

`confirm.html` is what a homeowner or GC sees when a contractor sends them a link.
They have no account and never will — the token in the link is the credential.

## It is inert

Every value it shows comes from `confirmation_fetch(token)` / `confirmation_respond(...)`,
both already granted to `anon`. There is no server logic to host. The anon key is
public by design: RLS plus the RPC grants are the protection, and `anon` can reach
exactly those two functions and no table (verified — every table returns `[]`).

## Hosting: NOT Supabase Storage

Storage **refuses to serve renderable HTML**. Verified, not assumed: the object row
records `mimetype: text/html`, the CDN serves `text/plain`, and the same upload of a
`.json` file serves as `application/json`. This is a deliberate platform protection
against hosting phishing pages on `supabase.co`. A browser shows the page's source
instead of the page. `scripts/deploy-web.sh` uploads correctly; the platform will
not serve it.

So the page needs a static host that serves `text/html`. Any of these work — it is
one file with no build step:

- **GitHub Pages** — free, the repo is already on GitHub. Not enabled: publishing a
  page to the internet under your account is your decision, not mine to make.
- **Cloudflare Pages / Netlify / Vercel** — free tier, drag-and-drop.
- **Your own domain** — the right answer eventually. A homeowner is more likely to
  tap `yourcompany.com/c/...` than `random.github.io/...`, and the link is the
  product's first impression on the client.

## Deploying

```bash
./scripts/deploy-web.sh          # substitutes URL + anon key, uploads
```

Then set the base in `.env` so the app builds real links:

```
EXPO_PUBLIC_CONFIRM_BASE=https://<wherever-you-host-it>
```

The app reads `EXPO_PUBLIC_CONFIRM_BASE`. Until it is set, "SEND IT" refuses and
says so — it will not hand a contractor a dead link to give a client.

**This was previously hardcoded to `https://ezjobsite.app`, a domain that does not
exist.** Every confirmation link the app generated pointed at nothing.

## Delivery is the share sheet, not an email provider

The contractor sends the link themselves. Their phone already has iMessage,
WhatsApp, email — every channel the client actually reads — and a link from a
number the client recognises gets opened, while one from a no-reply address lands
in spam. Sending it ourselves would make us a delivery liability (bounces,
blocklists, a provider bill) to do a worse job than the phone already does.
