// npm run check: drives the lab in a real Chrome (Puppeteer) and reads every page with the browser skill's own
// snapshot code (test/.snapshot.mjs, built from the skill's snapshot.ts), then finds elements by their refs the way
// the skill's `act` does. It starts a lab of its own (ports 4400+, a throwaway database). `info` lines are known
// problems in the skill, not failures; a FAIL means the lab or a page doesn't behave as described.

import otplib from "otplib";
import puppeteer from "puppeteer";
import { startLab } from "./lab.mjs";
import { readPage } from "./.snapshot.mjs";

const BASE = Number(process.env.CHECK_BASE_PORT || 4400);
const SECRET = "JBSWY3DPEHPK3PXP";
const lab = await startLab({ base: BASE, env: { LAB_SUDO_SECONDS: "30", LAB_PUSH_TTL: "60", LAB_MURMUR_SESSION_SECONDS: "180" } });
const U = (offset, path = "/") => `http://localhost:${lab.port(offset)}${path}`;
const dashboard = (path, init) => fetch(`http://localhost:${BASE}${path}`, init);

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 900 });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const watch = (p) => {
  p.on("pageerror", (e) => errors.push(`${p.url()}: ${e.message}`));
  p.on("console", (m) => m.type() === "error" && !/favicon|Failed to load resource/.test(m.text()) && errors.push(`${p.url()}: console ${m.text()}`));
};
watch(page);

const openTab = async () => {
  const tab = await browser.newPage();
  watch(tab);
  return tab;
};

let failed = 0;
const ok = (cond, msg) => {
  if (!cond) failed++;
  console.log(`${cond ? "ok  " : "FAIL"}  ${msg}`);
};
const info = (msg) => console.log(`info  ${msg}`);

async function read(label, p = page, { quiet = true } = {}) {
  const { snap, url } = await readPage(p);
  if (!quiet) console.log(`\n--- ${label}  ${url}\n${snap.elements.join("\n")}`);
  return snap;
}
const refsOf = (snap, re) => snap.elements.filter((l) => re.test(l)).map((l) => l.match(/^\[(e\d+)\]/)[1]);
const refOf = (snap, re) => snap.elements.find((l) => re.test(l))?.match(/^\[(e\d+)\]/)?.[1];
const has = (snap, re) => snap.elements.some((l) => re.test(l));
const byRef = (ref, p = page) => p.$(`pierce/[data-bw-ref="${ref}"]`); // as the skill's act finds an element (element() in act.ts)
const act = async (snap, re, p = page) => {
  const el = refOf(snap, re) && (await byRef(refOf(snap, re), p));
  if (!el) throw new Error(`nothing on the page matches ${re}`);
  return el;
};
const go = (url, p = page) => p.goto(url, { waitUntil: "networkidle0" });
const text = (p = page) => p.evaluate(() => document.body.innerText);
const signedIn = async (p = page) => /Signed in as/.test(await text(p));
const fresh = (w) => `${w}-${Date.now().toString(36)}@lab.test`;
const step = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name} threw: ${e.message}`);
  }
};
const signInOn = async (snap, email, pass, submitRe = /button "Sign in"/, p = page) => {
  await (await act(snap, /input\[(email|text)\]/, p)).type(email);
  await (await act(snap, /input\[password\]/, p)).type(pass);
  await Promise.all([p.waitForNavigation(), (await act(snap, submitRe, p)).click()]);
};

// Lumen ID's pages after the app sent the browser there: sign in, or pick Alice if this browser already has her; then Allow.
const throughLumen = async (p = page) => {
  const s = await read("idp", p);
  if (has(s, /input\[email\]/)) await signInOn(s, "alice@lab.test", "Alice-pass-1", /button "Sign in"/, p);
  else await Promise.all([p.waitForNavigation(), (await act(s, /Alice Example/, p)).click()]);
  await (await act(await read("idp consent", p), /button "Allow"/, p)).click();
};

await step("basic", async () => {
  await go(U(1, "/login"));
  await signInOn(await read("basic"), "alice@lab.test", "Alice-pass-1");
  ok(await signedIn(), "basic: signs in by refs");
});

await step("twostep", async () => {
  await go(U(2, "/login"));
  let s = await read("twostep");
  await (await act(s, /input\[email\]/)).type("alice@lab.test");
  await Promise.all([page.waitForNavigation(), (await act(s, /button "Next"/)).click()]);
  s = await read("twostep password");
  await (await act(s, /Show password/)).click();
  s = await read("twostep shown");
  ok(await page.$eval("#f-password", (e) => e.type === "text"), "twostep: Show password turns the field into a text field");
  ok(has(s, /input\[password\] "Enter your password"/), "twostep: the skill still reads it as a password field (so act won't type into it)");
});

await step("spa", async () => {
  await go(U(3, "/#/login"));
  await pause(900);
  const login = await read("spa");
  await (await act(login, /input\[email\]/)).type("alice@lab.test");
  await (await act(login, /input\[password\]/)).type("Alice-pass-1");
  await (await act(login, /button "Sign in"/)).click();
  await pause(1500);
  ok(await signedIn(), "spa: signs in, drawn by script");
  const s = await read("spa account");
  await (await act(s, /New task/)).type("From the browser check");
  await (await act(s, /button "Add task"/)).click();
  await pause(500);
  ok((await text()).includes("From the browser check"), "spa: adds a task");
});

await step("shadow", async () => {
  await go(U(9, "/login"));
  const s = await read("shadow");
  ok(!!refOf(s, /input\[password\]/), "shadow: the read finds the fields in shadow roots");
  ok(has(s, /switch "Keep me signed in"/) && has(s, /button "Sign in"/), "shadow: the read finds the role=switch and the div role=button");
  ok(!!(await byRef(refOf(s, /input\[email\]/))), "shadow: the skill's lookup (pierce/) finds an element inside a shadow root");
  await (await act(s, /input\[email\]/)).type("alice@lab.test");
  await (await act(s, /input\[password\]/)).type("Alice-pass-1");
  await (await act(s, /switch "Keep me signed in"/)).click();
  await Promise.all([page.waitForNavigation(), (await act(s, /button "Sign in"/)).click()]);
  ok(await signedIn(), "shadow: signs in by refs through the shadow roots");
});

await step("iframe", async () => {
  await go(U(8, "/login"));
  const s = await read("iframe");
  ok(!has(s, /input/), "iframe: the read sees no fields (they're in the frame)");
  const frame = page.frames().find((f) => f.url().includes("/frame/login"));
  await frame.type("input[name=email]", "alice@lab.test");
  await frame.type("input[name=password]", "Alice-pass-1");
  await Promise.all([page.waitForNavigation(), frame.click("button[type=submit]")]);
  ok(page.url().endsWith("/account") && (await signedIn()), "iframe: signing in inside the frame moves the whole page to /account");
});

await step("wizard", async () => {
  await go(U(10, "/signup"));
  let s = await read("wizard");
  const email = fresh("wiz");
  await (await act(s, /input\[email\]/)).type(email);
  await (await act(s, /input\[password\] "Password"/)).type("Wiz-pass-123");
  await (await act(s, /input\[password\] "Confirm password"/)).type("Wiz-pass-123");
  await Promise.all([page.waitForNavigation(), (await act(s, /button "Next"/)).click()]);
  s = await read("wizard profile");
  ok(has(s, /button "Next" \(disabled\)/), "wizard: Next starts disabled");
  await (await act(s, /Full name/)).type("Wiz Ard");
  await (await act(s, /^\[e\d+\] select/)).select("Japan");
  await (await act(s, /radio\] "A bit of both"/)).click();
  await page.$eval("#f-dob", (el) => {
    el.value = "1988-02-03";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await (await act(s, /checkbox\] "I agree/)).click();
  s = await read("wizard filled");
  ok(has(s, /button "Next"$/), "wizard: Next enables once the profile is valid");
  await Promise.all([page.waitForNavigation(), (await act(s, /button "Next"/)).click()]);
  const code = await lab.lastCode("wizard", email);
  s = await read("wizard verify");
  await (await act(s, /Verification code/)).type(code);
  await Promise.all([page.waitForNavigation(), (await act(s, /Create my account/)).click()]);
  ok(page.url().endsWith("/signup/done"), "wizard: the code finishes sign-up");
});

await step("passkey", async () => {
  const cdp = await page.createCDPSession();
  await cdp.send("WebAuthn.enable", { enableUI: false });
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  await go(U(6, "/signup"));
  const pk = fresh("pk");
  await page.type("#f-name", "Pat Key");
  await page.type("#f-email", pk);
  await page.type("#f-password", "Pat-pass-123");
  await page.type("#f-confirm", "Pat-pass-123");
  await Promise.all([page.waitForNavigation(), page.click("button[type=submit]")]);
  let s = await read("passkey account");
  await Promise.all([page.waitForNavigation(), (await act(s, /Add a passkey/)).click()]);
  ok((await text()).includes("Passkey added"), "passkey: adds a passkey");
  await go(U(6, "/logout"));
  await go(U(6, "/login"));
  s = await read("passkey login");
  await Promise.all([page.waitForNavigation(), (await act(s, /Sign in with a passkey/)).click()]);
  ok(page.url().endsWith("/account") && (await text()).includes(pk), "passkey: signs in with the passkey alone");
});

await step("federated popup", async () => {
  await go(U(12, "/login"));
  let s = await read("federated");
  ok(has(s, /button "Continue with Lumen ID"/), "federated: popup mode offers a Continue with Lumen ID button");
  const opened = new Promise((resolve) => browser.once("targetcreated", async (t) => resolve(await t.page())));
  await (await act(s, /button "Continue with Lumen ID"/)).click();
  const popup = await opened;
  watch(popup);
  await popup.waitForSelector("input[type=email]");
  ok(new URL(popup.url()).port === String(lab.port(11)), "federated: the popup is the provider, on another origin");
  s = await read("idp login", popup);
  await signInOn(s, "alice@lab.test", "Alice-pass-1", /button "Sign in"/, popup);
  s = await read("idp consent", popup);
  ok(has(s, /button "Allow"/) && has(s, /button "Cancel"/), "federated: the provider asks for consent (Allow / Cancel)");
  await (await act(s, /button "Allow"/, popup)).click();
  await page.waitForFunction(() => location.pathname === "/account", { timeout: 10000 });
  ok(await signedIn(), "federated: the opener is signed in after the popup finishes");
  await pause(300);
  ok(popup.isClosed(), "federated: the popup closed itself");
});

await step("federated redirect", async () => {
  await go(U(12, "/logout"));
  await go(U(12, "/login?social=redirect"));
  let s = await read("federated redirect");
  ok(has(s, /link "Continue with Lumen ID"/), "federated: redirect mode offers a link");
  await Promise.all([page.waitForNavigation(), (await act(s, /link "Continue with Lumen ID"/)).click()]);
  s = await read("idp chooser");
  ok(new URL(page.url()).port === String(lab.port(11)) && has(s, /Alice Example/) && has(s, /Use another account/), "federated: the provider shows Choose an account (Alice, Use another account)");
  await Promise.all([page.waitForNavigation(), (await act(s, /Alice Example/)).click()]);
  s = await read("idp consent again");
  await Promise.all([page.waitForNavigation(), (await act(s, /button "Allow"/)).click()]);
  await page.waitForFunction(() => location.pathname === "/account", { timeout: 10000 });
  ok(new URL(page.url()).port === String(lab.port(12)) && (await signedIn()), "federated: the redirect lands back signed in");
});

await step("push", async () => {
  await go(U(13, "/login"));
  await signInOn(await read("push"), "alice@lab.test", "Alice-pass-1");
  const s = await read("push approve");
  const number = await page.$eval("#push-number", (e) => e.textContent.trim());
  ok(/^\d\d$/.test(number) && s.text.includes(number), `push: the page shows a number (${number}) that the read can see`);
  const wrong = await dashboard("/api/push/approve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ number: number === "10" ? "11" : "10" }) });
  ok(wrong.status === 404, "push: a wrong number approves nothing");
  await pause(1500);
  ok(page.url().includes("/login/approve"), "push: still waiting");
  await dashboard("/api/push/approve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ number }) });
  await page.waitForFunction(() => location.pathname === "/account", { timeout: 8000 });
  ok(await signedIn(), "push: approving the number signs the page in by itself");
});

await step("stepup", async () => {
  await go(U(14, "/login"));
  await signInOn(await read("stepup"), "alice@lab.test", "Alice-pass-1");
  let s = await read("stepup code");
  await (await act(s, /Authentication code/)).type(otplib.authenticator.generate(SECRET));
  await (await act(s, /checkbox\] "Trust this browser/)).click();
  await Promise.all([page.waitForNavigation(), (await act(s, /button "Verify"/)).click()]);
  ok(await signedIn(), "stepup: password then code signs in");
  s = await read("stepup account");
  await Promise.all([page.waitForNavigation(), (await act(s, /link "Create API key"/)).click()]);
  s = await read("stepup sudo");
  ok(page.url().includes("/sudo") && has(s, /input\[password\]/), "stepup: creating a key asks to confirm first");
  await (await act(s, /input\[password\]/)).type("Alice-pass-1");
  await Promise.all([page.waitForNavigation(), (await act(s, /button "Confirm"/)).click()]);
  ok(page.url().endsWith("/account/keys/new"), "stepup: confirming goes on to the page asked for");
  s = await read("stepup new key");
  await (await act(s, /Key name/)).type("from the check");
  await Promise.all([page.waitForNavigation(), (await act(s, /button "Create key"/)).click()]);
  ok(/lab_sk_/.test(await text()), "stepup: the key is created");
  await go(U(14, "/account/email"));
  ok(page.url().endsWith("/account/email"), "stepup: no second prompt inside the window");
  await go(U(14, "/logout"));
  await go(U(14, "/login"));
  await signInOn(await read("stepup again"), "alice@lab.test", "Alice-pass-1");
  ok(await signedIn(), "stepup: a trusted browser skips the code");
});

await step("consent", async () => {
  const clear = async () => page.deleteCookie(...(await page.cookies()).filter((c) => c.name === "acorn_consent"));
  await go(U(15, "/login"));
  let s = await read("consent");
  ok(has(s, /button "Accept all"/) && has(s, /button "Reject all"/) && has(s, /button "Manage preferences"/), "consent: the read shows Accept all, Reject all and Manage preferences");
  const email = await act(s, /input\[email\]/);
  await email.type("alice@lab.test").catch(() => {});
  ok((await email.evaluate((e) => e.value)) === "", "consent: the form behind the dialog takes no typing");
  ok(has(s, /button "Log in" \(disabled\)/), "consent: Log in starts disabled");
  await (await act(s, /button "Manage preferences"/)).click();
  s = await read("consent manage");
  ok(has(s, /Analytics/) && has(s, /button "Save choices"/), "consent: Manage preferences shows the toggles and Save choices");
  await (await act(s, /button "Reject all"/)).click();
  ok((await page.$("#cookie-dialog")) === null, "consent: Reject all closes the dialog");
  s = await read("consent after");
  await (await act(s, /input\[email\]/)).type("alice@lab.test");
  await (await act(s, /input\[password\]/)).type("Alice-pass-1");
  s = await read("consent filled");
  ok(has(s, /button "Log in"$/), "consent: Log in enables once both fields are filled");
  await Promise.all([page.waitForNavigation(), (await act(s, /button "Log in"/)).click()]);
  ok(await signedIn(), "consent: signs in");
  await go(U(15, "/logout"));
  await clear();
  await go(U(15, "/login?banner=bottom"));
  s = await read("consent bottom");
  const bottomEmail = await act(s, /input\[email\]/);
  await bottomEmail.type("a@b.test");
  ok(has(s, /button "Accept all"/) && (await bottomEmail.evaluate((e) => e.value)) === "a@b.test", "consent: the bottom bar leaves the form usable");
  await clear();
  await go(U(15, "/login?banner=late"));
  ok(await page.$eval("#cookie-dialog", (e) => e.hidden), "consent: the late dialog isn't there at first");
  await pause(2600);
  ok(!(await page.$eval("#cookie-dialog", (e) => e.hidden)) && (await page.$eval("main", (e) => e.inert)), "consent: it opens after about two seconds and blocks the page");
});

await step("gate", async () => {
  const response = await go(U(16, "/blocked/login"));
  ok(response.status() === 403 && !has(await read("blocked"), /input/), "gate: /blocked/login is a 403 with no form");
  await go(U(16, "/interstitial/login"));
  let s = await read("interstitial");
  ok(has(s, /button "Continue"/) && !has(s, /input/), "gate: the interstitial has only a Continue button");
  await Promise.all([page.waitForNavigation(), (await act(s, /button "Continue"/)).click()]);
  ok(page.url().endsWith("/login"), "gate: Continue goes on to the sign-in page");
  s = await read("gate");
  ok(has(s, /button "Sign in" \(disabled\)/), "gate: Sign in is disabled until the check passes");
  await page.waitForSelector("#gate-box:not([hidden])", { timeout: 5000 });
  s = await read("gate check");
  ok(has(s, /checkbox\] "Verify you are human"/), "gate: headless Chrome gets the checkbox (it looks automated)");
  await (await act(s, /checkbox\] "Verify you are human"/)).click();
  await page.waitForFunction(() => /Success/.test(document.getElementById("gate-status").textContent), { timeout: 8000 });
  s = await read("gate passed");
  await signInOn(s, "alice@lab.test", "Alice-pass-1");
  ok(await signedIn(), "gate: signs in after the check");
});

await step("federated fragment and auto", async () => {
  await go(U(12, "/logout"));
  await go(U(12, "/login?social=fragment"));
  let s = await read("federated fragment");
  await Promise.all([page.waitForNavigation(), (await act(s, /link "Continue with Lumen ID"/)).click()]);
  await throughLumen();
  await page.waitForFunction(() => location.pathname === "/account", { timeout: 10000 });
  ok(new URL(page.url()).port === String(lab.port(12)) && (await signedIn()), "federated: the answer after a # is picked up by the page's script and signs in");
  await go(U(12, "/logout"));
  await go(U(12, "/login?social=auto"));
  ok(new URL(page.url()).port === String(lab.port(11)), "federated: ?social=auto lands on the provider with no form drawn first");
});

await step("stepup device in a new tab", async () => {
  await go(U(14, "/account/devices"));
  let s = await read("stepup devices");
  const removes = refsOf(s, /button "Remove"/);
  ok(removes.length === 3, "stepup: the devices page lists three devices");
  await Promise.all([page.waitForNavigation(), (await byRef(removes[1])).click()]);
  s = await read("stepup wait");
  ok(has(s, /link "Open the confirmation page"/), "stepup: removing a device asks to confirm in a new tab");
  const href = await page.$eval("#open-confirm", (a) => a.href);
  const tab = await openTab();
  await go(href, tab);
  const t = await read("stepup confirm tab", tab);
  await (await act(t, /input\[password\]/, tab)).type("Alice-pass-1");
  await Promise.all([tab.waitForNavigation(), (await act(t, /button "Confirm"/, tab)).click()]);
  ok(/Confirmed/.test(await text(tab)), "stepup: the other tab confirms");
  await tab.close();
  await page.waitForFunction(() => location.pathname === "/account/devices" && /Removed/.test(document.body.innerText), { timeout: 8000 });
  ok(!(await text()).includes("Firefox on macOS"), "stepup: the first tab carries on by itself and the device is gone");
});

await step("murmur", async () => {
  await go(U(17, "/login"));
  let s = await read("murmur");
  ok(has(s, /button "Edit"/) && (await text()).includes("hosted by lab.test"), "murmur: the page names the homeserver, with an Edit button");
  await (await act(s, /button "Edit"/)).click();
  s = await read("murmur picker");
  const server = await act(s, /Homeserver/);
  await server.evaluate((e) => (e.value = ""));
  await server.type("nope.test");
  await (await act(s, /button "Continue"/)).click();
  await page.waitForFunction(() => /Can't find a homeserver/.test(document.getElementById("picker-msg").textContent), { timeout: 5000 });
  ok(true, "murmur: an unknown homeserver gives an inline error");
  await server.evaluate((e) => (e.value = ""));
  await server.type("sso.lab.test");
  await (await act(await read("murmur picker again"), /button "Continue"/)).click();
  await page.waitForFunction((p) => location.port === p, { timeout: 8000 }, String(lab.port(11)));
  ok(true, "murmur: a single-sign-on server sends the page straight to the provider");
  await throughLumen();
  await page.waitForFunction(() => location.pathname === "/verify", { timeout: 10000 });
  s = await read("murmur verify");
  ok(has(s, /Use another device/) && has(s, /Enter recovery key/) && has(s, /Can't confirm\?/) && has(s, /button "Skip for now"/), "murmur: Verify this session offers another device, a recovery key, a reset and Skip");
  await Promise.all([page.waitForNavigation(), (await act(s, /button "Skip for now"/)).click()]);
  ok(/not verified \(skipped\)/.test(await text()), "murmur: Skip for now gets into the account, unverified");
  await go(U(17, "/logout"));

  // a strict server: no Skip, and the recovery key unlocks it
  await go(U(17, "/login?server=token.lab.test"));
  s = await read("murmur token server");
  await (await act(s, /input\[text\] "Username"/)).type("alice");
  await (await act(s, /input\[password\]/)).type("Alice-pass-1");
  await Promise.all([page.waitForNavigation(), (await act(s, /button "Sign in"/)).click()]);
  s = await read("murmur strict verify");
  ok(page.url().endsWith("/verify") && !has(s, /Skip for now/), "murmur: token.lab.test gives no way to skip");
  await Promise.all([page.waitForNavigation(), (await act(s, /link "Enter recovery key"/)).click()]);
  s = await read("murmur key");
  await (await act(s, /Recovery key/)).type("EsTc Lab1 Verf Y123");
  await Promise.all([page.waitForNavigation(), (await act(s, /button "Continue"/)).click()]);
  ok(/This session is verified/.test(await text()), "murmur: the recovery key verifies the session");
  await go(U(17, "/logout"));

  // three wrong passwords lock the form, with a countdown
  await go(U(17, "/login"));
  for (let i = 0; i < 3; i++) {
    s = await read("murmur wrong");
    await (await act(s, /input\[text\] "Username"/)).type("alice");
    await (await act(s, /input\[password\]/)).type("wrong-pass");
    await Promise.all([page.waitForNavigation(), (await act(s, /button "Sign in"/)).click()]);
  }
  s = await read("murmur locked");
  ok(has(s, /button "Sign in" \(disabled\)/) && /Try again in \d+ seconds/.test(await text()), "murmur: three wrong passwords disable Sign in, with a countdown");
  await page.waitForFunction(() => !document.querySelector("form button[type=submit]").disabled, { timeout: 14000 });
  ok(true, "murmur: the form comes back when the countdown ends");

  // QR login changes
  await go(U(17, "/login/qr"));
  await pause(500);
  const first = await page.$eval("#qr", (i) => i.src);
  await pause(1600);
  ok(first.startsWith("data:image/png") && first !== (await page.$eval("#qr", (i) => i.src)), "murmur: the QR code changes every few seconds");

  // sign-up: the notice, the stages, and the emailed link opened in another tab
  await go(U(17, "/register"));
  s = await read("murmur notice");
  ok(has(s, /link "Continue anyway"/) && has(s, /link "Get the new app"/), "murmur: sign-up starts with a 'new app' notice and Continue anyway");
  await Promise.all([page.waitForNavigation(), (await act(s, /link "Continue anyway"/)).click()]);
  s = await read("murmur stage 1");
  const user = `viv${Date.now().toString(36)}`;
  await (await act(s, /input\[text\] "Username"/)).type(user);
  await (await act(s, /input\[password\] "Password"/)).type("Viv-pass-123");
  await (await act(s, /input\[password\] "Confirm password"/)).type("Viv-pass-123");
  await Promise.all([page.waitForNavigation(), (await act(s, /button "Continue"/)).click()]);
  s = await read("murmur terms");
  await (await act(s, /checkbox\] "I accept/)).click();
  await Promise.all([page.waitForNavigation(), (await act(s, /button "Continue"/)).click()]);
  s = await read("murmur email");
  const email = `${user}@mail.test`;
  await (await act(s, /input\[email\]/)).type(email);
  await Promise.all([page.waitForNavigation(), (await act(s, /button "Send a link"/)).click()]);
  ok(/Waiting for you to open the link/.test(await text()), "murmur: the sign-up waits for an emailed link");
  const code = await lab.lastCode("murmur", email);
  const tab = await openTab();
  await go(U(17, `/register/confirm?code=${code}&email=${encodeURIComponent(email)}`), tab);
  ok(/Email confirmed/.test(await text(tab)), "murmur: the link, opened in another tab, confirms the email");
  await tab.close();
  await page.waitForFunction(() => location.pathname === "/verify", { timeout: 8000 });
  ok(true, "murmur: the first tab carries on by itself, to Verify this session");
});

console.log(errors.length ? `\npage errors:\n${errors.join("\n")}` : "\nno page errors");
await browser.close();
lab.stop();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
