import { exportIdentity, generateIdentity, importIdentity, type TIdentity } from "@agentdeck/crypto";
import { tryParseJson } from "@agentdeck/shared";
import { z } from "zod";

import { secureStore } from "../secure-store";
import { storage } from "../storage";

/** A host on the account, as last listed by the relay (shown while offline). */
const hostSchema = z.object({ id: z.string(), name: z.string(), signPub: z.string() });
export type TStoredHost = z.infer<typeof hostSchema>;

const queuedSchema = z.object({ id: z.string(), name: z.string(), args: z.unknown() });
export type TQueued = z.infer<typeof queuedSchema>;

const identitySchema = z.object({ signPub: z.string(), signSec: z.string() });

const KEYS = {
  relayUrl: "relay.url",
  hosts: "relay.hosts",
  cursors: (hostId: string) => `conn.cursors.${hostId}`,
  queue: (hostId: string) => `conn.queue.${hostId}`,
  identity: "identity",
  deviceToken: "relay.deviceToken",
} as const;

/** Where the connection layer keeps its state: secrets in the keychain, the rest in MMKV. */
export const connStorage = {
  relayUrl: (): string | undefined => storage.get(KEYS.relayUrl, z.url()),
  setRelayUrl: (url: string): void => {
    storage.set(KEYS.relayUrl, url);
  },

  hosts: (): TStoredHost[] => storage.get(KEYS.hosts, z.array(hostSchema)) ?? [],
  setHosts: (hosts: TStoredHost[]): void => {
    storage.set(KEYS.hosts, hosts);
  },

  cursors: (hostId: string): Record<string, number> =>
    storage.get(KEYS.cursors(hostId), z.record(z.string(), z.number())) ?? {},
  setCursors: (hostId: string, c: Record<string, number>): void => {
    storage.set(KEYS.cursors(hostId), c);
  },

  queue: (hostId: string): TQueued[] => storage.get(KEYS.queue(hostId), z.array(queuedSchema)) ?? [],
  setQueue: (hostId: string, q: TQueued[]): void => {
    storage.set(KEYS.queue(hostId), q);
  },

  /** This device's long-term identity, created on first use. */
  identity(): TIdentity {
    const raw = secureStore.get(KEYS.identity);
    const stored = raw === null ? undefined : tryParseJson(identitySchema, raw);
    if (stored) return importIdentity(stored);
    const id = generateIdentity();
    secureStore.set(KEYS.identity, JSON.stringify(exportIdentity(id)));
    return id;
  },

  deviceToken: (): string | null => secureStore.get(KEYS.deviceToken),
  setDeviceToken: (t: string): void => {
    secureStore.set(KEYS.deviceToken, t);
  },

  /** Forgets the account: the token, the hosts and their cursors and queues. */
  clear(): void {
    for (const h of connStorage.hosts()) {
      storage.remove(KEYS.cursors(h.id));
      storage.remove(KEYS.queue(h.id));
    }
    storage.remove(KEYS.hosts);
    secureStore.remove(KEYS.deviceToken);
  },
};
