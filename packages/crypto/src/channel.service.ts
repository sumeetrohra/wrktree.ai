import { open, seal } from "./aead.utils.js";
import { bytesToUtf8, framed, fromB64, toB64, utf8ToBytes } from "./bytes.utils.js";
import { LABELS } from "./crypto.constants.js";
import type { TEstablished } from "./handshake.utils.js";

export type TSealed = { seq: number; sessionId: string; body: string };

/**
 * One direction-pair of an established session. The additional data binds every ciphertext to
 * its routing header (`from`, `to`, `seq`, `sessionId`), and `seq` must strictly increase, so the
 * relay can't redirect, replay or reorder frames.
 */
export class SecureChannel {
  private sendSeq = 0;
  private lastRecvSeq = 0;

  constructor(
    private readonly session: TEstablished,
    readonly localId: string,
    readonly peerId: string,
  ) {}

  get sessionId(): string {
    return this.session.sessionId;
  }

  private ad(from: string, to: string, seq: number): Uint8Array {
    return framed(LABELS.frameAd, from, to, String(seq), this.session.sessionId);
  }

  seal(plaintext: string): TSealed {
    const seq = ++this.sendSeq;
    const box = seal(this.session.keys.tx, utf8ToBytes(plaintext), this.ad(this.localId, this.peerId, seq));
    return { seq, sessionId: this.session.sessionId, body: toB64(box) };
  }

  /** Null for a frame from another session, a replayed or reordered seq, or tampered bytes. */
  open(frame: { from: string; to: string; seq: number; sessionId: string; body: string }): string | null {
    if (frame.sessionId !== this.session.sessionId) return null;
    if (frame.from !== this.peerId || frame.to !== this.localId) return null;
    if (frame.seq <= this.lastRecvSeq) return null;
    let box: Uint8Array;
    try {
      box = fromB64(frame.body);
    } catch {
      return null;
    }
    const plain = open(this.session.keys.rx, box, this.ad(frame.from, frame.to, frame.seq));
    if (!plain) return null;
    this.lastRecvSeq = frame.seq;
    return bytesToUtf8(plain);
  }
}
