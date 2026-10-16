// A design tool whose sign-in and sign-up are web components: every field sits in an open shadow
// root (the skill's read walks those), the submit is a div with role "button", and "Keep me signed
// in" is a role "switch". The form posts JSON with fetch.

import { html } from "../lib/html.js";
import { localPath, passwordAuth } from "../lib/site.js";
import * as users from "../lib/users.js";

const SITE = "shadow";

export default {
  name: SITE,
  offset: 9,
  title: "Prism Studio",
  color: "#4338ca",
  tagline: "Design in every color of light.",
  tests: "Sign-in and sign-up are web components in open shadow roots; the submit is a div role=\"button\" and \"Keep me signed in\" a role=\"switch\"; the form posts JSON.",
  seed: () => users.seed(SITE),
  build(ctx) {
    const component = (mode) => (req, res) =>
      ctx.render(req, res, mode === "login" ? "Sign in" : "Create account", html`<prism-auth mode="${mode}" next="${localPath(req.query.next) ?? ""}"></prism-auth>
        <script src="/assets/prism.js"></script>`);
    passwordAuth(ctx, { pages: { login: component("login"), signup: component("signup") } });
  },
  account: () => html`<h2>Recent files</h2><table><tr><th>File</th><th>Edited</th></tr>
    <tr><td>Brand refresh.prism</td><td>2 hours ago</td></tr><tr><td>Landing page v3.prism</td><td>Yesterday</td></tr></table>`,
};
