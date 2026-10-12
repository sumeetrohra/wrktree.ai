import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { WebUi } from "./web-ui.service.js";

let server: Server;
let base: string;
let web: WebUi;
/** Creating symlinks needs extra rights on Windows; the traversal check runs everywhere. */
let symlinks = true;

beforeEach(async () => {
  const root = mkdtempSync(join(tmpdir(), "webui-"));
  mkdirSync(join(root, "_expo"));
  writeFileSync(join(root, "index.html"), "<html>app</html>");
  writeFileSync(join(root, "_expo", "app.js"), "console.log(1)");
  const secret = mkdtempSync(join(tmpdir(), "secret-"));
  writeFileSync(join(secret, "token"), "s3cret");
  try {
    symlinkSync(join(secret, "token"), join(root, "leak"));
  } catch {
    symlinks = false;
  }
  server = createServer((req, res) => {
    if (!web.handle(req, res)) res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  web = new WebUi(
    root,
    () => "LOCAL-TOKEN",
    () => [base],
  );
});

afterEach(() => {
  server.close();
});

const session = (code: string, origin: string | null = base) =>
  fetch(`${base}/v1/web-session`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
    body: JSON.stringify({ code }),
  });

describe("WebUi", () => {
  it("serves the export with anti-framing headers, and index.html for app routes", async () => {
    const res = await fetch(`${base}/wt/abc/chat/def`);
    expect(await res.text()).toBe("<html>app</html>");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(await (await fetch(`${base}/_expo/app.js`)).text()).toBe("console.log(1)");
  });

  it("never serves files outside the export (traversal, symlinks)", async () => {
    expect(await (await fetch(`${base}/..%2f..%2fetc%2fpasswd`)).text()).toBe("<html>app</html>");
    if (symlinks) expect(await (await fetch(`${base}/leak`)).text()).toBe("<html>app</html>");
  });

  it("trades a one-time code for the token, same-origin only", async () => {
    const code = web.issueCode();
    expect((await session(code, "https://evil.example")).status).toBe(403);
    expect((await session(code, null)).status).toBe(403);
    const ok = await session(code);
    expect(await ok.json()).toEqual({ token: "LOCAL-TOKEN" });
    expect((await session(code)).status).toBe(401);
    expect((await session("0".repeat(32))).status).toBe(401);
  });

  it("expires codes after a minute", async () => {
    const code = web.issueCode(Date.now() - 61_000);
    expect((await session(code)).status).toBe(401);
  });
});
