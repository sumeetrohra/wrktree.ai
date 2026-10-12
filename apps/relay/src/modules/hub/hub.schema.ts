import { deviceKindSchema } from "@agentdeck/protocol";
import { z } from "zod";

/** Account members and the store-and-forward buffer. Bodies are sealed; the relay can't read them. */
export const HUB_SCHEMA = `
CREATE TABLE IF NOT EXISTS members (
  device_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  push_token TEXT,
  last_push_at INTEGER
);
CREATE TABLE IF NOT EXISTS frames (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target TEXT NOT NULL,
  sender TEXT NOT NULL,
  seq INTEGER NOT NULL,
  sid TEXT,
  bytes INTEGER NOT NULL,
  frame TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS frames_by_target ON frames(target, id);
CREATE TABLE IF NOT EXISTS gaps (target TEXT NOT NULL, sender TEXT NOT NULL, PRIMARY KEY (target, sender));
`;

export const memberRowSchema = z.object({
  device_id: z.string(),
  kind: deviceKindSchema,
  push_token: z.string().nullable(),
  last_push_at: z.number().nullable(),
});
export const frameRowSchema = z.object({ id: z.number(), frame: z.string() });
export const totalsRowSchema = z.object({ n: z.number(), bytes: z.number().nullable() });
export const gapRowSchema = z.object({ sender: z.string() });
export const pairRowSchema = z.object({ target: z.string(), sender: z.string() });
