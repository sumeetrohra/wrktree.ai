import type * as acp from "@agentclientprotocol/sdk";
import { PR_DRAFT_REQUEST } from "@agentdeck/shared";

import type { TVars } from "./script.schema.js";

export type TParsedPrompt = {
  text: string;
  script: string | null;
  vars: TVars;
  images: { mimeType: string; bytes: number }[];
};

const SCRIPT_TOKEN = /#script:([\w-]+)/;
const VAR_TOKEN = /^(\w+)=(\S+)$/;

/**
 * `"Do it #script:golden file=NOTES.md"` → script `golden`, vars `{ file: "NOTES.md", text: "Do it" }`.
 * The script token counts only in the last paragraph of the last text block.
 */
export function parsePrompt(prompt: readonly acp.ContentBlock[]): TParsedPrompt {
  const blocks = prompt.flatMap((b) => (b.type === "text" ? [b.text] : []));
  const text = blocks.join("\n");
  const images = prompt.flatMap((b) =>
    b.type === "image" ? [{ mimeType: b.mimeType, bytes: Buffer.from(b.data, "base64").length }] : [],
  );
  const words = text.split(/\s+/).filter(Boolean);
  // Only the last paragraph of the last text block picks a script: a resume seed or a hand-off
  // brief quotes earlier prompts, and their `#script:` tokens must not run again.
  const lastParagraph = (blocks.at(-1) ?? "").split(/\n\s*\n/).at(-1) ?? "";
  const scriptAt = SCRIPT_TOKEN.test(lastParagraph) ? words.findLastIndex((w) => SCRIPT_TOKEN.test(w)) : -1;
  const vars: TVars = {};
  const kept: string[] = [];
  words.forEach((w, i) => {
    const pair = i > scriptAt && scriptAt >= 0 ? VAR_TOKEN.exec(w) : null;
    if (pair?.[1] !== undefined && pair[2] !== undefined) vars[pair[1]] = pair[2];
    else if (i !== scriptAt) kept.push(w);
  });
  vars["text"] = kept.join(" ");
  // The daemon's `pr.draft` request gets a scripted draft, like a real agent would write one.
  const script =
    scriptAt >= 0
      ? (SCRIPT_TOKEN.exec(words[scriptAt] ?? "")?.[1] ?? null)
      : text.includes(PR_DRAFT_REQUEST)
        ? "pr-draft"
        : null;
  return { text, script, vars, images };
}
