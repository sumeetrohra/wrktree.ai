import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";

import { AgentdeckError } from "@agentdeck/protocol";
import { newId, now, tryParseJson, type ILogger } from "@agentdeck/shared";

import { EventBus } from "#src/infra/bus/index.js";
import { openDb } from "#src/infra/db/index.js";
import { loadIdentity } from "#src/infra/keystore/index.js";
import { Router } from "#src/infra/rpc/index.js";
import type { TRuntime } from "#src/infra/runtime/index.js";
import { LocalTransport } from "#src/infra/transport/index.js";
import { AgentRegistry } from "#src/modules/agents/index.js";
import { BlobStore } from "#src/modules/blobs/index.js";
import { CloudSync } from "#src/modules/cloud/index.js";
import { DevicesService } from "#src/modules/devices/index.js";
import { FileJail } from "#src/modules/files/index.js";
import { GitService } from "#src/modules/git/index.js";
import { ProfilesService } from "#src/modules/profiles/index.js";
import { ReposService } from "#src/modules/repos/index.js";
import { SessionManager } from "#src/modules/sessions/index.js";
import { WorktreesService } from "#src/modules/worktrees/index.js";
import { daemonConfigSchema, type TDaemonConfig } from "#src/shared/config.schema.js";
import type { TDaemonOptions } from "#src/shared/daemon-options.types.js";
import { readDaemonEnv } from "#src/shared/env.schema.js";
import { pathsFor } from "#src/shared/paths.utils.js";
import { DAEMON_VERSION } from "#src/shared/version.constants.js";

import type { TModules } from "./app.types.js";
import { cloudStoreFor } from "./cloud-store.utils.js";
import { createHandlers } from "./handlers/index.js";
import { Remote } from "./remote.service.js";

const DEFAULT_PORT_RANGE: readonly [number, number] = [41000, 41999];
const DEFAULT_BACKOFF_MS: readonly number[] = [1000, 4000, 15000];

function portRange(raw: string | undefined): readonly [number, number] {
  if (raw === undefined) return DEFAULT_PORT_RANGE;
  const [lo, hi] = raw.split("-").map(Number);
  if (lo === undefined || hi === undefined || lo > hi) {
    throw new Error(`AGENTDECK_PORT_RANGE must look like 41000-41999, got ${raw}`);
  }
  return [lo, hi];
}

const DEFAULT_APP_URL = "https://app.agentdeck.dev";

function configOf(home: string): TDaemonConfig | null {
  const file = pathsFor(home).config;
  if (!existsSync(file)) return null;
  return tryParseJson(daemonConfigSchema, readFileSync(file, "utf8")) ?? null;
}

export function optionsFromEnv(home: string): TDaemonOptions {
  const env = readDaemonEnv();
  return {
    home,
    browseRoots: env.AGENTDECK_BROWSE_ROOTS
      ? env.AGENTDECK_BROWSE_ROOTS.split(process.platform === "win32" ? ";" : ":")
      : [homedir()],
    portRange: portRange(env.AGENTDECK_PORT_RANGE),
    devAgents: env.AGENTDECK_DEV_AGENTS === "1",
    restartBackoffMs: env.AGENTDECK_RESTART_BACKOFF_MS
      ? env.AGENTDECK_RESTART_BACKOFF_MS.split(",").map(Number)
      : DEFAULT_BACKOFF_MS,
    patchIntervalMs: 50,
    devOrigins: env.AGENTDECK_DEV_ORIGINS ? env.AGENTDECK_DEV_ORIGINS.split(",").map((o) => o.trim()) : [],
    relayUrl: env.AGENTDECK_RELAY_URL ?? configOf(home)?.relayUrl ?? null,
    hostName: env.AGENTDECK_HOST_NAME ?? hostname(),
    appUrl: env.AGENTDECK_APP_URL ?? configOf(home)?.appUrl ?? DEFAULT_APP_URL,
    keystore: env.AGENTDECK_KEYSTORE ?? "os",
    webRoot: env.AGENTDECK_WEB_ROOT ?? null,
  };
}

/** Composition root: builds infra, wires modules through their ports, registers handlers. */
export class Daemon {
  readonly rt: TRuntime;
  readonly modules: TModules;
  private readonly router: Router;
  private transport: LocalTransport | null = null;
  private readonly cloud: CloudSync;
  port = 0;

  constructor(opts: TDaemonOptions, log: ILogger) {
    const paths = pathsFor(opts.home);
    // The home folder holds the token and every chat transcript: owner-only (SEC3).
    mkdirSync(paths.home, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") chmodSync(paths.home, 0o700);
    for (const d of [paths.events, paths.blobs, paths.profiles, paths.shared, paths.logs]) {
      mkdirSync(d, { recursive: true });
    }
    const db = openDb(paths.db);
    this.rt = { db, bus: new EventBus(paths.events, db), paths, log, opts };

    const agents = new AgentRegistry(opts.devAgents);
    const repos = new ReposService(this.rt);
    const profiles = new ProfilesService(this.rt, agents);
    const worktrees = new WorktreesService(this.rt, repos);
    const blobs = new BlobStore(paths.blobs);
    const jailFor = (worktreeId: string): FileJail => {
      const wt = worktrees.get(worktreeId);
      if (!existsSync(wt.path))
        throw new AgentdeckError("NOT_FOUND", `Worktree folder is missing: ${wt.path}`);
      return new FileJail(wt.path, repos.hiddenGlobs(repos.get(wt.repoId)));
    };
    const sessions = new SessionManager(this.rt, {
      profiles,
      worktrees,
      blobs,
      files: {
        filesFor: (worktreeId) => {
          const jail = jailFor(worktreeId);
          return {
            read: (path, line, limit) => jail.agentRead(path, line, limit),
            write: (path, content) => jail.agentWrite(path, content),
          };
        },
      },
    });
    worktrees.hooks = {
      stopChats: (id) => {
        sessions.stopWorktree(id);
      },
      startChats: (id) => {
        sessions.startWorktree(id);
      },
      deleteChats: (id) => {
        sessions.deleteWorktreeChats(id);
      },
    };
    const devices = new DevicesService(this.rt);
    const remote = new Remote(opts.relayUrl, opts.hostName, opts.appUrl, paths.relayToken, devices, log);
    this.cloud = new CloudSync(
      this.rt,
      {
        repoIds: () => repos.list().map((r) => r.id),
        worktrees: () => worktrees.all(),
        worktree: (id) => {
          try {
            return worktrees.get(id);
          } catch {
            return null;
          }
        },
        repoName: (repoId) => {
          try {
            return repos.get(repoId).name;
          } catch {
            return repoId;
          }
        },
        chats: (worktreeId) => sessions.list(worktreeId),
        chat: (id) => {
          try {
            return sessions.get(id);
          } catch {
            return null;
          }
        },
        profileName: (id) => {
          try {
            return profiles.get(id).name;
          } catch {
            return null;
          }
        },
        blob: (blobId) => {
          try {
            const b = blobs.get(blobId);
            return { bytes: b.bytes, mime: b.ref.mime };
          } catch {
            return null;
          }
        },
      },
      cloudStoreFor(remote),
    );
    this.modules = {
      daemonId: newId("dev"),
      devices,
      remote,
      webLink: () => this.transport?.webLink() ?? null,
      bus: this.rt.bus,
      repos,
      profiles,
      worktrees,
      sessions,
      blobs,
      git: new GitService(blobs),
      jailFor,
    };
    this.router = new Router(db, createHandlers(this.modules), log);
  }

  /** Starts the local transport and resumes chats. `port` 0 picks a free port. */
  async start(port = 0): Promise<number> {
    this.transport = new LocalTransport(
      this.rt.bus,
      this.router,
      this.rt.log,
      DAEMON_VERSION,
      this.rt.opts.devOrigins,
      this.rt.opts.webRoot,
    );
    this.port = await this.transport.listen(port);
    const { paths } = this.rt;
    rmSync(paths.localToken, { force: true });
    writeFileSync(paths.localToken, this.transport.token, { mode: 0o600, flag: "wx" });
    writeFileSync(
      paths.daemonJson,
      JSON.stringify({ pid: process.pid, port: this.port, version: DAEMON_VERSION, startedAt: now() }),
    );
    const { identity, vault } = await loadIdentity(
      { identity: paths.identity, secretFile: paths.identitySecret },
      this.rt.opts.keystore,
      this.rt.log,
    );
    this.modules.remote.start(identity, vault, this.rt.bus, this.router);
    this.cloud.start();
    this.modules.sessions.boot();
    this.rt.log.info({ port: this.port }, "daemon listening");
    return this.port;
  }

  async stop(): Promise<void> {
    this.cloud.stop();
    this.modules.remote.stop();
    this.modules.sessions.shutdown();
    await this.modules.worktrees.idle();
    await this.transport?.close();
    this.router.close();
    rmSync(this.rt.paths.daemonJson, { force: true });
    this.rt.db.close();
  }
}
