import { deviceIdFor } from "@agentdeck/crypto";
import type {
  TBlobRef,
  TCommandArgs,
  TCommandName,
  TCommandResult,
  TDeviceKind,
  TEvtFrame,
  TRelayDevice,
} from "@agentdeck/protocol";
import { Platform } from "react-native";
import { z } from "zod";

import { connStorage, type TStoredHost } from "./conn.storage";
import { ConnError, type IDaemonConnection } from "./connection.types";
import { installCryptoPolyfill } from "./crypto-polyfill";
import { useHostsStore, type THost } from "./hosts.store";
import { LocalConnection } from "./local-connection";
import { localSession } from "./local-session";
import { watchNetwork } from "./network";
import { relayApi } from "./relay-api";
import { RelayConnection } from "./relay-connection";
import { RelaySocket } from "./relay-socket";

installCryptoPolyfill();
watchNetwork((online) => {
  socket?.setNetwork(online);
  for (const h of live.values()) h.conn.setNetwork?.(online);
});

/** The host id of this computer's own daemon when the app is its desktop web UI. */
export const LOCAL_HOST = "local";
const HOSTS_REFRESH_MS = 60_000;

type TLive = {
  conn: IDaemonConnection & { start(): void };
  name: string;
  local: boolean;
  detach: () => void;
};

const live = new Map<string, TLive>();
const eventListeners = new Set<(hostId: string, e: TEvtFrame) => void>();
let socket: RelaySocket | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
/** The local daemon's own device id, so it isn't reached a second time through the relay. */
let localDaemonId: string | null = null;

function publish(): void {
  const hosts: THost[] = [...live.entries()].map(([id, h]) => ({
    id,
    name: h.name,
    status: h.conn.status,
    local: h.local,
  }));
  hosts.sort((a, b) => Number(b.local) - Number(a.local) || a.name.localeCompare(b.name));
  useHostsStore.setState({ hosts });
}

function add(
  hostId: string,
  conn: IDaemonConnection & { start(): void },
  name: string,
  local: boolean,
): void {
  remove(hostId);
  const detach = [
    conn.onEvent((e) => {
      for (const l of eventListeners) l(hostId, e);
    }),
    conn.onStatus(publish),
  ];
  live.set(hostId, {
    conn,
    name,
    local,
    detach: () => {
      for (const d of detach) d();
    },
  });
  conn.start();
  publish();
}

function remove(hostId: string): void {
  const h = live.get(hostId);
  if (!h) return;
  h.conn.stop();
  h.detach();
  live.delete(hostId);
  publish();
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

function addLocal(url: string, token: string): void {
  const conn = new LocalConnection(url, token);
  add(LOCAL_HOST, conn, "This computer", true);
  // Learn the daemon's own device id, so the relay's copy of this host is skipped.
  conn.onStatus((s) => {
    if (s !== "online" || localDaemonId !== null) return;
    void conn.call("relay.status", {}).then((r) => {
      localDaemonId = r.deviceId;
      if (localDaemonId !== null) remove(localDaemonId);
    });
  });
}

/**
 * Starts every connection this device has: its own daemon when it is the desktop web UI, and every
 * host on the account when signed in.
 */
export function bootConnections(): void {
  const local = localConfig();
  if (local) addLocal(local.url, local.token);
  const served = local ? null : localSession();
  if (served) {
    useHostsStore.setState({ localPending: true });
    void served.then((s) => {
      if (s) addLocal(s.url, s.token);
      useHostsStore.setState({ localPending: false });
    });
  }
  const relayUrl = connStorage.relayUrl();
  const token = connStorage.deviceToken();
  if (relayUrl !== undefined && token !== null) startAccount(relayUrl, token);
}

function startAccount(relayUrl: string, deviceToken: string): void {
  stopAccount();
  const me = connStorage.identity();
  const s = new RelaySocket(relayUrl, deviceToken, deviceIdFor(me.signPub));
  socket = s;
  useHostsStore.setState({ account: "signedIn" });
  s.onRemoved(() => {
    stopAccount();
    connStorage.clear();
    useHostsStore.setState({ account: "removed" });
  });
  s.onControl((c) => {
    if (c.t !== "relay.presence") return;
    const h = live.get(c.deviceId);
    if (h?.conn instanceof RelayConnection) {
      if (c.online) h.conn.hostOnline();
      else h.conn.hostOffline();
    } else if (c.online) {
      void refreshHosts();
    }
  });
  // Show the hosts known from last time at once; the relay's list replaces them shortly.
  syncHosts(connStorage.hosts());
  s.start();
  void refreshHosts();
  refreshTimer = setInterval(() => {
    void refreshHosts();
  }, HOSTS_REFRESH_MS);
}

function stopAccount(): void {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
  for (const id of [...live.keys()]) if (id !== LOCAL_HOST) remove(id);
  socket?.stop();
  socket = null;
}

/** Makes the relay connections match the account's hosts. */
function syncHosts(hosts: readonly TStoredHost[]): void {
  const s = socket;
  if (!s) return;
  const me = connStorage.identity();
  const wanted = hosts.filter((h) => h.id !== localDaemonId);
  for (const id of [...live.keys()]) {
    if (id !== LOCAL_HOST && !wanted.some((h) => h.id === id)) remove(id);
  }
  for (const h of wanted) {
    const existing = live.get(h.id);
    if (existing) {
      existing.name = h.name;
      continue;
    }
    add(h.id, new RelayConnection({ id: h.id, signPub: h.signPub }, s, me, deviceLabel()), h.name, false);
  }
  publish();
}

/** Re-reads the account's hosts from the relay. */
export async function refreshHosts(): Promise<void> {
  const s = socket;
  const token = connStorage.deviceToken();
  if (!s || token === null) return;
  try {
    const hosts = (await relayApi.devices(s.relayUrl, token))
      .filter((d) => d.kind === "daemon")
      .map((d) => ({ id: d.id, name: d.name, signPub: d.signPub }));
    if (socket !== s) return;
    connStorage.setHosts(hosts);
    syncHosts(hosts);
  } catch {
    // Offline or the relay is down: keep the hosts we know.
  }
}

function deviceKind(): TDeviceKind {
  return Platform.OS === "web" ? "web" : "phone";
}

function deviceLabel(): string {
  return Platform.OS === "web" ? "Agentdeck web" : "Agentdeck app";
}

/**
 * Joins the signed-in account (`idToken` from the sign-in provider) and connects to its hosts.
 * Returns this device's token, e.g. to register for push.
 */
export async function joinAccount(
  relayUrl: string,
  idToken: string,
  name: string,
  at: number,
): Promise<string> {
  const deviceToken = await relayApi.register(
    relayUrl,
    idToken,
    connStorage.identity(),
    { name, kind: deviceKind() },
    at,
  );
  connStorage.setRelayUrl(relayUrl);
  connStorage.setDeviceToken(deviceToken);
  startAccount(relayUrl, deviceToken);
  return deviceToken;
}

/** Leaves the account: the relay forgets this device, and it forgets its hosts. */
export async function leaveAccount(): Promise<void> {
  const relayUrl = connStorage.relayUrl();
  const token = connStorage.deviceToken();
  stopAccount();
  if (relayUrl !== undefined && token !== null) {
    await relayApi.remove(relayUrl, token, thisDeviceId()).catch(() => undefined);
  }
  connStorage.clear();
  useHostsStore.setState({ account: "signedOut" });
}

/** The relay this device's account lives on, once signed in. */
export function accountRelayUrl(): string | null {
  return connStorage.relayUrl() ?? null;
}

/** The account's devices, read with this device's token. */
export async function accountDevices(): Promise<TRelayDevice[]> {
  const relayUrl = connStorage.relayUrl();
  const token = connStorage.deviceToken();
  if (relayUrl === undefined || token === null) return [];
  return relayApi.devices(relayUrl, token);
}

/** Registers an Expo push token for this device. */
export async function registerPushToken(expoPushToken: string): Promise<void> {
  const relayUrl = connStorage.relayUrl();
  const token = connStorage.deviceToken();
  if (relayUrl === undefined || token === null) return;
  await relayApi.registerPush(relayUrl, token, expoPushToken);
}

/** Every daemon event from every host. Returns an unsubscribe function. */
export function onDaemonEvent(fn: (hostId: string, e: TEvtFrame) => void): () => void {
  eventListeners.add(fn);
  return () => eventListeners.delete(fn);
}

/** Tests and stories swap in a fake host. */
export function setConnection(
  hostId: string,
  conn: IDaemonConnection & { start(): void },
  name = "Test machine",
): void {
  add(hostId, conn, name, false);
}

function host(hostId: string): IDaemonConnection {
  const h = live.get(hostId);
  if (!h) throw new ConnError("UNKNOWN_HOST", "That computer isn't on your account");
  return h.conn;
}

export type TDaemonCall = <N extends TCommandName>(
  hostId: string,
  name: N,
  args: TCommandArgs<N>,
  opts?: { cmdId?: string },
) => Promise<TCommandResult<N>>;

/** The typed command call every query and mutation uses (A1, A2), addressed to one host. */
export const daemonCall: TDaemonCall = async (hostId, name, args, opts) =>
  host(hostId).call(name, args, opts);

export async function uploadBlob(hostId: string, base64: string, mime: string): Promise<TBlobRef> {
  return host(hostId).upload(base64, mime);
}

/** This device's id (derived from its signing key). */
export function thisDeviceId(): string {
  return deviceIdFor(connStorage.identity().signPub);
}
