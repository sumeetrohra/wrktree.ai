import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

import { tryParseJson } from "@agentdeck/shared";
import type { z } from "zod";

import type { TVault } from "./identity.service.js";

/** A small JSON value kept sealed on disk (mode 0600), e.g. the relay device token. */
export class SealedFile<S extends z.ZodType> {
  constructor(
    private readonly path: string,
    private readonly vault: TVault,
    private readonly schema: S,
  ) {}

  /** The value, or null when missing, sealed with another secret, or malformed. */
  read(): z.infer<S> | null {
    if (!existsSync(this.path)) return null;
    const plain = this.vault.open(readFileSync(this.path, "utf8"));
    return plain === null ? null : (tryParseJson(this.schema, plain) ?? null);
  }

  write(value: z.infer<S>): void {
    rmSync(this.path, { force: true });
    writeFileSync(this.path, this.vault.seal(JSON.stringify(value)), { mode: 0o600, flag: "wx" });
  }

  clear(): void {
    rmSync(this.path, { force: true });
  }
}
