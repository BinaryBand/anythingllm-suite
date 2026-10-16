// Murmur Chat's pages: the homeserver picker, the lockout countdown, the QR code that changes, and the
// sign-up page that waits for an emailed link to be opened somewhere else.

(() => {
  const $ = (id) => document.getElementById(id);

  const edit = $("server-edit");
  if (edit) {
    const picker = $("picker");
    const note = $("picker-msg");
    edit.addEventListener("click", () => {
      picker.hidden = !picker.hidden;
      if (!picker.hidden) $("f-homeserver").focus();
    });
    $("server-go").addEventListener("click", async () => {
      const name = $("f-homeserver").value.trim().toLowerCase();
      note.className = "muted";
      note.textContent = "Looking up the homeserver…";
      await new Promise((r) => setTimeout(r, 800)); // a real lookup takes a moment
      const found = await fetch(`/.well-known/matrix/client?server=${encodeURIComponent(name)}`);
      if (!found.ok) {
        note.className = "error";
        note.setAttribute("role", "alert");
        note.textContent = `Can't find a homeserver at ${name}. Check the address and try again.`;
        return;
      }
      const info = await found.json();
      if (info["lab.immediate"]) return void (location.href = "/sso/start");
      $("server-name").textContent = name;
      $("methods").innerHTML = await (await fetch(`/login/methods?server=${encodeURIComponent(name)}`)).text();
      note.className = "muted";
      note.textContent = "";
      picker.hidden = true;
    });
  }

  const countdown = $("countdown");
  if (countdown) {
    let left = Number(countdown.textContent);
    const form = countdown.closest("form");
    const timer = setInterval(() => {
      left -= 1;
      countdown.textContent = Math.max(left, 0);
      if (left > 0) return;
      clearInterval(timer);
      $("lock-note").hidden = true;
      form.querySelector("button[type=submit]").disabled = false;
    }, 1000);
  }

  const qr = $("qr");
  if (qr) {
    const refresh = async () => (qr.src = (await (await fetch("/login/qr/code")).json()).image);
    refresh();
    setInterval(refresh, Number(qr.dataset.every) * 1000);
  }

  const waiting = document.querySelector("[data-wait-link]");
  if (waiting) {
    const timer = setInterval(async () => {
      const { confirmed } = await (await fetch("/register/status")).json();
      if (!confirmed) return;
      clearInterval(timer);
      waiting.textContent = "Link opened. Continuing…";
      const form = document.createElement("form");
      form.method = "post";
      form.action = "/register/continue";
      document.body.append(form);
      form.submit();
    }, 1000);
  }
})();
