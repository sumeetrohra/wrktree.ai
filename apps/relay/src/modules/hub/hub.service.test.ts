import { silentLogger } from "@agentdeck/shared";
import { describe, expect, it } from "vitest";

import { openSql } from "#src/infra/sql/index.js";
import { RELAY_LIMITS } from "#src/shared/relay.constants.js";
import type { IHubSockets } from "#src/shared/sockets.types.js";

import { HubService } from "./hub.service.js";

class FakeSockets implements IHubSockets {
  readonly open = new Set<string>();
  readonly sent: { to: string; text: string }[] = [];
  readonly closed: { id: string; code: number }[] = [];
  send(deviceId: string, text: string): boolean {
    if (!this.open.has(deviceId)) return false;
    this.sent.push({ to: deviceId, text });
    return true;
  }
  close(deviceId: string, code: number): void {
    this.open.delete(deviceId);
    this.closed.push({ id: deviceId, code });
  }
  connected(): string[] {
    return [...this.open];
  }
}

function setup() {
  let t = 1_000_000;
  const clock = {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
  const sockets = new FakeSockets();
  const pushes: string[] = [];
  const hub = new HubService(
    openSql(":memory:"),
    sockets,
    { send: (id) => Promise.resolve(void pushes.push(id)) },
    clock,
    silentLogger,
  );
  hub.addMember({ deviceId: "phone", kind: "phone" });
  hub.addMember({ deviceId: "daemon", kind: "daemon" });
  sockets.open.add("daemon");
  const frame = (seq: number, body = "x") =>
    JSON.stringify({ v: 1, from: "daemon", to: "phone", seq, sid: "s", kind: "msg", body });
  return { hub, sockets, clock, pushes, frame };
}

describe("HubService buffer", () => {
  it("drops the oldest frames past the frame cap and tells the recipient about the gap", async () => {
    const { hub, sockets, clock, frame } = setup();
    for (let i = 1; i <= RELAY_LIMITS.bufferFrames + 5; i++) {
      if (i % 100 === 0) clock.advance(1000); // stay under the daemon's rate limit
      await hub.onMessage("daemon", frame(i));
    }
    sockets.open.add("phone");
    hub.onConnect("phone");
    const toPhone = sockets.sent
      .filter((s) => s.to === "phone")
      .map((s) => JSON.parse(s.text) as Record<string, unknown>);
    expect(toPhone[0]).toEqual({ t: "relay.gap", from: "daemon" });
    const seqs = toPhone.slice(1).map((f) => f["seq"]);
    expect(seqs).toHaveLength(RELAY_LIMITS.bufferFrames);
    expect(seqs[0]).toBe(6);
  });

  it("drops frames older than the TTL with a gap marker", async () => {
    const { hub, sockets, clock, frame } = setup();
    await hub.onMessage("daemon", frame(1));
    clock.advance(RELAY_LIMITS.bufferTtlMs + 1);
    sockets.open.add("phone");
    hub.onConnect("phone");
    expect(sockets.sent.filter((s) => s.to === "phone").map((s) => s.text)).toEqual([
      JSON.stringify({ t: "relay.gap", from: "daemon" }),
    ]);
  });

  it("only wakes for `wake` frames, at most once per interval", async () => {
    const { hub, clock, pushes } = setup();
    hub.setPushToken("phone", "tok");
    await hub.onMessage(
      "daemon",
      JSON.stringify({ v: 1, from: "daemon", to: "phone", seq: 1, kind: "msg", body: "x" }),
    );
    expect(pushes).toEqual([]);
    const wake = (seq: number) =>
      JSON.stringify({ v: 1, from: "daemon", to: "phone", seq, kind: "msg", body: "x", wake: true });
    await hub.onMessage("daemon", wake(2));
    await hub.onMessage("daemon", wake(3));
    clock.advance(RELAY_LIMITS.pushIntervalMs + 1);
    await hub.onMessage("daemon", wake(4));
    expect(pushes).toEqual(["phone", "phone"]);
  });

  it("closes a non-member and an oversized frame", async () => {
    const { hub, sockets } = setup();
    sockets.open.add("stranger");
    await hub.onMessage("stranger", "{}");
    await hub.onMessage("daemon", "x".repeat(RELAY_LIMITS.frameBytes + 1));
    expect(sockets.closed.map((c) => c.id)).toEqual(["stranger", "daemon"]);
  });

  it("forgets a removed member's frames", async () => {
    const { hub, sockets, frame } = setup();
    await hub.onMessage("daemon", frame(1));
    hub.removeMember("phone", "revoked");
    hub.addMember({ deviceId: "phone", kind: "phone" });
    sockets.open.add("phone");
    hub.onConnect("phone");
    expect(sockets.sent.filter((s) => s.to === "phone")).toEqual([]);
  });
});
