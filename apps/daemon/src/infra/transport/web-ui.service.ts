import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";

import { tryParseJson } from "@agentdeck/shared";
import { z } from "zod";

const CODE_TTL_MS = 60_000;
const MAX_BODY = 1024;

const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

/** Never framed (clickjacking), never cached with a session in it. */
const SECURITY_HEADERS = {
  "x-frame-options": "DENY",
  "content-security-policy": "frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

const sessionBodySchema = z.object({ code: z.string().regex(/^[0-9a-f]{32}$/) });

/**
 * The desktop web UI, served by the daemon from the app's web export. The page never contains the
 * local token: `agentdeck open` asks for a one-time code (60 s, single use) and puts it in the URL
 * fragment; the page trades it for the token with a same-origin POST to `/v1/web-session`.
 * Another local user can fetch the page, but not a code.
 */
export class WebUi {
  private readonly codes = new Map<string, number>();
  private readonly root: string | null;

  constructor(
    root: string | null,
    private readonly token: () => string,
    private readonly ownOrigins: () => readonly string[],
  ) {
    this.root = root !== null && existsSync(join(root, "index.html")) ? realpathSync.native(root) : null;
  }

  get enabled(): boolean {
    return this.root !== null;
  }

  issueCode(now = Date.now()): string {
    for (const [c, exp] of this.codes) if (exp < now) this.codes.delete(c);
    const code = randomBytes(16).toString("hex");
    this.codes.set(code, now + CODE_TTL_MS);
    return code;
  }

  private consume(code: string, now = Date.now()): boolean {
    const exp = this.codes.get(code);
    this.codes.delete(code);
    return exp !== undefined && exp >= now;
  }

  /** True when it answered the request. The caller has already checked `Host`. */
  handle(req: IncomingMessage, res: ServerResponse): boolean {
    if (!this.root) return false;
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/v1/web-session" && req.method === "POST") {
      this.session(req, res);
      return true;
    }
    if (req.method !== "GET") return false;
    const file = this.resolveFile(url.pathname);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": file.endsWith("index.html") ? "no-store" : "public, max-age=3600",
    });
    res.end(readFileSync(file));
    return true;
  }

  /** A file inside the export, or index.html for app routes (single-page fallback). */
  private resolveFile(pathname: string): string {
    const root = this.root ?? "";
    const index = join(root, "index.html");
    let target: string;
    try {
      target = resolve(root, `.${decodeURIComponent(pathname)}`);
    } catch {
      return index;
    }
    if (!target.startsWith(root + sep)) return index;
    if (!existsSync(target) || !statSync(target).isFile()) return index;
    const real = realpathSync.native(target);
    return real.startsWith(root + sep) ? real : index;
  }

  private session(req: IncomingMessage, res: ServerResponse): void {
    const origin = req.headers.origin;
    if (origin === undefined || !this.ownOrigins().includes(origin)) {
      res.writeHead(403, SECURITY_HEADERS).end();
      return;
    }
    let body = "";
    req.on("data", (d: Buffer) => {
      body += d.toString();
      if (body.length > MAX_BODY) req.destroy();
    });
    req.on("end", () => {
      const parsed = tryParseJson(sessionBodySchema, body);
      if (!parsed || !this.consume(parsed.code)) {
        res.writeHead(401, SECURITY_HEADERS).end();
        return;
      }
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify({ token: this.token() }));
    });
  }
}
