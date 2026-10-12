import type { TBlobRef, TCommandArgs, TCommandName, TCommandResult, TEvtFrame } from "@agentdeck/protocol";

/**
 * `unpaired`: no machine yet. `connecting`: socket or handshake in progress (also while the
 * desktop hasn't confirmed the pairing). `online`: a session is up. `offline`: waiting to retry.
 * `revoked`: this device was revoked; nothing will reconnect.
 */
export type TConnStatus = "unpaired" | "connecting" | "online" | "offline" | "revoked";

/** One machine, however it is reached (the relay, or the local transport on the desktop). */
export interface IDaemonConnection {
  call<N extends TCommandName>(
    name: N,
    args: TCommandArgs<N>,
    opts?: { cmdId?: string },
  ): Promise<TCommandResult<N>>;
  /** Uploads bytes as blob frames, then `blob.put`. */
  upload(base64: string, mime: string): Promise<TBlobRef>;
  onEvent(fn: (e: TEvtFrame) => void): () => void;
  onStatus(fn: (s: TConnStatus) => void): () => void;
  readonly status: TConnStatus;
  stop(): void;
  /** Optional: react to the device's network going down or coming back. */
  setNetwork?(online: boolean): void;
}

/** A command failed: the daemon's error code (e.g. NOT_FOUND), or DISCONNECTED. */
export class ConnError extends Error {
  override name = "ConnError";

  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
