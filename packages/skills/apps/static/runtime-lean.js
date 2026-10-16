// runtime-lean.js: apps-lean's stand-in for a pages server, inlined in every page just before
// app.js, which the page uses unchanged. app.js saves with `post(app.append, ...)` and keeps up
// with `post(app.sync, ...)`; apps-lean gives it the addresses lean:append and lean:sync, and
// answers both here:
//   lean:append  the change goes to AnythingLLM as an apps-lean-event document (through the
//                browser extension's upload, which only stores it), with the app's secret, and is
//                confirmed as the next line. The skill applies it as it lands.
//   lean:sync    the page reads its state file (<token>.json beside it, which the skill writes
//                after every change) every 2 s while it's in view, and at once after it posts:
//                a newer line is the data, under this page's changes the app hasn't recorded yet.
//                A page whose parts changed reloads, unless the user is typing; an app that was
//                deleted says so.
// A change sent but not recorded stays applied over newer data, in this browser's storage, until
// the app lists its id (patched with App.apply, the page's one patch engine). App.log gives the
// newest changes the page was written with.
var AppsLean = (() => {
  const cfg = JSON.parse(document.getElementById("apps-lean").textContent);
  const KEY = "apps-lean:" + cfg.workspace + "/" + cfg.app;
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
  const keep = () => { try { localStorage.setItem(KEY, JSON.stringify({ pending })); } catch (e) {} };
  let pending = (load().pending || []).filter((e) => !cfg.seen.includes(e.id));
  let line = cfg.line, served = cfg.line, posted = 0;
  const stateUrl = location.pathname.replace(/\.html$/, ".json");
  function over(data) {
    // `data` with the changes the app hasn't recorded on top; one that no longer applies goes.
    const kept = [];
    for (const e of pending) {
      try { data = App.apply(data, e.patch); kept.push(e); } catch (err) {}
    }
    pending = kept;
    keep();
    return data;
  }
  const answer = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const uuid = () => (self.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(16).slice(2));
  const native = window.fetch.bind(window);

  async function append(body) {
    const id = uuid();
    const event = { apps_lean_event: 1, workspace: cfg.workspace, app: cfg.app, secret: cfg.secret, id, ev: body.ev || "change", fields: body.fields, patch: body.patch, t: new Date().toISOString() };
    // Relative: the page is served by AnythingLLM itself, at whatever address the user reached it.
    const r = await native("/api/browser-extension/upload-content", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.key },
      body: JSON.stringify({ textContent: JSON.stringify(event), metadata: { title: cfg.eventTitle, docSource: "apps-lean page" } }),
    });
    if (r.status === 403) return answer(403, { error: "AnythingLLM refused this page's key; ask the agent for the page again." });
    if (!r.ok) return answer(r.status >= 500 ? 503 : r.status, { error: "AnythingLLM answered " + r.status + "." });
    pending.push({ id, patch: body.patch });
    keep();
    posted = Date.now();
    line = Math.max(line, body.base) + 1;
    return answer(200, { line, lines: [{ n: line, patch: body.patch }] });
  }

  // Every 2 s while the page is in view, soon after this page posted, and at once when it comes
  // back into view.
  const pause = () => new Promise((go) => {
    const ms = Date.now() - posted < 2000 ? 250 : 2000;
    const done = () => (clearTimeout(t), document.removeEventListener("visibilitychange", wake), go());
    const wake = () => { if (!document.hidden) done(); };
    const t = setTimeout(done, ms);
    document.addEventListener("visibilitychange", wake);
  });
  /** A bar along the bottom saying what the user should know, with an optional button. */
  let barred = false;
  function bar(text, label, act) {
    if (barred) return;
    barred = true;
    const el = document.createElement("div");
    el.id = "apps-lean-bar";
    el.setAttribute("role", "status");
    el.style.cssText = "position:fixed;left:12px;right:12px;bottom:12px;z-index:9;display:flex;gap:12px;align-items:center;justify-content:space-between;padding:10px 14px;border-radius:12px;background:var(--ink,#222);color:var(--panel,#fff);font:15px/1.4 system-ui,sans-serif";
    el.textContent = text;
    if (label) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.style.cssText = "min-height:44px;padding:0 14px;border-radius:10px;border:0;font:inherit;font-weight:600";
      b.addEventListener("click", act);
      el.append(b);
    }
    document.body.append(el);
  }
  const typing = () => { const a = document.activeElement; return !!a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || !!(a && a.isContentEditable); };
  let gone = false;
  async function sync(body) {
    // App.log asks without waiting: the newest changes, as the page was written with them.
    if (body.wait === false) return answer(200, { line, lines: (cfg.log || []).filter((l) => l.n > (body.since || 0)) });
    if (gone) return new Promise(() => {}); // nothing more will come
    await pause();
    if (!/^https?:$/.test(location.protocol)) return answer(200, { line: body.since, lines: [] });
    try {
      const next = await (await native(stateUrl, { cache: "no-store" })).json();
      if (next && next.gone) {
        gone = true;
        bar("This app was deleted.");
        return new Promise(() => {});
      }
      if (next && next.version && cfg.version && next.version !== cfg.version) {
        // The page itself changed: a reload gets it. This page's unrecorded changes are kept in
        // the browser's storage, so they come back over it.
        if (!typing()) location.reload();
        else bar("This app's page changed.", "Reload", () => location.reload());
      }
      if (!next || typeof next.line !== "number" || next.line === served) return answer(200, { line: body.since, lines: [] });
      served = next.line;
      pending = pending.filter((e) => !next.seen.includes(e.id));
      line = Math.max(line, next.line);
      return answer(200, { data: over(next.data), line });
    } catch (e) {
      return answer(503, { error: "Can't reach AnythingLLM." });
    }
  }

  window.fetch = (url, opts) => {
    if (url === "lean:append") return append(JSON.parse(opts.body));
    if (url === "lean:sync") return sync(JSON.parse(opts.body));
    return native(url, opts);
  };
  return {
    /** The app as app.js's App.start takes it. */
    app: () => ({ title: cfg.title, card: cfg.card, data: over(cfg.data), line, token: "", append: "lean:append", sync: "lean:sync" }),
  };
})();
