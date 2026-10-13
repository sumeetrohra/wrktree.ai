import { fileURLToPath } from "node:url";

/** Absolute paths the daemon's `fake` agent spec uses to launch this agent. */
export const fakeAgentEntry = fileURLToPath(new URL("./index.js", import.meta.url));
export const fakeAgentLogin = fileURLToPath(new URL("./login.js", import.meta.url));
export const LOGIN_FILE = "fake-login.json";
export const CRASH_ON_START_FILE = "fake-crash-on-start";

/** The fake agent's instructions file in its config folder (like CLAUDE.md for Claude Code). */
export const INSTRUCTIONS_FILE = "FAKE.md";
