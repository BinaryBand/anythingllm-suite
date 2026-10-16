// npm run smoke: starts its own lab (ports 4300+, a throwaway database) and goes through each site's
// sign-up and sign-in over HTTP, as a browser would, without one. A passkey's ceremony needs a
// browser, so for Keyhole only the options are checked.

import assert from "node:assert/strict";
import otplib from "otplib";
import { CAPTCHA, startLab } from "./lab.mjs";

const BASE = Number(process.env.SMOKE_BASE_PORT || 4300);
const PASS = "Alice-pass-1";
const ALICE = "alice@lab.test";
const port = (offset) => BASE + offset;
const fresh = (who) => `${who}-${Date.now().toString(36)}@lab.test`;

/** A visitor to one site: its own cookies, redirects not followed. */
class Visitor {
  constructor(offset) {
    this.base = `http://localhost:${port(offset)}`;
    this.jar = new Map();
  }
  async go(pathname, { method = "GET", form, json, headers = {} } = {}) {
    const h = { ...headers };
    if (this.jar.size) h.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    let body;
    if (form) (body = new URLSearchParams(form).toString()), (h["content-type"] = "application/x-www-form-urlencoded");
    if (json) (body = JSON.stringify(json)), (h["content-type"] = "application/json");
    const r = await fetch(this.base + pathname, { method, headers: h, body, redirect: "manual" });
    for (const c of r.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(";");
      const at = pair.indexOf("=");
      const gone = attrs.some((a) => /expires=thu, 01 jan 1970/i.test(a.trim()));
      if (gone) this.jar.delete(pair.slice(0, at));
      else this.jar.set(pair.slice(0, at), pair.slice(at + 1));
    }
    const text = await r.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {}
    return { status: r.status, location: r.headers.get("location"), text, json: data };
  }
  post(pathname, form) {
    return this.go(pathname, { method: "POST", form });
  }
  async me(status = 200) {
    const r = await this.go("/api/me");
    assert.equal(r.status, status, `/api/me on ${this.base}`);
    return r.json;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SECRET = "JBSWY3DPEHPK3PXP";
const totpNow = () => otplib.authenticator.generate(SECRET);
const phone = (action, number) => fetch(`http://localhost:${BASE}/api/push/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ number }) });
const lastCode = (site, to) => lab.lastCode(site, to);

function redirects(r, to, why = "") {
  assert.equal(r.status, 303, `${why} expected a redirect to ${to}, got ${r.status}: ${r.text.slice(0, 200)}`);
  assert.equal(r.location, to, why);
}

const checks = {
  async basic() {
    const v = new Visitor(1);
    assert.equal((await v.post("/login", { email: ALICE, password: "wrong" })).status, 401);
    redirects(await v.post("/login", { email: ALICE, password: PASS }), "/account");
    assert.match((await v.go("/account")).text, /Signed in as/);
    assert.equal((await v.me()).email, ALICE);
    redirects(await v.post("/notes", { note: "From the smoke test" }), "/account");
    assert.ok((await v.go("/api/notes")).json.notes.includes("From the smoke test"));
    redirects(await v.post("/logout", {}), "/");
    await v.me(401);
    const n = new Visitor(1);
    const email = fresh("bob");
    assert.equal((await n.post("/signup", { name: "Bob", email, password: "short", confirm: "short" })).status, 400);
    redirects(await n.post("/signup", { name: "Bob", email, password: "Bob-pass-12", confirm: "Bob-pass-12" }), "/account");
    assert.equal((await n.me()).email, email);
  },
  async twostep() {
    const v = new Visitor(2);
    assert.equal((await v.post("/login", { email: "nobody@lab.test" })).status, 404);
    redirects(await v.post("/login", { email: ALICE }), "/login/password");
    assert.match((await v.go("/login/password")).text, /alice@lab\.test/);
    assert.equal((await v.post("/login/password", { password: "wrong" })).status, 401);
    redirects(await v.post("/login/password", { password: PASS }), "/account");
    await v.me();
  },
  async spa() {
    const v = new Visitor(3);
    assert.match((await v.go("/")).text, /spa\.js/);
    assert.equal((await v.go("/api/login", { method: "POST", json: { email: ALICE, password: "nope" } })).status, 401);
    const { token } = (await v.go("/api/login", { method: "POST", json: { email: ALICE, password: PASS } })).json;
    assert.ok(token);
    await v.me(401); // the skill's call sends cookies, which this site doesn't use
    const auth = { authorization: `Bearer ${token}` };
    assert.equal((await v.go("/api/me", { headers: auth })).json.email, ALICE);
    assert.equal((await v.go("/api/tasks", { method: "POST", json: { title: "Smoke" }, headers: auth })).json.tasks.at(-1).title, "Smoke");
    const s = await v.go("/api/signup", { method: "POST", json: { name: "Cy", email: fresh("cy"), password: "Cy-pass-123" } });
    assert.ok(s.json.token);
  },
  async totp() {
    const v = new Visitor(4);
    redirects(await v.post("/login", { email: ALICE, password: PASS }), "/login/code");
    await v.me(401);
    assert.equal((await v.post("/login/code", { code: "000000" })).status, 401);
    redirects(await v.post("/login/code", { code: otplib.authenticator.generate("JBSWY3DPEHPK3PXP") }), "/account");
    await v.me();
    const n = new Visitor(4);
    const email = fresh("dee");
    redirects(await n.post("/signup", { name: "Dee", email, password: "Dee-pass-123", confirm: "Dee-pass-123" }), "/account/authenticator");
    const secret = (await n.go("/account/authenticator")).text.match(/id="setup-key">([A-Z2-7]+)</)?.[1];
    assert.ok(secret, "the setup page shows a key");
    redirects(await n.post("/account/authenticator", { code: otplib.authenticator.generate(secret) }), "/account?msg=Two-step%20verification%20is%20on.");
    const again = new Visitor(4);
    redirects(await again.post("/login", { email, password: "Dee-pass-123" }), "/login/code");
  },
  async otp() {
    const v = new Visitor(5);
    redirects(await v.post("/login", { identifier: ALICE, channel: "email" }), "/login/verify");
    assert.equal((await v.post("/login/verify", { code: "000000" })).status, 401);
    redirects(await v.post("/login/verify", { code: await lastCode("otp", ALICE) }), "/account");
    await v.me();
    const s = new Visitor(5);
    redirects(await s.post("/login", { identifier: "+1 555 0100", channel: "sms" }), "/login/verify");
    assert.match((await s.go("/login/verify")).text, /0100/);
    redirects(await s.post("/login/verify", { code: await lastCode("otp", "+15550100") }), "/account");
    const n = new Visitor(5);
    const email = fresh("eve");
    redirects(await n.post("/signup", { name: "Eve", email, phone: "" }), "/login/verify");
    redirects(await n.post("/login/verify", { code: await lastCode("otp", email) }), "/account");
    assert.equal((await n.me()).email, email);
  },
  async passkey() {
    const v = new Visitor(6);
    assert.match((await v.go("/login")).text, /Sign in with a passkey/);
    const login = await v.go("/passkey/login/options", { method: "POST", json: {} });
    assert.equal(login.json.rpId, "localhost");
    assert.equal((await v.go("/passkey/register/options", { method: "POST", json: {} })).status, 401);
    redirects(await v.post("/login", { email: ALICE, password: PASS }), "/account");
    const reg = await v.go("/passkey/register/options", { method: "POST", json: {} });
    assert.equal(reg.json.rp.id, "localhost");
    assert.equal(reg.json.authenticatorSelection.residentKey, "required");
    const behind = await v.go("/passkey/login/options", { method: "POST", json: {}, headers: { "x-forwarded-host": "lab-passkey.example.com", "x-forwarded-proto": "https" } });
    assert.equal(behind.json.rpId, "lab-passkey.example.com", "behind the tunnel the relying party is the public host");
    assert.equal((await v.go("/passkey/login/verify", { method: "POST", json: { id: "nope" } })).status, 401);
  },
  async captcha() {
    const v = new Visitor(7);
    assert.match((await v.go("/captcha.svg")).text, /^<svg/);
    assert.equal((await v.post("/login", { email: ALICE, password: PASS, captcha: "11111" })).status, 400);
    await v.go("/captcha.svg");
    redirects(await v.post("/login", { email: ALICE, password: PASS, captcha: CAPTCHA }), "/account");
    await v.me();
    const n = new Visitor(7);
    await n.go("/captcha.svg");
    redirects(await n.post("/signup", { name: "Fay", email: fresh("fay"), password: "Fay-pass-123", confirm: "Fay-pass-123", captcha: CAPTCHA }), "/account");
  },
  async iframe() {
    const v = new Visitor(8);
    assert.match((await v.go("/login")).text, /<iframe[^>]+src="\/frame\/login"/);
    assert.equal((await v.post("/frame/login", { email: ALICE, password: "wrong" })).status, 401);
    const r = await v.post("/frame/login", { email: ALICE, password: PASS, next: "/account" });
    assert.match(r.text, /window\.top\.location\.href = "\/account"/);
    await v.me();
  },
  async shadow() {
    const v = new Visitor(9);
    assert.match((await v.go("/login")).text, /<prism-auth mode="login"/);
    const bad = await v.go("/login", { method: "POST", json: { email: ALICE, password: "wrong" } });
    assert.equal(bad.status, 401);
    assert.ok(bad.json.error);
    const ok = await v.go("/login", { method: "POST", json: { email: ALICE, password: PASS, remember: true } });
    assert.deepEqual(ok.json, { ok: true, redirect: "/account" });
    await v.me();
    const n = new Visitor(9);
    const s = await n.go("/signup", { method: "POST", json: { name: "Gus", email: fresh("gus"), password: "Gus-pass-123", confirm: "Gus-pass-123" } });
    assert.equal(s.json.redirect, "/account");
  },
  async wizard() {
    const v = new Visitor(10);
    const email = fresh("hal");
    redirects(await v.post("/signup", { email, password: "Hal-pass-123", confirm: "Hal-pass-123" }), "/signup/profile");
    const profile = { name: "Hal Example", country: "Japan", style: "both", dob: "1985-06-01", terms: "on" };
    assert.equal((await v.post("/signup/profile", { ...profile, dob: new Date().toISOString().slice(0, 10) })).status, 400);
    assert.equal((await v.post("/signup/profile", { ...profile, terms: "" })).status, 400);
    redirects(await v.post("/signup/profile", profile), "/signup/verify");
    redirects(await v.post("/signup/verify", { code: await lastCode("wizard", email) }), "/signup/done");
    assert.match((await v.go("/signup/done")).text, /all set, Hal/);
    assert.equal((await v.me()).name, "Hal Example");
    const a = new Visitor(10);
    redirects(await a.post("/login", { email: ALICE, password: PASS }), "/account");
  },

  async idp() {
    const redirectUri = `http://localhost:${port(12)}/auth/callback`;
    const authorize = (over = {}) => "/authorize?" + new URLSearchParams({ client_id: "cirrus-docs", response_type: "code", redirect_uri: redirectUri, state: "abc", ...over });
    const tokenAt = (code, over = {}) =>
      fetch(`http://localhost:${port(11)}/token`, { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: "cirrus-docs", client_secret: "cirrus-secret", ...over }) });
    const v = new Visitor(11);
    assert.equal((await v.go(authorize({ redirect_uri: "http://evil.test/cb" }))).status, 400);
    assert.equal((await v.go(authorize({ client_id: "other" }))).status, 400);
    redirects(await v.go(authorize()), "/login");
    assert.equal((await v.post("/login", { email: ALICE, password: "wrong" })).status, 401);
    redirects(await v.post("/login", { email: ALICE, password: PASS }), "/consent");
    assert.match((await v.go("/consent")).text, /Cirrus Docs wants to sign you in/);
    const back = new URL((await v.post("/consent", { decision: "allow" })).location);
    assert.equal(back.origin + back.pathname, redirectUri);
    assert.equal(back.searchParams.get("state"), "abc");
    const code = back.searchParams.get("code");
    assert.equal((await tokenAt(code, { client_secret: "wrong" })).status, 400, "a wrong secret spends the code too");
    assert.equal((await tokenAt(code)).status, 400, "a code works once");
    const again = new URL((await (async () => { await v.go(authorize()); return v.post("/choose", { userId: (await v.go("/api/me")).json.id }); })()).location, "http://x");
    assert.equal(again.pathname, "/consent");
    const code2 = new URL((await v.post("/consent", { decision: "allow" })).location).searchParams.get("code");
    const token = await (await tokenAt(code2)).json();
    const info = await (await fetch(`http://localhost:${port(11)}/userinfo`, { headers: { authorization: `Bearer ${token.access_token}` } })).json();
    assert.equal(info.email, ALICE);
    assert.equal((await fetch(`http://localhost:${port(11)}/userinfo`)).status, 401);
    // with an account already used here, the next request starts at the chooser; Cancel sends access_denied
    const chooser = await v.go(authorize());
    redirects(chooser, "/choose");
    assert.match((await v.go("/choose")).text, /Choose an account[\s\S]*alice@lab\.test[\s\S]*Use another account/);
    const denied = new URL((await (async () => { await v.post("/choose", { userId: (await v.go("/api/me")).json.id }); return v.post("/consent", { decision: "deny" }); })()).location);
    assert.equal(denied.searchParams.get("error"), "access_denied");
    assert.equal(denied.searchParams.get("state"), "abc");
  },
  async federated() {
    for (const mode of ["redirect", "popup"]) {
      const app = new Visitor(12);
      const id = new Visitor(11);
      const start = await app.go(`/auth/lumen?mode=${mode}`);
      assert.equal(start.status, 302);
      const to = new URL(start.location);
      assert.equal(to.origin, `http://localhost:${port(11)}`);
      redirects(await id.go(to.pathname + to.search), "/login");
      redirects(await id.post("/login", { email: ALICE, password: PASS }), "/consent");
      const back = new URL((await id.post("/consent", { decision: "allow" })).location);
      const done = await app.go(back.pathname + back.search);
      if (mode === "redirect") redirects(done, "/account");
      else {
        assert.equal(done.status, 200);
        assert.match(done.text, /"type":"lumen-auth","ok":true/);
      }
      assert.equal((await app.me()).email, ALICE);
    }
    // the provider can answer after a # (response_mode=fragment): the page's script posts it to the server
    const frag = new Visitor(12);
    const fid = new Visitor(11);
    const fstart = new URL((await frag.go("/auth/lumen?mode=redirect&response=fragment")).location);
    assert.equal(fstart.searchParams.get("response_mode"), "fragment");
    redirects(await fid.go(fstart.pathname + fstart.search), "/login");
    redirects(await fid.post("/login", { email: ALICE, password: PASS }), "/consent");
    const fback = new URL((await fid.post("/consent", { decision: "allow" })).location);
    assert.equal(fback.search, "", "nothing in the query");
    const answer = new URLSearchParams(fback.hash.slice(1));
    assert.ok(answer.get("code") && answer.get("state"));
    assert.match((await frag.go("/auth/callback")).text, /auth\/callback\/complete/);
    const bad2 = await frag.go("/auth/callback/complete", { method: "POST", json: { code: answer.get("code"), state: "nope" } });
    assert.equal(bad2.status, 400);
    await frag.go("/auth/lumen?mode=redirect&response=fragment");
    const again = await frag.go("/auth/callback/complete", { method: "POST", json: { code: answer.get("code"), state: "stale" } });
    assert.equal(again.json.ok, false);
    // an auto-redirect login has no form at all
    const auto = await new Visitor(12).go("/login?social=auto");
    assert.equal(auto.status, 302);
    assert.equal(auto.location, "/auth/lumen?mode=redirect");
    const stray = new Visitor(12);
    await stray.go("/auth/lumen?mode=popup");
    const bad = await stray.go("/auth/callback?code=x&state=nope");
    assert.equal(bad.status, 400);
    assert.match(bad.text, /"ok":false/);
    await stray.me(401);
    assert.match((await new Visitor(12).go("/login")).text, /<button[^>]*id="lumen-signin"[^>]*>Continue with Lumen ID/);
    assert.match((await new Visitor(12).go("/login?social=redirect")).text, /<a[^>]*id="lumen-signin"[^>]*>Continue with Lumen ID/);
  },
  async push() {
    const number = async (v) => (await v.go("/login/approve")).text.match(/id="push-number"[^>]*>(\d+)</)[1];
    const status = async (v) => (await v.go("/login/status")).json.status;
    const v = new Visitor(13);
    redirects(await v.post("/login", { email: ALICE, password: PASS }), "/login/approve");
    const n = await number(v);
    assert.equal(await status(v), "pending");
    assert.equal((await phone("approve", n === "10" ? "11" : "10")).status, 404, "a number nobody is waiting on");
    redirects(await v.go("/login/complete"), "/login/approve");
    assert.equal((await phone("approve", n)).status, 200);
    assert.equal(await status(v), "approved");
    redirects(await v.go("/login/complete"), "/account");
    assert.equal((await v.me()).email, ALICE);
    redirects(await v.go("/login/complete"), "/login", "the pending sign-in is gone once it is used");
    const d = new Visitor(13);
    await d.post("/login", { email: ALICE, password: PASS });
    assert.equal((await phone("deny", await number(d))).status, 200);
    assert.match((await d.go("/login/approve")).text, /Sign-in denied/);
    const c = new Visitor(13);
    await c.post("/login", { email: ALICE, password: PASS });
    assert.equal((await c.post("/login/code", { code: "000000" })).status, 401);
    redirects(await c.post("/login/code", { code: totpNow() }), "/account");
    const t = new Visitor(13);
    await t.post("/login", { email: ALICE, password: PASS });
    await sleep(2300);
    assert.equal(await status(t), "expired");
    assert.match((await t.go("/login/approve")).text, /Request timed out/);
    redirects(await t.post("/login/resend", {}), "/login/approve");
    assert.equal(await status(t), "pending");
    assert.equal((await (await fetch(`http://localhost:${BASE}/api/push`)).json()).length, 1);
  },
  async stepup() {
    const v = new Visitor(14);
    redirects(await v.post("/login", { email: ALICE, password: PASS }), "/login/code");
    assert.equal((await v.post("/login/code", { code: "000000" })).status, 401);
    redirects(await v.post("/login/code", { code: totpNow(), trust: "on" }), "/account");
    assert.ok(v.jar.has("lab_stepup_trust"), "the trust cookie is set");
    await v.post("/logout", {});
    redirects(await v.post("/login", { email: ALICE, password: PASS }), "/account", "a trusted browser skips the code");
    await v.post("/logout", {});
    redirects(await v.post("/login", { email: ALICE, password: PASS, risk: "1" }), "/login/code");
    redirects(await v.post("/login/code", { code: totpNow() }), "/account");
    const key = "/account/keys/new";
    redirects(await v.go(key), `/sudo?return_to=${encodeURIComponent(key)}`);
    assert.equal((await v.post("/sudo", { method: "password", password: "wrong", return_to: key })).status, 401);
    redirects(await v.post("/sudo", { method: "password", password: PASS, return_to: key }), key);
    assert.equal((await v.go(key)).status, 200, "no prompt inside the window");
    assert.match((await v.post(key, { name: "ci" })).text, /lab_sk_[0-9a-f]{24}/);
    assert.match((await v.go("/account")).text, /Confirmed: no prompt for the next/);
    await sleep(2300);
    redirects(await v.go("/account/email"), `/sudo?return_to=${encodeURIComponent("/account/email")}`);
    redirects(await v.post("/sudo", { method: "code", code: totpNow(), return_to: "/account/email" }), "/account/email");
    redirects(await v.post("/account/email", { email: "alice2@lab.test" }), "/account?msg=" + encodeURIComponent("Your email was changed."));
    assert.equal((await v.me()).email, "alice2@lab.test");
    // removing a device with no recent confirmation opens a confirmation page, answered in another tab
    const d = new Visitor(14);
    redirects(await d.post("/login", { email: "alice2@lab.test", password: PASS }), "/login/code");
    redirects(await d.post("/login/code", { code: totpNow() }), "/account");
    assert.match((await d.go("/account/devices")).text, /Firefox on macOS/);
    const asked = await d.post("/account/devices/remove", { id: "d2" });
    const token = asked.text.match(/href="\/confirm\?token=([0-9a-f]+)"/)[1];
    assert.equal((await d.go("/account/devices/status")).json.done, false);
    const other = new Visitor(14); // the same browser's other tab shares the cookies
    other.jar = d.jar;
    assert.match((await other.go(`/confirm?token=${token}`)).text, /A client is trying to change your account/);
    assert.equal((await other.post("/confirm", { token, password: "wrong" })).status, 401);
    assert.match((await other.post("/confirm", { token, password: PASS })).text, /Confirmed/);
    assert.equal((await d.go("/account/devices/status")).json.done, true);
    assert.doesNotMatch((await d.go("/account/devices")).text, /Firefox on macOS/);
    assert.equal((await d.go(`/confirm?token=${token}`)).status, 400, "a confirmation works once");
    redirects(await v.post("/account/delete", {}), "/");
    await v.me(401);
  },
  async consent() {
    const v = new Visitor(15);
    const page = (await v.go("/login")).text;
    assert.match(page, /role="dialog"/);
    assert.match(page, /id="login-submit"[^>]*disabled/);
    assert.match(page, /Accept all[\s\S]*Reject all[\s\S]*Manage preferences/);
    assert.match((await v.go("/login?banner=bottom")).text, /data-banner="bottom"/);
    assert.match((await v.go("/login?lang=sv")).text, /Glömt lösenordet\?/);
    const chosen = await v.go("/login", { headers: { cookie: "acorn_consent=none" } });
    assert.doesNotMatch(chosen.text, /role="dialog"/);
    assert.equal((await v.post("/login", { email: ALICE, password: "wrong" })).status, 401);
    redirects(await v.post("/login", { email: ALICE, password: PASS }), "/account");
    assert.match((await new Visitor(15).post("/forgot", { email: "nobody@lab.test" })).text, /If there's an account/);
  },
  async gate() {
    const v = new Visitor(16);
    const challenge = async (body = {}, headers = {}) => (await v.go("/gate/challenge", { method: "POST", json: body, headers })).json;
    const solve = (id, clicked) => v.go("/gate/solve", { method: "POST", json: { id, clicked } });
    assert.equal((await v.post("/login", { email: ALICE, password: PASS })).status, 400, "no token");
    const plain = await challenge();
    assert.equal(plain.needsClick, false);
    assert.equal((await solve(plain.id)).status, 429, "too fast");
    assert.equal((await challenge({ webdriver: true })).needsClick, true);
    assert.equal((await challenge({}, { "user-agent": "Mozilla/5.0 HeadlessChrome/148" })).needsClick, true);
    const hard = await challenge({ hard: true });
    assert.equal((await solve(hard.id, false)).status, 400, "a click is needed");
    await sleep(1200);
    const solved = await solve(plain.id);
    assert.equal(solved.status, 200);
    assert.equal((await v.post("/login", { email: ALICE, password: PASS, gate_token: (await challenge()).id })).status, 400, "an unsolved token");
    redirects(await v.post("/login", { email: ALICE, password: PASS, gate_token: solved.json.token }), "/account");
    await v.post("/logout", {});
    assert.equal((await v.post("/login", { email: ALICE, password: PASS, gate_token: solved.json.token })).status, 400, "a token works once");
    const blocked = await v.go("/blocked/login");
    assert.equal(blocked.status, 403);
    assert.doesNotMatch(blocked.text, /<form/);
    const w = new Visitor(16);
    assert.match((await w.go("/interstitial/login")).text, /<button type="submit">Continue<\/button>/);
    redirects(await w.post("/interstitial/continue", {}), "/login");
    redirects(await w.go("/interstitial/login"), "/login");
  },

  async murmur() {
    const v = new Visitor(17);
    const login = (visitor, server, username, password = PASS) => visitor.post("/login", { server, username, password });
    assert.equal((await v.go("/.well-known/matrix/client?server=nope.test")).status, 404);
    assert.equal((await v.go("/.well-known/matrix/client?server=sso.lab.test")).json["lab.immediate"], true);
    const immediate = await v.go("/login?server=sso.lab.test");
    assert.equal(immediate.status, 302);
    assert.equal(immediate.location, "/sso/start");
    assert.match((await v.go("/login/methods?server=sso.lab.test")).text, /Continue with single sign-on/);
    assert.match((await v.go("/login")).text, /hosted by <strong id="server-name">lab\.test<\/strong>[\s\S]*Edit/);
    // three wrong passwords lock the form, even for the right one
    assert.equal((await login(v, "lab.test", "alice", "x")).status, 401);
    assert.equal((await login(v, "lab.test", "alice", "x")).status, 401);
    const locked = await login(v, "lab.test", "alice", "x");
    assert.equal(locked.status, 429);
    assert.match(locked.text, /Try again in <span id="countdown">\d+<\/span> seconds/);
    assert.equal((await login(v, "lab.test", "alice")).status, 429);
    // a good sign-in goes to the verify screen, which can be skipped on lab.test
    const w = new Visitor(17);
    redirects(await login(w, "lab.test", "@alice:lab.test"), "/verify");
    const verify = (await w.go("/verify")).text;
    assert.match(verify, /Verify this session[\s\S]*Use another device[\s\S]*Enter recovery key[\s\S]*Can't confirm\?[\s\S]*Skip for now/);
    assert.match((await w.go("/verify/device")).text, /Waiting for your other device/);
    redirects(await w.post("/verify/skip", {}), "/account");
    assert.match((await w.go("/account")).text, /not verified \(skipped\)/);
    // token.lab.test insists: no skip, and the account stays behind it until the recovery key is given
    const s = new Visitor(17);
    redirects(await login(s, "token.lab.test", "alice"), "/verify");
    assert.doesNotMatch((await s.go("/verify")).text, /Skip for now/);
    redirects(await s.go("/account"), "/verify");
    redirects(await s.post("/verify/skip", {}), "/verify");
    assert.equal((await s.post("/verify/key", { key: "wrong" })).status, 401);
    redirects(await s.post("/verify/key", { key: "estc lab1 verf y123" }), "/account");
    assert.match((await s.go("/account")).text, /This session is verified/);
    // the reset is real, and irreversible on the page
    const r = new Visitor(17);
    await login(r, "captcha.lab.test", "alice");
    assert.match((await r.go("/verify/reset")).text, /can't be undone/);
    assert.match((await r.post("/verify/reset", {})).location, /^\/account\?msg=/);
    assert.match((await r.go("/account")).text, /Your identity was reset/);
    // QR codes change
    const [q1, q2] = [(await v.go("/login/qr/code")).json, (await v.go("/login/qr/code")).json];
    assert.match(q1.image, /^data:image\/png/);
    assert.notEqual(q1.code, q2.code);
    // sign-up stages follow the server
    assert.deepEqual((await v.go("/api/registration/flows?server=token.lab.test")).json.flows[0].stages, ["token", "username", "terms"]);
    assert.deepEqual((await v.go("/api/registration/flows?server=captcha.lab.test")).json.flows[0].stages, ["username", "captcha", "terms"]);
    const g = new Visitor(17);
    assert.match((await g.go("/register?server=token.lab.test")).text, /Murmur X is here[\s\S]*Continue anyway/);
    redirects(await g.go("/register/start?server=token.lab.test"), "/register/step");
    assert.match((await g.go("/register/step")).text, /Registration token/);
    assert.equal((await g.post("/register/step", { token: "nope" })).status, 400);
    redirects(await g.post("/register/step", { token: "lab-token-1" }), "/register/step");
    const name = `gil${Date.now().toString(36)}`;
    assert.match((await g.post("/register/step", { username: "alice", password: "Gil-pass-123", confirm: "Gil-pass-123" })).text, /That username is taken/);
    redirects(await g.post("/register/step", { username: name, password: "Gil-pass-123", confirm: "Gil-pass-123" }), "/register/step");
    assert.equal((await g.post("/register/step", {})).status, 400, "terms not accepted");
    redirects(await g.post("/register/step", { terms: "on" }), "/register/step");
    redirects(await g.go("/register/step"), "/verify");
    assert.equal((await g.me()).email, `${name}@token.lab.test`);
    // on lab.test the last stage is an emailed link, opened in another tab while this one waits
    const h = new Visitor(17);
    const hname = `hal${Date.now().toString(36)}`;
    redirects(await h.go("/register/start?server=lab.test"), "/register/step");
    redirects(await h.post("/register/step", { username: hname, password: "Hal-pass-123", confirm: "Hal-pass-123" }), "/register/step");
    redirects(await h.post("/register/step", { terms: "on" }), "/register/step");
    assert.match((await h.go("/register/step")).text, /Add your email/);
    const email = `${hname}@mail.test`;
    redirects(await h.post("/register/step", { email }), "/register/step");
    assert.match((await h.go("/register/step")).text, /Check your email/);
    assert.equal((await h.go("/register/status")).json.confirmed, false);
    redirects(await h.post("/register/continue", {}), "/register/step");
    const code = await lastCode("murmur", email);
    assert.equal((await new Visitor(17).go(`/register/confirm?code=${code}&email=${encodeURIComponent(email)}`)).status, 200);
    assert.equal((await new Visitor(17).go(`/register/confirm?code=${code}&email=${encodeURIComponent(email)}`)).status, 400, "a link works once");
    assert.equal((await h.go("/register/status")).json.confirmed, true);
    redirects(await h.post("/register/continue", {}), "/register/step");
    redirects(await h.go("/register/step"), "/verify");
    assert.equal((await h.me()).email, `${hname}@lab.test`);
    // a session ends by itself
    await sleep(3300);
    redirects(await h.go("/account"), "/login?expired=1");
    await h.me(401);
  },
};

const lab = await startLab({ base: BASE });
const stop = () => lab.stop();

let failed = 0;
for (const [name, check] of Object.entries(checks)) {
  try {
    await check();
    console.log(`ok    ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name}: ${e.message}`);
  }
}
const home = await fetch(`http://localhost:${BASE}/`).then((r) => r.text());
if (!home.includes(ALICE)) failed++, console.log("FAIL  dashboard: doesn't show Alice");
else console.log("ok    dashboard");
stop();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
