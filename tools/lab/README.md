# Test lab

Sixteen fake sites with sign-up and sign-in, for trying the AnythingLLM browser skill
(`anythingllm-suite/packages/skills/browser`) against the kinds of login it meets on the web. Each
site tests one part of the skill: `login` with a saved or user-entered password, codes
(`what: authenticator | email | sms`), passkeys, taking the tab over, and `call` with the tab's
session, plus what real sites add around the form: sign-in through another provider, phone approval,
step-up prompts, cookie dialogs and bot checks (see `GAPS.md`). They all run on localhost, one port each, and are meant to go behind a cloudflared tunnel.

```sh
npm install
npm start          # dashboard on http://localhost:4100, sites on 4101–4116
npm run smoke      # its own lab on 4300+, with a throwaway database: every site's flow over HTTP
npm run check      # its own lab on 4400+, driven in a real Chrome and read with the skill's own snapshot code
npm run reset      # removes every account, session, passkey and code; seeds Alice again
```

Needs Node 22.13 or later (it uses the built-in `node:sqlite`). `npm run check` also needs the skill's
source (default `packages/skills/browser` in this repo, or set `SKILL_DIR`) and downloads Chrome
through Puppeteer the first time.

## Signing in

Every site starts with **alice@lab.test** / **Alice-pass-1**.

- On Vaultline Bank (totp) Alice's authenticator secret is `JBSWY3DPEHPK3PXP`. Add it to any
  authenticator app, or read her current code on the dashboard.
- On Parcelpost (otp) Alice's phone is `+15550100`.
- Codes the sites "send" by email or SMS go to the **outbox** on the dashboard
  (http://localhost:4100), which updates by itself. `GET /api/outbox?site=otp&to=alice@lab.test`
  gives the same as JSON.

## The sites

| Port | Site | Sign-in | What to try with the skill |
|---|---|---|---|
| 4101 | **basic**: Pinecrest Notes | Server-rendered email and password form | `login` with user_ref, pass_ref and submit_ref. Save the login on the tab's page, then sign out and back in to see it typed by itself. `call /api/me` and `/api/notes` with `auth: "session"`. The session lasting after Chrome restarts. |
| 4102 | **twostep**: Northwind Mail | Email page → password page | `act` for the email, then `login` with only pass_ref. **"Show password"** turns the password field into `input[text]`, after which `act` will type into it. |
| 4103 | **spa**: Orbit Tasks | Drawn by script; bearer token in **localStorage** | Refs on content the client draws, and waiting for it (the app takes about 600 ms per view). After Chrome restarts the sign-in is gone (the skill keeps cookies, not localStorage). `call /api/me` answers **401**, because `call` sends cookies and this app wants `Authorization: Bearer`. |
| 4104 | **totp**: Vaultline Bank | Password, then a 6-digit authenticator code | `login` with `what: "authenticator"`. A new account goes to a QR code and setup key to turn on two-step verification. 5 wrong codes sign you out. |
| 4105 | **otp**: Parcelpost | No password: email or phone, then a code by email or SMS | `login` with `what: "email"` or `"sms"`. The code is in the outbox. "Send a new code" and "Use a different email or number" are there. |
| 4106 | **passkey**: Keyhole | Password, or **Sign in with a passkey** | The user takes the tab over and presses "Add a passkey" on the account page; the tab's page offers to save it. After signing out, `act` on "Sign in with a passkey" should sign in by itself. Needs a secure page: **https (the tunnel) or localhost**. |
| 4107 | **captcha**: Gatekeeper Forum | Password + digits drawn in an image | Sign-in and sign-up both have the check. The digits aren't in the page's text, so the agent should send the user to take the tab over. A wrong answer gives a new image. |
| 4108 | **iframe**: Harbor Shop | The form is inside an **iframe** | `read` shows no fields (the skill doesn't enter frames). On its own the form is at `/frame/login`. Sign-up is a normal page. |
| 4109 | **shadow**: Prism Studio | Web components in open **shadow roots** | `read` lists the fields, a `switch "Keep me signed in"` and a `div role="button"` for submit. The form posts JSON with fetch. |
| 4110 | **wizard**: Summit Travel | Plain sign-in; sign-up in 3 steps | Account → profile (a select, radios, a date, checkboxes; **Next stays disabled** until it's valid; you must be 18+) → an email code from the outbox. The account exists only after the code. |
| 4111 | **idp**: Lumen ID | A sign-in provider on its own port | Not opened directly. It's where Cirrus Docs sends you: sign-in, a **Choose an account** page once this browser has used it (Alice, Bob), then **consent** (Allow / Cancel). Alice is `alice@lab.test`; Bob is `bob@lab.test` / `Bob-pass-123`. |
| 4112 | **federated**: Cirrus Docs | Password, or **Continue with Lumen ID** | By default the button opens a **popup window** that tells the opener when it's done (`/login`); `/login?social=redirect` makes it a full-page redirect and back. Tests a second window or tab, and a cross-origin round trip. |
| 4113 | **push**: Meridian Wallet | Password, then **approve on a phone** | The page shows a 2-digit number and waits. Answer it in the dashboard's **Phone** panel (type the number), or `POST /api/push/approve` there with `{"number": "42"}`. Deny and time-out (60 s, `LAB_PUSH_TTL`) end differently; "Use another method" takes an authenticator code. |
| 4114 | **stepup**: Stratus Console | Password + authenticator code | "Trust this browser for 30 days" skips the code next time (`/login?risk=1` asks anyway). **Create API key**, **Change email** and **Delete account** ask to confirm (password or code) first, then not again for `LAB_SUDO_SECONDS` (120), renewed by each one. |
| 4115 | **consent**: Acorn Market | Email and password under a **cookie dialog** | The page behind the dialog takes no typing until Accept all / Reject all / Manage. Also: Log in is disabled until both fields are filled, "Forgot password?" is a button, `/login?lang=sv` is Swedish, `?banner=bottom` leaves the form usable, `?banner=late` opens the dialog after two seconds. |
| 4116 | **gate**: Fortress Bank | Password behind a **bot check** | `/login`: "Verifying you are human…" passes by itself, or asks for a click when the browser looks automated (headless Chrome does; `?gate=hard` forces it). `/interstitial/login`: a Continue page first. `/blocked/login`: a 403 block page with no form. |

Every site also has `/account` ("Signed in as …"), `POST /logout` (also `GET /logout`), and
`GET /api/me` (JSON, or 401 when signed out). Each site uses its own cookie, `lab_<site>_sid`,
because on localhost all the ports share one cookie jar.

### What the lab showed about the skill

I drove the sites with Puppeteer and read them with the skill's own `snapshot.ts`. Some findings have
already been fixed in the skill (commit `ee31c1d` there), and `npm run check` now tests the fixed behaviour:

- **Shadow DOM** (fixed): `act` and `login` used a plain CSS lookup that can't enter shadow roots. They now use
  `pierce/`, and the check signs in to Prism Studio by refs.
- **Show password** (fixed): the skill marks a password field when it first reads it, so on Northwind Mail the
  box turning it into text no longer lets `act` type into it.
- **Iframes** (still open): Harbor Shop's sign-in shows no fields to `read`, because the skill doesn't walk
  frames. From the code, taking the tab over doesn't help: a tap reaches the frame, but the user can only
  type into fields `read` found.

## With AnythingLLM

The skill's fence lets through only public addresses, plus the hosts in `FENCE_ALLOW`. It types a
password only over https, or over http to a host in `FENCE_ALLOW`.

**Locally, before the tunnel:**

- AnythingLLM on this machine (not in Docker): set `FENCE_ALLOW=localhost` and open
  `http://localhost:4101`, and so on.
- AnythingLLM in Docker: set `LAB_BIND=0.0.0.0` in this lab's `.env`, `FENCE_ALLOW=host.docker.internal`
  in AnythingLLM's environment, and on Linux add `extra_hosts: ["host.docker.internal:host-gateway"]`
  to its container. Then open `http://host.docker.internal:4101`, and so on.

Locally, all the sites share one host name, and the skill keeps saved logins and passkeys **by
host name, without the port**. A login saved on one site is then offered on all of them. Passkeys
also don't work on `http://host.docker.internal` (Chrome allows WebAuthn only on https or
localhost). The tunnel fixes both.

**Behind cloudflared:** copy `cloudflared.example.yml` to `cloudflared.yml`, put in your domain and
tunnel, and route one hostname per site (the commands are at the top of the file). Cirrus Docs needs **both** `idp` and
`federated` on the tunnel, and `LAB_PUBLIC_URL` set, so the popup and the redirects go to Lumen ID's public host. Then set
`LAB_PUBLIC_URL=https://lab-{name}.example.com` so the dashboard links to them. The sites trust
`X-Forwarded-Proto` and `X-Forwarded-Host`, so cookies are `Secure` and passkeys use the public host
as their relying party. Public https hosts pass the fence with no `FENCE_ALLOW`. Keep the dashboard
(4100) off the tunnel: it shows every code.

## Layout

```
src/server.js         starts the dashboard and every site
src/dashboard.js      the sites, their users, the outbox, reset
src/lib/              the database (node:sqlite), sessions, users, the outbox, phone approvals (push.js), ports, the page layout,
                      and site.js, which every site is built on (createSite, passwordAuth)
src/sites/<name>.js   one site each: { name, offset, title, color, tagline, tests, seed, build, account }
src/assets/           shared CSS and the client scripts (spa, prism web components, passkey)
test/smoke.mjs        npm run smoke
test/check.mjs        npm run check (a real Chrome); test/lab.mjs starts the lab both use;
                      test/build-snapshot.mjs bundles the skill's snapshot.ts
```

To add a site: write `src/sites/<name>.js` the same way, give it the next `offset`, and add it to
`src/sites/index.js` (and to `cloudflared.yml`).
