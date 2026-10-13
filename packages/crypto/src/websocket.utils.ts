import { sha1 } from "@noble/hashes/legacy.js";

import { utf8ToBytes } from "./bytes.utils.js";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/**
 * The `Sec-WebSocket-Accept` a WebSocket server answers a client's key with (RFC 6455). SHA-1 here
 * is the protocol's handshake check, not a security primitive (Phase 5e: the app's local preview
 * server).
 */
export function webSocketAccept(key: string): string {
  // Standard base64 with padding, as the header wants (not the base64url `toB64` gives).
  let bin = "";
  for (const b of sha1(utf8ToBytes(key + WS_GUID))) bin += String.fromCharCode(b);
  return btoa(bin);
}
