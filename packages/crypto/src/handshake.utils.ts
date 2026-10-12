import { randomBytes } from "@noble/hashes/utils.js";

import { framed, fromB64, toB64 } from "./bytes.utils.js";
import { LABELS } from "./crypto.constants.js";
import { sign, verify, type TIdentity } from "./keys.utils.js";
import {
  clientSessionKeys,
  kxKeyPair,
  serverSessionKeys,
  type TKxKeyPair,
  type TSessionKeys,
} from "./kx.utils.js";

/**
 * Per-connection handshake. Both sides make a fresh X25519 key pair and sign it with their
 * long-term Ed25519 identity, so a stolen identity key can impersonate a device later but can't
 * decrypt past sessions. The phone is the kx "client", the daemon the "server".
 */
export type THandshakeInit = { sessionId: string; ephPub: string; sig: string };
export type THandshakeAccept = { sessionId: string; ephPub: string; sig: string };
export type TEstablished = { sessionId: string; keys: TSessionKeys };

type TPeers = { clientId: string; serverId: string };

function initMessage(p: TPeers, sessionId: string, clientEph: Uint8Array): Uint8Array {
  return framed(LABELS.handshakeInit, sessionId, p.clientId, p.serverId, clientEph);
}

function acceptMessage(
  p: TPeers,
  sessionId: string,
  clientEph: Uint8Array,
  serverEph: Uint8Array,
): Uint8Array {
  return framed(LABELS.handshakeAccept, sessionId, p.clientId, p.serverId, clientEph, serverEph);
}

/** Client side, step 1. Keep `pending` until the accept arrives. */
export function startHandshake(
  me: TIdentity,
  peers: TPeers,
): { init: THandshakeInit; pending: { sessionId: string; eph: TKxKeyPair } } {
  const eph = kxKeyPair();
  const sessionId = toB64(randomBytes(16));
  const sig = sign(me, initMessage(peers, sessionId, eph.pub));
  return { init: { sessionId, ephPub: toB64(eph.pub), sig: toB64(sig) }, pending: { sessionId, eph } };
}

/** Server side: verifies the client's signature, answers, and derives the session keys. Null if forged. */
export function acceptHandshake(
  me: TIdentity,
  clientSignPub: Uint8Array,
  peers: TPeers,
  init: THandshakeInit,
): { accept: THandshakeAccept; session: TEstablished } | null {
  try {
    const clientEph = fromB64(init.ephPub);
    if (!verify(clientSignPub, initMessage(peers, init.sessionId, clientEph), fromB64(init.sig))) return null;
    const eph = kxKeyPair();
    const sig = sign(me, acceptMessage(peers, init.sessionId, clientEph, eph.pub));
    return {
      accept: { sessionId: init.sessionId, ephPub: toB64(eph.pub), sig: toB64(sig) },
      session: { sessionId: init.sessionId, keys: serverSessionKeys(eph, clientEph) },
    };
  } catch {
    return null;
  }
}

/** Client side, step 2. Null if the accept is forged or answers another handshake. */
export function finishHandshake(
  serverSignPub: Uint8Array,
  peers: TPeers,
  pending: { sessionId: string; eph: TKxKeyPair },
  accept: THandshakeAccept,
): TEstablished | null {
  if (accept.sessionId !== pending.sessionId) return null;
  try {
    const serverEph = fromB64(accept.ephPub);
    const msg = acceptMessage(peers, pending.sessionId, pending.eph.pub, serverEph);
    if (!verify(serverSignPub, msg, fromB64(accept.sig))) return null;
    return { sessionId: pending.sessionId, keys: clientSessionKeys(pending.eph, serverEph) };
  } catch {
    return null;
  }
}
