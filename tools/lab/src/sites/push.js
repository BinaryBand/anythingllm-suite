// A wallet that checks a password, then asks for approval on a phone: the page shows a 2-digit number
// and waits for it to be entered in the "app" (the dashboard's Phone panel, or POST /api/push/approve there).
// The agent can read the number but can't answer; "Use another method" falls back to an authenticator code.

import otplib from "otplib";
import { error, field, html } from "../lib/html.js";
import * as pushes from "../lib/push.js";
import { passwordAuth } from "../lib/site.js";
import * as users from "../lib/users.js";
import { ALICE_SECRET } from "./totp.js";

const SITE = "push";
const { authenticator } = otplib;

export default {
  name: SITE,
  offset: 13,
  title: "Meridian Wallet",
  color: "#be185d",
  tagline: "Money that asks twice.",
  tests: "Password, then a number to approve on a phone: read the number, then answer it from the dashboard's Phone panel. Approve, deny and time out (60 s) all end differently; \"Use another method\" takes an authenticator code (Alice's secret is on the dashboard).",
  seed: () => users.seed(SITE, { totp: ALICE_SECRET }),
  build(ctx) {
    const { app, render } = ctx;
    const ask = (req, res, userId, next) => {
      const { id, number } = pushes.create(SITE, userId);
      req.session.save({ pending: { userId, next, pushId: id, number } });
      res.redirect(303, "/login/approve");
    };
    passwordAuth(ctx, { signedIn: (req, res, user) => ask(req, res, user.id, req.body.next) });

    const needPending = (req, res, next) => (req.session.data.pending ? next() : res.redirect(303, "/login"));
    const failed = (req, res, status) =>
      render(req, res, "Sign-in not approved", html`<div class="card center"><h1>${status === "denied" ? "Sign-in denied" : "Request timed out"}</h1>
        ${error(status === "denied" ? "The request was denied on your phone." : "Nobody answered the request in time.")}
        <form method="post" action="/login/resend"><button type="submit">Send a new request</button></form>
        <p class="muted"><a href="/login/code">Use another method</a> · <a href="/logout">Cancel</a></p></div>`, { status: 403 });

    app.get("/login/approve", needPending, (req, res) => {
      const { pushId, number } = req.session.data.pending;
      const status = pushes.status(pushId);
      if (status === "approved") return res.redirect(303, "/login/complete");
      if (status !== "pending") return failed(req, res, status);
      render(req, res, "Approve the sign-in", html`<div class="card center"><h1>Approve the sign-in</h1>
        <p>Open Meridian on your phone and enter this number to approve:</p>
        <p class="number" id="push-number" aria-live="polite">${number}</p>
        <p class="muted" id="push-status" role="status">Waiting for approval…</p>
        <form method="get" action="/login/complete"><button class="ghost" type="submit">I've approved it</button></form>
        <p class="muted"><a href="/login/code">Use another method</a> · <a href="/logout">Cancel</a></p></div>
        <script src="/assets/push.js" defer></script>`);
    });
    app.get("/login/status", (req, res) => (req.session.data.pending ? res.json({ status: pushes.status(req.session.data.pending.pushId) }) : res.status(401).json({ error: "no sign-in in progress" })));
    app.get("/login/complete", needPending, (req, res) => {
      const pending = req.session.data.pending;
      if (!pushes.consume(pending.pushId)) return res.redirect(303, "/login/approve");
      ctx.signIn(req, res, users.byId(pending.userId), pending.next);
    });
    app.post("/login/resend", needPending, (req, res) => ask(req, res, req.session.data.pending.userId, req.session.data.pending.next));

    const codePage = (req, res, problem, status = 200) =>
      render(req, res, "Use another method", html`<form class="card" method="post" action="/login/code">
        <h1>Enter a code instead</h1>
        <p>Use the 6-digit code from your authenticator app.</p>
        ${error(problem)}
        ${field({ label: "Authentication code", name: "code", inputmode: "numeric", autocomplete: "one-time-code", maxlength: 6, required: true, autofocus: true })}
        <button type="submit">Verify</button>
        <p class="muted"><a href="/login/approve">Back to the phone approval</a></p></form>`, { status });
    app.get("/login/code", needPending, (req, res) => codePage(req, res));
    app.post("/login/code", needPending, (req, res) => {
      const pending = req.session.data.pending;
      const user = users.byId(pending.userId);
      if (!user.totp) return codePage(req, res, "This account has no authenticator app set up.", 400);
      if (!authenticator.check(String(req.body.code ?? "").replace(/\s/g, ""), user.totp)) return codePage(req, res, "That code didn't work.", 401);
      ctx.signIn(req, res, user, pending.next);
    });
  },
  account: () => html`<h2>Wallet</h2><table><tr><th>Card</th><th>Balance</th></tr><tr><td>Meridian •••• 1042</td><td>$318.20</td></tr></table>`,
};
