// Where the skill keeps things in AnythingLLM's storage: every workspace's apps under apps-lean/,
// one folder each, and the user's own versions of the shipped parts under apps-lean/.static/ (a
// dot, so no workspace can be named like it).

import path from "node:path";
import { storageDir } from "#shared/anythingllm";

export const HUB_ID = "apps-lean";

/** Every workspace's apps: apps-lean in AnythingLLM's storage. */
export const root = (): string => path.join(storageDir(), HUB_ID);

/** The user's own versions of the files in static/, at the same paths. */
export const overrides = (): string => path.join(root(), ".static");
