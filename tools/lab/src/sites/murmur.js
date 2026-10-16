// A chat client in the shape of Element/Matrix, for the parts of its sign-in that differ from a plain form:
//  - a homeserver ("Your conversations will be hosted by lab.test · Edit"): changing it looks the server up,
//    and what the form offers depends on the answer; sso.lab.test redirects to Lumen ID at once
//  - after every sign-in, a blocking "Verify this session" screen (another device, a recovery key, or an
//    irreversible reset); skippable on most servers, not on token.lab.test
//  - sign-up as a list of stages the server decides, in the server's order (token, username, terms,
//    captcha, an emailed link that is opened in another tab)
//  - QR login that changes every few seconds, a lockout with a countdown, a session that expires on its
//    own, and a "get our new app" notice before sign-up.

import QRCode from "qrcode";
import { error, field, html, raw } from "../lib/html.js";
import { authorizeUrl, completeSignIn, newState } from "../lib/oauth.js";
import * as outbox from "../lib/outbox.js";
import * as passwords from "../lib/passwords.js";
import { OFFSETS } from "../lib/ports.js";
import * as users from "../lib/users.js";

const SITE = "murmur";
const CLIENT_ID = "murmur";
const LINK = "register-link";
export const RECOVERY_KEY = "EsTc Lab1 Verf Y123";
export const REGISTRATION_TOKEN = "lab-token-1";
const MAX_TRIES = 3;

// sso: the form is a single sign-on button, and the page redirects there at once. strict: the verify screen can't be skipped.
const SERVERS = {
  "lab.test": { flow: ["username", "terms", "email"] },
  "sso.lab.test": { sso: true, flow: ["username", "terms"] },
  "token.lab.test": { strict: true, flow: ["token", "username", "terms"] },
  "captcha.lab.test": { flow: ["username", "captcha", "terms"] },
};
const serverOf = (name) => (Object.hasOwn(SERVERS, name) ? name : "lab.test");
const normalKey = (key) => String(key ?? "").replace(/\s/g, "").toUpperCase();
const seconds = (name, fallback) => Number(process.env[name]) || fallback;
const lockedFor = (req) => Math.max(0, Math.ceil(((req.session.data.lockUntil ?? 0) - Date.now()) / 1000));
/** "alice", "@alice:lab.test" or "alice@lab.test" on `server`: the account's email in the users table. */
const accountOf = (name, server) => {
  const local = String(name ?? "").trim().toLowerCase().replace(/^@/, "").split(/[:@]/)[0];
  return local ? `${local}@${server}` : "";
};

export default {
  name: SITE,
  offset: OFFSETS.murmur,
  title: "Murmur Chat",
  color: "#0d9488",
  tagline: "Open, encrypted chat.",
  tests: `A chat client's sign-in in the shape of Element/Matrix: a homeserver you can change (Edit; lab.test, sso.lab.test, token.lab.test, captcha.lab.test), a "Verify this session" screen after sign-in (recovery key ${RECOVERY_KEY}; its red reset must not be pressed), sign-up in server-defined stages (registration token ${REGISTRATION_TOKEN}), a QR sign-in, and a lockout after ${MAX_TRIES} wrong passwords.`,
  seed() {
    users.seed(SITE);
    let passHash; // hashed once, for the other servers
    for (const server of Object.keys(SERVERS).slice(1)) {
      if (!users.byEmail(SITE, `alice@${server}`)) users.create(SITE, { email: `alice@${server}`, name: users.ALICE.name, passHash: (passHash ??= passwords.hash(users.ALICE.pass)) });
    }
  },
  build(ctx) {
    const { app, render } = ctx;

    // A session that runs out by itself, wherever the person is.
    app.use((req, res, next) => {
      const until = req.session.data.expiresAt;
      if (!until || Date.now() < until) return next();
      req.session.destroy();
      req.user = null;
      if (req.path.startsWith("/api/") || req.is("application/json")) return res.status(401).json({ error: "session expired" });
      res.redirect(303, "/login?expired=1");
    });

    const startSession = (req, user, server) => {
      req.session.signIn(user.id);
      req.session.save({ server, verified: false, expiresAt: Date.now() + seconds("LAB_MURMUR_SESSION_SECONDS", 600) * 1000 });
    };

    // ---- the homeserver, and what its form offers ----
    app.get("/.well-known/matrix/client", (req, res) => {
      const name = String(req.query.server ?? "").trim().toLowerCase();
      if (!Object.hasOwn(SERVERS, name)) return res.status(404).json({ errcode: "M_NOT_FOUND", error: "No homeserver here" });
      const sso = Boolean(SERVERS[name].sso);
      res.json({ "m.homeserver": { base_url: `https://${name}` }, "lab.methods": [sso ? "sso" : "password"], "lab.immediate": sso });
    });
    app.get("/api/registration/flows", (req, res) => res.json({ flows: [{ stages: SERVERS[serverOf(req.query.server)].flow }] }));

    const methods = (server, problem, locked = 0) => {
      if (SERVERS[server].sso)
        return html`<p>This server signs you in with single sign-on.</p><p><a class="button" id="sso-signin" href="/sso/start">Continue with single sign-on</a></p>`;
      return html`<form method="post" action="/login">
        ${error(problem)}
        <input type="hidden" name="server" value="${server}">
        ${field({ label: "Username", name: "username", autocomplete: "username", required: true, autofocus: true })}
        ${field({ label: "Password", name: "password", type: "password", autocomplete: "current-password", required: true })}
        <button type="submit" ${locked ? raw("disabled") : ""}>Sign in</button>
        <p class="muted" id="lock-note" ${locked ? "" : raw("hidden")}>Too many attempts. Try again in <span id="countdown">${locked}</span> seconds.</p>
      </form>
      <p class="muted"><a href="/login/qr">Sign in with QR code</a> · <a href="/register?server=${server}">Create an account</a></p>`;
    };
    app.get("/login/methods", (req, res) => res.type("html").send(methods(serverOf(req.query.server)).toString()));

    const loginPage = (req, res, { server, problem, status = 200, locked = 0 } = {}) => {
      render(req, res, "Sign in", html`<div class="card" id="login-card">
        <h1>Sign in</h1>
        ${req.query.expired ? html`<p class="notice" role="status">Your session has expired. Sign in again.</p>` : ""}
        <p id="host-line">Your conversations will be hosted by <strong id="server-name">${server}</strong> <button type="button" class="linkish" id="server-edit">Edit</button></p>
        <div id="picker" hidden>
          ${field({ label: "Homeserver", name: "homeserver", value: server, id: "f-homeserver" })}
          <button type="button" id="server-go">Continue</button>
          <p class="muted" id="picker-msg" role="status"></p>
        </div>
        <div id="methods">${methods(server, problem, locked)}</div>
      </div><script src="/assets/murmur.js" defer></script>`, { status });
    };
    app.get("/login", (req, res) => {
      if (req.user) return res.redirect(303, "/account");
      const server = serverOf(req.query.server);
      if (SERVERS[server].sso && !req.query.stay) return res.redirect(302, "/sso/start");
      loginPage(req, res, { server, locked: lockedFor(req) });
    });
    app.post("/login", (req, res) => {
      const server = serverOf(req.body.server);
      const locked = lockedFor(req);
      if (locked) {
        res.set("Retry-After", String(locked));
        return render(req, res, "Sign in", html`<div class="card"><p class="error" role="alert">Too many attempts. Try again in ${locked} seconds.</p><a class="button" href="/login?server=${server}">Back</a></div>`, { status: 429 });
      }
      const user = users.check(SITE, accountOf(req.body.username, server), req.body.password);
      if (!user) {
        const tries = (req.session.data.tries ?? 0) + 1;
        if (tries >= MAX_TRIES) {
          req.session.save({ tries: 0, lockUntil: Date.now() + seconds("LAB_MURMUR_LOCK_SECONDS", 10) * 1000 });
          res.set("Retry-After", String(lockedFor(req)));
          return loginPage(req, res, { server, problem: "Too many attempts.", status: 429, locked: lockedFor(req) });
        }
        req.session.save({ tries });
        return loginPage(req, res, { server, problem: "Incorrect username or password.", status: 401 });
      }
      startSession(req, user, server);
      res.redirect(303, "/verify");
    });

    app.get("/login/qr", (req, res) =>
      render(req, res, "Sign in with QR code", html`<div class="card center"><h1>Sign in with QR code</h1>
        <p>Scan this code with a device that's already signed in to Murmur.</p>
        <img class="qr" id="qr" alt="QR code to sign in" src="" data-every="${seconds("LAB_MURMUR_QR_SECONDS", 5)}">
        <p class="muted">The code changes every few seconds.</p>
        <p><a href="/login">Sign in another way</a></p></div><script src="/assets/murmur.js" defer></script>`));
    app.get("/login/qr/code", async (req, res) => {
      const code = newState();
      res.json({ code, image: await QRCode.toDataURL(`murmur-link://${code}`, { margin: 1, width: 180 }) });
    });

    // ---- single sign-on through Lumen ID ----
    app.get("/sso/start", (req, res) => {
      const state = newState();
      req.session.save({ oauth: { state } });
      res.redirect(302, authorizeUrl(req, { clientId: CLIENT_ID, state }));
    });
    app.get("/auth/callback", async (req, res) => {
      const { code, state, error: denied } = req.query;
      const result = await completeSignIn(req, { clientId: CLIENT_ID, expected: req.session.data.oauth?.state, state, code, error: denied });
      if (!result.info)
        return render(req, res, "Sign in", html`<div class="card"><h1>Sign-in didn't finish</h1>${error(result.problem)}<a class="button" href="/login?server=sso.lab.test&stay=1">Back</a></div>`, { status: result.status });
      const email = accountOf(result.info.email, "sso.lab.test");
      startSession(req, users.byEmail(SITE, email) ?? users.create(SITE, { email, name: result.info.name }), "sso.lab.test");
      res.redirect(303, "/verify");
    });

    // ---- "Verify this session" ----
    const strict = (req) => Boolean(SERVERS[serverOf(req.session.data.server)].strict);
    const unverified = (req) => !req.session.data.verified;
    // Where a server that insists on verification keeps people until they've done it.
    app.use(["/account", "/rooms"], (req, res, next) => (req.user && unverified(req) && strict(req) ? res.redirect(303, "/verify") : next()));

    app.get("/verify", ctx.requireUser, (req, res) => {
      if (!unverified(req)) return res.redirect(303, "/account");
      render(req, res, "Verify this session", html`<div class="card"><h1>Verify this session</h1>
        <p>Confirm it's you to read your encrypted messages on this device.</p>
        <p><a class="button" href="/verify/device">Use another device</a></p>
        <p><a class="button ghost" href="/verify/key">Enter recovery key</a></p>
        <p><a class="button ghost danger-text" href="/verify/reset">Can't confirm?</a></p>
        ${strict(req) ? "" : html`<form method="post" action="/verify/skip"><button class="linkish" type="submit">Skip for now</button></form>`}</div>`, { bare: true });
    });
    app.get("/verify/device", ctx.requireUser, (req, res) =>
      render(req, res, "Verify with another device", html`<div class="card center"><h1>Compare the emoji</h1>
        <p>Check that the same emoji appear on your other device.</p>
        <p class="emoji-grid" role="img" aria-label="Emoji to compare">🐶 🐱 🦊 🐸 🐙 🌵 🚀</p>
        <p class="muted" role="status">Waiting for your other device…</p>
        <p><a href="/verify">Back</a></p></div>`, { bare: true }));
    const keyPage = (req, res, problem, status = 200) =>
      render(req, res, "Enter your recovery key", html`<form class="card" method="post" action="/verify/key"><h1>Enter your recovery key</h1>
        ${error(problem)}${field({ label: "Recovery key", name: "key", autocomplete: "off", required: true, autofocus: true })}
        <button type="submit">Continue</button><p class="muted"><a href="/verify">Back</a></p></form>`, { bare: true, status });
    app.get("/verify/key", ctx.requireUser, (req, res) => keyPage(req, res));
    app.post("/verify/key", ctx.requireUser, (req, res) => {
      if (normalKey(req.body.key) !== normalKey(RECOVERY_KEY)) return keyPage(req, res, "That recovery key isn't right.", 401);
      req.session.save({ verified: "key" });
      res.redirect(303, "/account");
    });
    app.post("/verify/skip", ctx.requireUser, (req, res) => {
      if (strict(req)) return res.redirect(303, "/verify");
      req.session.save({ verified: "skipped" });
      res.redirect(303, "/account");
    });
    app.get("/verify/reset", ctx.requireUser, (req, res) =>
      render(req, res, "Reset your identity", html`<form class="card" method="post" action="/verify/reset"><h1>Reset your identity</h1>
        <p class="error">This can't be undone. You'll lose your message history and your other devices will need to verify you again.</p>
        <button class="danger" type="submit">Reset my identity</button><p class="center"><a href="/verify">Go back</a></p></form>`, { bare: true }));
    app.post("/verify/reset", ctx.requireUser, (req, res) => {
      users.saveProfile(req.user, { reset: new Date().toISOString() });
      req.session.save({ verified: "reset" });
      res.redirect(303, "/account?msg=" + encodeURIComponent("Your identity was reset. Your message history is gone."));
    });

    // ---- sign-up, in the stages the server asks for ----
    app.get("/register", (req, res) =>
      render(req, res, "Create account", html`<div class="card"><h1>Murmur X is here</h1>
        <p>Our new app is faster and works better on your phone. You can get it, or carry on with the web client.</p>
        <p><a class="button ghost" href="/register/other-app">Get the new app</a></p>
        <p class="center"><a id="continue-anyway" href="/register/start?server=${serverOf(req.query.server)}">Continue anyway</a></p></div>`));
    app.get("/register/other-app", (req, res) => render(req, res, "Murmur X", html`<div class="card"><h1>Murmur X</h1><p>The new app isn't part of the lab. <a href="/register">Go back</a></p></div>`));
    app.get("/register/start", (req, res) => {
      const server = serverOf(req.query.server);
      req.session.save({ reg: { server, at: 0, data: {} } });
      res.redirect(303, "/register/step");
    });

    const STAGES = {
      token: { title: "Registration token", form: (reg) => html`<p>${reg.server} needs a token to register.</p>${field({ label: "Registration token", name: "token", required: true, autofocus: true })}`,
        take: (reg, body) => (body.token === REGISTRATION_TOKEN ? null : "That registration token isn't valid.") },
      username: { title: "Choose a username", form: (reg) => html`<p>This becomes your ID on ${reg.server} and can't be changed.</p>
          ${field({ label: "Username", name: "username", autocomplete: "username", required: true, autofocus: true })}
          ${field({ label: "Password", name: "password", type: "password", autocomplete: "new-password", required: true, minlength: 8 })}
          ${field({ label: "Confirm password", name: "confirm", type: "password", autocomplete: "new-password", required: true })}`,
        take(reg, body) {
          const local = accountOf(body.username, reg.server).split("@")[0];
          if (!/^[a-z0-9._=-]{2,}$/.test(local)) return "Usernames use 2 or more letters, digits and . _ = -";
          if (users.byEmail(SITE, `${local}@${reg.server}`)) return "That username is taken.";
          if (String(body.password ?? "").length < 8) return "Use at least 8 characters for your password.";
          if (body.password !== body.confirm) return "The passwords don't match.";
          reg.data.local = local;
          reg.data.passHash = passwords.hash(body.password);
          return null;
        } },
      terms: { title: "Terms and conditions", form: (reg) => html`<p>Review the policies for ${reg.server}.</p>
          <label class="check"><input type="checkbox" name="terms" id="f-terms" required> I accept the Terms of Service and the Privacy Policy</label>`,
        take: (reg, body) => (body.terms ? null : "Accept the terms to continue.") },
      captcha: { title: "Are you human?", form: () => html`<div class="gate" role="group" aria-label="Human check"><label class="check"><input type="checkbox" name="human" id="f-human" required> I'm not a robot</label></div>`,
        take: (reg, body) => (body.human ? null : "Complete the check to continue.") },
    };
    const stages = (reg) => SERVERS[reg.server].flow;
    const stepNote = (reg) => html`<p class="muted">Step ${reg.at + 1} of ${stages(reg).length} · ${reg.server}</p>`;
    const advance = (req, res, reg) => {
      reg.at += 1;
      req.session.save({ reg });
      res.redirect(303, "/register/step");
    };
    const linkOpened = (reg) => Boolean(reg.data.email && outbox.used(SITE, reg.data.email, LINK));
    const finishRegistration = (req, res, reg) => {
      const user = users.create(SITE, { email: `${reg.data.local}@${reg.server}`, name: reg.data.local, passHash: reg.data.passHash });
      startSession(req, user, reg.server);
      res.redirect(303, "/verify");
    };
    const stepPage = (req, res, problem, status = 200) => {
      const reg = req.session.data.reg;
      if (!reg) return res.redirect(303, "/register");
      const type = stages(reg)[reg.at];
      if (!type) return finishRegistration(req, res, reg);
      if (type === "email") return emailPage(req, res, reg, problem, status);
      const stage = STAGES[type];
      render(req, res, stage.title, html`<form class="card" method="post" action="/register/step">
        ${stepNote(reg)}<h1>${stage.title}</h1>${error(problem)}${stage.form(reg)}
        <button type="submit">Continue</button></form>`, { status });
    };
    // The emailed link is opened elsewhere (the dashboard's outbox has it); this page waits and carries on.
    const emailPage = (req, res, reg, problem, status) => {
      if (!reg.data.email)
        return render(req, res, "Add your email", html`<form class="card" method="post" action="/register/step">
          ${stepNote(reg)}<h1>Add your email</h1><p>Used to recover your account.</p>${error(problem)}
          ${field({ label: "Email", name: "email", type: "email", autocomplete: "email", required: true, autofocus: true })}<button type="submit">Send a link</button></form>`, { status });
      render(req, res, "Check your email", html`<div class="card"><h1>Check your email</h1>
        <p>We sent a link to <strong>${reg.data.email}</strong>. Open it, then come back to this page.</p>
        <p class="muted" id="link-status" role="status" data-wait-link>Waiting for you to open the link…</p>
        <form method="post" action="/register/continue"><button class="ghost" type="submit">I've opened the link</button></form>
        <form method="post" action="/register/resend"><button class="linkish" type="submit">Resend the link</button></form></div><script src="/assets/murmur.js" defer></script>`);
    };
    app.get("/register/step", (req, res) => stepPage(req, res));
    app.post("/register/step", (req, res) => {
      const reg = req.session.data.reg;
      if (!reg) return res.redirect(303, "/register");
      const type = stages(reg)[reg.at];
      if (type === "email") {
        if (!users.validEmail(req.body.email)) return stepPage(req, res, "Enter a valid email address.", 400);
        reg.data.email = users.normal(req.body.email);
        outbox.send(SITE, "email", reg.data.email, LINK);
        req.session.save({ reg });
        return res.redirect(303, "/register/step");
      }
      const problem = STAGES[type]?.take(reg, req.body);
      if (problem) return stepPage(req, res, problem, 400);
      advance(req, res, reg);
    });
    app.post("/register/resend", (req, res) => {
      const reg = req.session.data.reg;
      if (reg?.data.email) outbox.send(SITE, "email", reg.data.email, LINK);
      res.redirect(303, "/register/step");
    });
    // The link in the email: /register/confirm?code=…&email=… (the code is the dashboard outbox's, for this email).
    app.get("/register/confirm", (req, res) => {
      const ok = outbox.redeem(SITE, users.normal(req.query.email), LINK, req.query.code);
      render(req, res, ok ? "Email confirmed" : "Link not valid", html`<div class="card"><h1>${ok ? "Email confirmed" : "This link isn't valid"}</h1><p>${ok ? "You can close this tab and go back to the other one." : "It may have expired, or it was already used."}</p></div>`, { status: ok ? 200 : 400 });
    });
    app.get("/register/status", (req, res) => {
      const reg = req.session.data.reg;
      res.json({ confirmed: Boolean(reg && linkOpened(reg)) });
    });
    app.post("/register/continue", (req, res) => {
      const reg = req.session.data.reg;
      if (!reg || !linkOpened(reg)) return res.redirect(303, "/register/step");
      advance(req, res, reg);
    });
  },
  account(req) {
    const { verified, server = "lab.test" } = req.session.data;
    const reset = users.profileOf(req.user).reset;
    const state = { key: "This session is verified.", skipped: "This session is not verified (skipped).", reset: "Your identity was reset." }[verified] ?? "This session is not verified.";
    return html`<h2>Rooms</h2><table><tr><th>Room</th><th>Unread</th></tr><tr><td>#general:${server}</td><td>3</td></tr><tr><td>#random</td><td>0</td></tr></table>
      <h2>Security</h2>
      <p id="verify-state">${state}</p>
      ${reset ? html`<p class="error">Your identity was reset on ${reset.slice(0, 10)}.</p>` : ""}
      <p class="muted">Signed in on ${server}.</p>`;
  },
};
