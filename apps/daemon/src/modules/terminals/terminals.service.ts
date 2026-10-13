import { AgentdeckError, type TBlobRef, type TTerminal } from "@agentdeck/protocol";
import { newId, now } from "@agentdeck/shared";

import { childEnv } from "#src/infra/process/index.js";
import { defaultShell, spawnPty, type IPtyProcess } from "#src/infra/pty/index.js";
import type { TRuntime } from "#src/infra/runtime/index.js";

import type { ITerminalSource } from "./terminals.types.js";

/** Scrollback `term.output` hands back. */
const SCROLLBACK_CHARS = 256 * 1024;
/** Coalescing window for `term.output` events (a typed key echoes within one). */
const FLUSH_MS = 30;
const MAX_CHUNK = 64 * 1024;
/** A terminal nobody typed in for this long is closed. */
const DEFAULT_IDLE_MS = 30 * 60 * 1000;
/** Open terminals per worktree. */
const MAX_OPEN = 4;
/** Ended terminals kept per worktree, so a client can still read their scrollback. */
const KEEP_ENDED = 4;

type TLive = {
  term: TTerminal;
  repoId: string;
  pty: IPtyProcess | null;
  scrollback: string;
  pending: string;
  flushTimer: NodeJS.Timeout | null;
  idleTimer: NodeJS.Timeout | null;
};

/**
 * Shells on pseudo-terminals in a worktree (Phase 5). Output streams on `term:<id>`, coalesced, and
 * the newest scrollback stays readable. Who may use them is the handlers' call (SEC25).
 */
export class TerminalsService {
  private readonly terms = new Map<string, TLive>();

  constructor(
    private readonly rt: TRuntime,
    private readonly source: ITerminalSource,
    private readonly blobs: { put(bytes: Buffer, mime: string): TBlobRef },
    private readonly idleMs = DEFAULT_IDLE_MS,
  ) {}

  list(worktreeId: string): TTerminal[] {
    return this.of(worktreeId).map((l) => l.term);
  }

  private of(worktreeId: string): TLive[] {
    return [...this.terms.values()].filter((l) => l.term.worktreeId === worktreeId);
  }

  async open(worktreeId: string, cols: number, rows: number): Promise<TTerminal> {
    const wt = this.source.worktree(worktreeId);
    if (wt.status !== "ready") throw new AgentdeckError("BAD_STATE", `The worktree is ${wt.status}`);
    if (this.of(worktreeId).filter((l) => l.pty !== null).length >= MAX_OPEN) {
      throw new AgentdeckError("CONFLICT", `At most ${String(MAX_OPEN)} terminals per worktree`);
    }
    const env = childEnv({ TERM: "xterm-256color", AGENTDECK_WORKTREE: wt.path });
    const pty = await spawnPty(defaultShell(env), { cwd: wt.path, env, cols, rows });
    this.prune(worktreeId);
    const live: TLive = {
      term: {
        id: newId("term"),
        worktreeId,
        status: "running",
        exitCode: null,
        cols,
        rows,
        startedAt: now(),
        endedAt: null,
      },
      repoId: wt.repoId,
      pty,
      scrollback: "",
      pending: "",
      flushTimer: null,
      idleTimer: null,
    };
    this.terms.set(live.term.id, live);
    pty.onData((d) => {
      this.append(live, d);
    });
    pty.onExit((code) => {
      this.flush(live);
      if (live.idleTimer) clearTimeout(live.idleTimer);
      live.pty = null;
      live.term = { ...live.term, status: "exited", exitCode: code, endedAt: now() };
      this.publishStatus(live);
    });
    this.touch(live);
    this.publishStatus(live);
    this.rt.log.info({ termId: live.term.id, worktreeId }, "terminal opened");
    return live.term;
  }

  input(termId: string, data: string): void {
    const { live, pty } = this.running(termId);
    this.touch(live);
    pty.write(data);
  }

  resize(termId: string, cols: number, rows: number): TTerminal {
    const { live, pty } = this.running(termId);
    pty.resize(cols, rows);
    live.term = { ...live.term, cols, rows };
    this.publishStatus(live);
    return live.term;
  }

  /** Ends the shell; resolves once it has exited (or straight away if it already had). */
  async close(termId: string): Promise<TTerminal> {
    const live = this.get(termId);
    const pty = live.pty;
    if (pty === null) return live.term;
    const exited = new Promise<void>((resolve) => {
      pty.onExit(() => {
        resolve();
      });
    });
    pty.kill();
    await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
    return live.term;
  }

  /** The newest scrollback and the `term:<id>` cursor it covers (pending output is published first). */
  output(termId: string): { blob: TBlobRef; cursor: number } {
    const live = this.get(termId);
    this.flush(live);
    return {
      blob: this.blobs.put(Buffer.from(live.scrollback), "text/plain"),
      cursor: this.rt.bus.cursor(`term:${termId}`),
    };
  }

  /** Every open terminal of a worktree (archive, delete), or of all of them (daemon stop). */
  async closeAll(worktreeId?: string): Promise<void> {
    const open = [...this.terms.values()].filter(
      (l) => l.pty !== null && (worktreeId === undefined || l.term.worktreeId === worktreeId),
    );
    await Promise.all(open.map((l) => this.close(l.term.id)));
  }

  private touch(live: TLive): void {
    if (live.idleTimer) clearTimeout(live.idleTimer);
    live.idleTimer = setTimeout(() => {
      this.rt.log.info({ termId: live.term.id }, "terminal idle, closing");
      void this.close(live.term.id);
    }, this.idleMs);
    live.idleTimer.unref();
  }

  private append(live: TLive, data: string): void {
    live.scrollback = (live.scrollback + data).slice(-SCROLLBACK_CHARS);
    live.pending += data;
    live.flushTimer ??= setTimeout(() => {
      this.flush(live);
    }, FLUSH_MS);
  }

  private flush(live: TLive): void {
    if (live.flushTimer) clearTimeout(live.flushTimer);
    live.flushTimer = null;
    const data = live.pending;
    if (!data) return;
    live.pending = "";
    for (let i = 0; i < data.length; i += MAX_CHUNK) {
      this.rt.bus.publish(`term:${live.term.id}`, {
        type: "term.output",
        termId: live.term.id,
        data: data.slice(i, i + MAX_CHUNK),
      });
    }
  }

  private publishStatus(live: TLive): void {
    const event = { type: "term.status" as const, terminal: live.term };
    this.rt.bus.publish(`term:${live.term.id}`, event);
    this.rt.bus.publish(`repo:${live.repoId}`, event);
  }

  private get(termId: string): TLive {
    const live = this.terms.get(termId);
    if (!live) throw new AgentdeckError("NOT_FOUND", `No terminal ${termId}`);
    return live;
  }

  private running(termId: string): { live: TLive; pty: IPtyProcess } {
    const live = this.get(termId);
    const pty = live.pty;
    if (pty === null) throw new AgentdeckError("BAD_STATE", "The terminal has exited");
    return { live, pty };
  }

  private prune(worktreeId: string): void {
    const ended = this.of(worktreeId).filter((l) => l.pty === null);
    for (const l of ended.slice(0, Math.max(0, ended.length - KEEP_ENDED + 1))) this.terms.delete(l.term.id);
  }
}
