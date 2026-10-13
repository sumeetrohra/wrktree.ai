import { spawn, type ChildProcess } from "node:child_process";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { DaemonClient, CommandError } from "@agentdeck/cli";
import { fakeGhEntry } from "@agentdeck/fake-gh";
import type { TCommandName, TCommandResult, TDaemonEvent, TEvtFrame } from "@agentdeck/protocol";
import { relayEnvSchema, startNodeRelay, type TNodeRelay } from "@agentdeck/relay";
import type { ILogger } from "@agentdeck/shared";

export const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const CLI = join(REPO_ROOT, "apps", "cli", "dist", "main.js");
export const FIXTURES = join(REPO_ROOT, "e2e", "fixtures");

// eslint-disable-next-line no-control-regex -- reason: matching ANSI colour escapes is the point
const ANSI = /\x1b\[[0-9;]*m/g;
const stripAnsi = (s: string) => s.replace(ANSI, "");

/** Where a harness sends what a viewer of the recording should see. */
export interface ISink {
  /** Bytes for a terminal pane: `cmd` (commands typed and their output) or `events` (the watcher). */
  write(pane: "cmd" | "events", data: string): void;
  step(title: string): void;
  check(label: string, ok: boolean, detail?: string): void;
}

const nullSink: ISink = { write: () => undefined, step: () => undefined, check: () => undefined };

class CheckFailed extends Error {}

type TIds = { repoId: string; profileId: string; worktreeId: string; chatId: string };

/** The Firebase emulators `pnpm emulators` started, as relay settings. */
function firebaseEmulatorEnv(): Record<string, string> {
  const need = (k: string): string => {
    const v = process.env[k];
    if (v === undefined) throw new Error(`${k} is not set: run under \`pnpm emulators\``);
    return v;
  };
  return {
    FIREBASE_PROJECT_ID: process.env["GCLOUD_PROJECT"] ?? "demo-agentdeck",
    FIREBASE_AUTH_EMULATOR_HOST: need("FIREBASE_AUTH_EMULATOR_HOST"),
    FIRESTORE_EMULATOR_HOST: need("FIRESTORE_EMULATOR_HOST"),
    FIREBASE_STORAGE_EMULATOR_HOST: need("FIREBASE_STORAGE_EMULATOR_HOST"),
  };
}

/** Records the relay's log lines, so a test can check nothing secret was ever logged. */
function recordingLogger(lines: string[]): ILogger {
  const log = (level: string) => (obj: Record<string, unknown>, msg?: string) => {
    lines.push(JSON.stringify({ level, ...obj, msg }));
  };
  const logger: ILogger = {
    debug: log("debug"),
    info: log("info"),
    warn: log("warn"),
    error: log("error"),
    child: () => logger,
  };
  return logger;
}

/**
 * Runs the real daemon and the real `agentdeck` CLI against throwaway git repos.
 * Assertions read events through a second, in-process client of the same local transport.
 */
export class Harness {
  readonly root: string;
  readonly home: string;
  readonly src: string;
  readonly env: NodeJS.ProcessEnv;
  private daemon: ChildProcess | null = null;
  private watcher: ChildProcess | null = null;
  client!: DaemonClient;
  /** Every event the assertion client has seen, in arrival order. */
  readonly events: TEvtFrame[] = [];
  /** Arrival time (ms) of each entry in `events`. */
  readonly arrivals: number[] = [];
  private lastCursor = new Map<string, number>();
  /** Any event that did not follow its topic's previous cursor by exactly one (gap or duplicate). */
  readonly gaps: string[] = [];
  private waiters = new Set<() => void>();
  /** The local relay (Node self-host build), when the scenario needs one. */
  relay: TNodeRelay | null = null;
  readonly relayDir: string;
  readonly relayLog: string[] = [];

  private constructor(readonly sink: ISink) {
    this.root = realpathSync.native(mkdtempSync(join(tmpdir(), "agentdeck-e2e-")));
    this.home = join(this.root, "home");
    this.src = join(this.root, "src");
    this.relayDir = join(this.root, "relay");
    mkdirSync(this.src, { recursive: true });
    this.env = {
      ...process.env,
      AGENTDECK_HOME: this.home,
      AGENTDECK_DEV_AGENTS: "1",
      AGENTDECK_BROWSE_ROOTS: this.src,
      AGENTDECK_RESTART_BACKOFF_MS: "300,300,300",
      /** SEC6: must never reach an agent or a setup script. */
      AGENTDECK_SECRET_CANARY: "sk_live_e2e_canary",
      /** CI machines have no usable OS keystore; keep the identity secret in a 0600 file. */
      AGENTDECK_KEYSTORE: "file",
      /** Pull requests go to a stand-in for the GitHub CLI and the repo's local bare origin. */
      GH_BIN: fakeGhEntry,
      FORCE_COLOR: "1",
    };
    delete this.env["NO_COLOR"];
  }

  static async start(
    sink: ISink = nullSink,
    opts: {
      relay?: boolean;
      /** Point the relay at the Firebase emulators (run under `pnpm emulators`). */
      firebase?: boolean;
      webRoot?: string;
      /** Join this relay instead of starting one (a second host on the same account). */
      relayUrl?: string;
      /** The computer's name on the account. */
      hostName?: string;
      /** Show `agentdeck dev watch` in the events pane (default true). */
      watch?: boolean;
    } = {},
  ): Promise<Harness> {
    const h = new Harness(sink);
    if (opts.webRoot) h.env["AGENTDECK_WEB_ROOT"] = opts.webRoot;
    h.env["AGENTDECK_HOST_NAME"] = opts.hostName ?? "laptop";
    if (opts.relayUrl !== undefined) h.env["AGENTDECK_RELAY_URL"] = opts.relayUrl;
    else if (opts.relay || opts.firebase) await h.startRelay(opts.firebase === true);
    await h.startDaemon();
    if (opts.watch !== false) await h.startWatcher();
    return h;
  }

  // ---------- display helpers ----------

  /** Shortens ids and temp paths in what is echoed, so command lines fit the pane. */
  display(s: string): string {
    return s
      .split(this.root)
      .join("~/e2e")
      .replace(/\b(repo|prof|wt|chat|perm|turn|cmd|up)_[0-9A-Z]{22}([0-9A-Z]{4})\b/g, "$1_…$2");
  }

  private echo(line: string): void {
    this.sink.write("cmd", `\x1b[1;32m$\x1b[0m ${this.display(line)}\r\n`);
  }

  step(title: string): void {
    this.sink.step(title);
    this.sink.write("cmd", `\r\n\x1b[1;36m# ${title}\x1b[0m\r\n`);
  }

  /** A named assertion that shows up in the recording's checklist. */
  async check(label: string, fn: () => unknown): Promise<void> {
    try {
      await fn();
      this.sink.check(label, true);
    } catch (e) {
      this.sink.check(label, false, (e as Error).message);
      throw new CheckFailed(`${label}: ${(e as Error).message}`);
    }
  }

  // ---------- processes ----------

  async startRelay(firebase = false): Promise<void> {
    this.echo(
      `agentdeck-relay &   # local self-host relay, dev mode${firebase ? ", Firebase emulators" : ""}`,
    );
    this.relay = await startNodeRelay({
      port: 0,
      dataDir: this.relayDir,
      env: relayEnvSchema.parse({
        RELAY_DEV: "1",
        RELAY_DEV_SECRET: "e2e-only-secret-e2e-only-secret-e2e",
        ...(firebase ? firebaseEmulatorEnv() : {}),
      }),
      log: recordingLogger(this.relayLog),
    });
    this.env["AGENTDECK_RELAY_URL"] = this.relay.url;
  }

  get relayUrl(): string {
    const url = this.relay?.url ?? this.env["AGENTDECK_RELAY_URL"];
    if (url === undefined) throw new Error("this scenario has no relay");
    return url;
  }

  /** This host's device id on the relay. */
  async deviceId(): Promise<string> {
    const { deviceId } = await this.client.call("relay.status", {});
    if (deviceId === null) throw new Error("the daemon has no identity yet");
    return deviceId;
  }

  /** Waits until the daemon reports its relay link up. */
  async waitRelayConnected(timeoutMs = 10_000): Promise<void> {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const s = await this.client.call("relay.status", {});
      if (s.connected) return;
      if (Date.now() > end) throw new Error("daemon never connected to the relay");
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  /**
   * Starts `agentdeck <args>` and returns while it runs, so a test can act on its output
   * (e.g. read the pairing link `agentdeck pair` prints, then scan it with a phone).
   */
  cliStream(args: string[]): {
    waitFor(re: RegExp, timeoutMs?: number): Promise<RegExpExecArray>;
    done: Promise<{ code: number; out: string }>;
    kill(): void;
  } {
    this.echo(["agentdeck", ...args].join(" "));
    const child = spawn(process.execPath, [CLI, ...args], {
      env: this.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    const listeners = new Set<() => void>();
    const onData = (d: Buffer) => {
      out += d.toString();
      this.sink.write("cmd", d.toString().replace(/\n/g, "\r\n"));
      for (const l of listeners) l();
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    const done = new Promise<{ code: number; out: string }>((resolve) => {
      child.on("close", (code) => {
        resolve({ code: code ?? 1, out: stripAnsi(out) });
      });
    });
    return {
      done,
      kill: () => {
        child.kill();
      },
      waitFor: (re, timeoutMs = 15_000) =>
        new Promise((resolve, reject) => {
          const scan = () => {
            const m = re.exec(stripAnsi(out));
            if (m) {
              listeners.delete(scan);
              clearTimeout(timer);
              resolve(m);
            }
          };
          const timer = setTimeout(() => {
            listeners.delete(scan);
            reject(new Error(`CLI never printed ${String(re)}: ${stripAnsi(out)}`));
          }, timeoutMs);
          listeners.add(scan);
          scan();
        }),
    };
  }

  async startDaemon(): Promise<void> {
    this.echo("agentdeck daemon &");
    const child = spawn(process.execPath, [CLI, "daemon"], {
      env: this.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.daemon = child;
    let err = "";
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => {
        reject(new Error(`daemon did not start: ${err}`));
      }, 15_000);
      child.stdout.on("data", (d: Buffer) => {
        const s = d.toString();
        this.sink.write("cmd", this.display(s).replace(/\n/g, "\r\n"));
        if (s.includes("listening")) {
          clearTimeout(t);
          resolve();
        }
      });
      child.once("exit", (code) => {
        reject(new Error(`daemon exited (${code}): ${err}`));
      });
    });
    await this.connect();
  }

  get daemonPid(): number {
    return this.daemon!.pid!;
  }

  /** kill -9: no shutdown hooks, no flushing beyond what is already on disk. */
  async killDaemon(): Promise<void> {
    this.echo(`kill -9 ${this.daemonPid}   # the daemon, mid-turn`);
    const d = this.daemon!;
    const exited = new Promise((r) => d.once("exit", r));
    d.kill("SIGKILL");
    await exited;
    this.daemon = null;
    await new Promise((r) => setTimeout(r, 300));
  }

  /** The visible event stream: the real `agentdeck dev watch`. */
  async startWatcher(args: string[] = []): Promise<void> {
    const shown = ["agentdeck", "dev", "watch", ...args].join(" ");
    this.sink.write("events", `\x1b[1;32m$\x1b[0m ${this.display(shown)}\r\n`);
    const child = spawn(process.execPath, [CLI, "dev", "watch", ...args], {
      env: this.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.watcher = child;
    child.stdout.on("data", (d: Buffer) => {
      this.sink.write("events", d.toString().replace(/\n/g, "\r\n"));
    });
    child.stderr.on("data", (d: Buffer) => {
      this.sink.write("events", d.toString().replace(/\n/g, "\r\n"));
    });
    await new Promise((r) => setTimeout(r, 400));
  }

  async stopWatcher(): Promise<void> {
    const w = this.watcher;
    if (w?.exitCode !== null) return;
    const exited = new Promise((r) => w.once("exit", r));
    w.kill();
    await exited;
    this.sink.write("events", "\x1b[90m(watcher stopped)\x1b[0m\r\n");
  }

  /** (Re)connects the assertion client, resuming every topic from the last cursor it saw. */
  async connect(): Promise<void> {
    this.client = await DaemonClient.connect(this.home);
    this.client.onEvent((e) => {
      const last = this.lastCursor.get(e.topic) ?? 0;
      if (e.cursor !== last + 1) this.gaps.push(`${e.topic}: ${last} → ${e.cursor}`);
      this.lastCursor.set(e.topic, e.cursor);
      this.events.push(e);
      this.arrivals.push(Date.now());
      for (const w of this.waiters) w();
    });
    const cursors: Record<string, number> = { global: 0, "repo:*": 0, "chat:*": 0 };
    for (const [t, c] of this.lastCursor) cursors[t] = c;
    await this.client.hello(cursors, "e2e-assertions");
  }

  async stop(): Promise<void> {
    try {
      this.client.close();
    } catch {
      // already closed
    }
    this.watcher?.kill();
    if (this.daemon) {
      const d = this.daemon;
      const exited = new Promise((r) => d.once("exit", r));
      d.kill("SIGTERM");
      await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
      d.kill("SIGKILL");
    }
    await this.relay?.close();
    for (let i = 0; i < 5; i++) {
      try {
        rmSync(this.root, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  }

  // ---------- CLI ----------

  /** Runs `agentdeck <args>` as a child process, echoing the command and its output to the cmd pane. */
  async cli(
    args: string[],
    opts: { show?: string } = {},
  ): Promise<{ code: number; out: string; stdout: string }> {
    this.echo(opts.show ?? ["agentdeck", ...args.map((a) => (/[\s{"']/.test(a) ? `'${a}'` : a))].join(" "));
    const child = spawn(process.execPath, [CLI, ...args], {
      env: this.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let stdout = "";
    const onData = (d: Buffer) => {
      out += d.toString();
      this.sink.write("cmd", d.toString().replace(/\n/g, "\r\n"));
    };
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
      onData(d);
    });
    child.stderr.on("data", onData);
    const code = await new Promise<number>((r) =>
      child.on("close", (c) => {
        r(c ?? 1);
      }),
    );
    return { code, out: stripAnsi(out), stdout: stripAnsi(stdout) };
  }

  /** `agentdeck dev send <name> '<args>'`; returns the parsed reply or throws CommandError. */
  async send<N extends TCommandName>(
    name: N,
    args: unknown,
    opts: { cmdId?: string; quiet?: boolean } = {},
  ): Promise<TCommandResult<N>> {
    const cliArgs = ["dev", "send", name, JSON.stringify(args)];
    if (opts.cmdId) cliArgs.push("--cmd-id", opts.cmdId);
    const { code, out, stdout } = await this.cli(cliArgs);
    if (code !== 0) {
      const m = /^error (\w+): (.*)$/m.exec(out);
      if (m) throw new CommandError({ code: m[1] as never, message: m[2]!, retryable: false });
      throw new Error(`agentdeck dev send ${name} failed: ${out}`);
    }
    return JSON.parse(stdout) as TCommandResult<N>;
  }

  /** Sends a command that must fail; returns the error code. */
  async sendError(name: TCommandName, args: unknown): Promise<string> {
    try {
      await this.send(name, args);
    } catch (e) {
      if (e instanceof CommandError) return e.error.code;
      throw e;
    }
    throw new Error(`${name} unexpectedly succeeded`);
  }

  // ---------- waiting on events ----------

  /** Resolves with the first event (from `since` on) matching `pred`. */
  waitFor<T extends TDaemonEvent>(
    pred: (e: TDaemonEvent, f: TEvtFrame) => e is T,
    what: string,
    opts?: { since?: number; timeoutMs?: number },
  ): Promise<T>;
  waitFor(
    pred: (e: TDaemonEvent, f: TEvtFrame) => boolean,
    what: string,
    opts?: { since?: number; timeoutMs?: number },
  ): Promise<TDaemonEvent>;
  waitFor(
    pred: (e: TDaemonEvent, f: TEvtFrame) => boolean,
    what: string,
    opts: { since?: number; timeoutMs?: number } = {},
  ) {
    const since = opts.since ?? 0;
    return new Promise<TDaemonEvent>((resolve, reject) => {
      let i = since;
      const scan = () => {
        for (; i < this.events.length; i++) {
          const f = this.events[i]!;
          if (pred(f.event, f)) {
            this.waiters.delete(scan);
            clearTimeout(timer);
            resolve(f.event);
            return;
          }
        }
      };
      const timer = setTimeout(() => {
        this.waiters.delete(scan);
        reject(new Error(`timed out waiting for ${what}`));
      }, opts.timeoutMs ?? 20_000);
      this.waiters.add(scan);
      scan();
    });
  }

  /** Index to pass as `since` so a wait only considers events from now on. */
  mark(): number {
    return this.events.length;
  }

  waitStatus(chatId: string, status: string, since = 0, timeoutMs?: number) {
    return this.waitFor(
      (e) => e.type === "chat.status" && e.chatId === chatId && e.status === status,
      `chat ${status}`,
      { since, ...(timeoutMs ? { timeoutMs } : {}) },
    );
  }

  /** Waits until the chat's latest status is `status` (not just any past event). */
  waitSettled(chatId: string, status = "idle", timeoutMs = 20_000): Promise<void> {
    const latest = () => {
      for (let i = this.events.length - 1; i >= 0; i--) {
        const e = this.events[i]!.event;
        if (e.type === "chat.status" && e.chatId === chatId) return e.status;
      }
      return null;
    };
    return new Promise((resolve, reject) => {
      const scan = () => {
        if (latest() === status) {
          this.waiters.delete(scan);
          clearTimeout(timer);
          resolve();
        }
      };
      const timer = setTimeout(() => {
        this.waiters.delete(scan);
        reject(new Error(`timed out waiting for chat to settle at ${status} (is ${latest()})`));
      }, timeoutMs);
      this.waiters.add(scan);
      scan();
    });
  }

  /** Text of a chat's agent messages since `since`, with streaming patches applied. */
  agentText(chatId: string, since = 0): string {
    const texts = new Map<string, string>();
    for (const f of this.events.slice(since)) {
      const e = f.event;
      if (e.type === "chat.item" && e.chatId === chatId && e.item.kind === "agent_text")
        texts.set(e.item.id, e.item.text);
      if (
        e.type === "chat.itemPatch" &&
        e.chatId === chatId &&
        texts.has(e.itemId) &&
        typeof e.patch.text === "string"
      ) {
        texts.set(e.itemId, e.patch.text);
      }
    }
    return [...texts.values()].join("");
  }

  waitText(chatId: string, needle: string, since = 0, timeoutMs?: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const scan = () => {
        if (this.agentText(chatId, since).includes(needle)) {
          this.waiters.delete(scan);
          clearTimeout(timer);
          resolve();
        }
      };
      const timer = setTimeout(() => {
        this.waiters.delete(scan);
        reject(
          new Error(`timed out waiting for agent text "${needle}"; got "${this.agentText(chatId, since)}"`),
        );
      }, timeoutMs ?? 20_000);
      this.waiters.add(scan);
      scan();
    });
  }

  systemText(chatId: string, since = 0): string[] {
    return this.events
      .slice(since)
      .map((f) => f.event)
      .flatMap((e) =>
        e.type === "chat.item" && e.chatId === chatId && e.item.kind === "system" ? [e.item.text] : [],
      );
  }

  // ---------- fixtures ----------

  /** A git repo under the browse root with a README, some code and an `.agentdeck/config.json`. */
  /** Where `makeRepo(name, …, { origin: true })` keeps the repo's bare `origin`. */
  origin(name: string): string {
    return join(this.root, "origins", `${name}.git`);
  }

  makeRepo(
    name: string,
    config: { setup?: string[]; teardown?: string[]; scripts?: Record<string, string> } = {},
    opts: { origin?: boolean; files?: Record<string, string> } = {},
  ): string {
    const dir = join(this.src, name);
    mkdirSync(join(dir, "src"), { recursive: true });
    mkdirSync(join(dir, ".agentdeck"));
    writeFileSync(join(dir, "README.md"), `# ${name}\n\nDemo app for the Agentdeck end-to-end tests.\n`);
    writeFileSync(
      join(dir, "src", "app.ts"),
      "export function login(user: string) {\n  return user.length > 0;\n}\n",
    );
    writeFileSync(join(dir, ".gitignore"), ".setup-ran\nnode_modules/\n");
    writeFileSync(join(dir, ".agentdeck", "config.json"), JSON.stringify(config, null, 2));
    for (const [rel, text] of Object.entries(opts.files ?? {})) writeFileSync(join(dir, rel), text);
    const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, stdio: "ignore" });
    git("init", "-q", "-b", "main");
    git("config", "user.email", "e2e@agentdeck.dev");
    git("config", "user.name", "E2E");
    git("config", "commit.gpgsign", "false");
    git("add", "-A");
    git("commit", "-q", "-m", "Initial commit");
    if (opts.origin) {
      const origin = this.origin(name);
      mkdirSync(origin, { recursive: true });
      execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin], { stdio: "ignore" });
      git("remote", "add", "origin", origin);
      git("push", "-q", "origin", "main");
    }
    return dir;
  }

  /** `agentdeck profile add fake --name <name>`: creates the profile and runs its login. */
  async addProfile(name: string): Promise<string> {
    const { code, out } = await this.cli(["profile", "add", "fake", "--name", name]);
    if (code !== 0) throw new Error(`profile add failed: ${out}`);
    const id = /(prof_[0-9A-Z]{26})/.exec(out)?.[1];
    if (!id) throw new Error(`no profile id in: ${out}`);
    return id;
  }

  async waitReady(worktreeId: string, since = 0) {
    const e = await this.waitFor(
      (e) =>
        e.type === "worktree.updated" &&
        e.worktree.id === worktreeId &&
        (e.worktree.status === "ready" || e.worktree.status === "setup_failed"),
      "worktree setup",
      { since },
    );
    return (e as Extract<TDaemonEvent, { type: "worktree.updated" }>).worktree;
  }

  /** Repo + logged-in profile + ready worktree + idle chat, the common starting point. */
  async quickstart(repoName = "shop"): Promise<TIds> {
    const repoPath = this.makeRepo(repoName);
    const repo = await this.send("repo.add", { path: repoPath });
    const profileId = await this.addProfile("Personal");
    const since = this.mark();
    const wt = await this.send("worktree.create", {
      repoId: repo.id,
      branch: "agent-task",
      title: "Agent task",
    });
    await this.waitReady(wt.id, since);
    const s2 = this.mark();
    const chat = await this.send("chat.create", { worktreeId: wt.id, agent: "fake", profileId });
    await this.waitStatus(chat.id, "idle", s2);
    return { repoId: repo.id, profileId, worktreeId: wt.id, chatId: chat.id };
  }

  wtPath(worktreeId: string): string {
    const e = [...this.events]
      .reverse()
      .find((f) => f.event.type === "worktree.updated" && f.event.worktree.id === worktreeId);
    if (e?.event.type !== "worktree.updated") throw new Error(`unknown worktree ${worktreeId}`);
    return e.event.worktree.path;
  }

  readWt(worktreeId: string, rel: string): string | null {
    const p = join(this.wtPath(worktreeId), rel);
    return existsSync(p) ? readFileSync(p, "utf8") : null;
  }

  /** Lets the viewer catch up with what just happened before the next step. */
  pause(ms = 600): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
