// Keyhole's passkey buttons, through @simplewebauthn/browser (served as /assets/webauthn.js).

(() => {
  const { startAuthentication, startRegistration, browserSupportsWebAuthn } = SimpleWebAuthnBrowser;
  const msg = document.getElementById("passkey-msg");
  const say = (text) => msg && (msg.textContent = text);

  async function post(url, body) {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
    return data;
  }

  function wire(id, run) {
    const button = document.getElementById(id);
    if (!button) return;
    if (!browserSupportsWebAuthn()) {
      button.disabled = true;
      return say("Passkeys need a secure page: open this site over https or on localhost.");
    }
    button.addEventListener("click", async () => {
      button.disabled = true;
      say("Waiting for your passkey…");
      try {
        location.href = (await run()).redirect;
      } catch (e) {
        say(e.name === "NotAllowedError" ? "The passkey request was cancelled or timed out." : e.message);
        button.disabled = false;
      }
    });
  }

  wire("passkey-signin", async () => post("/passkey/login/verify", await startAuthentication({ optionsJSON: await post("/passkey/login/options") })));
  wire("passkey-add", async () => post("/passkey/register/verify", await startRegistration({ optionsJSON: await post("/passkey/register/options") })));
})();
