// Orbit Tasks' client: hash routes, a token in localStorage, everything drawn here. Each view
// waits a moment before it draws, as an app fetching its data would.

const KEY = "orbit_token";
const app = document.getElementById("app");
const nav = document.getElementById("nav");
const token = () => localStorage.getItem(KEY);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (v === true) el.setAttribute(k, "");
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
}

async function api(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token()) headers.Authorization = `Bearer ${token()}`;
  const r = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && token() && !path.startsWith("/api/login")) localStorage.removeItem(KEY);
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}

function field(label, name, type = "text", attrs = {}) {
  const id = `f-${name}`;
  return h("div", { class: "field" }, h("label", { for: id }, label), h("input", { id, name, type, ...attrs }));
}

function drawNav(user) {
  nav.replaceChildren(
    ...(user
      ? [h("a", { href: "#/account" }, "My tasks"), h("button", { class: "linkish", type: "button", onclick: signOut }, "Sign out")]
      : [h("a", { href: "#/login" }, "Sign in"), h("a", { class: "button small", href: "#/signup" }, "Create account")]),
  );
}

async function signOut() {
  await api("/api/logout", { method: "POST" }).catch(() => {});
  localStorage.removeItem(KEY);
  location.hash = "#/";
}

function authForm(kind) {
  const error = h("p", { class: "error", role: "alert", hidden: true });
  const form = h(
    "form",
    { class: "card", novalidate: true },
    h("h1", {}, kind === "login" ? "Sign in to Orbit" : "Join Orbit"),
    error,
    kind === "signup" ? field("Your name", "name", "text", { autocomplete: "name" }) : null,
    field("Email", "email", "email", { autocomplete: kind === "login" ? "username" : "email" }),
    field("Password", "password", "password", { autocomplete: kind === "login" ? "current-password" : "new-password" }),
    h("button", { type: "submit" }, kind === "login" ? "Sign in" : "Create account"),
    h("p", { class: "muted" }, kind === "login" ? h("a", { href: "#/signup" }, "Need an account?") : h("a", { href: "#/login" }, "Already have one? Sign in")),
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    try {
      const { token: t } = await api(kind === "login" ? "/api/login" : "/api/signup", { method: "POST", body });
      localStorage.setItem(KEY, t);
      location.hash = "#/account";
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  });
  return form;
}

async function account() {
  const [me, { tasks }] = await Promise.all([api("/api/me"), api("/api/tasks")]);
  const list = (items) =>
    h("ul", { class: "tasks" }, items.map((t, i) =>
      h("li", {}, h("label", { class: "check" },
        h("input", { type: "checkbox", checked: t.done, onchange: async () => draw((await api(`/api/tasks/${i}/toggle`, { method: "POST" })).tasks) }),
        t.title))));
  const box = h("div");
  const draw = (items) => box.replaceChildren(list(items));
  draw(tasks);
  const input = h("input", { id: "new-task", name: "title", placeholder: "What needs doing?", "aria-label": "New task" });
  const form = h("form", { class: "card wide" }, input, h("p"), h("button", { type: "submit" }, "Add task"));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!input.value.trim()) return;
    draw((await api("/api/tasks", { method: "POST", body: { title: input.value } })).tasks);
    input.value = "";
  });
  drawNav(me);
  return [h("h1", {}, "My tasks"), h("p", { class: "signed-in" }, "Signed in as ", h("strong", {}, me.name || me.email), ` (${me.email})`), box, form];
}

async function route() {
  const path = location.hash.replace(/^#/, "") || "/";
  app.replaceChildren(h("p", { class: "muted" }, "Loading…"));
  await pause(600);
  let me = null;
  if (token()) me = await api("/api/me").catch(() => null);
  drawNav(me);
  try {
    if (path === "/account") {
      if (!me) return void (location.hash = "#/login");
      app.replaceChildren(...(await account()));
    } else if (path === "/login" || path === "/signup") {
      if (me) return void (location.hash = "#/account");
      app.replaceChildren(authForm(path.slice(1)));
    } else {
      app.replaceChildren(h("section", { class: "hero" }, h("h1", {}, "Orbit Tasks"), h("p", { class: "lead" }, "Tasks in orbit."),
        me ? h("p", {}, `Welcome back, ${me.name || me.email}. `, h("a", { href: "#/account" }, "Open your tasks"))
           : h("p", { class: "actions" }, h("a", { class: "button", href: "#/login" }, "Sign in"), " ", h("a", { class: "button ghost", href: "#/signup" }, "Create account"))));
    }
  } catch (err) {
    app.replaceChildren(h("p", { class: "error" }, err.message));
  }
}

addEventListener("hashchange", route);
route();
