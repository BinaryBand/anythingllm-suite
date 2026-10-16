// The stand-in user, run inside the eval's AnythingLLM container (instance.mts mounts it): opens a
// tab's page in the collector's Chrome and does there what a person would. It never sees the agent;
// what to enter comes from the harness, which reads the lab.
//
//   node actor.cjs <tab page path> '<steps as JSON>'
//
// Steps, in order, each an object with one key:
//   { "state": true }                         prints the page's state file as "STATE {json}"
//   { "answer": { "user", "pass", "code", "save" } }
//                                             opens what the page asks for and fills it: the
//                                             username (when asked) and the password, or the code
//   { "offer": "yes" | "no" }                 answers "Save this login/passkey?"
//   { "forget": "<site>" }                    deletes the saved login for a site, under Logins
//   { "needtake": true }                      takes the tab over from what the page asks for
//   { "tap": [fx, fy] }                       taps the picture at fractions of its size (the first tap
//                                             also takes the tab over)
//   { "field": "<ref>" | "empty" }            taps a field the page lists, or the first empty one
//   { "type": "<text>" }                      types into the field a tap opened, then Enter
//   { "give": true }                          hands the tab back
//   { "wait": seconds }
//   { "shot": "<name>" }                      saves a picture of the page in <storage>/eval-shots
const puppeteer = require("/app/collector/node_modules/puppeteer");

const [tab, stepsJson] = process.argv.slice(2);
const url = "http://127.0.0.1:3001" + tab.replace(/^https?:\/\/[^/]+/, "").replace(/\.html.*$/, "") + ".html";
const pause = (s) => new Promise((r) => setTimeout(r, s * 1000));

(async () => {
  const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  page.on("dialog", (d) => d.accept()); // "Delete the login for …?"
  const visible = (sel, s = 90) => page.waitForSelector(sel, { visible: true, timeout: s * 1000 });
  const state = () => page.evaluate(async (u) => (await fetch(u.replace(/\.html$/, ".json"), { cache: "no-cache" })).json(), url);
  /** Clicks the picture at page pixels (x, y) of the tab, wherever the picture is drawn. */
  const tapPage = async (st, x, y) => {
    const r = await page.$eval("#shot", (e) => e.getBoundingClientRect().toJSON());
    await page.mouse.click(r.x + (x / st.size.w) * r.width, r.y + (y / st.size.h) * r.height);
  };
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    for (const step of JSON.parse(stepsJson)) {
      const [verb, arg] = Object.entries(step)[0];
      if (verb === "state") console.log("STATE " + JSON.stringify(await state()));
      else if (verb === "answer") {
        // The page opens on the form while a request is live (an older page first showed a button).
        await page.waitForSelector("#needform .fld, #needenter", { visible: true, timeout: 90000 });
        if (await page.$("#needenter:not([hidden])")) await page.click("#needenter");
        await visible("#needform .fld");
        const fields = await page.$$("#needform .fld:not(.ro)");
        const values = fields.length === 2 ? [arg.user, arg.pass] : [arg.code ?? arg.pass];
        for (const [i, f] of fields.entries()) await f.type(String(values[i] ?? ""));
        if (arg.save === false && fields.length === 2) await page.click("#needform .sw");
        await page.click("#needform .btn.pri");
        await pause(1.5);
        console.log("answered");
      } else if (verb === "offer") {
        await visible("#offer", 20);
        console.log("offer: " + (await page.$eval("#offer", (e) => e.innerText.replace(/\s+/g, " "))));
        await page.click(arg === "yes" ? "#offeryes" : "#offerno");
        await pause(1.5);
      } else if (verb === "forget") {
        await page.click("#tk");
        await visible("#logins");
        await pause(1.5);
        const del = await page.$(`#logins button[aria-label="Delete the login for ${arg}"]`);
        if (!del) console.log("no saved login for " + arg);
        else {
          await del.click();
          await pause(1.5);
          console.log("forgot " + arg);
        }
      } else if (verb === "needtake") {
        await visible("#needtake", 20);
        await page.click("#needtake");
        await pause(2.5);
      } else if (verb === "tap") {
        await page.waitForFunction(() => document.getElementById("shot").naturalWidth > 0, { timeout: 30000 });
        const r = await page.$eval("#shot", (e) => e.getBoundingClientRect().toJSON());
        await page.mouse.click(r.x + arg[0] * r.width, r.y + arg[1] * r.height);
        await pause(2.5);
      } else if (verb === "field") {
        const st = await state();
        const f = arg === "empty" ? st.fields.find((g) => !g.filled && g.kind !== "password") : st.fields.find((g) => g.ref === arg);
        if (!f) throw new Error(`no field ${arg} among ${JSON.stringify(st.fields)}`);
        await tapPage(st, f.x + f.w / 2, f.y + f.h / 2);
        await pause(2);
      } else if (verb === "type") {
        await visible("input.over", 10);
        await page.type("input.over", String(arg));
        await page.keyboard.press("Enter");
        await pause(2.5);
      } else if (verb === "give") {
        await page.click("#give");
        await pause(1.5);
      } else if (verb === "wait") await pause(Number(arg));
      else if (verb === "shot") {
        await pause(1.5);
        require("fs").mkdirSync("/app/server/storage/eval-shots", { recursive: true });
        await page.screenshot({ path: `/app/server/storage/eval-shots/${String(arg).replace(/[^\w-]/g, "_")}.png` });
        console.log("shot " + arg);
      } else throw new Error("no such step: " + verb);
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error("actor: " + e.message);
  process.exit(1);
});
