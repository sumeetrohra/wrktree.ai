import { deviceIdFor } from "@agentdeck/crypto";
import type { TBlobRef, TCommandArgs, TCommandName, TCommandResult, TEvtFrame } from "@agentdeck/protocol";
import { z } from "zod";

import { connStorage, type TMachine } from "./conn.storage";
import { useConnectionStore } from "./connection.store";
import { ConnError, type IDaemonConnection } from "./connection.types";
import { installCryptoPolyfill } from "./crypto-polyfill";
import { LocalConnection } from "./local-connection";
import { localSession } from "./local-session";
import { watchNetwork } from "./network";
import { RelayConnection } from "./relay-connection";

installCryptoPolyfill();
watchNetwork((online) => {
  current?.setNetwork?.(online);
});

const eventListeners = new Set<(e: TEvtFrame) => void>();
let current: IDaemonConnection | null = null;
let detach: (() => void)[] = [];

function attach(
  conn: IDaemonConnection & { start(): void },
  machineName: string | null,
  local: boolean,
): void {
  current?.stop();
  for (const d of detach) d();
  current = conn;
  detach = [
    conn.onEvent((e) => {
      for (const l of eventListeners) l(e);
    }),
    conn.onStatus((status) => {
      useConnectionStore.setState({ status });
    }),
  ];
  useConnectionStore.setState({ status: conn.status, machineName, local });
  conn.start();
}

const devEnvSchema = z.object({
  EXPO_PUBLIC_DAEMON_URL: z.string().optional(),
  EXPO_PUBLIC_DAEMON_TOKEN: z.string().optional(),
});

/** Development: point the app at a local daemon with EXPO_PUBLIC_DAEMON_URL / _TOKEN. */
function localConfig(): { url: string; token: string } | null {
  const env = devEnvSchema.parse({
    EXPO_PUBLIC_DAEMON_URL: process.env.EXPO_PUBLIC_DAEMON_URL,
    EXPO_PUBLIC_DAEMON_TOKEN: process.env.EXPO_PUBLIC_DAEMON_TOKEN,
  });
  return env.EXPO_PUBLIC_DAEMON_URL && env.EXPO_PUBLIC_DAEMON_TOKEN
    ? { url: env.EXPO_PUBLIC_DAEMON_URL, token: env.EXPO_PUBLIC_DAEMON_TOKEN }
    : null;
}

/** Picks the connection at startup: the local daemon, the paired machine, or none (onboarding). */
export function bootConnection(): void {
  const local = localConfig();
  if (local) {
    attach(new LocalConnection(local.url, local.token), "This computer", true);
    return;
  }
  const served = localSession();
  if (served) {
    useConnectionStore.setState({ status: "connecting", local: true, machineName: "This computer" });
    void served.then((s) => {
      if (s) {
        attach(new LocalConnection(s.url, s.token), "This computer", true);
        return;
      }
      // The code was used or expired: this is just a browser, so onboard it like a phone.
      useConnectionStore.setState({ status: "unpaired", local: false, machineName: null });
      bootRelay();
    });
    return;
  }
  bootRelay();
}

function bootRelay(): void {
  const machine = connStorage.machine();
  const token = connStorage.deviceToken();
  if (machine && token !== null) connectMachine(machine, token);
}

/** Starts (or restarts) the encrypted connection to a paired machine and remembers it. */
export function connectMachine(machine: TMachine, deviceToken: string): void {
  connStorage.setMachine(machine);
  connStorage.setDeviceToken(deviceToken);
  const me = connStorage.identity();
  attach(
    new RelayConnection(machine, me, deviceIdFor(me.signPub), deviceToken, "Agentdeck app"),
    machine.name,
    false,
  );
}

/** Forgets the machine (after a revocation, or when the user unpairs). */
export function unpair(): void {
  current?.stop();
  for (const d of detach) d();
  detach = [];
  current = null;
  connStorage.clear();
  useConnectionStore.setState({ status: "unpaired", machineName: null, local: false });
}

/** Every daemon event, whichever connection delivers it. Returns an unsubscribe function. */
export function onDaemonEvent(fn: (e: TEvtFrame) => void): () => void {
  eventListeners.add(fn);
  return () => eventListeners.delete(fn);
}

/** Tests and stories swap the connection for a fake. */
export function setConnection(conn: IDaemonConnection & { start(): void }): void {
  attach(conn, "Test machine", false);
}

function active(): IDaemonConnection {
  if (!current) throw new ConnError("UNPAIRED", "No machine is paired yet");
  return current;
}

export type TDaemonCall = <N extends TCommandName>(
  name: N,
  args: TCommandArgs<N>,
  opts?: { cmdId?: string },
) => Promise<TCommandResult<N>>;

/** The typed command call every query and mutation uses (A1, A2). */
export const daemonCall: TDaemonCall = (name, args, opts) => active().call(name, args, opts);

export function uploadBlob(base64: string, mime: string): Promise<TBlobRef> {
  return active().upload(base64, mime);
}

/** This phone's device id (derived from its signing key). */
export function thisDeviceId(): string {
  return deviceIdFor(connStorage.identity().signPub);
}
