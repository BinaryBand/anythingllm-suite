/*part
{"name":"fanout","line":"one thing that feeds several","data":{"kind":"fanout","from":"app.css","to":["list","timer","deck"]}}
*/
Parts.kinds.fanout = (f, { svg, fit, spread, rect, mid }) => {
  const to = (f.to || []).slice(0, 5), n = to.length, w = 44, xs = spread(n, w, n > 4 ? 12 : 22);
  const bus = `M150 40v16M${xs[0] + w / 2} 56H${xs[n - 1] + w / 2}` + xs.map((x) => `M${x + w / 2} 56v28`).join("");
  return svg(rect(100, 10, 100, 30, "fi", 6) + mid("tp", 150, 29, fit(f.from, 14)) + `<path class="lq" d="${bus}"/>` +
    xs.map((x, i) => rect(x, 84, w, 70, "ln", 6) + rect(x + 7, 94, 18, 4, "fi", 1) + rect(x + 7, 104, 30, 14 + (i % 3) * 8, "fs") +
      mid("tx", x + w / 2, 172, fit(to[i], 9))).join(""), `${f.from} feeding ${to.join(", ")}`);
};
