import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AgentdeckError, commandNames } from "@agentdeck/protocol";
import { newId, silentLogger } from "@agentdeck/shared";
import { describe, expect, it } from "vitest";

import { openDb } from "../db/index.js";

import { Router, type THandlers } from "./router.service.js";

const base = { deviceId: "test", takeUpload: () => undefined, afterReply: () => undefined, subscribe: () => undefined };

/** A full handler table where every command not overridden throws. */
function handlersWith(overrides: Partial<THandlers>): THandlers {
  const all = Object.fromEntries(
    commandNames.map((n) => [
      n,
      () => {
        throw new Error(`unexpected ${n}`);
      },
    ]),
  );
  return { ...all, ...overrides } as THandlers;
}

const freshDb = () => openDb(join(mkdtempSync(join(tmpdir(), "router-")), "db"));

describe("Router", () => {
  it("runs a repeated CmdId once and returns the stored result, even after a restart", async () => {
    const db = freshDb();
    let runs = 0;
    const handlers = handlersWith({ "repo.list": () => (runs++, []) });
    const router = new Router(db, handlers, silentLogger);
    const id = newId("cmd");
    expect(await router.dispatch(id, "repo.list", {}, base)).toEqual({ ok: true, data: [] });
    expect(await router.dispatch(id, "repo.list", {}, base)).toEqual({ ok: true, data: [] });
    router.close();
    const restarted = new Router(db, handlers, silentLogger);
    await restarted.dispatch(id, "repo.list", {}, base);
    restarted.close();
    expect(runs).toBe(1);
  });

  it("dedupes concurrent duplicates", async () => {
    let runs = 0;
    const router = new Router(
      freshDb(),
      handlersWith({
        "repo.list": async () => {
          runs++;
          await new Promise((r) => setTimeout(r, 20));
          return [];
        },
      }),
      silentLogger,
    );
    const id = newId("cmd");
    await Promise.all([router.dispatch(id, "repo.list", {}, base), router.dispatch(id, "repo.list", {}, base)]);
    router.close();
    expect(runs).toBe(1);
  });

  it("validates args with zod and does not store the rejection", async () => {
    let runs = 0;
    const router = new Router(
      freshDb(),
      handlersWith({
        "repo.add": () => {
          runs++;
          throw new Error("unreachable");
        },
      }),
      silentLogger,
    );
    const bad = await router.dispatch(newId("cmd"), "repo.add", { path: 42 }, base);
    router.close();
    expect(bad).toMatchObject({ ok: false, error: { code: "INVALID_ARGS" } });
    expect(runs).toBe(0);
  });

  it("maps errors to protocol errors", async () => {
    const router = new Router(
      freshDb(),
      handlersWith({
        "repo.remove": () => {
          throw new AgentdeckError("NOT_FOUND", "No repo");
        },
      }),
      silentLogger,
    );
    expect(await router.dispatch(newId("cmd"), "repo.remove", { repoId: newId("repo") }, base)).toEqual({
      ok: false,
      error: { code: "NOT_FOUND", message: "No repo", retryable: false },
    });
    expect(await router.dispatch(newId("cmd"), "nope.nope", {}, base)).toMatchObject({
      ok: false,
      error: { code: "UNKNOWN_COMMAND" },
    });
    router.close();
  });
});
