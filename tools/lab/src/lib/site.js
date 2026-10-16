// What every site has: its own Express app, sessions under its own cookie name, the layout, a home
// page, an account page, sign-out and GET /api/me. A site module adds its sign-in and sign-up on
// top through build(ctx); passwordAuth is the plain password version most of them start from.

import path from "node:path";
import express from "express";
import { ROOT } from "./db.js";
import { error, field, html, icon, notice } from "./html.js";
import { sessions } from "./session.js";
import * as users from "./users.js";

const ASSETS = path.join(ROOT, "src", "assets");
const WEBAUTHN = path.join(ROOT, "node_modules", "@simplewebauthn", "browser", "dist", "bundle", "index.umd.min.js");

/** A path on this site to go to after signing in, or null: never another site. */
export const localPath = (to) => (typeof to === "string" && /^\/(?![/\\])/.test(to) ? to : null);

export function createSite(def) {
  const app = express();
  app.set("trust proxy", true);
  app.disable("x-powered-by");
  app.use("/assets", express.static(ASSETS));
  app.get("/favicon.ico", (req, res) => res.status(204).end());
  app.get("/assets/webauthn.js", (req, res) => res.sendFile(WEBAUTHN));
  app.use(express.urlencoded({ extended: false }), express.json());
  app.use(sessions(def.name));
  app.use((req, res, next) => {
    const user = req.session.data.userId ? users.byId(req.session.data.userId) : null;
    req.user = user?.site === def.name ? user : null;
    res.set("Cache-Control", "no-store");
    next();
  });

  const ctx = {
    def,
    app,
    page(req, title, body, { bare = false } = {}) {
      const nav = req.user
        ? html`<a href="/account">Account</a><form method="post" action="/logout"><button class="linkish" type="submit">Sign out</button></form>`
        : html`<a href="/login">Sign in</a><a class="button small" href="/signup">Create account</a>`;
      return html`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · ${def.title}</title>${icon(def.color)}<link rel="stylesheet" href="/assets/lab.css"><style>:root{--brand:${def.color}}</style></head>
<body class="${bare ? "bare" : ""}">${bare ? "" : html`<div class="labbar">Test lab site · not a real service</div>
<header class="top"><a class="brand" href="/">${def.title}</a><nav>${nav}</nav></header>`}
<main>${body}</main></body></html>`.toString();
    },
    render(req, res, title, body, { status = 200, bare = false } = {}) {
      res.status(status).type("html").send(ctx.page(req, title, body, { bare }));
    },
    requireUser(req, res, next) {
      if (req.user) return next();
      if (req.path.startsWith("/api/") || req.is("application/json")) return res.status(401).json({ error: "not signed in" });
      res.redirect(303, `/login?next=${encodeURIComponent(req.originalUrl)}`);
    },
    /** Where a step is done: a redirect, or JSON for a page that posts with fetch. */
    go(req, res, to) {
      if (req.is("application/json")) return res.json({ ok: true, redirect: to });
      res.redirect(303, to);
    },
    /** Signs `user` in with a fresh session and goes on to `next` or the account page. */
    signIn(req, res, user, next) {
      req.session.signIn(user.id);
      ctx.go(req, res, localPath(next) ?? "/account");
    },
  };

  def.build(ctx);

  app.get("/", (req, res) =>
    ctx.render(req, res, "Home", html`<section class="hero"><h1>${def.title}</h1><p class="lead">${def.tagline}</p>
      ${req.user
        ? html`<p>Welcome back, ${req.user.name || req.user.email}. <a href="/account">Go to your account</a></p>`
        : html`<p class="actions"><a class="button" href="/login">Sign in</a> <a class="button ghost" href="/signup">Create account</a></p>`}</section>`),
  );
  app.get("/account", ctx.requireUser, (req, res) =>
    ctx.render(req, res, "Your account", html`<h1>Your account</h1>
      ${notice(req.query.msg)}
      <p class="signed-in">Signed in as <strong>${req.user.name || req.user.email}</strong> (${req.user.email})</p>
      <dl class="facts"><dt>Member since</dt><dd>${req.user.created} UTC</dd>${req.user.phone ? html`<dt>Phone</dt><dd>${req.user.phone}</dd>` : ""}</dl>
      ${def.account ? def.account(req) : ""}`),
  );
  const signOut = (req, res) => {
    req.session.destroy();
    res.redirect(303, "/");
  };
  app.post("/logout", signOut);
  app.get("/logout", signOut);
  app.get("/api/me", ctx.requireUser, (req, res) => res.json({ id: req.user.id, site: def.name, email: req.user.email, name: req.user.name, phone: req.user.phone }));
  app.use((req, res) => ctx.render(req, res, "Not found", html`<h1>Not found</h1><p>There's nothing at ${req.path}.</p>`, { status: 404 }));
  return app;
}

/** The sign-in form: email and password. */
export const loginForm = ({ action = "/login", email = "", next = "", problem, extra = "", after = "" } = {}) => html`
  <form class="card" method="post" action="${action}">
    <h1>Sign in</h1>
    ${error(problem)}
    ${field({ label: "Email", name: "email", type: "email", value: email, autocomplete: "username", required: true })}
    ${field({ label: "Password", name: "password", type: "password", autocomplete: "current-password", required: true })}
    ${extra}
    <input type="hidden" name="next" value="${next}">
    <button type="submit">Sign in</button>
    <p class="muted">New here? <a href="/signup">Create an account</a></p>
  </form>${after}`;

/** The sign-up form: name, email, password twice. */
export const signupForm = ({ action = "/signup", values = {}, problem, extra = "" } = {}) => html`
  <form class="card" method="post" action="${action}">
    <h1>Create your account</h1>
    ${error(problem)}
    ${field({ label: "Full name", name: "name", value: values.name, autocomplete: "name", required: true })}
    ${field({ label: "Email", name: "email", type: "email", value: values.email, autocomplete: "email", required: true })}
    ${field({ label: "Password", name: "password", type: "password", autocomplete: "new-password", required: true, minlength: 8, hint: "At least 8 characters." })}
    ${field({ label: "Confirm password", name: "confirm", type: "password", autocomplete: "new-password", required: true })}
    ${extra}
    <button type="submit">Create account</button>
    <p class="muted">Have an account? <a href="/login">Sign in</a></p>
  </form>`;

/** GET and POST /login and /signup with email and password. Hooks:
 *  login / signup: false to leave that one to the site;
 *  pages: { login(req, res), signup(req, res) } to draw a GET page differently;
 *  extra(req): more of each form; after(req): below the sign-in form;
 *  check(req): why the form can't go ahead (a CAPTCHA, say), or null;
 *  signedIn(req, res, user): instead of signing straight in (a second factor);
 *  created(req, res, user): after sign-up, instead of signing straight in.
 *  A form posted as JSON gets JSON back: { ok, redirect } or { error }. */
export function passwordAuth(ctx, hooks = {}) {
  const { app, render } = ctx;
  const extra = (req) => (hooks.extra ? hooks.extra(req) : "");
  const after = (req) => (hooks.after ? hooks.after(req) : "");
  const refuse = (req, res, problem, status, draw) => (req.is("application/json") ? res.status(status).json({ error: problem }) : draw(req, res, problem, status));
  const showLogin = (req, res, problem, status = 200) =>
    render(req, res, "Sign in", loginForm({ email: req.body?.email ?? "", next: req.body?.next ?? req.query.next ?? "", problem, extra: extra(req), after: after(req) }), { status });
  const showSignup = (req, res, problem, status = 200) =>
    render(req, res, "Create account", signupForm({ values: req.body ?? {}, problem, extra: extra(req) }), { status });

  if (hooks.login !== false) {
    app.get("/login", (req, res) => (req.user ? res.redirect(303, "/account") : (hooks.pages?.login ?? showLogin)(req, res)));
    app.post("/login", (req, res) => {
      const problem = hooks.check?.(req);
      if (problem) return refuse(req, res, problem, 400, showLogin);
      const user = users.check(ctx.def.name, req.body.email, req.body.password);
      if (!user) return refuse(req, res, "That email and password don't match an account.", 401, showLogin);
      if (hooks.signedIn) return hooks.signedIn(req, res, user);
      ctx.signIn(req, res, user, req.body.next);
    });
  }
  if (hooks.signup !== false) {
    app.get("/signup", (req, res) => (hooks.pages?.signup ?? showSignup)(req, res));
    app.post("/signup", (req, res) => {
      const problem = hooks.check?.(req) ?? users.signupProblem(ctx.def.name, { email: req.body.email, pass: req.body.password, confirm: req.body.confirm });
      if (problem) return refuse(req, res, problem, 400, showSignup);
      const user = users.create(ctx.def.name, { email: req.body.email, name: req.body.name, pass: req.body.password });
      if (hooks.created) return hooks.created(req, res, user);
      ctx.signIn(req, res, user);
    });
  }
}

