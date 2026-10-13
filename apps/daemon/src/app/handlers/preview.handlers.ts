import { AgentdeckError } from "@agentdeck/protocol";

import type { TCommandContext, THandlers } from "#src/infra/rpc/index.js";

import type { TModules } from "../app.types.js";

export function previewHandlers(
  m: TModules,
): Pick<
  THandlers,
  "preview.start" | "preview.stop" | "preview.fetch" | "preview.wsOpen" | "preview.wsSend" | "preview.wsClose"
> {
  /** A sealed token works only for the client that started that preview (Phase 5e, SEC26). */
  const owned = (token: string, ctx: TCommandContext): string => {
    if (m.preview.sealedOwner(token) !== ctx.deviceId) {
      throw new AgentdeckError("NOT_FOUND", "This preview is closed.");
    }
    return token;
  };
  const socket = (wsId: string, ctx: TCommandContext): string => {
    const token = m.sealedPreview.socketToken(wsId);
    if (token === null) throw new AgentdeckError("NOT_FOUND", "This WebSocket is closed.");
    owned(token, ctx);
    return wsId;
  };
  return {
    /** The URL depends on who asks: `localhost` here, a relay tunnel only they can open elsewhere. */
    "preview.start": (a, ctx) => m.preview.start(a.worktreeId, ctx.deviceId, a.mode),
    "preview.stop": async (a) => {
      await m.preview.stop(a.worktreeId);
      return {};
    },
    "preview.fetch": (a, ctx) => m.sealedPreview.fetch(owned(a.token, ctx), a),
    "preview.wsOpen": (a, ctx) => ({
      wsId: m.sealedPreview.wsOpen(a.wsId, owned(a.token, ctx), a.path, a.headers),
    }),
    "preview.wsSend": (a, ctx) => {
      m.sealedPreview.wsSend(socket(a.wsId, ctx), a.data, a.binary);
      return {};
    },
    "preview.wsClose": (a, ctx) => {
      m.sealedPreview.wsClose(socket(a.wsId, ctx));
      return {};
    },
  };
}
