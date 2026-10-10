import { randomUUID } from "node:crypto";
import {
  AgentdeckError,
  commands,
  isCommandName,
  type CommandName,
  type CommandResult,
  type ProtocolError,
} from "@agentdeck/protocol";
import { type Logger, now } from "@agentdeck/shared";
import type { z } from "zod";
import type { Db } from "./db/index.js";

export type CommandContext = {
  deviceId: string;
  cmdId: string;
  traceId: string;
  log: Logger;
  /** Upload buffers the transport collected from blob frames. */
  takeUpload(uploadId: string): Buffer | undefined;
  /** Runs `fn` once the reply has been sent (used by `sync.hello` to stream the replay after it). */
  afterReply(fn: () => void): void;
  /** Subscribes this connection to topics, replaying events after the given cursors. */
  subscribe(cursors: Record<string, number>): void;
};

export type Handler<N extends CommandName> = (
  args: z.infer<(typeof commands)[N]["args"]>,
  ctx: CommandContext,
) => Promise<CommandResult<N>> | CommandResult<N>;

export type Handlers = { [N in CommandName]?: Handler<N> };

export type Reply = { ok: true; data: unknown } | { ok: false; error: ProtocolError };

const RESULT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * CommandName → handler, with zod validation, idempotency by CmdId, uniform errors.
 * Transports deliver commands here and nothing else, so every feature is testable without a network.
 */
export class Router {
  private handlers: Handlers = {};
  private inflight = new Map<string, Promise<Reply>>();
  private getResult;
  private putResult;

  constructor(
    db: Db,
    private readonly log: Logger,
  ) {
    this.getResult = db.prepare<[string], { result_json: string }>(
      "SELECT result_json FROM command_results WHERE cmd_id = ?",
    );
    this.putResult = db.prepare(
      "INSERT OR REPLACE INTO command_results (cmd_id, device_id, result_json, at) VALUES (?, ?, ?, ?)",
    );
    db.prepare("DELETE FROM command_results WHERE at < ?").run(now() - RESULT_TTL_MS);
  }

  register(handlers: Handlers): void {
    Object.assign(this.handlers, handlers);
  }

  async dispatch(
    cmdId: string,
    name: string,
    args: unknown,
    ctx: Omit<CommandContext, "cmdId" | "traceId" | "log">,
  ): Promise<Reply> {
    const stored = this.getResult.get(cmdId);
    if (stored) return JSON.parse(stored.result_json) as Reply;
    const running = this.inflight.get(cmdId);
    if (running) return running;

    const p = this.run(cmdId, name, args, ctx);
    this.inflight.set(cmdId, p);
    try {
      const reply = await p;
      // Only commands that ran are stored; a malformed or unknown command can be fixed and resent.
      if (reply.ok || !["INVALID_ARGS", "UNKNOWN_COMMAND"].includes(reply.error.code)) {
        this.putResult.run(cmdId, ctx.deviceId, JSON.stringify(reply), now());
      }
      return reply;
    } finally {
      this.inflight.delete(cmdId);
    }
  }

  private async run(
    cmdId: string,
    name: string,
    args: unknown,
    base: Omit<CommandContext, "cmdId" | "traceId" | "log">,
  ): Promise<Reply> {
    const traceId = randomUUID().slice(0, 8);
    const log = this.log.child({ traceId, cmd: name });
    const started = Date.now();
    try {
      if (!isCommandName(name) || !this.handlers[name]) {
        throw new AgentdeckError("UNKNOWN_COMMAND", `Unknown command: ${name}`);
      }
      const spec = commands[name];
      const parsed = spec.args.safeParse(args ?? {});
      if (!parsed.success) {
        throw new AgentdeckError(
          "INVALID_ARGS",
          parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        );
      }
      const handler = this.handlers[name] as Handler<typeof name>;
      const data = await handler(parsed.data as never, { ...base, cmdId, traceId, log });
      log.info({ ms: Date.now() - started }, "command ok");
      return { ok: true, data };
    } catch (e) {
      const error =
        e instanceof AgentdeckError
          ? e.toProtocol()
          : { code: "INTERNAL" as const, message: (e as Error).message ?? String(e), retryable: true };
      log.warn({ ms: Date.now() - started, code: error.code }, "command failed");
      return { ok: false, error };
    }
  }
}
