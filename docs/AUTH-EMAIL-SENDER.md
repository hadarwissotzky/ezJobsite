# The auth email says "Supabase Auth" — how to change it

hadar, 2026-08-27, on the signup confirmation: *"Need to make sure that the email is
not from subpase security but ezchangeorder."*

**No email template can fix this.** The templates decide what the email SAYS; the
project's SMTP settings decide who it is FROM. Right now the project uses Supabase's
built-in sender, which is hard-wired to:

```
From:  Supabase Auth <noreply@mail.app.supabase.io>
```

That name and address cannot be overridden while the built-in sender is in use.

## There is a second reason this is not optional

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

**3. Raise the rate limit** under Authentication → Rate Limits once SMTP is on — the
built-in cap no longer applies, and the default is still low.

**4. Paste both templates**, Authentication → Emails:

| Template | File | Subject |
|---|---|---|
| Confirm signup | `docs/email-confirm-signup-template.html` | Confirm your email for EZChangeOrders |
| Magic Link | `docs/email-magic-link-template.html` | Log in to EZChangeOrders |

Both are needed. Supabase picks by whether the address is already a user — a NEW
address gets "Confirm signup", a known one gets "Magic Link" — which is why the
branded magic-link template was already in place and hadar still received a stock
email while registering.

**5. Set Email OTP expiry to 900 seconds** (Authentication → Settings). Both templates
say "expires in 15 minutes"; Supabase defaults to 3600. A promise in an email the
server does not keep is the kind of small lie that teaches people to distrust the
whole flow.

## Why this is not automated

It needs a Supabase **management** access token, which is not in this checkout —
the service-role key reaches the database and Storage, not project configuration.
Nothing here can be applied from the repo.
