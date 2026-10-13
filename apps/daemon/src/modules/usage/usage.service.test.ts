import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { newId, silentLogger } from "@agentdeck/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EventBus } from "#src/infra/bus/index.js";
import { openDb } from "#src/infra/db/index.js";
import type { TRuntime } from "#src/infra/runtime/index.js";
import { pathsFor } from "#src/shared/paths.utils.js";

import { UsageService } from "./usage.service.js";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "usage-"));
  const db = openDb(join(dir, "db"));
  const bus = new EventBus(join(dir, "events"), db);
  const rt = { db, bus, log: silentLogger, paths: pathsFor(dir), opts: {} } as TRuntime;
  const updates = () =>
    bus.replay("global", 0).flatMap((e) => (e.event.type === "usage.updated" ? [e.event.usage] : []));
  return { usage: new UsageService(rt), updates };
}

const P1 = newId("prof");
const P2 = newId("prof");

afterEach(() => {
  vi.useRealTimers();
});

describe("UsageService", () => {
  it("turns a session's running totals into today's tokens per profile", () => {
    const t = setup();
    t.usage.turnEnded(P1, "c1", { inputTokens: 100, outputTokens: 40 });
    t.usage.turnEnded(P1, "c1", { inputTokens: 150, outputTokens: 90 });
    t.usage.turnEnded(P1, "c2", { inputTokens: 10, outputTokens: 5 });
    t.usage.turnEnded(P2, "c3", { inputTokens: 999, outputTokens: 999 });
    // A new agent session starts its totals from zero again.
    t.usage.turnEnded(P1, "c1", { inputTokens: 20, outputTokens: 10 });
    t.usage.turnEnded(P1, "c4", null);
    expect(t.usage.snapshot(P1)).toEqual({ limitHit: false, inputTokens: 180, outputTokens: 105 });
    expect(t.updates().at(-1)).toEqual({ limitHit: false, inputTokens: 180, outputTokens: 105 });
  });

  it("is limited until the reset time, or until a turn completes", () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 13, 10, 0, 0) });
    const t = setup();
    const resetAt = Date.now() + 60_000;
    t.usage.limitHit(P1, resetAt);
    expect(t.usage.snapshot(P1)).toEqual({ limitHit: true, resetAt, limitedAt: Date.now() });
    vi.setSystemTime(resetAt + 1);
    expect(t.usage.snapshot(P1).limitHit).toBe(false);

    t.usage.limitHit(P1); // no reset time: limited until something clears it
    expect(t.usage.snapshot(P1)).toMatchObject({ limitHit: true });
    t.usage.turnEnded(P1, "c1", null);
    expect(t.usage.snapshot(P1).limitHit).toBe(false);

    t.usage.limitHit(P1);
    t.usage.lifted(P1);
    expect(t.usage.snapshot(P1).limitHit).toBe(false);
  });

  it("a limit right after a turn's tokens still counts (same millisecond)", () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 13, 10, 0, 0) });
    const t = setup();
    t.usage.turnEnded(P1, "c1", { inputTokens: 5, outputTokens: 5 });
    t.usage.limitHit(P1, Date.now() + 1000);
    expect(t.usage.snapshot(P1)).toMatchObject({ limitHit: true, inputTokens: 5 });
  });

  it("counts only today's tokens", () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 12, 23, 0, 0) });
    const t = setup();
    t.usage.turnEnded(P1, "c1", { inputTokens: 50, outputTokens: 50 });
    vi.setSystemTime(new Date(2026, 9, 13, 1, 0, 0));
    t.usage.turnEnded(P1, "c1", { inputTokens: 60, outputTokens: 70 });
    expect(t.usage.snapshot(P1)).toEqual({ limitHit: false, inputTokens: 10, outputTokens: 20 });
  });
});
