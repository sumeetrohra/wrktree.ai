import { concatBytes, randomBytes, utf8ToBytes } from "@noble/hashes/utils.js";

export { concatBytes, randomBytes, utf8ToBytes };

/** UTF-8 decode; falls back to a manual decoder where TextDecoder is missing (older Hermes). */
export function bytesToUtf8(bytes: Uint8Array): string {
  if (typeof TextDecoder !== "undefined") return new TextDecoder().decode(bytes);
  let out = "";
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i++] ?? 0;
    let cp = b;
    if (b >= 0xf0)
      cp =
        ((b & 0x07) << 18) |
        (((bytes[i++] ?? 0) & 0x3f) << 12) |
        (((bytes[i++] ?? 0) & 0x3f) << 6) |
        ((bytes[i++] ?? 0) & 0x3f);
    else if (b >= 0xe0)
      cp = ((b & 0x0f) << 12) | (((bytes[i++] ?? 0) & 0x3f) << 6) | ((bytes[i++] ?? 0) & 0x3f);
    else if (b >= 0xc0) cp = ((b & 0x1f) << 6) | ((bytes[i++] ?? 0) & 0x3f);
    out += String.fromCodePoint(cp);
  }
  return out;
}

/** URL-safe base64 without padding, the encoding for every key and ciphertext on the wire. */
export function toB64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Throws on characters outside the base64url alphabet. */
export function fromB64(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error("invalid base64url");
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Length-prefixes each part so concatenations can't be ambiguous ("ab"+"c" vs "a"+"bc"). */
export function framed(...parts: (Uint8Array | string)[]): Uint8Array {
  return concatBytes(
    ...parts.flatMap((p) => {
      const bytes = typeof p === "string" ? utf8ToBytes(p) : p;
      const len = new Uint8Array(4);
      new DataView(len.buffer).setUint32(0, bytes.length);
      return [len, bytes];
    }),
  );
}

/** Constant-time comparison. */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}
