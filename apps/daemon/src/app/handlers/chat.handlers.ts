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
    "chat.send": async (a) => {
      if (!a.context?.length) return m.sessions.send(a.chatId, a.text, a.attachments);
      // Quoted lines are read now, through the worktree's jail (SEC2), so the prompt shows what the user saw.
      const jail = m.jailFor(m.sessions.get(a.chatId).worktreeId);
      const quotes = await Promise.all(a.context.map((c) => jail.quote(c.path, c.line, c.endLine)));
      return m.sessions.send(a.chatId, a.text, a.attachments, {
        context: a.context,
        quoted: quotes.join("\n\n"),
      });
    },
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
