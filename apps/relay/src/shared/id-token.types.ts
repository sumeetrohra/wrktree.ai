/** Who an ID token says the caller is. `uid` is the account; `email` is for display only. */
export type TIdentityClaims = { uid: string; email: string | null };

/** Verifies a sign-in provider's ID token (Firebase in production, the dev issuer in tests). */
export interface IIdTokenVerifier {
  /** The claims, or null for anything expired, forged or for another project. */
  verify(token: string): Promise<TIdentityClaims | null>;
}
