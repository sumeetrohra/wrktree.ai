import { request } from "node:http";

import { WebSocket } from "ws";

export type TPage = { status: number; body: string; location: string | null; setCookie: string | null };

/**
 * A browser tab on a preview URL, in a test: it reaches the relay at 127.0.0.1 with the preview's
 * `Host` (no DNS for `*.preview.localhost` needed) and keeps the one cookie the relay sets.
 */
export class PreviewBrowser {
  cookie: string | null = null;
  private readonly host: string;

  constructor(
    private readonly relayUrl: string,
    previewUrl: string,
  ) {
    this.host = new URL(previewUrl).host;
  }

  get(path: string): Promise<TPage> {
    const u = new URL(this.relayUrl);
    return new Promise((resolve, reject) => {
      const req = request(
        {
          hostname: u.hostname,
          port: u.port,
          path,
          headers: { host: this.host, ...(this.cookie ? { cookie: this.cookie } : {}) },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            const sc = res.headers["set-cookie"]?.[0] ?? null;
            resolve({
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks).toString(),
              location: res.headers.location ?? null,
              setCookie: sc,
            });
          });
        },
      );
      req.on("error", reject);
      req.end();
    });
  }

  /** First load with the one-time key: keep the cookie, follow the redirect. */
  async open(key: string, path = "/"): Promise<TPage> {
    const first = await this.get(`${path}${path.includes("?") ? "&" : "?"}k=${encodeURIComponent(key)}`);
    if (first.status !== 302 || first.setCookie === null) return first;
    this.cookie = first.setCookie.split(";")[0] ?? null;
    return this.get(first.location ?? "/");
  }

  /** A WebSocket from the page (e.g. the dev server's HMR channel); `received` fills as it goes. */
  socket(path: string, protocols: string[] = []): Promise<{ received: string[]; close(): void }> {
    const ws = new WebSocket(this.relayUrl.replace(/^http/, "ws") + path, protocols, {
      headers: { host: this.host, ...(this.cookie ? { cookie: this.cookie } : {}) },
    });
    const received: string[] = [];
    ws.on("message", (m: Buffer) => received.push(m.toString()));
    return new Promise((resolve, reject) => {
      ws.on("open", () => {
        resolve({
          received,
          close: () => {
            ws.close();
          },
        });
      });
      ws.on("error", reject);
    });
  }
}
