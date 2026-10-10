import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AgentdeckError, type BlobRef } from "@agentdeck/protocol";

const HEX64 = /^[0-9a-f]{64}$/;

/** Content-addressed store for attachments and large diffs: `blobs/<sha256>` plus a small meta file. */
export class BlobStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  put(bytes: Buffer, mime: string): BlobRef {
    const blobId = createHash("sha256").update(bytes).digest("hex");
    const file = join(this.dir, blobId);
    if (!existsSync(file)) {
      writeFileSync(file, bytes);
      writeFileSync(`${file}.json`, JSON.stringify({ mime, size: bytes.length }));
    }
    return { blobId, mime, size: bytes.length };
  }

  get(blobId: string): { ref: BlobRef; bytes: Buffer } {
    const file = join(this.dir, blobId);
    if (!HEX64.test(blobId) || !existsSync(file)) throw new AgentdeckError("NOT_FOUND", `No blob ${blobId}`);
    const meta = JSON.parse(readFileSync(`${file}.json`, "utf8")) as { mime: string; size: number };
    return { ref: { blobId, mime: meta.mime, size: meta.size }, bytes: readFileSync(file) };
  }
}
