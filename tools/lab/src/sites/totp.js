// A bank: a password, then a 6-digit code from an authenticator app (TOTP), which is the skill's
// login with what "authenticator". Alice's secret is fixed, so a test can work out her codes.

import otplib from "otplib";
import QRCode from "qrcode";
import { error, field, html, notice } from "../lib/html.js";
import { passwordAuth } from "../lib/site.js";
import * as users from "../lib/users.js";

const SITE = "totp";
const ISSUER = "Vaultline Bank";
export const ALICE_SECRET = "JBSWY3DPEHPK3PXP";
const MAX_TRIES = 5;
const { authenticator } = otplib;
authenticator.options = { window: 1 };

export default {
  name: SITE,
  offset: 4,
  title: ISSUER,
  color: "#0f766e",
  tagline: "Banking with a second lock on the door.",
  tests: `A password, then a 6-digit authenticator code: login with what "authenticator". Alice's TOTP secret is ${ALICE_SECRET}; a new account sets one up from a QR code.`,
  seed: () => users.seed(SITE, { totp: ALICE_SECRET }),
  build(ctx) {
    const { app, render } = ctx;
    passwordAuth(ctx, {
      signedIn(req, res, user) {
        if (!user.totp) return ctx.signIn(req, res, user, req.body.next);
        req.session.save({ pending: { userId: user.id, next: req.body.next, tries: 0 } });
        res.redirect(303, "/login/code");
      },
      created(req, res, user) {
        req.session.signIn(user.id);
        res.redirect(303, "/account/authenticator");
      },
    });

    const codePage = (req, res, problem, status = 200) =>
      render(req, res, "Two-step verification", html`<form class="card" method="post" action="/login/code">
        <h1>Two-step verification</h1>
        <p>Open your authenticator app and enter the 6-digit code for ${ISSUER}.</p>
        ${error(problem)}
        ${field({ label: "Authentication code", name: "code", inputmode: "numeric", autocomplete: "one-time-code", pattern: "[0-9]{6}", maxlength: 6, required: true, autofocus: true })}
        <button type="submit">Verify</button>
        <p class="muted"><a href="/logout">Cancel and sign out</a></p>
      </form>`, { status });

    app.get("/login/code", (req, res) => (req.session.data.pending ? codePage(req, res) : res.redirect(303, "/login")));
    app.post("/login/code", (req, res) => {
      const pending = req.session.data.pending;
      const user = pending && users.byId(pending.userId);
      if (!user) return res.redirect(303, "/login");
      if (!authenticator.check(String(req.body.code ?? "").replace(/\s/g, ""), user.totp)) {
        pending.tries += 1;
        if (pending.tries >= MAX_TRIES) {
          req.session.destroy();
          return render(req, res, "Sign in", html`<div class="card"><p class="error">Too many wrong codes. Sign in again.</p><a class="button" href="/login">Sign in</a></div>`, { status: 429 });
        }
        req.session.save({ pending });
        return codePage(req, res, `That code didn't work. ${MAX_TRIES - pending.tries} tries left.`, 401);
      }
      ctx.signIn(req, res, user, pending.next);
    });

    const setupPage = async (req, res, problem, status = 200) => {
      if (!req.session.data.newSecret) req.session.save({ newSecret: authenticator.generateSecret() });
      const secret = req.session.data.newSecret;
      const qr = await QRCode.toDataURL(authenticator.keyuri(req.user.email, ISSUER, secret), { margin: 1, width: 180 });
      render(req, res, "Set up your authenticator", html`<form class="card" method="post" action="/account/authenticator">
        <h1>Set up two-step verification</h1>
        <p>Scan this code with your authenticator app (Google Authenticator, 1Password, Authy…), or type in the key below.</p>
        <img class="qr" src="${qr}" alt="QR code for your authenticator app">
        <p class="center">Setup key: <span class="secret" id="setup-key">${secret}</span></p>
        ${error(problem)}
        ${field({ label: "Code from the app", name: "code", inputmode: "numeric", autocomplete: "one-time-code", maxlength: 6, required: true })}
        <button type="submit">Turn on two-step verification</button>
        <p class="muted"><a href="/account">Not now</a></p>
      </form>`, { status });
    };
    app.get("/account/authenticator", ctx.requireUser, (req, res) => setupPage(req, res));
    app.post("/account/authenticator", ctx.requireUser, (req, res) => {
      const secret = req.session.data.newSecret;
      if (!secret || !authenticator.check(String(req.body.code ?? "").replace(/\s/g, ""), secret)) return setupPage(req, res, "That code didn't match. Check the time on your phone and try again.", 400);
      users.update(req.user.id, { totp: secret });
      req.session.save({ newSecret: null });
      res.redirect(303, "/account?msg=" + encodeURIComponent("Two-step verification is on."));
    });
  },
  account: (req) => html`<h2>Accounts</h2>
    <table><tr><th>Account</th><th>Balance</th></tr><tr><td>Everyday checking •••• 4821</td><td>$2,431.18</td></tr><tr><td>Savings •••• 9034</td><td>$12,050.00</td></tr></table>
    <h2>Security</h2>
    ${req.user.totp ? notice("Two-step verification is on.") : html`<p class="error">Two-step verification is off. <a href="/account/authenticator">Turn it on</a></p>`}`,
};
