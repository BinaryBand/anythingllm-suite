// No passwords: a code goes to your email or phone (the lab's outbox, on the dashboard), and you
// type it in. That's the skill's login with what "email" or "sms".

import { error, field, html } from "../lib/html.js";
import * as outbox from "../lib/outbox.js";
import * as users from "../lib/users.js";

const SITE = "otp";

export default {
  name: SITE,
  offset: 5,
  title: "Parcelpost",
  color: "#b45309",
  tagline: "Track every parcel, no password needed.",
  tests: 'No password: an email or phone number, then a code sent by email or SMS (shown in the dashboard\'s outbox): login with what "email" or "sms". Alice\'s phone is +15550100.',
  seed: () => users.seed(SITE, { pass: null, phone: "+15550100" }),
  build(ctx) {
    const { app, render } = ctx;

    const startPage = (req, res, problem, status = 200) =>
      render(req, res, "Sign in", html`<form class="card" method="post" action="/login">
        <h1>Sign in to Parcelpost</h1>
        <p class="muted">We'll send you a one-time code. No password to remember.</p>
        ${error(problem)}
        ${field({ label: "Email or mobile number", name: "identifier", value: req.body?.identifier ?? "", autocomplete: "username", required: true })}
        <fieldset class="choices"><legend>Send my code by</legend>
          <label><input type="radio" name="channel" value="email" ${req.body?.channel === "sms" ? "" : "checked"}> Email</label>
          <label><input type="radio" name="channel" value="sms" ${req.body?.channel === "sms" ? "checked" : ""}> Text message (SMS)</label>
        </fieldset>
        <input type="hidden" name="next" value="${req.body?.next ?? req.query.next ?? ""}">
        <button type="submit">Send code</button>
        <p class="muted">New to Parcelpost? <a href="/signup">Create an account</a></p>
      </form>`, { status });

    const verifyPage = (req, res, problem, status = 200) => {
      const { channel, recipient, purpose } = req.session.data.pending;
      render(req, res, "Enter your code", html`<form class="card" method="post" action="/login/verify">
        <h1>${purpose === "signup" ? "Confirm your email" : "Check your " + (channel === "sms" ? "phone" : "email")}</h1>
        <p>We sent a 6-digit code by ${channel === "sms" ? "text message" : "email"} to <strong>${outbox.masked(channel, recipient)}</strong>. It's good for 10 minutes.</p>
        ${error(problem)}
        ${field({ label: "Code", name: "code", inputmode: "numeric", autocomplete: "one-time-code", maxlength: 6, required: true, autofocus: true })}
        <button type="submit">Verify</button>
      </form>
      <form class="divider" method="post" action="/login/resend"><button class="linkish" type="submit">Send a new code</button> · <a href="/login">Use a different email or number</a></form>`, { status });
    };

    const sendCode = (req, res, pending) => {
      outbox.send(SITE, pending.channel, pending.recipient, pending.purpose);
      req.session.save({ pending });
      res.redirect(303, "/login/verify");
    };

    app.get("/login", (req, res) => (req.user ? res.redirect(303, "/account") : startPage(req, res)));
    app.post("/login", (req, res) => {
      const id = String(req.body.identifier ?? "").trim();
      const user = id.includes("@") ? users.byEmail(SITE, id) : users.byPhone(SITE, id);
      if (!user) return startPage(req, res, "We couldn't find an account with that email or number.", 404);
      const channel = req.body.channel === "sms" ? "sms" : "email";
      if (channel === "sms" && !user.phone) return startPage(req, res, "That account has no mobile number. Choose email instead.", 400);
      sendCode(req, res, { userId: user.id, channel, recipient: channel === "sms" ? user.phone : user.email, purpose: "login", next: req.body.next });
    });
    app.get("/login/verify", (req, res) => (req.session.data.pending ? verifyPage(req, res) : res.redirect(303, "/login")));
    app.post("/login/verify", (req, res) => {
      const pending = req.session.data.pending;
      if (!pending) return res.redirect(303, "/login");
      if (!outbox.redeem(SITE, pending.recipient, pending.purpose, req.body.code)) return verifyPage(req, res, "That code is wrong or has expired.", 401);
      ctx.signIn(req, res, users.byId(pending.userId), pending.next);
    });
    app.post("/login/resend", (req, res) => (req.session.data.pending ? sendCode(req, res, req.session.data.pending) : res.redirect(303, "/login")));

    const signupPage = (req, res, problem, status = 200) =>
      render(req, res, "Create account", html`<form class="card" method="post" action="/signup">
        <h1>Create your Parcelpost account</h1>
        ${error(problem)}
        ${field({ label: "Full name", name: "name", value: req.body?.name, autocomplete: "name", required: true })}
        ${field({ label: "Email", name: "email", type: "email", value: req.body?.email, autocomplete: "email", required: true })}
        ${field({ label: "Mobile number (optional)", name: "phone", type: "tel", value: req.body?.phone, autocomplete: "tel", hint: "For delivery texts, and to sign in by SMS." })}
        <button type="submit">Continue</button>
        <p class="muted">Have an account? <a href="/login">Sign in</a></p>
      </form>`, { status });
    app.get("/signup", (req, res) => signupPage(req, res));
    app.post("/signup", (req, res) => {
      const problem = users.signupProblem(SITE, { email: req.body.email });
      const phone = users.normalPhone(req.body.phone);
      if (problem) return signupPage(req, res, problem, 400);
      if (phone && (phone.replace(/\D/g, "").length < 7 || users.byPhone(SITE, phone))) return signupPage(req, res, "Use a different mobile number.", 400);
      const user = users.create(SITE, { email: req.body.email, name: req.body.name, phone: phone || null });
      sendCode(req, res, { userId: user.id, channel: "email", recipient: user.email, purpose: "signup" });
    });
  },
  account: () => html`<h2>Your parcels</h2><table><tr><th>Tracking</th><th>Status</th></tr>
    <tr><td>PP-2048-7731</td><td>Out for delivery</td></tr><tr><td>PP-2047-1180</td><td>Delivered Oct 12</td></tr></table>`,
};
