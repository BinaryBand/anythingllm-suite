// A bank behind the three kinds of bot gate the live walk met. /login: a Turnstile-style check that passes
// by itself after a moment, or asks for a click when the browser looks automated (headless, webdriver, or
// /login?gate=hard). /interstitial/login: a "Continue" page first, as Amazon showed. /blocked/login: a hard
// block with no form, as PayPal, Reddit and X showed.

import { error, html } from "../lib/html.js";
import { byToken, issueToken, revokeToken, updateToken } from "../lib/session.js";
import { passwordAuth } from "../lib/site.js";
import * as users from "../lib/users.js";
import { OFFSETS } from "../lib/ports.js";

const SITE = "gate";
const TOKEN_MS = 120_000;
const minMs = () => Math.max(0, Number(process.env.LAB_GATE_MIN_MS ?? 1000));

export default {
  name: SITE,
  offset: OFFSETS.gate,
  title: "Fortress Bank",
  color: "#334155",
  tagline: "Security you can feel.",
  tests: "Three bot gates: /login has a \"Verifying you are human…\" check that passes by itself or asks for a click when the browser looks automated (headless Chrome does; /login?gate=hard forces it); /interstitial/login asks to Continue first; /blocked/login is a hard block page with no form.",
  seed: () => users.seed(SITE),
  build(ctx) {
    const { app, render } = ctx;

    app.use("/blocked", (req, res) =>
      render(req, res, "Blocked", html`<div class="card center"><h1>You've been blocked by network security.</h1>
        <p>If you think you've been blocked by mistake, file a ticket below and we'll look into it.</p><p><a class="button ghost" href="/blocked/ticket">File a ticket</a></p></div>`, { status: 403, bare: true }));

    app.get("/interstitial/login", (req, res) => {
      if (req.session.data.gatePassed) return res.redirect(303, "/login");
      render(req, res, "Continue", html`<form class="card center" method="post" action="/interstitial/continue"><p>Click the button below to continue to Fortress Bank.</p><button type="submit">Continue</button></form>`, { bare: true });
    });
    app.post("/interstitial/continue", (req, res) => {
      req.session.save({ gatePassed: true });
      res.redirect(303, "/login");
    });

    app.post("/gate/challenge", (req, res) => {
      const automated = /HeadlessChrome/i.test(req.get("user-agent") ?? "") || req.body?.webdriver === true || req.body?.hard === true;
      const id = issueToken(SITE, { kind: "gate", issued: Date.now(), needsClick: automated, solved: false });
      res.json({ id, needsClick: automated, minMs: minMs() });
    });
    app.post("/gate/solve", (req, res) => {
      const row = byToken(SITE, req.body?.id);
      if (!row || row.kind !== "gate") return res.status(400).json({ error: "Unknown check. Reload and try again." });
      if (row.needsClick && !req.body.clicked) return res.status(400).json({ error: "This check needs a click." });
      if (Date.now() - row.issued < minMs()) return res.status(429).json({ error: "Too fast." });
      updateToken(SITE, req.body.id, { ...row, solved: true });
      res.json({ token: req.body.id });
    });

    const widget = (req) => html`<div class="gate" id="gate" role="group" aria-label="Human check" data-hard="${req.query.gate === "hard"}">
        <span id="gate-status">Verifying you are human…</span>
        <label class="check" id="gate-box" hidden><input type="checkbox" id="gate-check"> Verify you are human</label>
      </div><input type="hidden" name="gate_token" id="gate-token"><script src="/assets/gate.js" defer></script>`;
    passwordAuth(ctx, {
      extra: widget,
      check(req) {
        const token = String(req.body?.gate_token ?? "");
        const row = token && byToken(SITE, token);
        if (token) revokeToken(token); // one use, right or wrong
        return row?.solved && Date.now() - row.issued < TOKEN_MS ? null : "Complete the human check first.";
      },
    });
  },
  account: () => html`<h2>Accounts</h2><table><tr><th>Account</th><th>Balance</th></tr><tr><td>Checking •••• 7710</td><td>$940.00</td></tr></table>`,
};
