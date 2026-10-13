import { npm } from "./npm.utils.js";

/** Publishes a built package unless npm already has this version (re-runs are safe). */
export function publishIfNew(dir: string, name: string, version: string): "published" | "exists" {
  try {
    if (npm(["view", `${name}@${version}`, "version"], dir).trim() === version) return "exists";
  } catch {
    // Not on npm yet (404): publish it.
  }
  npm(["publish", "--access", "public", "--provenance"], dir);
  return "published";
}
