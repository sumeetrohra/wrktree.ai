import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EventBus, topicMatches } from "./bus.js";
import { openDb } from "./db/index.js";

const status = (chatId: string, s: "idle" | "running") => ({
  type: "chat.status" as const,
  chatId,
  status: s,
});

describe("EventBus", () => {
  it("numbers events per topic and replays after a cursor", () => {
    const dir = mkdtempSync(join(tmpdir(), "bus-"));
    const bus = new EventBus(join(dir, "events"), openDb(join(dir, "db")));
    bus.publish("chat:a", status("a", "running"));
    bus.publish("chat:a", status("a", "idle"));
    bus.publish("chat:b", status("b", "running"));
    expect(bus.cursor("chat:a")).toBe(2);
    expect(bus.replay("chat:a", 1).map((e) => e.cursor)).toEqual([2]);
    expect(bus.replay("chat:a", 0).map((e) => e.event)).toEqual([
      status("a", "running"),
      status("a", "idle"),
    ]);
    expect(bus.topics("chat:*")).toEqual(["chat:a", "chat:b"]);
  });

  it("recovers cursors from the log files after a restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "bus-"));
    const db = openDb(join(dir, "db"));
    const a = new EventBus(join(dir, "events"), db);
    a.publish("global", status("x", "idle"));
    a.publish("global", status("x", "idle"));
    const b = new EventBus(join(dir, "events"), db);
    expect(b.cursor("global")).toBe(2);
    expect(b.publish("global", status("x", "running")).cursor).toBe(3);
  });

  it("delivers live events to listeners", () => {
    const dir = mkdtempSync(join(tmpdir(), "bus-"));
    const bus = new EventBus(join(dir, "events"), openDb(join(dir, "db")));
    const seen: number[] = [];
    const off = bus.on((e) => seen.push(e.cursor));
    bus.publish("repo:r", status("a", "idle"));
    off();
    bus.publish("repo:r", status("a", "idle"));
    expect(seen).toEqual([1]);
  });
});

describe("topicMatches", () => {
  it("matches exact topics and prefix wildcards", () => {
    expect(topicMatches("chat:*", "chat:abc")).toBe(true);
    expect(topicMatches("chat:*", "repo:abc")).toBe(false);
    expect(topicMatches("global", "global")).toBe(true);
    expect(topicMatches("chat:a", "chat:ab")).toBe(false);
  });
});
