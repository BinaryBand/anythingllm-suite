// Passkeys (WebAuthn): sign up with a password, add a passkey on the account page, then sign in with
// "Sign in with a passkey" (a discoverable credential, so no username first). The relying party is
// the host the visitor used, so it works on localhost and behind cloudflared; Chrome allows WebAuthn
// only on https or localhost.

import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import { db } from "../lib/db.js";
import { html, notice } from "../lib/html.js";
import { originOf, rpIdOf } from "../lib/origin.js";
import { passwordAuth } from "../lib/site.js";
import * as users from "../lib/users.js";

const SITE = "passkey";
const RP_NAME = "Keyhole";

const passkeysOf = (userId) => db.prepare("SELECT id, counter, transports, created FROM passkeys WHERE user_id = ? ORDER BY created").all(userId);
const passkeyById = (id) => db.prepare("SELECT p.*, u.site FROM passkeys p JOIN users u ON u.id = p.user_id WHERE p.id = ?").get(id);

const SCRIPTS = html`<script src="/assets/webauthn.js"></script><script src="/assets/passkey.js"></script>`;

export default {
  name: SITE,
  offset: 6,
  title: RP_NAME,
  color: "#be185d",
  tagline: "Your keys, without the passwords.",
  tests: "Passkeys: a password sign-up, then \"Add a passkey\" on the account page (the user, holding the tab); \"Sign in with a passkey\" uses it. Needs https (the tunnel) or localhost.",
  seed: () => users.seed(SITE),
  build(ctx) {
    const { app } = ctx;
    passwordAuth(ctx, {
      after: () => html`<p class="divider">or</p>
        <div class="card center">
          <button type="button" id="passkey-signin" class="ghost">Sign in with a passkey</button>
          <p class="muted" id="passkey-msg" role="status"></p>
        </div>${SCRIPTS}`,
    });
    const fail = (res, status, message) => res.status(status).json({ error: message });

    app.post("/passkey/register/options", ctx.requireUser, async (req, res) => {
      const options = await generateRegistrationOptions({
        rpName: RP_NAME,
        rpID: rpIdOf(req),
        userName: req.user.email,
        userDisplayName: req.user.name || req.user.email,
        userID: new TextEncoder().encode(`keyhole-${req.user.id}`),
        attestationType: "none",
        excludeCredentials: passkeysOf(req.user.id).map((p) => ({ id: p.id, transports: JSON.parse(p.transports) })),
        authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
      });
      req.session.save({ challenge: options.challenge });
      res.json(options);
    });
    app.post("/passkey/register/verify", ctx.requireUser, async (req, res) => {
      const expectedChallenge = req.session.data.challenge;
      req.session.save({ challenge: null });
      if (!expectedChallenge) return fail(res, 400, "Start again: no passkey was being added.");
      let result;
      try {
        result = await verifyRegistrationResponse({ response: req.body, expectedChallenge, expectedOrigin: originOf(req), expectedRPID: rpIdOf(req) });
      } catch (e) {
        return fail(res, 400, `The passkey couldn't be checked: ${e.message}`);
      }
      if (!result.verified) return fail(res, 400, "The passkey couldn't be checked.");
      const { credential } = result.registrationInfo;
      db.prepare("INSERT INTO passkeys (id, user_id, public_key, counter, transports) VALUES (?, ?, ?, ?, ?)").run(
        credential.id, req.user.id, credential.publicKey, credential.counter, JSON.stringify(credential.transports ?? []));
      res.json({ ok: true, redirect: "/account?msg=" + encodeURIComponent("Passkey added.") });
    });

    app.post("/passkey/login/options", async (req, res) => {
      const options = await generateAuthenticationOptions({ rpID: rpIdOf(req), userVerification: "preferred" });
      req.session.save({ challenge: options.challenge });
      res.json(options);
    });
    app.post("/passkey/login/verify", async (req, res) => {
      const expectedChallenge = req.session.data.challenge;
      req.session.save({ challenge: null });
      if (!expectedChallenge) return fail(res, 400, "Start again: no passkey sign-in was under way.");
      const stored = passkeyById(String(req.body?.id ?? ""));
      if (!stored || stored.site !== SITE) return fail(res, 401, "That passkey isn't registered with Keyhole. It may have been removed.");
      let result;
      try {
        result = await verifyAuthenticationResponse({
          response: req.body,
          expectedChallenge,
          expectedOrigin: originOf(req),
          expectedRPID: rpIdOf(req),
          credential: { id: stored.id, publicKey: new Uint8Array(stored.public_key), counter: stored.counter, transports: JSON.parse(stored.transports) },
        });
      } catch (e) {
        return fail(res, 401, `The passkey sign-in couldn't be checked: ${e.message}`);
      }
      if (!result.verified) return fail(res, 401, "The passkey sign-in couldn't be checked.");
      db.prepare("UPDATE passkeys SET counter = ? WHERE id = ?").run(result.authenticationInfo.newCounter, stored.id);
      req.session.signIn(stored.user_id);
      res.json({ ok: true, redirect: "/account" });
    });

    app.post("/passkey/delete", ctx.requireUser, (req, res) => {
      db.prepare("DELETE FROM passkeys WHERE id = ? AND user_id = ?").run(String(req.body.id ?? ""), req.user.id);
      res.redirect(303, "/account?msg=" + encodeURIComponent("Passkey removed."));
    });
    app.get("/api/passkeys", ctx.requireUser, (req, res) => res.json({ passkeys: passkeysOf(req.user.id).map(({ id, created }) => ({ id, created })) }));
  },
  account: (req) => {
    const keys = passkeysOf(req.user.id);
    return html`<h2>Passkeys</h2>
      ${keys.length
        ? html`<table><tr><th>Passkey</th><th>Added</th><th></th></tr>${keys.map((k) => html`<tr><td><code>${k.id.slice(0, 12)}…</code></td><td>${k.created} UTC</td>
            <td><form method="post" action="/passkey/delete"><input type="hidden" name="id" value="${k.id}"><button class="linkish" type="submit">Remove</button></form></td></tr>`)}</table>`
        : notice("You have no passkeys yet. Add one to sign in without your password.")}
      <p><button type="button" id="passkey-add">Add a passkey</button></p>
      <p class="muted" id="passkey-msg" role="status"></p>${SCRIPTS}`;
  },
};
