// Acorn Market: the cookie dialog (it blocks the page behind it until a choice is made), and the Log in
// button that stays disabled until both fields have something in them.

(() => {
  const main = document.querySelector("main");
  const dialog = document.getElementById("cookie-dialog");
  const backdrop = document.getElementById("cookie-backdrop");
  // The page makes <main> inert while the dialog is up, so the dialog can't stay inside it.
  if (dialog) document.body.append(...[backdrop, dialog].filter(Boolean));

  const choose = (value) => {
    document.cookie = `acorn_consent=${value}; path=/; max-age=31536000; samesite=lax`;
    dialog?.remove();
    backdrop?.remove();
    main?.removeAttribute("inert");
  };
  if (dialog) {
    const open = () => {
      dialog.hidden = false;
      if (dialog.dataset.banner !== "bottom") {
        if (backdrop) backdrop.hidden = false;
        main?.setAttribute("inert", "");
        dialog.querySelector("button")?.focus();
      }
    };
    if (dialog.dataset.banner === "late") setTimeout(open, 2000);
    else open();
    document.getElementById("cookie-accept").onclick = () => choose("all");
    document.getElementById("cookie-reject").onclick = () => choose("none");
    document.getElementById("cookie-manage").onclick = () => {
      document.getElementById("cookie-prefs").hidden = false;
      document.getElementById("cookie-manage").hidden = true;
    };
    document.getElementById("cookie-save").onclick = () =>
      choose(["analytics", "ads"].filter((k) => document.getElementById(`cookie-${k}`).checked).join("+") || "necessary");
  }

  const submit = document.querySelector("[data-needs-fields]");
  if (submit) {
    const fields = [...submit.form.querySelectorAll("input[type=email], input[type=password]")];
    const update = () => (submit.disabled = !fields.every((f) => f.value.trim()));
    fields.forEach((f) => f.addEventListener("input", update));
    setInterval(update, 500); // autofill doesn't always fire input
    update();
  }
  document.getElementById("forgot")?.addEventListener("click", (e) => (location.href = e.currentTarget.dataset.href));
})();
