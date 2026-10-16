// A single-page app: the page is drawn by script from a JSON API, and the sign-in is a bearer token
// in localStorage. The browser skill keeps cookies across Chrome restarts but not localStorage, and
// its call sends cookies, not this token: both show here.

import { byToken, issueToken, revokeToken } from "../lib/session.js";
import { icon } from "../lib/html.js";
import * as users from "../lib/users.js";

const SITE = "spa";
const tasksOf = (user) => JSON.parse(user.profile ?? "{}").tasks ?? [];
const publicUser = (u) => ({ id: u.id, site: SITE, email: u.email, name: u.name });

const SHELL = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Orbit Tasks</title>${icon("#7c3aed")}<link rel="stylesheet" href="/assets/lab.css"><style>:root{--brand:#7c3aed}</style></head>
<body><div class="labbar">Test lab site · not a real service</div>
<header class="top"><a class="brand" href="#/">Orbit Tasks</a><nav id="nav"></nav></header>
<main id="app"><p class="muted">Loading…</p></main>
<script src="/assets/spa.js"></script></body></html>`;

export default {
  name: SITE,
  offset: 3,
  title: "Orbit Tasks",
  color: "#7c3aed",
  tagline: "Tasks in orbit.",
  tests: "A page drawn by script from a JSON API, signed in with a bearer token in localStorage: refs on content the client draws; the sign-in is lost when Chrome restarts; call /api/me answers 401 (it sends cookies, not the token).",
  seed: () => users.seed(SITE, { profile: { tasks: [{ title: "Launch the newsletter", done: false }] } }),
  build({ app }) {
    const bearer = (req, res, next) => {
      const token = String(req.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
      const data = token && byToken(SITE, token);
      const user = data?.userId && users.byId(data.userId);
      if (!user) return res.status(401).json({ error: "not signed in" });
      req.user = user;
      req.token = token;
      next();
    };
    const signedIn = (res, user) => res.json({ token: issueToken(SITE, { userId: user.id }), user: publicUser(user) });

    app.get("/", (req, res) => res.type("html").send(SHELL));
    app.get(["/login", "/signup", "/account"], (req, res) => res.redirect(303, `/#${req.path}`));
    app.post("/api/login", (req, res) => {
      const user = users.check(SITE, req.body?.email, req.body?.password);
      if (!user) return res.status(401).json({ error: "That email and password don't match an account." });
      signedIn(res, user);
    });
    app.post("/api/signup", (req, res) => {
      const { name, email, password } = req.body ?? {};
      const problem = users.signupProblem(SITE, { email, pass: password });
      if (problem) return res.status(400).json({ error: problem });
      signedIn(res, users.create(SITE, { email, name, pass: password }));
    });
    app.get("/api/me", bearer, (req, res) => res.json(publicUser(req.user)));
    app.post("/api/logout", bearer, (req, res) => {
      revokeToken(req.token);
      res.json({ ok: true });
    });
    app.get("/api/tasks", bearer, (req, res) => res.json({ tasks: tasksOf(req.user) }));
    app.post("/api/tasks", bearer, (req, res) => {
      const title = String(req.body?.title ?? "").trim().slice(0, 200);
      if (!title) return res.status(400).json({ error: "A task needs a title." });
      const tasks = [...tasksOf(req.user), { title, done: false }];
      users.update(req.user.id, { profile: JSON.stringify({ tasks }) });
      res.json({ tasks });
    });
    app.post("/api/tasks/:i/toggle", bearer, (req, res) => {
      const tasks = tasksOf(req.user);
      const task = tasks[Number(req.params.i)];
      if (!task) return res.status(404).json({ error: "No such task." });
      task.done = !task.done;
      users.update(req.user.id, { profile: JSON.stringify({ tasks }) });
      res.json({ tasks });
    });
  },
};

