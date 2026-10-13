import { BLOB_PART_SIZE } from "@agentdeck/protocol";

import { InnerClient } from "./inner-client";

describe("InnerClient.sendBlob", () => {
  const sent: { at: number; frame: { t: string; part: number; last: boolean } }[] = [];
  const client = new InnerClient((text) => {
    sent.push({ at: Date.now(), frame: JSON.parse(text) as { t: string; part: number; last: boolean } });
    return true;
  });
  /** Three and a half parts' worth of base64. */
  const base64 = "A".repeat(Math.ceil(((BLOB_PART_SIZE * 3.5) / 3) * 4));

  beforeEach(() => {
    sent.length = 0;
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("writes every part at once on the local connection", async () => {
    const { size } = await client.sendBlob(base64);
    expect(sent.map((s) => s.frame.part)).toEqual([0, 1, 2, 3]);
    expect(sent.at(-1)?.frame.last).toBe(true);
    expect(size).toBe((base64.length / 4) * 3);
  });

  it("spaces the parts out when asked (the relay's per-device budget)", async () => {
    const done = client.sendBlob(base64, 2);
    await jest.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(500);
    expect(sent).toHaveLength(2);
    await jest.advanceTimersByTimeAsync(1000);
    await done;
    expect(sent.map((s) => s.frame.part)).toEqual([0, 1, 2, 3]);
    expect((sent.at(-1)?.at ?? 0) - (sent[0]?.at ?? 0)).toBe(1500);
  });
});
