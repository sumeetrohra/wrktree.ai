import { spawn, type ChildProcess } from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import { AgentdeckError } from "@agentdeck/protocol";
import type { FileJail } from "../files.js";

export type AdapterHandlers = {
  sessionUpdate(params: acp.SessionNotification): void;
  requestPermission(params: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse>;
};

export type Adapter = {
  proc: ChildProcess;
  conn: acp.ClientSideConnection;
  stderrTail(): string;
};

/** Errors returned to the agent for fs requests; the message tells it why. */
function toRequestError(e: unknown): acp.RequestError {
  if (e instanceof AgentdeckError) return new acp.RequestError(-32602, `${e.code}: ${e.message}`);
  return new acp.RequestError(-32603, (e as Error).message ?? String(e));
}

/**
 * Spawns an ACP adapter with `cwd` set to the worktree and the profile's env,
 * and connects to it as the ACP client over stdio. File access is served
 * through the worktree's jail; terminals are off in v1.
 */
export function spawnAdapter(
  command: string[],
  cwd: string,
  env: Record<string, string>,
  jail: FileJail,
  handlers: AdapterHandlers,
): Adapter {
  const [file, ...args] = command;
  if (!file) throw new AgentdeckError("UNKNOWN_AGENT", "Agent has no command");
  const proc = spawn(file, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    shell: process.platform === "win32" && file.endsWith(".cmd"),
  });
  let stderr = "";
  proc.stderr?.on("data", (d: Buffer) => {
    stderr = (stderr + d.toString()).slice(-4000);
  });
  // Writes after the adapter exits raise EPIPE; the exit handler deals with it.
  proc.stdin?.on("error", () => {});

  const stream = acp.ndJsonStream(
    Writable.toWeb(proc.stdin!) as WritableStream<Uint8Array>,
    Readable.toWeb(proc.stdout!) as ReadableStream<Uint8Array>,
  );
  const client: acp.Client = {
    sessionUpdate: (p) => handlers.sessionUpdate(p),
    requestPermission: (p) => handlers.requestPermission(p),
    readTextFile: async (p) => {
      try {
        return { content: await jail.agentRead(p.path, p.line, p.limit) };
      } catch (e) {
        throw toRequestError(e);
      }
    },
    writeTextFile: async (p) => {
      try {
        await jail.agentWrite(p.path, p.content);
        return {};
      } catch (e) {
        throw toRequestError(e);
      }
    },
  };
  const conn = new acp.ClientSideConnection(() => client, stream);
  return { proc, conn, stderrTail: () => stderr.trim() };
}

export const CLIENT_CAPABILITIES: acp.ClientCapabilities = {
  fs: { readTextFile: true, writeTextFile: true },
  terminal: false,
};

export { acp };
