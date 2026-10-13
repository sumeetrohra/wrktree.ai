import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { defaultHome, pathsFor } from "@agentdeck/daemon";
import { tryParseJson } from "@agentdeck/shared";
import { z } from "zod";

const configSchema = z.looseObject({});

/** Merges settings into the daemon's `config.json` (mode 0600), keeping every other key. */
export function updateConfigFile(patch: Record<string, unknown>): void {
  const file = pathsFor(defaultHome()).config;
  const current = existsSync(file) ? (tryParseJson(configSchema, readFileSync(file, "utf8")) ?? {}) : {};
  writeFileSync(file, JSON.stringify({ ...current, ...patch }, null, 2), { mode: 0o600 });
}
