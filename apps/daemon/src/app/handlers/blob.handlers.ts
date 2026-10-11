import { AgentdeckError } from "@agentdeck/protocol";

import type { THandlers } from "#src/infra/rpc/index.js";

import type { TModules } from "../app.types.js";

export function blobHandlers(m: TModules): Pick<THandlers, "blob.put" | "blob.get"> {
  return {
    "blob.put": (a, ctx) => {
      const bytes = ctx.takeUpload(a.uploadId);
      if (!bytes) throw new AgentdeckError("NOT_FOUND", `No completed upload ${a.uploadId}`);
      if (bytes.length !== a.size) {
        throw new AgentdeckError("INVALID_ARGS", `Upload is ${String(bytes.length)} bytes, expected ${String(a.size)}`);
      }
      return m.blobs.put(bytes, a.mime);
    },
    "blob.get": (a) => {
      const { ref, bytes } = m.blobs.get(a.blobId);
      return { blob: ref, base64: bytes.toString("base64") };
    },
  };
}
