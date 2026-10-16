/*part
{"name":"screens","line":"layouts on phone, browser, desktop","data":{"kind":"screens","items":[{"device":"phone","layout":"dashboard"},{"device":"browser","layout":"dashboard"}]}}
*/
Parts.kinds.screens = (f, { W, svg, fit, rect, bar, mid }) => {
  // A layout's wireframe inside the box (x, y, w, h); a wide box gets the wide arrangement.
  function layout(name, x, y, w, h) {
    const wide = w / h > 1.2, head = rect(x, y, Math.min(w * 0.5, 40), Math.max(3, h * 0.05), "fi", 1);
    const top = y + h * 0.14, bh = h - h * 0.14;
    if (name === "dashboard") {
      const cols = wide ? 4 : 2, rows = wide ? 1 : 2, g = 4, tw = (w - g * (cols - 1)) / cols, th = wide ? bh * 0.45 : (bh * 0.62 - g) / 2;
      let s = head;
      for (let i = 0; i < cols * rows; i++) s += rect(x + (i % cols) * (tw + g), top + Math.floor(i / cols) * (th + g), tw, th, "fs", 3);
      return s + rect(x, top + rows * (th + g) + 2, w, 6, "ln", 3);
    }
    if (name === "focus") {
      return head + `<circle class="ln" cx="${x + w / 2}" cy="${top + bh * 0.42}" r="${Math.min(w, bh) * 0.28}"/>` +
        rect(x + w / 2 - Math.min(w * 0.3, 30), top + bh * 0.82, Math.min(w * 0.6, 60), Math.max(4, bh * 0.1), "fi", 3);
    }
    if (name === "list-detail") {
      const lw = wide ? w * 0.32 : w, rows = [0, 1, 2].map((i) => bar(x, top + 4 + i * 10, lw * 0.8)).join("");
      return head + rows + (wide ? rect(x + lw + 6, top, w - lw - 6, bh, "fs", 3) : rect(x, top + 36, w, bh - 36, "fs", 3));
    }
    const cw = wide ? w * 0.5 : w, cx = x + (w - cw) / 2;
    if (name === "story") {
      return bar(cx, y, cw) + rect(cx, y + h * 0.1, cw, h * 0.34, "fs", 4) +
        [0, 1, 2].map((i) => bar(cx, y + h * 0.52 + i * h * 0.08, cw * [1, 0.85, 0.6][i])).join("") + rect(cx, y + h * 0.82, cw, h * 0.13, "fi", 3);
    }
    return rect(cx, y, Math.min(cw * 0.5, 40), Math.max(3, h * 0.05), "fi", 1) +
      [1, 0.8, 0.9, 0.7, 1, 0.6].map((k, i) => bar(cx, top + i * (bh / 6), cw * k)).join("");
  }
  const DEV = { phone: [50, 100], browser: [140, 96], desktop: [140, 100] };
  const items = (f.items || []).map((it) => ({ ...it, device: it.device || "phone" })).filter((it) => DEV[it.device]).slice(0, 4), size = items.map((it) => DEV[it.device]);
  const want = size.reduce((s, [w]) => s + w, 0) + 14 * (items.length - 1), tall = Math.max(...size.map(([, h]) => h));
  const k = Math.min(1, (W - 16) / want, 128 / tall), top = (150 - tall * k) / 2 + 2, same = items.every((it) => it.layout === items[0].layout);
  let x = (W - want * k) / 2;
  return svg(items.map((it, i) => {
    const [w, h] = size[i].map((v) => v * k), y = top + tall * k - h, dev = it.device;
    let s;
    if (dev === "phone") s = rect(x, y, w, h, "ln", 8 * k) + layout(it.layout, x + 6 * k, y + 9 * k, w - 12 * k, h - 16 * k);
    else if (dev === "browser") s = rect(x, y, w, h, "ln", 6 * k) + `<path class="lq" d="M${x} ${y + 14 * k}H${x + w}"/>` + layout(it.layout, x + 7 * k, y + 20 * k, w - 14 * k, h - 26 * k);
    else s = rect(x, y, w, h - 16 * k, "ln", 5 * k) + `<path class="ln" d="M${x + w / 2 - 6 * k} ${y + h - 16 * k}l-3 ${10 * k}h${18 * k}l-3 ${-10 * k}M${x + w / 2 - 20 * k} ${y + h - 2 * k}h${40 * k}"/>` + layout(it.layout, x + 7 * k, y + 7 * k, w - 14 * k, h - 30 * k);
    s += mid("ti", x + w / 2, top + tall * k + 18, fit(it.label || (same ? dev : it.layout), 16));
    x += w + 14 * k;
    return s;
  }).join(""), "Screens: " + items.map((it) => `${it.layout} on ${it.device}`).join(", "));
};
