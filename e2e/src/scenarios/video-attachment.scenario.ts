import assert from "node:assert/strict";
import { join } from "node:path";

import { FIXTURES } from "../harness.ts";
import type { TScenario } from "../scenario.ts";

export const videoAttachment: TScenario = {
  n: 34,
  title: "A video for the agent",
  summary: "An attached video reaches the agent as key frames; one ffmpeg can't read is explained",
  covers: [
    "Phase 5d: video attachments become JPEG key frames through ffmpeg on the computer",
    "Phase 5d: a video that can't be read leaves a note for the agent and a warning in the chat",
  ],
  async run(h) {
    const ids = await h.quickstart();
    const upload = async (file: string): Promise<{ blobId: string; mime: string; size: number }> => {
      const { stdout } = await h.cli(["dev", "blob", join(FIXTURES, file)], {
        show: `agentdeck dev blob e2e/fixtures/${file}`,
      });
      return JSON.parse(stdout) as { blobId: string; mime: string; size: number };
    };

    h.step("Attach a video and ask about it");
    const clip = await upload("clip.mp4");
    let since = h.mark();
    await h.send("chat.send", {
      chatId: ids.chatId,
      text: "What goes wrong in this recording? #script:attachments-report",
      attachments: [clip],
    });
    await h.waitText(ids.chatId, "Received 3 image(s)", since);
    await h.check("the agent got the clip as three JPEG frames", () => {
      assert.equal(clip.mime, "video/mp4");
      assert.match(
        h.agentText(ids.chatId, since),
        /Received 3 image\(s\): image\/jpeg \(\d+ bytes\), image\/jpeg/,
      );
    });
    await h.waitSettled(ids.chatId);

    h.step("Attach a file ffmpeg can't read");
    const broken = await upload("broken.mp4");
    since = h.mark();
    await h.send("chat.send", {
      chatId: ids.chatId,
      text: "And this one? #script:attachments-report",
      attachments: [broken],
    });
    await h.waitText(ids.chatId, "Received 0 image(s)", since);
    await h.check("the chat says why; the agent still gets the message", async () => {
      await h.waitFor(
        (e) =>
          e.type === "chat.item" &&
          e.item.kind === "system" &&
          e.item.text.includes("Couldn't read the attached video"),
        "a warning in the chat",
        { since },
      );
    });
  },
};
