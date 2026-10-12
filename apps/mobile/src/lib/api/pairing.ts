import {
  createHello,
  deviceIdFor,
  fromB64,
  linkToOffer,
  pairingTranscript,
  pairMessageSchema,
  shortCode,
  toB64,
  utf8ToBytes,
  bytesToUtf8,
  verifyPairOk,
  type TIdentity,
  type TPairingOffer,
} from "@agentdeck/crypto";
import {
  RELAY_TOKEN_PROTOCOL_PREFIX,
  RELAY_WS_PROTOCOL,
  relayFrameSchema,
  type TRelayFrame,
} from "@agentdeck/protocol";
import { tryParseJson } from "@agentdeck/shared";

import { ConnError } from "./connection.types";
import { relayApi } from "./relay-api";

const REPLY_TIMEOUT_MS = 20_000;

export { linkToOffer, type TPairingOffer };

/**
 * Phone side of QR pairing: claim the offer (puts the daemon on this account), then over a short
 * relay socket send `pair.hello` (MAC'd with the QR secret) and check the daemon's signed reply.
 * Resolves with the six-digit code both screens show.
 */
export async function pairWith(
  offer: TPairingOffer,
  me: TIdentity,
  session: string,
  deviceToken: string,
  deviceName: string,
): Promise<string> {
  const myId = deviceIdFor(me.signPub);
  await relayApi.claim(offer.relayUrl, session, offer.pairingId, myId);
  const hello = createHello(me, offer, deviceName);
  const ws = new WebSocket(`${offer.relayUrl.replace(/^http/, "ws")}/v1/ws`, [
    RELAY_WS_PROTOCOL,
    RELAY_TOKEN_PROTOCOL_PREFIX + deviceToken,
  ]);
  try {
    const reply = await new Promise<TRelayFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new ConnError("TIMEOUT", "The computer didn't answer"));
      }, REPLY_TIMEOUT_MS);
      ws.onopen = () => {
        const frame: TRelayFrame = {
          v: 1,
          from: myId,
          to: offer.daemonDeviceId,
          seq: 0,
          kind: "pair",
          body: toB64(utf8ToBytes(JSON.stringify(hello))),
        };
        ws.send(JSON.stringify(frame));
      };
      ws.onmessage = (msg: MessageEvent<string>) => {
        const f = tryParseJson(relayFrameSchema, msg.data);
        if (f?.kind !== "pair" || f.from !== offer.daemonDeviceId) return;
        clearTimeout(timer);
        resolve(f);
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new ConnError("DISCONNECTED", "Couldn't reach the relay"));
      };
    });
    const msg = tryParseJson(pairMessageSchema, bytesToUtf8(fromB64(reply.body)));
    if (msg?.t !== "pair.ok" || !verifyPairOk(offer, hello, msg)) {
      throw new ConnError("PAIRING_REJECTED", "The computer rejected this pairing");
    }
    return shortCode(pairingTranscript(offer, hello));
  } finally {
    ws.close();
  }
}
