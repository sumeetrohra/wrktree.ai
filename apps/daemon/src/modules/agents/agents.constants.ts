import { fakeAgentEntry, fakeAgentLogin } from "@agentdeck/fake-agent";

import type { TAgentSpec } from "#src/shared/agent-spec.types.js";

import { fileLogin, structuredLimit, textLimit } from "./agents.utils.js";

const NPX = process.platform === "win32" ? "npx.cmd" : "npx";

/**
 * Package versions are pinned; confirm them against the ACP registry before bumping.
 * On macOS Claude Code keeps credentials in the Keychain, so `loginStatus` for
 * claude is a best effort until the Phase 0 Keychain spike settles it.
 */
export const BUILT_IN_AGENTS: readonly TAgentSpec[] = [
  {
    id: "claude",
    displayName: "Claude Code",
    command: [NPX, "-y", "@zed-industries/claude-agent-acp@0.23.1"],
    profileEnv: (dir) => ({ CLAUDE_CONFIG_DIR: dir }),
    loginCommand: ["claude", "/login"],
    loginStatus: fileLogin(".credentials.json", "account"),
    detectLimit: textLimit,
  },
  {
    id: "codex",
    displayName: "Codex",
    command: [NPX, "-y", "@zed-industries/codex-acp@0.16.0"],
    profileEnv: (dir) => ({ CODEX_HOME: dir }),
    loginCommand: ["codex", "login"],
    loginStatus: fileLogin("auth.json", "email"),
    detectLimit: textLimit,
  },
  {
    id: "gemini",
    displayName: "Gemini CLI",
    command: ["gemini", "--experimental-acp"],
    profileEnv: (dir) => ({ GEMINI_CLI_HOME: dir }),
    loginCommand: ["gemini"],
    loginStatus: fileLogin("oauth_creds.json", "email"),
    detectLimit: textLimit,
  },
];

/** The scripted test agent from tools/fake-agent. Registered only with `devAgents`. */
export const FAKE_AGENT: TAgentSpec = {
  id: "fake",
  displayName: "Fake agent (tests)",
  command: [process.execPath, fakeAgentEntry],
  profileEnv: (dir) => ({ FAKE_AGENT_HOME: dir }),
  loginCommand: [process.execPath, fakeAgentLogin],
  loginStatus: fileLogin("fake-login.json", "account"),
  detectLimit: structuredLimit,
};
