import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pino } from "pino";
import { AgentdeckError } from "@agentdeck/protocol";
import { newId, type Logger } from "@agentdeck/shared";
import { EventBus } from "./bus.js";
import type { Ctx, DaemonOptions } from "./context.js";
import { openDb } from "./db/index.js";
import { BlobStore } from "./modules/blobs.js";
import { FileJail } from "./modules/files.js";
import { Git } from "./modules/git.js";
import { Profiles } from "./modules/profiles.js";
import { Repos } from "./modules/repos.js";
import { AgentRegistry } from "./modules/sessions/agents.js";
import { SessionManager } from "./modules/sessions/manager.js";
import { Worktrees } from "./modules/worktrees.js";
import { pathsFor } from "./paths.js";
import { Router } from "./router.js";
import { LocalTransport } from "./transports/local.js";

export const DAEMON_VERSION = "0.1.0";

export type { DaemonOptions } from "./context.js";
export { defaultHome, pathsFor } from "./paths.js";

export function optionsFromEnv(home: string): DaemonOptions {
  const env = process.env;
  return {
    home,
    browseRoots: env.AGENTDECK_BROWSE_ROOTS
      ? env.AGENTDECK_BROWSE_ROOTS.split(process.platform === "win32" ? ";" : ":")
      : [homedir()],
    portRange: env.AGENTDECK_PORT_RANGE
      ? (env.AGENTDECK_PORT_RANGE.split("-").map(Number) as [number, number])
      : [41000, 41999],
    devAgents: env.AGENTDECK_DEV_AGENTS === "1",
    restartBackoffMs: env.AGENTDECK_RESTART_BACKOFF_MS
      ? env.AGENTDECK_RESTART_BACKOFF_MS.split(",").map(Number)
      : [1000, 4000, 15000],
    patchIntervalMs: 50,
  };
}

/** The daemon: modules behind one command router, reachable through the local transport. */
export class Daemon {
  readonly ctx: Ctx;
  readonly router: Router;
  readonly repos: Repos;
  readonly profiles: Profiles;
  readonly worktrees: Worktrees;
  readonly sessions: SessionManager;
  readonly blobs: BlobStore;
  readonly git: Git;
  private transport: LocalTransport | null = null;
  port = 0;

  constructor(opts: DaemonOptions, log?: Logger) {
    const paths = pathsFor(opts.home);
    for (const d of [paths.home, paths.events, paths.blobs, paths.profiles, paths.shared, paths.logs]) {
      mkdirSync(d, { recursive: true });
    }
    const logger = log ?? (pino({ base: { daemon: DAEMON_VERSION } }) as unknown as Logger);
    const db = openDb(paths.db);
    this.ctx = { db, bus: new EventBus(paths.events, db), paths, log: logger, opts };
    this.router = new Router(db, logger);
    this.blobs = new BlobStore(paths.blobs);
    this.git = new Git(this.blobs);
    const agents = new AgentRegistry(opts.devAgents);
    this.repos = new Repos(this.ctx);
    this.profiles = new Profiles(this.ctx, agents);
    this.worktrees = new Worktrees(this.ctx, this.repos);
    this.sessions = new SessionManager(this.ctx, {
      profiles: this.profiles,
      worktrees: this.worktrees,
      blobs: this.blobs,
      jailFor: (id) => this.jailFor(id),
    });
    this.worktrees.hooks = {
      stopChats: (id) => this.sessions.stopWorktree(id),
      startChats: (id) => this.sessions.startWorktree(id),
      deleteChats: (id) => this.sessions.deleteWorktreeChats(id),
    };
    this.registerHandlers();
  }

  jailFor(worktreeId: string): FileJail {
    const wt = this.worktrees.get(worktreeId);
    if (!existsSync(wt.path)) throw new AgentdeckError("NOT_FOUND", `Worktree folder is missing: ${wt.path}`);
    return new FileJail(wt.path, this.repos.hiddenGlobs(this.repos.get(wt.repoId)));
  }

  private registerHandlers(): void {
    const { repos, profiles, worktrees, sessions, blobs, git } = this;
    const daemonId = newId("dev");
    this.router.register({
      "sync.hello": (args, ctx) => {
        const topics: Record<string, number> = {};
        for (const pattern of Object.keys(args.cursors)) {
          const list = pattern.endsWith(":*") ? this.ctx.bus.topics(pattern) : [pattern];
          for (const t of list) topics[t] = this.ctx.bus.cursor(t);
        }
        ctx.afterReply(() => ctx.subscribe(args.cursors));
        return { daemonId, daemonVersion: DAEMON_VERSION, topics };
      },
      "repo.list": () => repos.list(),
      "repo.add": (a) => repos.add(a.path),
      "repo.remove": (a) => (repos.remove(a.repoId), {}),
      "fs.browse": (a) => repos.browse(a.path),

      "profile.list": (a) => profiles.list(a.agent),
      "profile.create": (a) => profiles.create(a.agent, a.name, a.color),
      "profile.remove": (a) => (profiles.remove(a.profileId), {}),
      "profile.loginStatus": (a) => profiles.loginStatus(a.profileId),
      "profile.loginCommand": (a) => profiles.loginCommand(a.profileId),

      "worktree.list": (a) => worktrees.list(a.repoId),
      "worktree.create": (a) => worktrees.create(a),
      "worktree.archive": (a) => worktrees.archive(a.worktreeId),
      "worktree.restore": (a) => worktrees.restore(a.worktreeId),
      "worktree.delete": async (a) => (await worktrees.delete(a.worktreeId), {}),

      "chat.list": (a) => sessions.list(a.worktreeId),
      "chat.create": (a) => sessions.create(a),
      "chat.send": (a) => sessions.send(a.chatId, a.text, a.attachments),
      "chat.cancel": async (a) => (await sessions.cancel(a.chatId), {}),
      "chat.retry": (a) => sessions.retry(a.chatId),
      "permission.respond": (a) => (sessions.respond(a.chatId, a.requestId, a.decision, a.message), {}),

      "diff.summary": (a) => git.summary(worktrees.get(a.worktreeId), this.jailFor(a.worktreeId), a.against),
      "diff.file": async (a) => ({
        blob: await git.fileDiff(worktrees.get(a.worktreeId), this.jailFor(a.worktreeId), a.path, a.against),
      }),
      "fs.tree": (a) => ({ entries: this.jailFor(a.worktreeId).tree(a.path) }),
      "fs.read": (a) => this.jailFor(a.worktreeId).read(a.path, a.offset, a.length),
      "fs.search": (a) => {
        const wt = worktrees.get(a.worktreeId);
        return this.jailFor(a.worktreeId).search(a.query, repos.hiddenGlobs(repos.get(wt.repoId)));
      },

      "blob.put": (a, ctx) => {
        const bytes = ctx.takeUpload(a.uploadId);
        if (!bytes) throw new AgentdeckError("NOT_FOUND", `No completed upload ${a.uploadId}`);
        if (bytes.length !== a.size) {
          throw new AgentdeckError("INVALID_ARGS", `Upload is ${bytes.length} bytes, expected ${a.size}`);
        }
        return blobs.put(bytes, a.mime);
      },
      "blob.get": (a) => {
        const { ref, bytes } = blobs.get(a.blobId);
        return { blob: ref, base64: bytes.toString("base64") };
      },
    });
  }

  /** Starts the local transport and resumes chats. `port` 0 picks a free port. */
  async start(port = 0): Promise<number> {
    this.transport = new LocalTransport(this.ctx.bus, this.router, this.ctx.log, DAEMON_VERSION);
    this.port = await this.transport.listen(port);
    const { paths } = this.ctx;
    writeFileSync(paths.localToken, this.transport.token, { mode: 0o600 });
    if (process.platform !== "win32") chmodSync(paths.localToken, 0o600);
    writeFileSync(
      paths.daemonJson,
      JSON.stringify({ pid: process.pid, port: this.port, version: DAEMON_VERSION, startedAt: Date.now() }),
    );
    this.sessions.boot();
    this.ctx.log.info({ port: this.port, home: paths.home }, "daemon listening");
    return this.port;
  }

  async stop(): Promise<void> {
    this.sessions.shutdown();
    await this.worktrees.idle();
    await this.transport?.close();
    rmSync(this.ctx.paths.daemonJson, { force: true });
    this.ctx.db.close();
  }
}

export const logFile = (home: string) =>
  join(pathsFor(home).logs, `daemon-${new Date().toISOString().slice(0, 10)}.jsonl`);
export { runDaemon } from "./run.js";
