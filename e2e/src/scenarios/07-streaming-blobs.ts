import assert from "node:assert/strict";
import type { Scenario } from "../scenario.ts";

export const streamingBlobs: Scenario = {
  n: 7,
  title: "Streaming & large payloads",
  summary: "Streaming text is coalesced to ≤ 20 patches/s; replies over 64 KB travel as 256 KB blob parts",
  covers: [
    "Delivery rules: chat.itemPatch ≤ 20/s per chat; inner frames above 64 KB go as blobs in 256 KB parts",
  ],
  async run(h) {
    h.step("Set up a chat");
    const ids = await h.quickstart();
    const chat = ids.chatId;

    h.step("Stream 400 words, one chunk every 2 ms");
    let since = h.mark();
    await h.send("chat.send", { chatId: chat, text: "#script:stream words=400 chunkMs=2" });
    await h.waitText(chat, "(end)", since);
    await h.waitSettled(chat);
    const idx = [...h.events.keys()].slice(since);
    const firstIdx = idx.find((i) => {
      const e = h.events[i]!.event;
      return e.type === "chat.item" && e.chatId === chat && e.item.kind === "agent_text";
    })!;
    const first = h.events[firstIdx]!.event;
    const itemId = first.type === "chat.item" ? first.item.id : "";
    const patchIdx = idx.filter((i) => {
      const e = h.events[i]!.event;
      return e.type === "chat.itemPatch" && e.itemId === itemId;
    });
    const spanMs = h.arrivals[patchIdx.at(-1)!]! - h.arrivals[firstIdx]!;
    await h.check("every word arrives", () =>
      assert.equal(h.agentText(chat, since).match(/word\d+/g)?.length, 400),
    );
    await h.check(
      `${patchIdx.length} patches over ${(spanMs / 1000).toFixed(1)} s: at most 20 per second`,
      () => {
        assert.ok(patchIdx.length > 0);
        assert.ok(patchIdx.length < 400 / 4, "chunks are coalesced");
        assert.ok(
          patchIdx.length <= Math.ceil(spanMs / 50) + 2,
          `${patchIdx.length} patches in ${spanMs} ms`,
        );
      },
    );

    h.step("The agent writes a 400 KB file");
    since = h.mark();
    await h.send("chat.send", { chatId: chat, text: "#script:big-file bytes=400000" });
    await h.waitSettled(chat);
    const diff = await h.send("diff.file", { worktreeId: ids.worktreeId, path: "big.txt" });
    await h.check("the diff blob is over 64 KB", () => assert.ok(diff.blob.size > 64 * 1024));

    h.step("Download it: the reply travels as blob frames");
    const before = h.client.stats.blobFrames;
    const got = await h.client.call("blob.get", { blobId: diff.blob.blobId });
    const parts = h.client.stats.blobFrames - before;
    h.sink.write(
      "cmd",
      `\x1b[90m  blob.get → ${parts} blob frames + 1 res frame, ${Math.round(got.base64.length / 1024)} KB of JSON reassembled\x1b[0m\r\n`,
    );
    await h.check(`the reply arrived as ${parts} blob parts of ≤ 256 KB and reassembled`, () => {
      assert.ok(parts >= 2);
      assert.equal(Buffer.from(got.base64, "base64").length, diff.blob.size);
    });

    h.step("Search the new file with ripgrep");
    const found = await h.send("fs.search", { worktreeId: ids.worktreeId, query: "line 001200" });
    await h.check("the match is on line 1200 of big.txt", () =>
      assert.deepEqual(
        found.matches.map((m) => [m.path, m.line]),
        [["big.txt", 1200]],
      ),
    );

    h.step("Upload a 300 KB attachment in parts");
    const bytes = Buffer.alloc(300 * 1024, 7);
    const ref = await h.client.upload(bytes, "application/octet-stream");
    const sent = Math.ceil(bytes.length / (256 * 1024));
    h.sink.write(
      "cmd",
      `\x1b[90m  blob.put ← ${sent} blob frames (256 KB parts) → sha256 ${ref.blobId.slice(0, 12)}…\x1b[0m\r\n`,
    );
    await h.check("the upload is stored content-addressed", () => assert.equal(ref.size, 300 * 1024));
  },
};
