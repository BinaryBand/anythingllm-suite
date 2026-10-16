// The email on one page and the password on the next, as the big mail providers do: the agent's
// login has only a password field to fill on the second page. "Show password" turns the field into
// a text field, which the skill's rule against typing into password fields doesn't see.

import { error, field, html } from "../lib/html.js";
import { passwordAuth } from "../lib/site.js";
import * as users from "../lib/users.js";

export default {
  name: "twostep",
  offset: 2,
  title: "Northwind Mail",
  color: "#c2410c",
  tagline: "Mail that blows in from the north.",
  tests: "Email on one page, then the password on a second (as Google and Microsoft do): login with only pass_ref there. A \"Show password\" box turns the field into plain text.",
  seed: () => users.seed("twostep"),
  build(ctx) {
    const { app, render } = ctx;
    passwordAuth(ctx, { login: false });

    const emailPage = (req, res, problem, status = 200) =>
      render(req, res, "Sign in", html`<form class="card" method="post" action="/login">
        <h1>Sign in</h1><p class="muted">to continue to Northwind Mail</p>
        ${error(problem)}
        ${field({ label: "Email", name: "email", type: "email", value: req.body?.email ?? "", autocomplete: "username", required: true, autofocus: true })}
        <input type="hidden" name="next" value="${req.body?.next ?? req.query.next ?? ""}">
        <button type="submit">Next</button>
        <p class="muted">No account? <a href="/signup">Create one</a></p>
      </form>`, { status });

    const passwordPage = (req, res, problem, status = 200) => {
      const { email } = req.session.data.pending;
      render(req, res, "Enter your password", html`<form class="card" method="post" action="/login/password">
        <h1>Welcome</h1>
        <p class="account-chip"><strong>${email}</strong> · <a href="/login?switch=1">Not you?</a></p>
        ${error(problem)}
        <input type="email" name="email" value="${email}" autocomplete="username" hidden>
        ${field({ label: "Enter your password", name: "password", type: "password", autocomplete: "current-password", required: true, autofocus: true })}
        <div class="check"><input type="checkbox" id="show"><label for="show">Show password</label></div>
        <button type="submit">Sign in</button>
        <p class="muted"><a href="/login?switch=1">Use another account</a></p>
      </form>
      <script>document.getElementById("show").addEventListener("change", (e) => { document.getElementById("f-password").type = e.target.checked ? "text" : "password"; });</script>`, { status });
    };

    app.get("/login", (req, res) => {
      if (req.query.switch) req.session.save({ pending: null });
      if (req.user) return res.redirect(303, "/account");
      emailPage(req, res);
    });
    app.post("/login", (req, res) => {
      const user = users.byEmail("twostep", req.body.email);
      if (!user) return emailPage(req, res, "Couldn't find a Northwind account with that email.", 404);
      req.session.save({ pending: { email: user.email, next: req.body.next } });
      res.redirect(303, "/login/password");
    });
    app.get("/login/password", (req, res) => (req.session.data.pending ? passwordPage(req, res) : res.redirect(303, "/login")));
    app.post("/login/password", (req, res) => {
      const pending = req.session.data.pending;
      if (!pending) return res.redirect(303, "/login");
      const user = users.check("twostep", pending.email, req.body.password);
      if (!user) return passwordPage(req, res, "Wrong password. Try again or use another account.", 401);
      ctx.signIn(req, res, user, pending.next);
    });
  },
  account: () => html`<h2>Inbox</h2><table><tr><th>From</th><th>Subject</th></tr>
    <tr><td>Northwind Team</td><td>Welcome to Northwind Mail</td></tr>
    <tr><td>Bob Example</td><td>Lunch on Thursday?</td></tr></table>`,
};
