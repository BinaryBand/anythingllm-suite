// Meridian Wallet: waits for the phone's answer, then goes on.

(() => {
  const status = document.getElementById("push-status");
  const timer = setInterval(async () => {
    const r = await fetch("/login/status").catch(() => null);
    if (!r?.ok) return;
    const { status: now } = await r.json();
    if (now === "approved") (clearInterval(timer), (status.textContent = "Approved. Signing you in…"), (location.href = "/login/complete"));
    else if (now !== "pending") (clearInterval(timer), location.reload());
  }, 1000);
})();
