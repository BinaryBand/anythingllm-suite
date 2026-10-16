// Prism Studio's sign-in and sign-up, as web components in open shadow roots. Nothing here is a
// <form>, a <button> or a checkbox: the fields post with fetch when the div "button" is pressed.

const css = '<link rel="stylesheet" href="/assets/lab.css">';

class PrismField extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    const root = this.attachShadow({ mode: "open" });
    const type = this.getAttribute("type") || "text";
    root.innerHTML = `${css}<div class="field"><label for="i"></label><input id="i" type="${type}"></div>`;
    root.querySelector("label").textContent = this.getAttribute("label");
    const input = root.querySelector("input");
    if (this.hasAttribute("autocomplete")) input.autocomplete = this.getAttribute("autocomplete");
    input.addEventListener("keydown", (e) => e.key === "Enter" && this.dispatchEvent(new CustomEvent("prism-submit", { bubbles: true, composed: true })));
  }
  get value() {
    return this.shadowRoot.querySelector("input").value;
  }
}

class PrismSwitch extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>
      .row { display: flex; align-items: center; gap: .6rem; margin-bottom: 1rem; font: inherit; }
      [role=switch] { width: 42px; height: 24px; border-radius: 12px; background: #c5cad4; position: relative; cursor: pointer; flex: none; }
      [role=switch]::after { content: ""; position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: left .15s; }
      [role=switch][aria-checked=true] { background: var(--brand); }
      [role=switch][aria-checked=true]::after { left: 21px; }
    </style><div class="row"><div role="switch" tabindex="0" aria-checked="false"></div><span></span></div>`;
    const label = this.getAttribute("label");
    const sw = root.querySelector("[role=switch]");
    sw.setAttribute("aria-label", label);
    root.querySelector("span").textContent = label;
    const flip = () => sw.setAttribute("aria-checked", String(sw.getAttribute("aria-checked") !== "true"));
    sw.addEventListener("click", flip);
    sw.addEventListener("keydown", (e) => (e.key === " " || e.key === "Enter") && (e.preventDefault(), flip()));
  }
  get checked() {
    return this.shadowRoot.querySelector("[role=switch]").getAttribute("aria-checked") === "true";
  }
}

class PrismButton extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `${css}<style>[role=button]{display:block;width:100%}</style><div role="button" tabindex="0"></div>`;
    const b = root.querySelector("[role=button]");
    b.textContent = this.getAttribute("label");
    const press = () => b.getAttribute("aria-disabled") !== "true" && this.dispatchEvent(new CustomEvent("prism-submit", { bubbles: true, composed: true }));
    b.addEventListener("click", press);
    b.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), press()));
  }
  set busy(on) {
    this.shadowRoot.querySelector("[role=button]").setAttribute("aria-disabled", String(on));
  }
}

class PrismAuth extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    const login = this.getAttribute("mode") !== "signup";
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `${css}<div class="card">
      <h1>${login ? "Welcome back to Prism" : "Start designing with Prism"}</h1>
      <p class="error" role="alert" hidden></p>
      ${login ? "" : '<prism-field name="name" label="Full name" autocomplete="name"></prism-field>'}
      <prism-field name="email" label="Work email" type="email" autocomplete="${login ? "username" : "email"}"></prism-field>
      <prism-field name="password" label="Password" type="password" autocomplete="${login ? "current-password" : "new-password"}"></prism-field>
      ${login ? '<prism-switch name="remember" label="Keep me signed in"></prism-switch>' : ""}
      <prism-button label="${login ? "Sign in" : "Create account"}"></prism-button>
      <p class="muted">${login ? '<a href="/signup">New to Prism? Create an account</a>' : '<a href="/login">Have an account? Sign in</a>'}</p>
    </div>`;
    const error = root.querySelector(".error");
    const button = root.querySelector("prism-button");
    root.addEventListener("prism-submit", async () => {
      const body = { next: this.getAttribute("next") || "" };
      for (const f of root.querySelectorAll("prism-field")) body[f.getAttribute("name")] = f.value;
      if (!login) body.confirm = body.password;
      const sw = root.querySelector("prism-switch");
      if (sw) body.remember = sw.checked;
      button.busy = true;
      try {
        const r = await fetch(login ? "/login" : "/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
        location.href = data.redirect;
      } catch (e) {
        error.textContent = e.message;
        error.hidden = false;
        button.busy = false;
      }
    });
  }
}

customElements.define("prism-field", PrismField);
customElements.define("prism-switch", PrismSwitch);
customElements.define("prism-button", PrismButton);
customElements.define("prism-auth", PrismAuth);
