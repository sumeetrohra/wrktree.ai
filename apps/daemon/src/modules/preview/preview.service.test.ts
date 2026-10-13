import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { TProc, TWorktree } from "@agentdeck/protocol";
import { newId } from "@agentdeck/shared";
import { describe, expect, it } from "vitest";

import { EventBus } from "#src/infra/bus/index.js";
import { openDb } from "#src/infra/db/index.js";

import { PreviewService } from "./preview.service.js";
import type { IPreviewDeps } from "./preview.types.js";

function setup(opts: { config?: boolean; listens?: boolean; exits?: boolean; taken?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "preview-"));
  const bus = new EventBus(join(dir, "events"), openDb(join(dir, "db")));
  const wt: TWorktree = {
    id: newId("wt"),
    repoId: newId("repo"),
    title: "Feature",
    branch: "feature",
    baseRef: "main",
    path: dir,
    status: "ready",
    port: 41500,
    setupError: null,
    createdAt: 1,
    archivedAt: null,
  };
  const log: string[] = [];
  const procs = new Map<string, TProc>();
  const deps: IPreviewDeps = {
    worktree: () => wt,
    config: () => (opts.config === false ? undefined : { script: "dev", env: { HMR_PORT: "443" } }),
    procs: {
      start: (worktreeId, script, env) => {
        log.push(`start ${script} ${JSON.stringify(env)}`);
        const p: TProc = {
          id: newId("proc"),
          worktreeId,
          script,
          status: opts.exits ? "crashed" : "running",
          exitCode: null,
          startedAt: 1,
          endedAt: null,
        };
        procs.set(p.id, p);
        return p;
      },
      running: (_w, script) =>
        [...procs.values()].find((p) => p.script === script && p.status === "running") ?? null,
      proc: (id) => {
        const p = procs.get(id);
        if (!p) throw new Error("no proc");
        return p;
      },
      stop: (id) => {
        log.push(`stop ${id}`);
        const p = { ...deps.procs.proc(id), status: "stopped" as const };
        procs.set(id, p);
        return Promise.resolve(p);
      },
    },
    tunnel: {
      open: (worktreeId, deviceId) => {
        log.push(`open ${worktreeId} ${deviceId}`);
        return Promise.resolve({
          token: "tok1",
          key: "k1",
          url: "https://tok1.preview.example/",
          expiresAt: 9,
        });
      },
      close: (token) => {
        log.push(`close ${token}`);
        return Promise.resolve();
      },
    },
    // Before the script starts, the port is free unless `taken`; after, it listens unless told not to.
    waitForPort: (_port, ms, gaveUp) =>
      Promise.resolve(ms === 0 ? opts.taken === true : opts.listens !== false && !gaveUp()),
  };
  const statuses = (): string[] =>
    bus
      .replay(`repo:${wt.repoId}`, 0)
      .flatMap((e) => (e.event.type === "preview.status" ? [e.event.status] : []));
  return { svc: new PreviewService(bus, deps), wt, log, statuses };
}

describe("PreviewService", () => {
  it("is off for a repo without a preview script", async () => {
    const t = setup({ config: false });
    await expect(t.svc.start(t.wt.id, "local-1")).rejects.toMatchObject({ code: "BAD_STATE" });
  });

  it("hands this computer a localhost URL, with no tunnel", async () => {
    const t = setup();
    expect(await t.svc.start(t.wt.id, "local-1")).toEqual({
      url: "http://localhost:41500/",
      key: null,
      expiresAt: null,
    });
    expect(t.log).toEqual(['start dev {"HMR_PORT":"443","AGENTDECK_PREVIEW":"1"}']);
    expect(t.statuses()).toEqual(["starting", "ready"]);
  });

  it("opens a tunnel only the asking device can use, mapped to the worktree's port", async () => {
    const t = setup();
    const res = await t.svc.start(t.wt.id, "relay-d_phone");
    expect(res).toEqual({ url: "https://tok1.preview.example/", key: "k1", expiresAt: 9 });
    expect(t.log).toContain(`open ${t.wt.id} d_phone`);
    expect(t.svc.portOf("tok1")).toBe(41500);
    expect(t.svc.portOf("nope")).toBeNull();
    // A second start reuses the running script.
    await t.svc.start(t.wt.id, "relay-d_phone");
    expect(t.log.filter((l) => l.startsWith("start"))).toHaveLength(1);
  });

  it("stops: closes the tunnels, stops the script, and the token reaches nothing", async () => {
    const t = setup();
    await t.svc.start(t.wt.id, "relay-d_phone");
    await t.svc.stop(t.wt.id);
    expect(t.log.slice(-2)).toEqual([expect.stringMatching(/^stop proc_/), "close tok1"]);
    expect(t.svc.portOf("tok1")).toBeNull();
    expect(t.statuses().at(-1)).toBe("stopped");
  });

  it("won't preview a port another program already holds", async () => {
    const t = setup({ taken: true });
    await expect(t.svc.start(t.wt.id, "local-1")).rejects.toMatchObject({ code: "CONFLICT" });
    expect(t.log).toEqual([]);
  });

  it("reports a script that exits or never listens as crashed", async () => {
    const exits = setup({ exits: true });
    await expect(exits.svc.start(exits.wt.id, "local-1")).rejects.toThrow(/exited; see Logs/);
    expect(exits.statuses()).toEqual(["starting", "crashed"]);
    const silent = setup({ listens: false });
    await expect(silent.svc.start(silent.wt.id, "local-1")).rejects.toThrow(/use \$PORT/);
  });
});
