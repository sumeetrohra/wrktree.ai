import { randomUUID } from "node:crypto";

import {
  AgentdeckError,
  isCommandName,
  parseCommandArgs,
  protocolErrorSchema,
  type TCommandName,
  type TCommandResult,
  type TCommands,
  type TProtocolError,
} from "@agentdeck/protocol";
import { now, parseJson, type ILogger } from "@agentdeck/shared";
import { z } from "zod";

import type { TDb } from "../db/index.js";

export type TCommandContext = {
  deviceId: string;
  cmdId: string;
  traceId: string;
  log: ILogger;
  /** Upload buffers the transport collected from blob frames. */
  takeUpload: (uploadId: string) => Buffer | undefined;
  /** Runs `fn` once the reply has been sent (used by `sync.hello` to stream the replay after it). */
  afterReply: (fn: () => void) => void;
  /** Subscribes this connection to topics, replaying events after the given cursors. */
  subscribe: (cursors: Readonly<Record<string, number>>) => void;
};

export type TTransportContext = Omit<TCommandContext, "cmdId" | "traceId" | "log">;

export type THandler<N extends TCommandName> = (
  args: z.output<TCommands[N]["args"]>,
  ctx: TCommandContext,
) => Promise<TCommandResult<N>> | TCommandResult<N>;

/** One handler per protocol command: adding a command without a handler fails `tsc` (A6). */
export type THandlers = { [N in TCommandName]: THandler<N> };

const replySchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({ ok: z.literal(false), error: protocolErrorSchema }),
]);
export type TReply = z.infer<typeof replySchema>;

const RESULT_TTL_MS = 24 * 60 * 60 * 1000;
const SWEEP_EVERY_MS = 60 * 60 * 1000;
const NOT_STORED: readonly string[] = ["INVALID_ARGS", "UNKNOWN_COMMAND"];

function issues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
}

async function invoke<N extends TCommandName>(
  handlers: THandlers,
  name: N,
  args: unknown,
  ctx: TCommandContext,
): Promise<TCommandResult<N>> {
  let parsed: z.output<TCommands[N]["args"]>;
  try {
    parsed = parseCommandArgs(name, args ?? {});
  } catch (e) {
    throw new AgentdeckError("INVALID_ARGS", e instanceof z.ZodError ? issues(e) : String(e));
  }
  const handler: THandler<N> = handlers[name];
  return handler(parsed, ctx);
}

/**
 * TCommandName → handler, with zod validation, idempotency by CmdId, uniform errors.
 * Transports deliver commands here and nothing else, so every feature is testable without a network.
 */
export class Router {
  private readonly inflight = new Map<string, Promise<TReply>>();
  private readonly getResult;
  private readonly putResult;
  private readonly sweep;
  private readonly timer: NodeJS.Timeout;

  constructor(
    db: TDb,
    private readonly handlers: THandlers,
    private readonly log: ILogger,
  ) {
    this.getResult = db.prepare<[string], { result_json: string }>(
      "SELECT result_json FROM command_results WHERE cmd_id = ?",
    );
    this.putResult = db.prepare(
      "INSERT OR REPLACE INTO command_results (cmd_id, device_id, result_json, at) VALUES (?, ?, ?, ?)",
    );
    this.sweep = db.prepare("DELETE FROM command_results WHERE at < ?");
    this.sweepExpired();
    this.timer = setInterval(() => {
      this.sweepExpired();
    }, SWEEP_EVERY_MS);
    this.timer.unref();
  }

  private sweepExpired(): void {
    this.sweep.run(now() - RESULT_TTL_MS);
  }

  close(): void {
    clearInterval(this.timer);
  }

  async dispatch(cmdId: string, name: string, args: unknown, ctx: TTransportContext): Promise<TReply> {
    const stored = this.getResult.get(cmdId);
    if (stored) return parseJson(replySchema, stored.result_json);
    const running = this.inflight.get(cmdId);
    if (running) return running;

    const p = this.run(cmdId, name, args, ctx);
    this.inflight.set(cmdId, p);
    try {
      const reply = await p;
      // Only commands that ran are stored; a malformed or unknown command can be fixed and resent.
      if (reply.ok || !NOT_STORED.includes(reply.error.code)) {
        this.putResult.run(cmdId, ctx.deviceId, JSON.stringify(reply), now());
      }
      return reply;
    } finally {
      this.inflight.delete(cmdId);
    }
  }

  private async run(cmdId: string, name: string, args: unknown, base: TTransportContext): Promise<TReply> {
    const traceId = randomUUID().slice(0, 8);
    const log = this.log.child({ traceId, cmd: name });
    const started = now();
    try {
      if (!isCommandName(name)) throw new AgentdeckError("UNKNOWN_COMMAND", `Unknown command: ${name}`);
      const data = await invoke(this.handlers, name, args, { ...base, cmdId, traceId, log });
      log.info({ ms: now() - started }, "command ok");
      return { ok: true, data };
    } catch (e) {
      const error: TProtocolError =
        e instanceof AgentdeckError
          ? e.toProtocol()
          : { code: "INTERNAL", message: e instanceof Error ? e.message : String(e), retryable: true };
      log.warn({ ms: now() - started, code: error.code }, "command failed");
      return { ok: false, error };
    }
  }
}
