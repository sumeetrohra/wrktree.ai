import {
  innerSchema,
  parseCommandResult,
  type TCommandArgs,
  type TCommandName,
  type TCommandResult,
  type TInner,
} from "@agentdeck/protocol";
import { newId, tryParseJson } from "@agentdeck/shared";

import type { TAppError } from "./app-error.types";
import { DAEMON_TOKEN, DAEMON_URL, TOKEN_PROTOCOL_PREFIX } from "./connection.constants";

type TPending = { resolve: (data: unknown) => void; reject: (e: TAppError) => void };

export type TDaemonCall = <N extends TCommandName>(
  name: N,
  args: TCommandArgs<N>,
) => Promise<TCommandResult<N>>;

/**
 * The app's only connection to the daemon (A1, L9). Commands are typed from the protocol map
 * and every reply is validated against its result schema before it reaches a component (A2).
 */
function createDaemonClient(url = DAEMON_URL, token = DAEMON_TOKEN): TDaemonCall {
  const pending = new Map<string, TPending>();
  let socket: WebSocket | null = null;
  let ready: Promise<WebSocket> | null = null;

  const disconnected = (): TAppError => ({
    code: "DISCONNECTED",
    i18nKey: "repos.loadFailed",
    message: "Connection to the daemon closed",
  });

  const connect = (): Promise<WebSocket> => {
    if (ready && socket?.readyState === WebSocket.OPEN) return ready;
    ready = new Promise((resolve, reject) => {
      const ws = new WebSocket(url, ["agentdeck.v1", `${TOKEN_PROTOCOL_PREFIX}${token}`]);
      ws.onopen = () => {
        socket = ws;
        resolve(ws);
      };
      ws.onerror = () => {
        reject(new Error("Could not connect to the daemon"));
      };
      ws.onclose = () => {
        for (const p of pending.values()) p.reject(disconnected());
        pending.clear();
        socket = null;
        ready = null;
      };
      ws.onmessage = (msg: MessageEvent<string>) => {
        const frame = tryParseJson(innerSchema, msg.data);
        if (frame?.t !== "res") return;
        const p = pending.get(frame.id);
        if (!p) return;
        pending.delete(frame.id);
        if (frame.ok) p.resolve(frame.data);
        else p.reject({ code: frame.error.code, i18nKey: "repos.loadFailed", message: frame.error.message });
      };
    });
    return ready;
  };

  return async (name, args) => {
    const ws = await connect();
    const id = newId("cmd");
    const data = await new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      const frame: TInner = { t: "cmd", id, name, args };
      ws.send(JSON.stringify(frame));
    });
    return parseCommandResult(name, data);
  };
}

/** The app-wide client. Tests replace it through `setDaemonCall`. */
let current: TDaemonCall | null = null;

export function daemonCall(): TDaemonCall {
  current ??= createDaemonClient();
  return current;
}

export function setDaemonCall(call: TDaemonCall): void {
  current = call;
}
