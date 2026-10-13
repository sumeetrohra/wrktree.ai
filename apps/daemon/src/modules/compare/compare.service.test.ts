import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { TLoggedEvent } from "@agentdeck/protocol";
import { newId, silentLogger } from "@agentdeck/shared";
import { describe, expect, it } from "vitest";

import { EventBus } from "#src/infra/bus/index.js";
import { openDb } from "#src/infra/db/index.js";
import type { TRuntime } from "#src/infra/runtime/index.js";
import { pathsFor } from "#src/shared/paths.utils.js";

import { CompareService } from "./compare.service.js";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "compare-"));
  const db = openDb(join(dir, "db"));
  const bus = new EventBus(join(dir, "events"), db);
  const rt = { db, bus, log: silentLogger, paths: pathsFor(dir), opts: {} } as TRuntime;
  const events: TLoggedEvent[] = [];
  bus.on((e) => events.push(e));
  return { compares: new CompareService(rt), events };
}

describe("CompareService", () => {
  it("records a compare, settles each entry, and picks a winner", () => {
    const { compares, events } = setup();
    const repoId = newId("repo");
    const [wt1, wt2, wt3] = [newId("wt"), newId("wt"), newId("wt")];
    const [p1, p2] = [newId("prof"), newId("prof")];
    const c = compares.create({
      repoId,
      title: "Dark mode",
      prompt: "Add a dark mode toggle",
      baseRef: "main",
      entries: [
        { profileId: p1, agent: "claude", worktreeId: wt1 },
        { profileId: p2, agent: "codex", model: "gpt-5", worktreeId: wt2 },
        { profileId: p2, agent: "codex", worktreeId: wt3 },
      ],
    });
    expect(c.entries.map((e) => [e.worktreeId, e.chatId, e.model])).toEqual([
      [wt1, null, undefined],
      [wt2, null, "gpt-5"],
      [wt3, null, undefined],
    ]);
    expect(compares.waiting(wt2)).toMatchObject({
      target: { profileId: p2, agent: "codex", model: "gpt-5" },
    });

    const chatId = newId("chat");
    compares.settle(wt1, { chatId });
    compares.settle(wt3, { error: "Setup failed" });
    expect(compares.waiting(wt1)).toBeNull();
    expect(compares.waiting(wt3)).toBeNull();
    expect(compares.get(c.id).entries.map((e) => [e.chatId, e.error])).toEqual([
      [chatId, null],
      [null, null],
      [null, "Setup failed"],
    ]);

    expect(() => compares.pick(c.id, newId("wt"))).toThrow(/isn't part/);
    expect(compares.pick(c.id, wt1).winner).toBe(wt1);
    expect(compares.list(repoId).map((x) => x.id)).toEqual([c.id]);
    expect(
      events.filter((e) => e.topic === `repo:${repoId}` && e.event.type === "compare.updated"),
    ).toHaveLength(4);
  });
});
