import { decodeJwt } from "jose";

import type { IIdTokenVerifier, TIdentityClaims } from "#src/shared/id-token.types.js";

/**
 * ID tokens from the Firebase Auth emulator, which are not signed. Trusted only on a dev relay
 * (`RELAY_DEV=1`) that was pointed at the emulator; checks project, expiry and subject.
 */
export class EmulatorIdTokens implements IIdTokenVerifier {
  constructor(private readonly projectId: string) {}

  verify(token: string): Promise<TIdentityClaims | null> {
    try {
      const p = decodeJwt(token);
      const ok =
        p.iss === `https://securetoken.google.com/${this.projectId}` &&
        p.aud === this.projectId &&
        typeof p.exp === "number" &&
        p.exp * 1000 > Date.now() &&
        typeof p.sub === "string" &&
        p.sub !== "";
      if (!ok || typeof p.sub !== "string") return Promise.resolve(null);
      const email = p["email"];
      return Promise.resolve({ uid: p.sub, email: typeof email === "string" ? email : null });
    } catch {
      return Promise.resolve(null);
    }
  }
}
