import { jwtVerify, SignJWT } from "jose";

import { RELAY_LIMITS } from "#src/shared/relay.constants.js";

const ISSUER = "agentdeck-relay";

/** Account sessions and OAuth state tokens, HS256 with the relay's secret. */
export class JwtService {
  private readonly key: Uint8Array;

  constructor(secret: string) {
    this.key = new TextEncoder().encode(secret);
  }

  async issueSession(accountId: string, nowMs: number): Promise<{ sessionToken: string; expiresAt: number }> {
    const expiresAt = nowMs + RELAY_LIMITS.sessionTtlMs;
    const sessionToken = await new SignJWT({ typ: "session" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(accountId)
      .setIssuer(ISSUER)
      .setIssuedAt(Math.floor(nowMs / 1000))
      .setExpirationTime(Math.floor(expiresAt / 1000))
      .sign(this.key);
    return { sessionToken, expiresAt };
  }

  /** The account id, or null for anything expired, forged or of another type. */
  async verifySession(token: string): Promise<string | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: ISSUER, algorithms: ["HS256"] });
      return payload["typ"] === "session" && typeof payload.sub === "string" ? payload.sub : null;
    } catch {
      return null;
    }
  }

  async issueState(nowMs: number): Promise<string> {
    return new SignJWT({ typ: "oauth-state" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(ISSUER)
      .setExpirationTime(Math.floor(nowMs / 1000) + 600)
      .sign(this.key);
  }

  async verifyState(state: string): Promise<boolean> {
    try {
      const { payload } = await jwtVerify(state, this.key, { issuer: ISSUER, algorithms: ["HS256"] });
      return payload["typ"] === "oauth-state";
    } catch {
      return false;
    }
  }
}
