import { deviceKindSchema } from "@agentdeck/protocol";
import { z } from "zod";

/** Accounts, devices, magic-link codes and pairing offers. Shared by both hosts. */
export const DIRECTORY_SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  github_id TEXT UNIQUE,
  placeholder INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  sign_pub TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS devices_by_account ON devices(account_id);
CREATE UNIQUE INDEX IF NOT EXISTS devices_by_token ON devices(token_hash);
CREATE TABLE IF NOT EXISTS magic_codes (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pairings (
  id TEXT PRIMARY KEY,
  daemon_device_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  claimed_at INTEGER
);
CREATE TABLE IF NOT EXISTS dev_outbox (to_addr TEXT NOT NULL, code TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS dev_pushes (
  device_id TEXT NOT NULL, token TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, at INTEGER NOT NULL
);
`;

export const accountRowSchema = z.object({ id: z.string(), placeholder: z.number() });

export const deviceRowSchema = z.object({
  id: z.string(),
  account_id: z.string(),
  kind: deviceKindSchema,
  name: z.string(),
  sign_pub: z.string(),
  created_at: z.number(),
  revoked_at: z.number().nullable(),
});
export type TDeviceRow = z.infer<typeof deviceRowSchema>;

export const magicRowSchema = z.object({
  code_hash: z.string(),
  expires_at: z.number(),
  attempts: z.number(),
});

export const pairingRowSchema = z.object({
  id: z.string(),
  daemon_device_id: z.string(),
  expires_at: z.number(),
  claimed_at: z.number().nullable(),
});

export const outboxRowSchema = z.object({ to: z.string(), code: z.string(), at: z.number() });
export const pushRowSchema = z.object({
  deviceId: z.string(),
  token: z.string(),
  title: z.string(),
  body: z.string(),
  at: z.number(),
});
