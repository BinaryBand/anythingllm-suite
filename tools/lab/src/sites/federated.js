// An app with its own password sign-in and "Continue with Lumen ID", in the shapes real sites use:
// a popup window that tells the opener when it's done, or the whole page going to the provider and back.
//   /login                  the popup button
//   /login?social=redirect  a link that redirects the whole page
//   /login?social=fragment  the same, but the provider answers after a # that only the page's script can read
//   /login?social=auto      no form at all: the page redirects to the provider at once

import crypto from "node:crypto";
import { error, html, raw } from "../lib/html.js";
import { authorizeUrl, exchange } from "../lib/oauth.js";
import { passwordAuth } from "../lib/site.js";
import * as users from "../lib/users.js";

const SITE = "federated";
const CLIENT = { id: "cirrus-docs", secret: "cirrus-secret" };

export default {
  name: SITE,
  offset: 12,
  title: "Cirrus Docs",
  color: "#0369a1",
  tagline: "Documents, shared.",
  tests: 'Password sign-in, and "Continue with Lumen ID" (the lab\'s own provider, port 4111): a popup window by default, a full-page redirect at /login?social=redirect, the answer after a # at ?social=fragment, and an immediate redirect with no form at ?social=auto. Lumen ID has Alice and Bob.',
  seed: () => users.seed(SITE),
  build(ctx) {
    const { app, render } = ctx;
    app.get("/login", (req, res, next) => (req.query.social === "auto" && !req.user ? res.redirect(302, "/auth/lumen?mode=redirect") : next()));
    passwordAuth(ctx, {
      after(req) {
        const social = ["redirect", "fragment"].includes(req.query.social) ? req.query.social : "popup";
        const start = `/auth/lumen?mode=${social === "popup" ? "popup" : "redirect"}${social === "fragment" ? "&response=fragment" : ""}`;
        return html`<p class="divider">or</p>
          <p class="center">${social === "popup"
            ? html`<button class="ghost" type="button" id="lumen-signin" data-start="${start}">Continue with Lumen ID</button>`
            : html`<a class="button ghost" id="lumen-signin" href="${start}">Continue with Lumen ID</a>`}</p>
          <p class="error center" id="lumen-msg" role="alert" hidden></p>
          <script src="/assets/federated.js" defer></script>`;
      },
    });

    app.get("/auth/lumen", (req, res) => {
      const mode = req.query.mode === "redirect" ? "redirect" : "popup";
      const fragment = mode === "redirect" && req.query.response === "fragment";
      const state = crypto.randomBytes(16).toString("base64url");
      req.session.save({ oauth: { state, mode, fragment } });
      res.redirect(302, authorizeUrl(req, { clientId: CLIENT.id, state, fragment }));
    });

    /** Checks the answer and swaps the code for who signed in; signs them in. { ok } or { problem, status }. */
    const complete = async (req, { code, state, error: denied }) => {
      const oauth = req.session.data.oauth;
      if (!oauth || !state || state !== oauth.state) return { problem: "That sign-in has expired. Start again.", status: 400 };
      if (denied) return { problem: "Lumen ID sign-in was cancelled.", status: 400 };
      try {
        const info = await exchange(req, { clientId: CLIENT.id, secret: CLIENT.secret, code });
        if (!info) return { problem: "Lumen ID didn't accept that sign-in.", status: 400 };
        req.session.signIn((users.byEmail(SITE, info.email) ?? users.create(SITE, { email: info.email, name: info.name })).id);
        return { ok: true };
      } catch {
        return { problem: "Couldn't reach Lumen ID.", status: 502 };
      }
    };

    const finish = (req, res, { popup, ok, problem, status = 200 }) => {
      req.session.save({ oauth: null });
      if (!popup) return ok ? res.redirect(303, "/account") : render(req, res, "Sign in", html`<div class="card"><h1>Sign-in didn't finish</h1>${error(problem)}<a class="button" href="/login">Back to sign in</a></div>`, { status });
      const message = JSON.stringify({ type: "lumen-auth", ok: Boolean(ok), next: "/account" }).replace(/</g, "\\u003c");
      render(req, res, ok ? "Signed in" : "Not signed in", html`<div class="card"><h1>${ok ? "You're signed in" : "Sign-in didn't finish"}</h1>${error(problem)}<p>${ok ? "You can close this window." : "Close this window and try again."}</p></div>
        ${raw(`<script>(function () { var m = ${message}; try { if (window.opener) { window.opener.postMessage(m, location.origin); window.close(); return; } } catch (e) {} if (m.ok) location.href = m.next; })();</script>`)}`,
      { bare: true, status: ok ? 200 : status });
    };

    app.get("/auth/callback", async (req, res) => {
      const oauth = req.session.data.oauth;
      const popup = oauth?.mode === "popup"; // read before signing in, which empties the session
      // With response_mode=fragment the answer is after a #, which the server never gets: the page's script posts it.
      if (oauth?.fragment && !req.query.code && !req.query.error)
        return render(req, res, "Signing you in", html`<div class="card"><h1>Signing you in…</h1><p class="error" id="msg" role="alert" hidden></p></div>
          ${raw(`<script>(function () { var h = new URLSearchParams(location.hash.slice(1)); fetch("/auth/callback/complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: h.get("code"), state: h.get("state"), error: h.get("error") }) }).then(function (r) { return r.json(); }).then(function (d) { if (d.ok) return location.replace(d.redirect); var m = document.getElementById("msg"); m.textContent = d.problem; m.hidden = false; }); })();</script>`)}`, { bare: true });
      finish(req, res, { popup, ...(await complete(req, { code: req.query.code, state: req.query.state, error: req.query.error })) });
    });
    app.post("/auth/callback/complete", async (req, res) => {
      const result = await complete(req, req.body);
      req.session.save({ oauth: null });
      res.status(result.ok ? 200 : result.status).json(result.ok ? { ok: true, redirect: "/account" } : { ok: false, problem: result.problem });
    });
  },
  account: () => html`<h2>Your documents</h2><table><tr><th>Name</th><th>Edited</th></tr><tr><td>Quarterly plan</td><td>Today</td></tr><tr><td>Meeting notes</td><td>Yesterday</td></tr></table>`,
};
