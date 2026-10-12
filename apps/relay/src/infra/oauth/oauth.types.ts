export interface IOAuthProvider {
  authorizeUrl(state: string): string;
  /** The provider's stable user id for an authorization code. Throws when the code is bad. */
  exchange(code: string): Promise<string>;
}
