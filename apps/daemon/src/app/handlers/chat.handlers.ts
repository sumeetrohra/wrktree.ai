import type { THandlers } from "#src/infra/rpc/index.js";

import type { TModules } from "../app.types.js";

export function chatHandlers(
  m: TModules,
): Pick<
  THandlers,
  "chat.list" | "chat.create" | "chat.send" | "chat.cancel" | "chat.retry" | "permission.respond"
> {
  return {
    "chat.list": (a) => m.sessions.list(a.worktreeId),
    "chat.create": (a) => m.sessions.create(a),
    "chat.send": (a) => m.sessions.send(a.chatId, a.text, a.attachments),
    "chat.cancel": async (a) => {
      await m.sessions.cancel(a.chatId);
      return {};
    },
    "chat.retry": (a) => m.sessions.retry(a.chatId),
    "permission.respond": (a) => {
      m.sessions.respond(a.chatId, a.requestId, a.decision, a.message);
      return {};
    },
  };
}
