import {
  authFinishBodySchema,
  authSessionSchema,
  authStartBodySchema,
  githubFinishBodySchema,
  githubStartResultSchema,
  okResultSchema,
  relayRoutes,
} from "@agentdeck/protocol";
import type { Hono } from "hono";

import type { TRelayDeps } from "../app.types.js";
import { BAD_REQUEST, body, failure, sessionAccount, UNAUTHORIZED } from "../http.utils.js";

export function authRoutes(app: Hono, deps: TRelayDeps): void {
  const session = async (accountId: string) =>
    authSessionSchema.parse({ accountId, ...(await deps.jwt.issueSession(accountId, deps.clock.now())) });

  app.post(relayRoutes.authStart.path, async (c) => {
    const b = await body(c, authStartBodySchema);
    if (!b) return failure(c, BAD_REQUEST);
    const code = await deps.directory.startMagic(b.email);
    await deps.mailer.sendCode(b.email, code);
    return c.json(okResultSchema.parse({ ok: true }));
  });

  app.post(relayRoutes.authFinish.path, async (c) => {
    const b = await body(c, authFinishBodySchema);
    if (!b) return failure(c, BAD_REQUEST);
    const result = await deps.directory.finishMagic(b.email, b.code);
    if (!result.ok) return failure(c, result.error);
    return c.json(await session(result.value));
  });

  app.post(relayRoutes.authRefresh.path, async (c) => {
    const accountId = await sessionAccount(c, deps);
    if (accountId === null) return failure(c, UNAUTHORIZED);
    return c.json(await session(accountId));
  });

  app.post(relayRoutes.githubStart.path, async (c) => {
    const state = await deps.jwt.issueState(deps.clock.now());
    return c.json(githubStartResultSchema.parse({ url: deps.oauth.authorizeUrl(state), state }));
  });

  app.post(relayRoutes.githubFinish.path, async (c) => {
    const b = await body(c, githubFinishBodySchema);
    if (!b) return failure(c, BAD_REQUEST);
    if (!(await deps.jwt.verifyState(b.state))) return failure(c, UNAUTHORIZED);
    let githubId: string;
    try {
      githubId = await deps.oauth.exchange(b.code);
    } catch {
      return failure(c, UNAUTHORIZED);
    }
    return c.json(await session(await deps.directory.accountForGithub(githubId)));
  });
}
