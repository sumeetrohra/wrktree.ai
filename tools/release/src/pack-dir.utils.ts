import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** First bytes of a packed folder. */
export const PACK_MAGIC = "ADPK1\n";

type TEntry = { p: string; s: number; m: number };

/**
 * A folder as one buffer, for the single-file build's asset (Phase 5f): `PACK_MAGIC`, the index's
 * length (u32 LE), the index (JSON: path with `/`, size, mode), then the files' bytes in order.
 * Symlinks (`node_modules/.bin`) are left out; modes keep executables (ripgrep, node-pty's helper)
 * runnable.
 */
export function packDir(dir: string): Buffer {
  const entries: TEntry[] = [];
  const parts: Buffer[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const full = join(d, name);
      const st = lstatSync(full);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        if (name === ".bin") continue;
        walk(full);
        continue;
      }
      const bytes = readFileSync(full);
      entries.push({ p: relative(dir, full).split(sep).join("/"), s: bytes.length, m: st.mode & 0o777 });
      parts.push(bytes);
    }
  };
  walk(dir);
  const index = Buffer.from(JSON.stringify(entries));
  const length = Buffer.alloc(4);
  length.writeUInt32LE(index.length);
  return Buffer.concat([Buffer.from(PACK_MAGIC), length, index, ...parts]);
}
