// A travel site whose sign-up takes three steps: an email and password; a profile with a select,
// radios, a date and checkboxes (Next stays disabled until it's all valid); then a code sent by
// email. The account is only made once the code checks out.

import { error, field, html } from "../lib/html.js";
import * as outbox from "../lib/outbox.js";
import * as passwords from "../lib/passwords.js";
import { passwordAuth } from "../lib/site.js";
import * as users from "../lib/users.js";

const SITE = "wizard";
const COUNTRIES = ["United States", "Canada", "United Kingdom", "Ireland", "Germany", "France", "Spain", "Japan", "Australia", "New Zealand"];
const STYLES = { leisure: "Leisure", business: "Business", both: "A bit of both" };

const steps = (at) => html`<ol class="steps">${["Account", "Profile", "Verify"].map((s, i) => html`<li class="${i === at ? "on" : ""}">${i + 1}. ${s}</li>`)}</ol>`;

function ageOn(dob, today = new Date()) {
  const d = new Date(`${dob}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return -1;
  let age = today.getUTCFullYear() - d.getUTCFullYear();
  if (today.getUTCMonth() < d.getUTCMonth() || (today.getUTCMonth() === d.getUTCMonth() && today.getUTCDate() < d.getUTCDate())) age--;
  return age;
}

function profileProblem(p) {
  if (!String(p.name ?? "").trim()) return "Enter your full name.";
  if (!COUNTRIES.includes(p.country)) return "Choose your country.";
  if (!STYLES[p.style]) return "Choose how you travel.";
  const age = ageOn(p.dob);
  if (age < 0 || age > 120) return "Enter your date of birth.";
  if (age < 18) return "You need to be 18 or over to book with Summit Travel.";
  if (!p.terms) return "Agree to the Terms of Service to go on.";
  return null;
}

export default {
  name: SITE,
  offset: 10,
  title: "Summit Travel",
  color: "#0e7490",
  tagline: "Trips that reach the top.",
  tests: "A sign-up in three steps: account; a profile with a select, radios, a date and checkboxes, Next disabled until it's valid; then an email code from the outbox. Sign-in is a plain form.",
  seed: () => users.seed(SITE, { profile: { country: "Canada", style: "leisure", dob: "1990-04-12", newsletter: false } }),
  build(ctx) {
    const { app, render } = ctx;
    passwordAuth(ctx, { signup: false });
    const wizard = (req) => req.session.data.wizard ?? null;

    const accountStep = (req, res, problem, status = 200) =>
      render(req, res, "Create account", html`<form class="card" method="post" action="/signup">
        ${steps(0)}<h1>Create your account</h1>
        ${error(problem)}
        ${field({ label: "Email", name: "email", type: "email", value: req.body?.email ?? wizard(req)?.email, autocomplete: "email", required: true })}
        ${field({ label: "Password", name: "password", type: "password", autocomplete: "new-password", required: true, minlength: 8, hint: "At least 8 characters." })}
        ${field({ label: "Confirm password", name: "confirm", type: "password", autocomplete: "new-password", required: true })}
        <button type="submit">Next</button>
        <p class="muted">Have an account? <a href="/login">Sign in</a></p>
      </form>`, { status });
    app.get("/signup", (req, res) => accountStep(req, res));
    app.post("/signup", (req, res) => {
      const problem = users.signupProblem(SITE, { email: req.body.email, pass: req.body.password, confirm: req.body.confirm });
      if (problem) return accountStep(req, res, problem, 400);
      req.session.save({ wizard: { email: users.normal(req.body.email), passHash: passwords.hash(req.body.password) } });
      res.redirect(303, "/signup/profile");
    });

    const profileStep = (req, res, problem, status = 200) => {
      const p = req.body?.name !== undefined ? req.body : (wizard(req).profile ?? {});
      render(req, res, "Your profile", html`<form class="card" method="post" action="/signup/profile" id="profile">
        ${steps(1)}<h1>Tell us about you</h1>
        ${error(problem)}
        ${field({ label: "Full name", name: "name", value: p.name, autocomplete: "name", required: true })}
        <div class="field"><label for="f-country">Country</label>
          <select id="f-country" name="country" required><option value="">Choose…</option>
          ${COUNTRIES.map((c) => html`<option ${c === p.country ? "selected" : ""}>${c}</option>`)}</select></div>
        <fieldset class="choices"><legend>How do you usually travel?</legend>
          ${Object.entries(STYLES).map(([v, label]) => html`<label><input type="radio" name="style" value="${v}" required ${v === p.style ? "checked" : ""}> ${label}</label>`)}
        </fieldset>
        ${field({ label: "Date of birth", name: "dob", type: "date", value: p.dob, required: true, max: new Date().toISOString().slice(0, 10) })}
        <div class="check"><input type="checkbox" id="f-newsletter" name="newsletter" ${p.newsletter ? "checked" : ""}><label for="f-newsletter">Send me trip deals (about once a month)</label></div>
        <div class="check"><input type="checkbox" id="f-terms" name="terms" required ${p.terms ? "checked" : ""}><label for="f-terms">I agree to the Terms of Service</label></div>
        <button type="submit" id="next" disabled>Next</button>
        <p class="muted"><a href="/signup">Back</a></p>
      </form>
      <script>
        const form = document.getElementById("profile");
        const next = document.getElementById("next");
        const check = () => { next.disabled = !form.checkValidity(); };
        form.addEventListener("input", check);
        form.addEventListener("change", check);
        check();
      </script>`, { status });
    };
    const needs = (step) => (req, res, next) => {
      const w = wizard(req);
      if (!w) return res.redirect(303, "/signup");
      if (step === "verify" && !w.profile) return res.redirect(303, "/signup/profile");
      next();
    };
    app.get("/signup/profile", needs("profile"), (req, res) => profileStep(req, res));
    app.post("/signup/profile", needs("profile"), (req, res) => {
      const profile = { name: String(req.body.name ?? "").trim(), country: req.body.country, style: req.body.style, dob: req.body.dob, newsletter: !!req.body.newsletter, terms: !!req.body.terms };
      const problem = profileProblem(profile);
      if (problem) return profileStep(req, res, problem, 400);
      const w = wizard(req);
      outbox.send(SITE, "email", w.email, "signup");
      req.session.save({ wizard: { ...w, profile } });
      res.redirect(303, "/signup/verify");
    });

    const verifyStep = (req, res, problem, status = 200) =>
      render(req, res, "Verify your email", html`<form class="card" method="post" action="/signup/verify">
        ${steps(2)}<h1>Check your email</h1>
        <p>We sent a 6-digit code to <strong>${outbox.masked("email", wizard(req).email)}</strong>.</p>
        ${error(problem)}
        ${field({ label: "Verification code", name: "code", inputmode: "numeric", autocomplete: "one-time-code", maxlength: 6, required: true, autofocus: true })}
        <button type="submit">Create my account</button>
      </form>
      <form class="divider" method="post" action="/signup/resend"><button class="linkish" type="submit">Send a new code</button> · <a href="/signup/profile">Back</a></form>`, { status });
    app.get("/signup/verify", needs("verify"), (req, res) => verifyStep(req, res));
    app.post("/signup/resend", needs("verify"), (req, res) => {
      outbox.send(SITE, "email", wizard(req).email, "signup");
      res.redirect(303, "/signup/verify");
    });
    app.post("/signup/verify", needs("verify"), (req, res) => {
      const w = wizard(req);
      if (!outbox.redeem(SITE, w.email, "signup", req.body.code)) return verifyStep(req, res, "That code is wrong or has expired.", 401);
      if (users.byEmail(SITE, w.email)) return accountStep(req, res, "An account with that email already exists.", 409);
      const { name, terms, ...profile } = w.profile;
      const user = users.create(SITE, { email: w.email, name, passHash: w.passHash, profile });
      ctx.signIn(req, res, user, "/signup/done");
    });
    app.get("/signup/done", ctx.requireUser, (req, res) =>
      render(req, res, "Welcome", html`<div class="card center"><h1>You're all set, ${req.user.name.split(" ")[0]}!</h1>
        <p>Your Summit Travel account is ready.</p><a class="button" href="/account">Go to my account</a></div>`));
  },
  account: (req) => {
    const p = JSON.parse(req.user.profile ?? "{}");
    return html`<h2>Travel profile</h2><dl class="facts"><dt>Country</dt><dd>${p.country}</dd><dt>Travel style</dt><dd>${STYLES[p.style]}</dd>
      <dt>Date of birth</dt><dd>${p.dob}</dd><dt>Trip deals</dt><dd>${p.newsletter ? "Yes" : "No"}</dd></dl>`;
  },
};
