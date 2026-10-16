/*part
{"name":"grid","line":"labelled cells, marked or struck","data":{"kind":"grid","items":["list","timer","deck"],"marked":[0],"struck":false}}
*/
Parts.kinds.grid = (f, { H, svg, fit, spread, rect, mid }) => {
  const items = (f.items || []).slice(0, 9), n = items.length, cols = n <= 4 ? n : 3, rows = Math.ceil(n / cols);
  const w = (264 - (cols - 1) * 12) / cols, h = 44, xs = spread(cols, w, 12), y0 = (H - (rows * h + (rows - 1) * 12)) / 2;
  return svg(items.map((it, i) => {
    const x = xs[i % cols], y = y0 + Math.floor(i / cols) * (h + 12), on = (f.marked || []).includes(i);
    return rect(x, y, w, h, on ? "fs" : "fp", 6) + rect(x, y, w, h, f.struck ? "lq" : "ln", 6) +
      mid(f.struck ? "tx" : "ti", x + w / 2, y + h / 2 + 3.5, fit(it, Math.floor(w / 6.2))) +
      (f.struck ? `<path class="lq" d="M${x + 4} ${y + h - 4}L${x + w - 4} ${y + 4}"/>` : "");
  }).join(""), (f.struck ? "Struck through: " : "") + items.join(", "));
};
