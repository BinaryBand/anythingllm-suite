// An app with its own password sign-in and "Continue with Lumen ID", in the two shapes real sites use:
// a popup window that tells the opener when it's done, or the whole page going to the provider and back.
// /login shows the popup one; /login?social=redirect shows the redirect one.

import crypto from "node:crypto";
import { error, html, raw } from "../lib/html.js";
import { originOf, siblingOrigin } from "../lib/origin.js";
import { OFFSETS, portOf } from "../lib/ports.js";
import { passwordAuth } from "../lib/site.js";
import * as users from "../lib/users.js";

const SITE = "federated";
const CLIENT = { id: "cirrus-docs", secret: "cirrus-secret" };
const idpBackChannel = () => `http://127.0.0.1:${portOf({ offset: OFFSETS.idp })}`;

export default {
  name: SITE,
  offset: 12,
  title: "Cirrus Docs",
  color: "#0369a1",
  tagline: "Documents, shared.",
  tests: 'Password sign-in, and "Continue with Lumen ID" (the lab\'s own provider, port 4111): a popup window by default, a full-page redirect at /login?social=redirect. Needs a second window or a cross-origin round trip; Lumen ID has Alice and Bob.',
  seed: () => users.seed(SITE),
  build(ctx) {
    const { app, render } = ctx;
    passwordAuth(ctx, {
      after(req) {
        const mode = req.query.social === "redirect" ? "redirect" : "popup";
        const start = `/auth/lumen?mode=${mode}`;
        return html`<p class="divider">or</p>
          <p class="center">${mode === "redirect"
            ? html`<a class="button ghost" id="lumen-signin" href="${start}">Continue with Lumen ID</a>`
            : html`<button class="ghost" type="button" id="lumen-signin" data-start="${start}">Continue with Lumen ID</button>`}</p>
          <p class="error center" id="lumen-msg" role="alert" hidden></p>
          <script src="/assets/federated.js" defer></script>`;
      },
    });

    app.get("/auth/lumen", (req, res) => {
      const mode = req.query.mode === "redirect" ? "redirect" : "popup";
      const state = crypto.randomBytes(16).toString("base64url");
      req.session.save({ oauth: { state, mode } });
      const to = new URL(`${siblingOrigin(req, "idp")}/authorize`);
      to.searchParams.set("client_id", CLIENT.id);
      to.searchParams.set("response_type", "code");
      to.searchParams.set("redirect_uri", `${originOf(req)}/auth/callback`);
      to.searchParams.set("state", state);
      res.redirect(302, to.toString());
    });

    const finish = (req, res, { ok, problem, status = 200, popup }) => {
      req.session.save({ oauth: null });
      if (!popup) return ok ? res.redirect(303, "/account") : render(req, res, "Sign in", html`<div class="card"><h1>Sign-in didn't finish</h1>${error(problem)}<a class="button" href="/login">Back to sign in</a></div>`, { status: status === 200 ? 400 : status });
      const message = JSON.stringify({ type: "lumen-auth", ok, next: "/account" }).replace(/</g, "\\u003c");
      render(req, res, ok ? "Signed in" : "Not signed in", html`<div class="card"><h1>${ok ? "You're signed in" : "Sign-in didn't finish"}</h1>${error(problem)}<p>${ok ? "You can close this window." : "Close this window and try again."}</p></div>
        ${raw(`<script>(function () { var m = ${message}; try { if (window.opener) { window.opener.postMessage(m, location.origin); window.close(); return; } } catch (e) {} if (m.ok) location.href = m.next; })();</script>`)}`,
      { bare: true, status });
    };

    app.get("/auth/callback", async (req, res) => {
      const oauth = req.session.data.oauth;
      const popup = oauth?.mode === "popup"; // read before signing in, which empties the session
      if (!oauth || !req.query.state || req.query.state !== oauth.state) return finish(req, res, { popup, ok: false, problem: "That sign-in has expired. Start again.", status: 400 });
      if (req.query.error) return finish(req, res, { popup, ok: false, problem: "Lumen ID sign-in was cancelled." });
      try {
        const token = await fetch(`${idpBackChannel()}/token`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ grant_type: "authorization_code", code: String(req.query.code ?? ""), redirect_uri: `${originOf(req)}/auth/callback`, client_id: CLIENT.id, client_secret: CLIENT.secret }),
        });
        if (!token.ok) return finish(req, res, { popup, ok: false, problem: "Lumen ID didn't accept that sign-in.", status: 400 });
        const info = await (await fetch(`${idpBackChannel()}/userinfo`, { headers: { authorization: `Bearer ${(await token.json()).access_token}` } })).json();
        const user = users.byEmail(SITE, info.email) ?? users.create(SITE, { email: info.email, name: info.name });
        req.session.signIn(user.id);
        finish(req, res, { popup, ok: true });
      } catch {
        finish(req, res, { popup, ok: false, problem: "Couldn't reach Lumen ID.", status: 502 });
      }
    });
  },
  account: () => html`<h2>Your documents</h2><table><tr><th>Name</th><th>Edited</th></tr><tr><td>Quarterly plan</td><td>Today</td></tr><tr><td>Meeting notes</td><td>Yesterday</td></tr></table>`,
};
