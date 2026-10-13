/** What `agentdeck doctor` can look at; the command gives it the real machine, tests a fake one. */
export interface IDoctorProbe {
  platform: NodeJS.Platform;
  nodeVersion: string;
  run(command: readonly string[]): Promise<{ code: number; stdout: string; stderr: string }>;
  /** The daemon answers on its local transport. */
  daemonRunning(): Promise<boolean>;
  /** The relay URL this computer uses, or null for local only. */
  relayUrl(): Promise<string | null>;
  /** GET <url>/health answered 200. */
  reachable(url: string): Promise<boolean>;
  /** Something already listens on this local port. */
  portInUse(port: number): Promise<boolean>;
}

export type TCheck = { name: string; status: "ok" | "warn" | "fail"; detail: string; fix?: string };

const MIN_NODE: readonly [number, number] = [22, 12];

function nodeOk(version: string): boolean {
  const [major = 0, minor = 0] = version.replace(/^v/, "").split(".").map(Number);
  return major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1]);
}

/** The first line of a command's output, or why it failed. */
async function probe(p: IDoctorProbe, command: readonly string[]): Promise<{ ok: boolean; line: string }> {
  const r = await p.run(command);
  const line = (r.stdout || r.stderr).trim().split("\n")[0] ?? "";
  return { ok: r.code === 0, line: r.code === 127 ? "not found" : line };
}

/** Everything `agentdeck doctor` checks, in order. Never throws: a failing check is a result. */
export async function runChecks(p: IDoctorProbe, portRangeStart = 41000): Promise<TCheck[]> {
  const checks: TCheck[] = [];
  checks.push(
    nodeOk(p.nodeVersion)
      ? { name: "Node.js", status: "ok", detail: p.nodeVersion }
      : { name: "Node.js", status: "fail", detail: p.nodeVersion, fix: "Install Node.js 22.12 or newer" },
  );

  const git = await probe(p, ["git", "--version"]);
  checks.push(
    git.ok
      ? { name: "git", status: "ok", detail: git.line }
      : { name: "git", status: "fail", detail: git.line, fix: "Install git (https://git-scm.com)" },
  );
  if (git.ok && p.platform === "win32") {
    const lp = await p.run(["git", "config", "--global", "core.longpaths"]);
    checks.push(
      lp.stdout.trim() === "true"
        ? { name: "git long paths", status: "ok", detail: "core.longpaths = true" }
        : {
            name: "git long paths",
            status: "warn",
            detail: "off (worktrees still get it; your own clones don't)",
            fix: "git config --global core.longpaths true",
          },
    );
  }

  const gh = await probe(p, ["gh", "--version"]);
  if (!gh.ok) {
    checks.push({
      name: "GitHub CLI",
      status: "warn",
      detail: gh.line,
      fix: "Install gh (https://cli.github.com) to create pull requests from the phone",
    });
  } else {
    const auth = await p.run(["gh", "auth", "status"]);
    checks.push(
      auth.code === 0
        ? { name: "GitHub CLI", status: "ok", detail: gh.line }
        : { name: "GitHub CLI", status: "warn", detail: "not signed in", fix: "gh auth login" },
    );
  }

  const npx = await probe(p, [p.platform === "win32" ? "npx.cmd" : "npx", "--version"]);
  checks.push(
    npx.ok
      ? { name: "Claude Code / Codex adapters", status: "ok", detail: `npx ${npx.line}` }
      : {
          name: "Claude Code / Codex adapters",
          status: "fail",
          detail: "npx not found",
          fix: "The adapters run through npx; reinstall Node.js with npm",
        },
  );
  const gemini = await probe(p, ["gemini", "--version"]);
  checks.push(
    gemini.ok
      ? { name: "Gemini CLI", status: "ok", detail: gemini.line }
      : {
          name: "Gemini CLI",
          status: "warn",
          detail: "not installed (optional)",
          fix: "npm i -g @google/gemini-cli",
        },
  );

  const daemon = await p.daemonRunning();
  checks.push(
    daemon
      ? { name: "Daemon", status: "ok", detail: "running (its keystore unlocked)" }
      : {
          name: "Daemon",
          status: "fail",
          detail: "not running",
          fix: "agentdeck daemon, or agentdeck install",
        },
  );

  const relay = await p.relayUrl();
  if (relay === null) {
    checks.push({
      name: "Relay",
      status: "warn",
      detail: "none: phones can't reach this computer",
      fix: "agentdeck relay set <url>",
    });
  } else {
    checks.push(
      (await p.reachable(relay))
        ? { name: "Relay", status: "ok", detail: relay }
        : {
            name: "Relay",
            status: "fail",
            detail: `${relay} does not answer`,
            fix: "Check the URL and your network",
          },
    );
  }

  const busy = await p.portInUse(portRangeStart);
  checks.push(
    busy
      ? {
          name: "Worktree ports",
          status: "warn",
          detail: `${String(portRangeStart)} is taken by another program`,
          fix: "Previews skip busy ports; set AGENTDECK_PORT_RANGE to move the range",
        }
      : { name: "Worktree ports", status: "ok", detail: `${String(portRangeStart)} is free` },
  );
  return checks;
}

const SECRETS: readonly [RegExp, string][] = [
  [/(Bearer\s+)[\w.~+/-]+=*/gi, "$1[redacted]"],
  [/("(?:\w*token|\w*Token|key|secret|password|refreshToken)"\s*:\s*")[^"]*"/g, '$1[redacted]"'],
  [/\b(sk|ghp|gho|github_pat|xox[abp])_[\w-]{8,}/g, "[redacted]"],
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]"],
];

/** Log text with tokens, keys and email addresses taken out, for `doctor --bundle`. */
export function redact(text: string): string {
  return SECRETS.reduce((t, [re, to]) => t.replace(re, to), text);
}
