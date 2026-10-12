import { toB64 } from "@agentdeck/crypto";

/** sha256, base64url. Tokens and codes are stored only as hashes. */
export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return toB64(new Uint8Array(digest));
}

export function randomToken(bytes = 32): string {
  return toB64(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** No 0/O or 1/I, so a code read off a terminal is typed right. 32 symbols: 5 bits each. */
const LINK_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Eight uniformly random symbols (40 bits), shown as `ABCD-EFGH`. */
export function randomLinkCode(): string {
  const chars = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => LINK_ALPHABET.charAt(b % 32));
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

/** The code as stored: upper case, without the dash. */
export function normalizeLinkCode(code: string): string {
  return code.replace("-", "").toUpperCase();
}
