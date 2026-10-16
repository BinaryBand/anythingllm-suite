/*part
{"name":"timeline","line":"ordered steps with a named span","data":{"kind":"timeline","items":["css","layouts","parts","switch"],"mark":3,"span":[0,2,"adds only"]}}
*/
Parts.kinds.timeline = (f, { svg, fit, spread, rect, mid }) => {
  const items = (f.items || []).slice(0, 5), n = items.length, s = 44, xs = spread(n, s, n > 4 ? 16 : 24), y = 70;
  let br = "";
  if (Array.isArray(f.span)) {
    const [a, b, label] = f.span, x1 = xs[a] ?? xs[0], x2 = (xs[Math.min(b, n - 1)] ?? xs[0]) + s;
    br = `<path class="lq" d="M${x1} ${y - 12}v-8H${x2}v8"/>` + mid("tx", (x1 + x2) / 2, y - 28, fit(label, 34));
  }
  return svg(`<path class="lq" d="M${xs[0] + s / 2} ${y + s / 2}H${xs[n - 1] + s / 2}"/>` + br + xs.map((x, i) => {
    const on = i === f.mark;
    return rect(x, y, s, s, on ? "fi" : "fp", 6) + rect(x, y, s, s, "ln", 6) +
      mid(on ? "tp" : "ti", x + s / 2, y + s / 2 + 3.5, i + 1) +
      mid("tx", x + s / 2, y + s + 20, fit(items[i], 10));
  }).join(""), "Steps: " + items.join(", then "));
};
