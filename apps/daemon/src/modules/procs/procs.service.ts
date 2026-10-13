import { AgentdeckError, type TBlobRef, type TProc } from "@agentdeck/protocol";
import { newId, now } from "@agentdeck/shared";

import { childEnv, killTree, spawnShell, type ChildProcess } from "#src/infra/process/index.js";
import type { TRuntime } from "#src/infra/runtime/index.js";

import type { IProcSource } from "./procs.types.js";

/** What `proc.output` hands back: the newest megabyte of a process's output. */
const RING_BYTES = 1024 * 1024;
/** Coalescing window for `proc.output` events, and the most one event carries. */
const FLUSH_MS = 100;
const MAX_CHUNK = 64 * 1024;
/** Ended processes kept per worktree, so a client can still read their output. */
const KEEP_ENDED = 10;
const STOP_WAIT_MS = 5000;

type TLive = {
  proc: TProc;
  repoId: string;
  child: ChildProcess | null;
  ring: string;
  pending: { stdout: string; stderr: string };
  timer: NodeJS.Timeout | null;
  stopping: boolean;
  closed: Promise<void>;
};

/**
 * A repo's named scripts (`.agentdeck/config.json` `scripts`) running in a worktree: only names the
 * repo declares can start (SEC), each in its own process group with the worktree's preview port as
 * `PORT`. Output streams on `proc:<id>` (coalesced) and the newest megabyte stays readable.
 */
export class ProcsService {
  private readonly procs = new Map<string, TLive>();

  constructor(
    private readonly rt: TRuntime,
    private readonly source: IProcSource,
    private readonly blobs: { put(bytes: Buffer, mime: string): TBlobRef },
  ) {}

  list(worktreeId: string): { scripts: string[]; procs: TProc[] } {
    const wt = this.source.worktree(worktreeId);
    return {
      scripts: Object.keys(this.source.config(wt).scripts).sort(),
      procs: this.of(worktreeId).map((l) => l.proc),
    };
  }

  private of(worktreeId: string): TLive[] {
    return [...this.procs.values()].filter((l) => l.proc.worktreeId === worktreeId);
  }

  start(worktreeId: string, script: string): TProc {
    const wt = this.source.worktree(worktreeId);
    if (wt.status !== "ready") throw new AgentdeckError("BAD_STATE", `The worktree is ${wt.status}`);
    const config = this.source.config(wt);
    const command = Object.hasOwn(config.scripts, script) ? config.scripts[script] : undefined;
    if (command === undefined) {
      throw new AgentdeckError("INVALID_ARGS", `No script named "${script}" in .agentdeck/config.json`);
    }
    if (this.of(worktreeId).some((l) => l.proc.script === script && l.proc.status === "running")) {
      throw new AgentdeckError("CONFLICT", `"${script}" is already running here`);
    }
    this.prune(worktreeId);
    const proc: TProc = {
      id: newId("proc"),
      worktreeId,
      script,
      status: "running",
      exitCode: null,
      startedAt: now(),
      endedAt: null,
    };
    let done = (): void => undefined;
    const live: TLive = {
      proc,
      repoId: wt.repoId,
      child: null,
      ring: "",
      pending: { stdout: "", stderr: "" },
      timer: null,
      stopping: false,
      closed: new Promise((r) => {
        done = r;
      }),
    };
    this.procs.set(proc.id, live);
    const port = String(wt.port ?? "");
    const child = spawnShell(command, {
      cwd: wt.path,
      env: childEnv({
        ...config.env,
        PORT: port,
        HOST: "127.0.0.1",
        AGENTDECK_PORT: port,
        AGENTDECK_WORKTREE: wt.path,
      }),
    });
    live.child = child;
    child.stdout?.on("data", (d: Buffer) => {
      this.append(live, "stdout", d.toString());
    });
    child.stderr?.on("data", (d: Buffer) => {
      this.append(live, "stderr", d.toString());
    });
    child.on("error", (e) => {
      this.append(live, "stderr", `[agentdeck] ${e.message}\n`);
    });
    child.on("close", (code) => {
      this.flush(live);
      live.proc = {
        ...live.proc,
        status: live.stopping ? "stopped" : code === 0 ? "exited" : "crashed",
        exitCode: code,
        endedAt: now(),
      };
      live.child = null;
      this.publishStatus(live);
      done();
    });
    this.publishStatus(live);
    this.rt.log.info({ procId: proc.id, worktreeId, script }, "script started");
    return proc;
  }

  private append(live: TLive, stream: "stdout" | "stderr", text: string): void {
    live.ring = (live.ring + text).slice(-RING_BYTES);
    live.pending[stream] += text;
    live.timer ??= setTimeout(() => {
      this.flush(live);
    }, FLUSH_MS);
  }

  private flush(live: TLive): void {
    if (live.timer) clearTimeout(live.timer);
    live.timer = null;
    for (const stream of ["stdout", "stderr"] as const) {
      const text = live.pending[stream];
      if (!text) continue;
      live.pending[stream] = "";
      const chunk =
        text.length > MAX_CHUNK
          ? `[… ${String(text.length - MAX_CHUNK)} characters skipped]\n${text.slice(-MAX_CHUNK)}`
          : text;
      this.rt.bus.publish(`proc:${live.proc.id}`, {
        type: "proc.output",
        procId: live.proc.id,
        chunk,
        stream,
      });
    }
  }

  private publishStatus(live: TLive): void {
    const event = { type: "proc.status" as const, proc: live.proc };
    this.rt.bus.publish(`proc:${live.proc.id}`, event);
    this.rt.bus.publish(`repo:${live.repoId}`, event);
  }

  private get(procId: string): TLive {
    const live = this.procs.get(procId);
    if (!live) throw new AgentdeckError("NOT_FOUND", `No process ${procId}`);
    return live;
  }

  /** Kills the script's whole process tree and waits (briefly) for it to go. */
  async stop(procId: string): Promise<TProc> {
    const live = this.get(procId);
    if (live.child) {
      live.stopping = true;
      killTree(live.child);
      await Promise.race([live.closed, new Promise((r) => setTimeout(r, STOP_WAIT_MS))]);
    }
    return live.proc;
  }

  /** The newest output and the `proc:<id>` cursor it covers (pending output is published first). */
  output(procId: string): { blob: TBlobRef; cursor: number } {
    const live = this.get(procId);
    this.flush(live);
    return {
      blob: this.blobs.put(Buffer.from(live.ring), "text/plain"),
      cursor: this.rt.bus.cursor(`proc:${procId}`),
    };
  }

  /** Every running script of a worktree (archive, delete), or of all of them (daemon stop). */
  async stopAll(worktreeId?: string): Promise<void> {
    const running = [...this.procs.values()].filter(
      (l) => l.child && (worktreeId === undefined || l.proc.worktreeId === worktreeId),
    );
    await Promise.all(running.map((l) => this.stop(l.proc.id)));
  }

  private prune(worktreeId: string): void {
    const ended = this.of(worktreeId).filter((l) => l.proc.status !== "running");
    for (const l of ended.slice(0, Math.max(0, ended.length - KEEP_ENDED + 1))) this.procs.delete(l.proc.id);
  }
}
