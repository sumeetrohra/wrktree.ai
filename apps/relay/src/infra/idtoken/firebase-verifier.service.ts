import { createRemoteJWKSet, jwtVerify } from "jose";

import type { IIdTokenVerifier, TIdentityClaims } from "#src/shared/id-token.types.js";

const GOOGLE_JWKS =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

/**
 * Firebase Auth ID tokens: RS256, signed by Google's rotating keys, `iss` and `aud` naming the
 * project. The key set is fetched once and cached by `jose`.
 */
export class FirebaseVerifier implements IIdTokenVerifier {
  private readonly keys = createRemoteJWKSet(new URL(GOOGLE_JWKS));

  constructor(private readonly projectId: string) {}

  async verify(token: string): Promise<TIdentityClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.keys, {
        issuer: `https://securetoken.google.com/${this.projectId}`,
        audience: this.projectId,
        algorithms: ["RS256"],
      });
      if (typeof payload.sub !== "string" || payload.sub === "") return null;
      const email = payload["email"];
      return { uid: payload.sub, email: typeof email === "string" ? email : null };
    } catch {
      return null;
    }
  }
}
