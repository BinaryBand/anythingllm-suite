// npm run reset: every account, session, passkey and code gone, then Alice seeded again.
import { wipe } from "./lib/db.js";
import { seedAll } from "./sites/index.js";

wipe();
seedAll();
console.log("The lab is reset: each site has only alice@lab.test again.");
