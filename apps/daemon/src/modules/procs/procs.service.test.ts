import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { TLoggedEvent, TWorktree } from "@agentdeck/protocol";
import { newId, silentLogger } from "@agentdeck/shared";
import { describe, expect, it } from "vitest";

import { EventBus } from "#src/infra/bus/index.js";
import { openDb } from "#src/infra/db/index.js";
import type { TRuntime } from "#src/infra/runtime/index.js";
import { pathsFor } from "#src/shared/paths.utils.js";

import { ProcsService } from "./procs.service.js";

const node = (code: string): string => `"${process.execPath}" -e "${code}"`;

const SCRIPTS = {
  hello: node("console.log('port=' + process.env.PORT); console.error('warn'); process.exit(3)"),
  forever: node("console.log('up'); setInterval(() => {}, 1000)"),
  big: node("process.stdout.write('x'.repeat(1500000) + 'END')"),
};

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "procs-"));
  const db = openDb(join(dir, "db"));
  const bus = new EventBus(join(dir, "events"), db);
  const rt = { db, bus, log: silentLogger, paths: pathsFor(dir), opts: {} } as TRuntime;
  const wt: TWorktree = {
    id: newId("wt"),
    repoId: newId("repo"),
    title: "Feature",
    branch: "feature",
    baseRef: "main",
    path: dir,
    status: "ready",
    port: 41234,
    setupError: null,
    createdAt: 1,
    archivedAt: null,
  };
  const blobs = new Map<string, Buffer>();
  const procs = new ProcsService(
    rt,
    { worktree: () => wt, config: () => ({ scripts: SCRIPTS, env: {} }) },
    {
      put: (bytes, mime) => {
        blobs.set("b", bytes);
        return { blobId: "b", mime, size: bytes.length };
      },
    },
  );
  const events: TLoggedEvent[] = [];
  bus.on((e) => events.push(e));
  const ended = (procId: string): Promise<void> =>
    new Promise((resolve) => {
      const off = bus.on((e) => {
        if (
          e.event.type === "proc.status" &&
          e.event.proc.id === procId &&
          e.event.proc.status !== "running"
        ) {
          off();
          resolve();
        }
      });
    });
  return { procs, wt, events, ended, blobs, bus };
}

describe("ProcsService", () => {
  it("runs a script with PORT set, streams both outputs, reports the exit code", async () => {
    const t = setup();
    const p = t.procs.start(t.wt.id, "hello");
    expect(p.status).toBe("running");
    await t.ended(p.id);
    const out = t.events.flatMap((e) => (e.event.type === "proc.output" ? [e.event] : []));
    expect(out.find((o) => o.stream === "stdout")?.chunk).toContain("port=41234");
    expect(out.find((o) => o.stream === "stderr")?.chunk).toContain("warn");
    const [proc] = t.procs.list(t.wt.id).procs;
    expect(proc).toMatchObject({ status: "crashed", exitCode: 3 });
    expect(t.events.some((e) => e.topic === `repo:${t.wt.repoId}` && e.event.type === "proc.status")).toBe(
      true,
    );
  });

  it("only starts scripts the repo names, one of each at a time", async () => {
    const t = setup();
    expect(() => t.procs.start(t.wt.id, "rm -rf /")).toThrow(/No script named/);
    expect(t.procs.list(t.wt.id).scripts).toEqual(["big", "forever", "hello"]);
    const p = t.procs.start(t.wt.id, "forever");
    expect(() => t.procs.start(t.wt.id, "forever")).toThrow(/already running/);
    const stopped = await t.procs.stop(p.id);
    expect(stopped.status).toBe("stopped");
  });

  it("keeps the newest megabyte and caps each event", async () => {
    const t = setup();
    const p = t.procs.start(t.wt.id, "big");
    await t.ended(p.id);
    const { blob: ref, cursor } = t.procs.output(p.id);
    expect(ref.size).toBe(1024 * 1024);
    expect(cursor).toBe(t.events.filter((e) => e.topic === `proc:${p.id}`).length);
    expect(t.blobs.get("b")?.toString().endsWith("END")).toBe(true);
    for (const e of t.events) {
      if (e.event.type === "proc.output") expect(e.event.chunk.length).toBeLessThan(70 * 1024);
    }
  });

  it("stops every script of a worktree", async () => {
    const t = setup();
    t.procs.start(t.wt.id, "forever");
    await t.procs.stopAll(t.wt.id);
    expect(t.procs.list(t.wt.id).procs.map((p) => p.status)).toEqual(["stopped"]);
  });
});
