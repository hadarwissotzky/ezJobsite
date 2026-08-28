# The auth email says "Supabase Auth" — how to change it

hadar, 2026-08-27, on the signup confirmation: *"Need to make sure that the email is
not from subpase security but ezchangeorder."*

**SMTP is the single unlock, and it is not optional.** I tried to install the branded
templates through the Management API and Supabase refused outright:

> Email template modification is not available for free tier projects using the
> default email provider. Please upgrade your plan or configure a custom SMTP
> provider.

So the sender and the body are not two problems — they are one. While the built-in
sender is in use the templates **cannot be edited at all**, and the From line is
hard-wired to:

```
From:  Supabase Auth <noreply@mail.app.supabase.io>
```

That name and address cannot be overridden while the built-in sender is in use.

Verified against the live project on 2026-08-27: `smtp_host` is null, the stored
templates are still the stock two-line ones, and `rate_limit_email_sent` is **2 per
hour**.

## And a second reason, beyond branding

Supabase's built-in email service is **rate limited to a handful of messages per
hour** and is documented as being for development only. Every signup and every
magic-link login sends one. A pilot with a few contractors will hit that ceiling, and
the failure mode is the worst kind: the app says "check your email" and no email
arrives.

So custom SMTP is required to ship, not only to rebrand.

## What to do

**1. Pick a sender and verify the domain.**
Resend, Postmark, SendGrid or SES all work. Verify `ezchangeorders.com` with the SPF
and DKIM records they give you, at the same registrar that holds the
`approve.ezchangeorders.com` CNAME. Without DKIM the mail lands in spam, which is a
worse outcome than Supabase branding.

**2. Supabase Dashboard → Project Settings → Authentication → SMTP Settings.**
Enable custom SMTP and set:

| Field | Value |
|---|---|
| Sender email | `noreply@ezchangeorders.com` |
| Sender name | `EZChangeOrders` |
| Host / Port / User / Pass | from the provider |

**3. Raise the rate limit** under Authentication → Rate Limits once SMTP is on. It is
currently **2 emails per hour** for the whole project — two signups in an hour and the
third contractor is told to check an inbox that will stay empty.

**4. Paste both templates**, Authentication → Emails:

| Template | File | Subject |
|---|---|---|
| Confirm signup | `docs/email-confirm-signup-template.html` | Confirm your email for EZChangeOrders |
| Magic Link | `docs/email-magic-link-template.html` | Log in to EZChangeOrders |

Both are needed. Supabase picks by whether the address is already a user — a NEW
address gets "Confirm signup", a known one gets "Magic Link" — which is why the
branded magic-link template was already in place and hadar still received a stock
email while registering.

**5. Email OTP expiry is ALREADY 900 seconds** — checked, not assumed. Both templates
say "expires in 15 minutes" and the project agrees, so nothing to do here. Leave it
alone if the copy ever changes.

## What can and cannot be automated from here

The Supabase CLI is logged in on this machine, so the Management API IS reachable and
steps 3–4 could be applied with one call — that is how the refusal above was found.

What cannot be automated is step 1 and step 2: they need an account with an email
provider and DNS records at the registrar. Nobody should be creating those on the
project's behalf, and without them steps 3–4 are refused anyway.

So the order is fixed: **SMTP first, everything else follows.**
