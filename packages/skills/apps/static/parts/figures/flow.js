/*part
{"name":"flow","line":"boxes joined by arrows: a process","data":{"kind":"flow","items":["check","advice","card"],"notes":["blocks","","shown"],"mark":2,"dashed":1}}
*/
Parts.kinds.flow = (f, { W, H, svg, fit, spread, mid }) => {
  const items = (f.items || []).slice(0, 5), n = items.length, s = Math.min(54, (W - 28 - (n - 1) * 20) / n);
  const y = (H - s) / 2 - 6;
  return svg(spread(n, s, 20).map((x, i) => {
    const on = i === f.mark;
    return `<rect class="${on ? "fi" : "ln"}${i === f.dashed ? " dash" : ""}" x="${x}" y="${y}" width="${s}" height="${s}" rx="6"/>` +
      mid(on ? "tp" : "ti", x + s / 2, y + s / 2 + 3.5, fit(items[i], 9)) +
      (f.notes?.[i] ? mid("tx", x + s / 2, y + s + 18, fit(f.notes[i], 11)) : "") +
      (i < n - 1 ? `<path class="lq" d="M${x + s + 4} ${y + s / 2}h12M${x + s + 11} ${y + s / 2 - 4}l5 4-5 4"/>` : "");
  }).join(""), items.join(", then "));
};
