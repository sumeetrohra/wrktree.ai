import { relayErrorSchema } from "@agentdeck/protocol";
import type { Context } from "hono";
import type { z } from "zod";

import type { TDevice } from "#src/modules/directory/index.js";
import type { TFailure } from "#src/shared/failure.types.js";

import type { TRelayDeps } from "./app.types.js";

function bearer(c: Context): string | null {
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

/** ID tokens are JWTs (dotted); device tokens are a single base64url string. */
const isIdToken = (token: string): boolean => token.includes(".");

/** The signed-in account from an ID token bearer, or null. */
export async function signedInAccount(c: Context, deps: TRelayDeps): Promise<string | null> {
  const token = bearer(c);
  if (token === null || !isIdToken(token)) return null;
  const claims = await deps.idTokens.verify(token);
  return claims ? deps.directory.accountFor(claims) : null;
}

/** The device behind a device-token bearer, or null. */
export async function bearerDevice(c: Context, deps: TRelayDeps): Promise<TDevice | null> {
  const token = bearer(c);
  if (token === null || isIdToken(token)) return null;
  return deps.directory.deviceByToken(token);
}

/** Whoever is calling: a signed-in user, or a device on an account. */
export async function caller(
  c: Context,
  deps: TRelayDeps,
): Promise<{ accountId: string; device: TDevice | null } | null> {
  const device = await bearerDevice(c, deps);
  if (device) return { accountId: device.accountId, device };
  const accountId = await signedInAccount(c, deps);
  return accountId === null ? null : { accountId, device: null };
}

export const BAD_REQUEST: TFailure = { status: 400, error: "invalid request" };
export const UNAUTHORIZED: TFailure = { status: 401, error: "unauthorized" };
