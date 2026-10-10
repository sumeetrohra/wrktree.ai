import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fakeAgentEntry, fakeAgentLogin } from "@agentdeck/fake-agent";

/** How the daemon launches and manages one kind of ACP agent. */
export type AgentSpec = {
  id: string;
  displayName: string;
  /** Adapter command line; the daemon talks ACP to it over stdio. */
  command: string[];
  /** Env that points the agent at a profile's isolated config folder. */
  profileEnv: (dir: string) => Record<string, string>;
  /** Run in a desktop terminal with `profileEnv` applied. */
  loginCommand: string[];
  loginStatus: (dir: string) => { loggedIn: boolean; account?: string };
  /** Recognises a usage-limit failure in an adapter error. */
  detectLimit: (err: unknown) => { hit: boolean; resetAt?: number };
};

const npx = process.platform === "win32" ? "npx.cmd" : "npx";

function errorText(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { message?: unknown; data?: unknown };
    return `${String(e.message ?? "")} ${JSON.stringify(e.data ?? "")}`;
  }
  return String(err);
}

const textLimit = (err: unknown) => ({ hit: /usage limit|rate.?limit|quota|429/i.test(errorText(err)) });

const fileLogin = (file: string, field: string) => (dir: string) => {
  const p = join(dir, file);
  if (!existsSync(p)) return { loggedIn: false };
  try {
    const account = (JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>)[field];
    return typeof account === "string" ? { loggedIn: true, account } : { loggedIn: true };
  } catch {
    return { loggedIn: true };
  }
};

/**
 * Package versions are pinned; confirm them against the ACP registry before bumping.
 * On macOS Claude Code keeps credentials in the Keychain, so `loginStatus` for
 * claude is a best effort until the Phase 0 Keychain spike settles it.
 */
const builtIn: AgentSpec[] = [
  {
    id: "claude",
    displayName: "Claude Code",
    command: [npx, "-y", "@zed-industries/claude-agent-acp@0.23.1"],
    profileEnv: (dir) => ({ CLAUDE_CONFIG_DIR: dir }),
    loginCommand: ["claude", "/login"],
    loginStatus: fileLogin(".credentials.json", "account"),
    detectLimit: textLimit,
  },
  {
    id: "codex",
    displayName: "Codex",
    command: [npx, "-y", "@zed-industries/codex-acp@0.16.0"],
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
const fake: AgentSpec = {
  id: "fake",
  displayName: "Fake agent (tests)",
  command: [process.execPath, fakeAgentEntry],
  profileEnv: (dir) => ({ FAKE_AGENT_HOME: dir }),
  loginCommand: [process.execPath, fakeAgentLogin],
  loginStatus: fileLogin("fake-login.json", "account"),
  detectLimit: (err) => {
    const data = (err as { data?: { kind?: string; resetAt?: number } } | null)?.data;
    return data?.kind === "usage_limit" ? { hit: true, resetAt: data.resetAt } : textLimit(err);
  },
};

export class AgentRegistry {
  private specs = new Map<string, AgentSpec>();

  constructor(devAgents: boolean) {
    for (const s of builtIn) this.specs.set(s.id, s);
    if (devAgents) this.specs.set(fake.id, fake);
  }

  get(id: string): AgentSpec | undefined {
    return this.specs.get(id);
  }

  ids(): string[] {
    return [...this.specs.keys()];
  }
}
