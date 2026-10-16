// A shop whose pages open with a cookie dialog, and a sign-in form with the quirks the live walk found on
// real pages: a Log in button that stays disabled until both fields are filled, "Forgot password?" as a
// button, and (with ?lang=sv) a page in another language. /login?banner=bottom puts the dialog in a bar
// that leaves the form usable; ?banner=late opens it two seconds after the page, over a form already half filled.

import { error, field, html, raw } from "../lib/html.js";
import { passwordAuth } from "../lib/site.js";
import * as users from "../lib/users.js";

const SITE = "consent";
const WORDS = {
  en: { title: "Sign in", email: "Email", password: "Password", submit: "Log in", forgot: "Forgot password?", fresh: "New here?", create: "Create an account", bad: "That email and password don't match an account." },
  sv: { title: "Logga in", email: "E-post", password: "Lösenord", submit: "Logga in", forgot: "Glömt lösenordet?", fresh: "Ny här?", create: "Skapa ett konto", bad: "E-postadressen och lösenordet stämmer inte med något konto." },
};
const hasChosen = (req) => /(?:^|;\s*)acorn_consent=/.test(req.headers.cookie ?? "");

const dialog = (req) => {
  if (hasChosen(req)) return "";
  const banner = ["bottom", "late"].includes(req.query.banner) ? req.query.banner : "modal";
  return html`<div id="cookie-backdrop" class="cookie-backdrop" ${banner === "bottom" ? raw("hidden") : ""}></div>
    <div id="cookie-dialog" class="cookie-dialog ${banner}" data-banner="${banner}" role="dialog" aria-modal="${banner === "bottom" ? "false" : "true"}" aria-labelledby="cookie-title" ${banner === "late" ? raw("hidden") : ""}>
      <h2 id="cookie-title">We value your privacy</h2>
      <p>We use cookies to run the shop, measure visits and show relevant ads. Choose what you're happy with.</p>
      <div id="cookie-prefs" hidden>
        <label class="check"><input type="checkbox" checked disabled> Necessary (always on)</label>
        <label class="check"><input type="checkbox" id="cookie-analytics"> Analytics</label>
        <label class="check"><input type="checkbox" id="cookie-ads"> Advertising</label>
        <button type="button" id="cookie-save">Save choices</button>
      </div>
      <div class="cookie-actions">
        <button type="button" id="cookie-accept">Accept all</button>
        <button type="button" id="cookie-reject" class="ghost">Reject all</button>
        <button type="button" id="cookie-manage" class="ghost">Manage preferences</button>
      </div>
    </div>`;
};

export default {
  name: SITE,
  offset: 15,
  title: "Acorn Market",
  color: "#c2410c",
  tagline: "Everyday things, delivered.",
  tests: "A cookie dialog over the sign-in form (Accept all / Reject all / Manage; inert page behind it), a Log in button disabled until both fields are filled, \"Forgot password?\" as a button, and /login?lang=sv in Swedish. Variants: /login?banner=bottom and /login?banner=late.",
  seed: () => users.seed(SITE),
  build(ctx) {
    const { app, render } = ctx;
    passwordAuth(ctx, {
      login: false,
      pages: { signup: (req, res) => render(req, res, "Create account", html`${signupFields(req)}${dialog(req)}<script src="/assets/consent.js" defer></script>`) },
    });
    // The sign-up page is the stock one; only the dialog is added, so reuse passwordAuth's form through a thin wrapper.
    function signupFields() {
      return html`<form class="card" method="post" action="/signup">
        <h1>Create your account</h1>
        ${field({ label: "Full name", name: "name", autocomplete: "name", required: true })}
        ${field({ label: "Email", name: "email", type: "email", autocomplete: "email", required: true })}
        ${field({ label: "Password", name: "password", type: "password", autocomplete: "new-password", required: true, minlength: 8 })}
        ${field({ label: "Confirm password", name: "confirm", type: "password", autocomplete: "new-password", required: true })}
        <button type="submit">Create account</button>
        <p class="muted">Have an account? <a href="/login">Sign in</a></p></form>`;
    }

    const loginPage = (req, res, problem, status = 200) => {
      const w = WORDS[(req.body?.lang ?? req.query.lang) === "sv" ? "sv" : "en"];
      const lang = w === WORDS.sv ? "sv" : "en";
      render(req, res, w.title, html`<form class="card" id="login-form" method="post" action="/login">
        <h1>${w.title}</h1>
        ${error(problem)}
        ${field({ label: w.email, name: "email", type: "email", value: req.body?.email ?? "", autocomplete: "username", required: true })}
        ${field({ label: w.password, name: "password", type: "password", autocomplete: "current-password", required: true })}
        <input type="hidden" name="lang" value="${lang}"><input type="hidden" name="next" value="${req.body?.next ?? req.query.next ?? ""}">
        <button type="submit" id="login-submit" data-needs-fields disabled>${w.submit}</button>
        <p><button type="button" class="linkish" id="forgot" data-href="/forgot">${w.forgot}</button></p>
        <p class="muted">${w.fresh} <a href="/signup">${w.create}</a></p>
      </form>${dialog(req)}<script src="/assets/consent.js" defer></script>`, { status });
    };
    app.get("/login", (req, res) => (req.user ? res.redirect(303, "/account") : loginPage(req, res)));
    app.post("/login", (req, res) => {
      const user = users.check(SITE, req.body.email, req.body.password);
      if (!user) return loginPage(req, res, WORDS[req.body.lang === "sv" ? "sv" : "en"].bad, 401);
      ctx.signIn(req, res, user, req.body.next);
    });
    app.get("/forgot", (req, res) =>
      render(req, res, "Forgot password", html`<form class="card" method="post" action="/forgot"><h1>Reset your password</h1><p>Enter your email and we'll send a link if there's an account.</p>
        ${field({ label: "Email", name: "email", type: "email", required: true })}<button type="submit">Send reset link</button></form>`));
    app.post("/forgot", (req, res) => render(req, res, "Check your email", html`<div class="card"><h1>Check your email</h1><p>If there's an account for that address, a reset link is on its way.</p><a class="button" href="/login">Back to sign in</a></div>`));
  },
  account: () => html`<h2>Your orders</h2><table><tr><th>Order</th><th>Status</th></tr><tr><td>#AM-5521</td><td>Delivered</td></tr></table>`,
};
