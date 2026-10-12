import { jwtVerify, SignJWT } from "jose";

import type { IIdTokenVerifier, TIdentityClaims } from "#src/shared/id-token.types.js";

const ISSUER = "agentdeck-dev";
const TTL_S = 60 * 60;

/**
 * A stand-in for Firebase in development and tests (`RELAY_DEV=1` only): HS256 ID tokens for any
 * uid, so tests exercise the same bearer path without a Firebase project.
 */
export class DevIdTokens implements IIdTokenVerifier {
  private readonly key: Uint8Array;

  constructor(secret: string) {
    this.key = new TextEncoder().encode(secret);
  }

  issue(claims: TIdentityClaims, nowMs: number): Promise<string> {
    const iat = Math.floor(nowMs / 1000);
    return new SignJWT(claims.email === null ? {} : { email: claims.email })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(claims.uid)
      .setIssuer(ISSUER)
      .setAudience(ISSUER)
      .setIssuedAt(iat)
      .setExpirationTime(iat + TTL_S)
      .sign(this.key);
  }

  async verify(token: string): Promise<TIdentityClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience: ISSUER,
        algorithms: ["HS256"],
      });
      if (typeof payload.sub !== "string" || payload.sub === "") return null;
      const email = payload["email"];
      return { uid: payload.sub, email: typeof email === "string" ? email : null };
    } catch {
      return null;
    }
  }
}
