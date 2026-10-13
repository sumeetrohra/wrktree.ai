import { fileURLToPath } from "node:url";

import { buildSite } from "./build.service.js";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const out = fileURLToPath(new URL("../out", import.meta.url));
for (const path of buildSite(root, out)) process.stdout.write(`built ${path}\n`);
