import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { parseJson } from "@agentdeck/shared";
import { z } from "zod";

const storedSessionSchema = z.object({
  cwd: z.string(),
  history: z.array(z.object({ role: z.enum(["user", "agent"]), text: z.string() })),
});
export type TStoredSession = z.infer<typeof storedSessionSchema>;

const fileFor = (home: string, id: string): string => join(home, "sessions", `${id}.json`);

export function saveSession(home: string, id: string, s: TStoredSession): void {
  mkdirSync(join(home, "sessions"), { recursive: true });
  writeFileSync(fileFor(home, id), JSON.stringify(s));
}

export function loadSession(home: string, id: string): TStoredSession | undefined {
  const file = fileFor(home, id);
  return existsSync(file) ? parseJson(storedSessionSchema, readFileSync(file, "utf8")) : undefined;
}
