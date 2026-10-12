/** Domain-separation labels: a signature or MAC made for one purpose never verifies for another. */
export const LABELS = {
  pairHello: "agentdeck/pair-hello/v1",
  pairOk: "agentdeck/pair-ok/v1",
  pairTranscript: "agentdeck/pair-transcript/v1",
  shortCode: "agentdeck/short-code/v1",
  handshakeInit: "agentdeck/hs-init/v1",
  handshakeAccept: "agentdeck/hs-accept/v1",
  frameAd: "agentdeck/frame/v1",
  deviceId: "agentdeck/device-id/v1",
  register: "agentdeck/register/v1",
  revoke: "agentdeck/revoke/v1",
} as const;

export const KEY_BYTES = 32;
export const NONCE_BYTES = 24;
export const SIGNATURE_BYTES = 64;
export const PAIRING_SECRET_BYTES = 32;
