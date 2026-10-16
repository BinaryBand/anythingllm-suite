/*part
{"name":"share","line":"a number and its share","data":{"kind":"share","big":"35%","label":"of each page is CSS","value":0.35,"part":"CSS"}}
*/
Parts.kinds.share = (f, { svg, fit, esc, wrap, rect, mid }) => {
  const v = Math.max(0, Math.min(1, +f.value || 0)), h = 140, cut = 21 + v * h;
  const lines = [0, 1, 2, 3].map((i) => cut + 14 + i * 14).filter((y) => y < 152);
  return svg(`<text class="tb" x="24" y="72">${fit(f.big, 8)}</text>` +
    wrap(f.label || "", 18).slice(0, 4).map((l, i) => `<text class="tx" x="24" y="${92 + i * 14}">${esc(l)}</text>`).join("") +
    rect(176, 20, 100, h, "ln", 6) + rect(177, 21, 98, Math.max(2, v * h - 2), "fs", 5) +
    (f.part ? mid("ti", 226, 21 + (v * h) / 2 + 3.5, fit(f.part, 12)) : "") +
    lines.map((y, i) => rect(188, y, [64, 48, 58, 40][i], 1.5, "lq", 0.75)).join(""), `${f.big} ${f.label}`);
};
