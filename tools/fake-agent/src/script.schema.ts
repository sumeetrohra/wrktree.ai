import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseJson } from "@agentdeck/shared";
import { z } from "zod";

const toolKind = z.enum([
  "read",
  "edit",
  "delete",
  "move",
  "search",
  "execute",
  "think",
  "fetch",
  "switch_mode",
  "other",
]);
const toolStatus = z.enum(["pending", "in_progress", "completed", "failed"]);
const count = z.coerce.number().int().nonnegative();

/** One step of a fake-agent script (`scripts/<name>.json`), after `{{var}}` substitution. */
const stepSchema = z.union([
  z.object({ text: z.string() }),
  z.object({ stream: z.string(), chunkMs: count.optional(), words: count.optional() }),
  z.object({ thought: z.string() }),
  z.object({
    plan: z.array(z.object({ text: z.string(), status: z.enum(["pending", "in_progress", "completed"]) })),
  }),
  z.object({
    tool: z.object({
      id: z.string(),
      title: z.string(),
      kind: toolKind,
      locations: z.array(z.string()).optional(),
    }),
  }),
  z.object({ toolUpdate: z.object({ id: z.string(), status: toolStatus }) }),
  z.object({
    permission: z.object({ toolId: z.string(), title: z.string(), kind: toolKind, path: z.string() }),
  }),
  z.object({
    write: z.object({
      path: z.string(),
      content: z.string().optional(),
      bytes: count.optional(),
      toolId: z.string().optional(),
    }),
  }),
  z.object({ read: z.object({ path: z.string() }) }),
  z.object({ sleep: count }),
  z.object({ crash: z.literal(true) }),
  z.object({ crashForever: z.literal(true) }),
  z.object({ limit: z.object({ resetInMs: count }) }),
  z.object({ echoAttachments: z.literal(true) }),
  z.object({ echo: z.literal(true) }),
  /** Reports whether an env var reached the agent (never its value). */
  z.object({ envReport: z.string() }),
  /** Names the MCP servers the session was given. */
  z.object({ mcpReport: z.literal(true) }),
  /** The first line of FAKE.md in its config folder (the shared instructions, Phase 4c). */
  z.object({ instructionsReport: z.literal(true) }),
]);
export type TStep = z.infer<typeof stepSchema>;

export type TVars = Record<string, string>;

function fill(template: string, vars: TVars): string {
  return template.replace(
    // eslint-disable-next-line security/detect-unsafe-regex -- reason: matches our own script templates, not user input
    /\{\{(\w+)(?:\|([^}]*))?\}\}/g,
    (_m, key: string, fallback?: string) => vars[key] ?? fallback ?? "",
  );
}

/** Substitute `{{var|default}}` in every string of a raw (unvalidated) step. */
function fillValue(value: unknown, vars: TVars): unknown {
  if (typeof value === "string") return fill(value, vars);
  if (Array.isArray(value)) return value.map((v: unknown) => fillValue(v, vars));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillValue(v, vars)]));
  }
  return value;
}

/** Loads `scripts/<name>.json`, fills in `vars`, and validates every step. */
export function loadScript(dir: string, name: string, vars: TVars): TStep[] {
  const raw = parseJson(z.array(z.unknown()), readFileSync(join(dir, `${name}.json`), "utf8"));
  return raw.map((step) => stepSchema.parse(fillValue(step, vars)));
}
