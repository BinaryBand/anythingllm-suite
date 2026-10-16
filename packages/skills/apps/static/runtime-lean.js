// runtime-lean.js: apps-lean's stand-in for a pages server, inlined in
// every page just before app.js, which the page uses unchanged. app.js saves
// with `post(app.append, ...)` and keeps up with `post(app.sync, ...)`; apps-lean gives it
// the addresses lean:append and lean:sync, and answers both here:
//   lean:append  the change goes to AnythingLLM as an apps-lean-event document (through the
//                browser extension's upload, which only stores it), and is confirmed as the
//                next line. It reaches the app the next time the skill runs.
//   lean:sync    the page asks for itself again, which the skill writes after every change;
//                when it holds a newer app, that is the data, under this page's changes the
//                app hasn't recorded yet.
// A change sent but not recorded stays applied over newer data, in this browser's storage,
// until the app lists its id (patched with App.apply, the page's one patch engine). App.log
// gives the newest changes the page was written with.
var AppsLean = (() => {
  const cfg = JSON.parse(document.getElementById("apps-lean").textContent);
  const KEY = "apps-lean:" + cfg.workspace + "/" + cfg.app;
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
  const keep = () => { try { localStorage.setItem(KEY, JSON.stringify({ pending })); } catch (e) {} };
  let pending = (load().pending || []).filter((e) => !cfg.seen.includes(e.id));
  let stamp = cfg.stamp, line = cfg.line;
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
    line = Math.max(line, body.base) + 1;
    return answer(200, { line, lines: [{ n: line, patch: body.patch }] });
  }

  const pause = () => new Promise((go) => {
    const done = () => (clearTimeout(t), document.removeEventListener("visibilitychange", wake), go());
    const wake = () => { if (!document.hidden) done(); };
    const t = setTimeout(done, 30000);
    document.addEventListener("visibilitychange", wake);
  });
  async function sync(body) {
    // App.log asks without waiting: the newest changes, as the page was written with them.
    if (body.wait === false) return answer(200, { line, lines: (cfg.log || []).filter((l) => l.n > (body.since || 0)) });
    await pause();
    if (!/^https?:$/.test(location.protocol)) return answer(200, { line: body.since, lines: [] });
    try {
      const text = await (await native(location.href, { cache: "no-store" })).text();
      const found = text.match(/<script id="apps-lean" type="application\/json">([\s\S]*?)<\/script>/);
      const next = found && JSON.parse(found[1]);
      if (!next || next.stamp === stamp) return answer(200, { line: body.since, lines: [] });
      stamp = next.stamp;
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
