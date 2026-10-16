// A console with API keys. Two things real sites do after the password: "Trust this browser" so the
// authenticator code isn't asked again (unless /login?risk=1), and a second confirmation before a
// sensitive step (new API key, new email, delete account), good for LAB_SUDO_SECONDS (120) and renewed by each one.

import otplib from "otplib";
import crypto from "node:crypto";
import { error, field, html, notice } from "../lib/html.js";
import { cookies, sign, unsign } from "../lib/session.js";
import { localPath, passwordAuth } from "../lib/site.js";
import * as users from "../lib/users.js";
import { ALICE_SECRET } from "./totp.js";

const SITE = "stepup";
const TRUST = "lab_stepup_trust";
const TRUST_MS = 30 * 24 * 60 * 60 * 1000;
const { authenticator } = otplib;
const windowMs = () => Math.max(1, Number(process.env.LAB_SUDO_SECONDS) || 120) * 1000;
const keysOf = (user) => JSON.parse(user.profile || "{}").keys ?? [];

export default {
  name: SITE,
  offset: 14,
  title: "Stratus Console",
  color: "#4d7c0f",
  tagline: "Cloud keys, kept close.",
  tests: "Password + authenticator code with \"Trust this browser for 30 days\" (a later sign-in skips the code; /login?risk=1 asks anyway), and a password or code prompt before creating an API key, changing the email or deleting the account (/sudo).",
  seed: () => users.seed(SITE, { totp: ALICE_SECRET }),
  build(ctx) {
    const { app, render } = ctx;
    const trusted = (req, user) => {
      const [id, until] = (unsign(cookies(req.headers.cookie)[TRUST]) ?? "").split(":");
      return Number(id) === user.id && Number(until) > Date.now();
    };
    passwordAuth(ctx, {
      extra: (req) => (req.query.risk === "1" || req.body?.risk === "1" ? html`<input type="hidden" name="risk" value="1">` : ""),
      signedIn(req, res, user) {
        if (!user.totp || (req.body.risk !== "1" && trusted(req, user))) return ctx.signIn(req, res, user, req.body.next);
        req.session.save({ pending: { userId: user.id, next: req.body.next, tries: 0 } });
        res.redirect(303, "/login/code");
      },
    });

    const codePage = (req, res, problem, status = 200) =>
      render(req, res, "Two-step verification", html`<form class="card" method="post" action="/login/code">
        <h1>Two-step verification</h1>
        <p>Enter the 6-digit code from your authenticator app.</p>
        ${error(problem)}
        ${field({ label: "Authentication code", name: "code", inputmode: "numeric", autocomplete: "one-time-code", pattern: "[0-9]{6}", maxlength: 6, required: true, autofocus: true })}
        <label class="check"><input type="checkbox" name="trust" id="f-trust"> Trust this browser for 30 days</label>
        <button type="submit">Verify</button></form>`, { status });
    app.get("/login/code", (req, res) => (req.session.data.pending ? codePage(req, res) : res.redirect(303, "/login")));
    app.post("/login/code", (req, res) => {
      const pending = req.session.data.pending;
      const user = pending && users.byId(pending.userId);
      if (!user) return res.redirect(303, "/login");
      if (!authenticator.check(String(req.body.code ?? "").replace(/\s/g, ""), user.totp)) return codePage(req, res, "That code didn't work.", 401);
      if (req.body.trust) res.cookie(TRUST, sign(`${user.id}:${Date.now() + TRUST_MS}`), { httpOnly: true, sameSite: "lax", secure: req.secure, path: "/", maxAge: TRUST_MS });
      ctx.signIn(req, res, user, pending.next);
    });

    // Confirmation before a sensitive step.
    const active = (req) => (req.session.data.sudoUntil ?? 0) > Date.now();
    const needSudo = (back) => (req, res, next) => {
      if (!active(req)) return res.redirect(303, `/sudo?return_to=${encodeURIComponent(back ?? req.originalUrl)}`);
      req.session.save({ sudoUntil: Date.now() + windowMs() });
      next();
    };
    const sudoPage = (req, res, problem, status = 200) => {
      const useCode = (req.body?.method ?? req.query.method) === "code" && req.user.totp;
      const returnTo = req.body?.return_to ?? req.query.return_to ?? "";
      render(req, res, "Confirm it's you", html`<form class="card" method="post" action="/sudo">
        <h1>Confirm it's you</h1>
        <p>You're about to change something sensitive. Confirm to continue.</p>
        ${error(problem)}
        <input type="hidden" name="return_to" value="${returnTo}"><input type="hidden" name="method" value="${useCode ? "code" : "password"}">
        ${useCode
          ? field({ label: "Authentication code", name: "code", inputmode: "numeric", autocomplete: "one-time-code", maxlength: 6, required: true, autofocus: true })
          : field({ label: "Password", name: "password", type: "password", autocomplete: "current-password", required: true, autofocus: true })}
        <button type="submit">Confirm</button>
        <p class="muted">${useCode ? html`<a href="/sudo?return_to=${encodeURIComponent(returnTo)}">Use your password</a>` : req.user.totp ? html`<a href="/sudo?method=code&return_to=${encodeURIComponent(returnTo)}">Use an authenticator code</a>` : ""} · <a href="/account">Cancel</a></p>
      </form>`, { status });
    };
    app.get("/sudo", ctx.requireUser, (req, res) => sudoPage(req, res));
    app.post("/sudo", ctx.requireUser, (req, res) => {
      const ok = req.body.method === "code" ? req.user.totp && authenticator.check(String(req.body.code ?? "").replace(/\s/g, ""), req.user.totp) : users.check(SITE, req.user.email, req.body.password);
      if (!ok) return sudoPage(req, res, req.body.method === "code" ? "That code didn't work." : "That password isn't right.", 401);
      req.session.save({ sudoUntil: Date.now() + windowMs() });
      res.redirect(303, localPath(req.body.return_to) ?? "/account");
    });

    app.get("/account/keys/new", ctx.requireUser, needSudo(), (req, res) =>
      render(req, res, "New API key", html`<form class="card" method="post" action="/account/keys/new"><h1>Create an API key</h1>
        ${field({ label: "Key name", name: "name", required: true, autofocus: true })}<button type="submit">Create key</button><p class="muted"><a href="/account">Cancel</a></p></form>`));
    app.post("/account/keys/new", ctx.requireUser, needSudo("/account/keys/new"), (req, res) => {
      const key = { name: String(req.body.name ?? "").trim() || "Untitled", secret: `lab_sk_${crypto.randomBytes(12).toString("hex")}`, created: new Date().toISOString().slice(0, 16).replace("T", " ") };
      users.update(req.user.id, { profile: JSON.stringify({ keys: [...keysOf(req.user), key] }) });
      render(req, res, "API key created", html`<div class="card"><h1>API key created</h1><p>Copy it now; it won't be shown again.</p><p class="secret" id="new-key">${key.secret}</p><a class="button" href="/account">Done</a></div>`);
    });
    app.get("/account/email", ctx.requireUser, needSudo(), (req, res) =>
      render(req, res, "Change email", html`<form class="card" method="post" action="/account/email"><h1>Change your email</h1>
        ${field({ label: "New email", name: "email", type: "email", required: true, autofocus: true })}<button type="submit">Change email</button><p class="muted"><a href="/account">Cancel</a></p></form>`));
    app.post("/account/email", ctx.requireUser, needSudo("/account/email"), (req, res) => {
      const problem = users.signupProblem(SITE, { email: req.body.email });
      if (problem) return render(req, res, "Change email", html`<div class="card"><h1>Change your email</h1>${error(problem)}<a class="button" href="/account/email">Try again</a></div>`, { status: 400 });
      users.update(req.user.id, { email: users.normal(req.body.email) });
      res.redirect(303, "/account?msg=" + encodeURIComponent("Your email was changed."));
    });
    app.get("/account/delete", ctx.requireUser, needSudo(), (req, res) =>
      render(req, res, "Delete account", html`<form class="card" method="post" action="/account/delete"><h1>Delete your account</h1><p>This removes your account and its keys.</p>
        <button class="danger" type="submit">Delete my account</button><p class="muted"><a href="/account">Cancel</a></p></form>`));
    app.post("/account/delete", ctx.requireUser, needSudo("/account/delete"), (req, res) => {
      users.remove(req.user.id);
      req.session.destroy();
      res.redirect(303, "/");
    });
  },
  account(req) {
    const left = Math.max(0, Math.round(((req.session.data.sudoUntil ?? 0) - Date.now()) / 1000));
    return html`<h2>API keys</h2>
      ${keysOf(req.user).length ? html`<table><tr><th>Name</th><th>Key</th><th>Created</th></tr>${keysOf(req.user).map((k) => html`<tr><td>${k.name}</td><td><code>${k.secret.slice(0, 10)}…</code></td><td>${k.created}</td></tr>`)}</table>` : html`<p class="muted">No keys yet.</p>`}
      <p class="actions"><a class="button" href="/account/keys/new">Create API key</a> <a class="button ghost" href="/account/email">Change email</a> <a class="button danger" href="/account/delete">Delete account</a></p>
      <p class="muted" id="sudo-state">${left ? `Confirmed: no prompt for the next ${left} seconds.` : "Sensitive changes will ask you to confirm."}</p>`;
  },
};
