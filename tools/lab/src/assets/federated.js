// Cirrus Docs' popup button: opens the provider in a small window, and goes on when that window says it's done.

(() => {
  const button = document.getElementById("lumen-signin");
  const msg = document.getElementById("lumen-msg");
  if (!button || button.tagName === "A") return;
  button.addEventListener("click", () => {
    const popup = window.open(button.dataset.start, "lumen-id", "popup,width=480,height=680");
    if (!popup) location.href = button.dataset.start.replace("mode=popup", "mode=redirect"); // popups blocked
  });
  addEventListener("message", (e) => {
    if (e.origin !== location.origin || e.data?.type !== "lumen-auth") return;
    if (e.data.ok) return void (location.href = e.data.next || "/account");
    msg.textContent = "Lumen ID sign-in didn't finish.";
    msg.hidden = false;
  });
})();
