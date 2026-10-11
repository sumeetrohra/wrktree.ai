import { sep } from "node:path";

const CASE_INSENSITIVE = process.platform === "win32" || process.platform === "darwin";

const norm = (p: string): string => (CASE_INSENSITIVE ? p.toLowerCase() : p);

/** True when absolute path `p` is `root` or inside it (both already realpath'd). */
export function isInside(root: string, p: string): boolean {
  return norm(p) === norm(root) || norm(p).startsWith(norm(root) + sep);
}
