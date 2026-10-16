// A forum with a "type the digits" check on sign-in and sign-up. The digits are drawn as scattered
// squares in an image, not text, so the agent can't read them: the user takes the tab over, types
// them, and hands it back.

import crypto from "node:crypto";
import { html } from "../lib/html.js";
import { passwordAuth } from "../lib/site.js";
import * as users from "../lib/users.js";

const SITE = "captcha";
const LENGTH = 5;

// 5×7 dot-matrix digits, a row per string.
const FONT = {
  0: ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  1: ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  2: ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  3: ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  4: ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  5: ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  6: ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  7: ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  8: ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  9: ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
};

const rand = (min, max) => min + (crypto.randomInt(0, 10_000) / 10_000) * (max - min);
const pick = (list) => list[crypto.randomInt(0, list.length)];
const SHADES = ["#1d2330", "#3b4252", "#5b21b6", "#9a3412", "#065f46"];

/** An SVG of `code`: each lit dot a jittered square, each digit turned a little, over light noise
 *  a person reads past. */
function picture(code) {
  const W = 240;
  const H = 80;
  const parts = [];
  for (let i = 0; i < 8; i++) parts.push(`<line x1="${rand(0, W).toFixed(1)}" y1="${rand(0, H).toFixed(1)}" x2="${rand(0, W).toFixed(1)}" y2="${rand(0, H).toFixed(1)}" stroke="#c3c9d4" stroke-width="${rand(0.6, 1.2).toFixed(1)}"/>`);
  for (let i = 0; i < 60; i++) parts.push(`<rect x="${rand(0, W).toFixed(1)}" y="${rand(0, H).toFixed(1)}" width="2" height="2" fill="#c3c9d4"/>`);
  [...code].forEach((digit, n) => {
    const x0 = 16 + n * 44 + rand(-3, 3);
    const y0 = 12 + rand(-4, 4);
    const dots = [];
    FONT[digit].forEach((row, y) => [...row].forEach((on, x) => {
      if (on === "1") dots.push(`<rect x="${(x * 6 + rand(-0.6, 0.6)).toFixed(1)}" y="${(y * 8 + rand(-0.6, 0.6)).toFixed(1)}" width="${rand(4.6, 5.8).toFixed(1)}" height="${rand(6, 7.4).toFixed(1)}"/>`);
    }));
    parts.push(`<g fill="${pick(SHADES)}" transform="translate(${x0.toFixed(1)} ${y0.toFixed(1)}) rotate(${rand(-12, 12).toFixed(1)} 15 28) skewX(${rand(-10, 10).toFixed(1)})">${dots.join("")}</g>`);
  });
  for (let i = 0; i < 2; i++) parts.push(`<path d="M0 ${rand(15, 65).toFixed(1)} Q ${W / 2} ${rand(-10, 90).toFixed(1)} ${W} ${rand(15, 65).toFixed(1)}" stroke="#8b93a1" stroke-width="1.2" fill="none"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#f8fafc"/>${parts.join("")}</svg>`;
}

const challenge = html`<div class="field">
    <span class="label">Prove you're human</span>
    <div class="captcha"><img id="captcha-img" src="/captcha.svg" width="240" height="80" alt="Security check image">
      <button type="button" class="ghost small" onclick="document.getElementById('captcha-img').src='/captcha.svg?'+Date.now()">New image</button></div>
    <label for="f-captcha">Type the digits shown in the image</label>
    <input id="f-captcha" name="captcha" inputmode="numeric" autocomplete="off" required>
  </div>`;

export default {
  name: SITE,
  offset: 7,
  title: "Gatekeeper Forum",
  color: "#4d7c0f",
  tagline: "A forum with a bouncer at the door.",
  tests: "Sign-in and sign-up ask for digits drawn in an image (not in the page's text): the agent should hand the tab to the user, who types them and hands it back.",
  seed: () => users.seed(SITE),
  build(ctx) {
    passwordAuth(ctx, {
      extra: () => challenge,
      check(req) {
        const want = req.session.data.captcha;
        req.session.save({ captcha: null });
        return want && String(req.body.captcha ?? "").replace(/\s/g, "") === want ? null : "The digits didn't match the image. Try the new one.";
      },
    });
    ctx.app.get("/captcha.svg", (req, res) => {
      // LAB_FIXED_CAPTCHA is for the smoke test only.
      const code = process.env.LAB_FIXED_CAPTCHA || Array.from({ length: LENGTH }, () => crypto.randomInt(0, 10)).join("");
      req.session.save({ captcha: code });
      res.type("image/svg+xml").set("Cache-Control", "no-store").send(picture(code));
    });
  },
  account: () => html`<h2>Latest threads</h2><table><tr><th>Thread</th><th>Replies</th></tr>
    <tr><td>Introduce yourself!</td><td>412</td></tr><tr><td>Best hiking boots under $150?</td><td>38</td></tr></table>`,
};
