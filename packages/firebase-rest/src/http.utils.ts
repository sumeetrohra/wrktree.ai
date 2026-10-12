import { tryParseJson } from "@agentdeck/shared";
import { z } from "zod";

import { FirebaseError } from "./firebase.types.js";

const errorSchema = z.object({ error: z.object({ message: z.string() }) });

/** One HTTP call, the reply zod-checked. Non-2xx becomes a `FirebaseError`. */
export async function call<S extends z.ZodType>(
  url: string,
  init: RequestInit,
  schema: S,
): Promise<z.infer<S>> {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) {
    throw new FirebaseError(
      res.status,
      tryParseJson(errorSchema, text)?.error.message ?? (text.slice(0, 200) || "error"),
    );
  }
  const parsed = schema.safeParse(text === "" ? null : (tryParseJson(z.unknown(), text) ?? null));
  if (!parsed.success) throw new FirebaseError(res.status, `unexpected reply: ${parsed.error.message}`);
  return parsed.data;
}

export const jsonInit = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});
