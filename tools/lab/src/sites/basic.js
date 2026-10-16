// The plainest site: a server-rendered email and password form, a cookie session, notes to keep.

import { field, html } from "../lib/html.js";
import { passwordAuth } from "../lib/site.js";
import * as users from "../lib/users.js";

const notesOf = (user) => JSON.parse(user.profile ?? "{}").notes ?? [];

export default {
  name: "basic",
  offset: 1,
  title: "Pinecrest Notes",
  color: "#2f6fde",
  tagline: "Notes that stay put.",
  tests: "A plain server-rendered form: login with user_ref, pass_ref and submit_ref; saving a login; the cookie session lasting; call /api/me and /api/notes.",
  seed: () => users.seed("basic", { profile: { notes: ["Buy pine cones", "Call the cabin about the booking"] } }),
  build(ctx) {
    passwordAuth(ctx);
    ctx.app.post("/notes", ctx.requireUser, (req, res) => {
      const text = String(req.body.note ?? "").trim().slice(0, 500);
      if (text) users.update(req.user.id, { profile: JSON.stringify({ notes: [...notesOf(req.user), text] }) });
      res.redirect(303, "/account");
    });
    ctx.app.get("/api/notes", ctx.requireUser, (req, res) => res.json({ notes: notesOf(req.user) }));
  },
  account: (req) => html`<h2>Your notes</h2>
    <ul class="notes">${notesOf(req.user).map((n) => html`<li>${n}</li>`)}</ul>
    <form method="post" action="/notes" class="card wide">
      ${field({ label: "New note", name: "note", placeholder: "Write something…", required: true })}
      <button type="submit">Add note</button>
    </form>`,
};
