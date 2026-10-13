import { AgentdeckError, type TDaemonEvent } from "@agentdeck/protocol";

import type { EventBus } from "#src/infra/bus/index.js";

import type { IPreviewDeps } from "./preview.types.js";

/** How long a dev server may take to start listening. */
const START_MS = 90_000;
/** Remote clients reach the daemon over the relay as `relay-<deviceId>`. */
const RELAY_CLIENT = "relay-";

type TPreview = { procId: string; port: number; tokens: Set<string> };
type TPreviewStatus = Extract<TDaemonEvent, { type: "preview.status" }>["status"];

/**
 * Preview (Phase 3c): runs the repo's preview script in a worktree (its output is in Logs), waits
 * for it to listen on the worktree's port, and hands out a URL: `localhost` on this computer, or a
 * relay tunnel that only the asking device can open. Tokens map to the worktree's port only.
 */
export class PreviewService {
  private readonly previews = new Map<string, TPreview>();

  constructor(
    private readonly bus: EventBus,
    private readonly deps: IPreviewDeps,
  ) {}

  private publish(worktreeId: string, status: TPreviewStatus): void {
    const wt = this.deps.worktree(worktreeId);
    this.bus.publish(`repo:${wt.repoId}`, { type: "preview.status", worktreeId, status });
  }

  /** `clientId` is the calling connection: a local client, or `relay-<deviceId>`. */
  async start(
    worktreeId: string,
    clientId: string,
  ): Promise<{ url: string; key: string | null; expiresAt: number | null }> {
    const wt = this.deps.worktree(worktreeId);
    const config = this.deps.config(wt);
    if (!config) {
      throw new AgentdeckError(
        "BAD_STATE",
        'This repo has no preview. Add "preview": {"script": "dev"} to .agentdeck/config.json',
      );
    }
    if (wt.port === null) throw new AgentdeckError("BAD_STATE", "This worktree has no port");
    const port = wt.port;
    let proc = this.deps.procs.running(worktreeId, config.script);
    if (!proc) {
      // Something else on the port would be previewed instead of this worktree's app.
      if (await this.deps.waitForPort(port, 0, () => false)) {
        throw new AgentdeckError(
          "CONFLICT",
          `Port ${String(port)} is already in use by another program; stop it and try again`,
        );
      }
      proc = this.deps.procs.start(worktreeId, config.script, { ...config.env, AGENTDECK_PREVIEW: "1" });
    }
    const procId = proc.id;
    const preview = this.previews.get(worktreeId);
    const current: TPreview =
      preview?.procId === procId ? preview : { procId, port, tokens: preview?.tokens ?? new Set() };
    this.previews.set(worktreeId, current);
    this.publish(worktreeId, "starting");
    const exited = (): boolean => !this.running(procId);
    if (!(await this.deps.waitForPort(port, START_MS, exited))) {
      this.publish(worktreeId, "crashed");
      throw new AgentdeckError(
        "BAD_STATE",
        exited()
          ? `The preview script "${config.script}" exited; see Logs`
          : `Nothing is listening on port ${String(port)}; does "${config.script}" use $PORT?`,
      );
    }
    this.publish(worktreeId, "ready");
    if (!clientId.startsWith(RELAY_CLIENT)) {
      return { url: `http://localhost:${String(port)}/`, key: null, expiresAt: null };
    }
    const opened = await this.deps.tunnel.open(worktreeId, clientId.slice(RELAY_CLIENT.length));
    current.tokens.add(opened.token);
    return { url: opened.url, key: opened.key, expiresAt: opened.expiresAt };
  }

  private running(procId: string): boolean {
    try {
      return this.deps.procs.proc(procId).status === "running";
    } catch {
      return false; // pruned long ago
    }
  }

  /** The port a tunnel token reaches, while its preview is open and its script running. */
  portOf(token: string): number | null {
    for (const p of this.previews.values()) {
      if (p.tokens.has(token)) return p.port;
    }
    return null;
  }

  /** Closes the worktree's tunnels and stops its preview script (also on archive and delete). */
  async stop(worktreeId: string): Promise<void> {
    const p = this.previews.get(worktreeId);
    if (!p) return;
    this.previews.delete(worktreeId);
    // The script first: closing the tunnels waits on the relay, and a stopping daemon may not.
    if (this.running(p.procId)) await this.deps.procs.stop(p.procId);
    await Promise.all([...p.tokens].map((t) => this.deps.tunnel.close(t)));
    this.publish(worktreeId, "stopped");
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.previews.keys()].map((id) => this.stop(id)));
  }
}
