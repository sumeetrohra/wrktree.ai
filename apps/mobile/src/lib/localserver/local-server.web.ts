import type { ILocalSocket, TLocalServer } from "./local-server.types";

/** Browsers can't listen on a port: the web build keeps the relay-tunnel preview. */
export function startLocalServer(_onConnection: (socket: ILocalSocket) => void): Promise<TLocalServer> {
  return Promise.reject(new Error("unavailable"));
}
