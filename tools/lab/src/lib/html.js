// A tagged template that escapes what goes into it, unless it's already html`` (or raw()).

class Raw {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}

export const raw = (s) => new Raw(String(s));
export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const part = (v) => (v == null || v === false ? "" : v instanceof Raw ? v.s : Array.isArray(v) ? v.map(part).join("") : esc(v));
export const html = (strings, ...values) => raw(strings.reduce((out, s, i) => out + s + (i < values.length ? part(values[i]) : ""), ""));

/** A labelled input. `attrs` become attributes as given (true for a bare one). */
export function field({ label, name, type = "text", value, hint, ...attrs }) {
  const id = attrs.id ?? `f-${name}`;
  const more = Object.entries(attrs)
    .filter(([k, v]) => k !== "id" && v !== false && v != null)
    .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${esc(v)}"`))
    .join("");
  return html`<div class="field"><label for="${id}">${label}</label><input id="${id}" name="${name}" type="${type}"${value != null && type !== "password" ? raw(` value="${esc(value)}"`) : ""}${raw(more)}>${hint ? html`<small>${hint}</small>` : ""}</div>`;
}

export const error = (message) => (message ? html`<p class="error" role="alert">${message}</p>` : "");
export const notice = (message) => (message ? html`<p class="notice" role="status">${message}</p>` : "");

/** A round icon in `color`, as a <link>, so each site's tab looks its own. */
export const icon = (color) =>
  raw(`<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="${color}"/></svg>`)}">`);
