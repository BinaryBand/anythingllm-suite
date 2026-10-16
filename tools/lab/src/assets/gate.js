// Fortress Bank's human check: asks the server for a challenge, passes by itself after a moment, or
// asks for a click when the browser looks automated. The sign-in button stays off until it's done.

(async () => {
  const gate = document.getElementById("gate");
  if (!gate) return;
  const submit = gate.closest("form").querySelector("button[type=submit]");
  const status = document.getElementById("gate-status");
  const box = document.getElementById("gate-box");
  const check = document.getElementById("gate-check");
  const tokenInput = document.getElementById("gate-token");
  submit.disabled = true;

  const post = async (url, body) => {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { ok: r.ok, json: await r.json().catch(() => ({})) };
  };
  const challenge = (await post("/gate/challenge", { webdriver: navigator.webdriver === true, hard: gate.dataset.hard === "true" })).json;

  async function solve(clicked) {
    await new Promise((r) => setTimeout(r, (challenge.minMs || 0) + 300 + Math.random() * 1200));
    const done = await post("/gate/solve", { id: challenge.id, clicked });
    if (!done.ok) return (status.textContent = done.json.error || "Verification failed. Reload and try again.");
    tokenInput.value = done.json.token;
    status.textContent = "Success! You are human.";
    box.hidden = true;
    submit.disabled = false;
  }
  if (challenge.needsClick) {
    status.textContent = "Please verify that you are human.";
    box.hidden = false;
    check.addEventListener("change", () => {
      if (!check.checked) return;
      status.textContent = "Verifying…";
      solve(true);
    });
  } else solve(false);
})();
