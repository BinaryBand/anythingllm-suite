// A sign-in provider ("Lumen ID"), on its own port, for Cirrus Docs to offer "Continue with Lumen ID".
// It's the authorization-code flow in miniature: /authorize → sign in or choose an account → consent →
// back to the app with a one-use code and the app's state → the app's server swaps the code at /token.

import { error, html } from "../lib/html.js";
import { siblingOrigin } from "../lib/origin.js";
import { byToken, issueToken, revokeToken } from "../lib/session.js";
import { loginForm, signupForm } from "../lib/site.js";
import * as users from "../lib/users.js";

const SITE = "idp";
// The apps that may ask: each one's callback is /auth/callback on its own site.
const CLIENTS = {
  "cirrus-docs": { name: "Cirrus Docs", secret: "cirrus-secret", site: "federated" },
  murmur: { name: "Murmur Chat", secret: "murmur-secret", site: "murmur" },
};
const CODE_MS = 60_000;

export default {
  name: SITE,
  offset: 11,
  title: "Lumen ID",
  color: "#7c3aed",
  tagline: "One account for the apps you use.",
  tests: "The provider behind Cirrus Docs' \"Continue with Lumen ID\": sign-in, a \"Choose an account\" page once this browser has used it, and a consent page (Allow / Cancel). Starts at /authorize, which only the app sends you to.",
  seed() {
    users.seed(SITE);
    if (!users.byEmail(SITE, "bob@lab.test")) users.create(SITE, { email: "bob@lab.test", name: "Bob Example", pass: "Bob-pass-123" });
  },
  build(ctx) {
    const { app, render } = ctx;
    const refuse = (req, res, why) => render(req, res, "Can't sign in", html`<div class="card"><h1>This sign-in request isn't valid</h1><p class="error" role="alert">${why}</p><p class="muted">Go back to the app and try again.</p></div>`, { status: 400 });
    const auth = (req) => req.session.data.auth;
    const clientOf = (req) => CLIENTS[auth(req)?.client_id];
    const accounts = (req) => (req.session.data.accounts ?? []).map(users.byId).filter((u) => u?.site === SITE);

    /** Signs `user` in on this browser and remembers them for the chooser, keeping the request in progress. */
    const startSession = (req, user) => {
      const keep = { auth: auth(req), accounts: req.session.data.accounts ?? [] };
      req.session.signIn(user.id);
      req.session.save({ auth: keep.auth, accounts: [...new Set([...keep.accounts, user.id])] });
    };
    const onward = (req, res) => res.redirect(303, auth(req) ? "/consent" : "/account");

    app.get("/authorize", (req, res) => {
      const { client_id, redirect_uri, response_type, response_mode, state } = req.query;
      const client = Object.hasOwn(CLIENTS, client_id) ? CLIENTS[client_id] : null;
      if (!client) return refuse(req, res, "Unknown app.");
      if (response_type !== "code") return refuse(req, res, "Only response_type=code is supported.");
      if (redirect_uri !== `${siblingOrigin(req, client.site)}/auth/callback`) return refuse(req, res, `The redirect address isn't one registered for ${client.name}.`);
      req.session.save({ auth: { client_id, redirect_uri, state: String(state ?? ""), fragment: response_mode === "fragment" } });
      res.redirect(303, accounts(req).length ? "/choose" : "/login");
    });

    app.get("/choose", (req, res) => {
      if (!auth(req)) return res.redirect(303, "/account");
      render(req, res, "Choose an account", html`<div class="card"><h1>Choose an account</h1>
        <p class="muted">to continue to ${clientOf(req).name}</p>
        ${accounts(req).map((u) => html`<form method="post" action="/choose"><button class="account-choice" type="submit" name="userId" value="${u.id}"><strong>${u.name}</strong><br><small>${u.email}${u.id === req.user?.id ? " · signed in" : ""}</small></button></form>`)}
        <p class="center"><a class="button ghost" href="/login?another=1">Use another account</a></p></div>`);
    });
    app.post("/choose", (req, res) => {
      const picked = accounts(req).find((u) => String(u.id) === String(req.body.userId));
      if (!auth(req) || !picked) return res.redirect(303, "/login");
      if (picked.id === req.user?.id) return res.redirect(303, "/consent");
      res.redirect(303, `/login?another=1&email=${encodeURIComponent(picked.email)}`);
    });

    const loginPage = (req, res, problem, status = 200) =>
      render(req, res, "Sign in", loginForm({ email: req.body?.email ?? req.query.email ?? "", problem, after: auth(req) ? html`<p class="muted center">to continue to ${clientOf(req).name}</p>` : "" }), { status });
    app.get("/login", (req, res) => (req.user && !req.query.another ? onward(req, res) : loginPage(req, res)));
    app.post("/login", (req, res) => {
      const user = users.check(SITE, req.body.email, req.body.password);
      if (!user) return loginPage(req, res, "That email and password don't match an account.", 401);
      startSession(req, user);
      onward(req, res);
    });
    app.get("/signup", (req, res) => render(req, res, "Create account", signupForm({})));
    app.post("/signup", (req, res) => {
      const problem = users.signupProblem(SITE, { email: req.body.email, pass: req.body.password, confirm: req.body.confirm });
      if (problem) return render(req, res, "Create account", signupForm({ values: req.body, problem }), { status: 400 });
      startSession(req, users.create(SITE, { email: req.body.email, name: req.body.name, pass: req.body.password }));
      onward(req, res);
    });

    app.get("/consent", ctx.requireUser, (req, res) => {
      if (!auth(req)) return res.redirect(303, "/account");
      render(req, res, "Allow access", html`<form class="card" method="post" action="/consent">
        <h1>${clientOf(req).name} wants to sign you in</h1>
        <p>Signed in as <strong>${req.user.email}</strong></p>
        <p>${clientOf(req).name} will be able to see:</p>
        <ul><li>your name</li><li>your email address</li></ul>
        <button type="submit" name="decision" value="allow">Allow</button>
        <p class="center"><button class="ghost" type="submit" name="decision" value="deny">Cancel</button></p>
      </form>`);
    });
    app.post("/consent", ctx.requireUser, (req, res) => {
      const pending = auth(req);
      if (!pending) return res.redirect(303, "/account");
      req.session.save({ auth: null });
      const back = new URL(pending.redirect_uri);
      // The answer goes in the query, or after a # (response_mode=fragment) where only the page's script sees it.
      const answer = new URLSearchParams();
      if (req.body.decision === "allow") answer.set("code", issueToken(SITE, { kind: "code", userId: req.user.id, client_id: pending.client_id, redirect_uri: pending.redirect_uri, exp: Date.now() + CODE_MS }));
      else answer.set("error", "access_denied");
      if (pending.state) answer.set("state", pending.state);
      if (pending.fragment) back.hash = answer.toString();
      else back.search = answer.toString();
      res.redirect(303, back.toString());
    });

    // The app's server calls these two, not the browser.
    app.post("/token", (req, res) => {
      const { code, redirect_uri, client_id, client_secret } = req.body;
      const grant = byToken(SITE, code);
      if (code) revokeToken(code); // one use, whether or not it was right
      const client = Object.hasOwn(CLIENTS, client_id) ? CLIENTS[client_id] : null;
      const bad = !grant || grant.kind !== "code" || grant.exp < Date.now() || grant.redirect_uri !== redirect_uri || !client || grant.client_id !== client_id || client_secret !== client.secret;
      if (bad) return res.status(400).json({ error: "invalid_grant" });
      res.json({ access_token: issueToken(SITE, { kind: "access", userId: grant.userId }), token_type: "Bearer", expires_in: 3600 });
    });
    app.get("/userinfo", (req, res) => {
      const grant = byToken(SITE, String(req.get("authorization") ?? "").replace(/^Bearer /i, ""));
      const user = grant?.kind === "access" ? users.byId(grant.userId) : null;
      if (!user) return res.status(401).json({ error: "invalid_token" });
      res.json({ sub: String(user.id), email: user.email, name: user.name });
    });
  },
  account: () => html`<h2>Your Lumen ID</h2><p>Apps that can ask: Cirrus Docs and Murmur Chat. Sign in to an app with "Continue with Lumen ID" and you'll end up here when you come to this site directly.</p>`,
};
