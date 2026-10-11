import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FileJail } from "./file-jail.service.js";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "jail-"));
  const root = join(dir, "wt");
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, "src", "a.ts"), "export const a = 1;\n");
  writeFileSync(join(root, ".env.local"), "SECRET=1\n");
  writeFileSync(join(root, "key.pem"), "---\n");
  writeFileSync(join(dir, "outside.txt"), "outside\n");
  if (process.platform !== "win32") symlinkSync(join(dir, "outside.txt"), join(root, "link.txt"));
  return { dir, root, jail: new FileJail(root) };
}

describe("FileJail", () => {
  it("resolves paths inside the worktree", () => {
    const { jail } = fixture();
    expect(jail.resolve("src/a.ts").rel).toBe("src/a.ts");
    expect(jail.resolve("src/../src/a.ts").rel).toBe("src/a.ts");
  });

  it.each(["../outside.txt", "src/../../outside.txt", ".git/config", ".env.local", "key.pem"])(
    "rejects %s",
    (p) => {
      const { jail } = fixture();
      expect(() => jail.resolve(p)).toThrow(expect.objectContaining({ code: "FORBIDDEN_PATH" }));
    },
  );

  it("rejects absolute paths from clients but takes them from agents when inside", () => {
    const { jail, root, dir } = fixture();
    expect(() => jail.resolve(join(root, "src/a.ts"))).toThrow(
      expect.objectContaining({ code: "FORBIDDEN_PATH" }),
    );
    expect(jail.resolve(join(root, "src/a.ts"), { allowAbsolute: true }).rel).toBe("src/a.ts");
    expect(() => jail.resolve(join(dir, "outside.txt"), { allowAbsolute: true })).toThrow(
      expect.objectContaining({ code: "FORBIDDEN_PATH" }),
    );
  });

  it.skipIf(process.platform === "win32")("rejects symlink escapes and hides them from the tree", () => {
    const { jail } = fixture();
    expect(() => jail.resolve("link.txt")).toThrow(expect.objectContaining({ code: "FORBIDDEN_PATH" }));
    expect(jail.tree().map((e) => e.name)).toEqual(["src"]);
  });

  it("refuses agent writes that leave the worktree", async () => {
    const { jail, dir } = fixture();
    await expect(jail.agentWrite(join(dir, "evil.txt"), "x")).rejects.toMatchObject({
      code: "FORBIDDEN_PATH",
    });
    await expect(jail.agentWrite(join(jail.root, "new", "file.txt"), "ok")).resolves.toBeUndefined();
  });
});
