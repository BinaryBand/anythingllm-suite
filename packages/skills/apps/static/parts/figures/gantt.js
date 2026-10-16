/*part
{"name":"gantt","line":"dated bars on lanes: a plan, a roadmap","data":{"kind":"gantt","items":[{"label":"Plan","start":"2026-11-03","end":"2026-11-10","done":true},{"label":"Order","start":"2026-11-08","end":"2026-11-21"},{"label":"Fit","start":"2026-11-17","end":"2026-11-28"},{"label":"Paint","start":"2026-11-26","end":"2026-12-05"}],"today":"2026-11-14","milestone":{"label":"Worktop","date":"2026-11-28"}}}
*/
Parts.kinds.gantt = (f, { W, svg, fit, rect, mid }) => {
  const day = (s) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s) ? Date.parse(s.slice(0, 10) + "T00:00:00Z") / 864e5 : NaN);
  const items = (f.items || []).slice(0, 6).map((i) => ({ label: String(i?.label ?? ""), a: day(i?.start), b: day(i?.end), done: !!i?.done })).filter((i) => !isNaN(i.a) && !isNaN(i.b) && i.b >= i.a);
  if (!items.length) return svg("", "No dated steps yet");
  const lo = Math.min(...items.map((i) => i.a)), hi = Math.max(...items.map((i) => i.b)) + 1;
  const left = 74, right = W - 10, top = 26, lane = Math.min(24, 128 / items.length), x = (d) => left + ((d - lo) / (hi - lo)) * (right - left);
  const fmt = (d) => new Date(d * 864e5).toISOString().slice(5, 10);
  let body = mid("tx", left + 10, 16, fmt(lo)) + mid("tx", right - 14, 16, fmt(hi - 1));
  body += items.map((it, i) => {
    const y = top + i * lane;
    return `<text class="ti" x="8" y="${y + lane / 2 + 3.5}">${fit(it.label, 10)}</text>` + rect(x(it.a), y + 3, Math.max(3, x(it.b + 1) - x(it.a)), lane - 6, it.done ? "fi" : "fs", 3);
  }).join("");
  const bottom = top + items.length * lane;
  const today = day(f.today);
  if (!isNaN(today) && today >= lo && today <= hi) body += `<path class="lq" stroke-dasharray="4 3" d="M${x(today)} ${top - 4}V${bottom + 2}"/>` + mid("tx", x(today), bottom + 14, "today");
  const ms = f.milestone && day(f.milestone.date);
  if (ms && !isNaN(ms) && ms >= lo && ms <= hi) body += `<path class="ln" d="M${x(ms)} ${bottom + 4}l5 6l-5 6l-5-6z"/>` + mid("tx", x(ms), bottom + 30, fit(f.milestone.label, 14));
  return svg(body, items.map((i) => `${i.label} ${fmt(i.a)} to ${fmt(i.b)}${i.done ? ", done" : ""}`).join("; "));
};
