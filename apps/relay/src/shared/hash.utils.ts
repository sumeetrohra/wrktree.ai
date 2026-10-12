import { toB64 } from "@agentdeck/crypto";

/** sha256, base64url. Tokens and codes are stored only as hashes. */
export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return toB64(new Uint8Array(digest));
}

export function randomToken(bytes = 32): string {
  return toB64(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** Six random digits, uniformly distributed. */
export function randomCode(): string {
  const max = 4_294_967_295 - (4_294_967_296 % 1_000_000);
  for (;;) {
    const [n = 0] = crypto.getRandomValues(new Uint32Array(1));
    if (n <= max) return String(n % 1_000_000).padStart(6, "0");
  }
}
