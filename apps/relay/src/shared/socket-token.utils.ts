import { RELAY_TOKEN_PROTOCOL_PREFIX } from "@agentdeck/protocol";

/** The token from `Authorization: Bearer` or the `agentdeck.token.<token>` subprotocol (browsers). */
export function socketToken(authorization: string | undefined, protocols: string | undefined): string | null {
  if (authorization?.startsWith("Bearer ")) return authorization.slice(7);
  const p = (protocols ?? "")
    .split(",")
    .map((s) => s.trim())
    .find((s) => s.startsWith(RELAY_TOKEN_PROTOCOL_PREFIX));
  return p === undefined ? null : p.slice(RELAY_TOKEN_PROTOCOL_PREFIX.length);
}
