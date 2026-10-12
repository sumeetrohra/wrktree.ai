import { deviceKindSchema } from "@agentdeck/protocol";
import { z } from "zod";

/** Accounts (one per sign-in uid), devices and recorded dev pushes. */
export const DIRECTORY_SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  email TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  sign_pub TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS devices_by_account ON devices(account_id);
CREATE UNIQUE INDEX IF NOT EXISTS devices_by_token ON devices(token_hash);
CREATE TABLE IF NOT EXISTS dev_pushes (
  device_id TEXT NOT NULL, token TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, at INTEGER NOT NULL
);
`;

export const accountRowSchema = z.object({ id: z.string(), email: z.string().nullable() });

export const deviceRowSchema = z.object({
  id: z.string(),
  account_id: z.string(),
  kind: deviceKindSchema,
  name: z.string(),
  sign_pub: z.string(),
  created_at: z.number(),
});
export type TDeviceRow = z.infer<typeof deviceRowSchema>;

export const pushRowSchema = z.object({
  deviceId: z.string(),
  token: z.string(),
  title: z.string(),
  body: z.string(),
  at: z.number(),
});
