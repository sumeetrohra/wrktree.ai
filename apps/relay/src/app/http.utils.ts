import { relayErrorSchema } from "@agentdeck/protocol";
import type { Context } from "hono";
import type { z } from "zod";

import type { TFailure } from "#src/shared/failure.types.js";

import type { TRelayDeps } from "./app.types.js";

export function bearer(c: Context): string | null {
  const h = c.req.header("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7) : null;
}

export function failure(c: Context, f: TFailure): Response {
  return c.json(relayErrorSchema.parse({ error: f.error }), f.status);
}

/** The JSON body validated against `schema`, or null (the caller answers 400). */
export async function body<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S> | null> {
  try {
    const parsed = schema.safeParse(await c.req.json<unknown>());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function sessionAccount(c: Context, deps: TRelayDeps): Promise<string | null> {
  const token = bearer(c);
  return token === null ? null : deps.jwt.verifySession(token);
}

export const BAD_REQUEST: TFailure = { status: 400, error: "invalid request" };
export const UNAUTHORIZED: TFailure = { status: 401, error: "unauthorized" };
