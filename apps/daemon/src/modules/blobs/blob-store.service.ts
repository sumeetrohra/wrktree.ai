import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { AgentdeckError, type TBlobRef } from "@agentdeck/protocol";
import { parseJson } from "@agentdeck/shared";
import { z } from "zod";

const HEX64 = /^[0-9a-f]{64}$/;
const metaSchema = z.object({ mime: z.string(), size: z.number().int().nonnegative() });

/** Content-addressed store for attachments and large diffs: `blobs/<sha256>` plus a small meta file. */
export class BlobStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  put(bytes: Buffer, mime: string): TBlobRef {
    const blobId = createHash("sha256").update(bytes).digest("hex");
    const file = join(this.dir, blobId);
    if (!existsSync(file)) {
      writeFileSync(file, bytes);
      writeFileSync(`${file}.json`, JSON.stringify({ mime, size: bytes.length }));
    }
    return { blobId, mime, size: bytes.length };
  }

  get(blobId: string): { ref: TBlobRef; bytes: Buffer } {
    const file = join(this.dir, blobId);
    if (!HEX64.test(blobId) || !existsSync(file)) throw new AgentdeckError("NOT_FOUND", `No blob ${blobId}`);
    const meta = parseJson(metaSchema, readFileSync(`${file}.json`, "utf8"));
    return { ref: { blobId, mime: meta.mime, size: meta.size }, bytes: readFileSync(file) };
  }
}
