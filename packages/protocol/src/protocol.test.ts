import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { commandNames, commands, DaemonEvent, Inner, type CommandName } from "./index.js";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"));

const commandFixtures = fixture("commands.json") as Record<string, { args: unknown; result: unknown }>;
const eventFixtures = fixture("events.json") as unknown[];

describe("command fixtures", () => {
  it("cover every command", () => {
    expect(Object.keys(commandFixtures).sort()).toEqual([...commandNames].sort());
  });

  it.each(commandNames)("%s args and result round-trip", (name: CommandName) => {
    const f = commandFixtures[name]!;
    const args = commands[name].args.parse(f.args);
    const result = commands[name].result.parse(f.result);
    expect(JSON.parse(JSON.stringify(args))).toEqual(f.args);
    expect(JSON.parse(JSON.stringify(result))).toEqual(f.result);
  });
});

describe("event fixtures", () => {
  it("cover every event type", () => {
    const types = new Set(eventFixtures.map((e) => (e as { type: string }).type));
    const all = DaemonEvent.options.map((o) => o.shape.type.value);
    expect([...types].sort()).toEqual([...new Set(all)].sort());
  });

  it.each(eventFixtures.map((e, i) => [i, e] as const))(
    "event %i round-trips inside an evt frame",
    (_i, e) => {
      const frame = Inner.parse({ t: "evt", topic: "chat:x", cursor: 1, event: e });
      expect(JSON.parse(JSON.stringify(frame))).toEqual({ t: "evt", topic: "chat:x", cursor: 1, event: e });
    },
  );
});

describe("rejects bad input", () => {
  it("rejects ids with the wrong prefix", () => {
    expect(() => commands["chat.cancel"].args.parse({ chatId: "wt_01J9Z8Y7X6W5V4T3S2R1Q0P9N8" })).toThrow();
  });
  it("rejects unknown inner frames", () => {
    expect(Inner.safeParse({ t: "nope" }).success).toBe(false);
  });
});
