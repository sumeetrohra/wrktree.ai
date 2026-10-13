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

/** `"Do it #script:golden file=NOTES.md"` → script `golden`, vars `{ file: "NOTES.md", text: "Do it" }`. */
export function parsePrompt(prompt: readonly acp.ContentBlock[]): TParsedPrompt {
  const text = prompt.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
  const images = prompt.flatMap((b) =>
    b.type === "image" ? [{ mimeType: b.mimeType, bytes: Buffer.from(b.data, "base64").length }] : [],
  );
  const words = text.split(/\s+/).filter(Boolean);
  const scriptAt = words.findIndex((w) => SCRIPT_TOKEN.test(w));
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
