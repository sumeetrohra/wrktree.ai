#!/usr/bin/env node
/**
 * The fake agent's "login": writes an account marker into its config dir
 * (FAKE_AGENT_HOME), the way `claude /login` writes credentials into CLAUDE_CONFIG_DIR.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LOGIN_FILE } from "./paths.js";

const home = process.env.FAKE_AGENT_HOME;
if (!home) {
  console.error("FAKE_AGENT_HOME is not set");
  process.exit(2);
}
const account = process.env.FAKE_ACCOUNT ?? process.argv[2] ?? "dev@fake.local";
mkdirSync(home, { recursive: true });
writeFileSync(join(home, LOGIN_FILE), JSON.stringify({ account, at: Date.now() }));
console.log(`Logged in to fake agent as ${account}`);
