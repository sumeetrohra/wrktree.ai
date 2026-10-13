import { request } from "node:http";

import { WebSocket } from "ws";

/**
 * Clients that set their own `Host` header (fetch and the global WebSocket can't), to reach a
 * preview host (`<token>.preview.localhost`) on a relay listening at 127.0.0.1. Used by tests.
 */
export type THostResponse = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
};

export function hostRequest(
  base: string,
  host: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<THostResponse> {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    const req = request(
      { hostname: u.hostname, port: u.port, path, method: "GET", headers: { ...headers, host } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString(),
          });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

export interface IHostSocket {
  readonly received: string[];
  send(text: string): void;
  close(): void;
}

/** A WebSocket to `path` on a preview host; rejects if the relay refuses the upgrade. */
export function hostSocket(
  base: string,
  host: string,
  path: string,
  headers: Record<string, string> = {},
  protocols: string[] = [],
): Promise<IHostSocket> {
  const ws = new WebSocket(base.replace(/^http/, "ws") + path, protocols, { headers: { ...headers, host } });
  const received: string[] = [];
  ws.on("message", (m: Buffer) => received.push(m.toString()));
  return new Promise((resolve, reject) => {
    ws.on("open", () => {
      resolve({
        received,
        send: (text) => {
          ws.send(text);
        },
        close: () => {
          ws.close();
        },
      });
    });
    ws.on("error", reject);
  });
}
