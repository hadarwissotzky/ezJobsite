# Secrets Rotation Checklist — ezQuotePro exposed credentials

> 🔴 **Do this independently of the EZjobsite build — today.** ezQuotePro is soft-launched with these credentials **committed to the repo and shipped in the app bundle**, so assume every one is already public (git history + an `.ipa`/`.apk` can be unzipped by anyone who has one). The EZjobsite greenfield build does **not** inherit this code, but these live keys still protect real accounts (Deepgram spend, your Xano data, your signing identity) right now. Source: the Codex code audit, `CRITIC-REVIEW-05-CODEX-CODE.md` §"URGENT — secrets to rotate NOW" (each item cited to file:line in the real ezQuotePro repo).

*Rule of thumb: "rotate" = issue a new secret and invalidate the old one at the provider; changing the value in code is not enough, because the old value is already exposed. After rotating, also remove the secret from the source (and ideally scrub git history / invalidate old app builds where feasible).*

## The 8 committed secrets

| # | Secret | Where it's exposed | Action | Priority |
|---|---|---|---|---|
| 1 | **Deepgram API secret** | `custom-files/deepgram.js:8` (hardcoded, ships in client bundle) | **Rotate** at Deepgram; move STT behind the backend so the key never reaches a client. Check Deepgram usage for unexpected spend. | 🔴 now |
| 2 | **Xano bearer token** | `config/environments/development.js:4` | **Rotate**; audit Xano access logs for use you don't recognize. | 🔴 now |
| 3 | **MCP bearer token** | `.vscode/mcp.json:6` | **Revoke immediately** (it grants tool/data access; least likely to be missed if killed). | 🔴 now |
| 4 | **iOS distribution-cert password** | `credentials.json:5` | Rotate the password; **treat the cert as compromised if the `.p12` was ever shared/committed** — revoke + reissue the distribution certificate in Apple Developer if so. | 🔴 now |
| 5 | **Android keystore passwords** | plaintext in `LOCAL_BUILD_GUIDE.md:125` | Protect the signing key; if the keystore file itself was shared, you cannot rotate the key without a new upload key — **check Play App Signing key-recovery/reset** options. | 🔴 now |
| 6 | **Google API key** | `development.js:16` / `production.js:16` | **Restrict** the key (by bundle ID + specific API) at minimum; **rotate** if it's unrestricted or high-privilege. | 🟠 today |
| 7 | **RevenueCat keys** | `getSubscriptions.js:8` | RevenueCat **SDK keys are usually public** by design — verify which type this is; **rotate/remove** any secret (`strp_…`/server) key that shouldn't be client-side. | 🟠 verify |
| 8 | **Plaintext user passwords + auth tokens in AsyncStorage** | `LoginScreen.js:388`, `SignUpPersonalScreen.js:588`, `GlobalVariableContext.js:218` | **Stop storing passwords at all**; move tokens to iOS Keychain / Android Keystore. For live users: this is a credential-exposure issue — consider forcing a password reset if these builds reached real users. | 🔴 now (users) |

## After rotation — hygiene so this can't recur

- **Never commit secrets.** Move all of the above to server-side secret storage (Supabase Edge Function secrets / the jobs-runtime env). This is already the EZjobsite rule (ADR-5, CLAUDE mandate: no third-party keys client-side).
- **Client bundles are not private.** Anything shipped in the app can be extracted. Only *public* keys (e.g. a restricted RevenueCat SDK key) belong there.
- **Scrub history where it matters.** Rotating invalidates the exposed values; if you also want them gone from the repo, rewrite git history (e.g. `git filter-repo`) — but rotation is what actually protects you, do that first.
- **Add a guard.** A pre-commit secret scanner (e.g. `gitleaks`) on the EZjobsite repo stops this class of mistake from repeating.

## Note for the EZjobsite build

None of these secrets carry into EZjobsite — it's greenfield. The **pattern** to carry is the opposite of what ezQuotePro did: STT/LLM keys live only in the backend, the device calls *your* Edge Function, and no third-party secret is ever in the client bundle (see `ARCHITECTURE.md` §3.2 / ADR-5).
