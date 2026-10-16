// Starts the lab: the dashboard on LAB_BASE_PORT (localhost only) and every site on the ports after
// it, on LAB_BIND (127.0.0.1 unless set; 0.0.0.0 for AnythingLLM in Docker to reach them).

import { dashboard } from "./dashboard.js";
import { createSite } from "./lib/site.js";
import { BASE_PORT, SITES, portOf, publicUrlOf, seedAll } from "./sites/index.js";

const BIND = process.env.LAB_BIND || "127.0.0.1";
const DASHBOARD_BIND = process.env.LAB_DASHBOARD_BIND || "127.0.0.1";

function listen(app, port, host, label) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => resolve(server));
    server.once("error", (e) => reject(e.code === "EADDRINUSE" ? new Error(`port ${port} (${label}) is in use: stop what's on it, or set LAB_BASE_PORT`) : e));
  });
}

seedAll();
try {
  await listen(dashboard(), BASE_PORT, DASHBOARD_BIND, "dashboard");
  for (const site of SITES) await listen(createSite(site), portOf(site), BIND, site.name);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const shown = (host) => (host === "0.0.0.0" || host === "::" ? "localhost" : host);
console.log(`Test lab  dashboard  http://${shown(DASHBOARD_BIND)}:${BASE_PORT}`);
for (const site of SITES) {
  const pub = publicUrlOf(site);
  console.log(`  ${site.name.padEnd(10)}  ${site.title.padEnd(17)} http://${shown(BIND)}:${portOf(site)}${pub ? `  ${pub}` : ""}`);
}
if (BIND !== "127.0.0.1" && BIND !== "localhost") console.log(`Sites listen on ${BIND}.`);
