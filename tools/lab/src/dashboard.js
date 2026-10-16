// The lab's own page, on the base port: every site, its users, the outbox of email and SMS codes,
// and a reset. It's for the person running the tests, so it stays on localhost, off the tunnel.

import express from "express";
import otplib from "otplib";
import { wipe } from "./lib/db.js";
import { html, icon } from "./lib/html.js";
import * as outbox from "./lib/outbox.js";
import * as push from "./lib/push.js";
import * as users from "./lib/users.js";
import { SITES, portOf, publicUrlOf, seedAll } from "./sites/index.js";
import { RECOVERY_KEY, REGISTRATION_TOKEN } from "./sites/murmur.js";
import { ALICE_SECRET } from "./sites/totp.js";

const page = (body) => html`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Test lab</title>${icon("#1d2330")}<link rel="stylesheet" href="/assets/lab.css"><style>:root{--brand:#1d2330} main{max-width:1100px}</style></head>
<body><header class="top"><span class="brand">Browser skill test lab</span><nav><form method="post" action="/reset" onsubmit="return confirm('Delete every account, session, passkey and code, then seed Alice again?')"><button class="danger small" type="submit">Reset everything</button></form></nav></header>
<main>${body}</main></body></html>`.toString();

const outboxRows = (rows) =>
  rows.map((r) => html`<tr${r.used ? html` class="muted"` : ""}><td>${r.created}</td><td>${r.site}</td><td>${r.channel}</td><td>${r.recipient}</td><td>${r.purpose}</td><td><strong class="secret">${r.code}</strong>${r.used ? " (used)" : ""}</td></tr>`);

const phoneRows = (rows) =>
  rows.length
    ? rows.map((r) => html`<tr><td>${r.site}</td><td>${r.email}</td><td>${r.created}</td><td>
        <form class="inline" method="post" action="/api/push/approve"><input name="number" inputmode="numeric" maxlength="2" size="3" placeholder="##" aria-label="Number on the sign-in page" required> <button class="small" type="submit">Approve</button>
        <button class="ghost small" type="submit" formaction="/api/push/deny">Deny</button></form></td></tr>`)
    : html`<tr><td colspan="4" class="muted">No sign-in is waiting for approval.</td></tr>`;

export function dashboard() {
  const app = express();
  app.disable("x-powered-by");
  app.use("/assets", express.static(new URL("./assets", import.meta.url).pathname));
  app.use(express.urlencoded({ extended: false }), express.json());
  app.use((req, res, next) => (res.set("Cache-Control", "no-store"), next()));
  app.get("/favicon.ico", (req, res) => res.status(204).end());

  app.get("/", (req, res) => {
    const host = req.hostname || "localhost";
    res.type("html").send(page(html`
      <h1>Sites</h1>
      <p class="muted">Every site starts with <strong>${users.ALICE.email}</strong> / <code>${users.ALICE.pass}</code>.
        Alice's authenticator code on Vaultline Bank right now: <strong class="secret" id="totp">${otplib.authenticator.generate(ALICE_SECRET)}</strong> (secret <code>${ALICE_SECRET}</code>).
        Murmur Chat: recovery key <code>${RECOVERY_KEY}</code>, registration token <code>${REGISTRATION_TOKEN}</code>.</p>
      <table><tr><th>Site</th><th>Address</th><th>What it tests</th><th>Users</th></tr>
      ${SITES.map((s) => {
        const list = users.ofSite(s.name);
        const local = `http://${host}:${portOf(s)}`;
        return html`<tr><td><strong>${s.title}</strong><br><code>${s.name}</code></td>
          <td><a href="${local}">${local}</a>${publicUrlOf(s) ? html`<br><a href="${publicUrlOf(s)}">${publicUrlOf(s)}</a>` : ""}</td>
          <td>${s.tests}</td>
          <td><details><summary>${list.length}</summary>${list.map((u) => html`<div>${u.email}${u.phone ? html` · ${u.phone}` : ""}</div>`)}</details></td></tr>`;
      })}</table>
      <h2>Outbox</h2>
      <p class="muted">The codes the sites "sent" by email and SMS, newest first. This updates by itself.</p>
      <table><thead><tr><th>Sent (UTC)</th><th>Site</th><th>By</th><th>To</th><th>For</th><th>Code</th></tr></thead>
        <tbody id="outbox">${outboxRows(outbox.recent({ limit: 30 }))}</tbody></table>
      <h2>Phone</h2>
      <p class="muted">Sign-ins waiting for approval on Meridian Wallet. Type the number the page shows, as you would in the app.</p>
      <table><thead><tr><th>Site</th><th>Account</th><th>Asked (UTC)</th><th>Answer</th></tr></thead><tbody id="phone">${phoneRows(push.pending())}</tbody></table>
      <script>
        setInterval(async () => {
          const r = await fetch("/outbox.html");
          if (r.ok) document.getElementById("outbox").innerHTML = await r.text();
          const p = document.getElementById("phone");
          const typing = p.contains(document.activeElement) && document.activeElement.tagName === "INPUT";
          const ph = await fetch("/phone.html");
          if (ph.ok && !typing) p.innerHTML = await ph.text();
          const t = await fetch("/api/totp");
          if (t.ok) document.getElementById("totp").textContent = (await t.json()).code;
        }, 3000);
      </script>`));
  });
  app.get("/outbox.html", (req, res) => res.type("html").send(outboxRows(outbox.recent({ limit: 30 })).map(String).join("")));
  app.get("/phone.html", (req, res) => res.type("html").send(phoneRows(push.pending()).map(String).join("")));
  // The phone's answer: a form from the panel above (redirects back), or JSON from a test.
  const answerPush = (answer) => (req, res) => {
    const done = answer(req.body.number);
    if (req.is("application/x-www-form-urlencoded")) return res.redirect(303, "/");
    res.status(done ? 200 : 404).json({ ok: done });
  };
  app.post("/api/push/approve", answerPush(push.approve));
  app.post("/api/push/deny", answerPush(push.deny));
  app.get("/api/push", (req, res) => res.json(push.pending()));
  app.get("/api/outbox", (req, res) => res.json(outbox.recent({ site: req.query.site || null, recipient: req.query.to || null, limit: Number(req.query.limit) || 50 })));
  app.get("/api/totp", (req, res) => res.json({ code: otplib.authenticator.generate(ALICE_SECRET) }));
  app.get("/api/sites", (req, res) => res.json(SITES.map((s) => ({ name: s.name, title: s.title, port: portOf(s), public: publicUrlOf(s), tests: s.tests }))));
  app.post("/reset", (req, res) => {
    wipe();
    seedAll();
    res.redirect(303, "/");
  });
  return app;
}
