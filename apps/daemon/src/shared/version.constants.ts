import { readFileSync } from "node:fs";

import { tryParseJson } from "@agentdeck/shared";
import { z } from "zod";

const manifestSchema = z.object({ name: z.string(), version: z.string() });

/**
 * The version, from the nearest package.json that is ours: `apps/daemon` in a checkout, or the
 * `agentdeck` npm package around the bundle. Changesets bumps them together.
 */
function readVersion(): string {
  for (const rel of ["../../package.json", "../package.json"]) {
    try {
      const m = tryParseJson(manifestSchema, readFileSync(new URL(rel, import.meta.url), "utf8"));
      if (m && (m.name === "@agentdeck/daemon" || m.name === "agentdeck")) return m.version;
    } catch {
      // not there
    }
  }
  return "0.0.0";
}

export const DAEMON_VERSION = readVersion();
