import TcpSocket from "react-native-tcp-socket";

import type { ILocalSocket, TLocalServer } from "./local-server.types";

const enc = new TextEncoder();

/**
 * A server on `127.0.0.1` (a free port), only reachable from this phone: the sealed preview's page
 * loads from it in the WebView (Phase 5e, L30).
 */
export function startLocalServer(onConnection: (socket: ILocalSocket) => void): Promise<TLocalServer> {
  return new Promise((resolve, reject) => {
    const server = TcpSocket.createServer((s) => {
      onConnection({
        write: (bytes) => {
          s.write(bytes);
        },
        end: () => {
          s.end();
        },
        onData: (listener) => {
          s.on("data", (d) => {
            listener(typeof d === "string" ? enc.encode(d) : new Uint8Array(d));
          });
        },
        onClose: (listener) => {
          s.on("close", () => {
            listener();
          });
        },
      });
    });
    server.on("error", reject);
    server.listen({ port: 0, host: "127.0.0.1" }, () => {
      const address = server.address();
      if (!address) {
        reject(new Error("The local server didn't start"));
        return;
      }
      resolve({
        port: address.port,
        stop: () => {
          server.close();
        },
      });
    });
  });
}
