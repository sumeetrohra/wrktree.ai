import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AgentdeckError } from "@agentdeck/protocol";
import { newId, silentLogger } from "@agentdeck/shared";
import { openDb } from "./db/index.js";
import { Router } from "./router.js";

const base = { deviceId: "test", takeUpload: () => undefined, afterReply: () => {}, subscribe: () => {} };
const setup = () => {
  const db = openDb(join(mkdtempSync(join(tmpdir(), "router-")), "db"));
  return { db, router: new Router(db, silentLogger) };
};

describe("Router", () => {
  it("runs a repeated CmdId once and returns the stored result, even after a restart", async () => {
    const { db, router } = setup();
    let runs = 0;
    const handlers = { "repo.list": () => (runs++, []) };
    router.register(handlers);
    const id = newId("cmd");
    expect(await router.dispatch(id, "repo.list", {}, base)).toEqual({ ok: true, data: [] });
    expect(await router.dispatch(id, "repo.list", {}, base)).toEqual({ ok: true, data: [] });
    const restarted = new Router(db, silentLogger);
    restarted.register(handlers);
    await restarted.dispatch(id, "repo.list", {}, base);
    expect(runs).toBe(1);
  });

  it("dedupes concurrent duplicates", async () => {
    const { router } = setup();
    let runs = 0;
    router.register({ "repo.list": async () => (runs++, await new Promise((r) => setTimeout(r, 20)), []) });
    const id = newId("cmd");
    await Promise.all([
      router.dispatch(id, "repo.list", {}, base),
      router.dispatch(id, "repo.list", {}, base),
    ]);
    expect(runs).toBe(1);
  });

  it("validates args with zod and does not store the rejection", async () => {
    const { router } = setup();
    let runs = 0;
    router.register({ "repo.add": () => (runs++, Promise.reject(new Error("unreachable"))) });
    const id = newId("cmd");
    const bad = await router.dispatch(id, "repo.add", { path: 42 }, base);
    expect(bad).toMatchObject({ ok: false, error: { code: "INVALID_ARGS" } });
    expect(runs).toBe(0);
  });

  it("maps errors to protocol errors", async () => {
    const { router } = setup();
    router.register({
      "repo.remove": () => {
        throw new AgentdeckError("NOT_FOUND", "No repo");
      },
    });
    expect(await router.dispatch(newId("cmd"), "repo.remove", { repoId: newId("repo") }, base)).toEqual({
      ok: false,
      error: { code: "NOT_FOUND", message: "No repo", retryable: false },
    });
    expect(await router.dispatch(newId("cmd"), "nope.nope", {}, base)).toMatchObject({
      ok: false,
      error: { code: "UNKNOWN_COMMAND" },
    });
  });
});
