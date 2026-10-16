// A sign-in provider ("Lumen ID"), on its own port, for Cirrus Docs to offer "Continue with Lumen ID".
// It's the authorization-code flow in miniature: /authorize → sign in or choose an account → consent →
// back to the app with a one-use code and the app's state → the app's server swaps the code at /token.

import { error, html } from "../lib/html.js";
import { siblingOrigin } from "../lib/origin.js";
import { byToken, issueToken, revokeToken } from "../lib/session.js";
import { loginForm, signupForm } from "../lib/site.js";
import * as users from "../lib/users.js";

const SITE = "idp";
const CLIENT = { id: "cirrus-docs", secret: "cirrus-secret", name: "Cirrus Docs" };
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
    const accounts = (req) => (req.session.data.accounts ?? []).map(users.byId).filter((u) => u?.site === SITE);

    /** Signs `user` in on this browser and remembers them for the chooser, keeping the request in progress. */
    const startSession = (req, user) => {
      const keep = { auth: auth(req), accounts: req.session.data.accounts ?? [] };
      req.session.signIn(user.id);
      req.session.save({ auth: keep.auth, accounts: [...new Set([...keep.accounts, user.id])] });
    };
    const onward = (req, res) => res.redirect(303, auth(req) ? "/consent" : "/account");

    app.get("/authorize", (req, res) => {
      const { client_id, redirect_uri, response_type, state } = req.query;
      if (client_id !== CLIENT.id) return refuse(req, res, "Unknown app.");
      if (response_type !== "code") return refuse(req, res, "Only response_type=code is supported.");
      if (redirect_uri !== `${siblingOrigin(req, "federated")}/auth/callback`) return refuse(req, res, `The redirect address isn't one registered for ${CLIENT.name}.`);
      req.session.save({ auth: { redirect_uri, state: String(state ?? "") } });
      res.redirect(303, accounts(req).length ? "/choose" : "/login");
    });

    app.get("/choose", (req, res) => {
      if (!auth(req)) return res.redirect(303, "/account");
      render(req, res, "Choose an account", html`<div class="card"><h1>Choose an account</h1>
        <p class="muted">to continue to ${CLIENT.name}</p>
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
      render(req, res, "Sign in", loginForm({ email: req.body?.email ?? req.query.email ?? "", problem, after: auth(req) ? html`<p class="muted center">to continue to ${CLIENT.name}</p>` : "" }), { status });
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
        <h1>${CLIENT.name} wants to sign you in</h1>
        <p>Signed in as <strong>${req.user.email}</strong></p>
        <p>${CLIENT.name} will be able to see:</p>
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
      if (req.body.decision === "allow") back.searchParams.set("code", issueToken(SITE, { kind: "code", userId: req.user.id, redirect_uri: pending.redirect_uri, exp: Date.now() + CODE_MS }));
      else back.searchParams.set("error", "access_denied");
      if (pending.state) back.searchParams.set("state", pending.state);
      res.redirect(303, back.toString());
    });

    // The app's server calls these two, not the browser.
    app.post("/token", (req, res) => {
      const { code, redirect_uri, client_id, client_secret } = req.body;
      const grant = byToken(SITE, code);
      if (code) revokeToken(code); // one use, whether or not it was right
      const bad = !grant || grant.kind !== "code" || grant.exp < Date.now() || grant.redirect_uri !== redirect_uri || client_id !== CLIENT.id || client_secret !== CLIENT.secret;
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
  account: () => html`<h2>Your Lumen ID</h2><p>Apps you've allowed: Cirrus Docs. Sign in to an app with "Continue with Lumen ID" and you'll end up here when you come to this site directly.</p>`,
};
