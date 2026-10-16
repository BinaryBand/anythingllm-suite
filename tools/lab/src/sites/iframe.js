// A shop whose sign-in form is inside an iframe, as embedded sign-in widgets are. The skill's read
// doesn't go into frames, so the form's fields have no refs: the agent sees an empty sign-in page.
// The frame's own address, /frame/login, works on its own too.

import { html, raw } from "../lib/html.js";
import { loginForm, localPath, passwordAuth } from "../lib/site.js";
import * as users from "../lib/users.js";

const SITE = "iframe";

export default {
  name: SITE,
  offset: 8,
  title: "Harbor Shop",
  color: "#0369a1",
  tagline: "Everything for the boat, shipped from the harbor.",
  tests: "The sign-in form is inside an iframe, which the skill's read doesn't enter: no refs for its fields. Sign-up is a normal page. The frame's own page is /frame/login.",
  seed: () => users.seed(SITE),
  build(ctx) {
    const { app, render } = ctx;
    passwordAuth(ctx, { login: false });

    app.get("/login", (req, res) => {
      if (req.user) return res.redirect(303, "/account");
      const next = localPath(req.query.next) ?? "";
      render(req, res, "Sign in", html`<h1 class="center">Sign in to Harbor Shop</h1>
        <iframe class="signin" src="/frame/login${next ? `?next=${encodeURIComponent(next)}` : ""}" title="Harbor Shop sign-in"></iframe>
        <p class="center muted">New customer? <a href="/signup">Create an account</a></p>`);
    });

    const framePage = (req, res, problem, status = 200) =>
      render(req, res, "Sign in", loginForm({ action: "/frame/login", email: req.body?.email ?? "", next: req.body?.next ?? req.query.next ?? "", problem }), { status, bare: true });
    app.get("/frame/login", (req, res) => framePage(req, res));
    app.post("/frame/login", (req, res) => {
      const user = users.check(SITE, req.body.email, req.body.password);
      if (!user) return framePage(req, res, "That email and password don't match an account.", 401);
      req.session.signIn(user.id);
      const to = localPath(req.body.next) ?? "/account";
      // The page around the frame goes on, not just the frame.
      render(req, res, "Signed in", html`<p>Signed in. <a href="${to}" target="_top">Continue</a></p>
        <script>window.top.location.href = ${raw(JSON.stringify(to).replace(/</g, "\\u003c"))};</script>`, { bare: true });
    });
  },
  account: () => html`<h2>Your orders</h2><table><tr><th>Order</th><th>Items</th><th>Total</th></tr>
    <tr><td>#10442</td><td>Marine rope, 30 m</td><td>$64.00</td></tr><tr><td>#10391</td><td>Bilge pump</td><td>$129.50</td></tr></table>`,
};
