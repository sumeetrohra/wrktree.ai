import { toB64 } from "@agentdeck/crypto";

/** sha256, base64url. Tokens and codes are stored only as hashes. */
export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return toB64(new Uint8Array(digest));
}

export function randomToken(bytes = 32): string {
  return toB64(crypto.getRandomValues(new Uint8Array(bytes)));
}
