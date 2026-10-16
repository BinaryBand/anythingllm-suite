# Gaps in the lab

What the lab's 10 sites don't cover, from a verified research pass on 2026-10-16 (21 sources fetched,
25 claims checked by three voters each; 19 held, 6 were refuted). This is **documentation of how the
sites behave, not a live walk of their sign-in pages**. Only Google, Microsoft, GitHub, PayPal and
Cloudflare were covered, so the order below is a judgement and not a count of how common each pattern is.

## Verified gaps, most useful first
Gaps 1, 2, 3, 4 and 6 are now built in the lab (see **Built in the lab** below); 5, 7, 8 and 9 are still open.

| # | Gap | Real sites | What the skill meets | Lab site to add |
|---|---|---|---|---|
| 1 | **Social / federated login** ("Continue with Google"), in popup mode and in redirect mode | Google Identity Services; iOS needs redirect mode | A second window that returns to the opener, or a 302 to another origin and back to `/callback?code=` | An app on one port with a "Continue with Example IdP" button, and a small OIDC provider on another port (login, consent, "Choose an account"). Build both modes. `cerberauth/stubidp` is a ready-made provider, or write ~100 lines. |
| 2 | **Push / number-matching MFA** | Microsoft Authenticator, GitHub Mobile, PayPal app | A number on the page to type into a phone. The agent can read it but can't approve it, so it must wait or hand over | A site that shows a 2-digit number, polls `/api/status`, and moves on when `/approve?number=NN` is called. Add a timeout, a deny path and a "Use another method" link to TOTP. |
| 3 | **Step-up re-authentication ("sudo mode")** | GitHub (2-hour window; SSH keys, email, tokens, delete account) | A password or code prompt in the middle of a task, after the user is already signed in | A dashboard where "Add API key", "Change email" and "Delete account" redirect to `/sudo?return_to=` and set `sudo_until` (2 min for tests, reset by each sensitive action). Cover wrong password and expiry. |
| 4 | **Remember this device** | PayPal (a remembered browser counts as a factor) | The second factor sometimes doesn't appear, and an agent that waits for it gets stuck | Add "Trust this device for N days" to the TOTP site. A signed cookie skips the code. A `?risk=1` flag forces it anyway. |
| 5 | **Enterprise SSO (SAML)** | Work accounts at many sites | "Work email → Continue with SSO" sends the user to a corporate IdP and posts an assertion back | An identifier-first page that finds the IdP from the email domain and redirects to BoxyHQ `mock-saml` (Docker, port 4000). Needs a small SAML service provider written in the lab. |
| 6 | **Risk-based bot check** (Turnstile style) | Cloudflare Turnstile | "Verifying you are human…" for a few seconds, then it passes, or shows a checkbox. The server checks a single-use token | A login with a fake widget that auto-passes after 1–3 s, or escalates to a checkbox on `?challenge=1` or when `navigator.webdriver` is set. Add a "Checking your browser" full-page interstitial. Use a local verifier, not Cloudflare's. |
| 7 | **Browser-native account chooser (FedCM)** | Google One Tap / Sign in with Google, Chromium only | A chooser drawn by the browser, outside the page, so no DOM selector reaches it | Low priority. A test page using `navigator.credentials.get({identity})` against a localhost provider, plus a fallback path. |
| 8 | **Post-login passkey upsell** | Google's "Simplify your sign in" | A skippable page between sign-in and the landing page, and native WebAuthn dialogs | After password login, redirect to `/passkey-promo` with "Continue" / "Not now". Show it on some logins only, and add a "Remember this browser" version. |
| 9 | **Several delivery methods and "try another way"** | PayPal (SMS, WhatsApp, email, call, app push) | A chooser page where the agent must pick a method that is available, and cope with resend waits | A challenge-chooser page: SMS, email, voice, authenticator, backup code, push. Each leads to its own page. Add resend cooldowns. |

## Built in the lab
| Gap or finding | Site | Port |
|---|---|---|
| 1. Sign in through another provider: popup and redirect modes, account chooser, consent | `idp` (Lumen ID) + `federated` (Cirrus Docs) | 4111, 4112 |
| 2. Push / number-matching approval | `push` (Meridian Wallet), answered in the dashboard's Phone panel | 4113 |
| 3. Step-up re-authentication | `stepup` (Stratus Console), `/sudo` | 4114 |
| 4. Remember this device (and a forced challenge with `?risk=1`) | `stepup` | 4114 |
| 6. Turnstile-style check that passes or escalates to a click, "Continue" interstitial, hard block page | `gate` (Fortress Bank) | 4116 |
| Cookie dialog over the form, disabled-until-filled submit, a button for "Forgot password?", another language | `consent` (Acorn Market) | 4115 |

`npm run smoke` covers each over HTTP and `npm run check` drives them in a real Chrome, reading pages with the
skill's own snapshot code.

## Claims that did not hold up (left out of the table)
- Google recommends popup mode, so popups are the main pattern (0–3). Cover both modes, with no ranking.
- Number matching is on for all Microsoft sign-ins with no opt-out (0–3). Only "the number is shown and entered in the app" held.
- Google shows the passkey prompt only by heuristics such as 2-step verification being on (0–3). Use a flag.
- Turnstile is often invisible (0–3), and a lab needs a hidden `cf-turnstile-response` with no interaction (0–3). Treat it as risk-dependent.
- FedCM became mandatory in August 2025 (0–3).

## Live read of 12 sign-in pages (2026-10-16)
Shallow and read-only: headless Chrome opened each sign-in page once and read it with the skill's snapshot
code. Nothing was typed, clicked or submitted, and no bot check was solved. This is what a fresh, unknown
browser sees on one day, from one network, and it can change.

| Site | What the first page showed | Lab gap it points to |
|---|---|---|
| Google | Email-or-phone page with **Next**, "Forgot email?", "Create account", a language `select`. Redirected to `/v3/signin/identifier`; links open in new windows. | Matches case 2. Add the new-window links and the long redirect URL. |
| Microsoft (live.com) | Email-or-phone page with **Next**. "Forgot your username?" and "Create an account" are `button`s, not links. | Links that are buttons. |
| GitHub | One page with username, password, **Continue with Google**, **Continue with Apple**, **Sign in with a passkey**, plus "Manage cookies" and "Do not share my personal information" buttons. | Social buttons next to a password form (gap 1), and consent buttons on the login page. |
| Facebook | Email, password, Log In. About 25 footer links, and "Forgot password?" carries a long token in the URL. | Plain form with a long footer, and tokens in URLs. |
| Instagram | Log In is **disabled** until both fields are filled. "Log in with Facebook". A cookie-consent dialog with four "Learn more" buttons and a checkbox sits over the page. | Disabled submit on login (the lab has it only in the wizard), social login, and a **consent dialog in front of the form**. |
| Netflix | One page with email-or-phone and password. A cookie banner with **Reject** / **Accept** / **Close** buttons. | Cookie banner. |
| LinkedIn | Served in **Swedish** from the network's location. Show-password button, "Sign in with Apple". | Page language that doesn't match the task, and a show-password button. |
| Apple | A loading spinner, with only the nav links read. The form is drawn after a delay, and may be in an iframe. | Slow script-drawn forms (the lab's spa waits 600 ms; Apple took longer than that) and iframes. |
| Amazon | An interstitial, "Click the button below to continue shopping", before any sign-in form. | A click-through page in front of login. |
| PayPal | "You have been blocked. We couldn't load the security challenge." | Blocked outright (see below). |
| Reddit | "You've been blocked by network security." after a script-challenge redirect. | Blocked outright. |
| X | `403 Access to x.com was denied`. | Blocked outright. |

**What this adds that the documentation didn't:**
- **Bot blocking is common.** 3 of 12 sites refused the headless browser before showing a form, and Amazon put a page in front of the form. Two things for the lab: (a) a **hard block page** with no form, where the agent must stop and say so, and (b) a **click-through interstitial** ("Continue"). Both fit under gap 6.
- **Consent dialogs and cookie banners are real** on Instagram, Netflix and GitHub. This is the first confirmed gap from the "not verified" list. Add a site whose form is covered by a cookie dialog with Accept / Reject / Manage.
- **Disabled-until-filled submit** is on a real login (Instagram), not only in the wizard.
- **Links that are buttons** (Microsoft), and **sign-in drawn late** (Apple).
- **Language follows the network**: one page came back in Swedish, so labels the agent expects ("Sign in") may differ.

**Not done:** the one-probe step (a random username into Google's and Microsoft's email page, then Next) was
denied by the permission check, so the second page of each flow is still unseen. Nothing else was typed.

## Element / Matrix chat (one research agent, documentation only)
Added later by a single agent that read the Matrix spec, Matrix Authentication Service (MAS) docs and Element
docs. Nothing was signed into, and **these did not go through the three-voter check**: many points come from
search summaries, and the agent found no current page describing Element Web's exact popup, tab or label
behaviour. Treat it as leads, not verified claims.

| # | Pattern | What the real flow does | Lab site to add |
|---|---|---|---|
| E1 | **Redirect to an external auth service** (MAS / OIDC-native login) | The client never sees the password: it sends you to the server's own web UI (code + PKCE, consent), then back with a code. With `sso_redirect_options` the app can redirect **before any button is drawn**, so the first page the agent sees may be on another origin with no form. A device-code variant shows a code on one screen to type on another. | Extend `idp`/`federated` with a variant that redirects immediately, and one that returns the code in the URL fragment (`#code=…`). |
| E2 | **Homeserver picker + `.well-known` discovery** before the form | "Your conversations will be hosted by …" with an **Edit** link; after a server is chosen the app fetches its login methods and only then draws the form (password, SSO buttons, or just a redirect). Bad discovery shows an inline error. | A login page that starts with a server field; changing it triggers a delayed fetch of a local `/.well-known` file that swaps the form's methods, plus a "can't find homeserver" case. |
| E3 | **Post-login "Verify this session"** | Needs another device (emoji comparison), a recovery key or a security phrase; "Can't confirm" leads to an **irreversible reset** of the account's encryption keys. Whether it can be dismissed is unclear: the sources disagree (unverified). | A full-screen blocker after sign-in, in a dismissible and a non-dismissible version, with a red "Can't confirm / reset". The test: the agent stops and asks the user, and never presses the reset. |
| E4 | **Sign-up as a server-defined list of stages** | Username (becomes the permanent ID), optional email, password, terms, and, depending on the server, a registration token, a CAPTCHA or an emailed link. The number and order of steps vary. Whether matrix.org shows a CAPTCHA in Element Web is unverified. | A wizard driven by a JSON `flows` list, with runs that need a token field, a terms box, a CAPTCHA stub or an email link that continues in another tab. |
| E5 | **Re-authentication for sensitive actions** (UIA) | A password prompt, or for SSO accounts a confirmation page that goes to the provider and back; the main page polls and carries on. Under MAS only a device-signing step asks. The exact dialog is unverified. | Extend `stepup`: "Remove device" gives a modal; a second variant opens a fallback page in a new tab while the first tab polls. |
| E6 | **QR login** ("Link new device") | The agent can't scan it, so it must find "sign in another way". Current availability on matrix.org is unverified. | A QR image that changes every few seconds, beside a "Sign in another way" link. |
| E7 | Smaller items | A 429 with a countdown after a few tries (`Retry-After`); a session that silently expires mid-task and falls back to the login page; an "use our other app" notice with a continue-anyway link; login options hidden by configuration. | A login that locks for 10 s after 3 tries; a token that expires while the agent works; an interstitial with "Continue anyway". |

Not found in any source: Element Web's accessibility roles and labels, its loading-state timing, and whether
its SSO button opens a popup or a new tab. Only a live read would settle those.

## Not verified: still open
No claim survived for these, so they are neither confirmed nor ruled out. Cookie banners and the bot blocks above are now seen live. The rest are candidates for a live look at the real sign-in pages:

- Cookie / consent banners and modals covering the form
- Magic links (click a link in the email)
- reCAPTCHA v2/v3 and hCaptcha
- Forgot-password flows and email-verify-before-login
- QR-code and device-code login
- Closed shadow roots, canvas and on-screen keyboards
- Password-manager autofill, CSRF hidden fields
- Account / profile pickers
- Payment and 3-D Secure iframes
- Lockouts and rate limits
- How Facebook, Instagram, X, Amazon, Apple, Netflix, LinkedIn and banks do it

## Caveats
- Most sources are vendor documentation. PayPal's page is undated, and the Google passkey article is from 2023.
- `stubidp` has 2 stars and `mock-saml` has no tagged releases, so check them before relying on them.
- The research found no re-auth, sudo or step-up code in this lab (checked by grep).
