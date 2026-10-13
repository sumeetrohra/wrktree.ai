/** One connection from the WebView to the app's local server. */
export interface ILocalSocket {
  write: (bytes: Uint8Array) => void;
  end: () => void;
  onData: (listener: (bytes: Uint8Array) => void) => void;
  onClose: (listener: () => void) => void;
}

export type TLocalServer = { port: number; stop: () => void };
