import type { TBlobRef, TCommandArgs, TCommandName, TCommandResult, TEvtFrame } from "@agentdeck/protocol";

/**
 * One host's session. `connecting`: socket or handshake in progress. `online`: a session is up and
 * caught up. `offline`: the host or the network is away; retrying.
 */
export type TConnStatus = "connecting" | "online" | "offline";

/** One host, however it is reached (the relay, or the local transport on the desktop). */
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
