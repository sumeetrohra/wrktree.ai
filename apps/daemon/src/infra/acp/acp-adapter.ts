import { Readable, Writable } from "node:stream";

import * as acp from "@agentclientprotocol/sdk";
import { AgentdeckError } from "@agentdeck/protocol";

import { spawnPiped, type ChildProcess } from "../process/index.js";

/** How the adapter serves an agent's file requests; the sessions module backs it with the worktree jail. */
export interface IAgentFiles {
  read: (path: string, line?: number | null, limit?: number | null) => Promise<string>;
  write: (path: string, content: string) => Promise<void>;
}

export type TAdapterHandlers = {
  sessionUpdate: (params: acp.SessionNotification) => void;
  requestPermission: (params: acp.RequestPermissionRequest) => Promise<acp.RequestPermissionResponse>;
};

export type TAdapter = {
  proc: ChildProcess;
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- reason: SDK 1.8 deprecates this for the builder API; migrating is tracked, and this wrapper is the only place to change
  conn: acp.ClientSideConnection;
  stderrTail: () => string;
};

const STDERR_TAIL = 4000;

/** Errors returned to the agent for fs requests; the message tells it why. */
function toRequestError(e: unknown): acp.RequestError {
  if (e instanceof AgentdeckError) return new acp.RequestError(-32602, `${e.code}: ${e.message}`);
  return new acp.RequestError(-32603, e instanceof Error ? e.message : String(e));
}

/**
 * Spawns an ACP adapter with `cwd` set to the worktree and the given (allow-listed) env, and
 * connects to it as the ACP client over stdio. The SDK validates every inbound message against
 * the ACP schema. File access goes through `files`; terminals are off in v1.
 */
export function spawnAdapter(
  command: readonly string[],
  cwd: string,
  env: Record<string, string>,
  files: IAgentFiles,
  handlers: TAdapterHandlers,
): TAdapter {
  const proc = spawnPiped(command, { cwd, env });
  const { stdin, stdout, stderr } = proc;
  if (!stdin || !stdout || !stderr) throw new AgentdeckError("INTERNAL", "Adapter stdio is not piped");
  let tail = "";
  stderr.on("data", (d: Buffer) => {
    tail = (tail + d.toString()).slice(-STDERR_TAIL);
  });
  // Writes after the adapter exits raise EPIPE; the exit handler deals with it.
  stdin.on("error", () => undefined);

  const output: WritableStream<Uint8Array> = Writable.toWeb(stdin);

  const input: ReadableStream<Uint8Array> = Readable.toWeb(stdout);
  const client: acp.Client = {
    sessionUpdate: (p) => {
      handlers.sessionUpdate(p);
    },
    requestPermission: (p) => handlers.requestPermission(p),
    readTextFile: async (p) => {
      try {
        return { content: await files.read(p.path, p.line, p.limit) };
      } catch (e) {
        throw toRequestError(e);
      }
    },
    writeTextFile: async (p) => {
      try {
        await files.write(p.path, p.content);
        return {};
      } catch (e) {
        throw toRequestError(e);
      }
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- reason: see TAdapter.conn
  const conn = new acp.ClientSideConnection(() => client, acp.ndJsonStream(output, input));
  return { proc, conn, stderrTail: () => tail.trim() };
}

export const CLIENT_CAPABILITIES: acp.ClientCapabilities = {
  fs: { readTextFile: true, writeTextFile: true },
  terminal: false,
};

export const ACP_PROTOCOL_VERSION = acp.PROTOCOL_VERSION;
