import { exportIdentity, generateIdentity, importIdentity, type TIdentity } from "@agentdeck/crypto";
import { tryParseJson } from "@agentdeck/shared";
import { z } from "zod";

import { secureStore } from "../secure-store";
import { storage } from "../storage";

/** The paired machine, as learned from its QR code. */
const machineSchema = z.object({
  relayUrl: z.url(),
  daemonDeviceId: z.string(),
  daemonSignPub: z.string(),
  name: z.string(),
});
export type TMachine = z.infer<typeof machineSchema>;

const queuedSchema = z.object({ id: z.string(), name: z.string(), args: z.unknown() });
export type TQueued = z.infer<typeof queuedSchema>;

const identitySchema = z.object({ signPub: z.string(), signSec: z.string() });

const KEYS = {
  machine: "conn.machine",
  cursors: "conn.cursors",
  queue: "conn.queue",
  identity: "identity",
  deviceToken: "relay.deviceToken",
  session: "relay.session",
  email: "relay.email",
} as const;

/** Where the connection layer keeps its state: secrets in the keychain, the rest in MMKV. */
export const connStorage = {
  machine: (): TMachine | undefined => storage.get(KEYS.machine, machineSchema),
  setMachine: (m: TMachine): void => {
    storage.set(KEYS.machine, m);
  },

  cursors: (): Record<string, number> => storage.get(KEYS.cursors, z.record(z.string(), z.number())) ?? {},
  setCursors: (c: Record<string, number>): void => {
    storage.set(KEYS.cursors, c);
  },

  queue: (): TQueued[] => storage.get(KEYS.queue, z.array(queuedSchema)) ?? [],
  setQueue: (q: TQueued[]): void => {
    storage.set(KEYS.queue, q);
  },

  /** This phone's long-term identity, created on first use. */
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
  session: (): string | null => secureStore.get(KEYS.session),
  setSession: (t: string): void => {
    secureStore.set(KEYS.session, t);
  },
  email: (): string | undefined => storage.get(KEYS.email, z.string()),
  setEmail: (e: string): void => {
    storage.set(KEYS.email, e);
  },

  /** Forgets the machine and every secret (after a revocation, or "unpair"). */
  clear(): void {
    for (const k of [KEYS.machine, KEYS.cursors, KEYS.queue, KEYS.email]) storage.remove(k);
    for (const k of [KEYS.deviceToken, KEYS.session]) secureStore.remove(k);
  },
};
