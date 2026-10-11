#!/usr/bin/env node
/**
 * The fake agent's "login": writes an account marker into its config dir
 * (FAKE_AGENT_HOME), the way `claude /login` writes credentials into CLAUDE_CONFIG_DIR.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { LOGIN_FILE } from "./paths.constants.js";

const env = z
  .object({ FAKE_AGENT_HOME: z.string().optional(), FAKE_ACCOUNT: z.string().optional() })
  .parse(process.env);

const home = env.FAKE_AGENT_HOME;
if (!home) {
  process.stderr.write("FAKE_AGENT_HOME is not set\n");
  process.exit(2);
}
const account = env.FAKE_ACCOUNT ?? process.argv[2] ?? "dev@fake.local";
mkdirSync(home, { recursive: true });
writeFileSync(join(home, LOGIN_FILE), JSON.stringify({ account, at: Date.now() }));
process.stdout.write(`Logged in to fake agent as ${account}\n`);
